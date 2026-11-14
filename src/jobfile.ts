import { getSessionUser } from "./auth.ts";
import { cleanCert, renderCertificate, type Cert } from "./warranty.ts";
import { cleanWo, renderWorkOrder, woLabel, woTotalCents } from "./workorders.ts";
import { markDownload } from "./files.ts";
import { handleCrew, hoursOf } from "./crew.ts";
import { handleRecords, toCsv } from "./records.ts";
import { readSettings } from "./settings.ts";
import { safeZipName, zipStream, type ZipSource } from "./zip.ts";
import type { Env } from "./types.ts";

/**
 * The Job File download (a ZIP organized by section) and the year-end package, plus "download, then free up storage".
 * Records for your accountant, not tax advice. The ZIP is for the owner only: it holds customer contact details and costs.
 */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parse = (s: string | null | undefined): any => {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};
const enc = new TextEncoder();
const text = (name: string, body: string): ZipSource => ({ name, read: async () => enc.encode(body) });
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;

const table = (head: string[], rows: unknown[][]) => (rows.length ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : '<p class="muted">None.</p>');

export function summaryHtml(d: {
  company: string;
  title: string;
  customer: string;
  contact: string;
  address: string;
  stage: string;
  lost: string;
  generatedOn: string;
  docs: { kind: string; status: string; title: string }[];
  workOrders: { label: string; title: string; status: string; totalCents: number }[];
  files: { folder: string; name: string; by: string; at: string; removed: boolean; note: string }[];
  findings: string[];
  hours: { date: string; worker: string; hours: number; note: string }[];
  expenses: { date: string; vendor: string; category: string; amountCents: number }[];
  trips: { date: string; miles: number }[];
  warranty: string;
  lessons: { title: string; body: string }[];
  chat: { role: string; content: string }[];
  events: { at: string; text: string }[];
}): string {
  const expTotal = d.expenses.reduce((s, e) => s + e.amountCents, 0);
  const approved = d.workOrders.filter((w) => w.status === "approved" && w.label.startsWith("CO")).reduce((s, w) => s + w.totalCents, 0);
  const sec = (t: string, body: string) => `<h2>${esc(t)}</h2>${body}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.title)} - job file</title>
<style>body{font-family:Inter,system-ui,sans-serif;color:#0F1B2D;max-width:860px;margin:0 auto;padding:20px;line-height:1.45}h1{font-family:Georgia,serif;font-weight:500;margin:0}h2{border-bottom:2px solid #E8A33D;padding-bottom:4px;margin-top:28px}table{width:100%;border-collapse:collapse;margin:6px 0}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #eee;font-size:14px;vertical-align:top}.muted{color:#4A5568;font-size:14px}pre{white-space:pre-wrap;font-family:inherit}@media print{h2{break-after:avoid}}</style></head><body>
<h1>${esc(d.title)}</h1><p class="muted">${esc(d.company)} &middot; Job file prepared ${esc(d.generatedOn)} &middot; Records for your accountant, not tax advice.</p>
${sec("Summary", `<table><tbody><tr><td>Customer</td><td>${esc(d.customer)}</td></tr><tr><td>Contact</td><td>${esc(d.contact)}</td></tr><tr><td>Property</td><td>${esc(d.address)}</td></tr><tr><td>Stage</td><td>${esc(d.stage)}${d.lost ? " &middot; " + esc(d.lost) : ""}</td></tr><tr><td>Approved change orders</td><td>${money(approved)}</td></tr><tr><td>Expenses on this job</td><td>${money(expTotal)}</td></tr></tbody></table>`)}
${sec("Documents", table(["Type", "Status", "Title"], d.docs.map((x) => [x.kind, x.status, x.title])) + '<p class="muted">Estimates, contracts and invoices can be opened and printed from the job in PaintersMax.</p>')}
${sec("Work orders and change orders", table(["Number", "Title", "Status", "Total"], d.workOrders.map((w) => [w.label, w.title, w.status, money(w.totalCents)])) + '<p class="muted">Each one is in the work-orders folder.</p>')}
${sec("Photos and files", table(["Folder", "File", "From", "Date", "Note"], d.files.map((f) => [f.folder, f.removed ? `${f.name} (removed from storage)` : f.name, f.by, f.at, f.note])))}
${sec("Approved photo findings (possible issues the painter confirmed)", d.findings.length ? `<ul>${d.findings.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="muted">None.</p>')}
${sec("Crew hours on this job", table(["Date", "Worker", "Hours", "Note"], d.hours.map((h) => [h.date, h.worker, h.hours, h.note])))}
${sec("Expenses", table(["Date", "Vendor", "Category", "Amount"], d.expenses.map((e) => [e.date, e.vendor, e.category, money(e.amountCents)])))}
${sec("Mileage", table(["Date", "Miles"], d.trips.map((t) => [t.date, t.miles])))}
${sec("Warranty", `<p>${esc(d.warranty || "No warranty certificate was made for this job.")}</p>`)}
${sec("Lessons learned", d.lessons.length ? d.lessons.map((l) => `<h3>${esc(l.title)}</h3><pre>${esc(l.body)}</pre>`).join("") : '<p class="muted">None.</p>')}
${sec("Job notes and history", table(["When", "What"], d.events.map((e) => [e.at, e.text])))}
${sec("Assistant chat (private to you)", d.chat.length ? d.chat.map((m) => `<p><b>${m.role === "user" ? "You" : "Assistant"}:</b></p><pre>${esc(m.content)}</pre>`).join("") : '<p class="muted">No chat on this job.</p>')}
</body></html>`;
}

/** Removing stored files is off until the storage rules are decided. */
const FREE_UP_ON = false;

/**
 * GET  /api/jobfile?jobId=              what is stored and whether it fits in a ZIP
 * GET  /api/jobfile?jobId=&download=1   the Job File ZIP
 * GET  /api/jobfile?year=YYYY           the year-end package ZIP
 * POST {action:"freeUp", jobId, confirm:true}   remove this job's photos and files from storage (the record stays)
 */
export async function handleJobFile(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const c = user.companyId;
  const u = new URL(request.url);

  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    if (b?.action !== "freeUp") return json({ error: "Unknown action." }, 400);
    if (!FREE_UP_ON) return json({ error: "Freeing up storage is turned off for now. Your files are safe, and you can download them any time." }, 400);
    if (b.confirm !== true) return json({ error: "Please confirm that you downloaded the job file." }, 400);
    const jobId = Number(b.jobId);
    if (!Number.isInteger(jobId) || !(await env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").bind(jobId, c).first())) return json({ error: "Job not found." }, 404);
    const rows = ((await env.DB.prepare("SELECT id, r2_key AS k, bytes, note FROM job_files WHERE company_id = ? AND job_id = ? AND kind IN ('photo','receipt','document') AND r2_key != ''").bind(c, jobId).all<any>()).results ?? []) as any[];
    let freed = 0;
    const day = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
      await env.FILES?.delete(r.k).catch(() => undefined);
      await env.DB.prepare("UPDATE job_files SET r2_key = '', bytes = 0, note = ? WHERE id = ? AND company_id = ?").bind(`${r.note ? r.note + " " : ""}[removed from storage ${day}]`.slice(0, 300), r.id, c).run();
      freed += r.bytes;
    }
    return json({ ok: true, files: rows.length, freedBytes: freed });
  }
  if (request.method !== "GET") return json({ error: "Not found." }, 404);

  const co = await env.DB.prepare("SELECT name, settings FROM companies WHERE id = ?").bind(c).first<{ name: string; settings: string }>();
  if (!co) return json({ error: "Not found." }, 404);

  // ---------- year-end package ----------
  if (u.searchParams.has("year")) {
    const year = /^\d{4}$/.test(u.searchParams.get("year") ?? "") ? u.searchParams.get("year")! : String(new Date().getUTCFullYear());
    const sub = async (path: string) => {
      const r = path.startsWith("/api/crew") ? await handleCrew(new Request(new URL(path, request.url), { headers: request.headers }), env) : await handleRecords(new Request(new URL(path, request.url), { headers: request.headers }), env);
      return r.ok && !(r.headers.get("content-type") ?? "").includes("application/json") ? new Uint8Array(await r.arrayBuffer()) : null;
    };
    const parts: [string, string][] = [
      [`expenses-${year}.csv`, `/api/records?export=expenses&year=${year}`],
      [`mileage-${year}.csv`, `/api/records?export=mileage&year=${year}`],
      [`invoices-${year}.csv`, `/api/records?export=income&year=${year}`],
      [`quickbooks-online-${year}.csv`, `/api/records?export=qbo&year=${year}`],
      [`quickbooks-desktop-${year}.iif`, `/api/records?export=iif&year=${year}`],
      [`crew-hours-${year}.csv`, `/api/crew?export=hours&year=${year}`],
      [`crew-payments-${year}.csv`, `/api/crew?export=payments&year=${year}`],
      [`1099-list-${year}.csv`, `/api/crew?export=1099&year=${year}`],
      [`crew-time-off-${year}.csv`, `/api/crew?export=attendance&year=${year}`],
    ];
    const files: ZipSource[] = [text("README.txt", `PaintersMax year-end records for ${year}\r\nPrepared ${new Date().toISOString().slice(0, 10)} for ${co.name}.\r\n\r\nRecords for your accountant, not tax advice.\r\n- expenses, mileage, invoices: spreadsheets (CSV)\r\n- quickbooks-online: Banking > Upload transactions\r\n- quickbooks-desktop: File > Utilities > Import > IIF Files (create the expense accounts first)\r\n- crew files are included on Basic and Pro. The 1099 list uses the reporting threshold you set in Records > Settings (confirm with your accountant or IRS.gov).\r\n- We never store Social Security or tax ID numbers. W-9 files are in each contractor's profile.\r\n`)];
    for (const [name, path] of parts) files.push({ name, read: () => sub(path) });
    await markDownload(env, c);
    return new Response(zipStream(files), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="paintersmax-year-end-${year}.zip"`, "cache-control": "no-store" } });
  }

  // ---------- one job ----------
  const jobId = Number(u.searchParams.get("jobId"));
  const job = Number.isInteger(jobId)
    ? await env.DB.prepare("SELECT j.id, j.title, j.stage, j.data, cu.name AS customer, cu.email, cu.phone, pr.address, pr.city, pr.state, pr.zip FROM jobs j JOIN customers cu ON cu.id = j.customer_id LEFT JOIN properties pr ON pr.id = j.property_id WHERE j.id = ? AND j.company_id = ?").bind(jobId, c).first<any>()
    : null;
  if (!job) return json({ error: "Job not found." }, 404);
  const files = ((await env.DB.prepare("SELECT id, kind, name, mime, bytes, r2_key AS k, uploaded_by AS by, created_at AS at, note FROM job_files WHERE company_id = ? AND job_id = ? ORDER BY id").bind(c, jobId).all<any>()).results ?? []) as any[];
  const totalBytes = files.reduce((s, f) => s + (f.k ? f.bytes : 0), 0);
  if (!u.searchParams.get("download")) return json({ files: files.length, stored: files.filter((f) => f.k).length, bytes: totalBytes, tooBig: totalBytes > MAX_ZIP_BYTES });
  if (totalBytes > MAX_ZIP_BYTES) return json({ error: `This job's files are over ${Math.round(MAX_ZIP_BYTES / 1048576)} MB, which is too big for one download. Download the photos one at a time from the job page, or ask us for help.` }, 413);

  const [docs, wos, finds, hours, expenses, trips, lessons, events, chatRow, certRow] = await Promise.all([
    env.DB.prepare("SELECT kind, status, title FROM documents WHERE company_id = ? AND job_id = ? ORDER BY id").bind(c, jobId).all<any>(),
    env.DB.prepare("SELECT number, kind, title, body, status, decided_at, decided_by FROM work_orders WHERE company_id = ? AND job_id = ? ORDER BY id").bind(c, jobId).all<any>(),
    env.DB.prepare("SELECT data FROM job_photo_findings WHERE company_id = ? AND job_id = ? AND status = 'approved' ORDER BY id").bind(c, jobId).all<any>(),
    env.DB.prepare("SELECT t.work_date, t.clock_in, t.clock_out, t.minutes, t.note, w.name FROM time_entries t JOIN workers w ON w.id = t.worker_id WHERE t.company_id = ? AND t.job_id = ? ORDER BY t.work_date").bind(c, jobId).all<any>(),
    env.DB.prepare("SELECT spent_on, vendor, category, amount_cents, note FROM expenses WHERE company_id = ? AND job_id = ? ORDER BY spent_on").bind(c, jobId).all<any>(),
    env.DB.prepare("SELECT trip_on, miles, note FROM mileage_trips WHERE company_id = ? AND job_id = ? ORDER BY trip_on").bind(c, jobId).all<any>(),
    env.DB.prepare("SELECT title, body FROM lessons WHERE company_id = ? AND job_id = ? ORDER BY id").bind(c, jobId).all<any>(),
    env.DB.prepare("SELECT text, created_at FROM job_events WHERE company_id = ? AND job_id = ? ORDER BY id").bind(c, jobId).all<any>(),
    env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`jobchat:${c}:${jobId}`).first<{ value: string }>(),
    env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`cert:${c}:${jobId}`).first<{ value: string }>(),
  ]);
  const s = readSettings(co.settings);
  const cert = parse(certRow?.value) as Cert | null;
  const lost = parse(job.data)?.lost ?? null;
  const folder = (k: string) => (k === "photo" ? "photos" : k === "receipt" ? "receipts" : "documents");
  const findingLines: string[] = [];
  for (const f of finds.results ?? []) for (const i of parse(f.data).issues ?? []) findingLines.push(`${i.title} (${i.severity}): ${i.fix}`);
  const woView = (wos.results ?? []).map((w: any) => ({ ...w, body: cleanWo(parse(w.body)) }));
  const chat = (parse(chatRow?.value) as any[]) || [];

  const out: ZipSource[] = [];
  out.push(text("00-summary.html", summaryHtml({
    company: co.name, title: job.title, customer: job.customer, contact: [job.email, job.phone].filter(Boolean).join(" / "), address: [job.address, job.city, job.state, job.zip].filter(Boolean).join(", "), stage: job.stage,
    lost: lost ? `Lost: ${lost.reason}${lost.note ? " - " + lost.note : ""}` : "", generatedOn: new Date().toISOString().slice(0, 10),
    docs: docs.results ?? [], workOrders: woView.map((w: any) => ({ label: woLabel(w.kind, w.number), title: w.title, status: w.status, totalCents: woTotalCents(w.body.lines) })),
    files: files.map((f) => ({ folder: folder(f.kind), name: f.name, by: f.by, at: String(f.at).slice(0, 10), removed: !f.k, note: f.note ?? "" })), findings: findingLines,
    hours: (hours.results ?? []).map((h: any) => ({ date: h.work_date, worker: h.name, hours: hoursOf(h.minutes), note: h.note ?? "" })),
    expenses: (expenses.results ?? []).map((e: any) => ({ date: e.spent_on, vendor: e.vendor ?? "", category: e.category, amountCents: e.amount_cents })), trips: (trips.results ?? []).map((t: any) => ({ date: t.trip_on, miles: t.miles })),
    warranty: cert && !("error" in (cleanCert(cert, "classic") as any)) ? `${cert.months} months of labor warranty, ${cert.startOn} to ${cert.endOn} (${cert.status}).` : "",
    lessons: lessons.results ?? [], chat, events: (events.results ?? []).map((e: any) => ({ at: e.created_at, text: e.text })),
  })));
  out.push(text("expenses.csv", toCsv([["Date", "Vendor", "Category", "Amount", "Note"], ...(expenses.results ?? []).map((e: any) => [e.spent_on, e.vendor, e.category, (e.amount_cents / 100).toFixed(2), e.note])])));
  out.push(text("crew-hours.csv", toCsv([["Date", "Worker", "Clock in", "Clock out", "Hours", "Note"], ...(hours.results ?? []).map((h: any) => [h.work_date, h.name, h.clock_in, h.clock_out, hoursOf(h.minutes), h.note])])));
  out.push(text("mileage.csv", toCsv([["Date", "Miles", "Note"], ...(trips.results ?? []).map((t: any) => [t.trip_on, t.miles, t.note])])));
  if (chat.length) out.push(text("assistant-chat.txt", chat.map((m: any) => `${m.role === "user" ? "YOU" : "ASSISTANT"}: ${m.content}`).join("\r\n\r\n")));
  for (const w of woView) out.push(text(`work-orders/${woLabel(w.kind, w.number)}-${safeZipName(w.title).slice(0, 40)}.html`, renderWorkOrder({ company: co.name, logoUrl: s.logoUrl, color: s.brandColor, customer: job.customer, jobTitle: job.title, number: w.number, kind: w.kind, title: w.title, body: w.body, status: w.status, decidedBy: w.decided_by, decidedAt: w.decided_at })));
  if (cert && !("error" in (cleanCert(cert, "classic") as any))) out.push(text("warranty-certificate.html", renderCertificate({ company: co.name, logoUrl: s.logoUrl, color: s.brandColor, customer: job.customer, jobTitle: job.title, address: [job.address, job.city, job.zip].filter(Boolean).join(", "), cert })));
  for (const f of files) {
    if (!f.k || !env.FILES) continue;
    out.push({
      name: `${folder(f.kind)}/${f.name}`,
      read: async () => {
        const obj = await env.FILES!.get(f.k);
        if (!obj) return null;
        return (async function* () {
          const r = obj.body.getReader();
          for (;;) {
            const { done, value } = await r.read();
            if (done) return;
            yield value;
          }
        })();
      },
    });
  }
  await markDownload(env, c);
  return new Response(zipStream(out), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="job-file-${safeZipName(job.title).replace(/\s+/g, "-").slice(0, 40)}-${jobId}.zip"`, "cache-control": "no-store" } });
}
