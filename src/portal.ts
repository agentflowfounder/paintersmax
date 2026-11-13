import { getSessionUser, randomToken, sha256Hex } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import { sendCustomerEmail } from "./email.ts";
import { coiLink, showsCustomers } from "./insurance.ts";
import { renderDocPage } from "./wizard-api.ts";
import { readSettings } from "./settings.ts";
import type { Env } from "./types.ts";

/**
 * Customer portal: one private link per job. The customer sees only what the painter sent them:
 * the estimate and contract, signature status, schedule, warranty, invoice, insurance proof, and how to reach the painter.
 * The token is random; only a hash is used to look it up. Nothing private (costs, notes, other customers) is ever shown.
 */

const PUBLIC_BASE = "https://paintersmax.app";
const CUSTOMER_DOCS = ["estimate", "contract", "schedule", "warranty", "invoice"] as const;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const htmlResp = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });

const jobKey = (jobId: number) => `portal:${jobId}`;
const hashKey = (hash: string) => `portal_tok:${hash}`;

async function getSetting(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
async function putSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, value).run();
}

/** The job's portal link, created on first use. */
export async function portalLink(env: Env, companyId: number, jobId: number, origin = PUBLIC_BASE): Promise<string> {
  let token = await getSetting(env, jobKey(jobId));
  if (!token) {
    token = randomToken();
    await putSetting(env, jobKey(jobId), token);
    await putSetting(env, hashKey(await sha256Hex(token)), `${companyId}:${jobId}`);
  }
  return `${origin}/portal/${token}`;
}

/**
 * A short "track your project" paragraph for customer emails, or "" if anything goes wrong (an email must never fail because of this).
 * The link is the job's private portal link, created on first use.
 */
export async function portalNote(env: Env, companyId: number, jobId: number | null | undefined, es: boolean): Promise<string> {
  if (!jobId) return "";
  try {
    const link = await portalLink(env, companyId, jobId);
    return es ? `\n\nVea el avance de su proyecto en cualquier momento:\n${link}` : `\n\nFollow your project any time:\n${link}`;
  } catch (err) {
    console.error("portal note failed", String(err));
    return "";
  }
}

/** Turns the link off by deleting the lookup. The next "show link" makes a brand new one. */
async function resetPortal(env: Env, jobId: number): Promise<void> {
  const token = await getSetting(env, jobKey(jobId));
  if (token) await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(hashKey(await sha256Hex(token))).run();
  await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(jobKey(jobId)).run();
}

/** Friendly status for the customer, from the job stage. */
export function stageText(stage: string, es: boolean): string {
  const en: Record<string, string> = { lead: "We received your request", bid: "Your estimate is ready", contract: "Your contract is ready", scheduled: "Your job is scheduled", in_progress: "Work is in progress", punch: "Final touch-ups", invoiced: "Work complete. Your invoice is ready", closed: "All done. Thank you!" };
  const sp: Record<string, string> = { lead: "Recibimos su solicitud", bid: "Su presupuesto está listo", contract: "Su contrato está listo", scheduled: "Su trabajo está programado", in_progress: "El trabajo está en progreso", punch: "Últimos detalles", invoiced: "Trabajo terminado. Su factura está lista", closed: "Todo listo. ¡Gracias!" };
  return (es ? sp : en)[stage] ?? (es ? "En progreso" : "In progress");
}

/** POST /api/portal (painter): {jobId} shows the link; {jobId, action:"email"} emails it; {jobId, action:"reset"} replaces it. */
export async function handlePortalManage(request: Request, env: Env): Promise<Response> {
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
  const job = Number.isInteger(jobId)
    ? await env.DB.prepare("SELECT j.id, j.title, cu.name AS customer, cu.email, co.name AS company, co.notify_email FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id WHERE j.id = ? AND j.company_id = ?").bind(jobId, user.companyId).first<any>()
    : null;
  if (!job) return json({ error: "Job not found." }, 404);
  if (b.action === "reset") await resetPortal(env, jobId);
  const link = await portalLink(env, user.companyId, jobId);
  if (b.action === "email") {
    if (!job.email) return json({ error: "This customer has no email address.", link }, 400);
    const es = b.language === "es";
    const first = String(job.customer ?? "").split(/\s+/)[0] || job.customer;
    const res = await sendCustomerEmail(
      env,
      job.email,
      job.company,
      job.notify_email || user.email,
      es ? `Su página del trabajo - ${job.company}` : `Your job page - ${job.company}`,
      es
        ? `Hola ${first},\n\nAquí puede ver su presupuesto, contrato, calendario, factura y comprobante de seguro de "${job.title}":\n\n${link}\n\n${job.company}`
        : `Hi ${first},\n\nHere you can see your estimate, contract, schedule, invoice and proof of insurance for "${job.title}":\n\n${link}\n\n${job.company}`,
    );
    if (res !== "sent") return json({ error: "Email is not set up yet, so nothing was sent. Copy the link and send it yourself.", link }, 503);
    await addJobEvent(env, user.companyId, jobId, "note", `Customer portal link emailed to ${job.email}.`);
    return json({ ok: true, link, emailed: true });
  }
  return json({ ok: true, link });
}

