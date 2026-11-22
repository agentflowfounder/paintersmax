import { sendLeadEmail } from "./email.ts";
import { todayLocal } from "./dates.ts";
import { LAST_BACKUP_KEY } from "./backup.ts";
import { readBlob, writeBlob } from "./kv.ts";
import { HELD_KEY, loadStarter, readHeld, signupsThisWeek } from "./starter.ts";
import type { Env } from "./types.ts";

/**
 * Monday summary for the owner: last week's new accounts by source, tier and how they heard, and how many welcome
 * credits went out. Goes to the PaintersMax owner login(s) at 8 AM Texas time on Mondays, once a week ("weeklysent").
 * On by default (it only goes to the owner); the owner can turn it off in Admin > Starter campaign.
 */

export function summaryEmail(t: { total: number; bySource: { name: string; count: number }[]; byDoor: { name: string; count: number }[]; byHeard: { name: string; count: number }[] }, held: number): { subject: string; body: string } {
  const DN: Record<string, string> = { free: "Free", launch: "Local Pro", grow: "Contractor", signature: "Commercial" };
  const lines = (a: { name: string; count: number }[], f: (n: string) => string = (n) => n) => (a.length ? a.map((x) => `  ${f(x.name)}: ${x.count}`).join("\n") : "  none");
  return {
    subject: `PaintersMax: ${t.total} new ${t.total === 1 ? "account" : "accounts"} last week`,
    body: `New accounts in the last 7 days: ${t.total}\n\nBy source:\n${lines(t.bySource)}\n\nBy tier picked:\n${lines(t.byDoor, (n) => DN[n] ?? n)}\n\nHow they heard about us:\n${lines(t.byHeard)}\n\nWelcome credits waiting for tomorrow: ${held}\n\nOpen the details: https://paintersmax.app/admin\n`,
  };
}

/** One closing line for the Monday email: when the owner last downloaded a database backup. */
export async function backupLine(env: Env, today: string): Promise<string> {
  const last = await readBlob(env, LAST_BACKUP_KEY, (raw: any) => (typeof raw?.on === "string" ? raw.on : ""));
  const ago = last ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000) : -1;
  if (ago < 0) return "\n\nDatabase backup: none downloaded yet. Admin > Team and audit log > Database backup.";
  if (ago > 7) return `\n\nDatabase backup: last downloaded ${ago} days ago. Please download a new one in Admin > Team and audit log.`;
  return `\n\nDatabase backup: last downloaded ${ago} day${ago === 1 ? "" : "s"} ago.`;
}

/** Cron (Mondays, 8 AM Texas time). Returns true when the email went out. */
export async function sendWeeklySummary(env: Env, now: number = Date.now()): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const settings = await loadStarter(env);
  if (!settings.weeklySummary) return false;
  const today = todayLocal(now);
  const last = await readBlob(env, "weeklysent", (raw: any) => (typeof raw?.on === "string" ? raw.on : ""));
  if (last === today) return false;
  const owners = (await env.DB.prepare("SELECT u.email FROM users u JOIN companies c ON c.id = u.company_id WHERE c.slug = 'paintersmax-master' AND u.role = 'owner'").all<{ email: string }>()).results ?? [];
  if (!owners.length) return false;
  const t = await signupsThisWeek(env, today);
  const held = (await readBlob(env, HELD_KEY, readHeld)).length;
  const m = summaryEmail(t, held);
  m.body += await backupLine(env, today);
  let sent = false;
  for (const o of owners) if ((await sendLeadEmail(env, o.email, m.subject, m.body)) === "sent") sent = true;
  if (sent) await writeBlob(env, "weeklysent", { on: today });
  return sent;
}
