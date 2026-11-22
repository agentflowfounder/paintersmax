import test from "node:test";
import assert from "node:assert/strict";
import { handleCheckout, invoiceSubscription, payerFields, verifyStripeSignature } from "../src/stripe.ts";

async function sign(secret: string, t: number, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("the old monthly-plan checkout is retired and points to the free sign-up", async () => {
  const r = await handleCheckout(new Request("https://x.app/api/checkout", { method: "POST", body: "{}" }), {} as any);
  assert.equal(r.status, 410);
  assert.equal((await r.json()).moved, "/start");
});

test("invoices: the subscription is read from the old and the new Stripe shapes", () => {
  assert.equal(invoiceSubscription({ subscription: "sub_1" }), "sub_1");
  assert.equal(invoiceSubscription({ parent: { subscription_details: { subscription: "sub_2" } } }), "sub_2");
  assert.equal(invoiceSubscription({ subscription: { id: "sub_3" } }), "sub_3");
  assert.equal(invoiceSubscription({}), null);
});

test("one-time checkouts always leave a Stripe customer behind", () => {
  const f = new URLSearchParams();
  payerFields(f, "a@b.co", null);
  assert.equal(f.get("customer_email"), "a@b.co");
  assert.equal(f.get("customer_creation"), "always");
  const g = new URLSearchParams();
  payerFields(g, "a@b.co", "cus_1");
  assert.equal(g.get("customer"), "cus_1");
  assert.equal(g.get("customer_email"), null);
  assert.equal(g.get("customer_creation"), null);
});

test("signature check accepts a good signature and rejects bad, old or missing ones", async () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1"}';
  const now = 1_800_000_000;
  const good = await sign(secret, now, body);
  assert.equal(await verifyStripeSignature(body, `t=${now},v1=${good}`, secret, now), true);
  assert.equal(await verifyStripeSignature(body, `t=${now},v1=${"0".repeat(64)},v1=${good}`, secret, now), true); // any v1 may match
  assert.equal(await verifyStripeSignature(body + " ", `t=${now},v1=${good}`, secret, now), false); // body changed
  assert.equal(await verifyStripeSignature(body, `t=${now},v1=${good}`, "whsec_other", now), false);
  assert.equal(await verifyStripeSignature(body, `t=${now},v1=${good}`, secret, now + 301), false); // too old
  assert.equal(await verifyStripeSignature(body, null, secret, now), false);
  assert.equal(await verifyStripeSignature(body, "garbage", secret, now), false);
});

import { handleStripeWebhook } from "../src/stripe.ts";
import { allowanceCheckoutForm, allowanceChangeForm, topUpCheckoutForm } from "../src/creditsapi.ts";
import { ALLOWANCES, TOPUPS, creditView, loadAllowance } from "../src/credits.ts";
import { DatabaseSync } from "node:sqlite";

test("top-up and allowance checkout forms carry the approved prices and the company", () => {
  const t = topUpCheckoutForm("https://x.app", { companyId: 3, email: "a@b.co", topUp: TOPUPS[2] });
  assert.equal(t.get("mode"), "payment");
  assert.equal(t.get("line_items[0][price_data][unit_amount]"), "2000");
  assert.equal(t.get("metadata[kind]"), "topup");
  assert.equal(t.get("metadata[topup]"), "t20");
  assert.equal(t.get("metadata[company_id]"), "3");
  assert.equal(t.get("customer_creation"), "always");
  assert.equal(topUpCheckoutForm("https://x.app", { companyId: 3, email: "a@b.co", topUp: TOPUPS[2], customerId: "cus_7" }).get("customer"), "cus_7");
  const a = allowanceCheckoutForm("https://x.app", { companyId: 3, email: "a@b.co", allowance: ALLOWANCES[1], customerId: null });
  assert.equal(a.get("mode"), "subscription");
  assert.equal(a.get("customer_email"), "a@b.co");
  assert.equal(a.get("line_items[0][price_data][unit_amount]"), "3900");
  assert.equal(a.get("line_items[0][price_data][recurring][interval]"), "month");
  assert.equal(a.get("subscription_data[metadata][kind]"), "allowance");
  const a2 = allowanceCheckoutForm("https://x.app", { companyId: 3, email: "a@b.co", allowance: ALLOWANCES[1], customerId: "cus_1" });
  assert.equal(a2.get("customer"), "cus_1");
  assert.equal(a2.get("customer_email"), null);
  const ch = allowanceChangeForm("si_1", ALLOWANCES[2]);
  assert.equal(ch.get("items[0][price_data][unit_amount]"), "7900");
  assert.equal(ch.get("proration_behavior"), "none");
});

/** A SQLite database shaped like D1, with the tables the webhook touches. */
function webhookEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE usage_counters (company_id INTEGER NOT NULL, feature TEXT NOT NULL, period TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, feature, period));");
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);");
  db.exec("CREATE TABLE companies (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, plan TEXT, stripe_customer_id TEXT, stripe_subscription_id TEXT);");
  db.exec("CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT);");
  db.exec("INSERT INTO companies (id, slug, name, plan) VALUES (3, 'tyler', 'Tyler Painters', 'free');");
  const wrap = (st: any, a: any[]) => ({
    async first() { return (st.get(...a) as any) ?? null; },
    async run() { st.run(...a); return { meta: { changes: 1 } }; },
    async all() { return { results: st.all(...a) }; },
  });
  const DB = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      const bound = (a: any[]) => ({ ...wrap(st, a), _run: () => st.run(...a) });
      return { bind: (...a: any[]) => bound(a), ...wrap(st, []) };
    },
    async batch(stmts: any[]) { for (const s of stmts) await s.run(); return []; },
  };
  return { DB, STRIPE_WEBHOOK_SECRET: "whsec_t" } as any;
}
async function post(env: any, event: any) {
  const body = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  const sig = await sign("whsec_t", now, body);
  return handleStripeWebhook(new Request("https://x.app/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": `t=${now},v1=${sig}` } }), env);
}
const today = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);

