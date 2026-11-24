import { getSessionUser } from "./auth.ts";
import { addJobEvent } from "./crm.ts";
import { sendCustomerEmail } from "./email.ts";
import { cleanColors } from "./fieldnotes.ts";
import { handleJobReport } from "./jobreport.ts";
import { htmlToImage, htmlToPdf } from "./pdf.ts";
import { readSettings } from "./settings.ts";
import type { Env } from "./types.ts";

/**
 * The job summary: one finished job written up twice.
 *  - Customer copy: company, job, dates, paint brands and colors, the paint maker's warranty next to the painter's own,
 *    and care notes. No money. The painter reviews, edits and approves it before it can be sent.
 *  - Private copy (painter only): price, collected, expenses, crew pay, profit, margin, hours. Saved as a snapshot when the
 *    customer copy is approved, so the books keep the numbers as they were that day.
 *
 *  GET  /api/jobsummary?id=                      -> { summary, draft, view }
 *  POST /api/jobsummary {id, action: save|approve|reopen|send, fields}
 *  GET  /jobsummary?id=&part=customer|private&format=html|pdf|doc|png|jpg|webp
 *
 * Stored in app_settings (jobsum:<company>:<job>), so no migration. Never invents a paint maker's warranty terms:
 * the painter pastes or confirms them, with a link to the maker's own page.
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const txt = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const parse = (s: unknown): any => {
  try {
    return typeof s === "string" && s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const key = (c: number, j: number) => `jobsum:${c}:${j}`;

export const FORMATS = ["html", "pdf", "doc", "png", "jpg", "webp"] as const;
export type Format = (typeof FORMATS)[number];

/** General care advice that is true for ordinary interior and exterior latex paint. Brand-specific advice comes from the painter. */
export const DEFAULT_CARE = "Give new paint 2 to 4 weeks to fully cure before washing. Then clean with a soft sponge, mild soap and water, and test a hidden spot first. Keep the leftover paint, sealed and labeled, for touch-ups.";

export interface Summary {
  products: string;
  makerWarranty: string;
  makerLink: string;
  painterWarranty: string;
  care: string;
  note: string;
  status: "draft" | "approved" | "sent";
  approvedAt?: string;
  sentAt?: string;
  sentTo?: string;
  books?: Books;
}
export interface Books {
  priceCents: number;
  changeCents: number;
  totalCents: number;
  collectedCents: number;
  balanceCents: number;
  materialsCents: number;
  otherExpenseCents: number;
  payCents: number;
  profitCents: number | null;
  marginPct: number | null;
  hours: number;
  categories: { category: string; cents: number }[];
  savedOn: string;
}

export function cleanSummary(i: any, prev?: Partial<Summary>): Summary {
  const link = txt(i?.makerLink, 300);
  return {
    products: txt(i?.products, 1500),
    makerWarranty: txt(i?.makerWarranty, 2000),
    makerLink: /^https:\/\/[^\s"'<>]+$/.test(link) ? link : "",
    painterWarranty: txt(i?.painterWarranty, 2000),
    care: txt(i?.care, 1200),
    note: txt(i?.note, 1000),
    status: prev?.status === "approved" || prev?.status === "sent" ? prev.status : "draft",
    approvedAt: prev?.approvedAt,
    sentAt: prev?.sentAt,
    sentTo: prev?.sentTo,
    books: prev?.books,
  };
}

export interface View {
  company: { name: string; phone: string; email: string; license: string; website: string; logoUrl: string; color: string };
  customer: { name: string; email: string };
  job: { id: number; title: string; trade: string; address: string; start: string; end: string; daysOnSite: number | null };
  colors: { where: string; brand: string; code: string; name: string; hex: string }[];
  photos: number;
  cert: { months: number; startOn: string; endOn: string; terms: string } | null;
}

const daysOn = (a: string, b: string) => (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1) : null);