async function resolve(env: Env, token: string): Promise<{ companyId: number; jobId: number } | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const v = await getSetting(env, hashKey(await sha256Hex(token)));
  if (!v) return null;
  const [c, j] = v.split(":").map(Number);
  return Number.isInteger(c) && Number.isInteger(j) ? { companyId: c, jobId: j } : null;
}

const CSS = `*{box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#F7F5F1;color:#0F1B2D;margin:0}header{background:#0F1B2D;color:#fff;padding:16px}header b{font-family:Newsreader,Georgia,serif;font-size:20px;font-weight:500}main{max-width:640px;margin:0 auto;padding:16px 16px 50px}h1{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:26px;margin:6px 0 2px}.st{display:inline-block;background:#E8A33D;color:#0F1B2D;font-weight:700;border-radius:99px;padding:5px 12px;font-size:14px;margin:6px 0 14px}.card{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:14px 16px;margin:0 0 12px}.card h2{font-size:16px;margin:0 0 6px}.row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #eee}.row:first-of-type{border-top:0}a.b{background:#0F1B2D;color:#fff;text-decoration:none;border-radius:8px;padding:9px 13px;font-size:14px;font-weight:600;white-space:nowrap}.tag{font-size:12px;border-radius:99px;padding:2px 9px;font-weight:600;background:#eceae4;color:#4A5568}.tag.g{background:#e6f4ea;color:#0a7a3d}.muted{color:#4A5568;font-size:14px}`;

