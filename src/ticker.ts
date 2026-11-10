import type { Env } from "./types.ts";

/**
 * The live stats ticker shown on the public homepage. Every number is counted from the real database,
 * across all client companies except the owner's own template company. Nothing is estimated or invented.
 * The owner picks which stats show, and can switch the whole ticker on or off, from the admin page.
 */

const NOT_MASTER = "company_id NOT IN (SELECT id FROM companies WHERE slug = 'paintersmax-master')";

export interface StatDef {
  key: string;
  label: string; // sentence shown after the number
  admin: string; // short name in the admin list
  kind: "count" | "money";
  sql: string;
}

export const STATS: StatDef[] = [
  { key: "leads_total", label: "leads captured for painters", admin: "Leads captured (all time)", kind: "count", sql: `SELECT COUNT(*) AS n FROM leads WHERE ${NOT_MASTER}` },
  { key: "leads_30d", label: "new leads in the last 30 days", admin: "Leads, last 30 days", kind: "count", sql: `SELECT COUNT(*) AS n FROM leads WHERE ${NOT_MASTER} AND created_at >= datetime('now','-30 days')` },
  { key: "quotes_total", label: "instant quotes given to homeowners", admin: "Instant quotes given", kind: "count", sql: `SELECT COUNT(*) AS n FROM quotes WHERE ${NOT_MASTER}` },
  { key: "work_won_cents", label: "in estimates signed by customers", admin: "Work won (signed estimates, $)", kind: "money", sql: `SELECT COALESCE(SUM(json_extract(body,'$.totals.totalCents')),0) AS n FROM documents WHERE kind = 'estimate' AND status = 'signed' AND ${NOT_MASTER}` },
  { key: "work_completed_cents", label: "in finished and paid jobs", admin: "Completed work (closed jobs, $)", kind: "money", sql: `SELECT COALESCE(SUM(json_extract(d.body,'$.totals.totalCents')),0) AS n FROM documents d JOIN jobs j ON j.id = d.job_id WHERE d.kind = 'estimate' AND j.stage = 'closed' AND d.${NOT_MASTER}` },
  { key: "signed_total", label: "documents signed online", admin: "Documents signed online", kind: "count", sql: `SELECT COUNT(*) AS n FROM signature_requests WHERE status = 'signed' AND ${NOT_MASTER}` },
  { key: "companies_total", label: "painting companies on PaintersMax", admin: "Painting companies (all time)", kind: "count", sql: `SELECT COUNT(*) AS n FROM companies WHERE slug != 'paintersmax-master'` },
  { key: "companies_30d", label: "new companies joined in the last 30 days", admin: "New companies, last 30 days", kind: "count", sql: `SELECT COUNT(*) AS n FROM companies WHERE slug != 'paintersmax-master' AND created_at >= datetime('now','-30 days')` },
  { key: "jobs_total", label: "jobs managed", admin: "Jobs managed", kind: "count", sql: `SELECT COUNT(*) AS n FROM jobs WHERE ${NOT_MASTER}` },
  { key: "documents_total", label: "estimates, contracts and invoices created", admin: "Documents created", kind: "count", sql: `SELECT COUNT(*) AS n FROM documents WHERE kind IN ('estimate','contract','invoice') AND ${NOT_MASTER}` },
  { key: "assistant_questions", label: "job assistant questions answered", admin: "Job assistant questions", kind: "count", sql: `SELECT COALESCE(SUM(count),0) AS n FROM usage_counters WHERE feature = 'ai_assistant' AND ${NOT_MASTER}` },
];

export interface TickerConfig {
  enabled: boolean;
  stats: string[]; // keys, in display order
  minValue: number; // hide a stat until it reaches this number (dollars for money stats). 0 = always show.
}

export const DEFAULT_CONFIG: TickerConfig = { enabled: false, stats: ["leads_total", "work_won_cents", "companies_total"], minValue: 0 };

export function sanitizeTickerConfig(input: any): TickerConfig {
  const known = new Set(STATS.map((s) => s.key));
  const stats = Array.isArray(input?.stats) ? [...new Set<string>(input.stats.filter((k: unknown) => typeof k === "string" && known.has(k)))] : DEFAULT_CONFIG.stats;
  const min = Number(input?.minValue);
  return { enabled: input?.enabled === true, stats: stats.slice(0, STATS.length), minValue: Number.isFinite(min) && min > 0 ? Math.min(Math.floor(min), 1_000_000) : 0 };
}

export function formatStat(def: StatDef, raw: number): string {
  if (def.kind === "money") {
    const d = raw / 100;
    if (d >= 1_000_000) return "$" + (d / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    return "$" + Math.round(d).toLocaleString("en-US");
  }
  return Math.round(raw).toLocaleString("en-US");
}

export async function loadConfig(env: Env): Promise<TickerConfig> {
  try {
    const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'ticker'").first<{ value: string }>();
    return r ? sanitizeTickerConfig(JSON.parse(r.value)) : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG; // table not created yet
  }
}

export async function saveConfig(env: Env, input: unknown): Promise<TickerConfig> {
  const cfg = sanitizeTickerConfig(input);
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('ticker', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(cfg))
    .run();
  return cfg;
}

/** Current value of every stat. A stat whose query fails is left out rather than guessed. */
export async function computeStats(env: Env, keys?: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const s of STATS) {
    if (keys && !keys.includes(s.key)) continue;
    try {
      const r = await env.DB.prepare(s.sql).first<{ n: number }>();
      out[s.key] = Number(r?.n ?? 0);
    } catch (err) {
      console.error("stat failed", s.key, String(err));
    }
  }
  return out;
}

export function buildItems(cfg: TickerConfig, values: Record<string, number>) {
  return cfg.stats.flatMap((k) => {
    const def = STATS.find((s) => s.key === k);
    const raw = values[k];
    if (!def || raw === undefined) return [];
    const compare = def.kind === "money" ? raw / 100 : raw;
    if (compare < cfg.minValue || raw <= 0) return [];
    return [{ key: k, value: formatStat(def, raw), label: def.label }];
  });
}

/** GET /api/ticker. Public. Returns nothing but {enabled:false} while the ticker is off. */
export async function handlePublicTicker(env: Env): Promise<Response> {
  const cfg = await loadConfig(env);
  const headers = { "content-type": "application/json", "cache-control": "public, max-age=15" };
  if (!cfg.enabled || !cfg.stats.length) return new Response(JSON.stringify({ enabled: false }), { headers });
  const items = buildItems(cfg, await computeStats(env, cfg.stats));
  return new Response(JSON.stringify({ enabled: items.length > 0, items }), { headers });
}

/** For the admin page: the settings, every stat with its current value, and what the ticker would show now. */
export async function adminTickerView(env: Env) {
  const cfg = await loadConfig(env);
  const values = await computeStats(env);
  return {
    config: cfg,
    catalog: STATS.map((s) => ({ key: s.key, name: s.admin, kind: s.kind, current: values[s.key] === undefined ? null : formatStat(s, values[s.key]) })),
    preview: buildItems(cfg, values),
  };
}
