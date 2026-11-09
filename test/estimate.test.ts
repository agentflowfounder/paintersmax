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
