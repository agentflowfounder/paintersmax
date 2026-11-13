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
