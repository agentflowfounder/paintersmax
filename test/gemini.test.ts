import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GEMINI_MODEL, geminiModel, thinkingOff } from "../src/gemini.ts";

test("default Gemini model is a current one, and the setting wins when present", () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.8-flash");
  assert.equal(geminiModel({} as any), "gemini-3.8-flash");
  assert.equal(geminiModel({ MODEL_GEMINI: "" } as any), "gemini-3.8-flash");
  assert.equal(geminiModel({ MODEL_GEMINI: "gemini-3.5-flash-lite" } as any), "gemini-3.5-flash-lite");
});

test("Gemini 3 models use a thinking level, older ones a token budget", () => {
  assert.deepEqual(thinkingOff("gemini-3.8-flash"), { thinkingConfig: { thinkingLevel: "low" } });
  assert.deepEqual(thinkingOff("gemini-4-argon"), { thinkingConfig: { thinkingLevel: "low" } });
  assert.deepEqual(thinkingOff("gemini-2.5-flash"), { thinkingConfig: { thinkingBudget: 0 } });
});