export function renderPortal(d: {
  es: boolean; company: string; phone: string; email: string; customer: string; title: string; stage: string;
  docs: { id: number; kind: string; status: string; label: string }[]; signed: Record<string, string>; pendingSign: string[]; proofUrl: string | null; token: string; logoUrl?: string; color?: string;
}): string {
  const es = d.es;
  const L = (en: string, sp: string) => (es ? sp : en);
  const first = d.customer.split(/\s+/)[0] || d.customer;
  const kindName: Record<string, string> = { estimate: L("Estimate", "Presupuesto"), contract: L("Contract", "Contrato"), schedule: L("Schedule", "Calendario"), warranty: L("Warranty", "Garantía"), invoice: L("Invoice", "Factura") };
  const rows = d.docs
    .map((x) => {
      const tags: string[] = [];
      if (d.signed[x.kind]) tags.push(`<span class="tag g">${L("Signed", "Firmado")} ${esc(d.signed[x.kind])}</span>`);
      else if (d.pendingSign.includes(x.kind)) tags.push(`<span class="tag">${L("Waiting for your signature. Check your email.", "Esperando su firma. Revise su correo.")}</span>`);
      if (x.kind === "invoice") tags.push(x.status === "paid" ? `<span class="tag g">${L("Paid", "Pagada")}</span>` : `<span class="tag">${L("Open", "Abierta")}</span>`);
      return `<div class="row"><div><b>${esc(kindName[x.kind] ?? x.kind)}</b><br>${tags.join(" ")}</div><a class="b" href="/portal/${esc(d.token)}/doc/${x.id}" target="_blank" rel="noopener">${L("View", "Ver")}</a></div>`;
    })
    .join("");
  const contact = [d.phone ? `<a href="tel:${esc(d.phone.replace(/[^\d+]/g, ""))}">${esc(d.phone)}</a>` : "", d.email ? `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : ""].filter(Boolean).join(" &middot; ");
  return `<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(d.company)} - ${esc(d.title)}</title><style>${CSS}${d.color && /^#[0-9a-fA-F]{6}$/.test(d.color) ? `header{border-bottom:4px solid ${d.color}}` : ""}</style></head><body>
<header>${d.logoUrl && /^https:\/\/[^\s"'<>]{3,300}$/.test(d.logoUrl) ? `<img src="${esc(d.logoUrl)}" alt="${esc(d.company)}" style="max-height:40px;max-width:180px">` : `<b>${esc(d.company)}</b>`}</header><main>
<p class="muted" style="margin:6px 0 0">${L("Hi", "Hola")} ${esc(first)},</p><h1>${esc(d.title)}</h1><div class="st">${esc(stageText(d.stage, es))}</div>
<div class="card"><h2>${L("Your documents", "Sus documentos")}</h2>${rows || `<p class="muted">${L("Nothing has been shared yet. Check back soon.", "Todavía no se ha compartido nada. Vuelva pronto.")}</p>`}</div>
${d.proofUrl ? `<div class="card"><h2>${L("Proof of insurance", "Comprobante de seguro")}</h2><p class="muted" style="margin:0 0 8px">${L("See that the work is insured and what to do if something happens.", "Vea que el trabajo está asegurado y qué hacer si algo sucede.")}</p><a class="b" href="${esc(d.proofUrl)}" target="_blank" rel="noopener">${L("View proof of insurance", "Ver comprobante de seguro")}</a></div>` : ""}
<div class="card"><h2>${L("Questions?", "¿Preguntas?")}</h2><p class="muted" style="margin:0">${contact || L("Reply to the email you received.", "Responda al correo que recibió.")}</p></div>
<p class="muted" style="font-size:12px">${L("This page is private to you. Please do not share the link.", "Esta página es privada. Por favor no comparta el enlace.")}</p>
</main></body></html>`;
}

/** Public: GET /portal/<token> and GET /portal/<token>/doc/<id>. */
export async function handlePortalPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return htmlResp("<p>Not found.</p>", 404);
  const parts = new URL(request.url).pathname.split("/").filter(Boolean); // portal, token, [doc, id]
  const found = await resolve(env, parts[1] ?? "");
  if (!found) return htmlResp("<p>This link is not valid. Ask your painter for a new one.</p>", 404);
  const { companyId, jobId } = found;

  if (parts[2] === "doc") {
    const id = Number(parts[3]);
    if (!Number.isInteger(id) || parts.length !== 4) return htmlResp("<p>Not found.</p>", 404);
    const doc = await env.DB.prepare("SELECT kind, status FROM documents WHERE id = ? AND job_id = ? AND company_id = ?").bind(id, jobId, companyId).first<{ kind: string; status: string }>();
    if (!doc || !(CUSTOMER_DOCS as readonly string[]).includes(doc.kind) || doc.status === "draft") return htmlResp("<p>Not found.</p>", 404);
    const r = await renderDocPage(env, companyId, id);
    return r ? htmlResp(r.page) : htmlResp("<p>Not found.</p>", 404);
  }
  if (parts.length !== 2) return htmlResp("<p>Not found.</p>", 404);

  const job = await env.DB.prepare(
    "SELECT j.title, j.stage, cu.name AS customer, co.name AS company, co.settings AS cosettings, cp.data AS profile FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id LEFT JOIN company_profiles cp ON cp.company_id = j.company_id WHERE j.id = ? AND j.company_id = ?",
  ).bind(jobId, companyId).first<any>();
  if (!job) return htmlResp("<p>Not found.</p>", 404);
  let profile: any = {};
  try {
    profile = job.profile ? JSON.parse(job.profile) : {};
  } catch {
    profile = {};
  }
  const { results } = await env.DB.prepare(
    "SELECT id, kind, status, language FROM documents WHERE job_id = ? AND company_id = ? AND kind IN ('estimate','contract','schedule','warranty','invoice') AND status != 'draft' ORDER BY id",
  ).bind(jobId, companyId).all<{ id: number; kind: string; status: string; language: string }>();
  const latest = new Map<string, { id: number; kind: string; status: string; language: string }>();
  for (const d of results ?? []) latest.set(d.kind, d);
  const sigs = await env.DB.prepare("SELECT kind, status, signed_at FROM signature_requests WHERE job_id = ? AND company_id = ? ORDER BY id").bind(jobId, companyId).all<{ kind: string; status: string; signed_at: string | null }>();
  const signed: Record<string, string> = {};
  const pendingSign: string[] = [];
  for (const s of sigs.results ?? []) {
    if (s.status === "signed" && s.signed_at) signed[s.kind] = s.signed_at.slice(0, 10);
    else if (s.status === "pending") pendingSign.push(s.kind);
  }
  for (const k of Object.keys(signed)) {
    const i = pendingSign.indexOf(k);
    if (i >= 0) pendingSign.splice(i, 1);
  }
  const proofUrl = (await showsCustomers(env, companyId)) ? await coiLink(env, companyId, PUBLIC_BASE) : null;
  const first = [...latest.values()][0];
  const es = (profile.language?.customer ?? first?.language) === "es";
  const c = profile.company ?? {};
  const brand = readSettings(job.cosettings);
  return htmlResp(
    renderPortal({ logoUrl: brand.logoUrl, color: brand.brandColor, es, company: job.company, phone: String(c.phone ?? ""), email: String(c.email ?? ""), customer: job.customer, title: job.title, stage: job.stage, docs: [...latest.values()].map((d) => ({ id: d.id, kind: d.kind, status: d.status, label: d.kind })), signed, pendingSign, proofUrl, token: parts[1] }),
  );
}

/**
 * Public "Check my project" page and lookup for a painter's own website: the customer types the email they used and we EMAIL them
 * their private portal links. The answer is always the same, so nobody can use it to learn who is a customer.
 * Limited to one email per address every 10 minutes.
 */
export function renderLookupPage(company: string, color: string | undefined): string {
  const c = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#E8A33D";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Check my project | ${esc(company)}</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#F7F5F1;color:#0F1B2D;margin:0;padding:24px 16px}main{max-width:460px;margin:0 auto;background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:24px}h1{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:26px;margin:0 0 8px}p{color:#4A5568}input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #cfd5dc;border-radius:8px;font:inherit}button{margin-top:12px;width:100%;padding:13px;border:0;border-radius:8px;background:${c};color:#0F1B2D;font:inherit;font-weight:700;cursor:pointer}#m{margin-top:12px}</style></head><body><main>
<h1>Check my project</h1><p>Enter the email you used with ${esc(company)}. If we find your project, we will email you a private link to follow its progress.</p>
<form id="f"><input id="e" type="email" required placeholder="you@example.com" autocomplete="email"><button>Email me my link</button></form><p id="m"></p></main>
<script>document.getElementById('f').onsubmit=async function(ev){ev.preventDefault();var m=document.getElementById('m');m.textContent='Sending...';try{await fetch('/api/portal/lookup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:document.getElementById('e').value})});}catch(e){}m.textContent='If we found a project for that email, we sent you a link. Check your inbox.';};</script></body></html>`;
}

export async function handleProjectLookup(request: Request, env: Env, slug: string): Promise<Response> {
  const ok = json({ ok: true });
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return ok;
  }
  const email = typeof b?.email === "string" ? b.email.trim().toLowerCase().slice(0, 200) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ok;
  const co = await env.DB.prepare("SELECT id, name, notify_email FROM companies WHERE slug = ?").bind(slug).first<{ id: number; name: string; notify_email: string | null }>();
  if (!co) return ok;
  const gate = `lookup:${co.id}:${await sha256Hex(email)}`;
  const last = await getSetting(env, gate);
  if (last && Date.now() - Number(last) < 10 * 60 * 1000) return ok;
  const jobs = (await env.DB.prepare("SELECT j.id, j.title FROM jobs j JOIN customers cu ON cu.id = j.customer_id WHERE j.company_id = ? AND lower(cu.email) = ? ORDER BY j.id DESC LIMIT 3").bind(co.id, email).all<{ id: number; title: string }>()).results ?? [];
  if (!jobs.length) return ok;
  await putSetting(env, gate, String(Date.now()));
  const lines: string[] = [];
  for (const j of jobs) lines.push(`${j.title}\n${await portalLink(env, co.id, j.id)}`);
  await sendCustomerEmail(env, email, co.name, co.notify_email, `Your project links from ${co.name}`, `Hi,\n\nHere ${jobs.length === 1 ? "is the private link" : "are the private links"} to follow your project:\n\n${lines.join("\n\n")}\n\nIf you did not ask for this, you can ignore this email.\n\n${co.name}`);
  return ok;
}
