import { creditView } from "./credits.ts";
import { sendLeadEmail } from "./email.ts";
import { addDaysIso, friendlyDate, todayLocal } from "./dates.ts";
import { blobsWithPrefix, readBlob, writeBlob } from "./kv.ts";
import { loadStarter } from "./starter.ts";
import type { Env } from "./types.ts";

/**
 * Day-3 welcome email: three days after a free sign-up, one short email that points the painter at the first thing
 * worth trying with their welcome credits (their first estimate draft, or the next step if they already started a job).
 * It is OFF until the owner ticks it in Admin > Starter campaign. Each account gets it once ("day3:<companyId>").
 * The text says how to stop these tips (reply "no tips"); there is no marketing in it, only help for the account.
 */

export function day3Email(o: { es: boolean; company: string; credits: number; expiresOn: string; hasJob: boolean }): { subject: string; body: string } {
  const lang = o.es ? "es" : "en";
  const until = o.expiresOn ? friendlyDate(o.expiresOn, lang) : "";
  const url = "https://paintersmax.app/dashboard";
  if (o.es) {
    const body = o.hasJob
      ? `Hola,\n\nSu cuenta de ${o.company} ya tiene un trabajo empezado. Buen comienzo.\n\nSiguiente paso: pruebe una lectura de foto o plano. Abra el trabajo, suba una foto y la IA le ayuda a medir y a ver qué falta.\n\nLe quedan ${o.credits} créditos de bienvenida${until ? ` (se pueden usar hasta el ${until})` : ""}.\n\nAbrir PaintersMax: ${url}`
      : `Hola,\n\nHan pasado tres días desde que abrió la cuenta de ${o.company}. Una cosa que puede hacer hoy en unos minutos: su primer borrador de presupuesto.\n\n1. Abra PaintersMax y toque Trabajos, luego un trabajo nuevo.\n2. Describa el trabajo con sus palabras.\n3. Deje que la IA arme el borrador y revíselo antes de enviarlo.\n\nLe quedan ${o.credits} créditos de bienvenida${until ? ` (se pueden usar hasta el ${until})` : ""}. Un borrador cuesta 1 crédito.\n\nAbrir PaintersMax: ${url}`;
    return { subject: o.hasJob ? "Siguiente paso: lea una foto del trabajo" : "Pruebe su primer borrador de presupuesto", body: `${body}\n\nSi no quiere estos consejos, responda "no consejos" y los detenemos.\n\nPaintersMax` };
  }
  const body = o.hasJob
    ? `Hi,\n\nYour ${o.company} account already has a job started. Nice work.\n\nNext thing to try: a photo or blueprint read. Open the job, add a photo, and the AI helps you measure and spot what is missing.\n\nYou have ${o.credits} welcome credits left${until ? ` (good until ${until})` : ""}.\n\nOpen PaintersMax: ${url}`
    : `Hi,\n\nIt has been three days since you opened the ${o.company} account. One thing you can do today in a few minutes: your first estimate draft.\n\n1. Open PaintersMax and tap Jobs, then a new job.\n2. Describe the work in your own words.\n3. Let the AI build the draft and review it before you send it.\n\nYou have ${o.credits} welcome credits left${until ? ` (good until ${until})` : ""}. A draft costs 1 credit.\n\nOpen PaintersMax: ${url}`;
  return { subject: o.hasJob ? "Next up: read a job photo" : "Try your first estimate draft", body: `${body}\n\nDon't want tips like this? Reply "no tips" and we will stop.\n\nPaintersMax` };
}

/** Which sign-ups are due: three or more days old (up to a week, in case a run was missed) and not sent yet. */
export function day3Due(rows: { companyId: number; on: string }[], sent: Set<number>, today: string): number[] {
  const newest = addDaysIso(today, -3), oldest = addDaysIso(today, -6);
  return rows.filter((r) => r.on <= newest && r.on >= oldest && !sent.has(r.companyId)).map((r) => r.companyId);
}

/** Cron (once a day, 9 AM Texas time). Returns how many emails went out. */
export async function sendDay3Emails(env: Env, now: number = Date.now()): Promise<number> {
  if (!env.RESEND_API_KEY) return 0;
  const settings = await loadStarter(env);
  if (!settings.day3Email) return 0;
  const today = todayLocal(now);
  const signups = (await blobsWithPrefix(env, "signup:", 5000)).map((b) => ({ companyId: Number(b.key.slice(7)), on: String((b.value as any)?.on ?? ""), lang: (b.value as any)?.lang === "es" }));
  const sent = new Set((await blobsWithPrefix(env, "day3:", 5000)).map((b) => Number(b.key.slice(5))));
  const due = day3Due(signups, sent, today).slice(0, 100);
  let n = 0;
  for (const id of due) {
    const co = await env.DB.prepare("SELECT c.name AS name, (SELECT email FROM users WHERE company_id = c.id ORDER BY id LIMIT 1) AS email, (SELECT COUNT(*) FROM jobs WHERE company_id = c.id) AS jobs FROM companies c WHERE c.id = ?").bind(id).first<{ name: string; email: string | null; jobs: number }>();
    if (!co?.email) continue;
    const bal = await creditView(env, id, today);
    if (bal.balance <= 0) { await writeBlob(env, `day3:${id}`, { on: today, skipped: "no credits" }); continue; }
    const t = day3Email({ es: !!signups.find((s) => s.companyId === id)?.lang, company: co.name, credits: bal.balance, expiresOn: bal.nextExpiry?.on ?? "", hasJob: co.jobs > 0 });
    if ((await sendLeadEmail(env, co.email, t.subject, t.body)) !== "sent") continue;
    await writeBlob(env, `day3:${id}`, { on: today });
    n++;
  }
  return n;
}