async function loadView(env: Env, c: number, id: number): Promise<View | null> {
  const r = await env.DB.prepare(
    `SELECT j.id, j.title, j.trade, json_extract(j.data,'$.schedule.start') AS startOn, json_extract(j.data,'$.schedule.end') AS endOn, json_extract(j.data,'$.colors') AS colors,
            cu.name AS customer, cu.email AS customerEmail, pr.address, pr.city, pr.state, pr.zip, co.name AS company, co.notify_email AS coEmail, co.settings, cp.data AS pdata
       FROM jobs j JOIN customers cu ON cu.id = j.customer_id JOIN companies co ON co.id = j.company_id
       LEFT JOIN properties pr ON pr.id = j.property_id LEFT JOIN company_profiles cp ON cp.company_id = co.id
      WHERE j.id = ? AND j.company_id = ?`,
  ).bind(id, c).first<any>();
  if (!r) return null;
  const s = readSettings(r.settings) as any;
  const prof = parse(r.pdata) ?? {};
  const pc = prof.company ?? {};
  const [photos, cert] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM job_files WHERE company_id = ? AND job_id = ? AND kind = 'photo'").bind(c, id).first<{ n: number }>().catch(() => ({ n: 0 })),
    env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`cert:${c}:${id}`).first<{ value: string }>(),
  ]);
  const cv = parse(cert?.value);
  const start = txt(r.startOn, 10), end = txt(r.endOn, 10);
  return {
    company: { name: r.company, phone: txt(pc.phone, 40), email: txt(pc.email, 120) || txt(r.coEmail, 120), license: txt(pc.license, 60), website: txt(pc.website, 200), logoUrl: txt(s.logoUrl, 500), color: /^#[0-9a-fA-F]{6}$/.test(s.brandColor ?? "") ? s.brandColor : "#0F1B2D" },
    customer: { name: r.customer ?? "", email: r.customerEmail ?? "" },
    job: { id: r.id, title: r.title, trade: r.trade, address: [r.address, r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), start, end, daysOnSite: daysOn(start, end) },
    colors: cleanColors(parse(r.colors)),
    photos: Number(photos?.n) || 0,
    cert: cv && cv.months ? { months: Number(cv.months), startOn: txt(cv.startOn, 10), endOn: txt(cv.endOn, 10), terms: txt(cv.terms, 1500) } : null,
  };
}

/** A first draft from what the job already knows. The painter edits it before approving. */
export function draftSummary(v: View, profileWarranty?: { laborMonths?: number; text?: string }): Summary {
  const brands = [...new Set(v.colors.map((c) => c.brand).filter(Boolean))];
  const months = v.cert?.months || profileWarranty?.laborMonths || 0;
  const pw = [months ? `${months} months on labor${v.cert?.endOn ? `, until ${v.cert.endOn}` : ""}.` : "", v.cert?.terms || profileWarranty?.text || ""].filter(Boolean).join(" ");
  return {
    products: brands.length ? brands.map((b) => `${b}: product line and sheen`).join("\n") : "",
    makerWarranty: "",
    makerLink: "",
    painterWarranty: pw,
    care: DEFAULT_CARE,
    note: "",
    status: "draft",
  };
}

const fmt = (d: string) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "");
const money = (c: number) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const para = (s: string) => esc(s).replace(/\n/g, "<br>");

