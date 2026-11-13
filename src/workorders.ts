import { getSessionUser, randomToken, sha256Hex } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import { sendCustomerEmail, sendLeadEmail } from "./email.ts";
import { readSettings } from "./settings.ts";
import type { Env } from "./types.ts";

/**
 * Work orders and change orders. The painter writes one on a job (scope, reason, priced lines, extra days), sends it by email
 * or shows it in the customer portal, and the customer approves or declines on a private page. It also prints cleanly.
 * The total is added up by code from the lines. Approved change orders show on the job and in the year-end records.
 */

export interface WoLine {
  description: string;
  qty: number;
  unitCents: number;
}
export interface WoBody {
  scope: string;
  reason: string;
  lines: WoLine[];
  daysAdded: number;
  language: "en" | "es";
}

const txt = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function cleanWo(input: any): WoBody {
  const lines: WoLine[] = (Array.isArray(input?.lines) ? input.lines.slice(0, 30) : [])
    .map((l: any) => ({ description: txt(l?.description, 160), qty: Math.min(100000, Math.max(0, Number(l?.qty) || 0)), unitCents: Math.min(100000000, Math.max(0, Math.round(Number(l?.unitCents) || 0))) }))
    .filter((l: WoLine) => l.description && l.qty > 0);
  return { scope: txt(input?.scope, 3000), reason: txt(input?.reason, 1200), lines, daysAdded: Math.min(365, Math.max(0, Math.round(Number(input?.daysAdded) || 0))), language: input?.language === "es" ? "es" : "en" };
}
export const woTotalCents = (lines: WoLine[]) => lines.reduce((s, l) => s + Math.round(l.qty * l.unitCents), 0);
export const woLabel = (kind: string, number: number) => `${kind === "change_order" ? "CO" : "WO"}-${number}`;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const BASE = "https://paintersmax.app";

const T = {
  en: { wo: "Work order", co: "Change order", for: "Prepared for", job: "Job", why: "Reason", scope: "Scope of work", desc: "Description", qty: "Qty", unit: "Unit price", amount: "Amount", total: "Total", days: "Extra days", approve: "Approve", decline: "Decline", name: "Type your full name to confirm", approved: "Approved", declined: "Declined", by: "by", on: "on", pending: "Waiting for your answer", print: "Print", thanks: "Thank you. Your answer was sent to the painter.", needName: "Please type your name." },
  es: { wo: "Orden de trabajo", co: "Orden de cambio", for: "Preparado para", job: "Trabajo", why: "Motivo", scope: "Alcance del trabajo", desc: "Descripción", qty: "Cant.", unit: "Precio unitario", amount: "Importe", total: "Total", days: "Días adicionales", approve: "Aprobar", decline: "Rechazar", name: "Escriba su nombre completo para confirmar", approved: "Aprobada", declined: "Rechazada", by: "por", on: "el", pending: "Esperando su respuesta", print: "Imprimir", thanks: "Gracias. Su respuesta fue enviada al pintor.", needName: "Escriba su nombre." },
};

