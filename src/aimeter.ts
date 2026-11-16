import { todayLocal } from "./dates.ts";
import { masterCompanyId, readBlob, str, updateBlob } from "./kv.ts";
import type { Env } from "./types.ts";

/**
 * Real AI cost per client: every metered AI call adds its token counts (as the provider reports them) to a monthly
 * counter for the client, by model. Cost is tokens times the price per million tokens that the owner entered in admin.
 * No price is built in, so no number here is a guess: a model with no price shows tokens only.
 *
 * Counters live in usage_counters: feature "ai:in:<model>" and "ai:out:<model>", period YYYY-MM. Calls that belong to no client
 * (the public demo, help articles) are kept under the PaintersMax company. Which calls are metered: see METERED below.
 */

/** Calls that report tokens today. Not yet counted: the quote-request photo brief and summary (brief.ts, ai.ts). */
export const METERED = ["Help chat, job assistant, quick job questions, insurance Q&A, lessons, wizard assistant and the demo chat (text tools through assistant.ts)", "Photo analysis, receipt and statement reads, vehicle documents, insurance policy reads, color previews"];

export interface Price {
  inPerM: number; // US dollars per million input tokens
  outPerM: number; // US dollars per million output tokens
}
export const PRICES_KEY = "aiprices";
export function readPrices(raw: unknown): Record<string, Price> {
  const out: Record<string, Price> = {};
  if (raw && typeof raw === "object") {
    for (const [model, v] of Object.entries(raw as Record<string, any>)) {
      const i = Number(v?.inPerM);
      const o = Number(v?.outPerM);
      if (/^[A-Za-z0-9._:-]{2,80}$/.test(model) && Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0 && i <= 10000 && o <= 10000) out[model] = { inPerM: i, outPerM: o };
    }
  }
  return out;
}

/** Adds one call's tokens. Never throws: metering must not break an AI answer. */
export async function recordUse(env: Env, companyId: number | undefined, model: string, tokensIn: unknown, tokensOut: unknown): Promise<void> {
  const a = Math.max(0, Math.round(Number(tokensIn) || 0));
  const b = Math.max(0, Math.round(Number(tokensOut) || 0));
  if (!a && !b) return;
  const m = model.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 80);
  if (!m) return;
  const period = todayLocal().slice(0, 7);
  // Calls that belong to no client are kept under the PaintersMax company (company 0 would break the foreign key).
  const home = await masterCompanyId(env).catch(() => 0);
  const c = Number.isInteger(companyId) && (companyId as number) > 0 ? (companyId as number) : home;
  if (!c) return;
  const sql = "INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, ?, ?, ?) ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + excluded.count";
  try {
    await env.DB.batch([env.DB.prepare(sql).bind(c, `ai:in:${m}`, period, a), env.DB.prepare(sql).bind(c, `ai:out:${m}`, period, b)]);
  } catch (err) {
    console.error("ai meter failed", String(err));
  }
}

export interface ClientCost {
  companyId: number;
  name: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number | null; // null when any model used has no price
  models: { model: string; tokensIn: number; tokensOut: number; costCents: number | null }[];
}

export const costCents = (p: Price | undefined, tin: number, tout: number): number | null => (p ? Math.round(((tin * p.inPerM + tout * p.outPerM) / 1e6) * 100 * 100) / 100 : null);

export async function aiCostView(env: Env, month: string) {
  const period = /^\d{4}-\d{2}$/.test(month) ? month : todayLocal().slice(0, 7);
  const [prices, rows] = await Promise.all([
    readBlob(env, PRICES_KEY, readPrices),
    env.DB.prepare("SELECT company_id AS c, feature AS f, count AS n FROM usage_counters WHERE period = ? AND feature >= 'ai:' AND feature < 'ai;'").bind(period).all<{ c: number; f: string; n: number }>(),
  ]);
  const by = new Map<number, Map<string, { i: number; o: number }>>();
  for (const r of rows.results ?? []) {
    const m = /^ai:(in|out):(.+)$/.exec(r.f);
    if (!m) continue;
    const per = by.get(r.c) ?? new Map();
    const cur = per.get(m[2]) ?? { i: 0, o: 0 };
    if (m[1] === "in") cur.i += r.n;
    else cur.o += r.n;
    per.set(m[2], cur);
    by.set(r.c, per);
  }
  const home = await masterCompanyId(env).catch(() => 0);
  const ids = [...by.keys()].filter((c) => c > 0 && c !== home);
  const names = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const res = await env.DB.prepare(`SELECT id, name FROM companies WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).all<{ id: number; name: string }>();
    for (const c of res.results ?? []) names.set(c.id, c.name);
  }
  const clients: ClientCost[] = [...by.entries()].map(([companyId, per]) => {
    const models = [...per.entries()].map(([model, t]) => ({ model, tokensIn: t.i, tokensOut: t.o, costCents: costCents(prices[model], t.i, t.o) }));
    return {
      companyId: companyId === home ? 0 : companyId,
      name: companyId === home ? "Not tied to a client (demo, help articles)" : names.get(companyId) ?? `#${companyId}`,
      tokensIn: models.reduce((a, m) => a + m.tokensIn, 0),
      tokensOut: models.reduce((a, m) => a + m.tokensOut, 0),
      costCents: models.some((m) => m.costCents === null) ? null : Math.round(models.reduce((a, m) => a + (m.costCents ?? 0), 0) * 100) / 100,
      models,
    };
  });
  clients.sort((a, b) => (b.costCents ?? -1) - (a.costCents ?? -1) || b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut));
  const seen = [...new Set(clients.flatMap((c) => c.models.map((m) => m.model)))].sort();
  const priced = clients.filter((c) => c.costCents !== null);
  return {
    month: period,
    clients: clients.slice(0, 200),
    models: seen.map((model) => ({ model, price: prices[model] ?? null })),
    prices,
    totals: { tokensIn: clients.reduce((a, c) => a + c.tokensIn, 0), tokensOut: clients.reduce((a, c) => a + c.tokensOut, 0), costCents: clients.some((c) => c.costCents === null) ? null : Math.round(priced.reduce((a, c) => a + (c.costCents ?? 0), 0) * 100) / 100 },
    metered: METERED,
  };
}

/** Saves or removes the price per million tokens for one model. */
export async function setPrice(env: Env, b: any) {
  const model = str(b?.model, 80);
  if (!/^[A-Za-z0-9._:-]{2,80}$/.test(model)) return { ok: false as const, error: "Enter the model name exactly as the provider spells it." };
  const r = await updateBlob(env, PRICES_KEY, readPrices, (cur) => {
    const next = { ...cur };
    if (b?.remove === true) {
      delete next[model];
      return { value: next };
    }
    const i = Number(b?.inPerM);
    const o = Number(b?.outPerM);
    if (!(Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0 && i <= 10000 && o <= 10000)) return { error: "Enter the input and output price in dollars per million tokens (for example 0.8)." };
    next[model] = { inPerM: i, outPerM: o };
    return { value: next };
  });
  return r.ok ? { ok: true as const, model, removed: b?.remove === true } : { ok: false as const, error: r.error };
}
