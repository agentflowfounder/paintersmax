import { getSessionUser, type SessionUser } from "./auth.ts";
import { ADMIN_COMPANY_SLUG } from "./admin.ts";
import { completeEx } from "./assistant.ts";
import { todayLocal } from "./dates.ts";
import { coiLink, showsCustomers } from "./insurance.ts";
import { readSettings } from "./settings.ts";
import { stripeApi } from "./stripe.ts";
import { consume, normalizePlan, refund, type Plan } from "./usage.ts";
import {
  blankPage, canPublish, cleanSite, DOOR_FLOOR_CENTS, DOOR_LIMITS, DOOR_LIST_CENTS, DOOR_NAMES, DOOR_PLAN, doorFor, DOORS, firstDraft, healthFlags, isDoor,
  limitsFor, nextDoor, pageForPath, publishBlockers, readDoorRecord, seoChecks, TEMPLATES, upgradeCents, usageOf,
  type Door, type DoorRecord, type Site,
} from "./sitecore.ts";
import { handleReviewsApi, shownReviews } from "./reviews.ts";
import { renderSitePage, siteRobots, siteSitemap } from "./siterender.ts";
import type { Env } from "./types.ts";

/**
 * Website builder API and the public pages of each painter's site.
 *
 * Storage needs no database change (everything is in app_settings):
 *   sitedoor:<companyId>  the door and any admin limit override
 *   site:<companyId>      the draft the painter edits
 *   sitelive:<companyId>  { site, publishedAt }: what visitors see
 *   siteaudit:<companyId> the last 200 changes made by admin in view-as mode
 * Photos are kept in R2 under site/<companyId>/<photoId> and served from /site-photo/<companyId>/<photoId>.
 */

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

export const doorKey = (c: number) => `sitedoor:${c}`;
export const draftKey = (c: number) => `site:${c}`;
export const liveKey = (c: number) => `sitelive:${c}`;
export const auditKey = (c: number) => `siteaudit:${c}`;

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/webp", "image/png"];

interface CompanyRow { id: number; slug: string; name: string; plan: string; settings: string; notify_email: string | null; created_at: string }

async function companyById(env: Env, id: number) {
  return env.DB.prepare("SELECT id, slug, name, plan, settings, notify_email, created_at FROM companies WHERE id = ?").bind(id).first<CompanyRow>();
}

export async function loadDoor(env: Env, companyId: number, plan: string): Promise<{ door: Door; rec: DoorRecord; limits: ReturnType<typeof limitsFor> }> {
  const rec = readDoorRecord(await getKv(env, doorKey(companyId)));
  const door = doorFor(normalizePlan(plan), rec);
  return { door, rec, limits: limitsFor(door, rec) };
}

export async function saveDoor(env: Env, companyId: number, rec: DoorRecord) {
  await setKv(env, doorKey(companyId), JSON.stringify(rec));
}

export async function loadLive(env: Env, companyId: number): Promise<{ site: Site; publishedAt: string } | null> {
  const j = parse(await getKv(env, liveKey(companyId)));
  return j?.site && typeof j.publishedAt === "string" ? j : null;
}

async function profileOf(env: Env, companyId: number): Promise<any> {
  return parse((await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(companyId).first<{ data: string }>())?.data ?? null) ?? {};
}

/** The signed-in person's app language, from their own business profile. */
async function langOf(env: Env, ownCompanyId: number): Promise<"en" | "es"> {
  return (await profileOf(env, ownCompanyId))?.language?.ui === "es" ? "es" : "en";
}

