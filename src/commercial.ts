import { effectivePlan, type Plan } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Commercial bids: Free and Starter cannot save one, Basic gets ONE free try (to taste it and win a job), Pro is unlimited.
 * The try counts commercial jobs that already have an estimate. A job that already has its own estimate can always be edited and sent.
 * The 14-day free trial counts as Basic.
 */
export const COMMERCIAL_LIMIT: Record<Plan, number> = { free: 0, starter: 0, basic: 1, pro: Number.POSITIVE_INFINITY };

export interface CommercialStatus {
  limit: number | null; // null = unlimited
  used: number;
  allowed: boolean;
  plan: Plan;
}

export function commercialStatus(plan: Plan, usedOtherJobs: number, thisJobHasEstimate: boolean): CommercialStatus {
  const limit = COMMERCIAL_LIMIT[plan];
  return { limit: Number.isFinite(limit) ? limit : null, used: usedOtherJobs, allowed: thisJobHasEstimate || usedOtherJobs < limit, plan };
}

export async function loadCommercialStatus(env: Env, companyId: number, jobId: number): Promise<CommercialStatus> {
  const co = await env.DB.prepare("SELECT plan, created_at AS createdAt FROM companies WHERE id = ?").bind(companyId).first<{ plan: string; createdAt: string }>();
  const plan = effectivePlan({ plan: co?.plan ?? "free", createdAt: co?.createdAt });
  const used = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM jobs j WHERE j.company_id = ? AND j.trade = 'commercial' AND j.id != ?
       AND EXISTS (SELECT 1 FROM documents d WHERE d.job_id = j.id AND d.kind = 'estimate')`,
  ).bind(companyId, jobId).first<{ n: number }>();
  const own = await env.DB.prepare("SELECT 1 AS x FROM documents WHERE job_id = ? AND company_id = ? AND kind = 'estimate' LIMIT 1").bind(jobId, companyId).first();
  return commercialStatus(plan, used?.n ?? 0, !!own);
}

export function commercialBlockedMessage(s: CommercialStatus): string {
  return s.limit === 0
    ? "Commercial bids are on the Basic and Pro plans."
    : "You have used your free commercial bid. Pro includes unlimited commercial bids.";
}
