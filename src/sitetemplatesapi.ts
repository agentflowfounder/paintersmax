import { adminActor, can, logAudit } from "./adminroles.ts";
import { getSessionUser } from "./auth.ts";
import { todayLocal } from "./dates.ts";
import { loadRegistry } from "./sitebuilder.ts";
import { entries, readRegistry, REGISTRY_KEY, type Registry, type TemplateOverride } from "./sitetemplates.ts";
import { TEMPLATE_IDS, TEMPLATE_VERSIONS } from "../templates/configs.ts";
import type { Door } from "./sitetheme.ts";
import type { Env } from "./types.ts";

/**
 * Admin control of the template library, plus the AI image hook.
 *
 * GET  /api/site/templates/admin                       every template with admin's settings and which clients use it
 * POST /api/site/templates/admin {action:"set", id, enabled?, doors?, name?, sort?, note?}
 *                                {action:"version", id, version}   pin an older version (rollback); "" = newest
 * POST /api/site/templates/thumb  (multipart: id, file)            the picker thumbnail, kept in R2
 * GET  /site-template-thumb/<id>                                   that thumbnail, public
 * POST /api/site/image-ai                                          the in-house AI image tool (not built yet: 501)
 *
 * Role checks: seeing needs the "sites" area; changing needs "sites" change. Every change goes to the audit log.
 */

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function saveRegistry(env: Env, reg: Registry) {
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
    .bind(REGISTRY_KEY, JSON.stringify(reg))
    .run();
}

/** Which clients have each template in their draft and on their live site. */
async function usage(env: Env): Promise<Record<string, { companyId: number; name: string; draft: boolean; live: boolean }[]>> {
  const rows = (await env.DB.prepare(
    "SELECT a.key AS key, CASE WHEN a.key LIKE 'sitelive:%' THEN json_extract(a.value, '$.site.template') ELSE json_extract(a.value, '$.template') END AS tpl, c.name AS name " +
      "FROM app_settings a LEFT JOIN companies c ON c.id = CAST(substr(a.key, instr(a.key, ':') + 1) AS INTEGER) WHERE a.key LIKE 'site:%' OR a.key LIKE 'sitelive:%' LIMIT 5000",
  ).all<{ key: string; tpl: string | null; name: string | null }>().catch(() => ({ results: [] as any[] }))).results ?? [];
  const out: Record<string, { companyId: number; name: string; draft: boolean; live: boolean }[]> = {};
  for (const r of rows) {
    const live = r.key.startsWith("sitelive:");
    const companyId = Number(r.key.slice(r.key.indexOf(":") + 1));
    const tpl = r.tpl || "classic";
    const list = (out[tpl] ??= []);
    let row = list.find((x) => x.companyId === companyId);
    if (!row) list.push((row = { companyId, name: r.name ?? `#${companyId}`, draft: false, live: false }));
    if (live) row.live = true;
    else row.draft = true;
  }
  return out;
}

export async function handleTemplatesAdmin(request: Request, env: Env): Promise<Response> {
  const actor = await adminActor(env, request);
  if (!actor || !can(actor.role, "sites", "see")) return json({ error: "Not found." }, 404);
  if (request.method === "GET") {
    const reg = await loadRegistry(env);
    const used = await usage(env);
    return json({ templates: entries(reg).map((t) => ({ ...t, thumbUrl: t.thumb ? `/site-template-thumb/${t.id}` : null, clients: used[t.id] ?? [] })), canChange: can(actor.role, "sites", "change") });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  if (!can(actor.role, "sites", "change")) return json({ error: "Your role can look but not change templates." }, 403);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const id = String(b?.id ?? "");
  if (!TEMPLATE_IDS.includes(id)) return json({ error: "Template not found." }, 404);
  const reg = await loadRegistry(env);
  const before: TemplateOverride = { ...(reg[id] ?? {}) };
  const next: any = { ...before, updatedOn: todayLocal(), updatedBy: actor.email };
  if (b.action === "set") {
    if (typeof b.enabled === "boolean") next.enabled = b.enabled;
    if (Array.isArray(b.doors)) next.doors = (["launch", "grow", "signature"] as Door[]).filter((d) => b.doors.includes(d));
    if (typeof b.name === "string") next.name = b.name.trim().slice(0, 40) || undefined;
    if (b.sort != null && Number.isInteger(Number(b.sort))) next.sort = Number(b.sort);
    if (typeof b.note === "string") next.note = b.note.trim().slice(0, 200) || undefined;
  } else if (b.action === "version") {
    const v = String(b.version ?? "");
    if (v && !TEMPLATE_VERSIONS[id][v]) return json({ error: "That version does not exist." }, 400);
    next.version = v || undefined;
  } else return json({ error: "Unknown action." }, 400);
  const clean = readRegistry({ ...reg, [id]: next });
  await saveRegistry(env, clean);
  await logAudit(env, actor, b.action === "version" ? "template_version" : "template_set", { detail: { id, before, after: clean[id] } });
  return json({ ok: true, template: entries(clean).find((t) => t.id === id) });
}

const THUMB_TYPES: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

export async function handleTemplateThumb(request: Request, env: Env): Promise<Response> {
  const actor = await adminActor(env, request);
  if (!actor || !can(actor.role, "sites", "change")) return json({ error: "Not found." }, 404);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  if (!env.FILES) return json({ error: "Photo storage is not turned on yet." }, 503);
  const form = await request.formData().catch(() => null);
  const id = String(form?.get("id") ?? "");
  const file = form?.get("file");
  if (!TEMPLATE_IDS.includes(id)) return json({ error: "Template not found." }, 404);
  if (!(file instanceof File) || !THUMB_TYPES[file.type]) return json({ error: "Use a WebP, PNG or JPG image." }, 400);
  if (file.size > 1024 * 1024) return json({ error: "Keep thumbnails under 1 MB (about 800 x 600 pixels is plenty)." }, 400);
  const key = `site-templates/${id}/${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.${THUMB_TYPES[file.type]}`;
  await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=86400" } });
  const reg = await loadRegistry(env);
  const old = reg[id]?.thumb;
  const clean = readRegistry({ ...reg, [id]: { ...(reg[id] ?? {}), thumb: key, updatedOn: todayLocal(), updatedBy: actor.email } });
  await saveRegistry(env, clean);
  if (old && old !== key) await env.FILES.delete(old).catch(() => {});
  await logAudit(env, actor, "template_thumb", { detail: { id, key } });
  return json({ ok: true, thumbUrl: `/site-template-thumb/${id}` });
}

export async function handleTemplateThumbGet(env: Env, pathname: string): Promise<Response> {
  const id = pathname.slice("/site-template-thumb/".length);
  if (!TEMPLATE_IDS.includes(id) || !env.FILES) return new Response("Not found.", { status: 404 });
  const key = (await loadRegistry(env))[id]?.thumb;
  const obj = key ? await env.FILES.get(key) : null;
  if (!obj) return new Response("Not found.", { status: 404 });
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/webp", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
}

/**
 * The hook for Rogelio's in-house AI image editor and creator (fal.ai, paid with AI credits).
 * When the tool is built: check the painter's door and credits (blockState "image_ai" and consume()), call the tool,
 * save the result as a site photo (handleSitePhotoUpload's path), and return { photo }. Nothing calls fal.ai today.
 */
export async function handleImageAi(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  return json({ error: "Create with AI is coming soon. For now, upload your own photo.", ready: false }, 501);
}
