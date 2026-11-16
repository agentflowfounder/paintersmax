import { getSessionUser } from "./auth.ts";
import { ADMIN_COMPANY_SLUG, provisionClient } from "./admin.ts";
import { addJobEvent, ensureCustomerAndJob } from "./crm.ts";
import { todayLocal } from "./dates.ts";
import {
  bumpRoute, cleanListing, DEFAULT_DAILY_CAP, DIR_HOST, DIR_SERVICES, dirCityKey, dirCitySlug, isDirService, isDuplicate, keyFromCitySlug, parseImport, pickMember,
  readMember, SEED_CITIES, type DirService, type Listing, type MemberSettings, type RouteState,
} from "./dircore.ts";
import { sendCustomerEmail, sendLeadEmail } from "./email.ts";
import { coiLink, showsCustomers } from "./insurance.ts";
import { priceRange } from "./pricing.ts";
import { escapeHtml as e, readSettings } from "./settings.ts";
import { loadDoor, loadLive, siteOrigin } from "./sitebuilder.ts";
import { PLACEHOLDER_RE } from "./sitecore.ts";
import type { Env } from "./types.ts";

/**
 * PainterSelect: the "Find a painter" directory for homeowners, on painterselect.com (and, for testing before the
 * domain is connected, at paintersmax.app/find, which is hidden from search engines and points to painterselect.com).
 *
 * Storage needs no database change (app_settings):
 *   dirl:<cityKey>:<id>   a listing (public business data), with its claim when someone claims it
 *   dirm:<companyId>      member settings: Founding badge, daily lead cap, opt-out
 *   dirr:<companyId>      lead routing count for today
 *   dirpool:<time>:<id>   a lead no member could take (the market pool)
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
const listingKey = (l: Pick<Listing, "cityKey" | "id">) => `dirl:${l.cityKey}:${l.id}`;
const memberKey = (c: number) => `dirm:${c}`;
const routeKey = (c: number) => `dirr:${c}`;

type Lang = "en" | "es";
const T = {
  en: {
    tagline: "Find a trusted painter near you", find: "Find a painter", city: "City", search: "Search", byCity: "Painters by city",
    how: "How it works", how1: "Pick your city and the job.", how2: "Get a price range in seconds and a call from a painter who serves your area.", how3: "Compare, ask questions, and hire the one you trust.",
    tools: "Homeowner tools", guide: "How to hire a painter", cost: "What should painting cost?", forPainters: "Are you a painter?", forPaintersText: "Claim your free listing, or join PaintersMax to get the leads from this directory.", join: "Join as a painter",
    paintersIn: "Painters in", members: "PainterSelect members", others: "Other painters in", notClaimed: "This painter has not claimed their profile.", claim: "Claim this listing", claimed: "Claimed profile",
    quoteTitle: "Get a free estimate", quoteSub: "Tell us about the job. A painter who serves", quoteSub2: "will contact you, usually the same day.",
    name: "Your name", email: "Email", phone: "Phone", zip: "ZIP code", service: "What needs painting?", sqft: "About how many square feet? (optional)", details: "Anything else we should know?", send: "Send my request",
    sent: "Thanks. Your request was sent to", sentPool: "Thanks. We received your request and will match you with a painter who serves your area.", noOne: "No painter has joined for this city yet. Send your request and we will find one for you.",
    insured: "Insured", founding: "Founding painter", viewProfile: "View profile and get a quote", website: "Website", call: "Call",
    services: { interior: "Interior painting", exterior: "Exterior painting", cabinets: "Cabinet painting", commercial: "Commercial painting" } as Record<DirService, string>,
    prices: "Typical prices in", priceNote: "Ranges from our rate data for a typical job. Every home is different; a painter will confirm the price after seeing the job.",
    hireShort: "Before you hire: ask for a written estimate, proof of insurance, what prep is included, the paint brand and the start date.",
    servesCity: "Serves", profileOf: "Painting company", getQuote: "Get a free estimate", powered: "Powered by PaintersMax", servicesHere: "Services",
    claimTitle: "Claim your free listing", claimText: "Is this your business? Claim it to update your details and open a free PaintersMax account. We confirm every claim, usually by calling the number on the listing.",
    yourName: "Your name", yourEmail: "Your email", yourPhone: "Your phone", own: "I own or manage this business.", claimBtn: "Claim my listing",
    claimDone: "Done. Check your email for the sign-in link to your free PaintersMax account. We will confirm your listing within one business day.",
    sqftRow: "Size", interior: "Interior", exterior: "Exterior", notFound: "Page not found.", back: "All cities", lang: "Español",
  },
  es: {
    tagline: "Encuentre un pintor de confianza cerca de usted", find: "Encontrar un pintor", city: "Ciudad", search: "Buscar", byCity: "Pintores por ciudad",
    how: "Cómo funciona", how1: "Elija su ciudad y el trabajo.", how2: "Reciba un rango de precio en segundos y una llamada de un pintor que trabaja en su zona.", how3: "Compare, pregunte y contrate al que le dé confianza.",
    tools: "Herramientas para dueños de casa", guide: "Cómo contratar a un pintor", cost: "¿Cuánto debe costar pintar?", forPainters: "¿Es usted pintor?", forPaintersText: "Reclame su ficha gratis, o únase a PaintersMax para recibir los clientes de este directorio.", join: "Unirme como pintor",
    paintersIn: "Pintores en", members: "Miembros de PainterSelect", others: "Otros pintores en", notClaimed: "Este pintor no ha reclamado su perfil.", claim: "Reclamar esta ficha", claimed: "Perfil reclamado",
    quoteTitle: "Pida un presupuesto gratis", quoteSub: "Cuéntenos del trabajo. Un pintor que trabaja en", quoteSub2: "le llamará, casi siempre el mismo día.",
    name: "Su nombre", email: "Correo", phone: "Teléfono", zip: "Código postal", service: "¿Qué hay que pintar?", sqft: "¿Cuántos pies cuadrados, más o menos? (opcional)", details: "¿Algo más que debamos saber?", send: "Enviar mi solicitud",
    sent: "Gracias. Su solicitud se envió a", sentPool: "Gracias. Recibimos su solicitud y le buscaremos un pintor que trabaje en su zona.", noOne: "Todavía no hay pintores miembros en esta ciudad. Envíe su solicitud y le buscaremos uno.",
    insured: "Asegurado", founding: "Pintor fundador", viewProfile: "Ver perfil y pedir presupuesto", website: "Sitio web", call: "Llamar",
    services: { interior: "Pintura de interiores", exterior: "Pintura de exteriores", cabinets: "Pintura de gabinetes", commercial: "Pintura comercial" } as Record<DirService, string>,
    prices: "Precios típicos en", priceNote: "Rangos de nuestros datos de precios para un trabajo típico. Cada casa es diferente; el pintor confirma el precio después de ver el trabajo.",
    hireShort: "Antes de contratar: pida un presupuesto por escrito, comprobante de seguro, qué preparación incluye, la marca de pintura y la fecha de inicio.",
    servesCity: "Trabaja en", profileOf: "Empresa de pintura", getQuote: "Pida un presupuesto gratis", powered: "Con tecnología de PaintersMax", servicesHere: "Servicios",
    claimTitle: "Reclame su ficha gratis", claimText: "¿Es su negocio? Reclámelo para actualizar sus datos y abrir una cuenta gratis de PaintersMax. Confirmamos cada reclamo, casi siempre llamando al número de la ficha.",
    yourName: "Su nombre", yourEmail: "Su correo", yourPhone: "Su teléfono", own: "Soy dueño o administro este negocio.", claimBtn: "Reclamar mi ficha",
    claimDone: "Listo. Revise su correo para el enlace de entrada a su cuenta gratis de PaintersMax. Confirmaremos su ficha en un día hábil.",
    sqftRow: "Tamaño", interior: "Interior", exterior: "Exterior", notFound: "Página no encontrada.", back: "Todas las ciudades", lang: "English",
  },
};

interface Ctx { base: string; lang: Lang; mirror: boolean; origin: string }
/** A link inside the directory, keeping the language and the /find prefix on the test address. */
const href = (x: Ctx, path: string) => `${x.base}${x.lang === "es" ? "/es" : ""}${path === "/" && (x.base || x.lang === "es") ? "" : path}` || "/";
const canonicalOf = (x: Ctx, path: string) => `https://${DIR_HOST}${x.lang === "es" ? "/es" : ""}${path === "/" && x.lang === "es" ? "" : path}`;

