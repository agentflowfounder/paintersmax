import { adminActor, can, logAudit } from "./adminroles.ts";
import { readCookie } from "./auth.ts";
import { blobsWithPrefix, readBlob, writeBlob } from "./kv.ts";
import { escapeHtml as e } from "./settings.ts";
import type { Env } from "./types.ts";
import { cleanOrient, embedUrl, parseYouTube, thumbUrl, type Orient } from "./ytcore.ts";

/**
 * Landing pages for promoting PaintersMax (admin builds them; the public sees them at /l/<slug>).
 * Everything is stored in app_settings (key lp:<slug>), so no database change is needed.
 * Visits and clicks are counted per day in usage_counters under the PaintersMax company (feature "lp:<slug>:<event>"),
 * with the traffic source (utm_source) kept as a second counter, so the admin can compare campaigns.
 * Funnel: view -> play (video started) -> cta (button tapped) -> checkout (sign-up form submitted with the lp cookie).
 */

export type LpEvent = "view" | "play" | "cta" | "checkout";
export const LP_EVENTS: LpEvent[] = ["view", "play", "cta", "checkout"];
type Txt = { en: string; es: string };
export type LpStatus = "draft" | "live" | "paused";
export interface Landing {
  slug: string;
  name: string; // internal name
  campaign: string; // the campaign this page belongs to (group and compare)
  status: LpStatus;
  goal: "free" | "paid"; // free = start free, paid = pick a tier
  plan: "starter" | "basic" | "pro" | ""; // preselected tier when goal is paid
  headline: Txt;
  sub: Txt;
  bullets: Txt[]; // up to 5
  cta: Txt;
  yt: string;
  orient: Orient;
  note: Txt; // small print under the button (offer end date etc.)
  updatedAt: string;
}

