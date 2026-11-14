/**
 * Customer sign-off on finished work, and the review request. Both live inside the job's own data (jobs.data), so no database
 * change is needed. Sign-off is optional for each job: the painter asks, the customer confirms on their private page by typing
 * their name, and the date they accepted becomes the suggested start of the warranty.
 * This file holds the plain parts (types, reading, email wording) so the customer page and the painter API can share them.
 */

export interface Signoff {
  requested: boolean;
  requestedAt: string; // ISO
  emailedAt?: string; // ISO: the painter emailed the customer the link
  acceptedAt?: string; // ISO
  acceptedOn?: string; // YYYY-MM-DD (US local date), used as the warranty start
  acceptedBy?: string; // the name the customer typed
  concern?: { text: string; at: string }; // "something needs attention", sent from the customer page
}

const txt = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n) : "");
export const cleanText = txt;

/** Reads the sign-off from a job's data (a JSON string or an already parsed value). Null when the painter has not asked for one. */
export function readSignoff(jobData: unknown): Signoff | null {
  try {
    const d = typeof jobData === "string" ? (jobData ? JSON.parse(jobData) : {}) : jobData;
    const s = (d as any)?.signoff ?? (d as any);
    if (!s || typeof s !== "object" || s.requested !== true) return null;
    const out: Signoff = { requested: true, requestedAt: txt(s.requestedAt, 40) };
    if (s.emailedAt) out.emailedAt = txt(s.emailedAt, 40);
    if (s.acceptedAt) {
      out.acceptedAt = txt(s.acceptedAt, 40);
      out.acceptedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(s.acceptedOn ?? "")) ? String(s.acceptedOn) : out.acceptedAt.slice(0, 10);
      out.acceptedBy = txt(s.acceptedBy, 80);
    }
    if (s.concern && typeof s.concern.text === "string" && s.concern.text.trim()) out.concern = { text: txt(s.concern.text, 1000), at: txt(s.concern.at, 40) };
    return out;
  } catch {
    return null;
  }
}

/** The email that asks the customer to look over the finished work. It names no amount. */
export function signoffEmail(o: { es: boolean; customer: string; company: string; title: string; link: string }): { subject: string; body: string } {
  const first = o.customer.split(/\s+/)[0] || o.customer;
  if (o.es) {
    return {
      subject: `Su trabajo terminado - ${o.company}`,
      body: `Hola ${first},\n\n${o.company} terminó el trabajo "${o.title}". Cuando haya podido recorrerlo, por favor confirme en su página privada. Si algo necesita atención, también puede decírnoslo ahí, o responder a este correo.\n\n${o.link}\n\nGracias,\n${o.company}`,
    };
  }
  return {
    subject: `Your finished work - ${o.company}`,
    body: `Hi ${first},\n\n${o.company} has finished the work on "${o.title}". When you have had a chance to walk through it, please confirm on your private page. If anything needs attention, you can tell us there, or reply to this email.\n\n${o.link}\n\nThank you,\n${o.company}`,
  };
}

/** What the painter is told by email when the customer answers. */
export function painterNotice(kind: "accepted" | "concern", o: { customer: string; title: string; name?: string; text?: string }): { subject: string; body: string } {
  if (kind === "accepted") {
    return { subject: `${o.customer} accepted the finished work`, body: `${o.name || o.customer} accepted the finished work for "${o.title}". The date is saved on the job, and your warranty certificate will start from it.` };
  }
  return { subject: `${o.customer} says something needs attention`, body: `${o.customer} sent a note about the finished work for "${o.title}":\n\n${o.text ?? ""}\n\nOpen the job to follow up. The customer has not accepted the work yet.` };
}
