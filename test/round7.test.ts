import test from "node:test";
import assert from "node:assert/strict";
import { geminiSseTexts } from "../src/assistant.ts";
import { bidHistory, compareJobs, projectMargin } from "../src/bidcheck.ts";
import { cleanPrice, cleanVendor, shouldAskPriceList } from "../src/vendors.ts";
import { asWordDoc, cleanSummary, customerHtml, draftSummary, privateHtml, type View } from "../src/jobsummary.ts";
import type { JobFacts } from "../src/analysis.ts";

const fact = (o: Partial<JobFacts>): JobFacts => ({ id: 1, trade: "interior", stage: "closed", city: "", createdAt: "2026-10-01", lostReason: "", startOn: "2026-10-05", endOn: "2026-10-08", won: true, soldCents: 400000, changeCents: 0, expenseCents: 80000, materialsCents: 60000, payCents: 160000, minutes: 40 * 60, workers: 2, miles: 0, ...o });

test("Ask streaming reads Gemini server-sent events and skips half lines", () => {
  const body = 'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":"painter"}]}}]}\n\ndata: {"cand';
  assert.deepEqual(geminiSseTexts(body), ["Hello ", "painter"]);
  assert.deepEqual(geminiSseTexts(""), []);
});

test("bid check averages the last 10 finished jobs and ignores jobs without costs", () => {
  const facts = [fact({ id: 1 }), fact({ id: 2, soldCents: 200000, expenseCents: 0, payCents: 0 }), fact({ id: 3, won: false })];
  const h = bidHistory(facts);
  assert.equal(h.jobs, 1);
  assert.equal(h.avgMarginPct, 40); // (4000 - 800 - 1600) / 4000
  assert.equal(h.avgPricePerHourCents, 10000); // $4000 over 40 h
  assert.equal(h.avgCrewCostPerHourCents, 4000);
  assert.equal(h.avgMaterialsPct, 15);
  assert.equal(bidHistory([]).jobs, 0);
  const many = Array.from({ length: 14 }, (_, i) => fact({ id: i + 1 }));
  assert.equal(bidHistory(many).jobs, 10);
});

test("projected margin uses the cost build first, then the painter's own history", () => {
  const h = bidHistory([fact({})]);
  assert.deepEqual(projectMargin({ totalCents: 100000, hours: 0, costBuildCents: 70000 }, h), { marginPct: 30, basis: "cost_build" });
  const p = projectMargin({ totalCents: 300000, hours: 30 }, h); // crew 30h*$40 = $1200, materials 15% = $450
  assert.equal(p?.basis, "history");
  assert.equal(p?.marginPct, 45);
  assert.equal(projectMargin({ totalCents: 300000, hours: 0 }, h), null);
  assert.equal(projectMargin({ totalCents: 0, hours: 5 }, h), null);
});

test("compare my jobs groups profit by service and month", () => {
  const out = compareJobs([fact({ id: 1 }), fact({ id: 2, trade: "exterior", endOn: "2026-11-02", soldCents: 500000, expenseCents: 400000, payCents: 200000 })]);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].id, 2);
  assert.equal(out.rows[0].marginPct, -20);
  assert.deepEqual(out.byMonth.map((m) => m.key), ["2026-10", "2026-11"]);
  assert.equal(out.byService[0].key, "interior");
});

test("vendors keep only the last 4 of an account number and need a name", () => {
  const v = cleanVendor({ kind: "sherwin_williams", accountLast4: "12-3456-789", discountPct: "12.5", repEmail: "bad" });
  assert.ok(!("error" in v));
  if (!("error" in v)) {
    assert.equal(v.name, "Sherwin-Williams");
    assert.equal(v.accountLast4, "6789");
    assert.equal(v.discountPct, 12.5);
    assert.equal(v.repEmail, "");
  }
  assert.ok("error" in cleanVendor({ kind: "other", name: " " }));
  assert.equal(cleanPrice({ product: "Duration satin", price: "$58.99" })?.priceCents, 5899);
  assert.equal(cleanPrice({ product: "", price: 10 }), null);
  assert.equal(cleanPrice({ product: "x", price: -1 }), null);
});

