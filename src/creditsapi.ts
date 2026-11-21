import { getSessionUser } from "./auth.ts";
import { ALLOWANCES, CREDIT_COST, TOPUPS, allowanceById, creditView, loadAllowance, topUpById, type Allowance, type TopUp } from "./credits.ts";
import { todayLocal } from "./dates.ts";
import { payerFields, stripeApi } from "./stripe.ts";
import { effectivePlan, normalizePlan, trialDaysLeft, usageSummary, type Feature } from "./usage.ts";
import type { Env } from "./types.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** The words a painter sees for each metered AI feature. */
export const FEATURE_LABELS: Record<Feature, string> = {
  ai_quote: "Website instant quotes", ai_estimate: "Estimate helper", ai_invoice: "Invoice notes", photo_tag: "Photo tags", smart_select: "Color smart select",
  hd_render: "HD color renders", ai_assistant: "Job assistant questions", insurance_scan: "Insurance policy reads", ai_detailed: "Detailed answers",
  photo_analysis: "Photo analysis", ai_deep: "Step-by-step deep answers", receipt_read: "Receipt reads", bank_read: "Bank statement reads",
  quote_helper: "Quote helper", estimate_draft: "Estimate drafts", help_chat: "Help chat", vehicle_read: "Vehicle photo reads", color_repaint: "Color previews on a photo", site_write: "Website writing help", site_image: "Website photos made with AI", logo_design: "Logo designs", site_image_draft: "Website photo drafts made with AI",
};

/** The Stripe Checkout form for one top-up (a single payment, not a subscription). */
export function topUpCheckoutForm(origin: string, i: { companyId: number; email: string; topUp: TopUp; customerId?: string | null }): URLSearchParams {
  const f = new URLSearchParams();
  f.set("mode", "payment");
  payerFields(f, i.email, i.customerId);
  f.set("success_url", `${origin}/credits?bought=1`);
  f.set("cancel_url", `${origin}/credits`);
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", "usd");
  f.set("line_items[0][price_data][unit_amount]", String(i.topUp.priceCents));
  f.set("line_items[0][price_data][product_data][name]", `PaintersMax AI credits (${i.topUp.credits})`);
  f.set("metadata[kind]", "topup");
  f.set("metadata[company_id]", String(i.companyId));
  f.set("metadata[topup]", i.topUp.id);
  return f;
}

/** The Stripe Checkout form for a monthly allowance (a subscription that adds credits every month). */
export function allowanceCheckoutForm(origin: string, i: { companyId: number; email: string; allowance: Allowance; customerId?: string | null }): URLSearchParams {
  const f = new URLSearchParams();
  f.set("mode", "subscription");
  if (i.customerId) f.set("customer", i.customerId);
  else f.set("customer_email", i.email);
  f.set("success_url", `${origin}/credits?allowance=1`);
  f.set("cancel_url", `${origin}/credits`);
  f.set("allow_promotion_codes", "true");
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", "usd");
  f.set("line_items[0][price_data][unit_amount]", String(i.allowance.priceCents));
  f.set("line_items[0][price_data][recurring][interval]", "month");
  f.set("line_items[0][price_data][product_data][name]", `PaintersMax AI allowance (${i.allowance.credits} credits a month)`);
  f.set("metadata[kind]", "allowance");
  f.set("metadata[company_id]", String(i.companyId));
  f.set("metadata[allowance]", i.allowance.id);
  f.set("subscription_data[metadata][kind]", "allowance");
  f.set("subscription_data[metadata][company_id]", String(i.companyId));
  f.set("subscription_data[metadata][allowance]", i.allowance.id);
  return f;
}

/** The form that moves a running allowance subscription to another size. The new amount is charged from the next month; credits follow the payment. */
export function allowanceChangeForm(itemId: string, allowance: Allowance): URLSearchParams {
  const f = new URLSearchParams();
  f.set("items[0][id]", itemId);
  f.set("items[0][price_data][currency]", "usd");
  f.set("items[0][price_data][unit_amount]", String(allowance.priceCents));
  f.set("items[0][price_data][recurring][interval]", "month");
  f.set("items[0][price_data][product]", "");
  f.set("proration_behavior", "none");
  f.set("metadata[allowance]", allowance.id);
  return f;
}

