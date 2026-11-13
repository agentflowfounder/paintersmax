import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnalysis, seasonOf, suggestions, type JobFacts } from "../src/analysis.ts";

const j = (o: Partial<JobFacts>): JobFacts => ({ id: 1, trade: "interior", stage: "closed", city: "Tyler", createdAt: "2026-03-10", lostReason: "", startOn: "", endOn: "", won: true, soldCents: 100000, changeCents: 0, expenseCents: 0, materialsCents: 0, payCents: 0, minutes: 0, workers: 0, miles: 0, ...o });

test("seasons", () => {
  assert.equal(seasonOf(12), "Winter");
  assert.equal(seasonOf(4), "Spring");
  assert.equal(seasonOf(7), "Summer");
  assert.equal(seasonOf(10), "Fall");
});
test("funnel and win rate count only decided jobs", () => {
  const a = buildAnalysis([j({ id: 1 }), j({ id: 2 }), j({ id: 3, won: false, stage: "lost", lostReason: "price" }), j({ id: 4, won: false, stage: "lead" })]);
  assert.deepEqual(a.funnel, { jobs: 4, won: 2, lost: 1, open: 1, winRatePct: 66.7 });
  assert.deepEqual(a.lostReasons, { price: 1 });
  assert.equal(buildAnalysis([]).funnel.winRatePct, null);
});
test("sales by year, month, season, city include approved change orders", () => {
  const a = buildAnalysis([j({ id: 1, soldCents: 100000, changeCents: 20000, startOn: "2026-07-05", city: "Tyler" }), j({ id: 2, soldCents: 50000, createdAt: "2025-12-02", city: "Dallas" }), j({ id: 3, won: false, stage: "lead", soldCents: 999 })]);
  assert.equal(a.totals.revenueCents, 170000);
  assert.equal(a.salesByYear["2026"], 120000);
  assert.equal(a.salesByYear["2025"], 50000);
  assert.equal(a.salesBySeason.Summer, 120000);
  assert.equal(a.salesBySeason.Winter, 50000);
  assert.equal(a.salesByCity.Dallas, 50000);
});
test("profit per job and per service uses expenses and crew payments", () => {
  const a = buildAnalysis([j({ id: 1, soldCents: 100000, expenseCents: 20000, payCents: 30000 }), j({ id: 2, trade: "exterior", soldCents: 200000, expenseCents: 150000 }), j({ id: 3, soldCents: 10000 })]);
  assert.equal(a.profit.byTrade.interior.profitCents, 100000 + 10000 - 50000);
  assert.equal(a.profit.byTrade.exterior.marginPct, 25);
  assert.deepEqual(a.profit.topJobs.map((x) => x.id), [1, 2]); // job 3 has no recorded costs, so it is not ranked
});
test("revenue per labor hour by crew size", () => {
  const a = buildAnalysis([j({ id: 1, soldCents: 80000, minutes: 600, workers: 1 }), j({ id: 2, soldCents: 120000, minutes: 600, workers: 3 })]);
  assert.equal(a.productivity.revenuePerHourCents, 10000);
  assert.equal(a.productivity.byCrewSize["1"].revenuePerHourCents, 8000);
  assert.equal(a.productivity.byCrewSize["3-4"].revenuePerHourCents, 12000);
});
test("suggestions only ask for what is missing", () => {
  const full = [j({ startOn: "2026-01-01", endOn: "2026-01-03", minutes: 60, expenseCents: 10, miles: 5 })];
  const keys = (x: JobFacts[]) => suggestions(x).map((s) => s.key);
  assert.ok(!keys(full).includes("dates") && !keys(full).includes("hours") && !keys(full).includes("expenses") && !keys(full).includes("miles"));
  assert.ok(keys([j({})]).slice(0, 4).join() === "dates,hours,expenses,miles");
  assert.ok(suggestions([j({})]).length <= 6);
});
