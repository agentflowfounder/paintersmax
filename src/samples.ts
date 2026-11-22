import { getSessionUser } from "./auth.ts";
import { computeTotals, sanitizeEstimate } from "./estimate.ts";
import { readBlob, writeBlob } from "./kv.ts";
import type { Env } from "./types.ts";

/**
 * Sample content for new accounts (Rogelio, 2026-11-21: a demo employee, job and estimate so a new painter sees a filled-in
 * app instead of an empty one, replaced as they add their own). No database change: sample rows are marked by name
 * ("Sample ..." shows as a badge everywhere), by the customer tag "sample", by the job data flag and by the worker note.
 *  - Admin > Settings can turn sample content off for new accounts and rename nothing else.
 *  - The painter can remove all of it at once with "Clear sample data" (POST /api/samples {action:"clear"}).
 *  - A painter's own rows are never touched: only rows carrying the sample marks are deleted.
 */
export const SAMPLES_KEY = "samplesetting";
export const SAMPLE_TAG = "sample";
export const SAMPLE_NOTE = "[sample]";

export const readSamplesSetting = (raw: unknown): { on: boolean } => ({ on: (raw as any)?.on !== false });
export const samplesOn = (env: Env) => readBlob(env, SAMPLES_KEY, readSamplesSetting).then((s) => s.on);

const COPY = {
  en: { customer: "Sample Customer (Maria Garcia)", job: "Sample: Living room and hallway repaint", property: "Sample home", worker: "Sample Painter (Alex)", position: "Painter", note: "Sample job. Open it to see the estimate, then clear all sample data from your dashboard when you are ready.", lines: [["Prep, patch and prime living room walls", 1, "room", 450], ["Two coats of premium wall paint, living room", 1, "room", 650], ["Hallway walls and trim", 1, "hall", 520]] as [string, number, string, number][] },
  es: { customer: "Cliente de ejemplo (Maria Garcia)", job: "Ejemplo: Repintar sala y pasillo", property: "Casa de ejemplo", worker: "Pintor de ejemplo (Alex)", position: "Pintor", note: "Trabajo de ejemplo. Ábrelo para ver el presupuesto y borra todos los datos de ejemplo desde tu panel cuando quieras.", lines: [["Preparar, resanar y aplicar base en las paredes de la sala", 1, "cuarto", 450], ["Dos manos de pintura premium en la sala", 1, "cuarto", 650], ["Paredes y molduras del pasillo", 1, "pasillo", 520]] as [string, number, string, number][] },
};

/** Adds the sample customer, home, job, estimate and employee. Skips when the account already has any sample or any real job. */
export async function seedSamples(env: Env, companyId: number, lang: "en" | "es"): Promise<{ seeded: boolean }> {
  if (!(await samplesOn(env))) return { seeded: false };
  const has = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM jobs WHERE company_id = ?) AS j, (SELECT COUNT(*) FROM customers WHERE company_id = ?) AS c").bind(companyId, companyId).first<{ j: number; c: number }>();
  if (has && (has.j > 0 || has.c > 0)) return { seeded: false };
  const t = COPY[lang === "es" ? "es" : "en"];
  const cust = await env.DB.prepare("INSERT INTO customers (company_id, name, email, phone, tags, notes) VALUES (?, ?, NULL, NULL, ?, ?)").bind(companyId, t.customer, SAMPLE_TAG, t.note).run();
  const customerId = Number(cust.meta.last_row_id);
  const prop = await env.DB.prepare("INSERT INTO properties (company_id, customer_id, label, address, city, state, kind) VALUES (?, ?, ?, '123 Sample Street', '', '', 'residential')").bind(companyId, customerId, t.property).run();
  const job = await env.DB.prepare("INSERT INTO jobs (company_id, customer_id, property_id, title, trade, stage, data) VALUES (?, ?, ?, ?, 'interior', 'bid', ?)").bind(companyId, customerId, Number(prop.meta.last_row_id), t.job, JSON.stringify({ sample: true })).run();
  const jobId = Number(job.meta.last_row_id);
  const est = sanitizeEstimate({ language: lang, lines: t.lines.map(([description, qty, unit, unitPrice]) => ({ description, qty, unit, unitPrice })) });
  const body = JSON.stringify({ estimate: est, totals: computeTotals(est), sample: true });
  await env.DB.prepare("INSERT INTO documents (company_id, job_id, kind, language, status, title, body) VALUES (?, ?, 'estimate', ?, 'draft', ?, ?)").bind(companyId, jobId, lang, `Estimate: ${t.job}`.slice(0, 160), body).run();
  await env.DB.prepare("INSERT INTO workers (company_id, name, kind, position, pay_cents, pay_unit, notes) VALUES (?, ?, 'employee', ?, 2200, 'hour', ?)").bind(companyId, t.worker, t.position, SAMPLE_NOTE).run();
  return { seeded: true };
}

/** What sample content the account still has. */
export async function sampleCount(env: Env, companyId: number): Promise<number> {
  const r = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM customers WHERE company_id = ? AND tags = ?) + (SELECT COUNT(*) FROM workers WHERE company_id = ? AND notes = ?) AS n").bind(companyId, SAMPLE_TAG, companyId, SAMPLE_NOTE).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Deletes only rows carrying the sample marks, with everything that hangs off the sample jobs. */
export async function clearSamples(env: Env, companyId: number): Promise<{ removed: number }> {
  const custs = (await env.DB.prepare("SELECT id FROM customers WHERE company_id = ? AND tags = ?").bind(companyId, SAMPLE_TAG).all<{ id: number }>()).results ?? [];
  let removed = 0;
  for (const c of custs) {
    // Only jobs that are still sample jobs; a real job a painter added to the sample customer is kept (and keeps its customer).
    const jobs = (await env.DB.prepare("SELECT id, data FROM jobs WHERE company_id = ? AND customer_id = ?").bind(companyId, c.id).all<{ id: number; data: string }>()).results ?? [];
    const sampleJobs = jobs.filter((j) => { try { return JSON.parse(j.data)?.sample === true; } catch { return false; } });
    for (const j of sampleJobs) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM documents WHERE company_id = ? AND job_id = ?").bind(companyId, j.id),
        env.DB.prepare("DELETE FROM job_events WHERE company_id = ? AND job_id = ?").bind(companyId, j.id),
        env.DB.prepare("DELETE FROM jobs WHERE company_id = ? AND id = ?").bind(companyId, j.id),
      ]);
      removed++;
    }
    if (sampleJobs.length === jobs.length) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM properties WHERE company_id = ? AND customer_id = ?").bind(companyId, c.id),
        env.DB.prepare("DELETE FROM customers WHERE company_id = ? AND id = ?").bind(companyId, c.id),
      ]);
      removed++;
    }
  }
  const w = await env.DB.prepare("DELETE FROM workers WHERE company_id = ? AND notes = ?").bind(companyId, SAMPLE_NOTE).run();
  removed += w.meta.changes ?? 0;
  return { removed };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** /api/samples: GET says how much sample content is left; POST {action:"clear"} removes it. Signed-in owners only. */
export async function handleSamples(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    if (b?.action !== "clear") return json({ error: "Unknown action." }, 400);
    const r = await clearSamples(env, user.companyId);
    return json({ ok: true, removed: r.removed });
  }
  return json({ count: await sampleCount(env, user.companyId) });
}

export const saveSamplesSetting = (env: Env, on: boolean) => writeBlob(env, SAMPLES_KEY, { on });
