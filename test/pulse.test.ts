import test from "node:test";
import assert from "node:assert/strict";
import { buildMonths, monthKeys, pulseHeadline, trend, type PulseInput } from "../src/pulse.ts";

test("monthKeys lists the last months oldest first, across a year change", () => {
  assert.deepEqual(monthKeys("2026-11-14", 3), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(monthKeys("2026-02-03", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(monthKeys("2026-11-14").length, 6);
});

const input: PulseInput = {
  payments: [
    { on: "2026-11-03", cents: 500000 },
    { on: "2026-11-10", cents: 120000 },
    { on: "2026-10-05", cents: 400000 },
    { on: "2026-10-25", cents: 900000 },
  ],
  expenses: [
    { on: "2026-11-02", category: "Materials", cents: 80000 },
    { on: "2026-11-09", category: "Fuel", cents: 15000 },
    { on: "2026-11-09", category: "Vehicle", cents: 5000 },
    { on: "2026-10-04", category: "Materials", cents: 60000 },
    { on: "2026-10-28", category: "Office and software", cents: 3000 },
  ],
  crewPay: [{ on: "2026-11-07", cents: 200000 }, { on: "2026-10-30", cents: 250000 }],
  trips: [{ on: "2026-11-04", miles: 40.25 }, { on: "2026-11-05", miles: 10 }, { on: "2026-10-20", miles: 100 }],
  mileageRateCents: 70,
};

test("buildMonths adds money in, out, profit, materials, vehicle costs and miles per month", () => {
  const [oct, nov] = buildMonths(input, ["2026-10", "2026-11"]);
  assert.equal(nov.moneyInCents, 620000);
  assert.equal(nov.expensesCents, 100000);
  assert.equal(nov.crewPayCents, 200000);
  assert.equal(nov.moneyOutCents, 300000);
  assert.equal(nov.profitCents, 320000);
  assert.equal(nov.materialsCents, 80000);
  assert.equal(nov.vehicleCents, 20000);
  assert.equal(nov.miles, 50.3);
  assert.equal(nov.mileageValueCents, Math.round(50.3 * 70));
  assert.equal(oct.moneyInCents, 1300000);
  assert.equal(oct.moneyOutCents, 63000 + 250000);
  assert.equal(oct.profitCents, 1300000 - 313000);
});

test("last month can be counted only through the same day, so the arrows are fair", () => {
  const [oct] = buildMonths(input, ["2026-10"], 14);
  assert.equal(oct.moneyInCents, 400000); // the $9,000 on the 25th is later than day 14
  assert.equal(oct.expensesCents, 60000);
  assert.equal(oct.crewPayCents, 0);
  assert.equal(oct.miles, 0);
});

test("months with no records are all zero and a missing mileage rate gives no value", () => {
  const [m] = buildMonths({ ...input, mileageRateCents: null }, ["2026-01"]);
  assert.equal(m.moneyInCents, 0);
  assert.equal(m.profitCents, 0);
  assert.equal(m.mileageValueCents, null);
  assert.equal(buildMonths({ ...input, mileageRateCents: null }, ["2026-11"])[0].mileageValueCents, null);
});

test("trend says up, down, same or new, and whether that is good", () => {
  assert.deepEqual(trend(120, 100, true), { dir: "up", pct: 20, good: true });
  assert.deepEqual(trend(80, 100, true), { dir: "down", pct: 20, good: false });
  assert.deepEqual(trend(120, 100, false), { dir: "up", pct: 20, good: false });
  assert.deepEqual(trend(80, 100, false), { dir: "down", pct: 20, good: true });
  assert.deepEqual(trend(100, 100, true), { dir: "same", pct: 0, good: null });
  assert.deepEqual(trend(50, 0, true), { dir: "new", pct: null, good: true });
  assert.deepEqual(trend(0, 0, true), { dir: "none", pct: null, good: null });
  assert.deepEqual(trend(0, 100, true), { dir: "down", pct: 100, good: false });
  assert.deepEqual(trend(5, 4, null), { dir: "up", pct: 25, good: null });
  assert.deepEqual(trend(-50, -100, true), { dir: "up", pct: 50, good: true });
  assert.deepEqual(trend(-200, 100, true), { dir: "down", pct: null, good: false });
  assert.deepEqual(trend(100, -200, true), { dir: "up", pct: null, good: true });
});

test("the headline states real numbers and never invents one", () => {
  const [oct, nov] = buildMonths(input, ["2026-10", "2026-11"]);
  const prev = buildMonths(input, ["2026-10"], 14)[0];
  const en = pulseHeadline(nov, prev);
  assert.match(en, /took in \$6,200/);
  assert.match(en, /\$2,200 more than last month at this point/);
  assert.match(en, /Money out is \$3,000/);
  assert.match(en, /about \$3,200 before your own pay and taxes/);
  const es = pulseHeadline(nov, prev, true);
  assert.match(es, /recibió \$6,200/);
  assert.match(es, /\$2,200 más que el mes pasado/);
  const empty = buildMonths({ payments: [], expenses: [], crewPay: [], trips: [], mileageRateCents: null }, ["2026-11"])[0];
  assert.match(pulseHeadline(empty, empty), /Nothing recorded yet/);
  const loss = { ...nov, moneyInCents: 100000, moneyOutCents: 300000, profitCents: -200000 };
  assert.match(pulseHeadline(loss, oct), /\$2,000 more going out than coming in/);
  assert.match(pulseHeadline(loss, oct, true), /sale \$2,000 más de lo que entra/);
});
