import test from "node:test";
import assert from "node:assert/strict";
import { LIST_KINDS, docTitle, renderListDocHtml, starterDoc } from "../src/jobdocs.ts";
import { toBase64 } from "../src/files.ts";

test("the crew day card is a checklist in English and Spanish with a crew lead line", () => {
  assert.ok(LIST_KINDS.includes("daycard"));
  const en = starterDoc("daycard", { trade: "power_washing", profile: {}, company: "Tyler", customer: "C" }, "en");
  const es = starterDoc("daycard", { trade: "interior", profile: {}, company: "Tyler", customer: "C" }, "es");
  assert.ok(en.items.length >= 8 && es.items.length === en.items.length);
  assert.match(en.items.map((i) => i.text).join(" "), /911/);
  const html = renderListDocHtml("daycard", { company: { name: "Tyler" }, customerName: "C", jobTitle: "Wash", date: "2026-11-27" }, en);
  assert.match(html, /Crew Day Card/);
  assert.match(html, /class="box"/);
  assert.match(html, /Crew lead/);
  assert.equal(docTitle("daycard", "es"), "Tarjeta del Día para el Equipo");
});

test("a big file turns into base64 for an email attachment without overflowing", () => {
  const bytes = new Uint8Array(300000).fill(65);
  const b = toBase64(bytes);
  assert.equal(b.length, Math.ceil(300000 / 3) * 4);
  assert.equal(toBase64(new TextEncoder().encode("hi")), "aGk=");
});