const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, n) : "");
const t2 = (v: any, n: number): Txt => ({ en: s(v?.en, n), es: s(v?.es, n) });
export const cleanSlug = (v: unknown) => s(v, 50).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const cleanTag = (v: unknown) => s(v, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

export function cleanLanding(raw: any, now = new Date().toISOString()): Landing | null {
  const slug = cleanSlug(raw?.slug || raw?.name);
  if (slug.length < 2) return null;
  const yt = parseYouTube(raw?.yt);
  return {
    slug,
    name: s(raw?.name, 80) || slug,
    campaign: cleanTag(raw?.campaign),
    status: ["draft", "live", "paused"].includes(raw?.status) ? raw.status : "draft",
    goal: raw?.goal === "paid" ? "paid" : "free",
    plan: ["starter", "basic", "pro"].includes(raw?.plan) ? raw.plan : "",
    headline: t2(raw?.headline, 120),
    sub: t2(raw?.sub, 300),
    bullets: (Array.isArray(raw?.bullets) ? raw.bullets.slice(0, 20) : []).map((b: any) => t2(b, 120)).filter((b: Txt) => b.en || b.es).slice(0, 5),
    cta: t2(raw?.cta, 40),
    yt: yt?.id ?? "",
    orient: yt?.short ? "tall" : cleanOrient(raw?.orient),
    note: t2(raw?.note, 200),
    updatedAt: now,
  };
}

const key = (slug: string) => `lp:${slug}`;
export const readLanding = (env: Env, slug: string) => readBlob(env, key(slug), (raw) => cleanLanding(raw, (raw as any)?.updatedAt ?? ""));
export async function listLandings(env: Env): Promise<Landing[]> {
  const rows = await blobsWithPrefix(env, "lp:", 500);
  return rows.map((r) => cleanLanding(r.value, (r.value as any)?.updatedAt ?? "")).filter((l): l is Landing => !!l).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ---------- counting ---------- */

async function masterId(env: Env): Promise<number | null> {
  const r = await env.DB.prepare("SELECT id FROM companies WHERE slug = 'paintersmax-master'").first<{ id: number }>();
  return r?.id ?? null;
}
const day = () => new Date().toISOString().slice(0, 10);
const cleanSource = (v: unknown) => s(v, 24).toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 20);

export async function recordLp(env: Env, slug: string, ev: LpEvent, source = ""): Promise<void> {
  const id = await masterId(env);
  if (id == null || !/^[a-z0-9-]{2,50}$/.test(slug)) return;
  const up = (feature: string) => env.DB.prepare("INSERT INTO usage_counters (company_id, feature, period, count) VALUES (?, ?, ?, 1) ON CONFLICT(company_id, feature, period) DO UPDATE SET count = count + 1").bind(id, feature, day());
  const stmts = [up(`lp:${slug}:${ev}`)];
  const src = cleanSource(source);
  if (src) stmts.push(up(`lp:${slug}:${ev}:${src}`));
  await env.DB.batch(stmts);
}

export interface LpStats { totals: Record<LpEvent, number>; bySource: Record<string, Record<LpEvent, number>>; byDay: { day: string; views: number; ctas: number }[] }
const zero = (): Record<LpEvent, number> => ({ view: 0, play: 0, cta: 0, checkout: 0 });

export async function statsFor(env: Env, slug: string, days = 30): Promise<LpStats> {
  const out: LpStats = { totals: zero(), bySource: {}, byDay: [] };
  const id = await masterId(env);
  if (id == null) return out;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = await env.DB.prepare("SELECT feature, period, count FROM usage_counters WHERE company_id = ? AND feature LIKE ? AND period >= ?").bind(id, `lp:${slug}:%`, since).all<{ feature: string; period: string; count: number }>();
  const perDay: Record<string, { views: number; ctas: number }> = {};
  for (const r of rows.results ?? []) {
    const [, , ev, src] = r.feature.split(":");
    if (!LP_EVENTS.includes(ev as LpEvent)) continue;
    if (src) {
      (out.bySource[src] ??= zero())[ev as LpEvent] += r.count;
      continue;
    }
    out.totals[ev as LpEvent] += r.count;
    const d = (perDay[r.period] ??= { views: 0, ctas: 0 });
    if (ev === "view") d.views += r.count;
    if (ev === "cta") d.ctas += r.count;
  }
  out.byDay = Object.entries(perDay).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ day: d, ...v }));
  return out;
}

/** Percent with one decimal, safe for zero. */
export const rate = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : 0);

/* ---------- the public page ---------- */

const TXT = {
  en: { play: "Play video", start: "Get started", by: "PaintersMax", lang: "Español", hint: "Free to start. No card needed." },
  es: { play: "Ver video", start: "Empezar", by: "PaintersMax", lang: "English", hint: "Gratis para empezar. Sin tarjeta." },
};

export function renderLanding(l: Landing, lang: "en" | "es", o: { origin: string; preview: boolean }): string {
  const T = TXT[lang];
  const pick = (x: Txt) => x[lang] || x.en || x.es;
  const headline = pick(l.headline) || "Bid it. Book it. Bank it.";
  const sub = pick(l.sub);
  const cta = pick(l.cta) || T.start;
  const href = `/start?lp=${encodeURIComponent(l.slug)}${l.plan ? `&plan=${l.plan}` : ""}`;
  const note = pick(l.note) || (l.goal === "free" ? T.hint : "");
  const video = l.yt
    ? `<div class="vid ${l.orient}" data-yt="${l.yt}"><button type="button" id="play" aria-label="${e(T.play)}" style="background-image:url(${thumbUrl(l.yt)})"><span></span></button></div>`
    : "";
  const bullets = l.bullets.map((b) => pick(b)).filter(Boolean);
  const other = lang === "en" ? "es" : "en";
  const canonical = `${o.origin.replace(/\/$/, "")}/l/${l.slug}`;
  const ytScript = l.yt ? `var p=document.getElementById('play');if(p)p.onclick=function(){ev('play');var v=p.parentNode,f=document.createElement('iframe');f.src='${embedUrl(l.yt, { autoplay: true })}';f.allow='autoplay;encrypted-media;picture-in-picture;fullscreen';f.allowFullscreen=true;f.title='Video';v.innerHTML='';v.appendChild(f);};` : "";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(headline)} | PaintersMax</title>
