import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeFor } from "../src/crm.ts";

test("trade names come from job types and service text", () => {
  assert.equal(tradeFor("interior"), "interior");
  assert.equal(tradeFor("both"), "interior");
  assert.equal(tradeFor("multifamily"), "commercial");
  assert.equal(tradeFor("Exterior Painting"), "exterior");
  assert.equal(tradeFor("Pressure Washing"), "power_washing");
  assert.equal(tradeFor("Cabinet Painting"), "cabinets");
  assert.equal(tradeFor(undefined), "interior");
});
