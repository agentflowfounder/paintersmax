import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLesson, cleanTags, rankLessons, words } from "../src/lessons.ts";

test("tags are cleaned, lowercased and limited", () => {
  assert.equal(cleanTags("Stain, STAIN, Cedar Siding; <b>hack</b>"), "stain, cedar siding, bhackb");
  assert.equal(cleanTags(["a", "b"]), "a, b");
  assert.equal(cleanTags("1,2,3,4,5,6,7,8,9,10").split(", ").length, 8);
});
test("lesson needs title and body", () => {
  assert.ok("error" in (cleanLesson({ title: "", body: "x" }) as any));
  assert.ok("error" in (cleanLesson({ title: "x", body: " " }) as any));
  assert.equal((cleanLesson({ title: " T ", body: " B ", tags: "a" }) as any).title, "T");
});
test("words drops stop words and short words", () => {
  assert.deepEqual(words("How do I fix the peeling paint on a cedar deck?"), ["fix", "peeling", "paint", "cedar", "deck"]);
});
test("ranking: title beats tags beats body, no match returns nothing", () => {
  const items = [
    { title: "Cedar deck stain", body: "Sand first", tags: "deck" },
    { title: "Ceiling leak", body: "The cedar trim was wet", tags: "stain" },
    { title: "Pricing", body: "Charge more for stairs", tags: "money" },
  ];
  const r = rankLessons(items, "cedar stain");
  assert.equal(r[0].title, "Cedar deck stain");
  assert.equal(r.length, 2);
  assert.deepEqual(rankLessons(items, "plumbing"), []);
  assert.deepEqual(rankLessons(items, "the a an"), []);
});
