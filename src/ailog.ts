import { dayKey } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * AI call log (Rogelio, 2026-11-20: "I want the AI call log and thumbs up before launch").
 *
 * Every text AI call is counted per day, per tool and per model: calls, successes, milliseconds, tokens in and out
 * (about 4 characters a token, since the providers' own counts are not passed back), thumbs up and thumbs down.
 * Counters live in usage_counters under the PaintersMax company, feature "ailog:<tool>:<model>:<metric>", so there is
 * no database change. A per-call table (to store each prompt and answer for review) needs a migration; ask before adding it.
 * Nothing the painter or customer typed is ever stored here.
 */

export const METRICS = ["n", "ok", "ms", "in", "out", "up", "down"] as const;
export type Metric = (typeof METRICS)[number];
const clean = (s: string) => String(s || "text").toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 40) || "text";
export const approxTokens = (s: string) => Math.ceil(String(s ?? "").length / 4);

/** Dollars per million tokens (input, output), checked 2026-11-20. Models not listed show "price not set". Gemini text doubles on 2027-01-01. */
export const AI_PRICES: Record<string, [number, number]> = {
  "gemini-3.8-flash": [0.75, 3.75],
  "claude-haiku-5-5": [0.1, 0.5],
};
export const REASONS = ["wrong", "unclear", "too_long", "too_short", "other"] as const;

async function masterId(env: Env): Promise<number | null> {
  const r = await env.DB.prepare("SELECT id FROM companies WHERE slug = 'paintersmax-master'").first<{ id: number }>();
  return r?.id ?? null;
}

async function add(env: Env, master: number, tool: string, model: string, metric: string, by: number, day: string) {
  if (!by) return;
  await env.DB.prepare("INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, ?, ?, ?) ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + excluded.count")
    .bind(master, `ailog:${clean(tool)}:${clean(model)}:${metric}`, day, Math.round(by)).run();
}

/** Records one call. Never throws: a logging problem must not break an AI answer. */
export async function logAiCall(env: Env, c: { tool: string; model: string; ms: number; tokensIn: number; tokensOut: number; ok: boolean }): Promise<void> {
  try {
    const master = await masterId(env);
    if (!master) return;
    const day = dayKey();
    await add(env, master, c.tool, c.model, "n", 1, day);
    if (c.ok) await add(env, master, c.tool, c.model, "ok", 1, day);
    await add(env, master, c.tool, c.model, "ms", c.ms, day);
    await add(env, master, c.tool, c.model, "in", c.tokensIn, day);
    await add(env, master, c.tool, c.model, "out", c.tokensOut, day);
  } catch (err) {
    console.error("ai log failed", String(err));
  }
}

/** A thumbs up or down on an answer. The reason (for a thumbs down) is one of a fixed list. */
export async function rateAiAnswer(env: Env, r: { tool: string; model: string; rating: "up" | "down"; reason?: string }): Promise<boolean> {
  try {
    const master = await masterId(env);
    if (!master) return false;
    const day = dayKey();
    await add(env, master, r.tool, r.model, r.rating, 1, day);
    if (r.rating === "down" && (REASONS as readonly string[]).includes(r.reason ?? "")) await add(env, master, r.tool, r.model, `down_${r.reason}`, 1, day);
    return true;
  } catch (err) {
    console.error("ai rating failed", String(err));
    return false;
  }
}

export interface ScoreRow { quality: number | null; qn: number; wins: number; tool: string; model: string; calls: number; ok: number; errorPct: number; avgMs: number; tokensIn: number; tokensOut: number; costCents: number | null; costPerCallCents: number | null; up: number; down: number; thumbsUpPct: number | null; reasons: Record<string, number> }

/** Folds the counters into one row per tool and model. Pure, so it can be tested. */
export function foldScorecard(rows: { feature: string; n: number }[]): ScoreRow[] {
  const m = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const p = r.feature.split(":"); // ailog, tool, model, metric
    if (p.length !== 4 || p[0] !== "ailog") continue;
    const k = `${p[1]}\u0000${p[2]}`;
    const o = m.get(k) ?? {};
    o[p[3]] = (o[p[3]] ?? 0) + Number(r.n);
    m.set(k, o);
  }
  const out: ScoreRow[] = [];
  for (const [k, o] of m) {
    const [tool, model] = k.split("\u0000");
    const calls = o.n ?? 0, ok = o.ok ?? 0, up = o.up ?? 0, down = o.down ?? 0;
    const price = AI_PRICES[model];
    const costCents = price ? Math.round((((o.in ?? 0) * price[0] + (o.out ?? 0) * price[1]) / 1_000_000) * 100 * 100) / 100 : null;
    const reasons: Record<string, number> = {};
    for (const key of Object.keys(o)) if (key.startsWith("down_")) reasons[key.slice(5)] = o[key];
    out.push({ quality: o.qn ? Math.round((o.qsum / o.qn) * 10) / 10 : null, qn: o.qn ?? 0, wins: o.win ?? 0, tool, model, calls, ok, errorPct: calls ? Math.round(((calls - ok) / calls) * 1000) / 10 : 0, avgMs: calls ? Math.round((o.ms ?? 0) / calls) : 0, tokensIn: o.in ?? 0, tokensOut: o.out ?? 0, costCents, costPerCallCents: costCents !== null && calls ? Math.round((costCents / calls) * 1000) / 1000 : null, up, down, thumbsUpPct: up + down ? Math.round((up / (up + down)) * 100) : null, reasons });
  }
  return out.sort((a, b) => b.calls - a.calls);
}

/** The scorecard for the last `days` days (today included). */
export async function aiScorecard(env: Env, from: string): Promise<ScoreRow[]> {
  const master = await masterId(env);
  if (!master) return [];
  const rows = await env.DB.prepare("SELECT feature, SUM(count) AS n FROM usage_counters WHERE company_id = ? AND feature LIKE 'ailog:%' AND period >= ? GROUP BY feature").bind(master, from).all<{ feature: string; n: number }>();
  return foldScorecard(rows.results ?? []);
}

/** Today's totals for the AI health card. */
export async function aiToday(env: Env, today: string) {
  const rows = await aiScorecard(env, today);
  const sum = (f: (r: ScoreRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const calls = sum((r) => r.calls);
  return { calls, errors: calls - sum((r) => r.ok), costCents: Math.round(sum((r) => r.costCents ?? 0) * 100) / 100, unpriced: rows.some((r) => r.costCents === null), killSwitch: env.AI_KILL_SWITCH === "1", slow: rows.filter((r) => r.avgMs > 8000).map((r) => `${r.tool}/${r.model}`) };
}

/** A 1 to 5 quality score the owner gave in a blind side-by-side test (win = this answer was picked best). */
export async function recordQuality(env: Env, r: { tool: string; model: string; score: number; win: boolean }): Promise<boolean> {
  try {
    const master = await masterId(env);
    if (!master) return false;
    const score = Math.min(5, Math.max(1, Math.round(r.score)));
    const day = dayKey();
    await add(env, master, r.tool, r.model, "qsum", score, day);
    await add(env, master, r.tool, r.model, "qn", 1, day);
    if (r.win) await add(env, master, r.tool, r.model, "win", 1, day);
    return true;
  } catch (err) {
    console.error("ai quality failed", String(err));
    return false;
  }
}
