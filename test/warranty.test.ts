import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, cleanCert, renderCertificate } from "../src/warranty.ts";

test("addMonths keeps the day and clamps to month end", () => {
  assert.equal(addMonths("2026-11-13", 12), "2027-11-13");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2027-12-31", 2), "2028-02-29");
  assert.equal(addMonths("2026-11-13", 24), "2028-11-13");
});
test("cleanCert validates and works out the end date in code", () => {
  assert.ok("error" in (cleanCert({ months: 0, startOn: "2026-11-13" }, "classic") as any));
  assert.ok("error" in (cleanCert({ months: 12, startOn: "13/11/2026" }, "classic") as any));
  const c: any = cleanCert({ months: 24, startOn: "2026-11-13", design: "badge", language: "es" }, "classic");
  assert.equal(c.endOn, "2028-11-13");
  assert.equal(c.design, "badge");
  assert.equal(cleanCert({ months: 6, startOn: "2026-11-13", design: "weird" }, "modern").design as any, "modern");
});
test("all six designs render, escape text, and show the dates", () => {
  for (const design of ["classic", "modern", "badge", "heritage", "minimal", "bold"] as const) {
    const cert: any = cleanCert({ months: 12, startOn: "2026-11-13", design, terms: "We <b>fix</b> peeling." }, "classic");
    const h = renderCertificate({ company: "Tyler & Sons", customer: "Ana <x>", jobTitle: "Fence", address: "1 Main St", cert });
    assert.ok(h.includes("Warranty Certificate"));
    assert.ok(h.includes("November 13, 2027"));
    assert.ok(h.includes("Tyler &amp; Sons"));
    assert.ok(!h.includes("<b>fix</b>"));
    assert.ok(h.includes("Ana &lt;x&gt;"));
  }
  const es: any = cleanCert({ months: 12, startOn: "2026-11-13", language: "es" }, "classic");
  assert.ok(renderCertificate({ company: "C", customer: "A", jobTitle: "J", address: "", cert: es }).includes("Certificado de Garantía"));
});