<meta name="description" content="${e(sub.slice(0, 155))}"><link rel="canonical" href="${e(canonical)}">${o.preview || l.status !== "live" ? '<meta name="robots" content="noindex">' : ""}
<style>*{box-sizing:border-box}body{margin:0;font:17px/1.55 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1b2430;background:#f7f4ee}
.top{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;max-width:1000px;margin:0 auto}.top b{letter-spacing:.04em;color:#1f3a5f}.top a{color:#1f3a5f;font-size:14px}
main{max-width:1000px;margin:0 auto;padding:10px 18px 60px;display:grid;gap:28px}@media(min-width:860px){main{grid-template-columns:1.1fr .9fr;align-items:center;padding-top:40px}}
h1{font-size:clamp(2rem,6.5vw,3.4rem);line-height:1.08;margin:0 0 14px;color:#1f3a5f}.sub{font-size:1.12rem;margin:0 0 18px;color:#35414f}
ul{padding:0;margin:0 0 22px;list-style:none;display:grid;gap:10px}li{padding-left:30px;position:relative}li:before{content:"";position:absolute;left:0;top:.35em;width:18px;height:18px;border-radius:50%;background:#e8833a}li:after{content:"";position:absolute;left:6px;top:.56em;width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.btn{display:inline-block;background:#e8833a;color:#fff;font-weight:700;text-decoration:none;padding:16px 28px;border-radius:10px;font-size:1.1rem;min-height:52px}.btn:hover{background:#d4722b}.note{font-size:.88rem;color:#5b6674;margin:12px 0 0}
.vid{position:relative;background:#111;border-radius:14px;overflow:hidden;aspect-ratio:16/9;width:100%}.vid.tall{aspect-ratio:9/16;max-width:340px;margin:0 auto}.vid button,.vid iframe{position:absolute;inset:0;width:100%;height:100%;border:0;padding:0;cursor:pointer;background:#111 center/cover no-repeat}
.vid button span{position:absolute;left:50%;top:50%;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:50%;background:rgba(0,0,0,.65);box-shadow:0 0 0 2px #fff inset}.vid button span:after{content:"";position:absolute;left:29px;top:21px;border-left:23px solid #fff;border-top:15px solid transparent;border-bottom:15px solid transparent}
.prev{background:#fff3cd;color:#664d03;text-align:center;padding:6px;font-size:13px}footer{text-align:center;font-size:13px;color:#5b6674;padding:20px}</style></head><body>
${o.preview ? `<div class="prev">Preview. This page is ${e(l.status)}; visitors cannot see it.</div>` : ""}
<div class="top"><b>PAINTERSMAX</b><a href="?lang=${other}">${T.lang}</a></div>
<main><section><h1>${e(headline)}</h1>${sub ? `<p class="sub">${e(sub)}</p>` : ""}${bullets.length ? `<ul>${bullets.map((b) => `<li>${e(b)}</li>`).join("")}</ul>` : ""}<a class="btn" id="cta" href="${e(href)}">${e(cta)}</a>${note ? `<p class="note">${e(note)}</p>` : ""}</section>
<section>${video}</section></main><footer>PaintersMax</footer>
<script>(function(){var q=new URLSearchParams(location.search),src=q.get('utm_source')||'';function ev(n){${o.preview ? "return;" : ""}var d=JSON.stringify({slug:'${l.slug}',event:n,source:src});if(navigator.sendBeacon)navigator.sendBeacon('/api/lp/event',new Blob([d],{type:'application/json'}));else fetch('/api/lp/event',{method:'POST',body:d,keepalive:true});}ev('view');var c=document.getElementById('cta');if(c)c.addEventListener('click',function(){ev('cta');});${ytScript}})();</script></body></html>`;
}

/** GET /l/<slug>: the public page. A visit sets the pm_lp cookie so a later sign-up is credited to this page. */
export async function handleLandingPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const slug = cleanSlug(url.pathname.replace(/^\/l\//, "").replace(/\/$/, ""));
  const lp = slug ? await readLanding(env, slug) : null;
  const actor = lp && lp.status !== "live" ? await adminActor(env, request) : null;
  if (!lp || (lp.status !== "live" && !actor)) return new Response("Not found.", { status: 404, headers: { "content-type": "text/plain" } });
  const lang = url.searchParams.get("lang") === "es" ? "es" : url.searchParams.get("lang") === "en" ? "en" : /^es\b/i.test(request.headers.get("accept-language") ?? "") ? "es" : "en";
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  if (lp.status === "live") headers.append("set-cookie", `pm_lp=${lp.slug}; Path=/; Max-Age=2592000; SameSite=Lax; Secure; HttpOnly`);
  return new Response(renderLanding(lp, lang, { origin: url.origin, preview: lp.status !== "live" }), { headers });
}

/** POST /api/lp/event {slug, event, source}: counts a view, play or button tap on a live page. */
export async function handleLpEvent(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Not found.", { status: 404 });
  const b: any = await request.json().catch(() => null);
  const ev = b?.event;
  const slug = cleanSlug(b?.slug);
  if (!LP_EVENTS.includes(ev) || ev === "checkout" || !slug) return new Response(null, { status: 204 });
  const lp = await readLanding(env, slug);
  if (lp?.status === "live") await recordLp(env, slug, ev, b?.source).catch(() => {});
  return new Response(null, { status: 204 });
}

/** Called when the sign-up form is submitted: credits the landing page the visitor came from. */
export async function creditCheckout(env: Env, request: Request): Promise<void> {
  const slug = readCookie(request.headers.get("cookie"), "pm_lp");
  if (slug && /^[a-z0-9-]{2,50}$/.test(slug)) await recordLp(env, slug, "checkout").catch(() => {});
}

/* ---------- admin ---------- */

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** GET: every page with its 30-day numbers. POST {page}: save. POST {slug, status}: change status. POST {slug, remove:true}: delete (owner only). */
export async function handleLandingAdmin(request: Request, env: Env): Promise<Response> {
  const actor = await adminActor(env, request);
  if (!actor || !can(actor.role, "content", "see")) return json({ error: "Not found." }, 404);
  if (request.method === "GET") {
    const list = await listLandings(env);
    const stats = await Promise.all(list.map((l) => statsFor(env, l.slug)));
    return json({ pages: list.map((l, i) => ({ ...l, stats: stats[i] })), canChange: can(actor.role, "content", "change") });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  if (!can(actor.role, "content", "change")) return json({ error: "Your role can look but not change landing pages." }, 403);
  const b: any = await request.json().catch(() => null);
  if (b?.remove) {
    if (actor.role !== "owner") return json({ error: "Only the owner can delete a landing page." }, 403);
    const slug = cleanSlug(b.slug);
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(key(slug)).run();
    await logAudit(env, actor, "landing.delete", { detail: { slug } });
    return json({ ok: true });
  }
  if (b?.page) {
    const l = cleanLanding(b.page);
    if (!l) return json({ error: "Give the page a name (at least 2 letters)." }, 400);
    if (l.status === "live" && !l.headline.en) return json({ error: "Write the English headline before making it live." }, 400);
    await writeBlob(env, key(l.slug), l);
    await logAudit(env, actor, "landing.save", { detail: { slug: l.slug, status: l.status } });
    return json({ ok: true, page: l, url: `/l/${l.slug}` });
  }
  return json({ error: "Nothing to do." }, 400);
}
