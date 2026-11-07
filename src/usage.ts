import type { Env } from "./types.ts";

export type Feature = "ai_quote" | "ai_estimate" | "ai_invoice" | "photo_tag" | "smart_select" | "hd_render";
export type Plan = "free" | "starter" | "basic" | "pro";

export const FEATURES: Feature[] = ["ai_quote", "ai_estimate", "ai_invoice", "photo_tag", "smart_select", "hd_render"];

/** Monthly allowance per plan. 0 means the plan does not include the feature. Adjust here as pricing is decided. */
export const PLAN_LIMITS: Record<Plan, Record<Feature, number>> = {
  free:    { ai_quote: 10,  ai_estimate: 3,  ai_invoice: 2,  photo_tag: 10,  smart_select: 0,   hd_render: 0 },
  starter: { ai_quote: 200, ai_estimate: 30, ai_invoice: 30, photo_tag: 100, smart_select: 100, hd_render: 0 },
  basic:   { ai_quote: 600, ai_estimate: 100, ai_invoice: 100, photo_tag: 400, smart_select: 400, hd_render: 20 },
  pro:     { ai_quote: 2000, ai_estimate: 400, ai_invoice: 400, photo_tag: 1500, smart_select: 1500, hd_render: 100 },
};

/** Per-visitor daily cap, so one person cannot burn a client's allowance. */
export const VISITOR_DAILY: Partial<Record<Feature, number>> = { smart_select: 10, hd_render: 3, ai_quote: 5 };

export const isFeature = (v: unknown): v is Feature => typeof v === "string" && (FEATURES as string[]).includes(v);
export const normalizePlan = (v: unknown): Plan => (v === "starter" || v === "basic" || v === "pro" ? v : "free");

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export type Consume =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; reason: "kill_switch" | "not_in_plan" | "monthly_limit" | "visitor_limit"; used: number; limit: number };

/** Adds 1 to a counter only if it stays within the limit. Returns the new count, or null when the limit is reached. */
async function bump(env: Env, companyId: number, feature: string, period: string, limit: number): Promise<number | null> {
  if (limit < 1) return null;
  const row = await env.DB.prepare(
    `INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + 1 WHERE count + 1 <= ?
     RETURNING count`,
  )
    .bind(companyId, feature, period, limit)
    .first<{ count: number }>();
  return row ? row.count : null;
}

/** Counts how often someone hit a limit, so the dashboard can show "missed" requests. */
async function recordMissed(env: Env, companyId: number, feature: Feature) {
  await env.DB.prepare(
    `INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + 1`,
  )
    .bind(companyId, `${feature}:missed`, monthKey())
    .run();
}

export async function consume(
  env: Env,
  company: { id: number; plan: string },
  feature: Feature,
  visitorHash?: string,
): Promise<Consume> {
  const limit = PLAN_LIMITS[normalizePlan(company.plan)][feature];
  if (env.AI_KILL_SWITCH === "1") return { allowed: false, reason: "kill_switch", used: 0, limit };
  if (limit < 1) {
    await recordMissed(env, company.id, feature);
    return { allowed: false, reason: "not_in_plan", used: 0, limit };
  }
  const vLimit = VISITOR_DAILY[feature];
  if (visitorHash && vLimit) {
    const v = await bump(env, company.id, `${feature}:v:${visitorHash}`, dayKey(), vLimit);
    if (v === null) return { allowed: false, reason: "visitor_limit", used: vLimit, limit: vLimit };
  }
  const used = await bump(env, company.id, feature, monthKey(), limit);
  if (used === null) {
    await recordMissed(env, company.id, feature);
    return { allowed: false, reason: "monthly_limit", used: limit, limit };
  }
  return { allowed: true, used, limit };
}

export async function usageSummary(env: Env, company: { id: number; plan: string }) {
  const month = monthKey();
  const rows = await env.DB.prepare(
    "SELECT feature, count FROM usage_counters WHERE company_id = ? AND period = ? AND feature NOT LIKE '%:v:%'",
  )
    .bind(company.id, month)
    .all<{ feature: string; count: number }>();
  const by = new Map(rows.results.map((r) => [r.feature, r.count]));
  const limits = PLAN_LIMITS[normalizePlan(company.plan)];
  return {
    plan: normalizePlan(company.plan),
    period: month,
    features: FEATURES.map((f) => ({ feature: f, used: by.get(f) ?? 0, limit: limits[f], missed: by.get(`${f}:missed`) ?? 0 })),
  };
}

/** Gives back one use after an AI call failed, so a failed render does not cost the client or the visitor. */
export async function refund(env: Env, company: { id: number }, feature: Feature, visitorHash?: string) {
  const dec = (f: string, period: string) =>
    env.DB.prepare("UPDATE usage_counters SET count = MAX(count - 1, 0) WHERE company_id = ? AND feature = ? AND period = ?")
      .bind(company.id, f, period)
      .run();
  await dec(feature, monthKey());
  if (visitorHash) await dec(`${feature}:v:${visitorHash}`, dayKey());
}