export function renderWorkOrder(d: { company: string; logoUrl?: string; color?: string; customer: string; jobTitle: string; number: number; kind: string; title: string; body: WoBody; status: string; decidedBy?: string | null; decidedAt?: string | null; token?: string }): string {
  const t = T[d.body.language];
  const total = woTotalCents(d.body.lines);
  const color = d.color && /^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : "#E8A33D";
  const decided = d.status === "approved" || d.status === "declined";
  return `<!doctype html><html lang="${d.body.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(woLabel(d.kind, d.number))} ${esc(d.title)}</title>
<style>*{box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#F7F5F1;color:#0F1B2D;margin:0}main{max-width:720px;margin:0 auto;padding:18px 16px 60px}.sheet{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:22px}h1{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:26px;margin:4px 0}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:7px 4px;border-bottom:1px solid #eee;text-align:left;font-size:14px}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.muted{color:#4A5568;font-size:14px}.tag{display:inline-block;border-radius:99px;padding:3px 11px;font-weight:700;font-size:13px;background:#fff3d6;color:#8a5a00}.tag.ok{background:#e6f4ea;color:#0a7a3d}.tag.no{background:#fdecea;color:#b42318}input{width:100%;padding:11px;border:1px solid #cfd5dc;border-radius:8px;font:inherit}button{padding:12px 18px;border:0;border-radius:8px;font:inherit;font-weight:700;cursor:pointer}.go{background:${color};color:#0F1B2D}.no2{background:#eceae4}.btns{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}@media print{body{background:#fff}.noprint{display:none}.sheet{border:0;padding:0}}</style></head><body><main>
<div class="sheet">${d.logoUrl && /^https:\/\//.test(d.logoUrl) ? `<img src="${esc(d.logoUrl)}" alt="${esc(d.company)}" style="max-height:44px;max-width:200px">` : `<b>${esc(d.company)}</b>`}
<h1>${esc(d.kind === "change_order" ? t.co : t.wo)} ${esc(woLabel(d.kind, d.number))}: ${esc(d.title)}</h1>
<p class="muted">${esc(t.for)}: ${esc(d.customer)} &middot; ${esc(t.job)}: ${esc(d.jobTitle)}</p>
<p>${decided ? `<span class="tag ${d.status === "approved" ? "ok" : "no"}">${esc(d.status === "approved" ? t.approved : t.declined)} ${esc(t.by)} ${esc(d.decidedBy ?? "")} ${esc(t.on)} ${esc(String(d.decidedAt ?? "").slice(0, 10))}</span>` : `<span class="tag">${esc(t.pending)}</span>`}</p>
${d.body.reason ? `<h3>${esc(t.why)}</h3><p>${esc(d.body.reason).replace(/\n/g, "<br>")}</p>` : ""}
${d.body.scope ? `<h3>${esc(t.scope)}</h3><p>${esc(d.body.scope).replace(/\n/g, "<br>")}</p>` : ""}
${d.body.lines.length ? `<table><thead><tr><th>${esc(t.desc)}</th><th>${esc(t.qty)}</th><th>${esc(t.unit)}</th><th>${esc(t.amount)}</th></tr></thead><tbody>${d.body.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${esc(l.qty)}</td><td>${money(l.unitCents)}</td><td>${money(Math.round(l.qty * l.unitCents))}</td></tr>`).join("")}<tr><td colspan="3"><b>${esc(t.total)}</b></td><td><b>${money(total)}</b></td></tr></tbody></table>` : ""}
${d.body.daysAdded ? `<p><b>${esc(t.days)}:</b> ${d.body.daysAdded}</p>` : ""}
${!decided && d.token ? `<div class="noprint"><label for="nm"><b>${esc(t.name)}</b></label><input id="nm" autocomplete="name"><div class="btns"><button class="go" data-d="approve">${esc(t.approve)}</button><button class="no2" data-d="decline">${esc(t.decline)}</button></div><p id="r" class="muted"></p></div>` : ""}
<p class="noprint"><button class="no2" onclick="window.print()">${esc(t.print)}</button></p></div></main>
${!decided && d.token ? `<script>document.querySelectorAll('[data-d]').forEach(function(b){b.onclick=async function(){var n=document.getElementById('nm').value.trim(),r=document.getElementById('r');if(!n){r.textContent=${JSON.stringify(t.needName)};return}b.disabled=true;var x=await fetch(location.pathname+'/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:b.dataset.d,name:n})});var j=await x.json().catch(function(){return{}});if(x.ok){location.reload()}else{r.textContent=j.error||'Error';b.disabled=false}}})</script>` : ""}</body></html>`;
}

const tokKey = (id: number) => `wo:${id}`;
async function getSetting(env: Env, key: string) {
  return (await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
}
/** The work order's private link token, made on first use. */
export async function woToken(env: Env, id: number): Promise<string> {
  let t = await getSetting(env, tokKey(id));
  if (!t) {
    t = randomToken();
    await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(tokKey(id), t).run();
    await env.DB.prepare("UPDATE work_orders SET token_hash = ? WHERE id = ?").bind(await sha256Hex(t), id).run();
  }
  return t;
}

const parse = (s: string | null | undefined): any => {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

/** Public: GET /wo/<token> shows it; POST /wo/<token>/decide {decision, name} answers it. */
export async function handleWoPublic(request: Request, env: Env): Promise<Response> {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean); // wo, token, [decide]
  const tok = parts[1] ?? "";
  const bad = new Response("<p>This link is not valid. Ask your painter for a new one.</p>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  if (!/^[a-f0-9]{64}$/.test(tok)) return bad;
  const wo = await env.DB.prepare("SELECT w.*, co.name AS company, co.settings, co.notify_email, cu.name AS customer, j.title AS jobTitle FROM work_orders w JOIN companies co ON co.id = w.company_id JOIN jobs j ON j.id = w.job_id JOIN customers cu ON cu.id = j.customer_id WHERE w.token_hash = ? AND w.status != 'draft'").bind(await sha256Hex(tok)).first<any>();
  if (!wo) return bad;
  if (request.method === "POST" && parts[2] === "decide") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const name = txt(b?.name, 80);
    if (!name) return json({ error: "Please type your name." }, 400);
    if (b?.decision !== "approve" && b?.decision !== "decline") return json({ error: "Choose approve or decline." }, 400);
    if (wo.status === "approved" || wo.status === "declined") return json({ error: "This was already answered." }, 400);
    const status = b.decision === "approve" ? "approved" : "declined";
    await env.DB.prepare("UPDATE work_orders SET status = ?, decided_at = datetime('now'), decided_by = ?, updated_at = datetime('now') WHERE id = ? AND status = 'sent'").bind(status, name, wo.id).run();
    const label = woLabel(wo.kind, wo.number);
    await addJobEvent(env, wo.company_id, wo.job_id, "change_order", `${label} ${status} by ${name}: ${wo.title}.`);
    if (wo.notify_email) await sendLeadEmail(env, wo.notify_email, `${label} ${status} by ${wo.customer}`, `${wo.customer} ${status} ${label} "${wo.title}" for ${wo.jobTitle}.\nTotal: ${money(woTotalCents(parse(wo.body).lines ?? []))}`).catch(() => undefined);
    return json({ ok: true });
  }
  if (request.method !== "GET") return bad;
  const s = readSettings(wo.settings);
  return new Response(renderWorkOrder({ company: wo.company, logoUrl: s.logoUrl, color: s.brandColor, customer: wo.customer, jobTitle: wo.jobTitle, number: wo.number, kind: wo.kind, title: wo.title, body: cleanWo(parse(wo.body)), status: wo.status, decidedBy: wo.decided_by, decidedAt: wo.decided_at, token: tok }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });
}

/**
 * Painter API  /api/workorders
 *  GET ?jobId=             list for a job
 *  GET ?id=&print=1        printable page for the painter (any status)
 *  POST {action:"save", id?, jobId, kind, title, ...body}
 *  POST {action:"send", id, via:"email"|"link"}   makes it visible to the customer; email sends the link
 *  POST {action:"delete", id}                     drafts only
 */
export async function handleWorkOrders(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  const u = new URL(request.url);
  if (request.method === "GET") {
    if (u.searchParams.has("id")) {
      const wo = await env.DB.prepare("SELECT w.*, co.name AS company, co.settings, cu.name AS customer, j.title AS jobTitle FROM work_orders w JOIN companies co ON co.id = w.company_id JOIN jobs j ON j.id = w.job_id JOIN customers cu ON cu.id = j.customer_id WHERE w.id = ? AND w.company_id = ?").bind(Number(u.searchParams.get("id")), c).first<any>();
      if (!wo) return new Response("Not found.", { status: 404 });
      const s = readSettings(wo.settings);
      return new Response(renderWorkOrder({ company: wo.company, logoUrl: s.logoUrl, color: s.brandColor, customer: wo.customer, jobTitle: wo.jobTitle, number: wo.number, kind: wo.kind, title: wo.title, body: cleanWo(parse(wo.body)), status: wo.status, decidedBy: wo.decided_by, decidedAt: wo.decided_at }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    const jobId = Number(u.searchParams.get("jobId"));
    const rows = Number.isInteger(jobId) ? (await env.DB.prepare("SELECT id, number, kind, title, body, status, sent_at AS sentAt, decided_at AS decidedAt, decided_by AS decidedBy FROM work_orders WHERE company_id = ? AND job_id = ? ORDER BY id DESC").bind(c, jobId).all<any>()).results ?? [] : [];
    const out = [];
    for (const r of rows) {
      const body = cleanWo(parse(r.body));
      out.push({ id: r.id, number: r.number, label: woLabel(r.kind, r.number), kind: r.kind, title: r.title, status: r.status, sentAt: r.sentAt, decidedAt: r.decidedAt, decidedBy: r.decidedBy, ...body, totalCents: woTotalCents(body.lines), link: r.status === "draft" ? null : `${BASE}/wo/${await woToken(env, r.id)}` });
    }
    return json({ workOrders: out, approvedCents: out.filter((x) => x.status === "approved" && x.kind === "change_order").reduce((s, x) => s + x.totalCents, 0) });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (b?.action === "save") {
    const jobId = Number(b.jobId);
    const job = Number.isInteger(jobId) ? await env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").bind(jobId, c).first() : null;
    if (!job) return json({ error: "Job not found." }, 404);
    const title = txt(b.title, 120);
    if (!title) return json({ error: "Give it a short title." }, 400);
    const kind = b.kind === "change_order" ? "change_order" : "work_order";
    const body = JSON.stringify(cleanWo(b));
    if (b.id) {
      const cur = await env.DB.prepare("SELECT status FROM work_orders WHERE id = ? AND company_id = ?").bind(Number(b.id), c).first<{ status: string }>();
      if (!cur) return json({ error: "Not found." }, 404);
      if (cur.status === "approved" || cur.status === "declined") return json({ error: "This was already answered, so it cannot be changed. Make a new one." }, 400);
      await env.DB.prepare("UPDATE work_orders SET title = ?, kind = ?, body = ?, updated_at = datetime('now') WHERE id = ?").bind(title, kind, body, Number(b.id)).run();
      return json({ ok: true, id: Number(b.id) });
    }
    const n = await env.DB.prepare("SELECT COALESCE(MAX(number),0) + 1 AS n FROM work_orders WHERE company_id = ?").bind(c).first<{ n: number }>();
    const r = await env.DB.prepare("INSERT INTO work_orders (company_id, job_id, number, kind, title, body) VALUES (?, ?, ?, ?, ?, ?)").bind(c, jobId, n?.n ?? 1, kind, title, body).run();
    await addJobEvent(env, c, jobId, "change_order", `${woLabel(kind, n?.n ?? 1)} drafted: ${title}.`);
    return json({ ok: true, id: Number(r.meta.last_row_id) });
  }
  const id = Number(b?.id);
  const wo = Number.isInteger(id) ? await env.DB.prepare("SELECT w.id, w.job_id AS jobId, w.number, w.kind, w.title, w.body, w.status, cu.email, cu.name AS customer, co.name AS company, co.notify_email FROM work_orders w JOIN jobs j ON j.id = w.job_id JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = w.company_id WHERE w.id = ? AND w.company_id = ?").bind(id, c).first<any>() : null;
  if (!wo) return json({ error: "Not found." }, 404);
  if (b?.action === "delete") {
    if (wo.status !== "draft") return json({ error: "Only drafts can be deleted." }, 400);
    await env.DB.prepare("DELETE FROM work_orders WHERE id = ?").bind(id).run();
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(tokKey(id)).run();
    return json({ ok: true });
  }
  if (b?.action === "send") {
    if (wo.status === "approved" || wo.status === "declined") return json({ error: "This was already answered." }, 400);
    const body = cleanWo(parse(wo.body));
    if (!body.lines.length && !body.scope) return json({ error: "Add a scope or at least one priced line first." }, 400);
    if (b.via === "email" && !wo.email) return json({ error: "This customer has no email address. Use Get link instead." }, 400);
    const link = `${BASE}/wo/${await woToken(env, id)}`;
    await env.DB.prepare("UPDATE work_orders SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(id).run();
    let emailed = false;
    if (b.via === "email") {
      if (!wo.email) return json({ error: "This customer has no email address. Copy the link instead.", link }, 400);
      const es = body.language === "es";
      const label = woLabel(wo.kind, wo.number);
      const res = await sendCustomerEmail(env, wo.email, wo.company, wo.notify_email, es ? `${label}: ${wo.title}` : `${label}: ${wo.title} for your approval`,
        es ? `Hola ${String(wo.customer).split(/\s+/)[0]},\n\nLe enviamos ${label} para su revisión y aprobación:\n${link}\n\n${wo.company}` : `Hi ${String(wo.customer).split(/\s+/)[0]},\n\nPlease review and approve ${label} here:\n${link}\n\n${wo.company}`);
      emailed = res === "sent";
    }
    await addJobEvent(env, c, wo.jobId, "change_order", `${woLabel(wo.kind, wo.number)} sent to the customer${emailed ? " by email" : ""}: ${wo.title}.`);
    return json({ ok: true, link, emailed });
  }
  return json({ error: "Unknown action." }, 400);
}
