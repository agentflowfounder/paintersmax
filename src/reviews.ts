import { sha256Hex } from "./auth.ts";
import { escapeHtml as e, readSettings } from "./settings.ts";
import type { Env } from "./types.ts";

/**
 * Reviews on the painter's own website, from customers who really paid for a job.
 *
 * The painter makes a private link for one paid job (an invoice marked paid). The customer opens it and writes
 * one review. The link works for 45 days unless the painter picks another length. New reviews wait until the painter
 * shows them; the painter can hide or show any review later and reply with a short note and a like, smile or heart.
 * This is separate from the Google review request, which sends the customer to Google.
 *
 * Storage (app_settings, no database change):
 *   revlink:<sha256 of token>  { companyId, jobId, customer, expiresOn, usedAt? }
 *   review:<companyId>:<id>    the review, its status and the painter's reply
 */

export const LINK_DAYS_DEFAULT = 45;
export const LINK_DAYS_MIN = 7;
export const LINK_DAYS_MAX = 90;
export const REPLY_ICONS = ["like", "smile", "heart"] as const;
export type ReplyIcon = (typeof REPLY_ICONS)[number];
export const ICON_CHARS: Record<ReplyIcon, string> = { like: "\u{1F44D}", smile: "\u{1F60A}", heart: "❤️" };

export interface Review {
  id: string;
  jobId: number;
  name: string; // what shows on the site, e.g. "Ana P."
  rating: number; // 1 to 5
  text: string;
  at: string;
  status: "pending" | "shown" | "hidden";
  reply?: { text: string; icon: ReplyIcon | null; at: string };
}
export type PublicReview = Pick<Review, "id" | "name" | "rating" | "text" | "at" | "reply">;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const getKv = async (env: Env, key: string) => (await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
const setKv = (env: Env, key: string, value: string) =>
  env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, value).run();
const parse = (v: string | null) => {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, n) : "");

export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const linkDays = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= LINK_DAYS_MIN && n <= LINK_DAYS_MAX ? n : LINK_DAYS_DEFAULT;
};
/** "Ana Perez" -> "Ana P." so a full name is never published. */
export const shortName = (full: string) => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Customer";
  return parts.length === 1 ? parts[0].slice(0, 30) : `${parts[0].slice(0, 30)} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

/** Checks a submitted review. Returns the error to show, or the clean values. */
export function cleanSubmission(b: any): { ok: true; rating: number; text: string; name: string } | { ok: false; error: string } {
  const rating = Math.round(Number(b?.rating));
  if (!(rating >= 1 && rating <= 5)) return { ok: false, error: "Choose 1 to 5 stars." };
  const text = str(b?.text, 2000);
  if (text.length < 10) return { ok: false, error: "Write a few words about the job." };
  if (!b?.consent) return { ok: false, error: "Tick the box to let us show your review." };
  return { ok: true, rating, text, name: shortName(str(b?.name, 80)) };
}

export function readReview(raw: unknown): Review | null {
  const j = typeof raw === "string" ? parse(raw) : raw;
  if (!j || typeof j.id !== "string") return null;
  const icon = REPLY_ICONS.includes(j.reply?.icon) ? (j.reply.icon as ReplyIcon) : null;
  return {
    id: j.id, jobId: Number(j.jobId) || 0, name: str(j.name, 40) || "Customer", rating: Math.min(5, Math.max(1, Math.round(Number(j.rating)) || 5)), text: str(j.text, 2000),
    at: str(j.at, 30), status: ["pending", "shown", "hidden"].includes(j.status) ? j.status : "pending",
    ...(j.reply && (str(j.reply.text, 600) || icon) ? { reply: { text: str(j.reply.text, 600), icon, at: str(j.reply.at, 30) } } : {}),
  };
}

/** Reviews the painter chose to show, newest first. */
export async function shownReviews(env: Env, companyId: number, limit = 30): Promise<PublicReview[]> {
  const rows = (await env.DB.prepare("SELECT value FROM app_settings WHERE key LIKE ? ORDER BY key DESC LIMIT 400").bind(`review:${companyId}:%`).all<{ value: string }>().catch(() => ({ results: [] as any[] }))).results ?? [];
  return rows.map((r) => readReview(r.value)).filter((r): r is Review => !!r && r.status === "shown").sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
    .map(({ id, name, rating, text, at, reply }) => ({ id, name, rating, text, at, ...(reply ? { reply } : {}) }));
}

const L = {
  en: { stars: "out of 5 stars", reply: "Reply from", none: "No reviews yet.", title: "Review", h: "How did we do?", sub: "Your review goes on our website after we read it. Only customers with a private link can write one.",
    rating: "Your rating", text: "Your review", name: "Your name (we show your first name and last initial)", consent: "You may show my review, first name and last initial on your website.", send: "Send my review",
    thanks: "Thank you. Your review was sent.", expired: "This review link has expired or was already used. Ask the painter for a new one.", job: "Job" },
  es: { stars: "de 5 estrellas", reply: "Respuesta de", none: "Todavía no hay reseñas.", title: "Reseña", h: "¿Cómo lo hicimos?", sub: "Su reseña aparece en nuestro sitio después de que la leamos. Solo los clientes con un enlace privado pueden escribir una.",
    rating: "Su calificación", text: "Su reseña", name: "Su nombre (mostramos su nombre y la inicial del apellido)", consent: "Pueden mostrar mi reseña, mi nombre y la inicial de mi apellido en su sitio web.", send: "Enviar mi reseña",
    thanks: "Gracias. Su reseña fue enviada.", expired: "Este enlace venció o ya se usó. Pida uno nuevo al pintor.", job: "Trabajo" },
};

const starsHtml = (n: number) => `<span class="stars" aria-hidden="true">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;

