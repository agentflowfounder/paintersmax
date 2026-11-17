import { addDaysIso, todayLocal } from "./dates.ts";
import { sendLeadEmail, SUPPORT_ADDRESS } from "./email.ts";
import { loadHeld, REUSE_AFTER_DAYS, type HeldDomain } from "./helddomains.ts";
import { isDate, readBlob, str, updateBlob, writeBlob } from "./kv.ts";
import { allSubs } from "./subscriptions.ts";
import type { Env } from "./types.ts";

/**
 * Two emails to a client who cancelled (or was refunded) and whose domain we hold.
 *  Day 1  after the cancel date: the domain is held for you, here is what happens.
 *  Day 25 after the cancel date: it can be used again on {reuse_date} (cancel date + 30 days), with a return offer.
 * Wording is Rogelio's (2026-11-16). Per his answer the same day, the website stays online until the domain's expiry date,
 * because the setup fee already paid for the domain and the hosting. Emails come from PaintersMax and are signed with the
 * name set in Admin > Domains (the employee assigned), or "The PaintersMax team" when none is set.
 * Emails are OFF until the owner switches them on. Each domain gets each email once (record dmsent:<companyId>:<domain>).
 * Only held domains with status "active" and a client are covered, and never the client's own transfer requests.
 */

export const DM_SETTINGS_KEY = "dmsettings";
export const DAY_FIRST = 1;
export const DAY_REMINDER = 25;
const SITE = "https://paintersmax.app";

export interface DmSettings {
  emailsOn: boolean;
  signer: string; // the employee's name, shown as "Name, PaintersMax"
  loginLink: string;
  supportEmail: string;
  setBy: string;
  setOn: string;
}
export function readDmSettings(raw: unknown): DmSettings {
  const r = (raw ?? {}) as any;
  const link = str(r.loginLink, 200);
  return {
    emailsOn: r.emailsOn === true,
    signer: str(r.signer, 60),
    loginLink: /^https:\/\/[^\s]+$/.test(link) ? link : `${SITE}/login`,
    supportEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(r.supportEmail, 120)) ? str(r.supportEmail, 120) : SUPPORT_ADDRESS,
    setBy: str(r.setBy, 120),
    setOn: isDate(r.setOn) ? r.setOn : "",
  };
}
export const loadDmSettings = (env: Env) => readBlob(env, DM_SETTINGS_KEY, readDmSettings);
export async function saveDmSettings(env: Env, b: any, by: string, today: string) {
  const r = await updateBlob(env, DM_SETTINGS_KEY, readDmSettings, (cur) => {
    const next = readDmSettings({
      emailsOn: b?.emailsOn === undefined ? cur.emailsOn : b.emailsOn === true,
      signer: b?.signer === undefined ? cur.signer : b.signer,
      loginLink: b?.loginLink === undefined || b.loginLink === "" ? cur.loginLink : b.loginLink,
      supportEmail: b?.supportEmail === undefined || b.supportEmail === "" ? cur.supportEmail : b.supportEmail,
      setBy: by,
      setOn: today,
    });
    if (b?.loginLink && next.loginLink !== str(b.loginLink, 200)) return { error: "The sign-in link must start with https://." };
    if (b?.supportEmail && next.supportEmail !== str(b.supportEmail, 120)) return { error: "Enter a valid support email address." };
    return { value: next };
  });
  return r.ok ? { ok: true as const, settings: r.value } : { ok: false as const, error: r.error };
}

export interface Fields {
  first_name: string;
  business: string;
  domain: string;
  cancel_date: string;
  reuse_date: string;
  expiry_date: string;
  login_link: string;
  support_email: string;
  signer: string;
}
const fill = (t: string, f: Fields) => t.replace(/\{(\w+)\}/g, (m, k) => (k in f ? (f as any)[k] : m));
const signoff = (f: Fields) => (f.signer ? `${f.signer}\nPaintersMax` : "The PaintersMax team");

/** What a returning client still has. Edit this list to change Email 2. */
export const RETURN_BENEFITS = [
  "Your free PaintersMax account stays open. Your customer list and job records are still there, and your AI Instant Quote form link keeps working.",
  "You can buy a set of AI credits any time you need them or run out. Small top-ups start at $5, so you only pay for what you use.",
  "Start a new plan and your website and domain come back, with your pages, photos and quote form.",
  "Estimates, invoices, job tracking and customer reminders in one place, in English and Spanish.",
];

export function firstEmail(f: Fields): { subject: string; text: string } {
  return {
    subject: fill("Your website {domain} is on hold for you", f),
    text: fill(
      [
        "Hi {first_name},",
        "",
        "We have cancelled the PaintersMax plan for {business}. Thank you for trying us.",
        "",
        "Your domain, {domain}, is still safe with us. Here is what that means:",
        "",
        "- Your website stays online until {expiry_date}, the end of the year your domain is already paid for.",
        "- We are holding {domain} so nobody else can take it.",
        "- You can start a new plan and use it again starting {reuse_date}.",
        "- If you would rather move the domain somewhere else, reply to this email and we will walk you through it.",
        "",
        "Your customer list and job records stay yours. You can sign in any time at {login_link} to download them.",
        "",
        "Questions? Reply to this email or write {support_email}.",
        "",
      ].join("\n"),
      f,
    ) + signoff(f),
  };
}

