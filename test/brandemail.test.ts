import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanBrand } from "../src/brandprint.ts";
import { EMAIL_TEMPLATES, cleanFields, emailHtml, emailText } from "../src/brandemail.ts";

const brand = cleanBrand({ company: "Rivera Painting", person: "Ana Rivera", phone: "(214) 555-0100", website: "rivera.com", color: "#1B3A6B" });
const f = { name: "Dana", project: "your kitchen", offer: "" };

test("each template has a subject, the customer's name and the painter's signature", () => {
  for (const t of EMAIL_TEMPLATES) {
    const e = emailText(brand, t.id, f);
    assert.ok(e.subject.length > 5, t.id);
    assert.ok(e.text.startsWith("Hi Dana,"), t.id);
    assert.ok(e.text.includes("your kitchen"), t.id);
    assert.ok(e.text.includes("Ana Rivera\nRivera Painting\n(214) 555-0100  |  rivera.com"), t.id);
    assert.ok(!e.text.includes("undefined"), t.id);
  }
});

test("without a name or project the message still reads well", () => {
  const e = emailText(brand, "estimate", cleanFields({}));
  assert.ok(e.text.startsWith("Hi there,"));
  assert.ok(e.text.includes("your project"));
  assert.equal(emailText(cleanBrand({ ...brand, language: "es" }), "estimate", cleanFields({})).text.split("\n")[0], "Hola,");
});

test("an offer line appears only when the painter types one, and a review link only when they have one", () => {
  assert.ok(!emailText(brand, "estimate", f).text.includes("spring"));
  assert.ok(emailText(brand, "estimate", { ...f, offer: "Ask about our spring schedule." }).text.includes("Ask about our spring schedule."));
  assert.ok(!emailText(brand, "thanks", f).text.includes("https://"));
  const withLink = cleanBrand({ ...brand, reviewUrl: "https://g.page/r/abc" });
  assert.ok(emailText(withLink, "thanks", f).text.includes("https://g.page/r/abc"));
  assert.ok(!emailText(brand, "thanks", f).text.includes("promise") && !emailText(brand, "estimate", f).text.includes("free"));
});

test("an unknown template falls back to the estimate follow-up", () => {
  assert.equal(emailText(brand, "nope", f).template, "estimate");
});

test("Spanish templates are Spanish", () => {
  const es = cleanBrand({ ...brand, language: "es" });
  assert.ok(emailText(es, "thanks", f).text.startsWith("Hola Dana,"));
  assert.ok(emailText(es, "checkin", f).subject.includes("pintura"));
});

test("the formatted email escapes text, links addresses and uses a readable header color", () => {
  const html = emailHtml(brand, "Hello", 'Hi <b>there</b>\n\nSee https://g.page/r/abc?x=1&y=2 now\nSecond line "quoted"');
  assert.ok(html.includes("&lt;b&gt;there&lt;/b&gt;"));
  assert.ok(!html.includes("<b>there"));
  assert.ok(html.includes('href="https://g.page/r/abc?x=1&amp;y=2"'));
  assert.ok(html.includes("now<br>Second line &quot;quoted&quot;"));
  assert.ok(html.includes("background:#1B3A6B") && html.includes("color:#ffffff")); // navy header, white name
  const light = emailHtml(cleanBrand({ ...brand, color: "#FFD60A" }), "x", "y");
  assert.ok(light.includes("color:#0F1B2D;\"") || light.includes("font-weight:700;color:#0F1B2D"));
  assert.ok(emailHtml(cleanBrand({ ...brand, logoUrl: "https://example.com/l.png" }), "x", "y").includes('src="https://example.com/l.png"'));
});

test("fields are trimmed and limited", () => {
  const c = cleanFields({ name: "  " + "x".repeat(100), project: 5, offer: "y".repeat(300) });
  assert.equal(c.name.length, 40);
  assert.equal(c.project, "");
  assert.equal(c.offer.length, 200);
});
