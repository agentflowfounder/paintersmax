import type { Env } from "./types.ts";

/** Sends a lead alert through Resend. Silently skips (demo mode) if no key or recipient is set. */
export async function sendLeadEmail(
  env: Env,
  to: string | null | undefined,
  subject: string,
  text: string,
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
    }),
  });
  if (!r.ok) console.error("Resend failed", r.status);
  return r.ok ? "sent" : "skipped";
}