test("customer price lists are asked about only when they fit", () => {
  const base = { trade: "interior", optOut: false, customerVendors: 0 };
  assert.equal(shouldAskPriceList({ ...base, customerName: "Maria Lopez" }), null);
  assert.ok(shouldAskPriceList({ ...base, customerName: "Texas Department of Transportation" }));
  assert.ok(shouldAskPriceList({ ...base, customerName: "Lone Star Builders LLC" }));
  assert.ok(shouldAskPriceList({ ...base, customerName: "Maria Lopez", trade: "commercial" }));
  assert.equal(shouldAskPriceList({ ...base, customerName: "Lone Star Builders LLC", optOut: true }), null);
});

const view: View = {
  company: { name: "Tyler Painters", phone: "(903) 555-0100", email: "hi@example.com", license: "", website: "", logoUrl: "", color: "#0F1B2D" },
  customer: { name: "Ana Torres", email: "ana@example.com" },
  job: { id: 7, title: "Interior repaint", trade: "interior", address: "1 Elm St, Tyler, TX 75701", start: "2026-11-02", end: "2026-11-04", daysOnSite: 3 },
  colors: [{ where: "Living room", brand: "Sherwin-Williams", code: "SW 7008", name: "Alabaster", hex: "#EDEAE0" }],
  photos: 4,
  cert: { months: 24, startOn: "2026-11-04", endOn: "2028-11-04", terms: "Covers peeling caused by our work." },
};

test("the customer job summary shows colors and both warranties, and never money", () => {
  const d = draftSummary(view);
  assert.match(d.painterWarranty, /24 months/);
  assert.match(d.products, /Sherwin-Williams/);
  assert.equal(d.makerWarranty, "", "never writes a maker's warranty for the painter");
  const html = customerHtml(view, { ...d, makerWarranty: "Lifetime limited warranty", makerLink: "https://example.com/w" });
  assert.match(html, /Alabaster/);
  assert.match(html, /SW 7008/);
  assert.match(html, /Lifetime limited warranty/);
  assert.match(html, /3 days on site/);
  assert.doesNotMatch(html, /\$\d/);
  const s = cleanSummary({ makerLink: "javascript:alert(1)", products: "x" });
  assert.equal(s.makerLink, "");
  assert.equal(s.status, "draft");
});

test("the private record shows the numbers and a Word copy drops the print button", () => {
  const html = privateHtml(view, { priceCents: 400000, changeCents: 0, totalCents: 400000, collectedCents: 400000, balanceCents: 0, materialsCents: 60000, otherExpenseCents: 20000, payCents: 160000, profitCents: 160000, marginPct: 40, hours: 40, categories: [{ category: "Materials", cents: 60000 }], savedOn: "2026-11-24" }, { toolbar: true });
  assert.match(html, /PRIVATE/);
  assert.match(html, /\$1,600\.00/);
  assert.match(html, /40%/);
  const doc = asWordDoc(html);
  assert.doesNotMatch(doc, /<div class="noprint">/);
  assert.match(doc, /schemas-microsoft-com:office:word/);
});

test("job results add ways to keep more and a word of encouragement", async () => {
  const { buildReport } = await import("../src/jobreport.ts");
  const r = buildReport({
    priceCents: 400000, changeCents: 0, collectedCents: 0, categories: [{ category: "Materials", cents: 160000 }], payCents: 200000, minutes: 3000, estimatedMinutes: 2000, workers: [],
    dates: { lead: "", estimate: "", signed: "", start: "", end: "", invoice: "", paid: "", warranty: "" },
    have: { photos: 0, notes: 0, signedEstimate: true, contract: false, expenses: 1, hours: true, invoice: false, warranty: false, signoff: false },
    avg: { marginPct: null, priceCents: null, jobs: 0 },
  });
  assert.ok(r.tips.some((t) => /Sherwin-Williams/.test(t)));
  assert.ok(r.tips.some((t) => /Hours/.test(t)));
  assert.ok(r.cheer.length > 10);
  assert.equal(r.records.length, 10);
});
