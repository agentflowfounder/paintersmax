import test from "node:test";
import assert from "node:assert/strict";
import { groupFor, renderInvoiceHtml, renderListDocHtml, sanitizeInvoice, sanitizeListDoc, starterDoc, workDates } from "../src/jobdocs.ts";
import { computeTotals, sanitizeEstimate } from "../src/estimate.ts";

const ctx = { company: { name: "Tyler Painters" }, customerName: "Hotel Co", jobTitle: "Fence", date: "2026-11-09" };

test("workDates skips Sundays", () => {
  // 2026-11-14 is a Saturday, so the next working day after it is Monday.
  const d = workDates("2026-11-14", 3);
  assert.deepEqual(d.map((x) => x.slice(0, 3)), ["Sat", "Mon", "Tue"]);
  assert.deepEqual(workDates("bad", 2), ["", ""]);
});

test("groupFor maps fencing and remodeling, paint otherwise", () => {
  assert.equal(groupFor("fencing"), "fencing");
  assert.equal(groupFor("decks_fences"), "fencing");
  assert.equal(groupFor("remodeling"), "remodel");
  assert.equal(groupFor("interior"), "paint");
});

test("fence instructions mention calling 811; Spanish starter works", () => {
  const en = starterDoc("instructions", { trade: "fencing", profile: {}, company: "T", customer: "C" }, "en");
  assert.ok(en.items.some((i) => i.text.includes("811")));
  const es = starterDoc("punch", { trade: "interior", profile: {}, company: "T", customer: "C" }, "es");
  assert.equal(es.language, "es");
  assert.ok(es.items.length >= 6);
});

test("schedule starter fills dates from the start date", () => {
  const s = starterDoc("schedule", { trade: "interior", profile: {}, company: "T", customer: "C", startDate: "2026-11-17" }, "en");
  assert.equal(s.items.length, 5);
  assert.ok(s.items[0].detail.startsWith("Tue"));
});

test("warranty uses the profile months and exclusions", () => {
  const w = starterDoc("warranty", { trade: "interior", profile: { warranty: { laborMonths: 24, exclusions: "roof leaks" }, company: { phone: "555" } }, company: "Tyler", customer: "C", completionDate: "Nov 21" }, "en");
  assert.ok(w.items[0].text.includes("24 months"));
  assert.ok(w.items.some((i) => i.text.includes("roof leaks")));
  assert.ok(w.intro.includes("Nov 21"));
});

test("sanitizeListDoc drops empty rows and limits size", () => {
  const d = sanitizeListDoc({ items: [{ text: "ok", qty: "3" }, { text: "" }, { text: "neg", qty: -1 }], language: "es" });
  assert.equal(d.items.length, 2);
  assert.equal(d.items[0].qty, 3);
  assert.equal(d.items[1].qty, 0);
  assert.equal(d.language, "es");
});

test("invoice shows balance after the deposit and escapes text", () => {
  const e = sanitizeEstimate({ lines: [{ description: "Fence", qty: 10, unit: "ft", unitPrice: 100 }] });
  const t = computeTotals(e);
  const inv = sanitizeInvoice({ number: "1001<b>", paid: 300, notes: "<script>x</script>" });
  assert.equal(inv.paidCents, 30000);
  const html = renderInvoiceHtml(ctx, inv, e, t);
  assert.ok(html.includes("$700.00"));
  assert.ok(html.includes("-$300.00"));
  assert.ok(!html.includes("<script>x"));
  assert.ok(!html.includes("1001<b>"));
});

test("list documents render and escape", () => {
  const d = sanitizeListDoc({ intro: "<i>hi</i>", items: [{ text: "<script>1</script>", qty: 2, unit: "gal" }] });
  for (const k of ["materials", "schedule", "instructions", "punch", "warranty"] as const) {
    const html = renderListDocHtml(k, ctx, d);
    assert.ok(!html.includes("<script>1"), k);
    assert.ok(!html.includes("<i>hi</i>"), k);
  }
});

test("materials list groups buy, rent, tools and safety; fence starter has all four", () => {
  const d = starterDoc("materials", { trade: "fencing", profile: {}, company: "T", customer: "C" }, "en");
  const groups = new Set(d.items.map((i) => i.group));
  assert.deepEqual([...groups].sort(), ["material", "rental", "safety", "tool"]);
  const html = renderListDocHtml("materials", ctx, d);
  for (const h of ["Materials to buy", "Rentals to reserve", "Tools to own or bring", "Safety gear and supplies"]) assert.ok(html.includes(h), h);
  assert.equal(sanitizeListDoc({ items: [{ text: "x", group: "bogus" }] }).items[0].group, "material");
});

test("milestone invoice shows the payment, paid to date and what remains", () => {
  const e = sanitizeEstimate({ lines: [{ description: "Fence", qty: 1, unitPrice: 1000 }], schedule: [{ label: "Deposit", pct: 30 }, { label: "Middle", pct: 30 }, { label: "Final", pct: 40 }] });
  const t = computeTotals(e);
  const inv = sanitizeInvoice({ number: "7", milestone: 1, paid: 300 });
  assert.equal(inv.milestone, 1);
  const html = renderInvoiceHtml(ctx, inv, e, t);
  assert.ok(html.includes("Payment 2 of 3: Middle (30%)"));
  assert.ok(html.includes("Amount due now"));
  assert.ok(html.includes("$400.00")); // remaining after this payment
  assert.equal(sanitizeInvoice({ milestone: "" }).milestone, null);
  assert.equal(sanitizeInvoice({}).milestone, null);
});
