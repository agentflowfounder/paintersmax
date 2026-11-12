import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSheet, sheetSections, SHEET_LIMIT } from "../src/ratesheets.ts";
import { catalogItems, seedData } from "../src/ratecatalog.ts";
import { renderRateCardHtml } from "../src/ratecardpdf.ts";

const items = catalogItems("builder");
const base = seedData("builder", 1, 1);

test("plan limits: none for Free and Starter, one for Basic, unlimited for Pro", () => {
  assert.equal(SHEET_LIMIT.free, 0);
  assert.equal(SHEET_LIMIT.starter, 0);
  assert.equal(SHEET_LIMIT.basic, 1);
  assert.equal(SHEET_LIMIT.pro, Number.POSITIVE_INFINITY);
});

test("cleanSheet keeps only valid values", () => {
  const c = cleanSheet({
    name: "  ABC Homes  ", detail: "detailed", adjustPct: 99, validDays: 9999,
    overrides: { [items[0].id]: "12.5", nonsense: 5, [items[1].id]: -3 },
    hidden: [items[2].id, "bogus"], sections: { insurance: true }, terms: "Net 30", preparedWith: "off", evil: "x",
  });
  assert.equal(c.name, "ABC Homes");
  assert.equal(c.detail, "detailed");
  assert.equal(c.adjustPct, 30);
  assert.equal(c.validDays, 30);
  assert.deepEqual(c.overrides, { [items[0].id]: 12.5 });
  assert.deepEqual(c.hidden, [items[2].id]);
  assert.deepEqual(c.sections, { terms: true, insurance: true, warranty: false });
  assert.equal(c.preparedWith, "off");
  assert.ok(!("evil" in c));
  assert.equal(cleanSheet({}).name, "Builder");
  assert.equal(cleanSheet({ detail: "weird" }).detail, "standard");
});

test("each builder sheet applies its own adjustment, override and hidden lines", () => {
  const a = sheetSections(base, { adjustPct: 0, overrides: {}, hidden: [], detail: "standard" });
  const b = sheetSections(base, { adjustPct: -10, overrides: { [items[0].id]: 1 }, hidden: [items[1].id], detail: "standard" });
  const flat = (s: typeof a) => s[0].groups.flatMap((g) => g.rows);
  assert.equal(flat(a).length, items.length);
  assert.equal(flat(b).length, items.length - 1);
  assert.equal(flat(b)[0].price, 1);
  assert.ok(flat(b)[1].price < flat(a)[2].price + 0.01);
  assert.equal(flat(a).filter((r) => r.note).length, 0, "notes only at the detailed level");
  const d = sheetSections(base, { adjustPct: 0, overrides: {}, hidden: [], detail: "detailed" });
  assert.ok(flat(d).some((r) => r.note));
});

test("unpriced builder lines are left off and blocks render escaped", () => {
  const s = sheetSections({}, { adjustPct: 0, overrides: {}, hidden: [], detail: "standard" });
  assert.deepEqual(s, []);
  const html = renderRateCardHtml({ company: { name: "Co" }, title: "Rates for <X>", date: "d", preparedWith: false, blocks: [{ title: "Terms", text: "<b>Net 30</b>" }] }, s);
  assert.ok(html.includes("Rates for &lt;X&gt;"));
  assert.ok(html.includes("&lt;b&gt;Net 30&lt;/b&gt;"));
});
