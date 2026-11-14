import { getSessionUser } from "./auth.ts";
import { brandFor } from "./brand.ts";
import { emailText } from "./brandemail.ts";
import { addJobEvent } from "./crm.ts";
import { sendCustomerEmail } from "./email.ts";
import { portalLink } from "./portal.ts";
import { cleanText, readSignoff, signoffEmail, type Signoff } from "./signoffcore.ts";
import type { Env } from "./types.ts";

/**
 * Painter API  /api/signoff  (POST)
 *  request       {jobId, email?, language?}   ask the customer to accept the finished work; email them the private link when email is true
 *  withdraw      {jobId}                      take the request back (only before the customer has accepted)
 *  reviewPreview {jobId, language?}           the review-request email, written from the Brand kit thank-you template (nothing is sent)
 *  reviewSend    {jobId, subject, text}       sends the review request the painter just read and approved
 * Nothing is ever sent without the painter tapping the button, and the customer is emailed only what the painter sees first.
 */

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function handleSignoff(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const jobId = Number(b?.jobId);
  const c = user.companyId;
  const job = Number.isInteger(jobId)
    ? await env.DB.prepare(
        `SELECT j.id, j.title, j.stage, j.data, cu.name AS customer, cu.email, co.name AS company, co.notify_email
           FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id WHERE j.id = ? AND j.company_id = ?`,
      ).bind(jobId, c).first<any>()
    : null;
  if (!job) return json({ error: "Job not found." }, 404);
  const es = b?.language === "es";
  const replyTo = job.notify_email || user.email;
  const setSignoff = (s: Signoff) => env.DB.prepare("UPDATE jobs SET data = json_set(COALESCE(data, '{}'), '$.signoff', json(?)), updated_at = datetime('now') WHERE id = ? AND company_id = ?").bind(JSON.stringify(s), jobId, c).run();
  const current = readSignoff(job.data);

  if (b.action === "request") {
    if (job.stage === "lost") return json({ error: "This job was marked lost." }, 400);
    if (current?.acceptedAt) return json({ error: "The customer already accepted the finished work." }, 400);
    const wantEmail = b.email === true;
    if (wantEmail && !job.email) return json({ error: "This customer has no email address. Add one in Edit details, or untick the email box." }, 400);
    const link = await portalLink(env, c, jobId);
    const s: Signoff = { requested: true, requestedAt: current?.requestedAt || new Date().toISOString(), ...(current?.emailedAt ? { emailedAt: current.emailedAt } : {}) };
    let emailed: "sent" | "skipped" | "none" = "none";
    if (wantEmail) {
      const t = signoffEmail({ es, customer: job.customer ?? "", company: job.company, title: job.title, link });
      emailed = await sendCustomerEmail(env, job.email, job.company, replyTo, t.subject, t.body);
      if (emailed === "sent") s.emailedAt = new Date().toISOString();
    }
    await setSignoff(s);
    if (!current) await addJobEvent(env, c, jobId, "note", `Asked the customer to accept the finished work.${emailed === "sent" ? " They were emailed the link." : ""}`);
    else if (emailed === "sent") await addJobEvent(env, c, jobId, "note", "Emailed the customer the finished-work link again.");
    return json({ ok: true, emailed, link });
  }

  if (b.action === "withdraw") {
    if (!current) return json({ ok: true });
    if (current.acceptedAt) return json({ error: "The customer already accepted, so this cannot be withdrawn." }, 400);
    await env.DB.prepare("UPDATE jobs SET data = json_remove(COALESCE(data, '{}'), '$.signoff'), updated_at = datetime('now') WHERE id = ? AND company_id = ?").bind(jobId, c).run();
    await addJobEvent(env, c, jobId, "note", "Took back the request to accept the finished work.");
    return json({ ok: true });
  }

  if (b.action === "reviewPreview" || b.action === "reviewSend") {
    if (!job.email) return json({ error: "This customer has no email address. Add one in Edit details first." }, 400);
    const first = String(job.customer ?? "").trim().split(/\s+/)[0] ?? "";
    if (b.action === "reviewPreview") {
      const brand = await brandFor(env, c, es ? "es" : "en");
      const t = emailText(brand, "thanks", { name: first, project: job.title, offer: "" });
      return json({ ok: true, subject: t.subject, text: t.text, hasLink: !!brand.reviewUrl, to: job.email });
    }
    const subject = cleanText(b.subject, 150);
    const text = cleanText(b.text, 4000);
    if (!subject || !text) return json({ error: "The email needs a subject and some text." }, 400);
    const res = await sendCustomerEmail(env, job.email, job.company, replyTo, subject, text);
    if (res !== "sent") return json({ error: "The email could not be sent. Check the customer email address and try again." }, 502);
    await env.DB.prepare("UPDATE jobs SET data = json_set(COALESCE(data, '{}'), '$.reviewAskedAt', ?), updated_at = datetime('now') WHERE id = ? AND company_id = ?").bind(new Date().toISOString(), jobId, c).run();
    await addJobEvent(env, c, jobId, "note", "Review request emailed to the customer.");
    return json({ ok: true, emailed: "sent" });
  }
  return json({ error: "Unknown action." }, 400);
}