/** The draft, or a first draft written from the painter's profile when there is none yet. */
export async function loadDraft(env: Env, co: CompanyRow, lang: "en" | "es"): Promise<{ site: Site; fresh: boolean }> {
  const { door, limits } = await loadDoor(env, co.id, co.plan);
  const saved = parse(await getKv(env, draftKey(co.id)));
  if (saved) {
    // Read with no limits so a lowered door never loses content; the limits are checked again on save.
    const r = cleanSite(saved, { pages: 999, services: 999, photos: 9999 }, door, saved.updatedAt);
    if (r.ok) return { site: r.site, fresh: false };
  }
  const prof = await profileOf(env, co.id);
  const pc = prof?.company ?? {};
  const cityNames: string[] = Array.isArray(prof?.cities) ? prof.cities.filter((c: unknown) => typeof c === "string") : [];
  const site = firstDraft({
    name: co.name, phone: pc.phone, email: pc.email || co.notify_email || "", address: pc.address, city: pc.city, state: pc.state, zip: pc.zip, license: pc.license,
    trades: Array.isArray(prof?.trades) ? prof.trades : [], cities: cityNames, warrantyMonths: Number(prof?.warranty?.laborMonths) || undefined,
    insured: await showsCustomers(env, co.id).catch(() => false), lang,
  }, limits);
  return { site, fresh: true };
}

async function isAdmin(env: Env, user: SessionUser): Promise<boolean> {
  const me = await env.DB.prepare("SELECT slug FROM companies WHERE id = ?").bind(user.companyId).first<{ slug: string }>();
  return me?.slug === ADMIN_COMPANY_SLUG;
}

/** Who is acting on which company. Admin may open any client's editor ("view as"); every change is then written to an audit log. */
async function actor(env: Env, request: Request, asRaw: unknown): Promise<{ user: SessionUser; companyId: number; viewAs: boolean } | Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const as = Number(asRaw);
  if (asRaw != null && asRaw !== "" && Number.isInteger(as) && as !== user.companyId) {
    if (!(await isAdmin(env, user))) return json({ error: "Not found." }, 404);
    return { user, companyId: as, viewAs: true };
  }
  return { user, companyId: user.companyId, viewAs: false };
}

export async function audit(env: Env, companyId: number, by: string, action: string, detail = "") {
  const list = (parse(await getKv(env, auditKey(companyId))) ?? []) as any[];
  list.unshift({ at: new Date().toISOString(), by, action, detail: detail.slice(0, 200) });
  await setKv(env, auditKey(companyId), JSON.stringify(list.slice(0, 200)));
}

/** Where the painter's site lives: their own domain when mapped, else their PaintersMax address. */
export async function siteOrigin(env: Env, slug: string): Promise<string> {
  const dom = await env.DB.prepare("SELECT key FROM app_settings WHERE key LIKE 'domain:%' AND value = ? ORDER BY key LIMIT 1").bind(slug).first<{ key: string }>().catch(() => null);
  return dom ? `https://${dom.key.slice(7)}` : `https://${slug}.paintersmax.app`;
}

function doorInfo(door: Door, rec: DoorRecord) {
  const nd = nextDoor(door);
  return {
    door, name: DOOR_NAMES[door], limits: limitsFor(door, rec), canPublish: canPublish(door), override: rec.override ?? null,
    next: nd ? { door: nd, name: DOOR_NAMES[nd], limits: DOOR_LIMITS[nd], priceCents: upgradeCents(door, nd), floorCents: DOOR_FLOOR_CENTS[nd], listCents: DOOR_LIST_CENTS[nd] } : null,
    doors: DOORS.filter((d) => d !== "free").map((d) => ({ door: d, name: DOOR_NAMES[d], limits: DOOR_LIMITS[d], floorCents: DOOR_FLOOR_CENTS[d], listCents: DOOR_LIST_CENTS[d], upgradeCents: upgradeCents(door, d), current: d === door })),
    templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, allowed: t.doors.includes(door) })),
  };
}

const WRITE_PROMPT = [
  "You write text for a small painting company's website. Rewrite or write the text the owner asks for.",
  "Rules:",
  "- Plain, friendly words a homeowner understands. Short sentences. No hype, no exclamation marks.",
  "- Never invent facts: no years in business, awards, reviews, guarantees, prices or certifications unless they are in the owner's text or the business details.",
  "- If something only the owner knows is needed, leave it in [square brackets] for them to fill in.",
  "- One topic per page. Mention the city when it fits naturally, never stuff keywords.",
  "- Output only the new text. No title line, no quotation marks, no notes to the owner.",
].join("\n");

/**
 * GET  /api/site[?as=<companyId>]  the draft, door, usage, checks and addresses.
 * POST /api/site {action, as?, ...}  save | publish | unpublish | discard | photo_delete | write | upgrade
 */