function layout(x: Ctx, o: { title: string; desc: string; path: string; body: string; noindex?: boolean; ld?: object[] }): string {
  const t = T[x.lang];
  const canon = canonicalOf(x, o.path);
  const en = `https://${DIR_HOST}${o.path}`;
  const es = `https://${DIR_HOST}/es${o.path === "/" ? "" : o.path}`;
  const other = x.lang === "es" ? `${x.base}${o.path}` : `${x.base}/es${o.path === "/" ? "" : o.path}`;
  return `<!doctype html><html lang="${x.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(o.title)}</title><meta name="description" content="${e(o.desc)}">
<link rel="canonical" href="${e(canon)}"><link rel="alternate" hreflang="en" href="${e(en)}"><link rel="alternate" hreflang="es" href="${e(es)}"><link rel="alternate" hreflang="x-default" href="${e(en)}">
${x.mirror || o.noindex ? '<meta name="robots" content="noindex">' : ""}
<meta property="og:title" content="${e(o.title)}"><meta property="og:description" content="${e(o.desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${e(canon)}"><meta name="theme-color" content="#123a2f">
${(o.ld ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
<style>
*{box-sizing:border-box}body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#f6f7f4;color:#10231d;margin:0;line-height:1.6}a{color:#0f6b4f}
.wrap{max-width:1000px;margin:0 auto;padding:0 16px}header{background:#123a2f;color:#fff}header .wrap{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px}
.brand{color:#fff;text-decoration:none;font-family:Newsreader,Georgia,serif;font-size:23px;font-weight:600}.brand span{color:#f2c14e}header nav a{color:#fff;margin-left:14px;font-weight:600;font-size:14px;text-decoration:none}
h1{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:36px;line-height:1.15;margin:22px 0 8px}h2{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:25px;margin:30px 0 10px}
.muted{color:#4b5d56}.card{background:#fff;border:1px solid rgba(16,35,29,.12);border-radius:12px;padding:16px;margin:0 0 12px}
.mem{display:grid;grid-template-columns:120px 1fr;gap:14px;align-items:start}.mem img{width:120px;height:96px;object-fit:cover;border-radius:8px;background:#e6e9e3}.mem .ph{width:120px;height:96px;border-radius:8px;background:#e6e9e3;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:700;color:#5b6b58}.mem h3{margin:0;font-size:19px}
.badge{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:12px;background:#f2c14e;color:#10231d;margin:0 4px 4px 0}.badge.g{background:#d9efe4;color:#0f6b4f}
.btn{display:inline-block;background:#f2c14e;color:#10231d;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:8px;border:0;font:inherit;font-weight:700;cursor:pointer}.btn.s{background:#e7ebe5}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}.grid a{display:block;background:#fff;border:1px solid rgba(16,35,29,.12);border-radius:8px;padding:10px 12px;text-decoration:none;font-weight:600}
label{display:block;font-weight:600;font-size:14px;margin:10px 0 4px}input,select,textarea{width:100%;padding:11px;border:1px solid #c8d0cb;border-radius:8px;font:inherit;background:#fff}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.list li{margin:6px 0}table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #dfe4e0;padding:8px;text-align:left}
.hp{position:absolute;left:-5000px}#msg{font-weight:600;margin-top:10px}footer{background:#123a2f;color:#cfe0d8;font-size:14px;margin-top:40px}footer .wrap{padding:22px 16px}footer a{color:#f2c14e}
@media(max-width:620px){.mem{grid-template-columns:1fr}.mem img,.mem .ph{width:100%;height:160px}.two{grid-template-columns:1fr}h1{font-size:29px}}
</style></head><body>
<header><div class="wrap"><a class="brand" href="${e(href(x, "/"))}">Painter<span>Select</span></a><nav><a href="${e(href(x, "/hire-a-painter"))}">${e(t.guide)}</a><a href="${e(href(x, "/cost"))}">${e(t.cost)}</a><a href="${e(other)}" hreflang="${x.lang === "es" ? "en" : "es"}">${e(t.lang)}</a></nav></div></header>
<main class="wrap">${o.body}</main>
<footer><div class="wrap"><b>PainterSelect</b> &middot; ${e(t.tagline)}<br><a href="https://paintersmax.app/">${e(t.powered)}</a> &middot; <a href="https://paintersmax.app/start">${e(t.join)}</a> &middot; <a href="https://paintersmax.app/privacy">Privacy</a></div></footer>
</body></html>`;
}

const page = (html: string, status = 200, cache = "public, max-age=300") => new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } });

// ------------------------------------------------------------------ data

interface Member {
  id: number; slug: string; name: string; phone: string; website: string; trades: string[]; cityKeys: string[]; cap: number;
  founding: boolean; insured: boolean; photo: string | null; intro: string; services: string[];
}

async function cityName(env: Env, key: string): Promise<{ name: string; state: string } | null> {
  const row = await env.DB.prepare("SELECT name, state FROM cities WHERE key = ?").bind(key).first<{ name: string; state: string }>().catch(() => null);
  if (row) return row;
  const seed = SEED_CITIES.find(([n, s]) => dirCityKey(n, s) === key);
  if (seed) return { name: seed[0], state: seed[1] };
  const l = (await env.DB.prepare("SELECT value FROM app_settings WHERE key LIKE ? LIMIT 1").bind(`dirl:${key}:%`).first<{ value: string }>())?.value;
  const j = parse(l ?? null);
  return j ? { name: j.city, state: j.state } : null;
}

