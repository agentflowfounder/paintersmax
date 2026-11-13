import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyVisionError, parseJsonLoose, visionAsk } from "../src/vision.ts";

const input = { system: "s", user: "u", mime: "image/jpeg", data: "AAAA" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function withFetch<T>(impl: (url: string, init: any) => Response | Promise<Response>, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => impl(String(url), init)) as any;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("falls back to OpenAI when Gemini is over quota, and says so", async () => {
  const seen: string[] = [];
  const out = await withFetch(
    (url) => {
      seen.push(url);
      if (url.includes("generativelanguage")) return reply(429, { error: { message: "Quota exceeded" } });
      return reply(200, { choices: [{ message: { content: '{"vendor":"Sherwin"}' } }] });
    },
    () => visionAsk({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" } as any, input),
  );
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.provider, "openai");
    assert.match(out.tried[0], /gemini 429/);
  }
  assert.equal(seen.length, 2);
});

test("retries Gemini without 'thinking off' when the model refuses it", async () => {
  const bodies: any[] = [];
  const out = await withFetch(
    (_url, init) => {
      const b = JSON.parse(init.body);
      bodies.push(b);
      if (b.generationConfig.thinkingConfig) return reply(400, { error: { message: "Budget 0 is invalid" } });
      return reply(200, { candidates: [{ content: { parts: [{ text: "{}" }] } }] });
    },
    () => visionAsk({ GEMINI_API_KEY: "g" } as any, input),
  );
  assert.equal(out.ok, true);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
});

test("when every provider fails, the reasons are listed and no key is leaked", async () => {
  const out = await withFetch(
    () => reply(500, { error: { message: "down" } }),
    () => visionAsk({ GEMINI_API_KEY: "secret-g", OPENAI_API_KEY: "secret-o", ANTHROPIC_API_KEY: "secret-a" } as any, input),
  );
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.match(out.why, /gemini 500/);
    assert.match(out.why, /openai 500/);
    assert.match(out.why, /anthropic 500/);
    assert.doesNotMatch(out.why, /secret/);
  }
});

test("no keys at all is reported plainly", async () => {
  const out = await visionAsk({} as any, input);
  assert.equal(out.ok, false);
  if (!out.ok) assert.match(friendlyVisionError(out.why, "Reading receipts"), /not switched on/);
});

test("parseJsonLoose handles fences and chatter", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! {"a":2} hope that helps'), { a: 2 });
  assert.equal(parseJsonLoose("nothing here"), null);
});

test("friendly messages: rate limit and sign-in problems read differently", () => {
  assert.match(friendlyVisionError("gemini 429 (Quota)", "Photo analysis"), /busy/);
  assert.match(friendlyVisionError("openai 401", "Photo analysis"), /sign in/);
  assert.match(friendlyVisionError("gemini 500", "Photo analysis"), /try again/);
});
