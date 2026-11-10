import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_PRICES, SETUP_FEE_CENTS, checkoutForm, verifyStripeSignature } from "../src/stripe.ts";

async function sign(secret: string, t: number, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("prices match the agreed plans", () => {
  assert.deepEqual(PLAN_PRICES, { starter: 9900, basic: 19900, pro: 34900 });
  assert.equal(SETUP_FEE_CENTS, 49900);
});

test("checkout form has the plan, the setup fee and the customer's details", () => {
  const f = checkoutForm("https://x.app", { plan: "basic", name: "Bright Co", email: "a@b.co" });
  assert.equal(f.get("mode"), "subscription");
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "19900");
  assert.equal(f.get("line_items[0][price_data][recurring][interval]"), "month");
  assert.equal(f.get("line_items[1][price_data][unit_amount]"), "49900");
  assert.equal(f.get("line_items[1][price_data][recurring][interval]"), null);
  assert.equal(f.get("metadata[plan]"), "basic");
  assert.equal(f.get("metadata[company_name]"), "Bright Co");
  assert.equal(f.get("success_url"), "https://x.app/welcome");
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
