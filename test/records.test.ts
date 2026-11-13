import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize, cleanExpense, cleanSettings, csvEscape, parseBankCsv, parseCsv, parseDateAny, parseMoneyCents, summarize, toCsv, vendorKey, mileageValueCents } from "../src/records.ts";

test("categorize uses saved rules first, then hints", () => {
  assert.equal(categorize("SHERWIN-WILLIAMS #7012", {}), "Materials");
  assert.equal(categorize("QT 1234 TYLER TX", {}), "Fuel");
  assert.equal(categorize("Joe's Paint Supply", { [vendorKey("joe's paint")]: "Supplies" }), "Supplies");
  assert.equal(categorize("Unknown Shop", {}), "Other");
});
test("cleanExpense validates", () => {
  assert.ok("error" in (cleanExpense({ amountCents: 0, spentOn: "2026-01-01" }) as any));
  assert.ok("error" in (cleanExpense({ amountCents: 100, spentOn: "01/01/2026" }) as any));
  const e: any = cleanExpense({ amountCents: 1234.4, spentOn: "2026-03-05", vendor: " Home Depot ", category: "", jobId: "7" });
  assert.equal(e.amountCents, 1234);
  assert.equal(e.vendor, "Home Depot");
  assert.equal(e.category, "Other");
  assert.equal(e.jobId, 7);
});
test("csv escape blocks formulas and quotes", () => {
  assert.equal(csvEscape("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvEscape("-120.50"), "-120.50");
  assert.equal(csvEscape("-cmd|calc"), "'-cmd|calc");
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
  assert.equal(toCsv([["a", "b"], ["1", "x,y"]]), 'a,b\r\n1,"x,y"\r\n');
});
test("parseCsv handles quotes and newlines", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
});
test("money and dates", () => {
  assert.equal(parseMoneyCents("$1,234.50"), 123450);
  assert.equal(parseMoneyCents("(12.00)"), -1200);
  assert.equal(parseMoneyCents("-5"), -500);
  assert.equal(parseMoneyCents("abc"), null);
  assert.equal(parseDateAny("3/5/2026"), "2026-03-05");
  assert.equal(parseDateAny("2026-3-5"), "2026-03-05");
  assert.equal(parseDateAny("13/45/2026"), null);
});
test("bank csv: negatives are spending, credits skipped", () => {
  const p = parseBankCsv("Date,Description,Amount\n11/01/2026,SHERWIN WILLIAMS,-120.50\n11/02/2026,CUSTOMER DEPOSIT,500.00\n11/03/2026,SHELL OIL,-40.00\n", {});
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].amountCents, 12050);
  assert.equal(p.rows[0].category, "Materials");
  assert.equal(p.rows[1].category, "Fuel");
  assert.equal(p.skipped, 1);
});
test("card csv: positives are spending", () => {
  const p = parseBankCsv("Transaction Date,Description,Amount\n2026-11-01,HOME DEPOT,80.00\n2026-11-02,LOWES,20.00\n2026-11-03,PAYMENT THANK YOU,-100.00\n", {});
  assert.equal(p.rows.length, 2);
  assert.equal(p.skipped, 1);
});
test("debit column files", () => {
  const p = parseBankCsv("Date,Description,Debit,Credit\n11/01/2026,QUIKTRIP,35.00,\n11/02/2026,DEPOSIT,,900.00\n", {});
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].amountCents, 3500);
});
test("missing columns gives a clear error", () => {
  assert.ok(parseBankCsv("foo,bar\n1,2\n", {}).error);
});
test("summary adds up in code", () => {
  const s = summarize({ expenses: [{ jobId: 1, spentOn: "2026-01-05", amountCents: 1000, category: "Materials" }, { jobId: null, spentOn: "2026-02-05", amountCents: 550, category: "Fuel" }], trips: [{ miles: 10.5, tripOn: "2026-01-05" }, { miles: 4.5, tripOn: "2026-01-06" }], rateCents: 70 });
  assert.equal(s.totalCents, 1550);
  assert.equal(s.byJob.overhead, 550);
  assert.equal(s.miles, 15);
  assert.equal(s.mileageValueCents, mileageValueCents(15, 70));
  assert.equal(summarize({ expenses: [], trips: [], rateCents: null }).mileageValueCents, null);
});
test("settings: rate is never hard-coded and 1099 threshold defaults to $2,000", () => {
  const s = cleanSettings({});
  assert.equal(s.mileageRateCents, null);
  assert.equal(s.threshold1099Cents, 200000);
  assert.equal(cleanSettings({ mileageRateCents: 72.5, threshold1099Cents: 60000 }).threshold1099Cents, 60000);
  assert.equal(cleanSettings({ mileageRateCents: -4 }).mileageRateCents, null);
});
