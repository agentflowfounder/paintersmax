import { test } from "node:test";
import assert from "node:assert/strict";
import { readThread, trimThread, MAX_MESSAGES, DETAILED_PROMPT, DEEP_PROMPT } from "../src/jobchat.ts";
import { isLostReason, LOST_REASONS } from "../src/joblost.ts";
import { PLAN_LIMITS } from "../src/usage.ts";

test("thread reader drops bad rows and caps length", () => {
  const raw = JSON.stringify([{ role: "user", content: "hi", mode: "detailed", at: "t" }, { role: "system", content: "x" }, { role: "assistant", content: 5 }, null]);
  const t = readThread(raw);
  assert.equal(t.length, 1);
  assert.equal(t[0].mode, "detailed");
  assert.deepEqual(readThread("not json"), []);
  const many = Array.from({ length: 100 }, (_, i) => ({ role: "user" as const, content: String(i), mode: "quick" as const, at: "" }));
  assert.equal(trimThread(many).length, MAX_MESSAGES);
  assert.equal(trimThread(many).at(-1)!.content, "99");
});
test("lost reasons match what the painter asked for", () => {
  assert.deepEqual([...LOST_REASONS], ["price", "timing", "no_reply", "chose_other", "other"]);
  assert.equal(isLostReason("price"), true);
  assert.equal(isLostReason("bored"), false);
});
test("detailed answers have their own smaller allowance", () => {
  assert.equal(PLAN_LIMITS.free.ai_detailed, 0);
  assert.ok(PLAN_LIMITS.pro.ai_detailed < PLAN_LIMITS.pro.ai_assistant);
  assert.ok(DEEP_PROMPT.includes("step-by-step") && DETAILED_PROMPT.includes("DETAILED"));
  assert.ok(PLAN_LIMITS.pro.ai_deep < PLAN_LIMITS.pro.ai_detailed);
});

import { QUOTE_PROMPT } from "../src/jobchat.ts";
import { completeEx } from "../src/assistant.ts";

test("quote mode is kept in saved chats, and the prompt makes the price card a check, not the start", () => {
  const t = readThread(JSON.stringify([{ role: "assistant", content: "x", mode: "quote", at: "t" }]));
  assert.equal(t[0].mode, "quote");
  assert.match(QUOTE_PROMPT, /LOW, LIKELY and HIGH/);
  assert.match(QUOTE_PROMPT, /Do NOT copy numbers from the price card/);
  assert.match(QUOTE_PROMPT, /Reality check/);
  assert.match(QUOTE_PROMPT, /Coach's note/);
});

test("a photo question reaches OpenAI and Anthropic as an image, not as an unknown field", async () => {
  const seen: Record<string, any> = {};
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    seen[u.includes("openai") ? "openai" : "anthropic"] = JSON.parse(init.body);
    if (u.includes("openai")) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ content: [{ text: "ok" }] }), { status: 200 });
  }) as any;
  try {
    const out = await completeEx({ OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" } as any, "sys", [{ role: "user", content: "what is this?", image: { mime: "image/jpeg", data: "AAAA" } }], { prefer: ["openai", "anthropic"] });
    assert.equal(out?.provider, "anthropic");
  } finally {
    globalThis.fetch = real;
  }
  const oaMsg = seen.openai.messages[1];
  assert.equal(oaMsg.image, undefined);
  assert.equal(oaMsg.content[1].type, "image_url");
  const anMsg = seen.anthropic.messages[0];
  assert.equal(anMsg.image, undefined);
  assert.equal(anMsg.content[0].type, "image");
  assert.equal(anMsg.content[1].text, "what is this?");
});
