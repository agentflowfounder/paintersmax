import { getSessionUser } from "./auth.ts";
import { cityWithFacts, citySlug, type CityFacts } from "./cities.ts";
import { escapeHtml, readSettings, type CompanySettings } from "./settings.ts";
import type { Env } from "./types.ts";

/**
 * City landing pages: one page per city a painter serves, at /areas/<city-st> on the painter's own address.
 * The painter writes the words (headline, intro, about the city, one unique local detail, optional FAQ and photos).
 * Facts come from shared Census data and are shown with their source; anything we do not have is left out, never guessed.
 * A page cannot be published until it has a unique local detail, so we never publish thin copies of the same text.
 * No ranking is promised: this only gives each city a real, useful page on the painter's own domain.
 */

export const TRADE_LABELS: Record<string, string> = {
  interior: "Interior painting", exterior: "Exterior painting", commercial: "Commercial painting", new_construction: "New construction painting",
  power_washing: "Power washing", drywall: "Drywall repair", cabinets: "Cabinet painting", decks_fences: "Deck and fence staining",
  fencing: "Fence installation", remodeling: "Remodeling", epoxy_floors: "Epoxy floors", industrial: "Industrial coatings",
};

export interface CityPageData {
  headline: string;
  intro: string;
  services: string[];
  about: string;
  local: string; // one real local detail only this painter can write
  faq: { q: string; a: string }[];
  gallery: { url: string; caption: string }[];
  footerNote: string;
}

