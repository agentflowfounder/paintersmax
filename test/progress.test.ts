import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProgress } from "../src/progress.ts";

const none = { companyInfo: false, services: 0, cities: 0, rateCards: 0, insurance: false, brand: false, cityPagePublished: 0, leads: 0, estimatesSent: 0 };

test("new painter: city page step is skipped until a city is chosen, next is company info", () => {
  const p = buildProgress(none);
  assert.equal(p.next?.key, "company");
  assert.equal(p.steps.find((s) => s.key === "cityPage")?.done, true);
  assert.equal(p.total, 9);
});
test("next best step follows order and percent counts done steps", () => {
  const p = buildProgress({ ...none, companyInfo: true, services: 2, cities: 3 });
  assert.equal(p.next?.key, "prices");
  assert.equal(p.done, 3 + 0); // company, services, cities (cityPage not done because a city exists)
  assert.equal(p.percent, Math.round((3 / 9) * 100));
});
test("everything done gives no next step", () => {
  const p = buildProgress({ companyInfo: true, services: 1, cities: 1, rateCards: 1, insurance: true, brand: true, cityPagePublished: 1, leads: 1, estimatesSent: 1 });
  assert.equal(p.percent, 100);
  assert.equal(p.next, null);
});
