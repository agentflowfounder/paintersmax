import test from "node:test";
import assert from "node:assert/strict";
import { cleanText, painterNotice, readSignoff, signoffEmail } from "../src/signoffcore.ts";
import { portalSignoff, renderPortal } from "../src/portal.ts";
import { emailText } from "../src/brandemail.ts";
import { cleanBrand } from "../src/brandprint.ts";

const base = { es: false, company: "Tyler <b>Painters</b>", phone: "214-555-0101", email: "t@x.com", customer: "Ana Perez", title: "Fence", stage: "punch", docs: [], signed: {}, pendingSign: [], proofUrl: null, token: "a".repeat(64) };

test("readSignoff: only a job the painter asked about has one, and text is cleaned", () => {
  assert.equal(readSignoff(null), null);
  assert.equal(readSignoff("{}"), null);
  assert.equal(readSignoff("{not json"), null);
  assert.equal(readSignoff(JSON.stringify({ visit: { date: "2026-11-17" } })), null);
  const asked = readSignoff(JSON.stringify({ signoff: { requested: true, requestedAt: "2026-11-14T10:00:00Z" } }))!;
  assert.equal(asked.requested, true);
  assert.equal(asked.acceptedAt, undefined);
  const done = readSignoff({ signoff: { requested: true, requestedAt: "x", acceptedAt: "2026-11-20T23:30:00.000Z", acceptedOn: "2026-11-20", acceptedBy: "  Ana   Perez  ", concern: { text: " still a spot ", at: "y" } } })!;
  assert.equal(done.acceptedOn, "2026-11-20");
  assert.equal(done.acceptedBy, "Ana   Perez");
  assert.equal(done.concern?.text, "still a spot");
  // the json_extract form (the signoff object on its own) works too
  assert.equal(readSignoff(JSON.stringify({ requested: true, requestedAt: "x" }))?.requested, true);
  assert.equal(readSignoff({ signoff: { requested: "yes" } }), null);
  assert.equal(cleanText("  hi\u0000there ", 5), "hithe");
});

test("the sign-off email and the painter notices state no amounts and keep the language", () => {
  for (const es of [false, true]) {
    const t = signoffEmail({ es, customer: "Ana Perez", company: "Tyler Painters", title: "Fence", link: "https://paintersmax.app/portal/abc" });
    assert.match(t.body, /portal\/abc/);
    assert.match(t.body, /Ana/);
    assert.doesNotMatch(t.subject + t.body, /\$\d/);
    assert.equal(/Hola/.test(t.body), es);
  }
  assert.match(painterNotice("accepted", { customer: "Ana Perez", title: "Fence", name: "Ana P" }).body, /warranty/);
  assert.match(painterNotice("concern", { customer: "Ana Perez", title: "Fence", text: "A spot by the door" }).body, /A spot by the door/);
});

test("the customer page shows the accept card only when asked, and the accepted state afterwards", () => {
  assert.doesNotMatch(renderPortal(base), /accept the finished work/i);
  const asked = renderPortal({ ...base, signoff: { state: "asked" } });
  assert.match(asked, /I accept the finished work/);
  assert.match(asked, /Something needs attention\?/);
  assert.match(asked, /id="so_n"/);
  assert.doesNotMatch(asked, /<b>Painters<\/b>/);
  const note = renderPortal({ ...base, signoff: { state: "asked", concern: true } });
  assert.match(note, /Your note was sent/);
  const done = renderPortal({ ...base, signoff: { state: "accepted", on: "2026-11-20", name: "Ana" } });
  assert.match(done, /You accepted the finished work on Fri, Nov 20/);
  assert.doesNotMatch(done, /so_ok/);
  const es = renderPortal({ ...base, es: true, signoff: { state: "asked" } });
  assert.match(es, /Acepto el trabajo terminado/);
});

test("portalSignoff maps job data to the customer view", () => {
  assert.equal(portalSignoff(null), null);
  assert.deepEqual(portalSignoff(JSON.stringify({ signoff: { requested: true, requestedAt: "x" } })), { state: "asked", concern: false });
  assert.equal(portalSignoff(JSON.stringify({ signoff: { requested: true, requestedAt: "x", acceptedAt: "2026-11-20T10:00:00Z", acceptedOn: "2026-11-20", acceptedBy: "Ana" } }))?.state, "accepted");
});

test("the review request uses the thank-you template and only includes a link the painter saved", () => {
  const withLink = emailText(cleanBrand({ company: "Tyler Painters", reviewUrl: "https://g.page/r/abc/review", language: "en" }), "thanks", { name: "Ana", project: "Fence", offer: "" });
  assert.match(withLink.text, /g\.page\/r\/abc\/review/);
  assert.match(withLink.text, /Hi Ana/);
  const without = emailText(cleanBrand({ company: "Tyler Painters", language: "en" }), "thanks", { name: "Ana", project: "Fence", offer: "" });
  assert.doesNotMatch(without.text, /https:/);
  const es = emailText(cleanBrand({ company: "Tyler Painters", language: "es" }), "thanks", { name: "Ana", project: "Fence", offer: "" });
  assert.match(es.text, /Hola Ana/);
});

test("the scripts on the customer page are valid JavaScript in both languages", () => {
  for (const es of [false, true]) {
    const h = renderPortal({ ...base, es, signoff: { state: "asked" } });
    const scripts = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 2);
    for (const s of scripts) assert.doesNotThrow(() => new Function(s), "script should parse");
  }
});
