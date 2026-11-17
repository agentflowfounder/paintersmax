import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLanding, cleanSlug, rate, renderLanding } from "../src/landing.ts";

test("landing: cleaned and bounded; a bad video link is dropped", () => {
  const l = cleanLanding({ name: "Spring Promo!", headline: { en: "Hi" }, bullets: [{ en: "a" }, {}, { es: "b" }, { en: "c" }, { en: "d" }, { en: "e" }, { en: "f" }], yt: "https://evil.com/x", status: "live", plan: "pro", campaign: "Spring Push 2027" }, "t")!;
  assert.equal(l.slug, "spring-promo");
  assert.equal(l.bullets.length, 5);
  assert.equal(l.yt, "");
  assert.equal(l.campaign, "spring-push-2027");
  assert.equal(l.plan, "pro");
  assert.equal(cleanLanding({ name: "x" }), null);
  assert.equal(cleanSlug("  Ünï Códe  "), "uni-code");
  assert.equal(cleanLanding({ name: "ab", status: "weird", goal: "weird", yt: "https://youtu.be/dQw4w9WgXcQ" })!.status, "draft");
});

test("landing: the page escapes text, tracks only when live, and switches language", () => {
  const l = cleanLanding({ name: "ab", status: "live", headline: { en: '<script>alert(1)</script>', es: "Hola" }, yt: "dQw4w9WgXcQ", cta: { en: "Go" } })!;
  const en = renderLanding(l, "en", { origin: "https://paintersmax.app", preview: false });
  assert.doesNotMatch(en, /<script>alert/);
  assert.match(en, /sendBeacon/);
  assert.match(en, /data-yt="dQw4w9WgXcQ"/);
  assert.match(en, /href="\/start\?lp=ab"/);
  assert.doesNotMatch(en, /noindex/);
  const es = renderLanding(l, "es", { origin: "https://paintersmax.app", preview: true });
  assert.match(es, /Hola/);
  assert.match(es, /noindex/);
  assert.match(es, /return;/); // a preview never counts
});

test("landing: rates are safe for zero", () => {
  assert.equal(rate(1, 0), 0);
  assert.equal(rate(1, 3), 33.3);
});
