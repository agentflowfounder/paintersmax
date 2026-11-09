import { test } from "node:test";
import assert from "node:assert/strict";
import { priceRange } from "../src/pricing.ts";
import { readSettings, renderQuotePage, sanitize } from "../src/settings.ts";

test("company rates override the defaults for that job type only", () => {
  const base = priceRange("interior", 1000);
  const custom = priceRange("interior", 1000, { interior: [4, 6] });
  assert.equal(custom.lowCents, 400000);
  assert.equal(custom.highCents, 600000);
  assert.ok(base.lowCents < custom.lowCents);
  assert.deepEqual(priceRange("exterior", 1000, { interior: [4, 6] }), priceRange("exterior", 1000));
});

test("settings drop anything invalid", () => {
  const s = sanitize({
    brandColor: "red",
    logoUrl: "javascript:alert(1)",
    tagline: "  Hi  ",
    rates: { interior: [3, 2], exterior: [2, 5], both: ["x", 3], commercial: [0, 4] },
  });
  assert.equal(s.brandColor, undefined);
  assert.equal(s.logoUrl, undefined);
  assert.equal(s.tagline, "Hi");
  assert.deepEqual(s.rates, { exterior: [2, 5] });
  assert.deepEqual(readSettings("not json"), {});
});

test("public page escapes the company name and uses brand color", () => {
  const html = renderQuotePage("<h1>{{NAME}}</h1>{{COLOR}}{{LOGO}}{{SLUG}}", { slug: "a-b", name: '<script>"x"' }, { brandColor: "#112233", logoUrl: "https://x.co/l.png" });
  assert.ok(!html.includes("<script>"));
  assert.match(html, /#112233/);
  assert.match(html, /<img class="logo" src="https:\/\/x\.co\/l\.png"/);
});
