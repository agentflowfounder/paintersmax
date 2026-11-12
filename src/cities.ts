import { getSessionUser } from "./auth.ts";
import { PROFILE_CAPS, RADIUS_MILES, sanitizeProfile } from "./profile.ts";
import { normalizePlan } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Cities: where a painter works, plus shared facts about each city.
 * Google (server key) turns an address or ZIP into coordinates, saved once per city.
 * Census public data gives population, housing, business counts and new-construction permits, saved once per city for ALL clients
 * and refreshed on a schedule (facts about every 12 months, construction every 6 months).
 * Census calls were written from the public documentation and could not be run from the build sandbox: every parser is tolerant
 * and returns null for anything it cannot read, so a page simply leaves that fact out. Nothing is ever invented.
 */

export const FACTS_MAX_AGE_DAYS = 365;
export const CONSTRUCTION_MAX_AGE_DAYS = 183;

export const STATE_FIPS: Record<string, string> = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
export const cityKey = (name: string, state: string) => `${state.toLowerCase()}-${slug(name)}`;
export const citySlug = (name: string, state: string) => `${slug(name)}-${state.toLowerCase()}`;

export function miles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface City {
  key: string;
  name: string;
  state: string;
  lat: number | null;
  lng: number | null;
  stateFips?: string | null;
  placeFips?: string | null;
  countyFips?: string | null;
  zip?: string | null;
}

/** Reads a Google Geocoding response into a city. Returns null when there is no usable result. */
export function parseGeocode(j: any): (City & { zip: string | null }) | null {
  const r = j?.status === "OK" ? j?.results?.[0] : null;
  if (!r?.geometry?.location) return null;
  const comp = (type: string, short = false) => {
    const c = (r.address_components ?? []).find((x: any) => (x.types ?? []).includes(type));
    return c ? String(short ? c.short_name : c.long_name) : "";
  };
  const name = comp("locality") || comp("sublocality") || comp("postal_town") || comp("administrative_area_level_3");
  const state = comp("administrative_area_level_1", true);
  if (!name || !/^[A-Z]{2}$/.test(state)) return null;
  const lat = Number(r.geometry.location.lat);
  const lng = Number(r.geometry.location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { key: cityKey(name, state), name, state, lat, lng, zip: comp("postal_code") || null };
}

export async function geocode(env: Env, query: string): Promise<(City & { zip: string | null }) | null> {
  if (!env.GOOGLE_MAPS_SERVER_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:US&key=${env.GOOGLE_MAPS_SERVER_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return parseGeocode(await res.json());
}

/** Census place rows from the TIGERweb service. Tolerant: skips anything without a name, state and coordinates. */
export function parseTigerPlaces(j: any): (City & { pop: number | null })[] {
  const out: (City & { pop: number | null })[] = [];
  for (const f of j?.features ?? []) {
    const a = f?.attributes ?? {};
    const name = String(a.BASENAME ?? a.NAME ?? "").trim();
    const st = STATE_FIPS[String(a.STATE ?? "").padStart(2, "0")];
    const lat = Number(a.CENTLAT ?? a.INTPTLAT);
    const lng = Number(a.CENTLON ?? a.INTPTLON);
    if (!name || !st || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const pop = Number(a.POP100);
    out.push({ key: cityKey(name, st), name, state: st, lat, lng, stateFips: String(a.STATE).padStart(2, "0"), placeFips: a.PLACE ? String(a.PLACE).padStart(5, "0") : null, pop: Number.isFinite(pop) ? pop : null });
  }
  return out;
}

const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer";
let placeLayer: number | null = null;

/** Incorporated places within a radius of a point, nearest first. Best effort: returns [] when the Census service does not answer. */
export async function nearbyPlaces(lat: number, lng: number, radiusMiles: number): Promise<(City & { pop: number | null; miles: number })[]> {
  try {
    if (placeLayer === null) {
      const meta: any = await (await fetch(`${TIGER}?f=json`)).json();
      const l = (meta?.layers ?? []).find((x: any) => /incorporated places/i.test(String(x.name)));
      if (!l) return [];
      placeLayer = Number(l.id);
    }
    const q = new URLSearchParams({
      geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      distance: String(Math.round(radiusMiles * 1609.34)), units: "esriSRUnit_Meter",
      outFields: "BASENAME,NAME,STATE,PLACE,CENTLAT,CENTLON,POP100", returnGeometry: "false", resultRecordCount: "300", f: "json",
    });
    const j = await (await fetch(`${TIGER}/${placeLayer}/query?${q}`)).json();
    return parseTigerPlaces(j)
      .map((c) => ({ ...c, miles: miles(lat, lng, c.lat!, c.lng!) }))
      .filter((c) => c.miles <= radiusMiles)
      .sort((a, b) => a.miles - b.miles);
  } catch (err) {
    console.error("nearby places failed", String(err));
    return [];
  }
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > -1_000_000 ? n : null; // Census uses large negative numbers for "not available"
};

export interface CityFacts {
  population: number | null;
  households: number | null;
  housingUnits: number | null;
  ownerOccupied: number | null;
  renterOccupied: number | null;
  medianHomeValue: number | null;
  medianYearBuilt: number | null;
  medianHouseholdIncome: number | null;
  businesses: { label: string; establishments: number }[];
  source: string;
}

/** Reads a Census data API response (a header row, then rows) into rows of {column: value}. */
export function censusRows(j: unknown): Record<string, string>[] {
  if (!Array.isArray(j) || j.length < 2 || !Array.isArray(j[0])) return [];
  const head = j[0] as string[];
  return (j as unknown[][]).slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? "")])));
}

