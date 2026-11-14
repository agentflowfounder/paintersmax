import { getSessionUser, randomToken, sha256Hex } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import { sendCustomerEmail } from "./email.ts";
import { coiLink, showsCustomers } from "./insurance.ts";
import { renderDocPage } from "./wizard-api.ts";
import { addDaysIso, friendlyDate, isIsoDate, todayLocal } from "./dates.ts";
import { visitWhen } from "./visit.ts";
import { cleanText, painterNotice, readSignoff, type Signoff } from "./signoffcore.ts";
import { sendLeadEmail } from "./email.ts";
import { readSettings } from "./settings.ts";
import { CUSTOMER_MAX_FILES, saveFile } from "./files.ts";
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

/** Shrinks each photo in the browser, then uploads it to this job. */
const PHOTO_JS = `(function(){var i=document.getElementById('ph');if(!i)return;var m=document.getElementById('phm');
function shrink(f){return new Promise(function(res){var im=new Image();im.onload=function(){var s=Math.min(1,1600/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);c.toBlob(function(b){res(b||f)},'image/jpeg',0.82)};im.onerror=function(){res(f)};im.src=URL.createObjectURL(f)})}
i.onchange=async function(){var ok=0,n=0;for(var k=0;k<i.files.length;k++){n++;m.textContent='Uploading '+n+'...';var b=await shrink(i.files[k]),fd=new FormData();fd.append('file',b,'photo.jpg');try{var r=await fetch(location.pathname.replace(/\\/$/,'')+'/upload',{method:'POST',body:fd});var j=await r.json();if(r.ok)ok++;else{m.textContent=j.error||'Could not upload.';return}}catch(e){m.textContent='Could not upload.';return}}m.textContent=ok+' photo'+(ok===1?'':'s')+' sent. Thank you.';i.value=''}})();`;