/** The customer copy. No prices, no costs. */
export function customerHtml(v: View, s: Summary, opts: { toolbar?: boolean } = {}): string {
  const col = v.company.color;
  const colors = v.colors.length
    ? `<table class="cl"><thead><tr><th></th><th>Where</th><th>Brand</th><th>Color</th><th>Code</th></tr></thead><tbody>${v.colors.map((c) => `<tr><td><span class="sw" style="background:${c.hex || "#eee"}"></span></td><td>${esc(c.where)}</td><td>${esc(c.brand)}</td><td>${esc(c.name)}</td><td>${esc(c.code)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="mut">No colors were recorded for this job.</p>`;
  const bar = opts.toolbar ? `<div class="noprint"><button onclick="window.print()">Print or save as PDF</button></div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Job summary - ${esc(v.job.title)}</title><style>
*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#1a2433;margin:0;background:#fff;font-size:14px;line-height:1.45}
.pg{max-width:780px;margin:0 auto;padding:28px 24px}.hd{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:4px solid ${col};padding-bottom:14px}
.hd img{max-height:60px;max-width:180px}.co b{font-size:18px;display:block}.mut{color:#5b6572}h1{font-family:Georgia,serif;font-weight:500;font-size:26px;margin:18px 0 4px}
h2{font-size:15px;margin:20px 0 6px;color:${col};text-transform:uppercase;letter-spacing:.04em}.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}
.cl{width:100%;border-collapse:collapse}.cl th,.cl td{border-bottom:1px solid #e6e3dc;padding:6px 4px;text-align:left}.sw{display:inline-block;width:22px;height:22px;border-radius:4px;border:1px solid #ccc}
.box{border:1px solid #e6e3dc;border-radius:8px;padding:10px 12px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ft{margin-top:24px;border-top:1px solid #e6e3dc;padding-top:10px;font-size:12px}.noprint{text-align:right;padding:10px}.noprint button{font:inherit;padding:8px 14px;border-radius:8px;border:0;background:#E8A33D;font-weight:700}
@media(max-width:600px){.grid,.two{grid-template-columns:1fr}.hd{flex-direction:column}}@media print{.noprint{display:none}}
</style></head><body>${bar}<div class="pg">
<div class="hd"><div class="co"><b>${esc(v.company.name)}</b><span class="mut">${[v.company.phone, v.company.email, v.company.website].filter(Boolean).map(esc).join(" &middot; ")}${v.company.license ? `<br>License ${esc(v.company.license)}` : ""}</span></div>${v.company.logoUrl ? `<img src="${esc(v.company.logoUrl)}" alt="">` : ""}</div>
<h1>Your painting job summary</h1><p class="mut">Prepared for ${esc(v.customer.name)}${s.approvedAt ? ` on ${fmt(s.approvedAt)}` : ""}</p>
<h2>The job</h2><div class="grid"><div><b>Work</b><br>${esc(v.job.title)}</div><div><b>Property</b><br>${esc(v.job.address) || "-"}</div>
<div><b>Started</b><br>${fmt(v.job.start) || "-"}</div><div><b>Finished</b><br>${fmt(v.job.end) || "-"}${v.job.daysOnSite ? ` (${v.job.daysOnSite} day${v.job.daysOnSite === 1 ? "" : "s"} on site)` : ""}</div></div>
<h2>Paint and colors</h2>${colors}${s.products ? `<p><b>Products used</b><br>${para(s.products)}</p>` : ""}
<h2>Warranties</h2><div class="two"><div class="box"><b>Our warranty</b><br>${s.painterWarranty ? para(s.painterWarranty) : "<span class=mut>Not stated.</span>"}</div>
<div class="box"><b>Paint maker's warranty</b><br>${s.makerWarranty ? para(s.makerWarranty) : "<span class=mut>See the paint maker's own warranty for the products used.</span>"}${s.makerLink ? `<br><a href="${esc(s.makerLink)}">${esc(s.makerLink)}</a>` : ""}</div></div>
${s.care ? `<h2>Caring for your paint</h2><p>${para(s.care)}</p>` : ""}${s.note ? `<h2>A note from us</h2><p>${para(s.note)}</p>` : ""}
<div class="ft mut">Keep this page with your home records. The paint maker's warranty is set by the maker; read their terms at the link above. Questions? Contact ${esc(v.company.name)}${v.company.phone ? ` at ${esc(v.company.phone)}` : ""}.</div>
</div></body></html>`;
}