async function listingsIn(env: Env, key: string): Promise<{ key: string; l: Listing }[]> {
  const rows = (await env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE ? ORDER BY key LIMIT 500").bind(`dirl:${key}:%`).all<{ key: string; value: string }>()).results ?? [];
  return rows.map((r) => ({ key: r.key, l: cleanListing(parse(r.value)) })).filter((r): r is { key: string; l: Listing } => !!r.l);
}

/** Paying members whose business profile lists this city. Free accounts and the admin company are not members. */
async function membersIn(env: Env, key: string | null): Promise<Member[]> {
  const rows = (await env.DB.prepare(
    key
      ? `SELECT c.id, c.slug, c.name, c.plan, p.data FROM companies c JOIN company_profiles p ON p.company_id = c.id
          WHERE EXISTS (SELECT 1 FROM json_each(p.data, '$.cityKeys') WHERE value = ?) LIMIT 200`
      : `SELECT c.id, c.slug, c.name, c.plan, p.data FROM companies c JOIN company_profiles p ON p.company_id = c.id WHERE c.plan != 'free' LIMIT 500`,
  ).bind(...(key ? [key] : [])).all<{ id: number; slug: string; name: string; plan: string; data: string }>().catch(() => ({ results: [] as any[] }))).results ?? [];
  const out: Member[] = [];
  for (const r of rows) {
    if (r.slug === ADMIN_COMPANY_SLUG) continue;
    const { door } = await loadDoor(env, r.id, r.plan);
    if (door === "free") continue;
    const ms: MemberSettings = readMember(await getKv(env, memberKey(r.id)));
    if (ms.optOut) continue;
    out.push(await memberCard(env, r, ms));
  }
  // Founding painters first, then by name. Lead order is decided separately (see pickMember).
  return out.sort((a, b) => Number(b.founding) - Number(a.founding) || a.name.localeCompare(b.name));
}

async function memberCard(env: Env, r: { id: number; slug: string; name: string; data: string }, ms: MemberSettings): Promise<Member> {
  const prof = parse(r.data) ?? {};
  const live = await loadLive(env, r.id);
  const home = live?.site.pages.find((p) => p.kind === "home");
  const photo = live?.site.photos[0]?.id ?? null;
  const intro = home?.intro && !PLACEHOLDER_RE.test(home.intro) ? home.intro.slice(0, 260) : "";
  return {
    id: r.id, slug: r.slug, name: r.name,
    phone: live?.site.business.phone || prof?.company?.phone || "",
    website: live ? await siteOrigin(env, r.slug) : prof?.company?.website || "",
    trades: Array.isArray(prof?.trades) ? prof.trades : [], cityKeys: Array.isArray(prof?.cityKeys) ? prof.cityKeys : [],
    cap: ms.cap ?? DEFAULT_DAILY_CAP, founding: !!ms.founding, insured: await showsCustomers(env, r.id).catch(() => false),
    photo: photo ? `https://paintersmax.app/site-photo/${r.id}/${photo}` : null, intro,
    services: live ? live.site.pages.filter((p) => p.kind === "service").map((p) => p.nav) : [],
  };
}

const offers = (m: Member, s: DirService) => (s === "cabinets" ? m.trades.includes("cabinets") : m.trades.includes(s) || (s === "interior" && !m.trades.length));

async function allCityKeys(env: Env): Promise<string[]> {
  const set = new Set(SEED_CITIES.map(([n, s]) => dirCityKey(n, s)));
  for (const m of await membersIn(env, null)) for (const k of m.cityKeys) set.add(k);
  const ls = (await env.DB.prepare("SELECT key FROM app_settings WHERE key LIKE 'dirl:%' LIMIT 5000").all<{ key: string }>()).results ?? [];
  for (const r of ls) set.add(r.key.split(":")[1]);
  return [...set];
}

// ------------------------------------------------------------------ pages

function memberHtml(x: Ctx, m: Member): string {
  const t = T[x.lang];
  return `<div class="card mem">${m.photo ? `<img loading="lazy" src="${e(m.photo)}" alt="${e(m.name)}">` : `<div class="ph" aria-hidden="true">${e(m.name.slice(0, 1).toUpperCase())}</div>`}<div>
<h3>${e(m.name)}</h3><div>${m.founding ? `<span class="badge">${e(t.founding)}</span>` : ""}${m.insured ? `<span class="badge g">&#10003; ${e(t.insured)}</span>` : ""}</div>
${m.intro ? `<p class="muted">${e(m.intro)}</p>` : ""}${m.services.length ? `<p class="muted">${e(m.services.slice(0, 6).join(" · "))}</p>` : ""}
<a class="btn" href="${e(href(x, `/pro/${m.slug}`))}">${e(t.viewProfile)}</a>${m.phone ? ` <a class="btn s" href="tel:${e(m.phone.replace(/[^0-9+]/g, ""))}">${e(t.call)} ${e(m.phone)}</a>` : ""}</div></div>`;
}

function listingHtml(x: Ctx, l: Listing): string {
  const t = T[x.lang];
  const claimed = l.claim?.status === "approved";
  return `<li><b>${e(l.name)}</b>${l.phone ? ` &middot; <a href="tel:${e(l.phone.replace(/[^0-9+]/g, ""))}">${e(l.phone)}</a>` : ""}${l.website ? ` &middot; <a href="${e(l.website)}" rel="nofollow noopener">${e(t.website)}</a>` : ""}
<br><small class="muted">${claimed ? e(t.claimed) : `${e(t.notClaimed)} <a href="${e(href(x, `/claim/${l.id}`))}">${e(t.claim)}</a>`}</small></li>`;
}

function leadForm(x: Ctx, cityKey: string, place: string, service: DirService | null): string {
  const t = T[x.lang];
  return `<section class="card" id="quote"><h2 style="margin-top:0">${e(t.quoteTitle)}</h2><p class="muted">${e(t.quoteSub)} ${e(place)} ${e(t.quoteSub2)}</p>
<form id="lf"><input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<div class="two"><div><label for="n">${e(t.name)}</label><input id="n" name="name" required maxlength="100" autocomplete="name"></div><div><label for="em">${e(t.email)}</label><input id="em" name="email" type="email" required maxlength="200" autocomplete="email"></div></div>
<div class="two"><div><label for="ph">${e(t.phone)}</label><input id="ph" name="phone" type="tel" maxlength="30" autocomplete="tel"></div><div><label for="z">${e(t.zip)}</label><input id="z" name="zip" inputmode="numeric" maxlength="10" autocomplete="postal-code"></div></div>
<div class="two"><div><label for="sv">${e(t.service)}</label><select id="sv" name="service">${DIR_SERVICES.map((s) => `<option value="${s}"${s === service ? " selected" : ""}>${e(t.services[s])}</option>`).join("")}</select></div><div><label for="sq">${e(t.sqft)}</label><input id="sq" name="sqft" inputmode="numeric" maxlength="6"></div></div>
<label for="d">${e(t.details)}</label><textarea id="d" name="details" rows="3" maxlength="1500"></textarea>
<p><button class="btn" type="submit">${e(t.send)}</button></p><div id="msg" role="status"></div></form></section>
<script>document.getElementById('lf').onsubmit=async function(ev){ev.preventDefault();var f=new FormData(this),b=Object.fromEntries(f.entries());b.cityKey=${JSON.stringify(cityKey)};b.lang=${JSON.stringify(x.lang)};var m=document.getElementById('msg'),btn=this.querySelector('button');btn.disabled=true;m.textContent='...';
try{var r=await fetch('/api/dir/lead',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});var j=await r.json();if(!r.ok)throw new Error(j.error||'Error');m.textContent=j.painter?${JSON.stringify(t.sent)}+' '+j.painter+'.':${JSON.stringify(t.sentPool)};this.reset();}catch(err){m.textContent=err.message;btn.disabled=false;}}</script>`;
}

function priceTable(x: Ctx, place: string): string {
  const t = T[x.lang];
  const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
  const rows = [1000, 1500, 2000, 2500].map((sq) => {
    const i = priceRange("interior", sq), o = priceRange("exterior", sq);
    return `<tr><td>${sq.toLocaleString("en-US")} sq ft</td><td>${usd(i.lowCents)} - ${usd(i.highCents)}</td><td>${usd(o.lowCents)} - ${usd(o.highCents)}</td></tr>`;
  });
  return `<h2>${e(t.prices)} ${e(place)}</h2><table><thead><tr><th>${e(t.sqftRow)}</th><th>${e(t.interior)}</th><th>${e(t.exterior)}</th></tr></thead><tbody>${rows.join("")}</tbody></table><p class="muted"><small>${e(t.priceNote)}</small></p>`;
}

async function homePage(env: Env, x: Ctx): Promise<Response> {
  const t = T[x.lang];
  const keys = await allCityKeys(env);
  const cities = (await Promise.all(keys.map(async (k) => ({ k, c: await cityName(env, k) })))).filter((r) => r.c).sort((a, b) => a.c!.name.localeCompare(b.c!.name));
  const body = `<h1>${e(t.tagline)}</h1><p class="muted" style="font-size:18px">${e(t.how1)} ${e(t.how2)}</p>
<form onsubmit="var v=this.c.value;var o=[].find.call(document.querySelectorAll('#cl a'),function(a){return a.textContent.toLowerCase().indexOf(v.toLowerCase())===0});if(o){location.href=o.href}return false" class="two" style="max-width:520px"><div><label for="c">${e(t.city)}</label><input id="c" name="c" list="cd" placeholder="Tyler"></div><div style="align-self:end"><button class="btn">${e(t.search)}</button></div>
<datalist id="cd">${cities.map((r) => `<option value="${e(r.c!.name)}">`).join("")}</datalist></form>
<h2>${e(t.byCity)}</h2><div class="grid" id="cl">${cities.map((r) => `<a href="${e(href(x, `/painters/${dirCitySlug(r.c!.name, r.c!.state)}`))}">${e(r.c!.name)}, ${e(r.c!.state)}</a>`).join("")}</div>
<h2>${e(t.how)}</h2><ol class="list"><li>${e(t.how1)}</li><li>${e(t.how2)}</li><li>${e(t.how3)}</li></ol>
<h2>${e(t.tools)}</h2><ul class="list"><li><a href="${e(href(x, "/hire-a-painter"))}">${e(t.guide)}</a></li><li><a href="${e(href(x, "/cost"))}">${e(t.cost)}</a></li></ul>
<div class="card"><b>${e(t.forPainters)}</b><p class="muted">${e(t.forPaintersText)}</p><a class="btn" href="https://paintersmax.app/start">${e(t.join)}</a></div>`;
  return page(layout(x, { title: `PainterSelect: ${t.tagline}`, desc: `${t.tagline}. ${t.how2}`, path: "/", body, ld: [{ "@context": "https://schema.org", "@type": "WebSite", name: "PainterSelect", url: `https://${DIR_HOST}/` }] }));
}

