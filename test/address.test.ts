import assert from "node:assert/strict";
import { test } from "node:test";
import { placesAllowed, PLACES_DAILY_DEFAULT } from "../src/address.ts";
import { cleanBid } from "../src/services.ts";

test("Free uses our own city list, paid plans use Google until the daily allowance is used", () => {
  assert.equal(placesAllowed("free", 0, 150), "plan");
  assert.equal(placesAllowed("starter", 0, 150), "ok");
  assert.equal(placesAllowed("pro", 149, 150), "ok");
  assert.equal(placesAllowed("basic", 150, 150), "limit");
  assert.ok(PLACES_DAILY_DEFAULT > 0);
});

test("the painter's own price is kept on the bid, and bad numbers are dropped", () => {
  assert.equal(cleanBid({ picks: [], tools: [], myPriceCents: 450000 }, "interior").myPriceCents, 450000);
  assert.equal(cleanBid({ myPriceCents: -5 }, "interior").myPriceCents, undefined);
  assert.equal(cleanBid({ myPriceCents: "abc" }, "interior").myPriceCents, undefined);
});
