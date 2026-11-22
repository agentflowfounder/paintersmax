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
  assert.match(html, /Entrar/);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("a bad or used sign-in link explains itself in both languages and links to a new one", async () => {
  for (const r of [signInLinkPage("<script>", "ready"), signInLinkPage(null, "bad")]) {
    assert.equal(r.status, 400);
    const html = await r.text();
    assert.match(html, /href="\/login"/);
    assert.match(html, /Pida uno nuevo/);
    assert.doesNotMatch(html, /<script>/);
  }
});
