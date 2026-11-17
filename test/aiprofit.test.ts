import test from "node:test";
import assert from "node:assert/strict";
import { marginPct, readProfit } from "../src/aimeter.ts";

test("margin on credits is revenue less AI cost, as a percent of revenue", () => {
  assert.equal(marginPct(100, 10, 200), 80); // 100 credits at 10 cents = $10, cost $2
  assert.equal(marginPct(100, 10, 1000), 0);
  assert.equal(marginPct(100, 10, 1500), -50);
});
test("no margin when nothing was spent, nothing is earned per credit, or a model has no price", () => {
  assert.equal(marginPct(0, 10, 5), null);
  assert.equal(marginPct(100, 0, 5), null);
  assert.equal(marginPct(100, 10, null), null);
});
test("profit settings reject nonsense", () => {
  assert.deepEqual(readProfit({ centsPerCredit: 10, targetMarginPct: 70 }), { centsPerCredit: 10, targetMarginPct: 70 });
  assert.deepEqual(readProfit({ centsPerCredit: -1, targetMarginPct: 120 }), { centsPerCredit: 0, targetMarginPct: 0 });
  assert.deepEqual(readProfit(null), { centsPerCredit: 0, targetMarginPct: 0 });
});
