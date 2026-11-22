import { getSessionUser } from "./auth.ts";
import { provisionClient } from "./admin.ts";
import { allowanceById, allowanceByPrice, companyOfAllowanceSub, grantCredits, loadAllowance, saveAllowance, topUpById } from "./credits.ts";
import { todayLocal } from "./dates.ts";
import { normalizePlan, type Plan } from "./usage.ts";
import { applyGrowthSteps, applyPaidUpgrade } from "./sitebuilder.ts";
import type { Env } from "./types.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const PLAN_RANK: Record<Plan, number> = { free: 0, starter: 1, basic: 2, pro: 3 };

export const stripeApi = async (env: Env, path: string, form: URLSearchParams) => {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new Error(`stripe ${r.status} ${j?.error?.message ?? ""}`.trim());
  return j;
};

/**
 * Who pays a one-time Checkout. A painter who already has a Stripe customer pays as that customer; anyone else gets
 * one made (customer_creation=always). Without it Stripe makes a "guest" payment with no customer, so the Billing
 * button has nothing to open and the yearly renewal has no saved customer.
 */
export function payerFields(f: URLSearchParams, email: string, customerId?: string | null) {
  if (customerId) f.set("customer", customerId);
  else {
    f.set("customer_email", email);
    f.set("customer_creation", "always");
  }
}

/**
 * POST /api/checkout: the old sign-up that sold the retired $99/$199/$349 monthly plans plus a $499 setup fee.
 * Those plans went away on 2026-11-14 and no page links here any more, so it now only points to the free sign-up
 * (/start), where the doors and the running promotion are sold. Old subscriptions keep working through the webhook below.
 */
export async function handleCheckout(_request: Request, _env: Env): Promise<Response> {
  return json({ error: "This sign-up page has moved. Start free at paintersmax.app/start.", moved: "/start" }, 410);
}

/** The subscription an invoice belongs to. Stripe moved it from invoice.subscription to invoice.parent.subscription_details.subscription in API version 2025-03-31; both are read. */
export function invoiceSubscription(o: any): string | null {
  const v = o?.subscription ?? o?.parent?.subscription_details?.subscription;
  return typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null;
}

/**
 * Checkout can finish before the money arrives (a bank payment): Stripe then sends checkout.session.completed with
 * payment_status "unpaid" and, days later, checkout.session.async_payment_succeeded. One-time payments are applied on that
 * second event the same way as a card payment. Subscriptions are handled on completion as before.
 */