async function cityPage(env: Env, x: Ctx, cslug: string, service: DirService | null): Promise<Response> {
  const t = T[x.lang];
  const key = keyFromCitySlug(cslug);
  const city = key ? await cityName(env, key) : null;
  if (!key || !city) return notFound(x);
  const place = `${city.name}, ${city.state}`;
  let members = await membersIn(env, key);
  if (service) members = members.filter((m) => offers(m, service));
  const memberIds = new Set(members.map((m) => m.id));
  const listings = (await listingsIn(env, key)).map((r) => r.l).filter((l) => !(l.claim?.status === "approved" && memberIds.has(l.claim.companyId)));
  const what = service ? t.services[service] : null;
  const h1 = what ? `${what} ${x.lang === "es" ? "en" : "in"} ${place}` : `${t.paintersIn} ${place}`;
  const path = `/painters/${cslug}${service ? `/${service}` : ""}`;
  const body = `<p class="muted"><a href="${e(href(x, "/"))}">${e(t.back)}</a></p><h1>${e(h1)}</h1>
${!service ? `<p>${DIR_SERVICES.map((s) => `<a href="${e(href(x, `/painters/${cslug}/${s}`))}">${e(t.services[s])}</a>`).join(" &middot; ")}</p>` : ""}
${members.length ? `<h2>${e(t.members)}</h2>${members.map((m) => memberHtml(x, m)).join("")}` : `<p class="card">${e(t.noOne)}</p>`}
${leadForm(x, key, place, service)}
${listings.length ? `<h2>${e(t.others)} ${e(city.name)}</h2><ul class="list">${listings.map((l) => listingHtml(x, l)).join("")}</ul>` : ""}
${priceTable(x, place)}
<h2>${e(t.guide)}</h2><p>${e(t.hireShort)} <a href="${e(href(x, "/hire-a-painter"))}">${e(t.guide)}</a></p>`;
  const ld: object[] = [{ "@context": "https://schema.org", "@type": "ItemList", name: h1, itemListElement: members.map((m, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "HousePainter", name: m.name, url: `https://${DIR_HOST}/pro/${m.slug}`, ...(m.phone ? { telephone: m.phone } : {}) } })) }];
  // A city with nobody listed yet is useful to the visitor (the request form) but thin for search engines.
  return page(layout(x, { title: `${h1} | PainterSelect`, desc: `${h1}: ${members.length ? `${members.length} ${t.members.toLowerCase()}, ` : ""}${t.how2}`.slice(0, 160), path, body, ld, noindex: !members.length && !listings.length }));
}