export async function handleSiteApi(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  let b: any = {};
  if (request.method === "POST") {
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
  }
  const a = await actor(env, request, request.method === "POST" ? b?.as : url.searchParams.get("as"));
  if (a instanceof Response) return a;
  const co = await companyById(env, a.companyId);
  if (!co) return json({ error: "Client not found." }, 404);
  const lang = await langOf(env, a.user.companyId);
  const { door, rec, limits } = await loadDoor(env, co.id, co.plan);
  const by = a.viewAs ? `admin ${a.user.email}` : a.user.email;

  if (request.method === "GET") {
    const { site, fresh } = await loadDraft(env, co, lang);
    const live = await loadLive(env, co.id);
    const origin = await siteOrigin(env, co.slug);
    const cityPages = (await env.DB.prepare("SELECT slug, published FROM city_pages WHERE company_id = ?").bind(co.id).all<{ slug: string; published: number }>().catch(() => ({ results: [] as any[] }))).results ?? [];
    return json({
      company: { id: co.id, name: co.name, slug: co.slug, brandColor: readSettings(co.settings).brandColor ?? null },
      viewAs: a.viewAs,
      ...doorInfo(door, rec),
      usage: usageOf(site),
      site,
      fresh,
      checks: Object.fromEntries(site.pages.map((p) => [p.id, seoChecks(site, p)])),
      blockers: publishBlockers(site),
      publishedAt: live?.publishedAt ?? null,
      changed: !live || JSON.stringify({ ...live.site, updatedAt: "" }) !== JSON.stringify({ ...site, updatedAt: "" }),
      origin,
      cityPages: cityPages.filter((c) => c.published).length,
      photoStorage: !!env.FILES,
      stripe: !!env.STRIPE_SECRET_KEY,
    });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);

  const action = String(b?.action ?? "");
  if (action === "save" || action === "publish") {
    // Photos come from the stored list only (an upload adds them); the editor may change descriptions.
    const cur = (await loadDraft(env, co, lang)).site;
    const alts = new Map<string, string>((Array.isArray(b?.site?.photos) ? b.site.photos : []).map((p: any) => [String(p?.id), String(p?.alt ?? "")]));
    const merged = { ...(b?.site ?? cur), photos: cur.photos.map((p) => ({ ...p, alt: alts.has(p.id) ? alts.get(p.id) : p.alt })) };
    const r = cleanSite(merged, limits, door);
    if (!r.ok) return json({ error: r.error, over: r.over, upgrade: doorInfo(door, rec).next }, 402);
    await setKv(env, draftKey(co.id), JSON.stringify(r.site));
    if (a.viewAs) await audit(env, co.id, by, action === "publish" ? "save and publish" : "save");
    if (action === "save") return json({ ok: true, site: r.site, usage: usageOf(r.site), checks: Object.fromEntries(r.site.pages.map((p) => [p.id, seoChecks(r.site, p)])), blockers: publishBlockers(r.site) });
    if (!canPublish(door)) return json({ error: "Publishing comes with the Launch door. Your draft is saved.", over: "publish", upgrade: doorInfo(door, rec).next }, 402);
    const blockers = publishBlockers(r.site);
    if (blockers.length) return json({ error: "Fix these first:", blockers }, 400);
    const publishedAt = new Date().toISOString();
    await setKv(env, liveKey(co.id), JSON.stringify({ site: r.site, publishedAt }));
    return json({ ok: true, publishedAt, site: r.site, origin: await siteOrigin(env, co.slug) });
  }
  if (action === "unpublish") {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(liveKey(co.id)).run();
    if (a.viewAs) await audit(env, co.id, by, "unpublish");
    return json({ ok: true });
  }
  if (action === "discard") {
    // Throw away the draft: back to the published site, or to a fresh first draft.
    const live = await loadLive(env, co.id);
    if (live) await setKv(env, draftKey(co.id), JSON.stringify(live.site));
    else await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(draftKey(co.id)).run();
    if (a.viewAs) await audit(env, co.id, by, "discard draft");
    return json({ ok: true });
  }
  if (action === "photo_delete") {
    const id = String(b?.id ?? "");
    const cur = (await loadDraft(env, co, lang)).site;
    if (!cur.photos.some((p) => p.id === id)) return json({ error: "Photo not found." }, 404);
    const live = await loadLive(env, co.id);
    cur.photos = cur.photos.filter((p) => p.id !== id);
    for (const p of cur.pages) for (const bl of p.blocks) if (bl.type === "photos") bl.photos = bl.photos.filter((x) => x !== id);
    await setKv(env, draftKey(co.id), JSON.stringify(cur));
    // The live site keeps showing it until the next publish, unless it is gone from both.
    if (!live?.site.photos.some((p) => p.id === id)) await env.FILES?.delete(`site/${co.id}/${id}`);
    if (a.viewAs) await audit(env, co.id, by, "delete photo", id);
    return json({ ok: true, site: cur, usage: usageOf(cur) });
  }
  if (action === "write") {
    // AI help with one piece of text. Costs credits (typing is always free).
    const text = typeof b?.text === "string" ? b.text.slice(0, 3000) : "";
    const ask = typeof b?.ask === "string" ? b.ask.trim().slice(0, 300) : "";
    const field = typeof b?.field === "string" ? b.field.slice(0, 40) : "text";
    const u = await consume(env, { id: co.id, plan: co.plan, createdAt: co.created_at }, "site_write");
    if (!u.allowed) return json({ error: u.reason === "kill_switch" ? "AI help is paused right now." : "You are out of AI credits. Add credits on the AI use and credits page.", reason: u.reason }, 402);
    const cur = (await loadDraft(env, co, lang)).site;
    const biz = cur.business;
    const max = field === "seoTitle" ? "at most 60 characters" : field === "seoDesc" ? "between 120 and 155 characters" : field === "headline" ? "at most 12 words" : "at most 180 words";
    const user = [
      `Business: ${co.name}. Phone: ${biz.phone || "unknown"}. Area: ${biz.serviceArea || [biz.city, biz.state].filter(Boolean).join(", ") || "unknown"}. License: ${biz.license || "none given"}.`,
      `Page: ${typeof b?.page === "string" ? b.page.slice(0, 80) : "unknown"}. Field: ${field} (${max}).`,
      ask ? `The owner asks: ${ask}` : "Make it clearer and more useful for a homeowner.",
      `Language: ${lang === "es" ? "Spanish" : "English"}.`,
      `Current text:\n<text>\n${text || "(empty)"}\n</text>`,
    ].join("\n");
    const out = await completeEx(env, WRITE_PROMPT, [{ role: "user", content: user }], { maxTokens: 700 });
    if (!out) {
      await refund(env, { id: co.id }, "site_write");
      return json({ error: "The AI could not write right now. Your credits were not used. Try again in a minute." }, 503);
    }
    if (a.viewAs) await audit(env, co.id, by, "AI write", field);
    return json({ ok: true, text: out.text.replace(/^["']|["']$/g, "").slice(0, field === "seoTitle" ? 70 : field === "seoDesc" ? 170 : 6000) });
  }
  if (action === "upgrade") {
    // One-click upgrade: a one-time Stripe payment for the difference between the two doors.
    const to: unknown = b?.door ?? nextDoor(door);
    if (!isDoor(to) || DOORS.indexOf(to) <= DOORS.indexOf(door)) return json({ error: "Choose a higher door." }, 400);
    if (a.viewAs) return json({ error: "Upgrades are paid by the painter. Change the door from the admin site list instead." }, 400);
    if (!env.STRIPE_SECRET_KEY) return json({ error: "Online upgrades are not open yet. Write to us and we will upgrade you by hand." }, 503);
    const s = await stripeApi(env, "checkout/sessions", upgradeCheckoutForm(url.origin, { companyId: co.id, email: a.user.email, from: door, to }));
    return json({ url: s.url });
  }
  return json({ error: "Unknown action." }, 400);
}

export function upgradeCheckoutForm(origin: string, i: { companyId: number; email: string; from: Door; to: Door }): URLSearchParams {
  const f = new URLSearchParams();
  f.set("mode", "payment");
  f.set("customer_email", i.email);
  f.set("success_url", `${origin}/site?upgraded=1`);
  f.set("cancel_url", `${origin}/site`);
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", "usd");
  f.set("line_items[0][price_data][unit_amount]", String(upgradeCents(i.from, i.to)));
  f.set("line_items[0][price_data][product_data][name]", `PaintersMax website upgrade: ${DOOR_NAMES[i.from]} to ${DOOR_NAMES[i.to]}`);
  f.set("metadata[kind]", "site_upgrade");
  f.set("metadata[company_id]", String(i.companyId));
  f.set("metadata[from]", i.from);
  f.set("metadata[door]", i.to);
  return f;
}

const PLAN_RANK: Record<Plan, number> = { free: 0, starter: 1, basic: 2, pro: 3 };

/** Called by the Stripe webhook when an upgrade is paid. Raises the door (never lowers it) and the matching AI plan. */
export async function applyPaidUpgrade(env: Env, companyId: number, to: unknown): Promise<boolean> {
  if (!isDoor(to)) return false;
  const co = await companyById(env, companyId);
  if (!co) return false;
  const { door, rec } = await loadDoor(env, co.id, co.plan);
  if (DOORS.indexOf(to) > DOORS.indexOf(door)) await saveDoor(env, co.id, { ...rec, door: to });
  const plan = DOOR_PLAN[to];
  if (PLAN_RANK[plan] > PLAN_RANK[normalizePlan(co.plan)]) await env.DB.prepare("UPDATE companies SET plan = ? WHERE id = ?").bind(plan, co.id).run();
  return true;
}

/** POST /api/site/photo (multipart: file, w, h, alt, as?): adds a photo the browser already resized and cleaned. */
export async function handleSitePhotoUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Send the photo as a form upload." }, 400);
  }
  const a = await actor(env, request, form.get("as"));
  if (a instanceof Response) return a;
  if (!env.FILES) return json({ error: "Photo storage is not turned on yet." }, 503);
  const co = await companyById(env, a.companyId);
  if (!co) return json({ error: "Client not found." }, 404);
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Choose a photo." }, 400);
  if (!PHOTO_TYPES.includes(file.type)) return json({ error: "Use a JPG, PNG or WebP photo." }, 400);
  if (file.size > MAX_PHOTO_BYTES) return json({ error: "That photo is too large. The page shrinks photos before upload; try again or use a smaller one." }, 400);
  const { door, rec, limits } = await loadDoor(env, co.id, co.plan);
  const lang = await langOf(env, a.user.companyId);
  const cur = (await loadDraft(env, co, lang)).site;
  if (cur.photos.length >= limits.photos) return json({ error: `Your ${DOOR_NAMES[door]} site can have ${limits.photos} photos.`, over: "photos", upgrade: doorInfo(door, rec).next }, 402);
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  await env.FILES.put(`site/${co.id}/${id}`, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" } });
  const meta = { id, alt: String(form.get("alt") ?? "").trim().slice(0, 160), w: Math.round(Number(form.get("w")) || 0), h: Math.round(Number(form.get("h")) || 0), bytes: file.size, at: new Date().toISOString() };
  cur.photos.push(meta);
  // Put it on the page it was added from, when the editor says which block.
  const blockId = String(form.get("block") ?? "");
  const pageId = String(form.get("page") ?? "");
  const bl = cur.pages.find((p) => p.id === pageId)?.blocks.find((x) => x.id === blockId);
  if (bl?.type === "photos") bl.photos.push(id);
  await setKv(env, draftKey(co.id), JSON.stringify(cur));
  if (a.viewAs) await audit(env, co.id, a.viewAs ? `admin ${a.user.email}` : a.user.email, "add photo", id);
  return json({ ok: true, photo: meta, usage: usageOf(cur) });
}

/** GET /site-photo/<companyId>/<photoId>: a site photo, cached for a year. */
export async function handleSitePhoto(env: Env, pathname: string): Promise<Response> {
  const m = pathname.match(/^\/site-photo\/(\d{1,9})\/([a-f0-9]{12,32})$/);
  if (!m || !env.FILES) return new Response("Not found.", { status: 404 });
  const obj = await env.FILES.get(`site/${m[1]}/${m[2]}`);
  if (!obj) return new Response("Not found.", { status: 404 });
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}

async function renderContext(env: Env, co: CompanyRow, site: Site, origin: string) {
  const settings = readSettings(co.settings);
  const cps = (await env.DB.prepare("SELECT p.slug, c.name, c.state FROM city_pages p JOIN cities c ON c.key = p.city_key WHERE p.company_id = ? AND p.published = 1 ORDER BY c.name LIMIT 30").bind(co.id).all<{ slug: string; name: string; state: string }>().catch(() => ({ results: [] as any[] }))).results ?? [];
  const proof = (await showsCustomers(env, co.id).catch(() => false)) ? await coiLink(env, co.id, "https://paintersmax.app") : null;
  const dm = parse(await getKv(env, `dirm:${co.id}`));
  return {
    company: { id: co.id, slug: co.slug, name: co.name, brandColor: settings.brandColor, logoUrl: settings.logoUrl },
    origin,
    photoSrc: (id: string) => `/site-photo/${co.id}/${id}`,
    cityPages: cps.map((c) => ({ name: c.name, state: c.state, href: `/areas/${c.slug}` })),
    insuredProof: proof,
    founding: !!dm?.founding,
    reviews: await shownReviews(env, co.id),
    site,
  };
}

/** GET /api/site/preview?path=/about[&as=]: the draft as visitors would see it, marked as a preview and hidden from search engines. */
export async function handleSitePreview(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const a = await actor(env, request, url.searchParams.get("as"));
  if (a instanceof Response) return a;
  const co = await companyById(env, a.companyId);
  if (!co) return new Response("Not found.", { status: 404 });
  const { site } = await loadDraft(env, co, await langOf(env, a.user.companyId));
  const page = pageForPath(site, url.searchParams.get("path") ?? "/") ?? site.pages[0];
  const asQ = a.viewAs ? `&as=${co.id}` : "";
  const base = await renderContext(env, co, site, await siteOrigin(env, co.slug));
  const html = renderSitePage({
    ...base, page, preview: true,
    link: (p) => `/api/site/preview?path=${encodeURIComponent(p)}${asQ}`,
    quoteHref: `/q/${encodeURIComponent(co.slug)}`,
    cityPages: base.cityPages.map((c) => ({ ...c, href: `/areas/${co.slug}${c.href.slice(6)}` })),
  });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

/**
 * The public site on a painter's own address. Returns null when the site is not published or the address
 * is not one of its pages, so the old behavior (quote page at "/") keeps working.
 */
export async function serveTenantSite(env: Env, slug: string, pathname: string, origin: string): Promise<Response | null> {
  const co = await env.DB.prepare("SELECT id, slug, name, plan, settings, notify_email, created_at FROM companies WHERE slug = ?").bind(slug).first<CompanyRow>();
  if (!co) return null;
  const live = await loadLive(env, co.id);
  if (pathname === "/robots.txt") return new Response(siteRobots(origin), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  if (pathname === "/sitemap.xml") {
    const cps = (await env.DB.prepare("SELECT slug, updated_at FROM city_pages WHERE company_id = ? AND published = 1 ORDER BY slug").bind(co.id).all<{ slug: string; updated_at: string }>()).results ?? [];
    return new Response(siteSitemap(origin, live?.site ?? null, cps.map((c) => ({ slug: c.slug, updated: c.updated_at })), live?.publishedAt ?? todayLocal()), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
  }
  if (!live) return null;
  const page = pageForPath(live.site, pathname);
  if (!page) return null;
  const base = await renderContext(env, co, live.site, origin);
  const html = renderSitePage({ ...base, page, link: (p) => p, quoteHref: "/quote" });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120" } });
}

/**
 * GET  /api/site/admin            every client's site: door, pages, photos, last publish, domain, Search Console, health.
 * GET  /api/site/admin?audit=<id> the view-as audit log for one client.
 * POST {action: "door", companyId, door} | {action: "override", companyId, pages, services, photos, note}
 */
export async function handleSiteAdmin(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (!(await isAdmin(env, user))) return json({ error: "Not found." }, 404);
  const url = new URL(request.url);
  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const id = Number(b?.companyId);
    const co = Number.isInteger(id) ? await companyById(env, id) : null;
    if (!co) return json({ error: "Client not found." }, 404);
    const { rec } = await loadDoor(env, co.id, co.plan);
    if (b?.action === "door") {
      if (b.door !== "auto" && !isDoor(b.door)) return json({ error: "Choose a door." }, 400);
      const next: DoorRecord = { ...rec };
      if (b.door === "auto") delete next.door;
      else next.door = b.door;
      await saveDoor(env, co.id, next);
      await audit(env, co.id, `admin ${user.email}`, "door", String(b.door));
      return json({ ok: true });
    }
    if (b?.action === "override") {
      const next = readDoorRecord({ ...rec, override: { pages: b.pages, services: b.services, photos: b.photos }, note: b.note });
      if (!b.pages && !b.services && !b.photos) delete next.override;
      await saveDoor(env, co.id, next);
      await audit(env, co.id, `admin ${user.email}`, "limits", JSON.stringify(next.override ?? {}));
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  }
  const auditId = Number(url.searchParams.get("audit"));
  if (Number.isInteger(auditId) && auditId > 0) return json({ audit: parse(await getKv(env, auditKey(auditId))) ?? [] });

  const companies = (await env.DB.prepare("SELECT id, slug, name, plan, settings, notify_email, created_at FROM companies ORDER BY id DESC LIMIT 500").all<CompanyRow>()).results ?? [];
  const keys = (await env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'site:%' OR key LIKE 'sitelive:%' OR key LIKE 'sitedoor:%' OR key LIKE 'domain:%'").all<{ key: string; value: string }>()).results ?? [];
  const kv = new Map(keys.map((k) => [k.key, k.value]));
  const domains = new Map<string, string>();
  for (const k of keys) if (k.key.startsWith("domain:")) domains.set(k.value, k.key.slice(7));
  const today = todayLocal();
  const rows = companies.filter((c) => c.slug !== ADMIN_COMPANY_SLUG).map((c) => {
    const rec = readDoorRecord(kv.get(doorKey(c.id)) ?? null);
    const door = doorFor(normalizePlan(c.plan), rec);
    const lim = limitsFor(door, rec);
    const draftRaw = parse(kv.get(draftKey(c.id)) ?? null);
    const draft = draftRaw ? cleanSite(draftRaw, { pages: 999, services: 999, photos: 9999 }, door) : null;
    const site = draft?.ok ? draft.site : null;
    const live = parse(kv.get(liveKey(c.id)) ?? null);
    const u = site ? usageOf(site) : { pages: 0, services: 0, photos: 0 };
    return {
      id: c.id, name: c.name, slug: c.slug, plan: c.plan, door, doorSet: !!rec.door, override: rec.override ?? null, note: rec.note ?? "",
      limits: lim, usage: u, publishedAt: live?.publishedAt ?? null, editedAt: site?.updatedAt ?? null,
      domain: domains.get(c.slug) ?? null, searchConsole: !!(live?.site?.gscToken || site?.gscToken),
      health: healthFlags(site, live?.publishedAt ?? null, today),
    };
  });
  return json({ clients: rows, doors: DOORS.map((d) => ({ door: d, name: DOOR_NAMES[d], limits: DOOR_LIMITS[d] })), templates: TEMPLATES });
}

/** /api/reviews: the painter's reviews and review links. Admin can work on a client's with "as" (logged like the editor). */
export async function handleSiteReviews(request: Request, env: Env): Promise<Response> {
  let b: any;
  if (request.method === "POST") {
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
  }
  const a = await actor(env, request, request.method === "POST" ? b?.as : new URL(request.url).searchParams.get("as"));
  if (a instanceof Response) return a;
  if (a.viewAs && request.method === "POST") await audit(env, a.companyId, `admin ${a.user.email}`, `reviews ${String(b?.action ?? "")}`, String(b?.id ?? b?.jobId ?? ""));
  return handleReviewsApi(request, env, a.companyId, b);
}

export { blankPage };
