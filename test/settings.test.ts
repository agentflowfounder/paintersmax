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

import { PROFILE_CAPS, sanitizeProfile, sanitizeRateData } from "../src/profile.ts";

test("profile respects plan caps and drops bad values", () => {
  const p = sanitizeProfile(
    {
      trades: ["interior", "exterior", "commercial", "nonsense"],
      cities: ["Tyler", "Dallas", "Plano"],
      company: { email: "bad", website: "http://x.co", phone: " 903 " },
      labor: { hourlyRate: "45", depositPct: 500, crewSize: 3 },
      language: { crewDocs: "es" },
    },
    "starter",
  );
  assert.equal(p.trades.length, PROFILE_CAPS.starter.services);
  assert.equal(p.cities.length, PROFILE_CAPS.starter.cities);
  assert.equal(p.company.email, undefined);
  assert.equal(p.company.website, undefined);
  assert.equal(p.company.phone, "903");
  assert.equal(p.labor.hourlyRate, 45);
  assert.equal(p.labor.depositPct, undefined);
  assert.equal(p.language.crewDocs, "es");
});

test("rate card data keeps only numbers and safe keys", () => {
  const d = sanitizeRateData({ small: 150, medium: "225", "bad key!": 5, text: "x", addons: { ceiling: 60, deep: { a: { b: { c: { d: 1 } } } } } });
  assert.equal(d.small, 150);
  assert.equal(d.medium, 225);
  assert.equal(d["bad key!"], undefined);
  assert.equal(d.text, undefined);
  assert.equal(d.addons.ceiling, 60);
});
