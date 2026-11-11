import test from "node:test";
import assert from "node:assert/strict";
import { analyze, cleanRow, mapHeaders, parseCsv, phoneDigits } from "../src/import.ts";

test("parseCsv handles quotes, newlines in cells, CRLF, BOM and semicolons", () => {
  const rows = parseCsv('﻿Name,Notes\r\n"Smith, Ann","said ""hi""\nthen left"\r\nBob,ok\r\n');
  assert.deepEqual(rows, [["Name", "Notes"], ["Smith, Ann", 'said "hi"\nthen left'], ["Bob", "ok"]]);
  assert.deepEqual(parseCsv("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
});

test("mapHeaders understands common export names", () => {
  const m = mapHeaders(["First Name", "Last Name", "E-mail Address", "Mobile Phone", "Zip Code"]);
  assert.deepEqual(m, { first: 0, last: 1, email: 2, phone: 3, zip: 4 });
});

test("cleanRow rejects bad rows and keeps company names", () => {
  assert.equal(cleanRow({ name: "" }).reason, "No name");
  assert.equal(cleanRow({ name: "A", email: "nope" }).reason, "Email looks wrong");
  assert.equal(cleanRow({ name: "A", phone: "12" }).reason, "Phone looks wrong");
  const r = cleanRow({ company: "Acme HOA", email: "X@Y.com" }).row!;
  assert.equal(r.name, "Acme HOA");
  assert.equal(r.company, true);
  assert.equal(r.email, "x@y.com");
});

test("analyze skips duplicates and bad rows", () => {
  const csv = "First Name,Last Name,Email,Phone\nAnn,Lee,ann@x.com,214-555-0101\nAnn,Lee,ANN@x.com,\nBob,Ray,,(214) 555-0102\nCy,,bad,\n,,,\nDee,Fox,old@x.com,";
  const a = analyze(csv, new Set(["old@x.com"]), new Set(["2145550102"]));
  assert.deepEqual(a.rows.map((r) => r.name), ["Ann Lee"]);
  assert.equal(a.duplicates, 3);
  assert.equal(a.skipped.length, 1);
  assert.equal(a.skipped[0].line, 5);
});

test("analyze errors without a name column", () => {
  assert.match(analyze("Email,Phone\na@b.com,2145550101", new Set(), new Set()).error!, /name column/);
  assert.match(analyze("Name", new Set(), new Set()).error!, /header row/);
  assert.equal(phoneDigits("+1 (214) 555-0101"), "2145550101");
});