/** The painter's private copy for the books. Never sent to the customer. */
export function privateHtml(v: View, b: Books, opts: { toolbar?: boolean } = {}): string {
  const row = (l: string, c: number | null, strong = false) => `<tr><td>${strong ? "<b>" : ""}${esc(l)}${strong ? "</b>" : ""}</td><td class="r">${c === null ? "-" : `${strong ? "<b>" : ""}${money(c)}${strong ? "</b>" : ""}`}</td></tr>`;
  const bar = opts.toolbar ? `<div class="noprint"><button onclick="window.print()">Print or save as PDF</button></div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Job record (private) - ${esc(v.job.title)}</title><style>
*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#1a2433;margin:0;background:#fff;font-size:14px}.pg{max-width:720px;margin:0 auto;padding:28px 24px}
h1{font-family:Georgia,serif;font-weight:500;font-size:24px;margin:0 0 4px}.mut{color:#5b6572}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{padding:6px 4px;border-bottom:1px solid #e6e3dc;text-align:left}.r{text-align:right;font-variant-numeric:tabular-nums}
.tag{display:inline-block;background:#fdecea;color:#b42318;border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700}.noprint{text-align:right;padding:10px}.noprint button{font:inherit;padding:8px 14px;border-radius:8px;border:0;background:#E8A33D;font-weight:700}@media print{.noprint{display:none}}
</style></head><body>${bar}<div class="pg"><span class="tag">PRIVATE - for your books, not for the customer</span>
<h1>Job record: ${esc(v.job.title)}</h1><p class="mut">${esc(v.company.name)} &middot; Customer ${esc(v.customer.name)} &middot; Job #${v.job.id} &middot; ${esc(v.job.start || "-")} to ${esc(v.job.end || "-")} &middot; Numbers saved ${esc(b.savedOn)}</p>
<table>${row("Agreed price", b.priceCents)}${b.changeCents ? row("Change orders", b.changeCents) : ""}${row("Total", b.totalCents, true)}${row("Collected", b.collectedCents)}${row("Balance due", b.balanceCents)}</table>
<table><thead><tr><th>Costs</th><th class="r">Amount</th></tr></thead>${b.categories.map((x) => row(x.category, x.cents)).join("")}${row("Crew pay", b.payCents)}${row("Total costs", b.materialsCents + b.otherExpenseCents + b.payCents, true)}</table>
<table>${row("Profit", b.profitCents, true)}<tr><td>Margin</td><td class="r">${b.marginPct === null ? "-" : b.marginPct + "%"}</td></tr><tr><td>Crew hours</td><td class="r">${b.hours}</td></tr><tr><td>Price per labor hour</td><td class="r">${b.hours > 0 ? money(Math.round(b.totalCents / b.hours)) : "-"}</td></tr></table>
<p class="mut" style="font-size:12px">Plain math from the records saved in PaintersMax. For your accountant; not tax advice.</p></div></body></html>`;
}

/** The report numbers, through the same code the Job results card uses. */
async function books(env: Env, request: Request, id: number): Promise<Books | null> {
  const u = new URL(request.url);
  const r = await handleJobReport(new Request(`${u.origin}/api/jobreport?id=${id}`, { headers: request.headers }), env);
  if (!r.ok) return null;
  const j = (await r.json()) as any;
  const m = j.money;
  return {
    priceCents: m.priceCents, changeCents: m.changeCents, totalCents: m.totalCents, collectedCents: m.collectedCents, balanceCents: m.balanceCents,
    materialsCents: m.materialsCents, otherExpenseCents: m.otherExpenseCents, payCents: m.payCents, profitCents: m.profitCents, marginPct: m.marginPct,
    hours: Math.round((j.hours.actualMinutes / 60) * 10) / 10, categories: m.categories ?? [], savedOn: new Date().toISOString().slice(0, 10),
  };
}

async function readSum(env: Env, c: number, id: number): Promise<Summary | null> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key(c, id)).first<{ value: string }>();
  return parse(r?.value);
}
async function writeSum(env: Env, c: number, id: number, s: Summary) {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key(c, id), JSON.stringify(s)).run();
}
async function profileWarranty(env: Env, c: number) {
  const r = await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(c).first<{ data: string }>().catch(() => null);
  return parse(r?.data)?.warranty ?? {};
}