export function reminderEmail(f: Fields): { subject: string; text: string } {
  return {
    subject: fill("{domain} is ready to use again on {reuse_date}", f),
    text: fill(
      [
        "Hi {first_name},",
        "",
        "A quick note about {domain}. On {reuse_date} you can bring your website back with a new PaintersMax plan.",
        "",
        "- Start a plan at {login_link} and we will point {domain} at your site again.",
        "- Want to move the domain to another company instead? Reply and we will help.",
        "- If you do nothing, we will send you one more notice before the domain is released.",
        "",
        "Here is what you still have with PaintersMax:",
        "",
        ...RETURN_BENEFITS.map((b) => `- ${b}`),
        "",
        "We would be glad to have {business} back.",
        "",
      ].join("\n"),
      f,
    ) + signoff(f),
  };
}

export type Step = "first" | "reminder";
export const sentKey = (c: number, domain: string) => `dmsent:${c}:${domain}`;
interface Sent { first: string; reminder: string }
const readSent = (raw: unknown): Sent => ({ first: isDate((raw as any)?.first) ? (raw as any).first : "", reminder: isDate((raw as any)?.reminder) ? (raw as any).reminder : "" });

/** Which email is due for one cancelled client's domain today, if any. Pure, so it can be tested. */
export function dueStep(cancelledOn: string, today: string, sent: Sent): Step | null {
  if (!isDate(cancelledOn)) return null;
  const reuse = addDaysIso(cancelledOn, REUSE_AFTER_DAYS);
  if (today >= reuse) return null; // after the reuse date the day-25 email is no longer true, and day 1 is long gone
  if (today >= addDaysIso(cancelledOn, DAY_REMINDER)) return sent.reminder ? null : "reminder";
  if (today >= addDaysIso(cancelledOn, DAY_FIRST)) return sent.first ? null : "first";
  return null;
}

export function fieldsFor(i: { business: string; domain: string; cancelledOn: string; expiresOn: string; settings: DmSettings; firstName?: string }): Fields {
  return {
    first_name: i.firstName || "there",
    business: i.business,
    domain: i.domain,
    cancel_date: i.cancelledOn,
    reuse_date: addDaysIso(i.cancelledOn, REUSE_AFTER_DAYS),
    expiry_date: i.expiresOn,
    login_link: i.settings.loginLink,
    support_email: i.settings.supportEmail,
    signer: i.settings.signer,
  };
}

/** Admin preview and test: both emails with a sample client. */
export function previewFor(settings: DmSettings, today: string) {
  const f = fieldsFor({ business: "Sample Painting Co", domain: "samplepainting.com", cancelledOn: today, expiresOn: addDaysIso(today, 200), settings });
  return { first: firstEmail(f), reminder: reminderEmail(f), fields: f };
}
export async function sendDmTest(env: Env, to: string, today: string) {
  const s = await loadDmSettings(env);
  const p = previewFor(s, today);
  const a = await sendLeadEmail(env, to, `[TEST] ${p.first.subject}`, p.first.text);
  const b = await sendLeadEmail(env, to, `[TEST] ${p.reminder.subject}`, p.reminder.text);
  return a === "sent" && b === "sent" ? { ok: true as const } : { ok: false as const, error: "The test emails were not sent (the email service is not set up in this environment)." };
}

/**
 * Runs once an hour at most in the morning (8 AM Central hour): looks at every cancelled or refunded client with a held domain
 * and sends what is due. The record is written BEFORE sending, so a crash can never email the same client twice.
 */
export async function sendDomainEmails(env: Env, now: number = Date.now()): Promise<number> {
  const hour = new Date(now - 6 * 3600 * 1000).getUTCHours();
  if (hour !== 8) return 0;
  const settings = await loadDmSettings(env);
  if (!settings.emailsOn) return 0;
  const today = todayLocal(now);
  const [held, subs, subRows] = await Promise.all([loadHeld(env), allSubs(env, today), env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'sub:%'").all<{ key: string; value: string }>()]);
  const ended = new Map<number, string>();
  for (const r of subRows.results ?? []) {
    try {
      const s = JSON.parse(r.value);
      if ((s?.status === "cancelled" || s?.status === "refunded") && isDate(s?.cancelledOn)) ended.set(Number(r.key.slice(4)), s.cancelledOn);
    } catch {
      /* skip */
    }
  }
  let sent = 0;
  for (const d of held as HeldDomain[]) {
    if (!d.companyId || d.status !== "active") continue;
    const cancelledOn = ended.get(d.companyId);
    const client = subs.find((s) => s.companyId === d.companyId);
    if (!cancelledOn || !client?.email) continue;
    const key = sentKey(d.companyId, d.name);
    const rec = await readBlob(env, key, readSent);
    const step = dueStep(cancelledOn, today, rec);
    if (!step) continue;
    await writeBlob(env, key, { ...rec, [step]: today });
    const f = fieldsFor({ business: client.name, domain: d.name, cancelledOn, expiresOn: d.expiresOn, settings });
    const mail = step === "first" ? firstEmail(f) : reminderEmail(f);
    const res = await sendLeadEmail(env, client.email, mail.subject, mail.text);
    if (res === "sent") sent++;
    else {
      await writeBlob(env, key, { ...rec, [step]: "" }); // not sent: try again next morning
    }
  }
  return sent;
}