/**
 * /api/credits (signed in)
 *  GET   plan, credit balance, the allowance, when the next credits run out, this month's AI use for each feature
 *  POST  {action:"topup", id}      starts a Stripe payment page for a top-up (any plan)
 *        {action:"allowance", id}  starts a Stripe subscription page for a monthly allowance, or changes the size of the one running
 */
export async function handleCredits(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const co = await env.DB.prepare("SELECT id, plan, created_at AS createdAt, stripe_customer_id AS customerId FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt: string; customerId: string | null }>();
  if (!co) return json({ error: "Not found." }, 404);

  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    if (!env.STRIPE_SECRET_KEY) return json({ error: "Payments are not open yet." }, 503);
    const origin = new URL(request.url).origin;
    if (b?.action === "topup") {
      const t = topUpById(b.id);
      if (!t) return json({ error: "Choose a top-up." }, 400);
      const s = await stripeApi(env, "checkout/sessions", topUpCheckoutForm(origin, { companyId: co.id, email: user.email, topUp: t, customerId: co.customerId }));
      return json({ url: s.url });
    }
    if (b?.action === "allowance") {
      const a = allowanceById(b.id);
      if (!a) return json({ error: "Choose an allowance." }, 400);
      const cur = await loadAllowance(env, co.id);
      if (cur && cur.status !== "ended") {
        if (cur.allowanceId === a.id) return json({ error: "That is already your allowance." }, 400);
        // Change the size of the running subscription. Stripe tells us the new amount on the next paid invoice.
        const sub = await stripeApi(env, `subscriptions/${encodeURIComponent(cur.subscriptionId)}`, new URLSearchParams());
        const itemId = sub?.items?.data?.[0]?.id;
        const productId = sub?.items?.data?.[0]?.price?.product;
        if (typeof itemId !== "string" || typeof productId !== "string") return json({ error: "Could not read your allowance. Use Manage billing instead." }, 500);
        const form = allowanceChangeForm(itemId, a);
        form.set("items[0][price_data][product]", productId);
        await stripeApi(env, `subscriptions/${encodeURIComponent(cur.subscriptionId)}`, form);
        return json({ ok: true, changed: true });
      }
      const s = await stripeApi(env, "checkout/sessions", allowanceCheckoutForm(origin, { companyId: co.id, email: user.email, allowance: a, customerId: co.customerId }));
      return json({ url: s.url });
    }
    return json({ error: "Unknown action." }, 400);
  }
  if (request.method !== "GET") return json({ error: "Not found." }, 404);

  const today = todayLocal();
  const [view, usage, allowance] = await Promise.all([creditView(env, co.id, today), usageSummary(env, co), loadAllowance(env, co.id)]);
  const eff = effectivePlan(co);
  const a = allowance && allowance.status !== "ended" ? allowanceById(allowance.allowanceId) : null;
  return json({
    plan: normalizePlan(co.plan),
    effectivePlan: eff,
    trialDaysLeft: trialDaysLeft(co),
    canUseCredits: true,
    balance: view.balance,
    nextExpiry: view.nextExpiry,
    allowance: a && allowance ? { id: a.id, credits: a.credits, priceCents: a.priceCents, status: allowance.status, since: allowance.since, lastGrantOn: allowance.lastGrantOn } : null,
    allowances: ALLOWANCES.map((x) => ({ id: x.id, credits: x.credits, priceCents: x.priceCents })),
    topUps: TOPUPS.map((x) => ({ id: x.id, credits: x.credits, priceCents: x.priceCents })),
    forSale: !!env.STRIPE_SECRET_KEY,
    canManageBilling: !!co.customerId,
    grants: view.grants.filter((g) => !g.expired && g.left > 0).map((g) => ({ on: g.on, expiresOn: g.expiresOn, credits: g.credits, left: g.left, source: g.source, note: g.note })),
    period: usage.period,
    features: usage.features
      .filter((f) => f.limit > 0 || f.used > 0 || f.missed > 0 || f.creditUses > 0)
      .map((f) => ({ feature: f.feature, label: FEATURE_LABELS[f.feature as Feature] ?? f.feature, used: f.used, limit: f.limit, creditUses: f.creditUses, missed: f.missed, creditCost: CREDIT_COST[f.feature as Feature] ?? 1 })),
  });
}
