import { test } from "node:test";
import assert from "node:assert/strict";
import { iifAccounts, iifFile, iifText, qboCsv } from "../src/qbexport.ts";

const ex = [
  { spentOn: "2026-11-09", vendor: "Sherwin: Williams\tTyler", category: "Materials", amountCents: 12050, jobTitle: "Fence", note: "tape\nplastic" },
  { spentOn: "2026-11-10", vendor: "QT", category: "Fuel", amountCents: 4000, jobTitle: null, note: "" },
  { spentOn: "2026-11-11", vendor: "Zero", category: "Other", amountCents: 0, jobTitle: null, note: "" },
];

test("QBO CSV: Date, Description, Amount; payments negative; US dates; zero rows skipped", () => {
  const lines = qboCsv(ex).trim().split("\r\n");
  assert.equal(lines[0], "Date,Description,Amount");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "11/09/2026,Sherwin: Williams Tyler | Materials | Job: Fence,-120.50");
  assert.ok(lines[2].endsWith(",-40.00"));
});
test("IIF: header rows, TRNS/SPL/ENDTRNS, splits equal the opposite of the TRNS amount, tabs and colons cleaned", () => {
  const f = iifFile(ex, { payAccount: "Business Checking", payType: "check" });
  const rows = f.trim().split("\r\n");
  assert.equal(rows[0].split("\t")[0], "!TRNS");
  assert.equal(rows[1].split("\t")[0], "!SPL");
  assert.equal(rows[2], "!ENDTRNS");
  const body = rows.slice(3);
  assert.equal(body.length, 6); // two transactions of 3 lines; the zero row is skipped
  const trns = body[0].split("\t");
  const spl = body[1].split("\t");
  assert.equal(trns[0], "TRNS");
  assert.equal(trns[2], "CHECK");
  assert.equal(trns[3], "11/9/2026");
  assert.equal(trns[4], "Business Checking");
  assert.equal(Number(trns[6]) + Number(spl[6]), 0);
  assert.equal(spl[4], "Materials");
  assert.equal(trns[5], "Sherwin- Williams Tyler"); // colon and tab removed
  assert.equal(body[2], "ENDTRNS");
  for (const r of body) if (r !== "ENDTRNS") assert.equal(r.split("\t").length, 9); // same column count as the header
});
test("IIF credit card type and account map", () => {
  const f = iifFile(ex.slice(0, 1), { payAccount: "Visa", payType: "card", accountMap: { Materials: "Job Materials" } });
  assert.ok(f.includes("CREDIT CARD\t11/9/2026\tVisa"));
  assert.ok(f.includes("Job Materials"));
  assert.deepEqual(iifAccounts(ex, { Materials: "Job Materials" }), ["Fuel", "Job Materials"]);
});
test("iifText", () => {
  assert.equal(iifText('a:b\t"c"\n d', 20), "a-b c d");
});
