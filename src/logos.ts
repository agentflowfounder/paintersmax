import { ADMIN_COMPANY_SLUG } from "./adminroles.ts";
import { getSessionUser } from "./auth.ts";
import { readBlob, updateBlob, writeBlob } from "./kv.ts";
import { consume, refund } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Saved logos. Each company keeps up to 4 logo sets and chooses ONE to use everywhere:
 * the company logo (emails, flyers, estimates, portal, city pages, website header), the browser-tab icon in the
 * dashboard, and the Marketing studio. Stored in app_settings (key logos:<companyId>) and R2 (logo/<companyId>/<setId>/),
 * so no database change is needed.
 *
 * Money rule: the first 4 studio designs a company saves are free (the starter set). After that every studio save or
 * update costs 1 AI credit (feature logo_design). Uploading an existing logo is always free: it is only processed.
 * The PaintersMax company itself (admin) never pays.
 */

export const MAX_SETS = 4;
export const FREE_SAVES = 4;
export const MAX_FILE_BYTES = 1_500_000;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface Design { concept: string; shape: string; primary: string; accent: string; ink: string; text: string; slogan: boolean; sloganText: string; name: string }
export interface LogoSet { id: string; name: string; kind: "studio" | "upload"; design?: Design; v: number; at: string }
export interface LogoState { sets: LogoSet[]; activeId: string; used: number }

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[<>"]/g, "").trim().slice(0, n) : "");
const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : "");
const ID = /^[a-f0-9]{12}$/;

export function cleanDesign(raw: any): Design | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    concept: ["box", "cycle", "paint", "pm"].includes(raw.concept) ? raw.concept : "box",
    shape: ["round", "square", "triangle"].includes(raw.shape) ? raw.shape : "square",
    primary: hex(raw.primary) || "#1f3a5f", accent: hex(raw.accent) || "#e8833a", ink: hex(raw.ink) || "#ffffff", text: hex(raw.text) || "#1f3a5f",
    slogan: raw.slogan !== false, sloganText: str(raw.sloganText, 50), name: str(raw.name, 40),
  };
}

export function readLogos(raw: any): LogoState {
  const sets: LogoSet[] = (Array.isArray(raw?.sets) ? raw.sets : []).slice(0, MAX_SETS)
    .filter((s: any) => ID.test(s?.id ?? ""))
    .map((s: any): LogoSet => ({ id: s.id, name: str(s.name, 40) || "Logo", kind: s.kind === "upload" ? "upload" : "studio", ...(s.kind === "upload" ? {} : { design: cleanDesign(s.design) }), v: Math.max(1, Math.round(Number(s.v) || 1)), at: str(s.at, 30) }));
  const activeId = sets.some((s) => s.id === raw?.activeId) ? raw.activeId : "";
  return { sets, activeId, used: Math.max(0, Math.round(Number(raw?.used) || 0)) };
}

/** Does the next studio save cost a credit? */
export const needsCredit = (st: LogoState, isAdminCompany: boolean) => !isAdminCompany && st.used >= FREE_SAVES;

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 100 && PNG.every((b, i) => bytes[i] === b);
}

const key = (cid: number) => `logos:${cid}`;
const base = (env: Env) => (env.GOOGLE_REDIRECT_BASE || "https://paintersmax.app").replace(/\/$/, "");
export const fileUrl = (env: Env, cid: number, s: Pick<LogoSet, "id" | "v">, kind: "full" | "icon") => `${base(env)}/logo-file/${cid}/${s.id}/${kind}.png?v=${s.v}`;
const withUrls = (env: Env, cid: number, s: LogoSet) => ({ ...s, full: fileUrl(env, cid, s, "full"), icon: fileUrl(env, cid, s, "icon") });
const json = (b: unknown, status = 200, cache = "no-store") => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

