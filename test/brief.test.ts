import { test } from "node:test";
import assert from "node:assert/strict";
import { draftLines, ownerBriefText, type Brief } from "../src/brief.ts";
import { parseQuoteRequest } from "../src/validate.ts";

const brief: Brief = {
  projectSummary: "Living room walls in good shape.",
  rooms: ["Living room"],
  surfaces: [
    { name: "Walls", condition: "good", prep: "patch nail holes", weight: 6 },
    { name: "Trim", condition: "scuffed", prep: "sand", weight: 2 },
  ],
  materials: ["Eggshell, 3 gal"],
  hours: { low: 8, high: 12 },
  concerns: [],
  questions: ["Ceiling height?"],
  confidence: "medium",
};

test("draft lines split the calculated range by weight and never exceed it by much", () => {
  const lines = draftLines(brief, 200000, 400000);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].low > lines[1].low);
  const hi = lines.reduce((a, l) => a + l.high, 0);
  assert.ok(Math.abs(hi - 400000) <= 10000);
});

test("owner brief text includes totals and questions", () => {
  const t = ownerBriefText(brief, 200000, 400000);
  assert.match(t, /\$2,000 to \$4,000/);
  assert.match(t, /ASK ON SITE/);
});

test("photos are validated: only small jpeg/png/webp data URLs, max 4", () => {
  const ok = "data:image/jpeg;base64,AAAA";
  const base = { name: "A", email: "a@b.co", jobType: "interior", sqft: 500 };
  const r = parseQuoteRequest({ ...base, photos: [ok, "data:text/html;base64,AAAA", "http://x", ok, ok, ok, ok] });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.photos?.length, 4);
});
