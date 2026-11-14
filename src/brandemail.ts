import { esc, onColor, trustLine, type Brand } from "./brandprint.ts";

/**
 * Three email templates the painter copies into their own email app: an estimate follow-up, a thank-you with a review request,
 * and a check-in with a past customer. PaintersMax does not send these; they go out from the painter's own address.
 * Nothing is promised that the painter did not choose (an offer line only appears if they type one).
 */

export const EMAIL_TEMPLATES = [
  { id: "estimate", label: "Estimate follow-up" },
  { id: "thanks", label: "Thank you and review request" },
  { id: "checkin", label: "Checking in with a past customer" },
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number]["id"];

export interface EmailFields {
  name: string;
  project: string;
  offer: string;
}
const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n) : "");
export function cleanFields(i: any): EmailFields {
  return { name: s(i?.name, 40), project: s(i?.project, 80), offer: s(i?.offer, 200) };
}
const pickTemplate = (t: unknown): EmailTemplate => (EMAIL_TEMPLATES.some((x) => x.id === t) ? (t as EmailTemplate) : "estimate");

function signature(b: Brand): string {
  const lines = [b.person || b.company, b.person ? b.company : "", [b.phone, b.website].filter(Boolean).join("  |  "), trustLine(b)].filter(Boolean);
  return lines.join("\n");
}

/** Plain-text subject and body. Blank lines separate paragraphs. */
export function emailText(b: Brand, template: unknown, f: EmailFields): { subject: string; text: string; template: EmailTemplate } {
  const t = pickTemplate(template);
  const es = b.language === "es";
  const hi = f.name ? (es ? `Hola ${f.name},` : `Hi ${f.name},`) : es ? "Hola," : "Hi there,";
  const project = f.project || (es ? "su proyecto" : "your project");
  const offer = f.offer ? `${f.offer}\n\n` : "";
  const sig = signature(b);
  const co = b.company || (es ? "nuestra empresa" : "our company");
  let subject = "";
  let body = "";
  if (t === "estimate") {
    if (es) {
      subject = `Su presupuesto de pintura de ${co}`;
      body = `${hi}\n\nGracias por darnos la oportunidad de cotizar ${project}. Quería darle seguimiento por si tiene preguntas sobre el presupuesto o quiere cambiar algo.\n\nCon gusto repasamos los detalles, ajustamos el alcance o respondemos preguntas sobre la preparación, la pintura y los tiempos. Nuestra agenda se llena, así que si desea reservar una fecha de inicio, solo responda a este correo o llámeme.\n\n${offer}Gracias de nuevo,\n${sig}`;
    } else {
      subject = `Your painting estimate from ${co}`;
      body = `${hi}\n\nThank you for the chance to bid on ${project}. I wanted to follow up in case you have questions about the estimate or would like to change anything.\n\nI'm happy to walk through the details, adjust the scope, or answer questions about prep, paint and timing. Our schedule fills up, so if you'd like to hold a start date, just reply to this email or give me a call.\n\n${offer}Thanks again,\n${sig}`;
    }
  } else if (t === "thanks") {
    const link = b.reviewUrl;
    if (es) {
      subject = `Gracias de parte de ${co}`;
      body = `${hi}\n\nGracias por elegir a ${co} para ${project}. Fue un gusto trabajar en su casa y espero que le encante cómo quedó.\n\nSi algo no se ve bien, avíseme y lo resolveré.\n\nSi quedó contento con el trabajo, una reseña breve ayuda a otras familias a encontrarnos${link ? `. Toma como un minuto: ${link}` : ". Toma como un minuto"}. Y si un amigo o vecino necesita pintura, le agradecería la recomendación.\n\n${offer}Con gratitud,\n${sig}`;
    } else {
      subject = `Thank you from ${co}`;
      body = `${hi}\n\nThank you for choosing ${co} for ${project}. It was a pleasure working in your home, and I hope you love how it turned out.\n\nIf anything doesn't look right, tell me and I'll take care of it.\n\nIf you're happy with the work, a short review helps other homeowners find us${link ? `. It takes about a minute: ${link}` : ". It takes about a minute"}. And if a friend or neighbor needs painting, I'd be grateful for the introduction.\n\n${offer}With thanks,\n${sig}`;
    }
  } else if (es) {
    subject = `¿Es hora de una mano de pintura nueva? ${co}`;
    body = `${hi}\n\nHa pasado un tiempo desde que pintamos ${project} y quería saludarle. Espero que todo siga luciendo bien.\n\nSi hay un cuarto, las molduras o el exterior que necesiten atención, con gusto le doy un presupuesto. Solo responda a este correo o llámeme.\n\n${offer}Que esté muy bien,\n${sig}`;
  } else {
    subject = `Time for a fresh coat? A note from ${co}`;
    body = `${hi}\n\nIt has been a while since we painted ${project}, and I wanted to say hello. I hope everything is still looking great.\n\nIf there's a room, trim or exterior that needs attention, I'd be glad to give you an estimate. Just reply to this email or give me a call.\n\n${offer}Take care,\n${sig}`;
  }
  return { subject, text: body.trimEnd(), template: t };
}

const linkify = (escaped: string) => escaped.replace(/(https:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:#0F1B2D;font-weight:600">${u}</a>`);

/** A simple, mobile-friendly HTML email built from the (possibly edited) text. Inline styles only, so email apps keep them. */
export function emailHtml(b: Brand, subject: string, text: string): string {
  const color = b.color;
  const head = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.company)}" height="36" style="display:block;height:36px;max-width:220px;border:0">`
    : `<span style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:${onColor(color)}">${esc(b.company)}</span>`;
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="background:#f4f1ec;padding:20px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0F1B2D"><tr><td style="background:${color};padding:16px 24px">${b.logoUrl ? `<table role="presentation"><tr><td style="background:#ffffff;border-radius:6px;padding:6px 10px">${head}</td></tr></table>` : head}</td></tr><tr><td style="padding:24px;font-size:16px;line-height:1.55">${paras}</td></tr></table><div style="display:none">${esc(subject)}</div></div>`;
}
