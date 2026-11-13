import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreview, exampleQty } from "../src/estimate-preview.ts";
import { catalogItems } from "../src/ratecatalog.ts";

const priced = (key: string) => Object.fromEntries(catalogItems(key).map((i) => [i.id, (i.low + i.high) / 2]));

test("example needs every price in it", () => {
  const d = priced("interior");
  assert.ok(exampleQty("interior", d));
  const it = catalogItems("interior").find((i) => i.label.startsWith("Standard Bedroom"))!;
  assert.equal(exampleQty("interior", { ...d, [it.id]: 0 }), null);
});
test("preview totals use the painter's prices, minimum job and deposit", () => {
  const d = priced("interior");
  const bed = catalogItems("interior").find((i) => i.label.startsWith("Standard Bedroom"))!;
  const p = buildPreview("interior", "retail", d, { minimumJob: 0, depositPct: 50 }, "Interior painting")!;
  assert.equal(p.lines.length, 1);
  assert.equal(p.totals.totalCents, Math.round(d[bed.id] * 100));
  assert.equal(p.totals.depositCents, Math.round(p.totals.totalCents / 2));
  const m = buildPreview("interior", "retail", d, { minimumJob: 5000 }, "x")!;
  assert.equal(m.totals.totalCents, 500000);
  assert.ok(m.totals.minimumTopUpCents > 0);
});
test("no preview without a catalog list", () => {
  assert.equal(buildPreview("drywall", "retail", {}, {}, "x"), null);
});