/** Puts the chosen logo into the company settings so every document and page that shows the company logo uses it. */
async function applyToSettings(env: Env, cid: number, url: string | null) {
  const row = await env.DB.prepare("SELECT settings FROM companies WHERE id = ?").bind(cid).first<{ settings: string }>();
  let s: any = {};
  try { s = JSON.parse(row?.settings || "{}") || {}; } catch { s = {}; }
  if (url) s.logoUrl = url;
  else if (typeof s.logoUrl === "string" && s.logoUrl.includes("/logo-file/")) delete s.logoUrl;
  await env.DB.prepare("UPDATE companies SET settings = ? WHERE id = ?").bind(JSON.stringify(s), cid).run();
}

async function activeOf(env: Env, cid: number) {
  const st = await readBlob(env, key(cid), readLogos);
  const s = st.sets.find((x) => x.id === st.activeId);
  return s ? { name: s.name, full: fileUrl(env, cid, s, "full"), icon: fileUrl(env, cid, s, "icon") } : null;
}

/** GET /api/logos/active: the signed-in company's chosen logo (browser tab, nav bar). */
export async function handleLogoActive(request: Request, env: Env): Promise<Response> {
  const u = await getSessionUser(env, request);
  if (!u) return json({ error: "Sign in first." }, 401);
  return json({ logo: await activeOf(env, u.companyId) }, 200, "private, no-cache");
}

/** GET /api/logos/public: the PaintersMax company's chosen logo, for the public paintersmax.app pages. */
export async function handleLogoPublic(_request: Request, env: Env): Promise<Response> {
  const m = await env.DB.prepare("SELECT id FROM companies WHERE slug = ?").bind(ADMIN_COMPANY_SLUG).first<{ id: number }>();
  return json({ logo: m ? await activeOf(env, m.id) : null }, 200, "public, max-age=300");
}