test("webhook: a paid top-up adds its credits once, on a free company too", async () => {
  const env = webhookEnv();
  const ev = { id: "evt_t1", type: "checkout.session.completed", data: { object: { id: "cs_t1", mode: "payment", payment_status: "paid", customer: "cus_9", metadata: { kind: "topup", topup: "t20", company_id: "3" } } } };
  assert.equal((await post(env, ev)).status, 200);
  assert.equal((await creditView(env, 3, today())).balance, 220);
  await post(env, { ...ev, id: "evt_t2" }); // Stripe reported the same session again
  assert.equal((await creditView(env, 3, today())).balance, 220);
  const co = await env.DB.prepare("SELECT stripe_customer_id AS c FROM companies WHERE id = 3").first();
  assert.equal(co.c, "cus_9");
  // A size that is not in our list adds nothing.
  await post(env, { id: "evt_t3", type: "checkout.session.completed", data: { object: { id: "cs_t3", mode: "payment", payment_status: "paid", metadata: { kind: "topup", topup: "t999", company_id: "3" } } } });
  assert.equal((await creditView(env, 3, today())).balance, 220);
});

test("webhook: an allowance adds the first month at checkout, each renewal once, follows a size change, and stops when it ends", async () => {
  const env = webhookEnv();
  await post(env, { id: "evt_a1", type: "checkout.session.completed", data: { object: { id: "cs_a1", mode: "subscription", subscription: "sub_1", customer: "cus_1", metadata: { kind: "allowance", allowance: "a39", company_id: "3" } } } });
  assert.equal((await creditView(env, 3, today())).balance, 400);
  assert.deepEqual((await loadAllowance(env, 3))?.allowanceId, "a39");
  // The first invoice (subscription_create) is not counted again.
  await post(env, { id: "evt_i0", type: "invoice.paid", data: { object: { id: "in_0", subscription: "sub_1", customer: "cus_1", amount_paid: 3900, billing_reason: "subscription_create" } } });
  assert.equal((await creditView(env, 3, today())).balance, 400);
  // A renewal adds a month, once.
  await post(env, { id: "evt_i1", type: "invoice.paid", data: { object: { id: "in_1", subscription: "sub_1", customer: "cus_1", amount_paid: 3900, billing_reason: "subscription_cycle" } } });
  await post(env, { id: "evt_i1b", type: "invoice.payment_succeeded", data: { object: { id: "in_1", subscription: "sub_1", customer: "cus_1", amount_paid: 3900, billing_reason: "subscription_cycle" } } });
  assert.equal((await creditView(env, 3, today())).balance, 800);
  // The painter switched to $79: the next paid invoice says so, and the record follows.
  await post(env, { id: "evt_i2", type: "invoice.paid", data: { object: { id: "in_2", subscription: "sub_1", customer: "cus_1", amount_paid: 7900, billing_reason: "subscription_cycle" } } });
  assert.equal((await creditView(env, 3, today())).balance, 1800);
  assert.equal((await loadAllowance(env, 3))?.allowanceId, "a79");
  // A renewal for a subscription we do not know adds nothing.
  await post(env, { id: "evt_i3", type: "invoice.paid", data: { object: { id: "in_3", subscription: "sub_other", customer: "cus_1", amount_paid: 7900, billing_reason: "subscription_cycle" } } });
  assert.equal((await creditView(env, 3, today())).balance, 1800);
  // Cancelled: the record ends, the credits stay.
  await post(env, { id: "evt_d1", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled", metadata: { kind: "allowance" } } } });
  assert.equal((await loadAllowance(env, 3))?.status, "ended");
  assert.equal((await creditView(env, 3, today())).balance, 1800);
  const plan = await env.DB.prepare("SELECT plan FROM companies WHERE id = 3").first();
  assert.equal(plan.plan, "free"); // untouched: an allowance is not a plan
});

test("webhook: an allowance renewal in the new Stripe invoice shape still adds the month", async () => {
  const env = webhookEnv();
  await post(env, { id: "evt_n1", type: "checkout.session.completed", data: { object: { id: "cs_n1", mode: "subscription", subscription: "sub_n", customer: "cus_n", metadata: { kind: "allowance", allowance: "a19", company_id: "3" } } } });
  assert.equal((await creditView(env, 3, today())).balance, 150);
  await post(env, { id: "evt_n2", type: "invoice.paid", data: { object: { id: "in_n2", parent: { type: "subscription_details", subscription_details: { subscription: "sub_n" } }, customer: "cus_n", amount_paid: 1900, billing_reason: "subscription_cycle" } } });
  assert.equal((await creditView(env, 3, today())).balance, 300);
});

test("webhook: a bank payment adds the top-up when the money arrives, not before", async () => {
  const env = webhookEnv();
  const obj = { id: "cs_b1", mode: "payment", customer: "cus_b", metadata: { kind: "topup", topup: "t20", company_id: "3" } };
  await post(env, { id: "evt_b1", type: "checkout.session.completed", data: { object: { ...obj, payment_status: "unpaid" } } });
  assert.equal((await creditView(env, 3, today())).balance, 0);
  await post(env, { id: "evt_b2", type: "checkout.session.async_payment_succeeded", data: { object: { ...obj, payment_status: "paid" } } });
  assert.equal((await creditView(env, 3, today())).balance, 220);
  await post(env, { id: "evt_b3", type: "checkout.session.async_payment_succeeded", data: { object: { ...obj, payment_status: "paid" } } });
  assert.equal((await creditView(env, 3, today())).balance, 220);
});
