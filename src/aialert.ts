import { aiToday } from "./ailog.ts";
import { sendLeadEmail } from "./email.ts";
import { readBlob, writeBlob } from "./kv.ts";
import { dayKey } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Daily AI spend alert. The AI call log gives an estimated cost for today; the owner gets an email at 50%, 80% and 100%
 * of a daily limit (default $5, set in Admin > AI health). Each level is sent once a day. It only warns: it does not pause
 * the AI (the kill switch AI_KILL_SWITCH=1 does that).
 */
export const ALERT_KEY = "aialert";
export const ALERT_LEVELS = [50, 80, 100] as const;
export const DEFAULT_DAILY_CENTS = 500;

export interface AlertState { dailyCents: number; day: string; sent: number[] }
export const readAlert = (raw: unknown): AlertState => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cents = Math.round(Number(r.dailyCents));
  return {
    dailyCents: Number.isFinite(cents) && cents >= 100 && cents <= 1_000_000 ? cents : DEFAULT_DAILY_CENTS,
    day: typeof r.day === "string" ? r.day : "",
    sent: Array.isArray(r.sent) ? r.sent.filter((n): n is number => (ALERT_LEVELS as readonly number[]).includes(n as number)) : [],
  };
};

/** Which alert levels are newly crossed (not yet sent today). Pure. */
export function newLevels(spentCents: number, limitCents: number, sent: number[]): number[] {
  if (limitCents <= 0) return [];
  const pct = (spentCents / limitCents) * 100;
  return ALERT_LEVELS.filter((l) => pct >= l && !sent.includes(l));
}

export function alertEmail(level: number, spentCents: number, limitCents: number): { subject: string; body: string } {
  const d = (c: number) => `$${(c / 100).toFixed(2)}`;
  return {
    subject: `PaintersMax AI spend: ${level}% of today's limit`,
    body: `Estimated AI spend today is ${d(spentCents)}, which is ${level}% of your daily limit of ${d(limitCents)}.\n\n${level >= 100 ? "The limit is passed. AI keeps running; nothing was paused. To stop all AI at once, set AI_KILL_SWITCH to 1 in the Cloudflare settings.\n\n" : ""}See Admin > AI health for which tools and models cost the most. The figure is an estimate from the size of each request; your provider dashboards show the real bill.`,
  };
}

/** Cron (every 5 minutes). Returns the levels it emailed. */
export async function checkAiSpend(env: Env): Promise<number[]> {
  if (!env.RESEND_API_KEY) return [];
  const day = dayKey();
  const st = await readBlob(env, ALERT_KEY, readAlert);
  const sent = st.day === day ? st.sent : [];
  const t = await aiToday(env, day);
  const levels = newLevels(t.costCents, st.dailyCents, sent);
  if (!levels.length) return [];
  const owners = (await env.DB.prepare("SELECT u.email FROM users u JOIN companies c ON c.id = u.company_id WHERE c.slug = 'paintersmax-master' AND u.role = 'owner'").all<{ email: string }>()).results ?? [];
  if (!owners.length) return [];
  const m = alertEmail(Math.max(...levels), t.costCents, st.dailyCents);
  let ok = false;
  for (const o of owners) if ((await sendLeadEmail(env, o.email, m.subject, m.body)) === "sent") ok = true;
  if (!ok) return [];
  await writeBlob(env, ALERT_KEY, { ...st, day, sent: [...sent, ...levels] });
  return levels;
}
