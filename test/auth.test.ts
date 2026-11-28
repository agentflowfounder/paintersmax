import { test } from "node:test";
import assert from "node:assert/strict";
import { randomToken, readCookie, sha256Hex } from "../src/auth.ts";

test("tokens are 64 hex chars and unique", () => {
  const a = randomToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, randomToken());
});

test("sha256 matches a known value", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("cookie parsing", () => {
  assert.equal(readCookie("a=1; pm_session=xyz; b=2", "pm_session"), "xyz");
  assert.equal(readCookie(null, "pm_session"), null);
  assert.equal(readCookie("a=1", "pm_session"), null);
});

import { signInLinkPage } from "../src/auth.ts";

test("opening a sign-in link shows a Sign in button and never uses the link", async () => {
  const t = "a".repeat(64);
  const r = signInLinkPage(t, "ready");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /method="post" action="\/api\/auth\/verify"/);
  assert.match(html, new RegExp(`value="${t}"`));
  assert.match(html, />Sign in</);
  assert.doesNotMatch(html, /Entrar/);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("the sign-in page shows one language at a time, with a switch to the other", async () => {
  const t = "a".repeat(64);
  const es = await signInLinkPage(t, "ready", "es").text();
  assert.match(es, />Entrar</);
  assert.doesNotMatch(es, /Sign in/);
  assert.match(es, new RegExp(`token=${t}&amp;lang=en`));
  const en = await signInLinkPage(t, "ready", "en").text();
  assert.match(en, /lang=es/);
  assert.doesNotMatch(en, /Entrar/);
});

import { pickLang } from "../src/auth.ts";

test("the page language follows the link, then the browser's first language, and defaults to English", () => {
  assert.equal(pickLang("es", "en-US,en;q=0.9"), "es");
  assert.equal(pickLang(null, "es-MX,es;q=0.9,en;q=0.8"), "es");
  assert.equal(pickLang(null, "en-US,es;q=0.8"), "en");
  assert.equal(pickLang(null, null), "en");
  assert.equal(pickLang("fr", "pt-BR"), "en");
});

test("a bad or used sign-in link explains itself in one language and links to a new one", async () => {
  for (const r of [signInLinkPage("<script>", "ready"), signInLinkPage(null, "bad")]) {
    assert.equal(r.status, 400);
    const html = await r.text();
    assert.match(html, /href="\/login"/);
    assert.match(html, /Get a new link/);
    assert.doesNotMatch(html, /Pida uno nuevo/);
    assert.doesNotMatch(html, /<script>/);
  }
  assert.match(await signInLinkPage(null, "bad", "es").text(), /Pida uno nuevo/);
});

import { loginEmail } from "../src/auth.ts";

test("the sign-in email follows the painter's language, and the first one welcomes them", () => {
  const en = loginEmail("https://x/l", { lang: "en" });
  assert.equal(en.subject, "Your PaintersMax sign-in link");
  const es = loginEmail("https://x/l", { lang: "es", welcome: { company: "Pinturas Tyler", credits: 250 } });
  assert.match(es.subject, /enlace de acceso/);
  assert.match(es.text, /Pinturas Tyler/);
  assert.match(es.text, /250 créditos/);
  assert.match(es.text, /https:\/\/x\/l/);
  const w = loginEmail("https://x/l", { lang: "en", welcome: { company: "Bright Co", credits: 0 } });
  assert.match(w.subject, /^Welcome/);
  assert.doesNotMatch(w.text, /credits/);
});
