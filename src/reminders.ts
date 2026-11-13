import { sendCustomerEmail } from "./email.ts";
import { portalNote } from "./portal.ts";
import { addJobEvent } from "./crm.ts";
import type { Env } from "./types.ts";

/** Days after the invoice was emailed when each reminder goes out. Two reminders at most. */
export const REMINDER_DAYS = [7, 14];

/** Which reminder (1 or 2) is due, given days since sending and how many were already sent. Null when none is due. */
export function reminderDue(daysSince: number, sent: number): 1 | 2 | null {
  if (sent >= REMINDER_DAYS.length) return null;
  return daysSince >= REMINDER_DAYS[sent] ? ((sent + 1) as 1 | 2) : null;
}

/** Friendly reminder text. It names the invoice but never states an amount; the amount is on the invoice the customer already has. */
export function reminderText(opts: { n: 1 | 2; es: boolean; customer: string; company: string; number: string; jobTitle: string; notes: string }): { subject: string; body: string } {
  const first = opts.customer.split(/\s+/)[0] || opts.customer;
  const ref = opts.number ? `${opts.es ? "factura n.º" : "invoice no."} ${opts.number}` : opts.es ? "su factura" : "your invoice";
  if (opts.es) {
    return {
      subject: `Recordatorio amable: ${ref} - ${opts.company}`,
      body: `Hola ${first},\n\nUn recordatorio amable: ${ref} por "${opts.jobTitle}" sigue abierta${opts.n === 2 ? ", y este es nuestro segundo aviso" : ""}. Si ya pagó, gracias, y puede ignorar este mensaje. Si tiene alguna duda, responda a este correo.\n\n${opts.notes ? opts.notes + "\n\n" : ""}${opts.company}`,
    };
  }
  return {
    subject: `Friendly reminder: ${ref} - ${opts.company}`,
    body: `Hi ${first},\n\nA friendly reminder that ${ref} for "${opts.jobTitle}" is still open${opts.n === 2 ? ", and this is our second note" : ""}. If you have already paid, thank you, and please ignore this message. If you have any questions, just reply to this email.\n\n${opts.notes ? opts.notes + "\n\n" : ""}${opts.company}`,
  };
}

/** Scheduled job: emails customers about invoices the painter chose to remind on and that are still not paid. Cheap when there is nothing to send. */
export async function sendInvoiceReminders(env: Env): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const rows = await env.DB.prepare(
    `SELECT d.id, d.company_id, d.job_id, d.updated_at, d.language, d.body, j.title, cu.name AS customer, cu.email, co.name AS company, co.notify_email,
            CAST(julianday('now') - julianday(d.updated_at) AS INTEGER) AS days
       FROM documents d JOIN jobs j ON j.id = d.job_id JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = d.company_id
      WHERE d.kind = 'invoice' AND d.status = 'sent' AND json_extract(d.body, '$.invoice.reminders') = 1
        AND cu.email IS NOT NULL AND d.updated_at < datetime('now', '-7 days') AND d.updated_at > datetime('now', '-60 days') LIMIT 100`,
  ).all<any>();
  for (const r of rows.results) {
    const key = `inv_rem:${r.id}`;
    const st = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
    let sent = 0;
    try {
      const v = st ? JSON.parse(st.value) : null;
      if (v && v.u === r.updated_at) sent = Number(v.n) || 0;
    } catch {
      sent = 0;
    }
    const due = reminderDue(r.days, sent);
    if (!due) continue;
    let inv: any = {};
    try {
      inv = JSON.parse(r.body)?.invoice ?? {};
    } catch {
      inv = {};
    }
    const t = reminderText({ n: due, es: r.language === "es", customer: r.customer, company: r.company, number: String(inv.number ?? ""), jobTitle: r.title, notes: "" });
    const res = await sendCustomerEmail(env, r.email, r.company, r.notify_email, t.subject, t.body + (await portalNote(env, r.company_id, r.job_id, r.language === "es")));
    if (res !== "sent") continue;
    await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
      .bind(key, JSON.stringify({ u: r.updated_at, n: due })).run();
    await addJobEvent(env, r.company_id, r.job_id, "note", `Payment reminder ${due} emailed to ${r.email}.`);
  }
}
