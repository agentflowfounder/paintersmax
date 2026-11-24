import { getSessionUser } from "./auth.ts";
import { loadJobFacts, type JobFacts } from "./analysis.ts";
import type { Env } from "./types.ts";

/**
 * Bid check and Compare my jobs: plain math on the painter's own finished jobs (no AI).
 *  GET  /api/bidcheck               -> { target, history }   history of the last 10 finished jobs
 *  POST /api/bidcheck {target}      -> saves the painter's target margin (percent, 5 to 80)
 *  GET  /api/comparejobs            -> { rows, byService, byMonth }
 * A finished job counts only when it has a price and at least one recorded cost, so a missing receipt never shows as profit.
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export const DEFAULT_TARGET = 30;
const key = (c: number) => `bidtarget:${c}`;

const priceOf = (f: JobFacts) => f.soldCents + f.changeCents;
const costOf = (f: JobFacts) => f.expenseCents + f.payCents;
const done = (f: JobFacts) => f.won && priceOf(f) > 0 && costOf(f) > 0;
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface BidHistory {
  jobs: number;
  avgMarginPct: number | null;
  avgPricePerHourCents: number | null;
  avgCrewCostPerHourCents: number | null;
  avgMaterialsPct: number | null;
}

/** Averages over the last 10 finished jobs (newest first by id). */
export function bidHistory(facts: JobFacts[]): BidHistory {
  const last = facts.filter(done).sort((a, b) => b.id - a.id).slice(0, 10);
  if (!last.length) return { jobs: 0, avgMarginPct: null, avgPricePerHourCents: null, avgCrewCostPerHourCents: null, avgMaterialsPct: null };
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const margin = avg(last.map((f) => (priceOf(f) - costOf(f)) / priceOf(f)));
  const timed = last.filter((f) => f.minutes > 0);
  const pph = avg(timed.map((f) => priceOf(f) / (f.minutes / 60)));
  const paid = timed.filter((f) => f.payCents > 0);
  const cph = avg(paid.map((f) => f.payCents / (f.minutes / 60)));
  const mat = avg(last.map((f) => f.materialsCents / priceOf(f)));
  return {
    jobs: last.length,
    avgMarginPct: margin === null ? null : r1(margin * 100),
    avgPricePerHourCents: pph === null ? null : Math.round(pph),
    avgCrewCostPerHourCents: cph === null ? null : Math.round(cph),
    avgMaterialsPct: mat === null ? null : r1(mat * 100),
  };
}

/**
 * A rough margin for a bid that is not done yet: crew cost from the painter's own cost per hour, materials from their own average share,
 * or the painter's own cost build when they typed one. Returns null when there is not enough to go on.
 */
export function projectMargin(i: { totalCents: number; hours: number; costBuildCents?: number }, h: BidHistory): { marginPct: number; basis: "cost_build" | "history" } | null {
  if (i.totalCents <= 0) return null;
  if (i.costBuildCents && i.costBuildCents > 0) return { marginPct: r1((100 * (i.totalCents - i.costBuildCents)) / i.totalCents), basis: "cost_build" };
  if (!h.jobs || h.avgCrewCostPerHourCents === null || i.hours <= 0) return null;
  const cost = i.hours * h.avgCrewCostPerHourCents + (i.totalCents * (h.avgMaterialsPct ?? 0)) / 100;
  return { marginPct: r1((100 * (i.totalCents - cost)) / i.totalCents), basis: "history" };
}

export interface CompareRow { id: number; trade: string; month: string; priceCents: number; costCents: number; profitCents: number; marginPct: number; hours: number; pricePerHourCents: number | null }

export function compareJobs(facts: JobFacts[]) {
  const rows: CompareRow[] = facts.filter(done).sort((a, b) => b.id - a.id).map((f) => {
    const price = priceOf(f), cost = costOf(f);
    const month = (f.endOn || f.startOn || f.createdAt || "").slice(0, 7);
    return { id: f.id, trade: f.trade, month, priceCents: price, costCents: cost, profitCents: price - cost, marginPct: r1((100 * (price - cost)) / price), hours: r1(f.minutes / 60), pricePerHourCents: f.minutes > 0 ? Math.round(price / (f.minutes / 60)) : null };
  });
  const group = (by: (r: CompareRow) => string) => {
    const m: Record<string, { jobs: number; priceCents: number; profitCents: number }> = {};
    for (const r of rows) {
      const k = by(r) || "Other";
      const g = (m[k] ??= { jobs: 0, priceCents: 0, profitCents: 0 });
      g.jobs++; g.priceCents += r.priceCents; g.profitCents += r.profitCents;
    }
    return Object.entries(m).map(([k, g]) => ({ key: k, ...g, marginPct: g.priceCents > 0 ? r1((100 * g.profitCents) / g.priceCents) : null }));
  };
  return {
    rows: rows.slice(0, 60),
    byService: group((r) => r.trade).sort((a, b) => b.profitCents - a.profitCents),
    byMonth: group((r) => r.month).sort((a, b) => a.key.localeCompare(b.key)).slice(-12),
  };
}

async function readTarget(env: Env, c: number): Promise<number> {
  try {
    const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key(c)).first<{ value: string }>();
    const n = Number(JSON.parse(r?.value ?? "{}").target);
    return n >= 5 && n <= 80 ? n : DEFAULT_TARGET;
  } catch {
    return DEFAULT_TARGET;
  }
}

export async function handleBidCheck(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  if (request.method === "POST") {
    let b: any;
    try { b = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
    const t = Math.round(Number(b?.target));
    if (!(t >= 5 && t <= 80)) return json({ error: "Pick a target between 5 and 80 percent." }, 400);
    await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key(c), JSON.stringify({ target: t })).run();
    return json({ ok: true, target: t });
  }
  const facts = await loadJobFacts(env, c);
  return json({ target: await readTarget(env, c), history: bidHistory(facts) });
}

export async function handleCompareJobs(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const facts = await loadJobFacts(env, user.companyId);
  const titles = new Map<number, string>();
  const t = await env.DB.prepare("SELECT id, title FROM jobs WHERE company_id = ? ORDER BY id DESC LIMIT 200").bind(user.companyId).all<{ id: number; title: string }>();
  for (const r of t.results ?? []) titles.set(r.id, r.title);
  const out = compareJobs(facts);
  return json({ ...out, rows: out.rows.map((r) => ({ ...r, title: titles.get(r.id) ?? `Job ${r.id}` })) });
}
