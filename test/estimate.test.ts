import test from "node:test";
import assert from "node:assert/strict";
import { computeTotals, draftLines, renderEstimateHtml, sanitizeEstimate } from "../src/estimate.ts";

test("sanitizeEstimate keeps valid lines and drops junk", () => {
  const e = sanitizeEstimate({
    lines: [{ description: "Fence", qty: "940", unit: "ft", unitPrice: "42.5" }, { description: "", qty: 1, unitPrice: 5 }, { description: "Bad", qty: -3, unitPrice: "abc" }],
    taxPct: 99,
    language: "es",
  });
  assert.equal(e.lines.length, 2);
  assert.equal(e.lines[0].unitCents, 4250);
  assert.equal(e.lines[1].qty, 1); // negative falls back
  assert.equal(e.lines[1].unitCents, 0);
  assert.equal(e.taxPct, 0); // out of range
  assert.equal(e.language, "es");
});

test("computeTotals: minimum job, discount, tax and deposit in cents", () => {
  const e = sanitizeEstimate({ lines: [{ description: "Paint", qty: 1, unit: "ea", unitPrice: 300 }], taxPct: 8.25, discount: 50 });
  const t = computeTotals(e, { minimumJobCents: 50000, depositPct: 30 });
  assert.equal(t.subtotalCents, 30000);
  assert.equal(t.minimumTopUpCents, 20000);
  assert.equal(t.discountCents, 5000);
  assert.equal(t.taxCents, Math.round((45000 * 8.25) / 100));
  assert.equal(t.totalCents, 45000 + t.taxCents);
  assert.equal(t.depositCents, Math.round(t.totalCents * 0.3));
});

test("computeTotals: discount can never exceed the job", () => {
  const e = sanitizeEstimate({ lines: [{ description: "A", qty: 1, unitPrice: 100 }], discount: 5000 });
  assert.equal(computeTotals(e).totalCents, 0);
});

test("draftLines builds fence lines from a linear-foot card", () => {
  const lines = draftLines("per_linear_ft", { low: 30, high: 40, gate_each: 250 }, { linear_ft: 940, gate_each: 2 }, "fencing");
  assert.equal(lines[0].qty, 940);
  assert.equal(lines[0].unitCents, 3500);
  assert.equal(lines[1].description, "Gate");
  assert.equal(lines[1].qty, 2);
});

