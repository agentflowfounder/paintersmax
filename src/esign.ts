import { getSessionUser, randomToken, sha256Hex } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import { sendCustomerEmail } from "./email.ts";
import { portalNote } from "./portal.ts";
import { renderDocPage } from "./wizard-api.ts";
import { documentAttachment, htmlToPdf } from "./pdf.ts";
import type { Env } from "./types.ts";

/**
 * Electronic signatures built into the app (no paid service).
 * The painter sends an estimate or contract. We freeze the exact page the customer sees (the snapshot) and store its
 * SHA-256. The customer opens a private link, types their name, optionally draws it, and agrees to sign electronically.
 * We record the time, IP address and browser, then email the signed copy to both sides.
 */

const SIGNABLE = ["estimate", "contract"];
const LINK_DAYS = 30;
const PNG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]{1,200000}$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const htmlResp = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);


export function cleanName(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 100) : "";
}
export function cleanPng(v: unknown): string | null {
  return typeof v === "string" && PNG_RE.test(v) ? v : null;
}

export interface SignedRecord {
  id: number;
  signedName: string;
  signedAt: string;
  signatureData: string | null;
  ip: string | null;
  docHash: string;
  language: string;
}

/** Adds the signature block to the end of the frozen document. Everything inserted is escaped. */
export function withSignature(snapshot: string, r: SignedRecord): string {
  const es = r.language === "es";
  const block = `<div style="max-width:780px;margin:28px auto;padding:16px 20px;border:2px solid #0F1B2D;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#0F1B2D;page-break-inside:avoid">
<div style="font-weight:700;font-size:15px;margin-bottom:8px">${es ? "Firmado electrónicamente" : "Electronically signed"}</div>
${r.signatureData ? `<img alt="" src="${esc(r.signatureData)}" style="max-width:320px;max-height:110px;border-bottom:1px solid #999;display:block;margin-bottom:6px">` : ""}
<div style="font-size:18px;font-style:italic;font-family:Georgia,serif;margin-bottom:6px">${esc(r.signedName)}</div>
<div>${es ? "Fecha y hora (UTC)" : "Date and time (UTC)"}: ${esc(r.signedAt)}</div>
<div>${es ? "Dirección IP" : "IP address"}: ${esc(r.ip || "n/a")}</div>
<div style="word-break:break-all">${es ? "Huella digital del documento (SHA-256)" : "Document fingerprint (SHA-256)"}: ${esc(r.docHash)}</div>
<div>${es ? "Registro" : "Record"} #${esc(r.id)}</div>
<div style="margin-top:8px;color:#4A5568">${es ? "El firmante aceptó firmar electrónicamente y que esta firma tiene el mismo efecto que una firma a mano." : "The signer agreed to sign electronically and that this signature has the same effect as a handwritten one."}</div>
</div>`;
  return snapshot.includes("</body>") ? snapshot.replace("</body>", () => block + "</body>") : snapshot + block;
}

function origin(request: Request): string {
  return new URL(request.url).origin;
}

const rowToItem = (r: any) => ({
  id: r.id,
  documentId: r.document_id,
  kind: r.kind,
  signerName: r.signer_name,
  signerEmail: r.signer_email,
  status: r.status === "pending" && r.expires_at < new Date().toISOString() ? "expired" : r.status,
  createdAt: r.created_at,
  viewedAt: r.viewed_at,
  signedAt: r.signed_at,
});

