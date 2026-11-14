import type { Env } from "./types.ts";

/**
 * One place for the Gemini model name and the "do not think" setting, so a retired model is a one-line change.
 * Google stopped offering gemini-2.5-flash to new accounts (answers 404), so the default is now gemini-3.8-flash.
 * Change MODEL_GEMINI in wrangler.jsonc or the Cloudflare dashboard when Google renames the model again.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const geminiModel = (env: Env): string => env.MODEL_GEMINI || DEFAULT_GEMINI_MODEL;

/**
 * Short answers do not need long hidden thinking (it is billed as output). Gemini 3 models use a "level",
 * older ones use a token budget. Callers that get a 400 back should try again without this setting.
 */
export const thinkingOff = (model: string): { thinkingConfig: Record<string, unknown> } =>
  /^gemini-(?:[3-9]|\d{2,})/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : { thinkingConfig: { thinkingBudget: 0 } };
