import { getSessionUser, randomToken } from "./auth.ts";
import { effectivePlan, normalizePlan, type Plan } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Files on a job (photos, receipts, documents, worker photos, W-9s). Kept in R2; one row per file in job_files.
 * Storage is limited by plan. Nothing is ever deleted for going over: new uploads pause until the painter downloads
 * and frees space or upgrades. Photos are shrunk in the phone before upload so storage and AI cost stay small.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;
/** Storage per plan (editable here). */
export const STORAGE_LIMIT: Record<Plan, number> = { free: Math.round(0.5 * GB), starter: 2 * GB, basic: 10 * GB, pro: 50 * GB };
export const MAX_FILE_BYTES = 8 * MB;
export const CUSTOMER_MAX_FILES = 12; // photos a customer may add to one job through their portal link
export const KINDS = ["photo", "receipt", "document", "worker_photo", "w9"] as const;
export type FileKind = (typeof KINDS)[number];
const MIMES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export const storageLimitFor = (plan: Plan) => STORAGE_LIMIT[plan];

export interface StorageNotice {
  used: number;
  limit: number;
  percent: number;
  level: "ok" | "warn" | "high" | "full";
  message: string | null;
  upgrade: boolean;
}

const fmt = (b: number) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.max(0.1, b / MB).toFixed(b >= 10 * MB ? 0 : 1)} MB`);

/** What to tell the painter about their storage. Warns at 80%, urgent at 95%, blocks at 100%. */
export function storageNotice(used: number, limit: number, plan: Plan): StorageNotice {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const level = percent >= 100 ? "full" : percent >= 95 ? "high" : percent >= 80 ? "warn" : "ok";
  const base = `You are using ${fmt(used)} of ${fmt(limit)} (${percent}%).`;
  const free = "Download older project ZIP files and remove their photos to free space.";
  const message =
    level === "ok" ? null
    : level === "full" ? `${base} New uploads are paused. ${free}${plan === "pro" ? "" : " Upgrading gives you more room."}`
    : level === "high" ? `${base} You are almost out of room. ${free}${plan === "pro" ? "" : " Upgrading gives you more room."}`
    : `${base} ${free}${plan === "pro" ? "" : " Or upgrade for more room."}`;
  return { used, limit, percent, level, message, upgrade: level !== "ok" && plan !== "pro" };
}

export const extFor = (mime: string) => MIMES[mime] ?? null;
export const cleanName = (n: unknown) => String(n ?? "file").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "file";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function companyPlan(env: Env, companyId: number): Promise<Plan> {
  const co = await env.DB.prepare("SELECT plan, created_at AS createdAt FROM companies WHERE id = ?").bind(companyId).first<{ plan: string; createdAt: string }>();
  return co ? effectivePlan({ plan: co.plan, createdAt: co.createdAt }) : normalizePlan("free");
}

export async function storageUsed(env: Env, companyId: number): Promise<number> {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(bytes),0) AS n FROM job_files WHERE company_id = ?").bind(companyId).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Saves one file to R2 and records it. Returns an error text when it cannot. */
export async function saveFile(env: Env, o: { companyId: number; jobId: number | null; workerId?: number | null; kind: FileKind; file: File; by: "painter" | "customer"; note?: string }): Promise<{ ok: true; id: number; notice: StorageNotice } | { ok: false; error: string; status: number }> {
  if (!env.FILES) return { ok: false, error: "File storage is not available yet.", status: 503 };
  const ext = extFor(o.file.type);
  if (!ext) return { ok: false, error: "Use a photo (JPG, PNG, WebP) or a PDF.", status: 400 };
  if (o.file.size < 1 || o.file.size > MAX_FILE_BYTES) return { ok: false, error: "That file is too large. Photos are shrunk automatically; for other files the limit is 8 MB.", status: 400 };
  const plan = await companyPlan(env, o.companyId);
  const used = await storageUsed(env, o.companyId);
  const limit = storageLimitFor(plan);
  if (used + o.file.size > limit) return { ok: false, error: storageNotice(used, limit, plan).message ?? "Storage is full.", status: 413 };
  const key = `co/${o.companyId}/${o.jobId ?? "company"}/${randomToken().slice(0, 24)}.${ext}`;
  await env.FILES.put(key, await o.file.arrayBuffer(), { httpMetadata: { contentType: o.file.type } });
  const r = await env.DB.prepare("INSERT INTO job_files (company_id, job_id, worker_id, kind, r2_key, name, mime, bytes, uploaded_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(o.companyId, o.jobId, o.workerId ?? null, o.kind, key, cleanName(o.file.name), o.file.type, o.file.size, o.by, (o.note ?? "").slice(0, 300) || null).run();
  return { ok: true, id: Number(r.meta.last_row_id), notice: storageNotice(used + o.file.size, limit, plan) };
}

export async function deleteFile(env: Env, companyId: number, id: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT r2_key FROM job_files WHERE id = ? AND company_id = ?").bind(id, companyId).first<{ r2_key: string }>();
  if (!row) return false;
  await env.FILES?.delete(row.r2_key).catch(() => undefined);
  await env.DB.prepare("DELETE FROM job_files WHERE id = ? AND company_id = ?").bind(id, companyId).run();
  await env.DB.prepare("DELETE FROM job_photo_findings WHERE file_id = ? AND company_id = ?").bind(id, companyId).run();
  return true;
}

/**
 * GET  /api/files?jobId=        list a job's files and the storage meter
 * GET  /api/files?id=           download or show one file (owner only)
 * POST /api/files (multipart)   file, jobId, kind, note  upload
 * POST /api/files (json)        {action:"delete", id}
 */
export async function handleFiles(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const u = new URL(request.url);
  const c = user.companyId;
  if (request.method === "GET") {
    const id = Number(u.searchParams.get("id"));
    if (u.searchParams.has("id")) {
      const row = Number.isInteger(id) ? await env.DB.prepare("SELECT r2_key, mime, name FROM job_files WHERE id = ? AND company_id = ?").bind(id, c).first<{ r2_key: string; mime: string; name: string }>() : null;
      const obj = row && env.FILES ? await env.FILES.get(row.r2_key) : null;
      if (!row || !obj) return new Response("Not found.", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": row.mime, "cache-control": "private, max-age=3600", "content-disposition": `inline; filename="${row.name.replace(/"/g, "")}"`, "x-content-type-options": "nosniff" } });
    }
    const jobId = Number(u.searchParams.get("jobId"));
    const plan = await companyPlan(env, c);
    const files = Number.isInteger(jobId)
      ? (await env.DB.prepare("SELECT id, kind, name, mime, bytes, uploaded_by AS by, note, created_at AS at FROM job_files WHERE company_id = ? AND job_id = ? ORDER BY id DESC").bind(c, jobId).all()).results
      : [];
    return json({ files, storage: storageNotice(await storageUsed(env, c), storageLimitFor(plan), plan), enabled: !!env.FILES });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const fd = await request.formData();
    const file = fd.get("file");
    const jobId = Number(fd.get("jobId"));
    const kind = String(fd.get("kind") ?? "photo") as FileKind;
    if (!(file instanceof File)) return json({ error: "Choose a file." }, 400);
    if (!(KINDS as readonly string[]).includes(kind)) return json({ error: "Unknown file type." }, 400);
    // Receipts, worker photos and W-9 files may belong to the company or a worker instead of a job.
    const companyLevel = ["receipt", "worker_photo", "w9"].includes(kind) && !fd.get("jobId");
    const workerId = Number(fd.get("workerId")) || null;
    if (workerId && !(await env.DB.prepare("SELECT id FROM workers WHERE id = ? AND company_id = ?").bind(workerId, c).first())) return json({ error: "Worker not found." }, 404);
    if ((kind === "worker_photo" || kind === "w9") && !workerId) return json({ error: "Choose a worker." }, 400);
    if (!companyLevel && (!Number.isInteger(jobId) || !(await env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").bind(jobId, c).first()))) return json({ error: "Job not found." }, 404);
    const r = await saveFile(env, { companyId: c, jobId: companyLevel ? null : jobId, workerId, kind, file, by: "painter", note: String(fd.get("note") ?? "") });
    return r.ok ? json({ ok: true, id: r.id, storage: r.notice }) : json({ error: r.error }, r.status);
  }
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (b?.action === "delete") {
    const ok = await deleteFile(env, c, Number(b.id));
    return ok ? json({ ok: true }) : json({ error: "Not found." }, 404);
  }
  return json({ error: "Unknown action." }, 400);
}