export async function handleJobSummaryApi(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  if (request.method === "GET") {
    const id = Number(new URL(request.url).searchParams.get("id"));
    const v = Number.isInteger(id) ? await loadView(env, c, id) : null;
    if (!v) return json({ error: "Not found." }, 404);
    const saved = await readSum(env, c, id);
    return json({ summary: saved ?? draftSummary(v, await profileWarranty(env, c)), saved: !!saved, view: v });
  }
  let b: any;
  try { b = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
  const id = Number(b?.id);
  const v = Number.isInteger(id) ? await loadView(env, c, id) : null;
  if (!v) return json({ error: "Not found." }, 404);
  const prev = (await readSum(env, c, id)) ?? undefined;
  if (b?.action === "save") {
    if (prev?.status === "sent") return json({ error: "This summary was already sent. Tap Reopen to change it." }, 400);
    const s = cleanSummary(b.fields, prev ? { ...prev, status: "draft" } : undefined);
    s.status = "draft";
    s.approvedAt = undefined;
    await writeSum(env, c, id, s);
    return json({ ok: true, summary: s });
  }
  if (b?.action === "approve") {
    const s = cleanSummary(b.fields ?? prev, prev);
    s.status = "approved";
    s.approvedAt = new Date().toISOString().slice(0, 10);
    s.books = (await books(env, request, id)) ?? prev?.books;
    await writeSum(env, c, id, s);
    await addJobEvent(env, c, id, "summary", "Job summary approved. Private job record saved for the books.");
    return json({ ok: true, summary: s });
  }
  if (b?.action === "reopen") {
    if (!prev) return json({ error: "Nothing to reopen." }, 400);
    const s = { ...prev, status: "draft" as const, approvedAt: undefined };
    await writeSum(env, c, id, s);
    return json({ ok: true, summary: s });
  }
  if (b?.action === "send") {
    if (!prev || (prev.status !== "approved" && prev.status !== "sent")) return json({ error: "Approve the summary first." }, 400);
    const to = txt(b?.to, 200) || v.customer.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: "Add the customer's email first." }, 400);
    const html = customerHtml(v, prev);
    const pdf = await htmlToPdf(env, html);
    const att = pdf ? { filename: "job-summary.pdf", content: b64(pdf) } : { filename: "job-summary.html", content: b64(new TextEncoder().encode(html)) };
    const r = await sendCustomerEmail(env, to, v.company.name, v.company.email || null, `Your painting job summary from ${v.company.name}`, `Hi ${v.customer.name.split(" ")[0] || "there"},\n\nThank you for choosing ${v.company.name}. Attached is a summary of your painting job: the colors and products we used, your warranties, and how to care for your new paint. Keep it with your home records.\n\n${v.company.name}${v.company.phone ? `\n${v.company.phone}` : ""}`, [att]);
    if (r !== "sent") return json({ error: "The email could not be sent right now. Download the PDF and send it yourself, or try again." }, 503);
    const s: Summary = { ...prev, status: "sent", sentAt: new Date().toISOString().slice(0, 10), sentTo: to };
    await writeSum(env, c, id, s);
    await addJobEvent(env, c, id, "summary", `Job summary emailed to ${to}.`);
    return json({ ok: true, summary: s });
  }
  return json({ error: "Unknown action." }, 400);
}

function b64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const MIME: Record<Format, string> = { html: "text/html; charset=utf-8", pdf: "application/pdf", doc: "application/msword", png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** A Word file: Word opens HTML saved with a .doc name and the Word content type. */
export function asWordDoc(html: string): string {
  return html.replace("<html lang=\"en\">", '<html lang="en" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">').replace(/<div class="noprint">[\s\S]*?<\/div>/, "");
}

/** GET /jobsummary?id=&part=customer|private&format=... (signed-in painter only). */
export async function handleJobSummaryFile(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return new Response("Please sign in.", { status: 401 });
  const u = new URL(request.url);
  const id = Number(u.searchParams.get("id"));
  const part = u.searchParams.get("part") === "private" ? "private" : "customer";
  const f = (FORMATS as readonly string[]).includes(u.searchParams.get("format") ?? "") ? (u.searchParams.get("format") as Format) : "html";
  const v = Number.isInteger(id) ? await loadView(env, user.companyId, id) : null;
  if (!v) return new Response("Not found.", { status: 404 });
  const s = (await readSum(env, user.companyId, id)) ?? draftSummary(v, await profileWarranty(env, user.companyId));
  let html: string;
  if (part === "private") {
    const bk = s.books ?? (await books(env, request, id));
    if (!bk) return new Response("Not found.", { status: 404 });
    html = privateHtml(v, bk, { toolbar: f === "html" });
  } else html = customerHtml(v, s, { toolbar: f === "html" });
  const base = `${part === "private" ? "job-record" : "job-summary"}-${id}`;
  const headers = (type: string, ext: string) => ({ "content-type": type, "cache-control": "no-store", ...(ext === "html" ? {} : { "content-disposition": `attachment; filename="${base}.${ext}"` }) });
  if (f === "html") return new Response(html, { headers: headers(MIME.html, "html") });
  if (f === "doc") return new Response(asWordDoc(html), { headers: headers(MIME.doc, "doc") });
  const bytes = f === "pdf" ? await htmlToPdf(env, html) : await htmlToImage(env, html, f === "jpg" ? "jpeg" : f);
  if (!bytes) return new Response("Could not make that file right now. Open the page and use Print, or try again in a minute.", { status: 503 });
  return new Response(bytes, { headers: headers(MIME[f], f) });
}