/** The reviews section on a site page. No star markup for search engines: Google does not show self-hosted reviews of a business in its results. */
export function reviewsHtml(list: PublicReview[], company: string, lang: "en" | "es", heading: string): string {
  const t = L[lang];
  const h = heading ? `<h2>${e(heading)}</h2>` : "";
  if (!list.length) return "";
  return `<section class="blk revs">${h}${list.map((r) => `<article class="rev"><div>${starsHtml(r.rating)} <span class="sr">${r.rating} ${e(t.stars)}</span></div><p>${e(r.text).replace(/\n/g, "<br>")}</p><p class="muted">${e(r.name)} &middot; ${e(r.at.slice(0, 10))}</p>${r.reply ? `<div class="rr">${r.reply.icon ? `<span class="ic" aria-label="${e(r.reply.icon)}">${ICON_CHARS[r.reply.icon]}</span> ` : ""}${r.reply.text ? `<b>${e(t.reply)} ${e(company)}:</b> ${e(r.reply.text)}` : ""}</div>` : ""}</article>`).join("")}</section>`;
}

async function linkByToken(env: Env, token: string) {
  if (!/^[A-Za-z0-9_-]{20,60}$/.test(token)) return null;
  const key = `revlink:${await sha256Hex(token)}`;
  const j = parse(await getKv(env, key));
  return j ? { key, link: j as { companyId: number; jobId: number; customer: string; expiresOn: string; usedAt?: string; lang?: "en" | "es" } } : null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** GET /review/<token>: the customer's review form. POST /api/review/submit {token, rating, text, name, consent}. */
export async function handleReviewPage(env: Env, pathname: string, lang: "en" | "es"): Promise<Response> {
  const token = pathname.slice("/review/".length);
  const f = await linkByToken(env, token);
  const co = f ? await env.DB.prepare("SELECT name, settings FROM companies WHERE id = ?").bind(f.link.companyId).first<{ name: string; settings: string }>() : null;
  const l = f?.link.lang ?? lang;
  const t = L[l];
  const ok = !!(f && co && !f.link.usedAt && f.link.expiresOn >= today());
  const color = readSettings(co?.settings).brandColor ?? "#E8A33D";
  const body = ok
    ? `<h1>${e(t.h)}</h1><p class="muted">${e(co!.name)} &middot; ${e(t.sub)}</p>
<form id="rf"><fieldset style="border:0;padding:0;margin:0"><legend><b>${e(t.rating)}</b></legend><div class="st">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="s${n}" name="rating" value="${n}" required><label for="s${n}" title="${n}">★</label>`).join("")}</div></fieldset>
<label for="tx">${e(t.text)}</label><textarea id="tx" name="text" rows="5" maxlength="2000" required></textarea>
<label for="nm">${e(t.name)}</label><input id="nm" name="name" maxlength="80" value="${e(f!.link.customer)}">
<label style="font-weight:400"><input type="checkbox" name="consent" required style="width:auto"> ${e(t.consent)}</label>
<p><button>${e(t.send)}</button></p><div id="msg" role="status"></div></form>
<script>document.getElementById('rf').onsubmit=async function(ev){ev.preventDefault();var b=Object.fromEntries(new FormData(this).entries());b.token=${JSON.stringify(token)};b.consent=!!b.consent;var m=document.getElementById('msg'),btn=this.querySelector('button');btn.disabled=true;
try{var r=await fetch('/api/review/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});var j=await r.json();if(!r.ok)throw new Error(j.error||'Error');this.innerHTML='<p><b>'+${JSON.stringify(t.thanks)}+'</b></p>';}catch(err){m.textContent=err.message;btn.disabled=false;}}</script>`
    : `<h1>${e(t.title)}</h1><p>${e(t.expired)}</p>`;
  const html = `<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${e(t.title)}${co ? ` | ${e(co.name)}` : ""}</title>
<style>*{box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#F7F5F1;color:#0F1B2D;margin:0}main{max-width:560px;margin:0 auto;padding:24px 16px}h1{font-family:Newsreader,Georgia,serif;font-weight:500}
.muted{color:#4A5568}label{display:block;font-weight:600;margin:14px 0 4px}textarea,input{width:100%;padding:11px;border:1px solid #cfd5dc;border-radius:8px;font:inherit}button{background:${e(color)};border:0;border-radius:8px;padding:12px 20px;font:inherit;font-weight:700;cursor:pointer}
.st{display:inline-flex;flex-direction:row-reverse;gap:4px}.st input{position:absolute;opacity:0;width:1px}.st label{font-size:36px;color:#cfd5dc;cursor:pointer;margin:0}.st input:checked~label,.st label:hover,.st label:hover~label{color:${e(color)}}.st input:focus-visible+label{outline:2px solid #0F1B2D}</style></head>
<body><main>${body}</main></body></html>`;
  return new Response(html, { status: ok ? 200 : 410, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

export async function handleReviewSubmit(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const f = await linkByToken(env, String(b?.token ?? ""));
  if (!f || f.link.usedAt || f.link.expiresOn < today()) return json({ error: "This review link has expired or was already used." }, 410);
  const c = cleanSubmission(b);
  if (!c.ok) return json({ error: c.error }, 400);
  const id = `${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}${crypto.randomUUID().slice(0, 4)}`;
  const review: Review = { id, jobId: f.link.jobId, name: c.name, rating: c.rating, text: c.text, at: new Date().toISOString(), status: "pending" };
  // Mark the link used first, so a double tap cannot post two reviews.
  const used = await env.DB.prepare("UPDATE app_settings SET value = json_set(value, '$.usedAt', ?), updated_at = datetime('now') WHERE key = ? AND json_extract(value, '$.usedAt') IS NULL").bind(review.at, f.key).run();
  if (!used.meta.changes) return json({ error: "This review link was already used." }, 410);
  await setKv(env, `review:${f.link.companyId}:${id}`, JSON.stringify(review));
  return json({ ok: true });
}

/** Jobs a review link may be made for: only jobs with a paid invoice. */
async function paidJobs(env: Env, companyId: number) {
  return (await env.DB.prepare(
    `SELECT j.id, j.title, c.name AS customer, c.email FROM jobs j JOIN customers c ON c.id = j.customer_id
      WHERE j.company_id = ? AND EXISTS (SELECT 1 FROM documents d WHERE d.job_id = j.id AND d.kind = 'invoice' AND d.status = 'paid')
      ORDER BY j.updated_at DESC LIMIT 100`,
  ).bind(companyId).all<{ id: number; title: string; customer: string; email: string | null }>().catch(() => ({ results: [] as any[] }))).results ?? [];
}

/**
 * GET  /api/reviews[?as=]  paid jobs, open links and every review.
 * POST {action: "link", jobId, days} -> a new private link (shown once)
 *      {action: "status", id, status: "shown" | "hidden"}
 *      {action: "reply", id, text, icon: "like" | "smile" | "heart" | null}
 */
export async function handleReviewsApi(request: Request, env: Env, companyId: number, body?: any): Promise<Response> {
  if (request.method === "GET") {
    const rows = (await env.DB.prepare("SELECT value FROM app_settings WHERE key LIKE ? ORDER BY key DESC LIMIT 400").bind(`review:${companyId}:%`).all<{ value: string }>()).results ?? [];
    const links = ((await env.DB.prepare("SELECT value FROM app_settings WHERE key LIKE 'revlink:%' AND json_extract(value, '$.companyId') = ? ORDER BY updated_at DESC LIMIT 100").bind(companyId).all<{ value: string }>()).results ?? [])
      .map((r) => parse(r.value)).filter(Boolean).map((l: any) => ({ jobId: l.jobId, customer: l.customer, expiresOn: l.expiresOn, usedAt: l.usedAt ?? null, createdAt: l.createdAt ?? null, expired: l.expiresOn < today() }));
    return json({ jobs: await paidJobs(env, companyId), links, reviews: rows.map((r) => readReview(r.value)).filter(Boolean), defaultDays: LINK_DAYS_DEFAULT });
  }
  let b: any = body;
  if (b === undefined) {
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
  }
  if (b?.action === "link") {
    const job = (await paidJobs(env, companyId)).find((j) => j.id === Number(b.jobId));
    if (!job) return json({ error: "Review links are for customers who paid. Mark the invoice paid first." }, 400);
    const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const days = linkDays(b.days);
    const link = { companyId, jobId: job.id, customer: job.customer, expiresOn: addDays(today(), days), createdAt: new Date().toISOString(), lang: b.lang === "es" ? "es" : "en" };
    await setKv(env, `revlink:${await sha256Hex(token)}`, JSON.stringify(link));
    return json({ ok: true, url: `https://paintersmax.app/review/${token}`, expiresOn: link.expiresOn, customer: job.customer, email: job.email });
  }
  const id = typeof b?.id === "string" && /^[0-9a-f]{10,24}$/.test(b.id) ? b.id : "";
  const key = `review:${companyId}:${id}`;
  const r = id ? readReview(await getKv(env, key)) : null;
  if (!r) return json({ error: "Review not found." }, 404);
  if (b?.action === "status") {
    if (b.status !== "shown" && b.status !== "hidden") return json({ error: "Choose show or hide." }, 400);
    r.status = b.status;
  } else if (b?.action === "reply") {
    const text = str(b.text, 600);
    const icon = REPLY_ICONS.includes(b.icon) ? (b.icon as ReplyIcon) : null;
    if (!text && !icon) delete r.reply;
    else r.reply = { text, icon, at: new Date().toISOString() };
  } else return json({ error: "Unknown action." }, 400);
  await setKv(env, key, JSON.stringify(r));
  return json({ ok: true, review: r });
}
