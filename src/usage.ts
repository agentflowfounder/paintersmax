import type { Env } from "./types.ts";

export type Feature = "ai_quote" | "ai_estimate" | "ai_invoice" | "photo_tag" | "smart_select" | "hd_render" | "ai_assistant" | "insurance_scan" | "ai_detailed" | "photo_analysis" | "ai_deep" | "receipt_read" | "bank_read" | "quote_helper" | "estimate_draft" | "help_chat" | "vehicle_read";
export type Plan = "free" | "starter" | "basic" | "pro";

export const FEATURES: Feature[] = ["ai_quote", "ai_estimate", "ai_invoice", "photo_tag", "smart_select", "hd_render", "ai_assistant", "insurance_scan", "ai_detailed", "photo_analysis", "ai_deep", "receipt_read", "bank_read", "quote_helper", "estimate_draft", "help_chat", "vehicle_read"];

/** Monthly allowance per plan. 0 means the plan does not include the feature. Adjust here as pricing is decided. */
export const PLAN_LIMITS: Record<Plan, Record<Feature, number>> = {
  free:    { ai_quote: 10,  ai_estimate: 3,  ai_invoice: 2,  photo_tag: 10,  smart_select: 0,   hd_render: 0,  ai_assistant: 15, insurance_scan: 1, ai_detailed: 0, photo_analysis: 3, ai_deep: 0, receipt_read: 5, bank_read: 1, quote_helper: 1, estimate_draft: 2, help_chat: 20, vehicle_read: 2 },
  starter: { ai_quote: 200, ai_estimate: 30, ai_invoice: 30, photo_tag: 100, smart_select: 100, hd_render: 0,  ai_assistant: 150, insurance_scan: 3, ai_detailed: 10, photo_analysis: 10, ai_deep: 2, receipt_read: 15, bank_read: 3, quote_helper: 5, estimate_draft: 15, help_chat: 60, vehicle_read: 6 },
  basic:   { ai_quote: 600, ai_estimate: 100, ai_invoice: 100, photo_tag: 400, smart_select: 400, hd_render: 20, ai_assistant: 600, insurance_scan: 8, ai_detailed: 40, photo_analysis: 40, ai_deep: 10, receipt_read: 60, bank_read: 10, quote_helper: 20, estimate_draft: 60, help_chat: 150, vehicle_read: 20 },
  pro:     { ai_quote: 2000, ai_estimate: 400, ai_invoice: 400, photo_tag: 1500, smart_select: 1500, hd_render: 100, ai_assistant: 3000, insurance_scan: 20, ai_detailed: 150, photo_analysis: 150, ai_deep: 40, receipt_read: 200, bank_read: 30, quote_helper: 60, estimate_draft: 200, help_chat: 400, vehicle_read: 60 },
};

/** Per-visitor daily cap, so one person cannot burn a client's allowance. */
// Raised for the testing period. Tighten once real usage numbers are known.
export const VISITOR_DAILY: Partial<Record<Feature, number>> = { smart_select: 10, hd_render: 3, ai_quote: 5, ai_estimate: 3 };

export const isFeature = (v: unknown): v is Feature => typeof v === "string" && (FEATURES as string[]).includes(v);
export const normalizePlan = (v: unknown): Plan => (v === "starter" || v === "basic" || v === "pro" ? v : "free");

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** New free companies get a trial: Basic-level limits for the first 14 days. Basic (not Pro) keeps worst-case AI cost small. */
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN: Plan = "basic";

/** Whole days left in a free company's trial (0 when it is over or does not apply). */
export function trialDaysLeft(company: { plan: string; createdAt?: string | null }, now = Date.now()): number {
  if (normalizePlan(company.plan) !== "free" || !company.createdAt) return 0;
  const start = Date.parse(company.createdAt.includes("T") ? company.createdAt : company.createdAt.replace(" ", "T") + "Z");
  if (!Number.isFinite(start)) return 0;
  const left = Math.ceil((start + TRIAL_DAYS * 86400000 - now) / 86400000);
  return left > 0 ? Math.min(left, TRIAL_DAYS) : 0;
}

/** The plan whose limits apply right now: the real plan, or Basic during the free trial. */
export function effectivePlan(company: { plan: string; createdAt?: string | null }, now = Date.now()): Plan {
  return trialDaysLeft(company, now) > 0 ? TRIAL_PLAN : normalizePlan(company.plan);
}

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
  company: { id: number; plan: string; createdAt?: string | null },
  feature: Feature,
  visitorHash?: string,
): Promise<Consume> {
  const limit = PLAN_LIMITS[effectivePlan(company)][feature];
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

export async function usageSummary(env: Env, company: { id: number; plan: string; createdAt?: string | null }) {
  const month = monthKey();
  const rows = await env.DB.prepare(
    "SELECT feature, count FROM usage_counters WHERE company_id = ? AND period = ? AND feature NOT LIKE '%:v:%'",
  )
    .bind(company.id, month)
    .all<{ feature: string; count: number }>();
  const by = new Map(rows.results.map((r) => [r.feature, r.count]));
  const limits = PLAN_LIMITS[effectivePlan(company)];
  return {
    plan: normalizePlan(company.plan),
    trialDaysLeft: trialDaysLeft(company),
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
