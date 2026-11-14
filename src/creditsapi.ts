import { getSessionUser } from "./auth.ts";
import { CREDIT_COST, CREDIT_EXPIRY_DAYS, CREDIT_PACKS, creditView } from "./credits.ts";
import { todayLocal } from "./dates.ts";
import { stripeApi } from "./stripe.ts";
import { effectivePlan, normalizePlan, trialDaysLeft, usageSummary, type Feature } from "./usage.ts";
import type { Env } from "./types.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** The words a painter sees for each metered AI feature. */
export const FEATURE_LABELS: Record<Feature, string> = {
  ai_quote: "Website instant quotes", ai_estimate: "Estimate helper", ai_invoice: "Invoice notes", photo_tag: "Photo tags", smart_select: "Color smart select",
  hd_render: "HD color renders", ai_assistant: "Job assistant questions", insurance_scan: "Insurance policy reads", ai_detailed: "Detailed answers",
  photo_analysis: "Photo analysis", ai_deep: "Step-by-step deep answers", receipt_read: "Receipt reads", bank_read: "Bank statement reads",
  quote_helper: "Quote helper", estimate_draft: "Estimate drafts", help_chat: "Help chat", vehicle_read: "Vehicle photo reads", color_repaint: "Color previews on a photo",
};

/** The Stripe Checkout form for one credit pack (a single payment, not a subscription). */
export function creditCheckoutForm(origin: string, i: { companyId: number; email: string; packId: string }): URLSearchParams | null {
  const pack = CREDIT_PACKS.find((p) => p.id === i.packId);
  if (!pack || pack.priceCents === null || pack.priceCents < 50) return null;
  const f = new URLSearchParams();
  f.set("mode", "payment");
  f.set("customer_email", i.email);
  f.set("success_url", `${origin}/credits?bought=1`);
  f.set("cancel_url", `${origin}/credits`);
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", "usd");
  f.set("line_items[0][price_data][unit_amount]", String(pack.priceCents));
  f.set("line_items[0][price_data][product_data][name]", `PaintersMax AI credits (${pack.credits})`);
  f.set("metadata[kind]", "credits");
  f.set("metadata[company_id]", String(i.companyId));
  f.set("metadata[pack]", pack.id);
  return f;
}

/**
 * /api/credits (signed in)
 *  GET   plan, credit balance, when the next credits run out, this month's AI use for each feature
 *  POST  {action:"buy", pack}  starts a Stripe payment page for a pack, once the owner has set a price
 */
export async function handleCredits(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const co = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt: string }>();
  if (!co) return json({ error: "Not found." }, 404);
  const paid = normalizePlan(co.plan) !== "free";

  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    if (b?.action !== "buy") return json({ error: "Unknown action." }, 400);
    if (!paid) return json({ error: "Credits come with a paid plan. Choose a plan first." }, 400);
    const pack = CREDIT_PACKS.find((p) => p.id === b.pack);
    if (!pack) return json({ error: "Choose a pack." }, 400);
    if (pack.priceCents === null) return json({ error: "Credit packs are not for sale yet. Ask us and we can add credits to your account." }, 400);
    if (!env.STRIPE_SECRET_KEY) return json({ error: "Payments are not open yet." }, 503);
    const form = creditCheckoutForm(new URL(request.url).origin, { companyId: co.id, email: user.email, packId: pack.id });
    if (!form) return json({ error: "That pack cannot be bought right now." }, 400);
    const s = await stripeApi(env, "checkout/sessions", form);
    return json({ url: s.url });
  }
  if (request.method !== "GET") return json({ error: "Not found." }, 404);

  const today = todayLocal();
  const [view, usage] = await Promise.all([creditView(env, co.id, today), usageSummary(env, co)]);
  const eff = effectivePlan(co);
  return json({
    plan: normalizePlan(co.plan),
    effectivePlan: eff,
    trialDaysLeft: trialDaysLeft(co),
    canUseCredits: paid,
    balance: view.balance,
    nextExpiry: view.nextExpiry,
    expiryDays: CREDIT_EXPIRY_DAYS,
    grants: view.grants.filter((g) => !g.expired && g.left > 0).map((g) => ({ on: g.on, expiresOn: g.expiresOn, credits: g.credits, left: g.left, note: g.note })),
    packs: CREDIT_PACKS.map((p) => ({ id: p.id, credits: p.credits, priceCents: p.priceCents, forSale: p.priceCents !== null && !!env.STRIPE_SECRET_KEY })),
    period: usage.period,
    features: usage.features
      .filter((f) => f.limit > 0 || f.used > 0 || f.missed > 0)
      .map((f) => ({ feature: f.feature, label: FEATURE_LABELS[f.feature as Feature] ?? f.feature, used: f.used, limit: f.limit, creditUses: f.creditUses, missed: f.missed, creditCost: CREDIT_COST[f.feature as Feature] ?? 1 })),
  });
}
