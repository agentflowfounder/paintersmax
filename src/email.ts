import type { Env } from "./types.ts";

/**
 * Each kind of email leaves from its own address on mail.paintersmax.app (set up 2026-11-15), so a problem with one kind
 * (a marketing email marked as spam, say) never hurts sign-in links or invoices. Replies to emails to a painter go to
 * support@paintersmax.app, which forwards to the owner. Customer emails keep the painter's company name, and a reply goes
 * to the painter.
 */
export const SUPPORT_ADDRESS = "support@paintersmax.app";
const DEFAULT_FROM = "PaintersMax <leads@mail.paintersmax.app>";

/** Which address an email to a painter leaves from, judged by its subject (English and Spanish). */
export function ownerSender(subject: string): string {
  if (/sign-in link|enlace de (inicio|acceso)/i.test(subject)) return "login";
  if (/^(today at|hoy en)\b|insurance policy|p[oó]liza|reminder|recordatorio/i.test(subject)) return "reminders";
  if (/trial|payment failed|credits|cr[eé]ditos|renewal|renovaci[oó]n/i.test(subject)) return "account";
  return "leads";
}

/** Which address an email to a painter's customer leaves from: money emails use invoices@, everything else jobs@. */
export function customerSender(subject: string): string {
  return /invoice|factura|payment|pago|thank you|gracias|receipt|recibo/i.test(subject) ? "invoices" : "jobs";
}

const fromAddress = (local: string) => `${local}@mail.paintersmax.app`;

/** Sends a lead alert through Resend. Silently skips (demo mode) if no key or recipient is set. */
export async function sendLeadEmail(
  env: Env,
  to: string | null | undefined,
  subject: string,
  text: string,
  attachments?: { filename: string; content: string }[],
): Promise<"sent" | "skipped"> {
  const recipient = to || env.NOTIFY_EMAIL;
  if (!env.RESEND_API_KEY || !recipient) return "skipped";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: env.FROM_EMAIL && env.FROM_EMAIL !== DEFAULT_FROM ? env.FROM_EMAIL : `PaintersMax <${fromAddress(ownerSender(subject))}>`,
      reply_to: SUPPORT_ADDRESS,
      to: [recipient],
      subject,
      text,
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
  if (!r.ok) console.error("Resend failed", r.status);
  return r.ok ? "sent" : "skipped";
}

/** Sends the customer a copy of their estimate. Replies go to the company. Skips if no key. */
export async function sendCustomerEmail(
  env: Env,
  to: string,
  companyName: string,
  replyTo: string | null | undefined,
  subject: string,
  text: string,
  attachments?: { filename: string; content: string }[],
): Promise<"sent" | "skipped"> {
  if (!env.RESEND_API_KEY || !to) return "skipped";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: `${companyName.replace(/[<>"]/g, "")} <${fromAddress(customerSender(subject))}>`,
      to: [to],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      text,
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
  if (!r.ok) console.error("Resend customer email failed", r.status);
  return r.ok ? "sent" : "skipped";
}
