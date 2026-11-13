import { getSessionUser, randomToken } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import { sendCustomerEmail } from "./email.ts";
import { readSettings } from "./settings.ts";
import { isDate } from "./records.ts";
import type { Env } from "./types.ts";

/**
 * Warranty certificates. Never automatic: when a job is finished the painter is offered "Create warranty certificate",
 * prefilled with their default labor months and the job details. They review it, pick one of three printable designs
 * (saved as their default), and send or print it. End dates feed a reminder on Home.
 * Stored in app_settings (cert:<company>:<job>) so no migration is needed.
 */

export const DESIGNS = ["classic", "modern", "badge"] as const;
export type Design = (typeof DESIGNS)[number];

export interface Cert {
  design: Design;
  months: number;
  startOn: string;
  endOn: string;
  terms: string;
  exclusions: string;
  language: "en" | "es";
  status: "draft" | "sent";
  sentAt?: string;
}
const txt = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Adds whole months to a date, keeping the day when it exists (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function cleanCert(i: any, fallbackDesign: Design): Cert | { error: string } {
  const months = Math.round(Number(i?.months));
  if (!Number.isFinite(months) || months < 1 || months > 240) return { error: "Choose how many months of labor warranty (1 to 240)." };
  if (!isDate(i?.startOn)) return { error: "Choose the date the work was finished." };
  const design: Design = (DESIGNS as readonly string[]).includes(i?.design) ? i.design : fallbackDesign;
  return { design, months, startOn: i.startOn, endOn: addMonths(i.startOn, months), terms: txt(i?.terms, 1500), exclusions: txt(i?.exclusions, 800), language: i?.language === "es" ? "es" : "en", status: i?.status === "sent" ? "sent" : "draft" };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const L = {
  en: { title: "Warranty Certificate", to: "Presented to", job: "Work", at: "Property", labor: "Labor warranty", months: "months", from: "From", until: "Until", excl: "Not covered", by: "Painting contractor", mfr: "Paint and products also carry the manufacturer's own warranty.", seal: "WARRANTED" },
  es: { title: "Certificado de Garantía", to: "Presentado a", job: "Trabajo", at: "Propiedad", labor: "Garantía de mano de obra", months: "meses", from: "Desde", until: "Hasta", excl: "No cubre", by: "Contratista de pintura", mfr: "La pintura y los productos también tienen la garantía del fabricante.", seal: "GARANTIZADO" },
};
const fmtDate = (d: string, lang: "en" | "es") => {
  const t = new Date(d + "T00:00:00Z");
  return t.toLocaleDateString(lang === "es" ? "es-US" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
};

export interface CertView {
  company: string;
  logoUrl?: string;
  color?: string;
  customer: string;
  jobTitle: string;
  address: string;
  license?: string;
  cert: Cert;
}

export function renderCertificate(v: CertView): string {
  const c = v.cert;
  const t = L[c.language];
  const color = v.color && /^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : "#B8862B";
  const logo = v.logoUrl && /^https:\/\//.test(v.logoUrl) ? `<img src="${esc(v.logoUrl)}" alt="" style="max-height:52px;max-width:220px">` : "";
  const defaultTerms = c.language === "es" ? `Si la pintura que aplicamos se pela o ampolla por nuestra mano de obra, la arreglaremos sin costo durante ${c.months} meses.` : `If paint we applied peels or blisters because of our workmanship, we will fix it at no charge for ${c.months} months.`;
  const terms = esc(c.terms || defaultTerms).replace(/\n/g, "<br>");
  const body = `<p class="who"><span>${esc(t.to)}</span><b>${esc(v.customer)}</b></p>
<p class="what"><span>${esc(t.job)}</span> ${esc(v.jobTitle)}${v.address ? `<br><span>${esc(t.at)}</span> ${esc(v.address)}` : ""}</p>
<p class="terms">${terms}</p>
<p class="dates"><b>${esc(t.labor)}: ${c.months} ${esc(t.months)}</b><br>${esc(t.from)} ${esc(fmtDate(c.startOn, c.language))} &middot; ${esc(t.until)} <b>${esc(fmtDate(c.endOn, c.language))}</b></p>
${c.exclusions ? `<p class="excl"><span>${esc(t.excl)}:</span> ${esc(c.exclusions)}</p>` : ""}
<p class="mfr">${esc(t.mfr)}</p>
<div class="sign"><div class="by">${logo}<b>${esc(v.company)}</b><small>${esc(t.by)}${v.license ? " &middot; " + esc(v.license) : ""}</small></div></div>`;
  const base = `*{box-sizing:border-box}@page{size:letter landscape;margin:0.4in}body{margin:0;background:#eceae4;font-family:Inter,system-ui,sans-serif;color:#0F1B2D}.noprint{text-align:center;padding:14px}.noprint button{padding:10px 18px;border:0;border-radius:8px;background:#E8A33D;font-weight:700;cursor:pointer}@media print{body{background:#fff}.noprint{display:none}.page{box-shadow:none!important;margin:0!important}}.page{max-width:960px;margin:12px auto;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.15);aspect-ratio:11/8.5;position:relative}.page p{margin:8px 0}small{display:block;color:#4A5568}`;
  const css: Record<Design, string> = {
    classic: `.page{padding:30px}.frame{height:100%;border:3px double ${color};padding:26px 40px;text-align:center;display:flex;flex-direction:column;justify-content:center;font-family:Newsreader,Georgia,serif}h1{font-weight:500;font-size:40px;color:${color};margin:6px 0 4px;letter-spacing:1px}.who span,.what span,.excl span{font-family:Inter,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#4A5568;margin-right:6px}.who b{display:block;font-size:30px;font-weight:500}.terms{font-size:17px;max-width:640px;margin:14px auto!important}.dates{font-size:18px}.mfr{font-size:13px;color:#4A5568}.sign{margin-top:16px}.by{display:inline-block;border-top:1px solid ${color};padding-top:8px;min-width:280px}`,
    modern: `.frame{height:100%;padding:0 0 28px;display:flex;flex-direction:column}.bar{background:${color};color:#fff;padding:24px 40px}h1{margin:0;font-size:36px;font-weight:700;letter-spacing:-.5px}.in{padding:10px 40px;text-align:left}.who b{font-size:28px;display:block}.who span,.what span,.excl span{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#4A5568;margin-right:6px}.terms{font-size:16px;border-left:4px solid ${color};padding-left:14px}.dates{font-size:18px;background:#f7f5f1;padding:12px 14px;border-radius:8px}.mfr{font-size:13px;color:#4A5568}.by{border-top:1px solid #0F1B2D;display:inline-block;padding-top:8px;min-width:280px;margin-top:10px}`,
    badge: `.frame{height:100%;padding:24px 40px;text-align:center;display:flex;flex-direction:column;justify-content:center;background:linear-gradient(180deg,#fffdf8,#fff)}h1{font-size:30px;margin:4px 0 0;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:2px}.seal{width:120px;height:120px;border-radius:50%;margin:8px auto;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;letter-spacing:1px;border:6px double #fff;box-shadow:0 0 0 4px ${color}}.who b{font-size:26px;display:block}.who span,.what span,.excl span{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#4A5568;margin-right:6px}.terms{font-size:16px;max-width:620px;margin:10px auto!important}.dates{font-size:18px}.mfr{font-size:13px;color:#4A5568}.by{display:inline-block;border-top:1px solid ${color};padding-top:8px;min-width:280px;margin-top:8px}`,
  };
  const head: Record<Design, string> = {
    classic: `<h1>${esc(t.title)}</h1>`,
    modern: ``,
    badge: `<h1>${esc(t.title)}</h1><div class="seal">${esc(t.seal)}</div>`,
  };
  const inner = c.design === "modern" ? `<div class="bar"><h1>${esc(t.title)}</h1></div><div class="in">${body}</div>` : `${head[c.design]}${body}`;
  return `<!doctype html><html lang="${c.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(t.title)} - ${esc(v.customer)}</title><style>${base}${css[c.design]}</style></head><body><div class="noprint"><button onclick="window.print()">Print or save as PDF</button></div><div class="page"><div class="frame">${inner}</div></div></body></html>`;
}

const key = (c: number, j: number) => `cert:${c}:${j}`;
const BASE = "https://paintersmax.app";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const parse = (s: string | null | undefined): any => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
async function getSetting(env: Env, k: string) {
  return (await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(k).first<{ value: string }>())?.value ?? null;
}
async function putSetting(env: Env, k: string, v: string) {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(k, v).run();
}

async function viewFor(env: Env, companyId: number, jobId: number, cert: Cert): Promise<CertView | null> {
  const r = await env.DB.prepare("SELECT j.title AS jobTitle, pr.address, pr.city, pr.zip, cu.name AS customer, co.name AS company, co.settings, cp.data AS pdata FROM jobs j JOIN customers cu ON cu.id = j.customer_id LEFT JOIN properties pr ON pr.id = j.property_id JOIN companies co ON co.id = j.company_id LEFT JOIN company_profiles cp ON cp.company_id = co.id WHERE j.id = ? AND j.company_id = ?").bind(jobId, companyId).first<any>();
  if (!r) return null;
  const s = readSettings(r.settings);
  const prof = parse(r.pdata) ?? {};
  return { company: r.company, logoUrl: s.logoUrl, color: s.brandColor, customer: r.customer, jobTitle: r.jobTitle, address: [r.address, r.city, r.zip].filter(Boolean).join(", "), license: prof.company?.license, cert };
}

/** Public: GET /cert/<token> */
export async function handleCertPublic(request: Request, env: Env): Promise<Response> {
  const tok = new URL(request.url).pathname.split("/").filter(Boolean)[1] ?? "";
  const bad = new Response("<p>This link is not valid. Ask your painter for a new one.</p>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  if (!/^[a-f0-9]{64}$/.test(tok) || request.method !== "GET") return bad;
  const ref = await getSetting(env, `certtok:${tok}`);
  const m = ref?.match(/^(\d+):(\d+)$/);
  if (!m) return bad;
  const cert = parse(await getSetting(env, key(+m[1], +m[2]))) as Cert | null;
  if (!cert || cert.status !== "sent") return bad;
  const v = await viewFor(env, +m[1], +m[2], cert);
  return v ? new Response(renderCertificate(v), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } }) : bad;
}

/**
 * /api/warranty
 *  GET ?jobId=             the saved certificate, a suggestion to prefill, designs, the default design, and the link if sent
 *  GET ?jobId=&print=1     printable page (any status)
 *  GET ?expiring=1         certificates ending within 90 days
 *  POST {action:"save", jobId, design, months, startOn, terms, exclusions, language, makeDefault?}
 *  POST {action:"send", jobId, via:"email"|"link"}
 *  POST {action:"delete", jobId}
 */
export async function handleWarranty(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  const u = new URL(request.url);
  const savedDefault = (await getSetting(env, `certdefault:${c}`)) as Design | null;
  const design: Design = savedDefault && (DESIGNS as readonly string[]).includes(savedDefault) ? savedDefault : "classic";

  if (request.method === "GET") {
    if (u.searchParams.get("expiring")) {
      const rows = ((await env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE ?").bind(`cert:${c}:%`).all<{ key: string; value: string }>()).results ?? []) as { key: string; value: string }[];
      const now = new Date().toISOString().slice(0, 10);
      const soon = addMonths(now, 3);
      const out = [];
      for (const r of rows) {
        const ct = parse(r.value) as Cert | null;
        if (ct && ct.status === "sent" && ct.endOn >= now && ct.endOn <= soon) {
          const j = await env.DB.prepare("SELECT j.id, j.title, cu.name AS customer FROM jobs j JOIN customers cu ON cu.id = j.customer_id WHERE j.id = ? AND j.company_id = ?").bind(Number(r.key.split(":")[2]), c).first<any>();
          if (j) out.push({ jobId: j.id, title: j.title, customer: j.customer, endOn: ct.endOn });
        }
      }
      return json({ expiring: out.sort((a, b) => a.endOn.localeCompare(b.endOn)) });
    }
    const jobId = Number(u.searchParams.get("jobId"));
    const job = Number.isInteger(jobId) ? await env.DB.prepare("SELECT j.id, j.stage, cp.data AS pdata FROM jobs j LEFT JOIN company_profiles cp ON cp.company_id = j.company_id WHERE j.id = ? AND j.company_id = ?").bind(jobId, c).first<any>() : null;
    if (!job) return json({ error: "Job not found." }, 404);
    const cert = parse(await getSetting(env, key(c, jobId))) as Cert | null;
    if (u.searchParams.get("print") && cert) {
      const v = await viewFor(env, c, jobId, cert);
      return v ? new Response(renderCertificate(v), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }) : new Response("Not found.", { status: 404 });
    }
    const pdata = parse(job.pdata) ?? {};
    const tok = cert?.status === "sent" ? (await env.DB.prepare("SELECT key FROM app_settings WHERE key LIKE 'certtok:%' AND value = ?").bind(`${c}:${jobId}`).first<{ key: string }>())?.key.slice(8) : null;
    return json({
      cert,
      link: tok ? `${BASE}/cert/${tok}` : null,
      finished: job.stage === "invoiced" || job.stage === "closed",
      suggested: { design, months: Number(pdata.warranty?.laborMonths) || 12, startOn: new Date().toISOString().slice(0, 10), terms: typeof pdata.warranty?.text === "string" ? pdata.warranty.text : "", exclusions: typeof pdata.warranty?.exclusions === "string" ? pdata.warranty.exclusions : "", language: pdata.language?.ui === "es" ? "es" : "en" },
      designs: DESIGNS,
      defaultDesign: design,
    });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const jobId = Number(b?.jobId);
  const job = Number.isInteger(jobId) ? await env.DB.prepare("SELECT j.id, j.title, cu.email, cu.name AS customer, co.name AS company, co.notify_email FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id WHERE j.id = ? AND j.company_id = ?").bind(jobId, c).first<any>() : null;
  if (!job) return json({ error: "Job not found." }, 404);

  if (b.action === "save") {
    const cur = parse(await getSetting(env, key(c, jobId))) as Cert | null;
    const next = cleanCert(b, design);
    if ("error" in next) return json({ error: next.error }, 400);
    next.status = cur?.status ?? "draft";
    if (cur?.sentAt) next.sentAt = cur.sentAt;
    await putSetting(env, key(c, jobId), JSON.stringify(next));
    if (b.makeDefault === true) await putSetting(env, `certdefault:${c}`, next.design);
    if (!cur) await addJobEvent(env, c, jobId, "warranty", `Warranty certificate drafted (${next.months} months).`);
    return json({ ok: true, cert: next });
  }
  if (b.action === "delete") {
    const tok = await env.DB.prepare("SELECT key FROM app_settings WHERE key LIKE 'certtok:%' AND value = ?").bind(`${c}:${jobId}`).first<{ key: string }>();
    if (tok) await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(tok.key).run();
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(key(c, jobId)).run();
    return json({ ok: true });
  }
  if (b.action === "send") {
    const cert = parse(await getSetting(env, key(c, jobId))) as Cert | null;
    if (!cert) return json({ error: "Save the certificate first." }, 400);
    if (b.via === "email" && !job.email) return json({ error: "This customer has no email address. Use Get link instead." }, 400);
    let tok = (await env.DB.prepare("SELECT key FROM app_settings WHERE key LIKE 'certtok:%' AND value = ?").bind(`${c}:${jobId}`).first<{ key: string }>())?.key.slice(8);
    if (!tok) {
      tok = randomToken();
      await putSetting(env, `certtok:${tok}`, `${c}:${jobId}`);
    }
    cert.status = "sent";
    cert.sentAt = new Date().toISOString();
    await putSetting(env, key(c, jobId), JSON.stringify(cert));
    const link = `${BASE}/cert/${tok}`;
    let emailed = false;
    if (b.via === "email") {
      const es = cert.language === "es";
      const res = await sendCustomerEmail(env, job.email, job.company, job.notify_email, es ? "Su certificado de garantía" : "Your warranty certificate", es ? `Hola ${String(job.customer).split(/\s+/)[0]},\n\nGracias por elegirnos. Aquí está su certificado de garantía:\n${link}\n\n${job.company}` : `Hi ${String(job.customer).split(/\s+/)[0]},\n\nThank you for choosing us. Here is your warranty certificate:\n${link}\n\n${job.company}`);
      emailed = res === "sent";
    }
    await addJobEvent(env, c, jobId, "warranty", `Warranty certificate sent to the customer${emailed ? " by email" : ""}. Ends ${cert.endOn}.`);
    return json({ ok: true, link, emailed });
  }
  return json({ error: "Unknown action." }, 400);
}
