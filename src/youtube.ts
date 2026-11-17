import { adminActor, can, logAudit } from "./adminroles.ts";
import { getSessionUser } from "./auth.ts";
import { readBlob, updateBlob } from "./kv.ts";
import type { Env } from "./types.ts";
import { thumbUrl, parseYouTube, cleanOrient, type Orient } from "./ytcore.ts";
export { parseYouTube, cleanOrient, embedUrl, thumbUrl, videoHtml, heroVideoHtml, type Orient } from "./ytcore.ts";

/**
 * YouTube for PaintersMax.
 *  - Playing a video needs NO key: a pasted link becomes a privacy-friendly embed (youtube-nocookie.com).
 *  - Searching needs the Cloudflare secret YOUTUBE_API_KEY (YouTube Data API v3). Searches cost 100 of the 10,000
 *    daily quota units, so results are cached for 7 days and the whole platform is capped per day.
 *  - Help videos: the admin places a short video on any named spot (slot) in the dashboard. Nothing is shown for a
 *    slot that has no video, so adding a spot in code never breaks a page.
 */

export const SEARCH_CACHE_DAYS = 7;
export const DAILY_SEARCH_CAP = 80; // 80 x 100 units = 8,000 of the 10,000 free daily units

/* ---------- search ---------- */

export interface VideoHit { id: string; title: string; channel: string; thumb: string }

export function parseSearch(j: any): VideoHit[] {
  const out: VideoHit[] = [];
  for (const it of Array.isArray(j?.items) ? j.items : []) {
    const id = it?.id?.videoId;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
    out.push({ id, title: String(it?.snippet?.title ?? "").slice(0, 140), channel: String(it?.snippet?.channelTitle ?? "").slice(0, 80), thumb: thumbUrl(id) });
  }
  return out.slice(0, 8);
}

const qKey = (q: string) => `yt:q:${q.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80)}`;
const today = () => new Date().toISOString().slice(0, 10);

export async function searchVideos(env: Env, q: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; hits: VideoHit[]; cached: boolean } | { ok: false; error: string; status: number }> {
  const query = q.replace(/\s+/g, " ").trim().slice(0, 80);
  if (query.length < 3) return { ok: false, error: "Type at least 3 letters.", status: 400 };
  if (!env.YOUTUBE_API_KEY) return { ok: false, error: "Video search is not turned on yet.", status: 503 };
  const key = qKey(query);
  const cached = await readBlob(env, key, (raw: any) => (raw && typeof raw.at === "string" && Array.isArray(raw.hits) ? (raw as { at: string; hits: VideoHit[] }) : null));
  if (cached && Date.now() - Date.parse(cached.at) < SEARCH_CACHE_DAYS * 86400000) return { ok: true, hits: cached.hits, cached: true };
  const cap = await updateBlob(env, `yt:cap:${today()}`, (raw: any) => Math.max(0, Number(raw) || 0), (n) => (n >= DAILY_SEARCH_CAP ? { error: "cap" } : { value: n + 1 }));
  if (!cap.ok) return { ok: false, error: "Video search is resting for today. Try again tomorrow.", status: 429 };
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&videoEmbeddable=true&safeSearch=strict&relevanceLanguage=en&q=${encodeURIComponent(query)}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetchImpl(url).catch(() => null);
  if (!res || !res.ok) return { ok: false, error: "YouTube did not answer. Try again in a minute.", status: 502 };
  const hits = parseSearch(await res.json().catch(() => null));
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, JSON.stringify({ at: new Date().toISOString(), hits })).run();
  return { ok: true, hits, cached: false };
}

/* ---------- help videos: slot -> video ---------- */

