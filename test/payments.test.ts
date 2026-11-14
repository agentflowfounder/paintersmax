import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPayment, looksLikeAccountNumber, paymentLine, readPayments, sumPaid, CUSTOMER_PAY_METHODS } from "../src/payments.ts";
import { renderInvoiceHtml, sanitizeInvoice } from "../src/jobdocs.ts";

const TODAY = "2026-11-14";

test("every way people really pay is a choice", () => {
  for (const m of ["cash", "check", "zelle", "cash_app", "venmo", "paypal", "bank_deposit", "card_outside", "other"]) assert.ok((CUSTOMER_PAY_METHODS as readonly string[]).includes(m), m);
});

test("a payment is cleaned: dollars to cents, date defaults to today, unknown method becomes other", () => {
  const p = cleanPayment({ amount: "$1,250.50", method: "bitcoin", kind: "deposit", ref: "1042", on: "2026-11-10" }, TODAY);
  assert.ok(!("error" in p));
  if ("error" in p) return;
  assert.equal(p.cents, 125050);
  assert.equal(p.method, "other");
  assert.equal(p.on, "2026-11-10");
  assert.equal(cleanPayment({ amount: 5 }, TODAY).hasOwnProperty("error"), false);
  assert.equal((cleanPayment({ amount: 5, on: "nope" }, TODAY) as any).on, TODAY);
});

test("bad amounts are refused with a plain message", () => {
  for (const a of ["", "abc", 0, -5, 2_000_000]) assert.ok("error" in (cleanPayment({ amount: a }, TODAY) as any), String(a));
});

test("we never store a full bank, routing or card number", () => {
  assert.equal(looksLikeAccountNumber("021000021"), true);
  assert.equal(looksLikeAccountNumber("4111 1111 1111 1111"), true);
  assert.equal(looksLikeAccountNumber("1234-5678-90"), true);
  assert.equal(looksLikeAccountNumber("check 1042"), false);
  assert.equal(looksLikeAccountNumber("card ending 4242"), false);
  const e = cleanPayment({ amount: 10, ref: "routing 021000021" }, TODAY) as any;
  assert.match(e.error, /never stores/);
  assert.ok("error" in (cleanPayment({ amount: 10, note: "acct 123456789012" }, TODAY) as any));
  assert.equal("error" in (cleanPayment({ amount: 10, note: "Zelle from 555-123-4567" }, TODAY) as any), false);
  assert.equal(looksLikeAccountNumber("Zelle to 555-123-4567", 12), false);
  assert.equal(looksLikeAccountNumber("card 4111 1111 1111 1111", 12), true);
});

test("saved payments are read back safely and added up in code", () => {
  const raw = JSON.stringify([{ id: "a1", on: "2026-11-01", cents: 50000, method: "check", ref: "7", kind: "deposit", note: "", at: "x" }, { on: "bad", cents: 5 }, { on: "2026-11-02", cents: 1.5 }, { on: "2026-11-03", cents: 25000, method: "zzz" }]);
  const list = readPayments(raw);
  assert.equal(list.length, 2);
  assert.equal(sumPaid(list), 75000);
  assert.equal(list[1].method, "other");
  assert.deepEqual(readPayments("not json"), []);
});

test("timeline line reads like a person wrote it", () => {
  assert.equal(paymentLine({ id: "a", on: TODAY, cents: 50000, method: "check", ref: "1042", kind: "deposit", note: "", at: "" }), "Payment received: $500.00 by check #1042 (deposit)");
  assert.equal(paymentLine({ id: "a", on: TODAY, cents: 1999, method: "cash_app", ref: "", kind: "other", note: "", at: "" }), "Payment received: $19.99 by CashApp");
});

test("the invoice carries the painter's How to pay note, in both layouts", () => {
  const inv = sanitizeInvoice({ number: "1001", paid: 0, howToPay: "Zelle to 555-123-4567\nChecks payable to Tyler Painters", language: "en" });
  assert.match(inv.howToPay, /Zelle/);
  const ctx: any = { company: { name: "Tyler Painters", email: "t@x.com" }, customerName: "Sam", jobTitle: "Fence", property: "", date: "2026-11-14", brandColor: "#0F1B2D" };
  const est: any = { lines: [{ description: "Fence", qty: 1, unit: "ea", unitCents: 100000 }], schedule: [], scope: "", discountCents: 0, taxPct: 0, validDays: 30, language: "en", notes: "" };
  const totals: any = { subtotalCents: 100000, discountCents: 0, taxCents: 0, totalCents: 100000, depositCents: 0, minimumTopUpCents: 0 };
  const html = renderInvoiceHtml(ctx, inv, est, totals);
  assert.match(html, /How to pay/);
  assert.match(html, /Zelle to 555-123-4567/);
  assert.equal(sanitizeInvoice({ number: "1" }).howToPay, "");
  assert.doesNotMatch(renderInvoiceHtml(ctx, sanitizeInvoice({ number: "1" }), est, totals), /How to pay/);
});