async function proPage(env: Env, x: Ctx, slug: string): Promise<Response> {
  const t = T[x.lang];
  const r = await env.DB.prepare("SELECT c.id, c.slug, c.name, c.plan, c.settings, COALESCE(p.data, '{}') AS data FROM companies c LEFT JOIN company_profiles p ON p.company_id = c.id WHERE c.slug = ?").bind(slug).first<{ id: number; slug: string; name: string; plan: string; settings: string; data: string }>();
  if (!r || r.slug === ADMIN_COMPANY_SLUG) return notFound(x);
  const { door } = await loadDoor(env, r.id, r.plan);
  const ms = readMember(await getKv(env, memberKey(r.id)));
  if (door === "free" || ms.optOut) return notFound(x);
  const m = await memberCard(env, r, ms);
  const live = await loadLive(env, r.id);
  const photos = live ? live.site.photos.slice(0, 9) : [];
  const cities = (await Promise.all(m.cityKeys.slice(0, 30).map((k) => cityName(env, k)))).filter((c): c is { name: string; state: string } => !!c);
  const proof = m.insured ? await coiLink(env, r.id, "https://paintersmax.app") : null;
  const body = `<h1>${e(m.name)}</h1><p class="muted">${e(t.profileOf)}${cities.length ? ` &middot; ${e(t.servesCity)} ${cities.map((c) => `<a href="${e(href(x, `/painters/${dirCitySlug(c.name, c.state)}`))}">${e(c.name)}</a>`).join(", ")}` : ""}</p>
<div>${m.founding ? `<span class="badge">${e(t.founding)}</span>` : ""}${m.insured ? `<span class="badge g">&#10003; ${e(t.insured)}</span>${proof ? ` <a href="${e(proof)}" rel="noopener">${x.lang === "es" ? "Ver comprobante" : "View proof"}</a>` : ""}` : ""}</div>
${m.intro ? `<p style="font-size:18px">${e(m.intro)}</p>` : ""}
<p>${m.phone ? `<a class="btn s" href="tel:${e(m.phone.replace(/[^0-9+]/g, ""))}">${e(t.call)} ${e(m.phone)}</a> ` : ""}${m.website ? `<a class="btn s" href="${e(m.website)}" rel="noopener">${e(t.website)}</a>` : ""}</p>
${m.services.length ? `<h2>${e(t.servicesHere)}</h2><ul class="list">${m.services.map((s) => `<li>${e(s)}</li>`).join("")}</ul>` : ""}
${photos.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${photos.map((p) => `<img loading="lazy" src="https://paintersmax.app/site-photo/${r.id}/${e(p.id)}" alt="${e(p.alt || m.name)}" style="width:100%;height:170px;object-fit:cover;border-radius:8px">`).join("")}</div>` : ""}
<h2>${e(t.getQuote)}</h2><iframe title="${e(t.getQuote)}" loading="lazy" src="https://paintersmax.app/q/${e(encodeURIComponent(r.slug))}" width="100%" height="760" style="border:1px solid rgba(16,35,29,.12);border-radius:10px;background:#fff"></iframe>`;
  const ld = [{ "@context": "https://schema.org", "@type": "HousePainter", name: m.name, url: `https://${DIR_HOST}/pro/${m.slug}`, ...(m.phone ? { telephone: m.phone } : {}), ...(m.website ? { sameAs: [m.website] } : {}), ...(cities.length ? { areaServed: cities.map((c) => ({ "@type": "City", name: `${c.name}, ${c.state}` })) } : {}) }];
  return page(layout(x, { title: `${m.name} | PainterSelect`, desc: (m.intro || `${m.name}: ${t.profileOf.toLowerCase()}${cities[0] ? ` ${x.lang === "es" ? "en" : "in"} ${cities[0].name}, ${cities[0].state}` : ""}.`).slice(0, 160), path: `/pro/${m.slug}`, body, ld }));
}

async function findListing(env: Env, id: string): Promise<{ key: string; l: Listing } | null> {
  if (!/^[a-f0-9]{10}$/.test(id)) return null;
  const r = await env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'dirl:%' AND key LIKE ? LIMIT 1").bind(`%:${id}`).first<{ key: string; value: string }>();
  const l = r ? cleanListing(parse(r.value)) : null;
  return r && l ? { key: r.key, l } : null;
}

async function claimPage(env: Env, x: Ctx, id: string): Promise<Response> {
  const t = T[x.lang];
  const f = await findListing(env, id);
  if (!f) return notFound(x);
  const l = f.l;
  const body = `<h1>${e(t.claimTitle)}</h1><div class="card"><b>${e(l.name)}</b><br>${e(l.city)}, ${e(l.state)}${l.phone ? ` &middot; ${e(l.phone)}` : ""}</div>
<p>${e(t.claimText)}</p>
${l.claim && l.claim.status !== "rejected" ? `<p class="card">${e(l.claim.status === "approved" ? t.claimed : t.claimDone)}</p>` : `<form id="cf" class="card"><input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<label for="n">${e(t.yourName)}</label><input id="n" name="name" required maxlength="100" autocomplete="name">
<div class="two"><div><label for="em">${e(t.yourEmail)}</label><input id="em" name="email" type="email" required maxlength="200" autocomplete="email"></div><div><label for="ph">${e(t.yourPhone)}</label><input id="ph" name="phone" type="tel" required maxlength="30" autocomplete="tel"></div></div>
<label style="font-weight:400"><input type="checkbox" name="own" required style="width:auto"> ${e(t.own)}</label>
<p><button class="btn">${e(t.claimBtn)}</button></p><div id="msg" role="status"></div></form>
<script>document.getElementById('cf').onsubmit=async function(ev){ev.preventDefault();var b=Object.fromEntries(new FormData(this).entries());b.id=${JSON.stringify(l.id)};b.lang=${JSON.stringify(x.lang)};var m=document.getElementById('msg'),btn=this.querySelector('button');btn.disabled=true;
try{var r=await fetch('/api/dir/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});var j=await r.json();if(!r.ok)throw new Error(j.error||'Error');m.textContent=${JSON.stringify(t.claimDone)};}catch(err){m.textContent=err.message;btn.disabled=false;}}</script>`}`;
  return page(layout(x, { title: `${t.claimTitle}: ${l.name}`, desc: t.claimText.slice(0, 155), path: `/claim/${l.id}`, body, noindex: true }), 200, "no-store");
}

const GUIDE = {
  en: [
    ["Get two or three written estimates", "Ask each painter to come see the job. A written estimate should list the rooms or surfaces, the prep work, the number of coats, the paint brand and line, and what is not included."],
    ["Ask for proof of insurance", "A painter should carry general liability insurance, and workers compensation if they have employees. Ask for a certificate or a link to it, and check the dates."],
    ["Ask about prep", "Most of a good paint job is prep: cleaning, scraping, sanding, caulking, patching and priming. Ask what is included and who moves furniture."],
    ["Agree on the schedule and payment", "Get a start date and how long the job will take. A small deposit is normal; paying the full price up front is not."],
    ["Check recent work", "Ask for photos of recent jobs or addresses you can drive by, and read their reviews."],
    ["Walk the job at the end", "Before the last payment, walk every room or wall with the painter and point out anything to touch up."],
  ],
  es: [
    ["Pida dos o tres presupuestos por escrito", "Pida a cada pintor que vea el trabajo. El presupuesto debe decir los cuartos o superficies, la preparación, cuántas capas, la marca y línea de pintura, y lo que no está incluido."],
    ["Pida comprobante de seguro", "Un pintor debe tener seguro de responsabilidad general, y de compensación laboral si tiene empleados. Pida el certificado o un enlace, y revise las fechas."],
    ["Pregunte por la preparación", "La mayor parte de un buen trabajo es la preparación: limpiar, raspar, lijar, sellar, resanar y aplicar imprimador. Pregunte qué incluye y quién mueve los muebles."],
    ["Acuerden fechas y pagos", "Pida una fecha de inicio y cuánto tardará. Un depósito pequeño es normal; pagar todo por adelantado no lo es."],
    ["Revise trabajos recientes", "Pida fotos de trabajos recientes o direcciones que pueda ver, y lea sus reseñas."],
    ["Revisen juntos al final", "Antes del último pago, recorra cada cuarto o pared con el pintor y señale lo que hay que retocar."],
  ],
};

function guidePage(x: Ctx): Response {
  const t = T[x.lang];
  const g = GUIDE[x.lang];
  const body = `<h1>${e(t.guide)}</h1>${g.map(([h, p], i) => `<h2>${i + 1}. ${e(h)}</h2><p>${e(p)}</p>`).join("")}<p><a class="btn" href="${e(href(x, "/"))}">${e(t.find)}</a></p>`;
  const ld = [{ "@context": "https://schema.org", "@type": "HowTo", name: t.guide, step: g.map(([h, p]) => ({ "@type": "HowToStep", name: h, text: p })) }];
  return page(layout(x, { title: `${t.guide} | PainterSelect`, desc: g[0][1].slice(0, 155), path: "/hire-a-painter", body, ld }));
}

function costPage(x: Ctx): Response {
  const t = T[x.lang];
  const body = `<h1>${e(t.cost)}</h1>${priceTable(x, "North and East Texas")}<p>${e(t.hireShort)}</p><p><a class="btn" href="${e(href(x, "/"))}">${e(t.find)}</a></p>`;
  return page(layout(x, { title: `${t.cost} | PainterSelect`, desc: t.priceNote.slice(0, 155), path: "/cost", body }));
}

function notFound(x: Ctx): Response {
  const t = T[x.lang];
  return page(layout(x, { title: t.notFound, desc: t.notFound, path: "/", body: `<h1>${e(t.notFound)}</h1><p><a href="${e(href(x, "/"))}">${e(t.find)}</a></p>`, noindex: true }), 404, "no-store");
}

async function sitemap(env: Env): Promise<Response> {
  const urls = new Set<string>(["/", "/hire-a-painter", "/cost"]);
  const members = await membersIn(env, null);
  for (const m of members) urls.add(`/pro/${m.slug}`);
  const listed = new Set(((await env.DB.prepare("SELECT key FROM app_settings WHERE key LIKE 'dirl:%' LIMIT 5000").all<{ key: string }>()).results ?? []).map((r) => r.key.split(":")[1]));
  for (const k of new Set([...members.flatMap((m) => m.cityKeys), ...listed])) {
    const c = await cityName(env, k);
    if (!c) continue;
    const cs = dirCitySlug(c.name, c.state);
    urls.add(`/painters/${cs}`);
    for (const s of DIR_SERVICES) if (members.some((m) => m.cityKeys.includes(k) && offers(m, s))) urls.add(`/painters/${cs}/${s}`);
  }
  const loc = (p: string, es: boolean) => `https://${DIR_HOST}${es ? "/es" : ""}${p === "/" && es ? "" : p}`;
  const body = [...urls].map((p) => `<url><loc>${e(loc(p, false))}</loc><xhtml:link rel="alternate" hreflang="es" href="${e(loc(p, true))}"/></url><url><loc>${e(loc(p, true))}</loc><xhtml:link rel="alternate" hreflang="en" href="${e(loc(p, false))}"/></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

/**
 * The public directory pages. base is "" on painterselect.com and "/find" on paintersmax.app (the test address).
 * Returns null when the path is not a directory page.
 */
export async function handleDirectory(request: Request, env: Env, base: "" | "/find", rawPath: string): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  let path = rawPath.replace(/\/+$/, "") || "/";
  let lang: Lang = "en";
  if (path === "/es" || path.startsWith("/es/")) {
    lang = "es";
    path = path.slice(3) || "/";
  }
  const x: Ctx = { base, lang, mirror: base === "/find", origin: new URL(request.url).origin };
  if (path === "/robots.txt") return new Response(base ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\nDisallow: /claim/\n\nSitemap: https://${DIR_HOST}/sitemap.xml\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (path === "/sitemap.xml") return base ? null : sitemap(env);
  if (path === "/") return homePage(env, x);
  if (path === "/hire-a-painter") return guidePage(x);
  if (path === "/cost") return costPage(x);
  if (path === "/join") return Response.redirect("https://paintersmax.app/start", 302);
  let m = path.match(/^\/painters\/([a-z0-9-]{4,70})(?:\/([a-z]+))?$/);
  if (m) {
    if (m[2] && !isDirService(m[2])) return notFound(x);
    return cityPage(env, x, m[1], (m[2] as DirService) ?? null);
  }
  m = path.match(/^\/pro\/([a-z0-9-]{1,60})$/);
  if (m) return proPage(env, x, m[1]);
  m = path.match(/^\/claim\/([a-f0-9]{10})$/);
  if (m) return claimPage(env, x, m[1]);
  return notFound(x);
}

// ------------------------------------------------------------------ public APIs

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const emailOk = (s: string) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s);

/** Hands a homeowner's request to the matched member, as a lead and a job file in their PaintersMax account. */
async function deliverLead(env: Env, ctx: ExecutionContext | undefined, companyId: number, q: { name: string; email: string; phone: string; zip: string; service: DirService; sqft: number; details: string; place: string; lang: Lang }, pooled = false): Promise<string | null> {
  const co = await env.DB.prepare("SELECT id, name, notify_email FROM companies WHERE id = ?").bind(companyId).first<{ id: number; name: string; notify_email: string | null }>();
  if (!co) return null;
  const lead = await env.DB.prepare("INSERT INTO leads (company_id, name, email, phone, zip, source, notes) VALUES (?, ?, ?, ?, ?, 'painterselect', ?)")
    .bind(co.id, q.name, q.email, q.phone || null, q.zip || null, `PainterSelect request (${q.place}): ${q.service}${q.sqft ? `, about ${q.sqft} sq ft` : ""}. ${q.details}`.slice(0, 6000)).run();
  const leadId = Number(lead.meta.last_row_id);
  const t = T.en.services[q.service];
  const ids = await ensureCustomerAndJob(env, { companyId: co.id, leadId, name: q.name, email: q.email, phone: q.phone, zip: q.zip, title: `${t}${q.sqft ? `, ${q.sqft} sq ft` : ""}`, trade: q.service === "cabinets" ? "cabinets" : q.service, firstEvent: `PainterSelect directory request from ${q.place}. ${q.details || "No notes."}` });
  if (ids) await addJobEvent(env, co.id, ids.jobId, "note", pooled ? "Assigned to you from the PainterSelect market pool." : "Sent to you by PainterSelect because you serve this city.");
  const send = (p: Promise<unknown>) => (ctx ? ctx.waitUntil(p) : p);
  send(sendLeadEmail(env, co.notify_email, `New PainterSelect lead for ${co.name}: ${q.name}`, [
    `A homeowner in ${q.place} asked for a painter on PainterSelect and you were matched.`, "",
    `Name: ${q.name}`, `Email: ${q.email}`, `Phone: ${q.phone || "n/a"}`, `ZIP: ${q.zip || "n/a"}`, `Job: ${t}${q.sqft ? `, about ${q.sqft} sq ft` : ""}`, `Notes: ${q.details || "none"}`, "",
    "Call them today: the first painter to answer usually gets the job. The lead is also in your PaintersMax Jobs list.",
  ].join("\n")));
  const es = q.lang === "es";
  send(sendCustomerEmail(env, q.email, "PainterSelect", co.notify_email, es ? `Su solicitud de pintura: ${co.name}` : `Your painting request: ${co.name}`, (es
    ? [`Hola ${q.name.split(" ")[0]},`, "", `Gracias por usar PainterSelect. Enviamos su solicitud a ${co.name}, que trabaja en ${q.place}. Le contactarán pronto.`, "", "Puede responder a este correo para escribirles directamente.", "", "PainterSelect"]
    : [`Hi ${q.name.split(" ")[0]},`, "", `Thanks for using PainterSelect. We sent your request to ${co.name}, who serves ${q.place}. They will contact you soon.`, "", "You can reply to this email to write to them directly.", "", "PainterSelect"]).join("\n")));
  return co.name;
}

/** POST /api/dir/lead: a homeowner's request from a city page. Goes to one matched member, or to the market pool. */
export async function handleDirLead(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (typeof b?.website === "string" && b.website) return json({ ok: true }); // honeypot
  const lang: Lang = b?.lang === "es" ? "es" : "en";
  const q = {
    name: str(b?.name, 100), email: str(b?.email, 200).toLowerCase(), phone: str(b?.phone, 30), zip: str(b?.zip, 10),
    service: (isDirService(b?.service) ? b.service : "interior") as DirService, sqft: Math.min(100000, Math.max(0, Math.round(Number(String(b?.sqft ?? "").replace(/[^0-9]/g, "")) || 0))),
    details: str(b?.details, 1500), place: "", lang,
  };
  if (q.name.length < 2) return json({ error: lang === "es" ? "Escriba su nombre." : "Enter your name." }, 400);
  if (!emailOk(q.email)) return json({ error: lang === "es" ? "Escriba un correo válido." : "Enter a valid email." }, 400);
  const key = str(b?.cityKey, 70);
  const city = /^[a-z]{2}-[a-z0-9-]{2,60}$/.test(key) ? await cityName(env, key) : null;
  if (!city) return json({ error: "Unknown city." }, 400);
  q.place = `${city.name}, ${city.state}`;
  // The same person asking twice in a day is sent to the same place once.
  const dupe = await env.DB.prepare("SELECT 1 FROM leads WHERE lower(email) = ? AND source = 'painterselect' AND created_at > datetime('now', '-1 day') LIMIT 1").bind(q.email).first();
  if (dupe) return json({ ok: true, duplicate: true });

  const members = (await membersIn(env, key)).filter((m) => offers(m, q.service));
  const today = todayLocal();
  const state = new Map<number, RouteState>();
  for (const m of members) {
    const s = parse(await getKv(env, routeKey(m.id)));
    if (s && typeof s.day === "string") state.set(m.id, s);
  }
  const pick = pickMember(members, state, today);
  if (pick) {
    await setKv(env, routeKey(pick.id), JSON.stringify(bumpRoute(state.get(pick.id), today, new Date().toISOString())));
    const name = await deliverLead(env, ctx, pick.id, q);
    if (name) return json({ ok: true, painter: name });
  }
  const poolId = `dirpool:${new Date().toISOString()}:${crypto.randomUUID().slice(0, 6)}`;
  await setKv(env, poolId, JSON.stringify({ ...q, cityKey: key, at: new Date().toISOString() }));
  const send = sendLeadEmail(env, env.NOTIFY_EMAIL, `PainterSelect pool lead: ${q.place}`, [`No member could take this request, so it is in the market pool (admin, Directory).`, "", `Name: ${q.name}`, `Email: ${q.email}`, `Phone: ${q.phone || "n/a"}`, `City: ${q.place}`, `Job: ${q.service}${q.sqft ? `, about ${q.sqft} sq ft` : ""}`, `Notes: ${q.details || "none"}`].join("\n"));
  if (ctx) ctx.waitUntil(send);
  else await send;
  return json({ ok: true, pooled: true });
}

/** POST /api/dir/claim: someone claims a listing. Opens a free account right away; the listing changes after admin confirms. */
export async function handleDirClaim(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (typeof b?.website === "string" && b.website) return json({ ok: true });
  const es = b?.lang === "es";
  const f = await findListing(env, str(b?.id, 10));
  if (!f) return json({ error: "Listing not found." }, 404);
  if (f.l.claim && f.l.claim.status !== "rejected") return json({ error: es ? "Esta ficha ya fue reclamada." : "This listing was already claimed." }, 409);
  const email = str(b?.email, 200).toLowerCase();
  const name = str(b?.name, 100);
  const phone = str(b?.phone, 30);
  if (!name || !emailOk(email) || phone.replace(/\D/g, "").length < 10 || !b?.own) return json({ error: es ? "Complete todos los campos." : "Fill in every field." }, 400);
  const r = await provisionClient(env, "https://paintersmax.app", { name: f.l.name, email, plan: "free" });
  if (!r.ok) return json({ error: r.error }, 400);
  f.l.claim = { companyId: r.companyId, email, status: "pending", at: new Date().toISOString() };
  await setKv(env, f.key, JSON.stringify(f.l));
  const send = sendLeadEmail(env, env.NOTIFY_EMAIL, `PainterSelect claim to confirm: ${f.l.name} (${f.l.city})`, [`${name} (${email}, ${phone}) claimed the listing "${f.l.name}" in ${f.l.city}, ${f.l.state}.`, `Listed phone: ${f.l.phone || "none"}. Call it to confirm, then approve in admin, Directory.`, r.created ? "A free PaintersMax account was opened for them." : "The email already had a PaintersMax account."].join("\n"));
  if (ctx) ctx.waitUntil(send);
  else await send;
  return json({ ok: true });
}

/** GET/POST /api/dir/me: the signed-in painter's own directory status, and the opt-out switch. */
export async function handleDirMe(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const co = await env.DB.prepare("SELECT id, slug, plan FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; slug: string; plan: string }>();
  if (!co) return json({ error: "Not found." }, 404);
  const ms = readMember(await getKv(env, memberKey(co.id)));
  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const next: MemberSettings = { ...ms };
    if (b?.optOut) next.optOut = true;
    else delete next.optOut;
    await setKv(env, memberKey(co.id), JSON.stringify(next));
    return json({ ok: true });
  }
  const { door } = await loadDoor(env, co.id, co.plan);
  const prof = parse((await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(co.id).first<{ data: string }>())?.data ?? null) ?? {};
  const keys: string[] = Array.isArray(prof?.cityKeys) ? prof.cityKeys : [];
  const cities = (await Promise.all(keys.map(async (k) => ({ k, c: await cityName(env, k) })))).filter((r) => r.c).map((r) => ({ name: r.c!.name, state: r.c!.state, url: `https://${DIR_HOST}/painters/${dirCitySlug(r.c!.name, r.c!.state)}` }));
  const r = parse(await getKv(env, routeKey(co.id)));
  const leads = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE company_id = ? AND source = 'painterselect'").bind(co.id).first<{ n: number }>();
  return json({ member: door !== "free", optOut: !!ms.optOut, founding: !!ms.founding, cap: ms.cap ?? DEFAULT_DAILY_CAP, profileUrl: `https://${DIR_HOST}/pro/${co.slug}`, cities, leadsToday: r?.day === todayLocal() ? r.count : 0, leadsTotal: leads?.n ?? 0 });
}

// ------------------------------------------------------------------ admin

/**
 * GET  /api/dir/admin  listings, claims waiting, members and the market pool.
 * POST {action}: listing_add | listing_import | listing_delete | claim_approve | claim_reject | member_set | pool_assign | pool_delete
 */
export async function handleDirAdmin(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const me = await env.DB.prepare("SELECT slug FROM companies WHERE id = ?").bind(user.companyId).first<{ slug: string }>();
  if (me?.slug !== ADMIN_COMPANY_SLUG) return json({ error: "Not found." }, 404);
  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const a = String(b?.action ?? "");
    const allIn = async (k: string) => (await listingsIn(env, k)).map((r) => r.l);
    if (a === "listing_add") {
      const l = cleanListing({ ...b.listing, source: "admin" });
      if (!l) return json({ error: "A listing needs a name, a city and a 2-letter state." }, 400);
      if ((await allIn(l.cityKey)).some((o) => isDuplicate(o, l))) return json({ error: "That business is already listed in this city." }, 409);
      await setKv(env, listingKey(l), JSON.stringify(l));
      return json({ ok: true, listing: l });
    }
    if (a === "listing_import") {
      const { listings, skipped } = parseImport(String(b?.text ?? "").slice(0, 300000), str(b?.source, 60) || "import");
      let added = 0, dupes = 0;
      const byCity = new Map<string, Listing[]>();
      for (const l of listings) {
        if (!byCity.has(l.cityKey)) byCity.set(l.cityKey, await allIn(l.cityKey));
        const have = byCity.get(l.cityKey)!;
        if (have.some((o) => isDuplicate(o, l))) { dupes++; continue; }
        have.push(l);
        await setKv(env, listingKey(l), JSON.stringify(l));
        added++;
      }
      return json({ ok: true, added, duplicates: dupes, skipped });
    }
    const key = str(b?.key, 120);
    if (a === "listing_delete") {
      if (!key.startsWith("dirl:")) return json({ error: "Listing not found." }, 404);
      await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(key).run();
      return json({ ok: true });
    }
    if (a === "claim_approve" || a === "claim_reject") {
      const l = key.startsWith("dirl:") ? cleanListing(parse(await getKv(env, key))) : null;
      if (!l?.claim) return json({ error: "Claim not found." }, 404);
      l.claim.status = a === "claim_approve" ? "approved" : "rejected";
      await setKv(env, key, JSON.stringify(l));
      return json({ ok: true });
    }
    if (a === "member_set") {
      const id = Number(b?.companyId);
      if (!Number.isInteger(id)) return json({ error: "Client not found." }, 404);
      const cur = readMember(await getKv(env, memberKey(id)));
      const next = readMember({ ...cur, ...(b.founding !== undefined ? { founding: !!b.founding } : {}), ...(b.cap !== undefined ? { cap: Number(b.cap) } : {}), ...(b.optOut !== undefined ? { optOut: !!b.optOut } : {}) });
      await setKv(env, memberKey(id), JSON.stringify(next));
      return json({ ok: true, member: next });
    }
    if (a === "pool_assign" || a === "pool_delete") {
      if (!key.startsWith("dirpool:")) return json({ error: "Lead not found." }, 404);
      const p = parse(await getKv(env, key));
      if (!p) return json({ error: "Lead not found." }, 404);
      if (a === "pool_assign") {
        const name = await deliverLead(env, ctx, Number(b?.companyId), { name: p.name, email: p.email, phone: p.phone ?? "", zip: p.zip ?? "", service: isDirService(p.service) ? p.service : "interior", sqft: Number(p.sqft) || 0, details: p.details ?? "", place: p.place ?? "", lang: p.lang === "es" ? "es" : "en" }, true);
        if (!name) return json({ error: "Client not found." }, 404);
      }
      await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(key).run();
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  }
  const rows = (await env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'dirl:%' ORDER BY key LIMIT 3000").all<{ key: string; value: string }>()).results ?? [];
  const listings = rows.map((r) => ({ key: r.key, ...cleanListing(parse(r.value))! })).filter((l) => l.name);
  const pool = ((await env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'dirpool:%' ORDER BY key DESC LIMIT 200").all<{ key: string; value: string }>()).results ?? []).map((r) => ({ key: r.key, ...parse(r.value) }));
  const members = await membersIn(env, null);
  const memberRows = await Promise.all(members.map(async (m) => {
    const r = parse(await getKv(env, routeKey(m.id)));
    return { id: m.id, name: m.name, slug: m.slug, founding: m.founding, cap: m.cap, insured: m.insured, cities: m.cityKeys.length, leadsToday: r?.day === todayLocal() ? r.count : 0 };
  }));
  const companies = ((await env.DB.prepare("SELECT id, name FROM companies WHERE id IN (" + (listings.filter((l) => l.claim).map((l) => Number(l.claim!.companyId)).join(",") || "0") + ")").all<{ id: number; name: string }>()).results ?? []);
  return json({
    listings, pool, members: memberRows,
    claims: listings.filter((l) => l.claim?.status === "pending").map((l) => ({ ...l, accountName: companies.find((c) => c.id === l.claim!.companyId)?.name ?? null })),
    seedCities: SEED_CITIES.map(([n, s]) => `${n}, ${s}`),
  });
}
