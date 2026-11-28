import assert from "node:assert/strict";
import { test } from "node:test";
import { renderText, sendJobText, TEXT_KINDS, TEMPLATES, usPhone, textsOn } from "../src/texts.ts";
import { FEATURES } from "../src/features.ts";

test("every text kind has an English and a Spanish version, with opt-out words", () => {
  for (const k of TEXT_KINDS) {
    assert.ok(TEMPLATES[k].en && TEMPLATES[k].es);
    assert.match(TEMPLATES[k].en, /STOP/);
    assert.match(TEMPLATES[k].es, /STOP/);
  }
});

test("renderText fills the name, business and date, and cleans bad characters", () => {
  assert.equal(renderText("booked", "en", { name: "Ana", company: "Rose City Painters", date: "2026-12-03" }), "Hi Ana, this is Rose City Painters. Your painting visit is booked for 2026-12-03. Reply here with any questions. Reply STOP to opt out.");
  assert.match(renderText("booked", "es", { name: "Ana{x}" }), /^Hola Ana x, le habla PaintersMax/);
  assert.match(renderText("job_done", "en", {}), /^Hi there,/);
});

test("US phone numbers become +1 format; anything else is refused", () => {
  assert.equal(usPhone("(903) 714-8120"), "+19037148120");
  assert.equal(usPhone("1 903 714 8120"), "+19037148120");
  assert.equal(usPhone("12345"), null);
});

test("texts are off by default, and nothing is sent", async () => {
  const env = {} as any;
  assert.equal(textsOn(env), false);
  const r = await sendJobText(env, { companyId: 1, jobId: 1, kind: "booked", lang: "en", to: "9037148120", vars: {} });
  assert.deepEqual(r, { ok: false, reason: "off" });
});

test("the feature list has bilingual names and a placement for each", () => {
  for (const f of FEATURES) {
    assert.ok(f.en && f.es, f.key);
    assert.ok(["page", "tab", "card"].includes(f.where), f.key);
  }
  assert.equal(new Set(FEATURES.map((f) => f.key)).size, FEATURES.length);
});