test("draftLines: room size card ignores percent surcharges and unknown keys", () => {
  const lines = draftLines("room_size", { small: 150, medium: 250, high_ceiling_pct: 15, hacker: 9 }, { medium: 3, high_ceiling_pct: 1, hacker: 2 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 3);
  assert.equal(lines[0].unitCents, 25000);
});

test("renderEstimateHtml escapes customer and painter text", () => {
  const e = sanitizeEstimate({ lines: [{ description: "<script>alert(1)</script>", qty: 1, unitPrice: 10 }], scope: "<img src=x onerror=1>" });
  const html = renderEstimateHtml(
    { company: { name: "A & B <Co>" }, customer: { name: "<b>Bob</b>" }, jobTitle: "J", date: "2026-11-09", brandColor: "red;}</style><script>" },
    e,
    computeTotals(e),
  );
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<b>Bob</b>"));
  assert.ok(html.includes("A &amp; B &lt;Co&gt;"));
  assert.ok(!html.includes("red;}"));
});

import { defaultClauses, renderContractHtml, sanitizeContract } from "../src/contract.ts";

test("defaultClauses fills price, deposit, warranty and brands; Spanish works", () => {
  const e = sanitizeEstimate({ lines: [{ description: "Fence", qty: 940, unit: "ft", unitPrice: 35 }] });
  const t = computeTotals(e, { depositPct: 30 });
  const ctx = { company: "Tyler Painters", customer: "Hotel Co", property: "1 Main St", scope: "", totals: t, startDate: "", endDate: "", profile: { warranty: { laborMonths: 12 }, materials: { brands: ["Sherwin-Williams"] }, labor: { paymentTerms: "net 10" } } };
  const en = defaultClauses(ctx, "en");
  const price = en.find((c) => c.title === "Price and payment")!;
  assert.ok(price.body.includes("$32,900.00") && price.body.includes("$9,870.00") && price.body.includes("net 10"));
  assert.ok(en.find((c) => c.title === "Warranty")!.body.includes("12 months"));
  assert.ok(en.some((c) => c.title === "Materials"));
  const es = defaultClauses(ctx, "es");
  assert.ok(es.find((c) => c.title === "Garantía")!.body.includes("12 meses"));
});

test("sanitizeContract limits clauses and renderContractHtml escapes", () => {
  const c = sanitizeContract({ clauses: Array.from({ length: 30 }, (_, i) => ({ title: `T${i}`, body: "<script>x</script>" })), language: "es" });
  assert.equal(c.clauses.length, 20);
  const e = sanitizeEstimate({ lines: [{ description: "A", qty: 1, unitPrice: 1 }] });
  const html = renderContractHtml({ company: { name: "Co" }, customerName: "<i>Bo</i>", jobTitle: "J", date: "d" }, c, e, computeTotals(e));
  assert.ok(!html.includes("<script>x"));
  assert.ok(!html.includes("<i>Bo</i>"));
  assert.ok(html.includes("Contrato de Trabajo"));
});

import { milestoneAmounts, scheduleIsValid } from "../src/estimate.ts";

test("milestones add up exactly and the first one is the deposit", () => {
  const e = sanitizeEstimate({ lines: [{ description: "A", qty: 1, unitPrice: 62800 }], schedule: [{ label: "Deposit", pct: 30 }, { label: "Posts", pct: 30 }, { label: "Pickets", pct: 30 }, { label: "Final", pct: 10 }] });
  const t = computeTotals(e, { depositPct: 50 });
  assert.deepEqual(milestoneAmounts(t.totalCents, e.schedule), [1884000, 1884000, 1884000, 628000]);
  assert.equal(t.depositCents, 1884000); // schedule wins over the profile's deposit percentage
  const odd = milestoneAmounts(10001, [{ label: "a", pct: 33.33 }, { label: "b", pct: 33.33 }, { label: "c", pct: 33.34 }]);
  assert.equal(odd.reduce((s, v) => s + v, 0), 10001);
  assert.equal(scheduleIsValid(e.schedule), true);
  assert.equal(scheduleIsValid([{ label: "a", pct: 60 }, { label: "b", pct: 30 }]), false);
  assert.equal(scheduleIsValid([]), true);
});

test("sanitizeEstimate turns multi-line text into short lists", () => {
  const e = sanitizeEstimate({ exclusions: "Gates\n\n  Permits  \n" + "x".repeat(500), inclusions: ["Labor", ""] });
  assert.equal(e.exclusions.length, 3);
  assert.equal(e.exclusions[2].length, 300);
  assert.deepEqual(e.inclusions, ["Labor"]);
});

test("contract lists the milestones, inclusions and exclusions from the estimate", () => {
  const e = sanitizeEstimate({ lines: [{ description: "A", qty: 1, unitPrice: 1000 }], schedule: [{ label: "Deposit at signing", pct: 50 }, { label: "Final", pct: 50 }], exclusions: ["The gates"], inclusions: ["All labor"], assumptions: ["Clear access"] });
  const t = computeTotals(e);
  const clauses = defaultClauses({ company: "T", customer: "C", property: "", scope: "", totals: t, startDate: "", endDate: "", profile: {}, estimate: e }, "en");
  const price = clauses.find((c) => c.title === "Price and payment")!.body;
  assert.ok(price.includes("1. Deposit at signing: $500.00 (50%)") && price.includes("2. Final: $500.00 (50%)"));
  assert.ok(clauses.find((c) => c.title === "What is not included")!.body.includes("The gates"));
  assert.ok(clauses.some((c) => c.title === "Assumptions"));
});
