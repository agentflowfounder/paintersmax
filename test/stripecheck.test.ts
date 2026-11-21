import test from "node:test";
import assert from "node:assert/strict";
import { NEEDED_EVENTS, checkEndpoint, keyMode, stripeProblems } from "../src/stripecheck.ts";

test("key mode is read from the key prefix", () => {
  assert.equal(keyMode(undefined), "missing");
  assert.equal(keyMode("sk_test_abc"), "test");
  assert.equal(keyMode("rk_live_abc"), "live");
  assert.equal(keyMode("pk_live_abc"), "unknown");
});

test("an endpoint is ours on either webhook address and lists what it misses", () => {
  const a = checkEndpoint({ url: "https://paintersmax.app/api/stripe-webhook", status: "enabled", enabled_events: ["checkout.session.completed", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"] }, "paintersmax.app");
  assert.equal(a.ours, true);
  assert.deepEqual(a.missing, ["checkout.session.async_payment_succeeded", "invoice.paid"]);
  const b = checkEndpoint({ url: "https://paintersmax.app/api/stripe/webhook", enabled_events: ["*"] }, "paintersmax.app");
  assert.equal(b.ours, true);
  assert.deepEqual(b.missing, []);
  assert.equal(checkEndpoint({ url: "https://other.app/api/stripe/webhook", enabled_events: [...NEEDED_EVENTS] }, "paintersmax.app").ours, false);
});

test("problems are plain and empty when all is set", () => {
  const good = { url: "https://paintersmax.app/api/stripe-webhook", status: "enabled", ours: true, missing: [] };
  assert.deepEqual(stripeProblems({ mode: "test", webhookSecret: true, endpoints: [good], lastEventAt: "2026-11-21 10:00:00" }), []);
  const p = stripeProblems({ mode: "test", webhookSecret: false, endpoints: [{ ...good, missing: ["invoice.paid"] }], lastEventAt: null });
  assert.equal(p.length, 3);
  assert.match(p.join(" "), /STRIPE_WEBHOOK_SECRET/);
  assert.match(p.join(" "), /invoice\.paid/);
  assert.match(stripeProblems({ mode: "live", webhookSecret: true, endpoints: [], lastEventAt: "x" })[0], /no webhook pointing/);
});
