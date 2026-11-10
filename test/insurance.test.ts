import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJsonLoose, sanitizeSummary } from "../src/insurance.ts";

describe("insurance reader", () => {
  it("parses JSON wrapped in markdown fences or text", () => {
    assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJsonLoose('Here you go: {"a":2} thanks'), { a: 2 });
    assert.equal(parseJsonLoose("not json"), null);
  });
  it("keeps only expected fields and sizes", () => {
    const s = sanitizeSummary({
      carrier: "Acme Mutual",
      policyNumberLast4: "12345678",
      limits: [{ label: "Each occurrence", value: "$1,000,000" }, { label: "" }],
      jobGuide: [{ job: "Exterior", status: "bogus", note: "x".repeat(900) }],
      covered: ["a", "b", 5, null],
      evil: "<script>",
    });
    assert.equal(s.carrier, "Acme Mutual");
    assert.equal(s.policyNumberLast4, "1234");
    assert.equal(s.limits.length, 1);
    assert.equal(s.jobGuide[0].status, "check_with_agent");
    assert.equal(s.jobGuide[0].note.length, 300);
    assert.equal(s.covered.length, 2);
    assert.equal("evil" in s, false);
  });
  it("survives garbage", () => {
    const s = sanitizeSummary(null);
    assert.deepEqual(s.limits, []);
    assert.equal(s.plain, "");
  });
});