const ACS_VARS = ["B01003_001E", "B11001_001E", "B25001_001E", "B25003_002E", "B25003_003E", "B25077_001E", "B25035_001E", "B19013_001E"];
export function parseAcs(j: unknown): Omit<CityFacts, "businesses" | "source"> | null {
  const r = censusRows(j)[0];
  if (!r) return null;
  return {
    population: num(r.B01003_001E), households: num(r.B11001_001E), housingUnits: num(r.B25001_001E), ownerOccupied: num(r.B25003_002E),
    renterOccupied: num(r.B25003_003E), medianHomeValue: num(r.B25077_001E), medianYearBuilt: num(r.B25035_001E), medianHouseholdIncome: num(r.B19013_001E),
  };
}

/** Sectors of businesses that could need painting. NAICS sector codes. */
export const BUSINESS_SECTORS: [string, string][] = [["44-45", "Retail stores"], ["53", "Real estate and rental"], ["54", "Offices and professional services"], ["62", "Health care"], ["72", "Restaurants and lodging"]];
export function parseCbp(rows: Record<string, string>[], label: string): { label: string; establishments: number } | null {
  const r = rows[0];
  const n = r ? num(r.ESTAB) : null;
  return n !== null && n >= 0 ? { label, establishments: n } : null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/** County and place codes for a point, from the Census geocoder. */
export async function censusCodes(lat: number, lng: number): Promise<{ stateFips: string; countyFips: string; placeFips: string | null } | null> {
  const j: any = await getJson(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`);
  const g = j?.result?.geographies;
  const county = g?.Counties?.[0];
  const place = (g?.["Incorporated Places"] ?? g?.["Census Designated Places"])?.[0];
  if (!county?.STATE || !county?.COUNTY) return null;
  return { stateFips: String(county.STATE), countyFips: String(county.COUNTY), placeFips: place?.PLACE ? String(place.PLACE) : null };
}

/** Population, housing and business counts for a city. Any piece Census does not return is left null or out. */
export async function fetchFacts(c: { stateFips: string; placeFips: string | null; countyFips: string | null }): Promise<CityFacts | null> {
  let acs: Omit<CityFacts, "businesses" | "source"> | null = null;
  let vintage = "";
  if (c.placeFips) {
    for (const y of [2024, 2023]) {
      acs = parseAcs(await getJson(`https://api.census.gov/data/${y}/acs/acs5?get=${ACS_VARS.join(",")}&for=place:${c.placeFips}&in=state:${c.stateFips}`));
      if (acs) {
        vintage = `American Community Survey ${y - 4}-${y} estimates`;
        break;
      }
    }
  }
  const businesses: CityFacts["businesses"] = [];
  if (c.countyFips) {
    for (const [code, label] of BUSINESS_SECTORS) {
      const rows = censusRows(await getJson(`https://api.census.gov/data/2022/cbp?get=ESTAB&for=county:${c.countyFips}&in=state:${c.stateFips}&NAICS2017=${code}`));
      const b = parseCbp(rows, label);
      if (b) businesses.push(b);
    }
  }
  if (!acs && !businesses.length) return null;
  const empty = { population: null, households: null, housingUnits: null, ownerOccupied: null, renterOccupied: null, medianHomeValue: null, medianYearBuilt: null, medianHouseholdIncome: null };
  return { ...(acs ?? empty), businesses, source: [vintage, businesses.length ? "County Business Patterns 2022 (county level)" : ""].filter(Boolean).join("; ") };
}

