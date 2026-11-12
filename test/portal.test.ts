import test from "node:test";
import assert from "node:assert/strict";
import { renderPortal, stageText } from "../src/portal.ts";

const base = { es: false, company: "Tyler <b>Painters</b>", phone: "214-555-0101", email: "t@x.com", customer: "Ana Perez", title: "Fence", stage: "bid", docs: [{ id: 7, kind: "estimate", status: "signed", label: "estimate" }, { id: 9, kind: "invoice", status: "sent", label: "invoice" }], signed: { estimate: "2026-11-10" }, pendingSign: [] as string[], proofUrl: "https://paintersmax.app/coi/abc", token: "a".repeat(64) };

test("portal page shows documents, signature and proof, and escapes text", () => {
  const h = renderPortal(base);
  assert.match(h, /Hi Ana/);
  assert.match(h, /Signed 2026-11-10/);
  assert.match(h, /\/portal\/a{64}\/doc\/9/);
  assert.match(h, /View proof of insurance/);
  assert.doesNotMatch(h, /<b>Painters<\/b>/);
  assert.match(h, /noindex/);
});

test("portal page in Spanish and with nothing shared", () => {
  const h = renderPortal({ ...base, es: true, docs: [], proofUrl: null });
  assert.match(h, /Hola Ana/);
  assert.match(h, /Todavía no se ha compartido nada/);
  assert.doesNotMatch(h, /comprobante de seguro<\/h2>/i);
  assert.equal(stageText("closed", true), "Todo listo. ¡Gracias!");
  assert.equal(stageText("weird", false), "In progress");
});