export const HELP_KEY = "helpvideos";
export interface HelpVideo { yt: string; title: Txt2; orient: Orient }
type Txt2 = { en: string; es: string };
export type HelpMap = Record<string, HelpVideo>;
/** Spots in the product where a help video can sit. Admin picks a video for each. */
export const HELP_SLOTS: { slot: string; where: string }[] = [
  { slot: "welcome", where: "Dashboard: welcome and first steps" },
  { slot: "estimates", where: "Estimates: build your first estimate" },
  { slot: "site-start", where: "Website editor: getting started" },
  { slot: "site-photos", where: "Website editor: photos, crop and sliders" },
  { slot: "site-look", where: "Website editor: colors, fonts and logo" },
  { slot: "site-ai", where: "Website editor: Create with AI" },
  { slot: "site-video", where: "Website editor: adding videos" },
  { slot: "color-studio", where: "Color Studio" },
  { slot: "credits", where: "AI credits and top-ups" },
  { slot: "jobs", where: "Jobs and the Job File" },
  { slot: "reviews", where: "Reviews and review requests" },
  { slot: "domain", where: "Your domain and going live" },
];
const SLOT_OK = (s: string) => HELP_SLOTS.some((h) => h.slot === s);

export function readHelp(raw: unknown): HelpMap {
  const out: HelpMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [slot, v] of Object.entries(raw as Record<string, any>)) {
    if (!SLOT_OK(slot)) continue;
    const p = parseYouTube(v?.yt);
    if (!p) continue;
    out[slot] = { yt: p.id, orient: p.short ? "tall" : cleanOrient(v?.orient), title: { en: String(v?.title?.en ?? "").slice(0, 80), es: String(v?.title?.es ?? "").slice(0, 80) } };
  }
  return out;
}

/** GET /api/help-videos (any signed-in painter): the map. */
export async function handleHelpVideos(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Not found." }, 404);
  if (!(await getSessionUser(env, request))) return json({ error: "Sign in first." }, 401);
  return json({ videos: await readBlob(env, HELP_KEY, readHelp) }, 200, "private, max-age=60");
}

/** Admin: GET shows slots and videos; POST {slot, url, titleEn, titleEs, orient} sets one; {slot, remove:true} clears it. */
export async function handleHelpVideosAdmin(request: Request, env: Env): Promise<Response> {
  const actor = await adminActor(env, request);
  if (!actor || !can(actor.role, "content", "see")) return json({ error: "Not found." }, 404);
  if (request.method === "GET") return json({ slots: HELP_SLOTS, videos: await readBlob(env, HELP_KEY, readHelp), canChange: can(actor.role, "content", "change"), searchOn: !!env.YOUTUBE_API_KEY });
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  if (!can(actor.role, "content", "change")) return json({ error: "Your role can look but not change help videos." }, 403);
  const b: any = await request.json().catch(() => null);
  const slot = String(b?.slot ?? "");
  if (!SLOT_OK(slot)) return json({ error: "That spot does not exist." }, 400);
  let parsed: ReturnType<typeof parseYouTube> = null;
  if (!b?.remove) {
    parsed = parseYouTube(b?.url);
    if (!parsed) return json({ error: "That does not look like a YouTube link." }, 400);
  }
  const r = await updateBlob(env, HELP_KEY, readHelp, (cur) => {
    const next = { ...cur };
    if (!parsed) delete next[slot];
    else next[slot] = { yt: parsed.id, orient: parsed.short ? "tall" : cleanOrient(b?.orient), title: { en: String(b?.titleEn ?? "").slice(0, 80), es: String(b?.titleEs ?? "").slice(0, 80) } };
    return { value: readHelp(next) };
  });
  if (!r.ok) return json({ error: r.error }, 409);
  await logAudit(env, actor, parsed ? "helpvideo.set" : "helpvideo.remove", { detail: { slot, yt: parsed?.id } });
  return json({ ok: true, videos: r.value });
}

/** GET /api/youtube/search?q= (admin, or a signed-in painter): cached video search. */
export async function handleYoutubeSearch(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Not found." }, 404);
  const actor = await adminActor(env, request);
  if (!actor && !(await getSessionUser(env, request))) return json({ error: "Sign in first." }, 401);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const r = await searchVideos(env, q);
  return r.ok ? json({ hits: r.hits, cached: r.cached }) : json({ error: r.error }, r.status);
}

function json(b: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });
}
