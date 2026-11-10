import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanName, cleanPng, withSignature } from "../src/esign.ts";

const rec = { id: 7, signedName: "Ana <b>Perez</b>", signedAt: "2026-11-10T12:00:00.000Z", signatureData: null, ip: "1.2.3.4", docHash: "abc123", language: "en" };

describe("esign", () => {
  it("adds an escaped signature block before the closing body tag", () => {
    const out = withSignature("<html><body><p>Doc</p></body></html>", rec);
    assert.ok(String(out).includes("Electronically signed"));
    assert.ok(String(out).includes("Ana &lt;b&gt;Perez&lt;/b&gt;"));
    assert.ok(!String(out).includes("<b>Perez"));
    assert.ok(out.indexOf("Electronically signed") < out.indexOf("</body>"));
    assert.ok(String(out).includes("abc123"));
  });
  it("works on a page with no body tag and in Spanish", () => {
    assert.ok(String(withSignature("<p>x</p>", { ...rec, language: "es" })).includes("Firmado electrónicamente"));
  });
  it("accepts only small PNG data urls", () => {
    assert.notEqual(cleanPng("data:image/png;base64,iVBORw0KGgo="), null);
    assert.equal(cleanPng("data:text/html;base64,PHNjcmlwdD4="), null);
    assert.equal(cleanPng('data:image/png;base64,AAA" onerror="x'), null);
    assert.equal(cleanPng("data:image/png;base64," + "A".repeat(200001)), null);
    assert.equal(cleanPng(5), null);
  });
  it("cleans names", () => {
    assert.equal(cleanName("  Ana   Perez "), "Ana Perez");
    assert.equal(cleanName(null), "");
    assert.equal(cleanName("x".repeat(300)).length, 100);
  });
});
