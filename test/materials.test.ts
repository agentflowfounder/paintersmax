import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMaterial, hasAffiliate, renderPublicMaterials } from "../src/materials.ts";
import { DEFAULT_MATERIALS } from "../src/materials-default.ts";

test("starting list has no affiliate links and no disclosure", () => {
  assert.ok(DEFAULT_MATERIALS.length > 40);
  assert.equal(hasAffiliate(DEFAULT_MATERIALS), false);
  const html = renderPublicMaterials(DEFAULT_MATERIALS);
  assert.ok(!html.includes("affiliate links"));
  assert.ok(html.includes('rel="canonical"') && html.includes("application/ld+json"));
});

test("cleanMaterial keeps only safe values", () => {
  assert.equal(cleanMaterial({ name: "" }), null);
  const m = cleanMaterial({ name: "<b>Brush</b>", photo: "http://x.com/a.jpg", links: [{ label: "Buy", url: "javascript:alert(1)" }, { label: "Store", url: "https://store.example/x", affiliate: true }] })!;
  assert.equal(m.photo, "");
  assert.equal(m.links.length, 1);
  assert.equal(m.links[0].affiliate, true);
  const html = renderPublicMaterials([m]);
  assert.ok(html.includes("&lt;b&gt;Brush&lt;/b&gt;"));
  assert.ok(html.includes("affiliate links"), "disclosure appears when a link is marked affiliate");
  assert.ok(html.includes('rel="sponsored noopener"'));
});