/** Owner side. GET /api/esign?jobId= lists requests. POST /api/esign {action: send | void}. GET /api/esign/record?id= opens a signed copy. */
export async function handleEsign(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  const url = new URL(request.url);
  if (!user) return url.pathname.endsWith("/record") ? htmlResp("<p>Not signed in. <a href='/login'>Sign in</a></p>", 401) : json({ error: "Not signed in." }, 401);

  if (request.method === "GET" && url.pathname === "/api/esign/record") {
    const id = Number(url.searchParams.get("id"));
    const r = Number.isInteger(id) ? await env.DB.prepare("SELECT * FROM signature_requests WHERE id = ? AND company_id = ? AND status = 'signed'").bind(id, user.companyId).first<any>() : null;
    if (!r) return htmlResp("<p>Not found.</p>", 404);
    const page = withSignature(r.snapshot, recordOf(r));
    if (url.searchParams.get("format") === "pdf") {
      const pdf = await htmlToPdf(env, page);
      if (pdf) return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="signed-${r.kind}.pdf"`, "cache-control": "no-store", "x-robots-tag": "noindex" } });
    }
    return htmlResp(page);
  }

  if (request.method === "GET" && url.searchParams.get("all") === "1") {
    const rows = await env.DB.prepare(
      `SELECT s.id, s.job_id, s.document_id, s.kind, s.signer_name, s.signer_email, s.status, s.expires_at, s.created_at, s.viewed_at, s.signed_at,
              j.title AS job_title
         FROM signature_requests s JOIN jobs j ON j.id = s.job_id
        WHERE s.company_id = ? ORDER BY s.id DESC LIMIT 100`,
    ).bind(user.companyId).all();
    const items = (rows.results as any[]).map((r) => ({ ...rowToItem(r), jobId: r.job_id, jobTitle: r.job_title }));
    const signed = items.filter((i) => i.status === "signed");
    const hours = signed.map((i) => (Date.parse(i.signedAt + "") - Date.parse(String(i.createdAt).replace(" ", "T") + "Z")) / 3600000).filter((h) => h >= 0 && Number.isFinite(h));
    hours.sort((a, b) => a - b);
    return json({
      items,
      summary: {
        signed: signed.length,
        awaiting: items.filter((i) => i.status === "pending").length,
        expired: items.filter((i) => i.status === "expired").length,
        medianHours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null,
      },
    });
  }

  if (request.method === "GET") {
    const jobId = Number(url.searchParams.get("jobId"));
    if (!Number.isInteger(jobId) || jobId <= 0) return json({ error: "Not found." }, 404);
    const rows = await env.DB.prepare(
      "SELECT id, document_id, kind, signer_name, signer_email, status, expires_at, created_at, viewed_at, signed_at FROM signature_requests WHERE company_id = ? AND job_id = ? ORDER BY id DESC LIMIT 20",
    ).bind(user.companyId, jobId).all();
    return json({ requests: (rows.results as any[]).map(rowToItem) });
  }

  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  if (b?.action === "void") {
    const id = Number(b.id);
    const res = await env.DB.prepare("UPDATE signature_requests SET status = 'void' WHERE id = ? AND company_id = ? AND status = 'pending'").bind(id, user.companyId).run();
    return res.meta.changes ? json({ ok: true }) : json({ error: "Only a waiting request can be cancelled." }, 400);
  }

  if (b?.action !== "send") return json({ error: "Unknown action." }, 400);
  const docId = Number(b.docId);
  if (!Number.isInteger(docId) || docId <= 0) return json({ error: "Not found." }, 404);
  const rendered = await renderDocPage(env, user.companyId, docId);
  if (!rendered || !SIGNABLE.includes(rendered.kind)) return json({ error: "Only an estimate or a contract can be sent for signature." }, 400);
  const cust = await env.DB.prepare(
    "SELECT cu.name, cu.email FROM jobs j JOIN customers cu ON cu.id = j.customer_id WHERE j.id = ? AND j.company_id = ?",
  ).bind(rendered.jobId, user.companyId).first<{ name: string; email: string | null }>();
  if (!cust) return json({ error: "Not found." }, 404);
  const signerName = cleanName(b.signerName) || cust.name;
  const signerEmail = (typeof b.signerEmail === "string" ? b.signerEmail.trim() : "") || cust.email || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail) || signerEmail.length > 200) return json({ error: "This customer needs an email address first." }, 400);

  // A new request replaces any older waiting one for the same document.
  await env.DB.prepare("UPDATE signature_requests SET status = 'void' WHERE company_id = ? AND document_id = ? AND status = 'pending'").bind(user.companyId, docId).run();
  const token = randomToken();
  const docHash = await sha256Hex(rendered.page);
  const expires = new Date(Date.now() + LINK_DAYS * 86400000).toISOString();
  const ins = await env.DB.prepare(
    `INSERT INTO signature_requests (company_id, job_id, document_id, kind, language, title, token_hash, snapshot, doc_hash, signer_name, signer_email, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(user.companyId, rendered.jobId, docId, rendered.kind, rendered.language === "es" ? "es" : "en", rendered.title.slice(0, 160), await sha256Hex(token), rendered.page, docHash, signerName, signerEmail, expires).run();
  const link = `${origin(request)}/sign/${token}`;
  const es = rendered.language === "es";
  const what = rendered.kind === "contract" ? (es ? "contrato" : "work agreement") : es ? "estimado" : "estimate";
  const result = await sendCustomerEmail(
    env,
    signerEmail,
    user.companyName,
    user.email,
    es ? `Por favor firme su ${what} de ${user.companyName}` : `Please review and sign your ${what} from ${user.companyName}`,
    (es
      ? `Hola ${signerName},\n\nPuede leer y firmar su ${what} aquí:\n${link}\n\nEl enlace funciona por ${LINK_DAYS} días. Responda a este correo si tiene preguntas.\n\n${user.companyName}`
      : `Hi ${signerName},\n\nYou can read and sign your ${what} here:\n${link}\n\nThe link works for ${LINK_DAYS} days. Reply to this email with any questions.\n\n${user.companyName}`) + (await portalNote(env, user.companyId, rendered.jobId, es)),
  );
  await addJobEvent(env, user.companyId, rendered.jobId, "note", `Sent the ${rendered.kind} for signature to ${signerEmail}${result === "sent" ? "" : " (email not sent; copy the link)"}.`);
  return json({ ok: true, id: Number(ins.meta.last_row_id), link, emailed: result === "sent" });
}

function recordOf(r: any): SignedRecord {
  return { id: r.id, signedName: r.signed_name, signedAt: r.signed_at, signatureData: r.signature_png, ip: r.signer_ip, docHash: r.doc_hash, language: r.language };
}

async function findByToken(env: Env, token: unknown): Promise<any | null> {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  return await env.DB.prepare("SELECT sr.*, co.name AS company_name FROM signature_requests sr JOIN companies co ON co.id = sr.company_id WHERE sr.token_hash = ?").bind(await sha256Hex(token)).first<any>();
}

/** Customer side, no login. GET /api/sign/view?t= and POST /api/sign/submit {t, name, agree, drawing}. */
export async function handleSign(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/sign/view") {
    const r = await findByToken(env, url.searchParams.get("t"));
    if (!r) return json({ error: "This signing link is not valid." }, 404);
    const expired = r.status === "pending" && r.expires_at < new Date().toISOString();
    const status = expired ? "expired" : r.status;
    if (status === "pending" && !r.viewed_at) await env.DB.prepare("UPDATE signature_requests SET viewed_at = datetime('now') WHERE id = ?").bind(r.id).run();
    return json({
      status,
      company: r.company_name,
      kind: r.kind,
      language: r.language,
      signerName: r.signer_name,
      html: status === "signed" ? withSignature(r.snapshot, recordOf(r)) : status === "pending" ? r.snapshot : null,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/sign/submit") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const r = await findByToken(env, b?.t);
    if (!r) return json({ error: "This signing link is not valid." }, 404);
    const es = r.language === "es";
    if (r.status !== "pending") return json({ error: es ? "Este documento ya no se puede firmar." : "This document can no longer be signed." }, 400);
    if (r.expires_at < new Date().toISOString()) return json({ error: es ? "El enlace venció. Pida uno nuevo." : "This link has expired. Ask for a new one." }, 400);
    const name = cleanName(b.name);
    if (name.length < 2) return json({ error: es ? "Escriba su nombre completo." : "Type your full name." }, 400);
    if (b.agree !== true) return json({ error: es ? "Marque la casilla para aceptar firmar electrónicamente." : "Check the box to agree to sign electronically." }, 400);
    const drawing = b.drawing ? cleanPng(b.drawing) : null;
    if (b.drawing && !drawing) return json({ error: es ? "La firma dibujada no es válida." : "The drawn signature was not valid." }, 400);
    const signedAt = new Date().toISOString();
    const ip = request.headers.get("cf-connecting-ip");
    const agent = (request.headers.get("user-agent") || "").slice(0, 300);
    const res = await env.DB.prepare(
      "UPDATE signature_requests SET status = 'signed', signed_at = ?, signed_name = ?, signature_png = ?, signer_ip = ?, signer_agent = ? WHERE id = ? AND status = 'pending'",
    ).bind(signedAt, name, drawing, ip, agent, r.id).run();
    if (!res.meta.changes) return json({ error: es ? "Este documento ya fue firmado." : "This document was already signed." }, 400);

    await env.DB.prepare("UPDATE documents SET status = 'signed', updated_at = datetime('now') WHERE id = ?").bind(r.document_id).run();
    if (r.kind === "contract") {
      await env.DB.prepare("UPDATE jobs SET stage = 'scheduled', updated_at = datetime('now') WHERE id = ? AND stage IN ('lead','bid','contract')").bind(r.job_id).run();
    }
    await addJobEvent(env, r.company_id, r.job_id, "stage", `${r.kind === "contract" ? "Contract" : "Estimate"} signed online by ${name}.`);

    const signedPage = withSignature(r.snapshot, { id: r.id, signedName: name, signedAt, signatureData: drawing, ip, docHash: r.doc_hash, language: r.language });
    const prof = await env.DB.prepare("SELECT co.notify_email, cp.data FROM companies co LEFT JOIN company_profiles cp ON cp.company_id = co.id WHERE co.id = ?").bind(r.company_id).first<{ notify_email: string | null; data: string | null }>();
    let companyEmail: string | null = prof?.notify_email ?? null;
    try {
      companyEmail = JSON.parse(prof?.data || "{}")?.company?.email || companyEmail;
    } catch {
      /* keep notify_email */
    }
    const attach = [await documentAttachment(env, `signed-${r.kind}`, signedPage)];
    const what = r.kind === "contract" ? (es ? "contrato" : "work agreement") : es ? "estimado" : "estimate";
    await sendCustomerEmail(
      env, r.signer_email, r.company_name, companyEmail,
      es ? `Su ${what} firmado de ${r.company_name}` : `Your signed ${what} from ${r.company_name}`,
      (es ? `Hola ${name},\n\nGracias. Adjuntamos su copia firmada.\n\n${r.company_name}` : `Hi ${name},\n\nThank you. Your signed copy is attached.\n\n${r.company_name}`) + (await portalNote(env, r.company_id, r.job_id, es)),
      attach,
    );
    if (companyEmail) {
      await sendCustomerEmail(
        env, companyEmail, "PaintersMax", r.signer_email,
        `${name} signed the ${what}`,
        `${name} signed the ${what} "${r.title}" online. The signed copy is attached and is also saved on the job.\n`,
        attach,
      );
    }
    return json({ ok: true, portal: (await portalNote(env, r.company_id, r.job_id, es)).split("\n").pop() || null });
  }
  return json({ error: "Not found." }, 404);
}