export function renderPortal(d: {
  es: boolean; company: string; phone: string; email: string; customer: string; title: string; stage: string;
  docs: { id: number; kind: string; status: string; label: string }[]; signed: Record<string, string>; pendingSign: string[]; proofUrl: string | null; token: string; logoUrl?: string; color?: string;
  /** An upcoming site visit the painter booked, already worded for the customer. */
  visit?: { when: string; address: string } | null;
  /** Sign-off on the finished work, only when the painter asked for it. */
  signoff?: { state: "asked" | "accepted"; on?: string; name?: string; concern?: boolean } | null;
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
${d.visit ? `<div class="card"><h2>${L("Your visit", "Su visita")}</h2><p style="margin:0"><b>${esc(d.visit.when)}</b>${d.visit.address ? `<br><span class="muted">${esc(d.visit.address)}</span>` : ""}</p></div>` : ""}
${d.signoff ? signoffCard(d.signoff, d.company, es) : ""}
<div class="card"><h2>${L("Your documents", "Sus documentos")}</h2>${rows || `<p class="muted">${L("Nothing has been shared yet. Check back soon.", "Todavía no se ha compartido nada. Vuelva pronto.")}</p>`}</div>
${d.proofUrl ? `<div class="card"><h2>${L("Proof of insurance", "Comprobante de seguro")}</h2><p class="muted" style="margin:0 0 8px">${L("See that the work is insured and what to do if something happens.", "Vea que el trabajo está asegurado y qué hacer si algo sucede.")}</p><a class="b" href="${esc(d.proofUrl)}" target="_blank" rel="noopener">${L("View proof of insurance", "Ver comprobante de seguro")}</a></div>` : ""}
<div class="card"><h2>${L("Add photos", "Agregar fotos")}</h2><p class="muted" style="margin:0 0 8px">${L("Share photos of what you want us to see, like a stain, crack or peeling spot. Your painter will see them.", "Comparta fotos de lo que quiere que veamos, como una mancha, grieta o pintura levantada. Su pintor las verá.")}</p><input type="file" id="ph" accept="image/*" multiple><p id="phm" class="muted" style="margin:6px 0 0"></p></div>
<div class="card"><h2>${L("Questions?", "¿Preguntas?")}</h2><p class="muted" style="margin:0">${contact || L("Reply to the email you received.", "Responda al correo que recibió.")}</p></div>
<p class="muted" style="font-size:12px">${L("This page is private to you. Please do not share the link.", "Esta página es privada. Por favor no comparta el enlace.")}</p>
</main><script>${PHOTO_JS}</script></body></html>`;
}


/** The "accept the finished work" card on the customer page. Only shown when the painter asked for it. */
function signoffCard(so: { state: "asked" | "accepted"; on?: string; name?: string; concern?: boolean }, company: string, es: boolean): string {
  const L = (en: string, sp: string) => (es ? sp : en);
  if (so.state === "accepted") {
    return `<div class="card"><h2>${L("Finished work", "Trabajo terminado")}</h2><p style="margin:0"><b>${L("You accepted the finished work", "Usted aceptó el trabajo terminado")}${so.on ? ` ${L("on", "el")} ${esc(friendlyDate(so.on, es ? "es" : "en"))}` : ""}.</b> ${L("Thank you!", "¡Gracias!")}</p></div>`;
  }
  const script = `<script>(function(){var h=location.pathname.replace(/\\/$/,''),m=document.getElementById('so_m');function send(p,b,done){m.textContent='...';fetch(h+'/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).then(function(j){if(j.error){m.textContent=j.error;return}done()}).catch(function(){m.textContent=${JSON.stringify(L("Something went wrong. Please try again.", "Algo salió mal. Inténtelo de nuevo."))}})}
document.getElementById('so_ok').onclick=function(){var n=document.getElementById('so_n').value.trim();if(!n){m.textContent=${JSON.stringify(L("Please type your name.", "Escriba su nombre."))};return}send('accept',{name:n},function(){location.reload()})};
document.getElementById('so_t').onclick=function(){document.getElementById('so_c').style.display='block';this.style.display='none'};
document.getElementById('so_s').onclick=function(){var t=document.getElementById('so_x').value.trim();if(!t){m.textContent=${JSON.stringify(L("Please tell us what needs attention.", "Díganos qué necesita atención."))};return}send('concern',{text:t},function(){location.reload()})};})();</script>`;
  return `<div class="card"><h2>${L("Finished work", "Trabajo terminado")}</h2>
<p style="margin:0 0 8px">${esc(company)} ${L("says the work is finished. Take a walk through. If everything looks right, type your name and confirm.", "dice que el trabajo está terminado. Recorra el lugar. Si todo se ve bien, escriba su nombre y confirme.")}</p>
${so.concern ? `<p class="muted" style="margin:0 0 8px">${L("Your note was sent. Your painter will follow up. You can still confirm below once everything looks right.", "Su nota fue enviada. Su pintor le contactará. Aún puede confirmar abajo cuando todo se vea bien.")}</p>` : ""}
<label for="so_n" style="display:block;font-weight:600;margin:6px 0 3px">${L("Type your full name to confirm", "Escriba su nombre completo para confirmar")}</label><input id="so_n" autocomplete="name" style="width:100%;padding:11px;border:1px solid #cfd5dc;border-radius:8px;font:inherit">
<div style="margin-top:10px"><button id="so_ok" class="b" style="border:0;cursor:pointer">${L("I accept the finished work", "Acepto el trabajo terminado")}</button></div>
<p style="margin:12px 0 0"><a href="#" id="so_t" onclick="return false">${L("Something needs attention?", "¿Algo necesita atención?")}</a></p>
<div id="so_c" style="display:none;margin-top:8px"><textarea id="so_x" rows="3" maxlength="1000" style="width:100%;padding:10px;border:1px solid #cfd5dc;border-radius:8px;font:inherit" placeholder="${esc(L("Tell us what still needs attention", "Díganos qué necesita atención"))}"></textarea><div style="margin-top:8px"><button id="so_s" class="b" style="border:0;cursor:pointer">${L("Send to", "Enviar a")} ${esc(company)}</button></div></div>
<p id="so_m" class="muted" style="margin:8px 0 0"></p>${script}</div>`;
}

/** The customer-facing line for a booked visit that has not passed yet, or null. */
export function portalVisit(jobData: unknown, es: boolean, fallbackAddress = ""): { when: string; address: string } | null {
  try {
    const v = typeof jobData === "string" && jobData ? JSON.parse(jobData)?.visit : null;
    if (!v || v.status !== "booked" || !isIsoDate(v.date) || v.date < addDaysIso(todayLocal(), -1)) return null;
    return { when: visitWhen({ date: v.date, time: typeof v.time === "string" ? v.time : "", lang: es ? "es" : "en" }), address: fallbackAddress };
  } catch {
    return null;
  }
}

export function portalSignoff(jobData: unknown): { state: "asked" | "accepted"; on?: string; name?: string; concern?: boolean } | null {
  const s = readSignoff(jobData);
  if (!s) return null;
  return s.acceptedAt ? { state: "accepted", on: s.acceptedOn, name: s.acceptedBy } : { state: "asked", concern: !!s.concern };
}

/** Public: GET /portal/<token> and GET /portal/<token>/doc/<id>. */
export async function handlePortalPage(request: Request, env: Env): Promise<Response> {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean); // portal, token, [doc, id | upload]
  if (request.method === "POST" && parts[2] === "upload" && parts.length === 3) {
    const f = await resolve(env, parts[1] ?? "");
    if (!f) return json({ error: "This link is not valid." }, 404);
    const fd = await request.formData().catch(() => null);
    const file = fd?.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/")) return json({ error: "Please choose a photo." }, 400);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_files WHERE company_id = ? AND job_id = ? AND uploaded_by = 'customer'").bind(f.companyId, f.jobId).first<{ n: number }>();
    if ((n?.n ?? 0) >= CUSTOMER_MAX_FILES) return json({ error: "You have added the most photos allowed. Please contact your painter." }, 400);
    const r = await saveFile(env, { companyId: f.companyId, jobId: f.jobId, kind: "photo", file, by: "customer", note: "Added by the customer" });
    if (!r.ok) return json({ error: r.status === 413 ? "Your painter's photo storage is full. Please send photos by email." : r.error }, r.status);
    await addJobEvent(env, f.companyId, f.jobId, "note", "The customer added a photo from their portal.");
    return json({ ok: true });
  }
  if (request.method === "POST" && (parts[2] === "accept" || parts[2] === "concern") && parts.length === 3) {
    const f = await resolve(env, parts[1] ?? "");
    if (!f) return json({ error: "This link is not valid." }, 404);
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    const row = await env.DB.prepare("SELECT j.title, j.data, cu.name AS customer, co.notify_email FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id WHERE j.id = ? AND j.company_id = ?").bind(f.jobId, f.companyId).first<any>();
    const so = row ? readSignoff(row.data) : null;
    if (!row || !so) return json({ error: "Your painter has not asked for this yet." }, 400);
    if (so.acceptedAt) return json({ error: "The finished work was already accepted. Thank you!" }, 400);
    let next: Signoff;
    let note: { subject: string; body: string };
    if (parts[2] === "accept") {
      const name = cleanText(b?.name, 80);
      if (!name) return json({ error: "Please type your name." }, 400);
      const now = new Date();
      next = { ...so, acceptedAt: now.toISOString(), acceptedOn: todayLocal(now.getTime()), acceptedBy: name };
      note = painterNotice("accepted", { customer: row.customer, title: row.title, name });
    } else {
      const text = cleanText(b?.text, 1000);
      if (!text) return json({ error: "Please tell us what needs attention." }, 400);
      next = { ...so, concern: { text, at: new Date().toISOString() } };
      note = painterNotice("concern", { customer: row.customer, title: row.title, text });
    }
    // The accept only goes through while nobody has accepted yet, so a double tap cannot overwrite the first answer.
    const upd = await env.DB.prepare("UPDATE jobs SET data = json_set(COALESCE(data, '{}'), '$.signoff', json(?)), updated_at = datetime('now') WHERE id = ? AND company_id = ? AND json_extract(data, '$.signoff.acceptedAt') IS NULL").bind(JSON.stringify(next), f.jobId, f.companyId).run();
    if (!upd.meta?.changes) return json({ error: "The finished work was already accepted. Thank you!" }, 400);
    await addJobEvent(env, f.companyId, f.jobId, "note", parts[2] === "accept" ? `The customer accepted the finished work (${next.acceptedBy}) on ${next.acceptedOn}.` : `The customer sent a note about the finished work: ${next.concern!.text}`);
    if (row.notify_email) await sendLeadEmail(env, row.notify_email, note.subject, note.body).catch(() => undefined);
    return json({ ok: true });
  }
  if (request.method !== "GET") return htmlResp("<p>Not found.</p>", 404);
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
    "SELECT j.title, j.stage, j.data AS jdata, cu.name AS customer, co.name AS company, co.settings AS cosettings, cp.data AS profile, p.address AS paddr, p.city AS pcity, p.zip AS pzip FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id LEFT JOIN company_profiles cp ON cp.company_id = j.company_id LEFT JOIN properties p ON p.id = j.property_id WHERE j.id = ? AND j.company_id = ?",
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
    renderPortal({ logoUrl: brand.logoUrl, color: brand.brandColor, es, company: job.company, phone: String(c.phone ?? ""), email: String(c.email ?? ""), customer: job.customer, title: job.title, stage: job.stage, docs: [...latest.values()].map((d) => ({ id: d.id, kind: d.kind, status: d.status, label: d.kind })), signed, pendingSign, proofUrl, token: parts[1], signoff: portalSignoff(job.jdata), visit: portalVisit(job.jdata, es, [job.paddr, job.pcity, job.pzip].filter(Boolean).join(", ")) }),
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
