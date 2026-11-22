import { keyFor, sideBySide, type Provider } from "./assistant.ts";
import { recordQuality } from "./ailog.ts";
import { newId, readBlob, updateBlob } from "./kv.ts";
import type { Env } from "./types.ts";

/**
 * Blind side-by-side test. The owner types one question, every model that has a key answers, the answers are shown
 * as A, B, C in random order without names or times, and the owner scores each 1 to 5. Scores go to the model scorecard.
 */
export const BLIND_KEY = "blindtests";
export const BLIND_TOOLS = ["job_chat", "estimate_draft", "site_write", "wizard_chat", "help_chat", "lesson"] as const;
const PROVIDERS: Provider[] = ["gemini", "haiku", "openai", "anthropic"];

export interface BlindAnswer { label: string; provider: Provider; model: string; text: string; ms: number; ok: boolean }
export interface BlindTest { id: string; tool: string; question: string; at: string; answers: BlindAnswer[]; scored: boolean }

export const readBlind = (raw: unknown): BlindTest[] => (Array.isArray(raw) ? (raw as BlindTest[]).filter((t) => t && typeof t.id === "string" && Array.isArray(t.answers)).slice(-20) : []);

/** Fisher-Yates with a given random source, so a test can pass its own. */
export function shuffle<T>(list: T[], rnd: () => number = Math.random): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function runBlindTest(env: Env, question: string, tool: string): Promise<{ ok: true; id: string; answers: { label: string; text: string }[] } | { ok: false; error: string }> {
  const q = question.trim().slice(0, 500);
  if (!q) return { ok: false, error: "Type a question to test." };
  const providers = PROVIDERS.filter((p) => keyFor(env, p));
  if (providers.length < 2) return { ok: false, error: "Two or more AI providers need a key to compare." };
  const raw = (await sideBySide(env, q, providers)).filter((a) => a.ok);
  if (raw.length < 2) return { ok: false, error: "Fewer than two models answered. Try again." };
  const answers = shuffle(raw).map((a, i) => ({ label: String.fromCharCode(65 + i), provider: a.provider, model: a.model, text: a.text, ms: a.ms, ok: a.ok }));
  const test: BlindTest = { id: newId(), tool: (BLIND_TOOLS as readonly string[]).includes(tool) ? tool : "job_chat", question: q, at: new Date().toISOString(), answers, scored: false };
  const r = await updateBlob(env, BLIND_KEY, readBlind, (cur) => ({ value: [...cur, test].slice(-20) }));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, id: test.id, answers: answers.map((a) => ({ label: a.label, text: a.text })) };
}

/** Saves the owner's 1 to 5 scores, one per answer, and reveals the models. The best score wins (ties all win). */
export async function scoreBlindTest(env: Env, id: string, scores: unknown): Promise<{ ok: true; reveal: { label: string; model: string; ms: number; score: number }[] } | { ok: false; error: string }> {
  const tests = await readBlob(env, BLIND_KEY, readBlind);
  const t = tests.find((x) => x.id === id);
  if (!t) return { ok: false, error: "That test was not found." };
  if (t.scored) return { ok: false, error: "This test is already scored." };
  const s = (scores && typeof scores === "object" ? scores : {}) as Record<string, unknown>;
  const given = t.answers.map((a) => ({ a, score: Math.round(Number(s[a.label])) }));
  if (given.some((g) => !(g.score >= 1 && g.score <= 5))) return { ok: false, error: "Give every answer a score from 1 to 5." };
  const claim = await updateBlob(env, BLIND_KEY, readBlind, (cur) => {
    const x = cur.find((y) => y.id === id);
    if (!x || x.scored) return { error: "This test is already scored." };
    x.scored = true;
    return { value: cur };
  });
  if (!claim.ok) return { ok: false, error: claim.error };
  const best = Math.max(...given.map((g) => g.score));
  for (const g of given) await recordQuality(env, { tool: t.tool, model: g.a.model, score: g.score, win: g.score === best && given.some((o) => o.score < best) });
  return { ok: true, reveal: given.map((g) => ({ label: g.a.label, model: g.a.model, ms: g.a.ms, score: g.score })) };
}
