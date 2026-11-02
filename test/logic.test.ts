import { test } from "node:test";
import assert from "node:assert/strict";
import { priceRange } from "../src/pricing.ts";
import { parseQuoteRequest } from "../src/validate.ts";
import { pickProviders } from "../src/ai.ts";

const base = { name: "A", email: "a@b.co", jobType: "interior", sqft: 1000 };

test("price range is low < high and rounded to $50", () => {
  const { lowCents, highCents } = priceRange("interior", 1000);
  assert.equal(lowCents, 200000);
  assert.equal(highCents, 350000);
});

test("validation rejects bad email, bad sqft, unknown job", () => {
  assert.equal(parseQuoteRequest({ ...base, email: "nope" }).ok, false);
  assert.equal(parseQuoteRequest({ ...base, sqft: 5 }).ok, false);
  assert.equal(parseQuoteRequest({ ...base, jobType: "roof" }).ok, false);
  assert.equal(parseQuoteRequest(base).ok, true);
});

test("routing: simple->gemini, photos->openai, commercial->anthropic", () => {
  const ok = (b: any) => (parseQuoteRequest(b) as any).value;
  assert.equal(pickProviders(ok(base))[0], "gemini");
  assert.equal(pickProviders(ok({ ...base, photoUrls: ["https://x.co/a.jpg"] }))[0], "openai");
  assert.equal(pickProviders(ok({ ...base, jobType: "commercial" }))[0], "anthropic");
});
