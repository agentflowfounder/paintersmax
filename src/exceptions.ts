import { aiScorecard } from "./ailog.ts";
import { blobsWithPrefix } from "./kv.ts";
import { doorFor, readDoorRecord } from "./sitecore.ts";
import { allSubs } from "./subscriptions.ts";
import { normalizePlan } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Admin > Clients > "Needs attention": the few things that need a human, in one list, so the owner only monitors.
 *  - AI tools that failed 10% of the time or more in the last 7 days (at least 3 calls; PR #21 call log is the source).
 *  - Payments: missed yearly renewals and monthly allowances that are past due.
 *  - Sites: a paid client whose website was never published 7 days after sign-up, or not published in 60 days.
 */
export interface ExceptionItem { kind: "ai" | "payment" | "site"; title: string; detail: string; companyId?: number; severity: "high" | "medium" }

/** AI tools with a high failure rate. Pure so it can be tested. */
export function aiExceptions(rows: { tool: string; model: string; calls: number; ok: number; errorPct: number }[]): ExceptionItem[] {
  return rows.filter((r) => r.calls >= 3 && r.errorPct >= 10).map((r) => ({ kind: "ai" as const, title: `${r.tool} (${r.model}) is failing`, detail: `${r.calls - r.ok} of ${r.calls} calls failed in the last 7 days (${r.errorPct}%).`, severity: r.errorPct >= 30 ? ("high" as const) : ("medium" as const) }));
}

/** A site is stuck when the client pays but nothing is live. `ageDays` is days since the account was created. */
export function siteStuck(door: string, publishedAt: string | null, ageDays: number, today: string): string | null {
  if (door === "free") return null;
  if (!publishedAt) return ageDays >= 7 ? `Paid ${door} client, website never published (${ageDays} days since sign-up).` : null;
  const gap = Math.round((Date.parse(today) - Date.parse(publishedAt.slice(0, 10))) / 86400000);
  return gap > 60 ? `Website not published for ${gap} days.` : null;
}

export async function exceptionList(env: Env, today: string): Promise<ExceptionItem[]> {
  const out: ExceptionItem[] = [];
  const back = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  out.push(...aiExceptions(await aiScorecard(env, back)));

  const subs = await allSubs(env, today);
  const names = new Map(subs.map((s) => [s.companyId, s.name]));
  for (const s of subs) if (s.state === "missed") out.push({ kind: "payment", title: `${s.name}: renewal missed`, detail: `Renewal was due ${s.renewsOn}. Contact them from the Subscriptions tab.`, companyId: s.companyId, severity: "high" });
  for (const r of await blobsWithPrefix(env, "allow:", 10000)) {
    if (!/^\d+$/.test(r.key.slice(6))) continue;
    if ((r.value as any)?.status === "past_due") out.push({ kind: "payment", title: `${names.get(Number(r.key.slice(6))) ?? `Client #${r.key.slice(6)}`}: monthly credits payment failed`, detail: "Stripe could not charge the monthly allowance.", companyId: Number(r.key.slice(6)), severity: "high" });
  }

  const companies = (await env.DB.prepare("SELECT id, name, slug, plan, created_at FROM companies WHERE slug != 'paintersmax-master' AND slug NOT LIKE 'demo-%' ORDER BY id DESC LIMIT 500").all<{ id: number; name: string; slug: string; plan: string; created_at: string }>()).results ?? [];
  const doors = new Map((await blobsWithPrefix(env, "sitedoor:", 10000)).map((r) => [Number(r.key.slice(9)), r.value]));
  const live = new Map((await blobsWithPrefix(env, "sitelive:", 10000)).map((r) => [Number(r.key.slice(9)), (r.value as any)?.publishedAt as string | undefined]));
  for (const c of companies) {
    const door = doorFor(normalizePlan(c.plan), readDoorRecord(doors.get(c.id) ?? null));
    const age = Math.max(0, Math.round((Date.parse(today) - Date.parse(String(c.created_at).slice(0, 10))) / 86400000));
    const why = siteStuck(door, live.get(c.id) ?? null, Number.isFinite(age) ? age : 0, today);
    if (why) out.push({ kind: "site", title: `${c.name}: website needs a look`, detail: why, companyId: c.id, severity: "medium" });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}