export function effectiveType(event: any): string {
  const t = String(event?.type ?? "");
  return t === "checkout.session.async_payment_succeeded" && event?.data?.object?.mode === "payment" ? "checkout.session.completed" : t;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/** Stripe signs "timestamp.body" with the endpoint secret. Rejects bad signatures and events older than 5 minutes. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find((p) => p[0] === "t")?.[1];
  const sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(nowSeconds - Number(t)) > 300) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  // Compare every candidate without stopping early.
  let ok = false;
  for (const s of sigs) {
    if (s.length === expected.length) {
      let diff = 0;
      for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ expected.charCodeAt(i);
      if (diff === 0) ok = true;
    }
  }
  return ok;
}

/** Key in app_settings that marks a client whose last payment failed. The Home screen shows a banner until a payment succeeds. */
export const pastDueKey = (companyId: number) => `past_due:${companyId}`;

async function setPastDue(env: Env, column: "stripe_customer_id" | "stripe_subscription_id", value: string, on: boolean): Promise<void> {
  const c = await env.DB.prepare(`SELECT id FROM companies WHERE ${column} = ?`).bind(value).first<{ id: number }>();
  if (!c) return;
  if (on) {
    await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO NOTHING").bind(pastDueKey(c.id), new Date().toISOString()).run();
  } else {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(pastDueKey(c.id)).run();
  }
}

/** POST /api/stripe/webhook: Stripe tells us a payment happened or a subscription ended. */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST" || !env.STRIPE_WEBHOOK_SECRET) return json({ error: "Not found." }, 404);
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) return json({ error: "Bad signature." }, 400);
  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (typeof event?.id !== "string") return json({ error: "Invalid event." }, 400);
  const seen = await env.DB.prepare("SELECT 1 FROM stripe_events WHERE id = ?").bind(event.id).first();
  if (seen) return json({ ok: true, duplicate: true });

  const obj = event.data?.object ?? {};
  const type = effectiveType(event);
  if (type === "checkout.session.completed" && obj.mode === "subscription" && obj.metadata?.kind !== "allowance") {
    const plan = normalizePlan(obj.metadata?.plan);
    const email = obj.customer_details?.email || obj.customer_email;
    const r = await provisionClient(env, new URL(request.url).origin, { name: obj.metadata?.company_name, email, plan });
    if (!r.ok) {
      console.error("stripe provision failed", r.error);
      return json({ ok: true, ignored: r.error }); // a bad request will not get better on retry
    }
    const cur = await env.DB.prepare("SELECT plan FROM companies WHERE id = ?").bind(r.companyId).first<{ plan: string }>();
    // A payment can raise a plan, never lower one.
    const newPlan = PLAN_RANK[plan] > PLAN_RANK[normalizePlan(cur?.plan)] ? plan : normalizePlan(cur?.plan);
    await env.DB.prepare("UPDATE companies SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?")
      .bind(newPlan, typeof obj.customer === "string" ? obj.customer : null, typeof obj.subscription === "string" ? obj.subscription : null, r.companyId)
      .run();
  } else if (type === "checkout.session.completed" && obj.mode === "payment" && obj.metadata?.kind === "topup" && obj.payment_status === "paid") {
    // A top-up was paid for. The size comes from our own list, never from the message. The same payment is added once.
    const t = topUpById(obj.metadata?.topup);
    const cid = Number(obj.metadata?.company_id);
    const co = t && Number.isInteger(cid) ? await env.DB.prepare("SELECT id FROM companies WHERE id = ?").bind(cid).first() : null;
    if (t && co && typeof obj.id === "string") await grantCredits(env, cid, { id: `stripe:${obj.id}`, credits: t.credits, source: "topup", note: `Top-up of ${t.credits}` }, todayLocal());
    if (co && typeof obj.customer === "string") await env.DB.prepare("UPDATE companies SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?").bind(obj.customer, cid).run();
  } else if (type === "checkout.session.completed" && obj.mode === "payment" && obj.metadata?.kind === "site_upgrade" && obj.payment_status === "paid") {
    // A one-click website upgrade was paid. The door comes from our own list; it can only go up.
    const cid = Number(obj.metadata?.company_id);
    if (Number.isInteger(cid)) await applyPaidUpgrade(env, cid, obj.metadata?.door, typeof obj.id === "string" ? obj.id : undefined, { promoCode: typeof obj.metadata?.promo === "string" ? obj.metadata.promo : "", paidCents: Number(obj.amount_total) || 0 });
    if (Number.isInteger(cid) && typeof obj.customer === "string") await env.DB.prepare("UPDATE companies SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?").bind(obj.customer, cid).run();
  } else if (type === "checkout.session.completed" && obj.mode === "payment" && obj.metadata?.kind === "site_grow" && obj.payment_status === "paid") {
    // Steps toward the next door were paid (pay-as-you-grow). The door comes from our own list and can only go up.
    const cid = Number(obj.metadata?.company_id);
    if (Number.isInteger(cid) && typeof obj.id === "string") await applyGrowthSteps(env, cid, obj.metadata?.door, obj.metadata?.steps, obj.id, Number(obj.amount_total) || 0);
    if (Number.isInteger(cid) && typeof obj.customer === "string") await env.DB.prepare("UPDATE companies SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?").bind(obj.customer, cid).run();
  } else if (type === "checkout.session.completed" && obj.mode === "subscription" && obj.metadata?.kind === "allowance") {
    // A monthly allowance started. The first month's credits are added now; later months arrive with each paid invoice (below).
    const a = allowanceById(obj.metadata?.allowance);
    const cid = Number(obj.metadata?.company_id);
    const co = a && Number.isInteger(cid) ? await env.DB.prepare("SELECT id FROM companies WHERE id = ?").bind(cid).first() : null;
    if (a && co && typeof obj.subscription === "string" && typeof obj.id === "string") {
      const today = todayLocal();
      await saveAllowance(env, cid, { allowanceId: a.id, subscriptionId: obj.subscription, status: "active", since: today, lastGrantOn: today });
      await grantCredits(env, cid, { id: `stripe:${obj.id}`, credits: a.credits, source: "allowance", note: `Monthly allowance (${a.credits})` }, today);
      if (typeof obj.customer === "string") await env.DB.prepare("UPDATE companies SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?").bind(obj.customer, cid).run();
    }
  } else if ((type === "invoice.paid" || type === "invoice.payment_succeeded") && invoiceSubscription(obj) && obj.billing_reason === "subscription_cycle") {
    // A renewal of a monthly allowance: add that month's credits once per invoice. The size follows what was paid, so a changed allowance pays out correctly.
    const cid = await companyOfAllowanceSub(env, invoiceSubscription(obj)!);
    const rec = cid ? await loadAllowance(env, cid) : null;
    const a = allowanceByPrice(obj.amount_paid) ?? (rec ? allowanceById(rec.allowanceId) : null);
    if (cid && rec && a && typeof obj.id === "string") {
      const today = todayLocal();
      await grantCredits(env, cid, { id: `stripe:inv:${obj.id}`, credits: a.credits, source: "allowance", note: `Monthly allowance (${a.credits})` }, today);
      await saveAllowance(env, cid, { ...rec, allowanceId: a.id, status: "active", lastGrantOn: today });
    }
    if (typeof obj.customer === "string") await setPastDue(env, "stripe_customer_id", obj.customer, false);
  } else if ((type === "customer.subscription.deleted" || (type === "customer.subscription.updated" && ["unpaid", "canceled", "incomplete_expired"].includes(obj.status))) && typeof obj.id === "string" && obj.metadata?.kind === "allowance") {
    // An allowance ended. Credits already added stay until they expire; no new ones arrive.
    const cid = await companyOfAllowanceSub(env, obj.id);
    const rec = cid ? await loadAllowance(env, cid) : null;
    if (cid && rec) await saveAllowance(env, cid, { ...rec, status: "ended" });
  } else if (type === "customer.subscription.deleted" && typeof obj.id === "string") {
    await env.DB.prepare("UPDATE companies SET plan = 'free' WHERE stripe_subscription_id = ?").bind(obj.id).run();
    await setPastDue(env, "stripe_subscription_id", obj.id, false);
  } else if (type === "customer.subscription.updated" && typeof obj.id === "string" && ["unpaid", "canceled", "incomplete_expired"].includes(obj.status)) {
    // Stripe gave up collecting: drop to the free plan. (past_due alone keeps access while Stripe retries the card.)
    await env.DB.prepare("UPDATE companies SET plan = 'free' WHERE stripe_subscription_id = ?").bind(obj.id).run();
  } else if (type === "invoice.payment_failed" && typeof obj.customer === "string") {
    await setPastDue(env, "stripe_customer_id", obj.customer, true);
  } else if ((type === "invoice.paid" || type === "invoice.payment_succeeded") && typeof obj.customer === "string") {
    await setPastDue(env, "stripe_customer_id", obj.customer, false);
  }
  await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)").bind(event.id, String(event.type).slice(0, 80)).run();
  return json({ ok: true });
}

/** POST /api/billing: a signed-in client gets a Stripe page to update their card or cancel. */
export async function handleBilling(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Billing is not open yet." }, 503);
  const c = await env.DB.prepare("SELECT stripe_customer_id AS id FROM companies WHERE id = ?").bind(user.companyId).first<{ id: string | null }>();
  if (!c?.id) return json({ error: "No billing account is linked to this company yet." }, 404);
  const f = new URLSearchParams({ customer: c.id, return_url: `${new URL(request.url).origin}/jobs` });
  const s = await stripeApi(env, "billing_portal/sessions", f);
  return json({ url: s.url });
}
