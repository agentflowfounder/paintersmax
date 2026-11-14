import { test } from "node:test";
import assert from "node:assert/strict";
import { COVERED_SCORE, STARTER_ARTICLES, TOPICS, cleanArticle, scoreArticle, searchArticles, tokens } from "../src/helplib.ts";

test("starter articles have unique ids, real topics and safe links", () => {
  const ids = new Set<string>();
  for (const a of STARTER_ARTICLES) {
    assert.match(a.id, /^[a-z0-9-]{3,60}$/, a.id);
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
    ids.add(a.id);
    assert.ok(TOPICS.some((t) => t.id === a.topic), `${a.id} topic`);
    assert.ok(a.title.length > 5 && a.body.length > 40, `${a.id} text`);
    if (a.link) assert.ok(a.link.href.startsWith("/") && !a.link.href.startsWith("//"), `${a.id} link`);
  }
  assert.ok(STARTER_ARTICLES.length >= 20);
});

test("tokens drop filler words and simple endings", () => {
  assert.deepEqual(tokens("How do I send the invoices?"), ["send", "invoic"]);
  assert.deepEqual(tokens("invoicing"), tokens("invoice"));
  assert.deepEqual(tokens("prices"), tokens("pricing"));
  assert.ok(!tokens("What is my plan").includes("what"));
});

test("a plain question finds the right starter article", () => {
  const top = (q: string) => searchArticles(STARTER_ARTICLES, q, 1)[0];
  assert.equal(top("how do I send an estimate to a customer")?.article.id, "final-estimate");
  assert.equal(top("how do I download my records for my accountant")?.article.id, "records-download");
  assert.ok(top("how do I send an estimate to a customer")!.score >= COVERED_SCORE);
  assert.equal(top("how do I change my prices")?.article.id, "change-prices");
  assert.equal(top("how do I add a crew member")?.article.id, "crew");
  assert.equal(top("how do I reset my password")?.article.id, "sign-in");
  assert.equal(top("how do I get paid")?.article.id, "payments");
});

test("Spanish keywords find articles", () => {
  const hit = searchArticles(STARTER_ARTICLES, "como cambio mi idioma al espanol", 1)[0];
  assert.equal(hit?.article.id, "spanish");
});

test("an unrelated question is not treated as covered", () => {
  const hit = searchArticles(STARTER_ARTICLES, "what is the capital of france", 1)[0];
  assert.ok(!hit || hit.score < COVERED_SCORE);
});

test("title words count more than body words", () => {
  const a = { id: "x-a", topic: "start", title: "Invoices", keywords: [], body: "paint" };
  const b = { id: "x-b", topic: "start", title: "Other", keywords: [], body: "invoice invoice" };
  assert.ok(scoreArticle(a, tokens("invoices")) > scoreArticle(b, tokens("invoices")));
});

test("cleanArticle keeps safe values and rejects empty ones", () => {
  assert.equal(cleanArticle({ title: "", body: "x" }), null);
  assert.equal(cleanArticle({ title: "x", body: "" }), null);
  const a = cleanArticle({ title: "How to do X", body: "1. Tap Jobs", topic: "nope", keywords: "one, two,,three", link: { label: "Open", href: "//evil.com" } })!;
  assert.equal(a.topic, "business");
  assert.deepEqual(a.keywords, ["one", "two", "three"]);
  assert.equal(a.link, undefined);
  assert.equal(a.custom, true);
  assert.equal(cleanArticle({ title: "T", body: "b", link: { label: "Open", href: "/jobs" } })!.link!.href, "/jobs");
  assert.equal(cleanArticle({ id: "spanish", title: "T", body: "b" })!.id, "spanish");
  assert.match(cleanArticle({ id: "BAD ID", title: "Hello World", body: "b" })!.id, /^a-hello-world$/);
});