export const MIN_LOCAL_CHARS = 40;
const STORES = [
  ["Sherwin-Williams", "Sherwin-Williams"],
  ["Home Depot", "The Home Depot"],
  ["Lowes", "Lowe's"],
  ["Ace Hardware", "Ace Hardware"],
] as const;

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Keeps only valid, bounded values. Everything on a public page passes through here. */
export function cleanCityPage(input: any): CityPageData {
  const services = Array.isArray(input?.services) ? input.services.map((s: unknown) => clip(s, 60)).filter(Boolean).slice(0, 12) : [];
  const faq = Array.isArray(input?.faq)
    ? input.faq.map((f: any) => ({ q: clip(f?.q, 160), a: clip(f?.a, 800) })).filter((f: { q: string; a: string }) => f.q && f.a).slice(0, 6)
    : [];
  const gallery = Array.isArray(input?.gallery)
    ? input.gallery
        .map((g: any) => ({ url: typeof g?.url === "string" && /^https:\/\/[^\s"'<>]{3,300}$/.test(g.url.trim()) ? g.url.trim() : "", caption: clip(g?.caption, 140) }))
        .filter((g: { url: string }) => g.url)
        .slice(0, 8)
    : [];
  return { headline: clip(input?.headline, 120), intro: clip(input?.intro, 900), services, about: clip(input?.about, 1800), local: clip(input?.local, 900), faq, gallery, footerNote: clip(input?.footerNote, 300) };
}

/** Why a page cannot be published yet, or null when it can. */
export function publishBlocker(d: CityPageData): string | null {
  if (!d.headline) return "Add a headline.";
  if (d.local.length < MIN_LOCAL_CHARS) return `Add a real local detail (at least ${MIN_LOCAL_CHARS} characters): a neighborhood you have painted in, a job you did there, or something about the homes there. This keeps every city page different.`;
  return null;
}

const n0 = (n: number) => n.toLocaleString("en-US");

/** Census facts as plain sentences. A fact we do not have is left out. */
export function factLines(facts: CityFacts | null, construction: any, cityName: string): string[] {
  const out: string[] = [];
  if (facts) {
    if (facts.population) out.push(`About ${n0(facts.population)} people live in ${cityName}.`);
    if (facts.housingUnits) {
      let s = `${n0(facts.housingUnits)} homes and apartments`;
      if (facts.ownerOccupied && facts.ownerOccupied + (facts.renterOccupied ?? 0) > 0) {
        const pct = Math.round((facts.ownerOccupied / (facts.ownerOccupied + (facts.renterOccupied ?? 0))) * 100);
        s += `, about ${pct}% lived in by their owners`;
      }
      out.push(s + ".");
    }
    if (facts.medianYearBuilt && facts.medianYearBuilt > 1800) out.push(`The typical home was built around ${facts.medianYearBuilt}.`);
    const biz = (facts.businesses ?? []).filter((b) => b.establishments > 0);
    if (biz.length) out.push(`Local businesses include ${biz.map((b) => `${n0(b.establishments)} ${b.label.toLowerCase()}`).join(", ")}.`);
  }
  if (construction?.buildings > 0) out.push(`${n0(construction.buildings)} new residential buildings were permitted${construction.year ? ` in ${construction.year}` : ""}.`);
  return out;
}

export interface PageContext {
  company: { slug: string; name: string; settings: CompanySettings; phone?: string; license?: string; website?: string };
  city: { key: string; name: string; state: string; lat: number | null; lng: number | null };
  data: CityPageData;
  facts: CityFacts | null;
  construction: any;
  weather: { temp: number; unit: string; text: string } | null;
  browserKey: string | null;
  canonical: string;
  noindex: boolean;
  others: { name: string; state: string; slug: string; href: string }[];
  insured?: boolean;
}

const para = (s: string) => s.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");

export function renderCityPage(x: PageContext): string {
  const e = escapeHtml;
  const { company: c, city, data: d } = x;
  const color = c.settings.brandColor ?? "#E8A33D";
  const place = `${city.name}, ${city.state}`;
  const title = `${d.headline || `House painters in ${place}`} | ${c.name}`;
  const desc = (d.intro || `${c.name} paints homes and businesses in ${place}.`).slice(0, 155);
  const facts = factLines(x.facts, x.construction, city.name);
  const services = d.services.length ? d.services : [];
  const ld: any[] = [{
    "@context": "https://schema.org", "@type": "HousePainter", name: c.name, url: x.canonical, areaServed: { "@type": "City", name: city.name, address: { "@type": "PostalAddress", addressLocality: city.name, addressRegion: city.state } },
    ...(c.phone ? { telephone: c.phone } : {}), ...(c.settings.logoUrl ? { image: c.settings.logoUrl } : {}),
  }];
  if (d.faq.length) ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: d.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  const mapTabs = x.browserKey
    ? `<section><h2>Paint and supplies near ${e(city.name)}</h2><p class="muted">Local stores for paint and materials.</p>
       <div class="tabs">${STORES.map((s, i) => `<button type="button" class="tab${i === 0 ? " on" : ""}" data-q="${e(s[0])}">${e(s[1])}</button>`).join("")}</div>
       <iframe id="map" title="Map of paint stores near ${e(city.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" width="100%" height="320" style="border:0;border-radius:10px" src="${mapSrc(x.browserKey, STORES[0][0], place)}"></iframe></section>`
    : "";
  const weather = x.weather ? `<div class="wx">Right now in ${e(city.name)}: <b>${Math.round(x.weather.temp)}&deg;${e(x.weather.unit)}</b>${x.weather.text ? `, ${e(x.weather.text)}` : ""}</div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title><meta name="description" content="${e(desc)}">
<link rel="canonical" href="${e(x.canonical)}">${x.noindex ? '<meta name="robots" content="noindex">' : ""}
<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:type" content="website">
${ld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
<style>
*{box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#F7F5F1;color:#0F1B2D;margin:0;line-height:1.55}
header{background:#0F1B2D;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
header img{max-height:40px;max-width:160px}header b{font-family:Newsreader,Georgia,serif;font-size:20px;font-weight:500}header a{color:${e(color)};text-decoration:none;font-weight:700}
main{max-width:860px;margin:0 auto;padding:20px 16px 40px}h1{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:34px;line-height:1.15;margin:8px 0 10px}
h2{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:24px;margin:30px 0 8px}.muted,.src{color:#4A5568;font-size:14px}
section{margin:0 0 6px}.card{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:10px;padding:16px}
ul.s{columns:2;padding-left:20px}ul.f{padding-left:20px}.wx{display:inline-block;background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:20px;padding:6px 14px;font-size:14px;margin:6px 0}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.tab{padding:8px 14px;border-radius:20px;border:1px solid #cfd5dc;background:#fff;font:inherit;cursor:pointer}.tab.on{background:#0F1B2D;color:#fff}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}.gal figure{margin:0}.gal img{width:100%;height:160px;object-fit:cover;border-radius:8px}.gal figcaption{font-size:13px;color:#4A5568}
details{background:#fff;border:1px solid rgba(15,27,45,.1);border-radius:8px;padding:10px 14px;margin:8px 0}summary{cursor:pointer;font-weight:700}
footer{background:#0F1B2D;color:#cfd5dc;padding:24px 16px;font-size:14px}footer a{color:${e(color)}}.in{max-width:860px;margin:0 auto}
@media(max-width:600px){ul.s{columns:1}h1{font-size:28px}}
</style></head><body>
<header><div>${c.settings.logoUrl ? `<img src="${e(c.settings.logoUrl)}" alt="${e(c.name)}">` : `<b>${e(c.name)}</b>`}</div>${c.phone ? `<a href="tel:${e(c.phone.replace(/[^0-9+]/g, ""))}">${e(c.phone)}</a>` : ""}</header>
<main>
<p class="muted">${e(c.name)} &middot; ${e(place)}</p>
<h1>${e(d.headline || `House painters in ${place}`)}</h1>
${weather}
${d.intro ? para(d.intro) : ""}
${services.length ? `<section><h2>Painting services in ${e(city.name)}</h2><ul class="s">${services.map((s) => `<li>${e(s)}</li>`).join("")}</ul></section>` : ""}
${d.local ? `<section><h2>Recent work and neighborhoods</h2>${para(d.local)}</section>` : ""}
${d.about || facts.length ? `<section><h2>About ${e(city.name)}</h2>${d.about ? para(d.about) : ""}${facts.length ? `<ul class="f">${facts.map((f) => `<li>${e(f)}</li>`).join("")}</ul><p class="src">Source: U.S. Census Bureau public data. Numbers are estimates.</p>` : ""}</section>` : ""}
${d.gallery.length ? `<section><h2>Our work</h2><div class="gal">${d.gallery.map((g) => `<figure><img loading="lazy" src="${e(g.url)}" alt="${e(g.caption || `Painting project by ${c.name} in ${place}`)}">${g.caption ? `<figcaption>${e(g.caption)}</figcaption>` : ""}</figure>`).join("")}</div></section>` : ""}
${mapTabs}
<section><h2>Get a free estimate in ${e(city.name)}</h2><p class="muted">Tell us about the job and see a price range in seconds.</p>
<iframe title="Free estimate" loading="lazy" src="https://paintersmax.app/q/${e(encodeURIComponent(c.slug))}" width="100%" height="760" style="border:1px solid rgba(15,27,45,.1);border-radius:10px;background:#fff"></iframe></section>
${d.faq.length ? `<section><h2>Questions about painting in ${e(city.name)}</h2>${d.faq.map((f) => `<details><summary>${e(f.q)}</summary>${para(f.a)}</details>`).join("")}</section>` : ""}
</main>
<footer><div class="in"><b>${e(c.name)}</b>${c.license ? ` &middot; License ${e(c.license)}` : ""}${x.insured ? " &middot; Insured" : ""}
${d.footerNote ? `<p>${e(d.footerNote)}</p>` : ""}
${x.others.length ? `<p>We also serve: ${x.others.map((o) => `<a href="${e(o.href)}">${e(o.name)}, ${e(o.state)}</a>`).join(" &middot; ")}</p>` : ""}</div></footer>
${x.browserKey ? `<script>var K=${JSON.stringify(x.browserKey)},P=${JSON.stringify(place)};document.querySelectorAll('.tab').forEach(function(b){b.onclick=function(){document.querySelectorAll('.tab').forEach(function(t){t.className='tab'});b.className='tab on';document.getElementById('map').src='https://www.google.com/maps/embed/v1/search?key='+encodeURIComponent(K)+'&zoom=11&q='+encodeURIComponent(b.dataset.q+' near '+P)}})</script>` : ""}
</body></html>`;
}

export const mapSrc = (key: string, store: string, place: string) =>
  `https://www.google.com/maps/embed/v1/search?key=${encodeURIComponent(key)}&amp;zoom=11&amp;q=${encodeURIComponent(`${store} near ${place}`)}`;

/** Current weather from Google, kept for an hour so a busy page does not cost more. Returns null when anything is missing. */
export async function currentWeather(env: Env, lat: number | null, lng: number | null): Promise<{ temp: number; unit: string; text: string } | null> {
  if (!env.GOOGLE_MAPS_SERVER_KEY || lat == null || lng == null) return null;
  const url = `https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat.toFixed(2)}&location.longitude=${lng.toFixed(2)}&unitsSystem=IMPERIAL`;
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const ck = new Request(url);
  try {
    let res = cache ? await cache.match(ck) : undefined;
    if (!res) {
      const r = await fetch(`${url}&key=${env.GOOGLE_MAPS_SERVER_KEY}`);
      if (!r.ok) return null;
      res = new Response(await r.text(), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
      if (cache) await cache.put(ck, res.clone());
    }
    return parseWeather(await res.json());
  } catch {
    return null;
  }
}

export function parseWeather(j: any): { temp: number; unit: string; text: string } | null {
  const t = Number(j?.temperature?.degrees);
  if (!Number.isFinite(t)) return null;
  const unit = j?.temperature?.unit === "CELSIUS" ? "C" : "F";
  const text = typeof j?.weatherCondition?.description?.text === "string" ? j.weatherCondition.description.text.slice(0, 60) : "";
  return { temp: t, unit, text };
}

// ---------- storage ----------
const parse = (s: unknown): any => {
  try {
    return typeof s === "string" ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function companyBySlug(env: Env, slug: string) {
  return env.DB.prepare("SELECT id, slug, name, settings FROM companies WHERE slug = ?").bind(slug).first<{ id: number; slug: string; name: string; settings: string }>();
}
async function profileOf(env: Env, companyId: number) {
  return parse((await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(companyId).first<{ data: string }>())?.data);
}

/** Starting text for a city page. Only the structure: the painter adds the local detail. */
export function defaultPage(cityName: string, state: string, trades: string[]): CityPageData {
  return {
    headline: `House painters in ${cityName}, ${state}`,
    intro: "",
    services: trades.map((t) => TRADE_LABELS[t]).filter(Boolean),
    about: "", local: "", faq: [], gallery: [], footerNote: "",
  };
}

/**
 * Public page. Published pages are open to everyone; an unpublished page only shows to the signed-in owner (as a preview, not indexed).
 * `origin` is the address the visitor sees: the painter's own domain, or the one we forward from.
 */
export async function handleCityPage(request: Request, env: Env, companySlug: string, cSlug: string, origin: string): Promise<Response> {
  const co = await companyBySlug(env, companySlug);
  if (!co) return new Response("Not found.", { status: 404 });
  const row = await env.DB.prepare("SELECT city_key, data, published FROM city_pages WHERE company_id = ? AND slug = ?").bind(co.id, cSlug).first<{ city_key: string; data: string; published: number }>();
  if (!row) return new Response("Not found.", { status: 404 });
  let preview = false;
  if (!row.published) {
    const u = await getSessionUser(env, request);
    if (!u || u.companyId !== co.id) return new Response("Not found.", { status: 404 });
    preview = true;
  }
  const cw = await cityWithFacts(env, row.city_key);
  if (!cw) return new Response("Not found.", { status: 404 });
  const prof = await profileOf(env, co.id);
  const published = (await env.DB.prepare("SELECT p.slug, c.name, c.state FROM city_pages p JOIN cities c ON c.key = p.city_key WHERE p.company_id = ? AND p.published = 1 AND p.slug != ? ORDER BY c.name LIMIT 30").bind(co.id, cSlug).all<{ slug: string; name: string; state: string }>()).results ?? [];
  const base = origin.replace(/\/$/, "");
  const html = renderCityPage({
    company: { slug: co.slug, name: co.name, settings: readSettings(co.settings), phone: prof?.company?.phone, license: prof?.company?.license, website: prof?.company?.website },
    city: { key: row.city_key, name: cw.city.name, state: cw.city.state, lat: cw.city.lat, lng: cw.city.lng },
    data: cleanCityPage(parse(row.data)),
    facts: cw.facts, construction: cw.construction,
    weather: await currentWeather(env, cw.city.lat, cw.city.lng),
    browserKey: env.GOOGLE_MAPS_BROWSER_KEY ?? null,
    canonical: `${base}/areas/${cSlug}`,
    noindex: preview,
    others: published.map((p) => ({ name: p.name, state: p.state, slug: p.slug, href: `${base}/areas/${p.slug}` })),
  });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": preview ? "no-store" : "public, max-age=300" } });
}

/** /sitemap.xml for one painter's address: their home page and every published city page. */
export async function citySitemap(env: Env, companySlug: string, origin: string): Promise<Response> {
  const co = await companyBySlug(env, companySlug);
  if (!co) return new Response("Not found.", { status: 404 });
  const rows = (await env.DB.prepare("SELECT slug, updated_at FROM city_pages WHERE company_id = ? AND published = 1 ORDER BY slug").bind(co.id).all<{ slug: string; updated_at: string }>()).results ?? [];
  const base = origin.replace(/\/$/, "");
  const urls = [`<url><loc>${escapeHtml(base)}/</loc></url>`, ...rows.map((r) => `<url><loc>${escapeHtml(base)}/areas/${escapeHtml(r.slug)}</loc><lastmod>${escapeHtml(String(r.updated_at).slice(0, 10))}</lastmod></url>`)];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

/**
 * GET  /api/citypages : the painter's chosen cities with their page text and status.
 * POST {cityKey, data, published} : save a page. Publishing needs a headline and a unique local detail.
 */
export async function handleCityPagesApi(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const co = await env.DB.prepare("SELECT slug FROM companies WHERE id = ?").bind(user.companyId).first<{ slug: string }>();
  const prof = await profileOf(env, user.companyId);
  const keys: string[] = Array.isArray(prof?.cityKeys) ? prof.cityKeys : [];
  const trades: string[] = Array.isArray(prof?.trades) ? prof.trades : [];
  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const key = typeof b?.cityKey === "string" ? b.cityKey : "";
    if (!keys.includes(key)) return json({ error: "Choose this city in Estimating Setup first." }, 400);
    const city = await env.DB.prepare("SELECT name, state FROM cities WHERE key = ?").bind(key).first<{ name: string; state: string }>();
    if (!city) return json({ error: "City not found." }, 404);
    const data = cleanCityPage(b.data);
    const wantPublish = !!b.published;
    if (wantPublish) {
      const why = publishBlocker(data);
      if (why) return json({ error: why }, 400);
    }
    const slug = citySlug(city.name, city.state);
    await env.DB.prepare(
      `INSERT INTO city_pages (company_id, city_key, slug, data, published, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(company_id, city_key) DO UPDATE SET data = excluded.data, published = excluded.published, updated_at = datetime('now')`,
    ).bind(user.companyId, key, slug, JSON.stringify(data), wantPublish ? 1 : 0).run();
    return json({ ok: true, slug, published: wantPublish });
  }
  const pages = keys.length ? (await env.DB.prepare(`SELECT city_key, slug, data, published FROM city_pages WHERE company_id = ? AND city_key IN (${keys.map(() => "?").join(",")})`).bind(user.companyId, ...keys).all<{ city_key: string; slug: string; data: string; published: number }>()).results ?? [] : [];
  const cities = keys.length ? (await env.DB.prepare(`SELECT key, name, state FROM cities WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all<{ key: string; name: string; state: string }>()).results ?? [] : [];
  const dom = co ? await env.DB.prepare("SELECT key FROM app_settings WHERE key LIKE 'domain:%' AND value = ? LIMIT 1").bind(co.slug).first<{ key: string }>() : null;
  return json({
    slug: co?.slug,
    domain: dom ? `https://${dom.key.slice(7)}` : null,
    cities: keys.map((k) => cities.find((c) => c.key === k)).filter((c): c is { key: string; name: string; state: string } => !!c).map((c) => {
      const p = pages.find((x) => x.city_key === k(c));
      const slug = citySlug(c.name, c.state);
      return { key: c.key, name: c.name, state: c.state, slug, published: !!p?.published, saved: !!p, data: p ? cleanCityPage(parse(p.data)) : defaultPage(c.name, c.state, trades), previewPath: `/areas/${co?.slug}/${slug}`, livePath: `/areas/${slug}` };
    }),
  });
}
const k = (c: { key: string }) => c.key;
