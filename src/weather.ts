import { readBlob, updateBlob } from "./kv.ts";
import { geocode } from "./cities.ts";
import type { Env } from "./types.ts";

/**
 * "Painting weather" for a painter's website: the next days, each marked a good or poor day to paint outside.
 * Data: Google Maps Platform Weather API (the same server key as geocoding, GOOGLE_MAPS_SERVER_KEY, with the
 * "Weather API" turned on for that Google Cloud project). It answers in Celsius and km/h; we show Fahrenheit and mph.
 * Each place is looked up at most once an hour (cached), so visitors never run up the bill.
 * A painter may show at most 2 places on a site.
 */

export { MAX_WEATHER_PLACES } from "./sitecore.ts";
export const NEW_PLACES_PER_DAY = 300;
export const WEATHER_TTL_MS = 60 * 60 * 1000;

export interface Day {
  date: string; // YYYY-MM-DD
  hiF: number; loF: number;
  rain: number; // percent chance in the daytime
  windMph: number; humidity: number;
  text: string;
  good: boolean;
  why: string; // en: short reason when not good
  whyEs: string;
}

const cToF = (c: number) => Math.round((c * 9) / 5 + 32);
const toMph = (v: number, unit: string) => Math.round(unit === "MILES_PER_HOUR" ? v : v * 0.621371);
const pad = (n: number) => String(n).padStart(2, "0");

/** Outside painting rule of thumb: 50-90 F, under 30% rain, wind under 15 mph, humidity under 85%. */
export function paintingDay(hiF: number, loF: number, rain: number, windMph: number, humidity: number): { good: boolean; why: string; whyEs: string } {
  if (rain >= 30) return { good: false, why: "Rain likely", whyEs: "Probable lluvia" };
  if (hiF > 90) return { good: false, why: "Too hot", whyEs: "Demasiado calor" };
  if (loF < 40 || hiF < 50) return { good: false, why: "Too cold", whyEs: "Demasiado frío" };
  if (windMph >= 15) return { good: false, why: "Too windy", whyEs: "Mucho viento" };
  if (humidity >= 85) return { good: false, why: "Too humid", whyEs: "Mucha humedad" };
  return { good: true, why: "", whyEs: "" };
}

export function parseForecast(j: any, max = 5): Day[] {
  const out: Day[] = [];
  for (const d of Array.isArray(j?.forecastDays) ? j.forecastDays : []) {
    const dd = d?.displayDate;
    if (!dd?.year || !dd?.month || !dd?.day) continue;
    const day = d.daytimeForecast ?? {};
    const hiC = Number(d?.maxTemperature?.degrees), loC = Number(d?.minTemperature?.degrees);
    if (!Number.isFinite(hiC) || !Number.isFinite(loC)) continue;
    const unitF = d?.maxTemperature?.unit === "FAHRENHEIT";
    const hiF = unitF ? Math.round(hiC) : cToF(hiC), loF = unitF ? Math.round(loC) : cToF(loC);
    const rain = Math.round(Number(day?.precipitation?.probability?.percent) || 0);
    const w = day?.wind?.speed;
    const windMph = toMph(Number(w?.value) || 0, String(w?.unit ?? "KILOMETERS_PER_HOUR"));
    const humidity = Math.round(Number(day?.relativeHumidity) || 0);
    const v = paintingDay(hiF, loF, rain, windMph, humidity);
    out.push({ date: `${dd.year}-${pad(dd.month)}-${pad(dd.day)}`, hiF, loF, rain, windMph, humidity, text: String(day?.weatherCondition?.description?.text ?? "").slice(0, 40), ...v });
    if (out.length >= max) break;
  }
  return out;
}

export interface Forecast { place: string; at: string; days: Day[] }

const keyOf = (place: string) => `wx:${place.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}`;
const clean = (raw: unknown): Forecast | null => (raw && typeof (raw as any).at === "string" && Array.isArray((raw as any).days) ? (raw as Forecast) : null);

export async function forecastFor(env: Env, place: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; f: Forecast } | { ok: false; error: string; status: number }> {
  const p = place.replace(/\s+/g, " ").trim().slice(0, 80);
  if (p.length < 3) return { ok: false, error: "Add a city.", status: 400 };
  if (!env.GOOGLE_MAPS_SERVER_KEY) return { ok: false, error: "Weather is not turned on yet.", status: 503 };
  const key = keyOf(p);
  const hit = await readBlob(env, key, clean);
  if (hit && Date.now() - Date.parse(hit.at) < WEATHER_TTL_MS) return { ok: true, f: hit };
  // A public address: cap brand-new places per day so nobody can run up the Google bill with made-up cities.
  const cap = await updateBlob(env, `wx:cap:${new Date().toISOString().slice(0, 10)}`, (raw: any) => Math.max(0, Number(raw) || 0), (n) => (n >= NEW_PLACES_PER_DAY ? { error: "cap" } : { value: n + 1 }));
  if (!cap.ok) return { ok: false, error: "Weather is resting for today.", status: 429 };
  const g = await geocode(env, p).catch(() => null);
  if (!g) return { ok: false, error: "We could not find that place.", status: 404 };
  const url = `https://weather.googleapis.com/v1/forecast/days:lookup?key=${env.GOOGLE_MAPS_SERVER_KEY}&location.latitude=${g.lat}&location.longitude=${g.lng}&days=5`;
  const res = await fetchImpl(url).catch(() => null);
  if (!res || !res.ok) return { ok: false, error: hit ? "Showing the last forecast." : "Weather did not answer. Try again soon.", status: 502 };
  const f: Forecast = { place: p, at: new Date().toISOString(), days: parseForecast(await res.json().catch(() => null)) };
  if (!f.days.length) return { ok: false, error: "No forecast for that place.", status: 502 };
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, JSON.stringify(f)).run();
  return { ok: true, f };
}

/** GET /api/weather?place=Tyler, TX  (public: it only reveals the weather). Limited to a short place name. */
export async function handleWeather(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Not found.", { status: 404 });
  const place = new URL(request.url).searchParams.get("place") ?? "";
  const r = await forecastFor(env, place);
  const h = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=900" };
  return r.ok ? new Response(JSON.stringify(r.f), { headers: h }) : new Response(JSON.stringify({ error: r.error }), { status: r.status, headers: { ...h, "cache-control": "no-store" } });
}