const REGION_BY_STATE: Record<string, string> = {};
for (const [r, list] of Object.entries({ ne: "09 23 25 33 34 36 42 44 50", mw: "17 18 19 20 26 27 29 31 38 39 46 55", so: "01 05 10 11 12 13 21 22 24 28 37 40 45 47 48 51 54", we: "02 04 06 08 15 16 30 32 35 41 49 53 56" })) for (const s of list.split(" ")) REGION_BY_STATE[s] = r;
const REGION_DIR: Record<string, string> = { ne: "Northeast Region", mw: "Midwest Region", so: "South Region", we: "West Region" };

/** New residential building permits for a place, from the Census Building Permits Survey annual file. Returns null when the file or row is not readable. */
export function parsePermits(text: string, stateFips: string, placeFips: string): { year: number | null; buildings: number; units: number } | null {
  const lines = text.split(/\r?\n/).filter(Boolean);
  // The file has two header lines, then comma-separated rows. Column positions come from the first header line.
  const head = (lines[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
  const iState = head.findIndex((h) => h.startsWith("state"));
  const iPlace = head.findIndex((h) => h.includes("fips") && h.includes("place"));
  if (iState < 0 || iPlace < 0) return null;
  for (const line of lines.slice(2)) {
    const c = line.split(",").map((x) => x.trim());
    if (c[iState]?.padStart(2, "0") === stateFips && c[iPlace]?.padStart(5, "0") === placeFips) {
      // Buildings and units for 1 unit, 2 units, 3-4 units, 5+ units follow the place columns in groups of three (bldgs, units, value).
      const tail = c.slice(-12).map((x) => Number(x.replace(/[^0-9.-]/g, "")));
      if (tail.length < 12 || tail.some((n) => !Number.isFinite(n))) return null;
      const buildings = tail[0] + tail[3] + tail[6] + tail[9];
      const units = tail[1] + tail[4] + tail[7] + tail[10];
      const yr = Number(c[0]?.slice(0, 4));
      return { year: Number.isFinite(yr) && yr > 1990 ? yr : null, buildings, units };
    }
  }
  return null;
}

export async function fetchPermits(stateFips: string, placeFips: string | null): Promise<{ year: number | null; buildings: number; units: number } | null> {
  if (!placeFips) return null;
  const region = REGION_BY_STATE[stateFips];
  if (!region) return null;
  for (const y of [new Date().getUTCFullYear() - 1, new Date().getUTCFullYear() - 2]) {
    try {
      const res = await fetch(`https://www2.census.gov/econ/bps/Place/${encodeURIComponent(REGION_DIR[region])}/${region}${y}a.txt`);
      if (!res.ok) continue;
      const p = parsePermits(await res.text(), stateFips, placeFips);
      if (p) return { ...p, year: p.year ?? y };
    } catch {
      /* try the earlier year */
    }
  }
  return null;
}

export const isStale = (iso: string | null | undefined, days: number, now = Date.now()) => {
  if (!iso) return true;
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return !Number.isFinite(t) || now - t > days * 86400000;
};

interface CityRow {
  key: string; name: string; state: string; lat: number | null; lng: number | null; state_fips: string | null; place_fips: string | null; county_fips: string | null; zip: string | null;
  facts: string | null; facts_at: string | null; construction: string | null; construction_at: string | null;
}

export async function saveCity(env: Env, c: City & { zip?: string | null }) {
  await env.DB.prepare(
    `INSERT INTO cities (key, name, state, lat, lng, state_fips, place_fips, county_fips, zip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET lat = COALESCE(excluded.lat, lat), lng = COALESCE(excluded.lng, lng), state_fips = COALESCE(excluded.state_fips, state_fips),
       place_fips = COALESCE(excluded.place_fips, place_fips), county_fips = COALESCE(excluded.county_fips, county_fips), zip = COALESCE(excluded.zip, zip)`,
  ).bind(c.key, c.name, c.state, c.lat, c.lng, c.stateFips ?? null, c.placeFips ?? null, c.countyFips ?? null, c.zip ?? null).run();
}

/** Loads a city and refreshes its facts when they are missing or older than their refresh age. One city at a time, so API use stays small. */
export async function cityWithFacts(env: Env, key: string, refresh = true): Promise<{ city: CityRow; facts: CityFacts | null; construction: any } | null> {
  let row = await env.DB.prepare("SELECT * FROM cities WHERE key = ?").bind(key).first<CityRow>();
  if (!row) return null;
  if (refresh && (isStale(row.facts_at, FACTS_MAX_AGE_DAYS) || isStale(row.construction_at, CONSTRUCTION_MAX_AGE_DAYS))) {
    row = await refreshCity(env, row);
  }
  const parse = (s: string | null) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };
  return { city: row, facts: parse(row.facts), construction: parse(row.construction) };
}

export async function refreshCity(env: Env, row: CityRow): Promise<CityRow> {
  let { state_fips: sf, place_fips: pf, county_fips: cf } = row;
  if ((!sf || !cf) && row.lat != null && row.lng != null) {
    const codes = await censusCodes(row.lat, row.lng).catch(() => null);
    if (codes) {
      sf = codes.stateFips;
      cf = codes.countyFips;
      pf = pf ?? codes.placeFips;
    }
  }
  let { facts, facts_at, construction, construction_at } = row;
  if (sf && isStale(facts_at, FACTS_MAX_AGE_DAYS)) {
    const f = await fetchFacts({ stateFips: sf, placeFips: pf, countyFips: cf }).catch(() => null);
    if (f) {
      facts = JSON.stringify(f);
      facts_at = new Date().toISOString();
    }
  }
  if (sf && isStale(construction_at, CONSTRUCTION_MAX_AGE_DAYS)) {
    const p = await fetchPermits(sf, pf).catch(() => null);
    if (p) {
      construction = JSON.stringify(p);
      construction_at = new Date().toISOString();
    }
  }
  await env.DB.prepare("UPDATE cities SET state_fips = ?, place_fips = ?, county_fips = ?, facts = ?, facts_at = ?, construction = ?, construction_at = ? WHERE key = ?").bind(sf, pf, cf, facts, facts_at, construction, construction_at, row.key).run();
  return { ...row, state_fips: sf, place_fips: pf, county_fips: cf, facts, facts_at, construction, construction_at };
}

/** Cron: refresh a few cities that are past their refresh age. Small batches keep Census use light. */
export async function refreshStaleCities(env: Env, limit = 5): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM cities WHERE facts_at IS NULL OR facts_at < datetime('now','-365 days') OR construction_at IS NULL OR construction_at < datetime('now','-183 days') ORDER BY COALESCE(facts_at, '') LIMIT ?",
  ).bind(limit).all<CityRow>();
  let n = 0;
  for (const r of results ?? []) {
    await refreshCity(env, r).catch((err) => console.error("city refresh failed", r.key, String(err)));
    n++;
  }
  return n;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const parse = (s: unknown): any => {
  try {
    return typeof s === "string" ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

/** The painter's base location: their company address, geocoded once and remembered until the address changes. */
async function baseLocation(env: Env, companyId: number, company: any) {
  const addr = [company?.address, company?.city, company?.state, company?.zip].filter(Boolean).join(", ");
  if (!addr || !(company?.city || company?.zip)) return null;
  const key = `base_geo:${companyId}`;
  const cached = parse((await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>())?.value);
  if (cached?.addr === addr && Number.isFinite(cached.lat)) return cached as { addr: string; lat: number; lng: number; name: string; state: string };
  const g = await geocode(env, addr);
  if (!g || g.lat == null || g.lng == null) return null;
  const v = { addr, lat: g.lat, lng: g.lng, name: g.name, state: g.state };
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, JSON.stringify(v)).run();
  await saveCity(env, g);
  return v;
}

/**
 * GET  /api/cities            : base location, radius, nearby cities, and the painter's chosen cities.
 * GET  /api/cities?facts=<key>: facts for one city (fetched on first request, then saved for everyone).
 * POST {action:"add", query}  : look up a city by name (any plan) or ZIP (Pro only) inside the plan's radius.
 * POST {action:"save", keys}  : save the chosen cities (within the plan's city limit).
 */
export async function handleCities(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const co = await env.DB.prepare("SELECT plan FROM companies WHERE id = ?").bind(user.companyId).first<{ plan: string }>();
  const plan = normalizePlan(co?.plan);
  const profRow = await env.DB.prepare("SELECT data FROM company_profiles WHERE company_id = ?").bind(user.companyId).first<{ data: string }>();
  const profile = parse(profRow?.data);
  const radius = RADIUS_MILES[plan];
  const cap = PROFILE_CAPS[plan].cities;
  const u = new URL(request.url);

  if (request.method === "GET") {
    const factsKey = u.searchParams.get("facts");
    if (factsKey) {
      if (!/^[a-z]{2}-[a-z0-9-]{1,60}$/.test(factsKey)) return json({ error: "Not found." }, 404);
      const r = await cityWithFacts(env, factsKey);
      return r ? json({ key: factsKey, name: r.city.name, state: r.city.state, facts: r.facts, construction: r.construction }) : json({ error: "Not found." }, 404);
    }
    const configured = !!env.GOOGLE_MAPS_SERVER_KEY;
    const base = configured ? await baseLocation(env, user.companyId, profile.company ?? {}).catch(() => null) : null;
    const nearby = base ? (await nearbyPlaces(base.lat, base.lng, radius)).slice(0, 60) : [];
    for (const c of nearby) await saveCity(env, c).catch(() => undefined);
    const keys: string[] = Array.isArray(profile.cityKeys) ? profile.cityKeys : [];
    const chosen = keys.length ? (await env.DB.prepare(`SELECT key, name, state, lat, lng FROM cities WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all<any>()).results : [];
    return json({
      configured, browserKey: env.GOOGLE_MAPS_BROWSER_KEY ?? null, plan, radius, cap, zipSearch: plan === "pro",
      base: base ? { lat: base.lat, lng: base.lng, name: base.name, state: base.state } : null,
      nearby: nearby.map((c) => ({ key: c.key, name: c.name, state: c.state, lat: c.lat, lng: c.lng, miles: Math.round(c.miles), pop: c.pop })),
      chosen,
    });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (b?.action === "add") {
    const q = typeof b.query === "string" ? b.query.trim().slice(0, 80) : "";
    if (!q) return json({ error: "Type a city or ZIP code." }, 400);
    const isZip = /^\d{5}$/.test(q);
    if (isZip && plan !== "pro") return json({ error: "Choosing cities by ZIP code is on the Pro plan. You can type a city name." }, 403);
    if (!env.GOOGLE_MAPS_SERVER_KEY) return json({ error: "City lookup is not set up yet." }, 503);
    const base = await baseLocation(env, user.companyId, profile.company ?? {});
    if (!base) return json({ error: "Add your company address first (Your company info)." }, 400);
    const g = await geocode(env, isZip ? q : /,/.test(q) ? q : `${q}, ${base.state}`);
    if (!g || g.lat == null || g.lng == null) return json({ error: "I could not find that place. Try the city name and state." }, 404);
    const d = Math.round(miles(base.lat, base.lng, g.lat, g.lng));
    if (d > radius) return json({ error: `${g.name}, ${g.state} is ${d} miles away. Your plan covers up to ${radius} miles.` }, 400);
    await saveCity(env, g);
    return json({ ok: true, city: { key: g.key, name: g.name, state: g.state, lat: g.lat, lng: g.lng, miles: d } });
  }
  if (b?.action === "save") {
    const keys: string[] = Array.isArray(b.keys) ? Array.from(new Set(b.keys.filter((k: unknown): k is string => typeof k === "string" && /^[a-z]{2}-[a-z0-9-]{1,60}$/.test(k)))) as string[] : [];
    if (keys.length > cap) return json({ error: `Your plan includes up to ${cap} cities.` }, 400);
    const rows = keys.length ? (await env.DB.prepare(`SELECT key, name, state FROM cities WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all<{ key: string; name: string; state: string }>()).results : [];
    const ordered = keys.map((k) => rows.find((r) => r.key === k)).filter((r): r is { key: string; name: string; state: string } => !!r);
    const next = sanitizeProfile({ ...profile, cityKeys: ordered.map((r) => r.key), cities: ordered.map((r) => `${r.name}, ${r.state}`) }, plan);
    await env.DB.prepare(
      `INSERT INTO company_profiles (company_id, data, setup_step, completed, updated_at) VALUES (?, ?, 'cities', 0, datetime('now'))
       ON CONFLICT(company_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    ).bind(user.companyId, JSON.stringify(next)).run();
    return json({ ok: true, cityKeys: next.cityKeys, cities: next.cities });
  }
  return json({ error: "Unknown action." }, 400);
}
