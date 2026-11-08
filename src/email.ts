import type { Env } from "./types.ts";

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
      from: env.FROM_EMAIL ?? "PaintersMax <leads@mail.paintersmax.app>",
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
): Promise<"sent" | "skipped"> {
  if (!env.RESEND_API_KEY || !to) return "skipped";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: `${companyName.replace(/[<>"]/g, "")} <leads@mail.paintersmax.app>`,
      to: [to],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      text,
    }),
  });
  if (!r.ok) console.error("Resend customer email failed", r.status);
  return r.ok ? "sent" : "skipped";
}
