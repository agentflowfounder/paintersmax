import { addJobEvent } from "./crm.ts";
import type { Env } from "./types.ts";

/**
 * Customer texts (Rogelio, 2026-11-28: automated, Twilio, painter replies in their own words, no AI).
 * Built OFF. Nothing is sent until the TEXTS_ON setting is "1" AND Twilio keys are set as Cloudflare secrets
 * (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM). Every text goes out in the customer's language (en or es).
 * Each text sent is written to the job timeline. No migration: the timeline is the existing job_events table.
 */

export type TextKind = "booked" | "crew_on_way" | "job_done";
export type Lang = "en" | "es";

export const TEXT_KINDS: TextKind[] = ["booked", "crew_on_way", "job_done"];

// Placeholders: {name} the customer's first name, {company} the painter's business name, {date} the visit day.
export const TEMPLATES: Record<TextKind, Record<Lang, string>> = {
  booked: {
    en: "Hi {name}, this is {company}. Your painting visit is booked for {date}. Reply here with any questions. Reply STOP to opt out.",
    es: "Hola {name}, le habla {company}. Su visita de pintura está programada para el {date}. Responda aquí si tiene preguntas. Responda STOP para no recibir mensajes.",
  },
  crew_on_way: {
    en: "Hi {name}, this is {company}. Our crew is on the way to your home today. Reply STOP to opt out.",
    es: "Hola {name}, le habla {company}. Nuestro equipo va en camino a su casa hoy. Responda STOP para no recibir mensajes.",
  },
  job_done: {
    en: "Hi {name}, this is {company}. Today's work is finished. Thank you for choosing us. Reply STOP to opt out.",
    es: "Hola {name}, le habla {company}. El trabajo de hoy ya terminó. Gracias por elegirnos. Responda STOP para no recibir mensajes.",
  },
};

export function langOf(v: unknown): Lang {
  return v === "es" ? "es" : "en";
}

/** Fills the template. Values are plain text; unknown placeholders are left out. */
export function renderText(kind: TextKind, lang: Lang, vars: { name?: string; company?: string; date?: string }): string {
  const clean = (s: unknown) => String(s ?? "").replace(/[\r\n\t{}]/g, " ").trim().slice(0, 80);
  const v = { name: clean(vars.name) || (lang === "es" ? "cliente" : "there"), company: clean(vars.company) || "PaintersMax", date: clean(vars.date) };
  return TEMPLATES[kind][lang].replace(/\{(name|company|date)\}/g, (_, k: keyof typeof v) => v[k]).replace(/\s+/g, " ").trim();
}

export function textsOn(env: Env): boolean {
  return env.TEXTS_ON === "1" && !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN && !!env.TWILIO_FROM;
}

/** E.164 for US numbers. Returns null when the number cannot be read as a US phone. */
export function usPhone(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `+1${ten}` : null;
}

export type SendResult = { ok: true } | { ok: false; reason: "off" | "no_number" | "failed" };

/** Sends one text through Twilio, and writes it to the job timeline. Does nothing unless textsOn(env). */
export async function sendJobText(env: Env, o: { companyId: number; jobId: number; kind: TextKind; lang: Lang; to: unknown; vars: { name?: string; company?: string; date?: string } }): Promise<SendResult> {
  if (!textsOn(env)) return { ok: false, reason: "off" };
  const to = usPhone(o.to);
  if (!to) return { ok: false, reason: "no_number" };
  const body = renderText(o.kind, o.lang, o.vars);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  try {
    const r = await fetch(url, { method: "POST", headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ To: to, From: env.TWILIO_FROM!, Body: body }) });
    if (!r.ok) return { ok: false, reason: "failed" };
    await addJobEvent(env, o.companyId, o.jobId, "text", `Text sent (${o.kind}, ${o.lang}): ${body}`);
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