/** GET /logo-file/<companyId>/<setId>/full.png|icon.png */
export async function handleLogoFile(env: Env, pathname: string): Promise<Response> {
  const m = pathname.match(/^\/logo-file\/(\d{1,9})\/([a-f0-9]{12})\/(full|icon)\.png$/);
  if (!m || !env.FILES) return new Response("Not found.", { status: 404 });
  const o = await env.FILES.get(`logo/${m[1]}/${m[2]}/${m[3]}.png`);
  if (!o) return new Response("Not found.", { status: 404 });
  return new Response(o.body, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}

/**
 * /api/logos (signed in).
 *  GET: sets, which is active, how many free saves are left, the credit price.
 *  POST multipart `action`:
 *   save   name, kind (studio|upload), setId (to update), design (JSON), full (PNG), icon (PNG)
 *   activate setId   delete setId   clear (remove every saved logo; the free-save count is kept)
 */
export async function handleLogos(request: Request, env: Env): Promise<Response> {
  const u = await getSessionUser(env, request);
  if (!u) return json({ error: "Sign in first." }, 401);
  const co = await env.DB.prepare("SELECT id, slug, name, plan, created_at, settings FROM companies WHERE id = ?").bind(u.companyId).first<{ id: number; slug: string; name: string; plan: string; created_at: string | null; settings: string }>();
  if (!co) return json({ error: "Company not found." }, 404);
  const admin = co.slug === ADMIN_COMPANY_SLUG;
  let brand = "";
  try { brand = JSON.parse(co.settings || "{}")?.brandColor ?? ""; } catch { brand = ""; }
  const view = async () => {
    const st = await readBlob(env, key(co.id), readLogos);
    return { sets: st.sets.map((s) => withUrls(env, co.id, s)), activeId: st.activeId, used: st.used, freeLeft: admin ? 999 : Math.max(0, FREE_SAVES - st.used), cost: 1, max: MAX_SETS, company: co.name, brandColor: hex(brand), storage: !!env.FILES };
  };
  if (request.method === "GET") return json(await view());
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  if (!env.FILES) return json({ error: "File storage is not turned on yet." }, 503);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "Send the form again." }, 400);
  const action = String(form.get("action") ?? "");

  if (action === "save") {
    const kind = form.get("kind") === "upload" ? "upload" : "studio";
    const setId = String(form.get("setId") ?? "");
    const full = form.get("full"), icon = form.get("icon");
    if (!(full instanceof File) || !(icon instanceof File)) return json({ error: "Both logo files are needed." }, 400);
    if (full.size > MAX_FILE_BYTES || icon.size > MAX_FILE_BYTES) return json({ error: "Those files are too large. Keep each under 1.5 MB." }, 413);
    const fb = new Uint8Array(await full.arrayBuffer()), ib = new Uint8Array(await icon.arrayBuffer());
    if (!isPng(fb) || !isPng(ib)) return json({ error: "The logo files must be PNG. Use the converter on this page." }, 400);
    const cur = await readBlob(env, key(co.id), readLogos);
    const existing = setId ? cur.sets.find((s) => s.id === setId) : undefined;
    if (setId && !existing) return json({ error: "That saved logo no longer exists." }, 404);
    if (!existing && cur.sets.length >= MAX_SETS) return json({ error: `You can save ${MAX_SETS} logos. Delete one to make room.` }, 400);
    const pays = kind === "studio" && needsCredit(cur, admin);
    if (pays) {
      const c = await consume(env, { id: co.id, plan: co.plan, createdAt: co.created_at }, "logo_design");
      if (!c.allowed) return json({ error: c.reason === "kill_switch" ? "AI help is paused right now." : "You are out of AI credits. Add credits on the AI use and credits page.", reason: c.reason }, 402);
    }
    const id = existing?.id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    try {
      const meta = { httpMetadata: { contentType: "image/png" } };
      await env.FILES.put(`logo/${co.id}/${id}/full.png`, fb, meta);
      await env.FILES.put(`logo/${co.id}/${id}/icon.png`, ib, meta);
    } catch {
      if (pays) await refund(env, { id: co.id }, "logo_design");
      return json({ error: "We could not save the files. Your credits were not used." }, 500);
    }
    const set: LogoSet = { id, name: str(form.get("name"), 40) || "Logo", kind, ...(kind === "studio" ? { design: cleanDesign(safeJson(form.get("design"))) } : {}), v: (existing?.v ?? 0) + 1, at: new Date().toISOString() };
    const r = await updateBlob(env, key(co.id), readLogos, (st) => ({ value: { sets: st.sets.some((s) => s.id === id) ? st.sets.map((s) => (s.id === id ? set : s)) : [...st.sets, set], activeId: st.activeId, used: st.used + (kind === "studio" ? 1 : 0) } }));
    if (!r.ok) return json({ error: r.error }, 409);
    if (r.value.activeId === id) await applyToSettings(env, co.id, fileUrl(env, co.id, set, "full"));
    return json({ ok: true, id, charged: pays, ...(await view()) });
  }

  const setId = String(form.get("setId") ?? "");
  if (action === "activate") {
    const st = await readBlob(env, key(co.id), readLogos);
    const s = st.sets.find((x) => x.id === setId);
    if (!s) return json({ error: "That saved logo no longer exists." }, 404);
    await writeBlob(env, key(co.id), { ...st, activeId: s.id });
    await applyToSettings(env, co.id, fileUrl(env, co.id, s, "full"));
    return json({ ok: true, ...(await view()) });
  }
  if (action === "delete" || action === "clear") {
    const st = await readBlob(env, key(co.id), readLogos);
    const gone = action === "clear" ? st.sets : st.sets.filter((s) => s.id === setId);
    if (!gone.length) return json({ error: "Nothing to remove." }, 404);
    for (const s of gone) await Promise.all(["full", "icon"].map((k) => env.FILES!.delete(`logo/${co.id}/${s.id}/${k}.png`)));
    const left = st.sets.filter((s) => !gone.some((g) => g.id === s.id));
    const activeGone = gone.some((s) => s.id === st.activeId);
    await writeBlob(env, key(co.id), { sets: left, activeId: activeGone ? "" : st.activeId, used: st.used });
    if (activeGone) await applyToSettings(env, co.id, null);
    return json({ ok: true, ...(await view()) });
  }
  return json({ error: "Unknown action." }, 400);
}

function safeJson(v: unknown): unknown {
  try { return typeof v === "string" ? JSON.parse(v) : null; } catch { return null; }
}
