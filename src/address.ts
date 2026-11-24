import { getSessionUser } from "./auth.ts";
import type { Env } from "./types.ts";

/**
 * Address lookup for the New bid screen.
 *  GET /api/address?q=123 Main&s=<session token>  -> { configured, suggestions: [{ id, text }] }
 *  GET /api/address?place=<id>&s=<session token> -> { address, city, state, zip }
 * Uses Google Places (New) with the server key, so the key never reaches a browser.
 * With no key it answers { configured: false } and the screen falls back to its own city list.
 */

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export interface AddressParts {
  address: string;
  city: string;
  state: string;
  zip: string;
}

/** Turns Google's address pieces into the four fields the job keeps. */
export function partsFromComponents(components: unknown): AddressParts {
  const list = Array.isArray(components) ? components : [];
  const get = (type: string, short = false) => {
    const c = list.find((x: any) => Array.isArray(x?.types) && x.types.includes(type));
    return c ? String((short ? c.shortText : c.longText) ?? "").trim() : "";
  };
  const street = [get("street_number"), get("route")].filter(Boolean).join(" ");
  const unit = get("subpremise");
  return {
    address: (unit ? `${street} #${unit}` : street).slice(0, 160),
    city: (get("locality") || get("sublocality") || get("postal_town") || get("administrative_area_level_3")).slice(0, 60),
    state: get("administrative_area_level_1", true).slice(0, 2).toUpperCase(),
    zip: get("postal_code").slice(0, 10),
  };
}

/** Splits an address typed on one line ("123 Main St, Dallas, TX 75201") into its fields. Used when no lookup service is set up. */
export function splitOneLine(line: string): AddressParts | null {
  const m = /^\s*(.+?),\s*([^,]+?),?\s+([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?\s*$/.exec(String(line ?? ""));
  if (!m) return null;
  return { address: m[1].trim().slice(0, 160), city: m[2].trim().slice(0, 60), state: m[3].toUpperCase(), zip: m[4] };
}

const token = (s: string | null) => (s && /^[A-Za-z0-9-]{8,64}$/.test(s) ? s : undefined);

export async function handleAddress(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const key = env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return json({ configured: false, suggestions: [] });
  const url = new URL(request.url);
  const base = env.PLACES_API_BASE ?? "https://places.googleapis.com";
  const s = token(url.searchParams.get("s"));
  const place = url.searchParams.get("place");
  try {
    if (place) {
      if (!/^[A-Za-z0-9_-]{10,300}$/.test(place)) return json({ error: "Unknown place." }, 400);
      const r = await fetch(`${base}/v1/places/${place}${s ? `?sessionToken=${s}` : ""}`, { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "addressComponents" } });
      if (!r.ok) return json({ error: "Could not look up that address." }, 502);
      const j = (await r.json()) as any;
      return json(partsFromComponents(j.addressComponents));
    }
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
    if (q.length < 4) return json({ configured: true, suggestions: [] });
    const r = await fetch(`${base}/v1/places:autocomplete`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({ input: q, includedRegionCodes: ["us"], ...(s ? { sessionToken: s } : {}) }),
    });
    if (!r.ok) return json({ configured: true, suggestions: [], error: "lookup failed" });
    const j = (await r.json()) as any;
    const suggestions = (Array.isArray(j.suggestions) ? j.suggestions : [])
      .map((x: any) => x?.placePrediction)
      .filter((p: any) => p?.placeId)
      .slice(0, 5)
      .map((p: any) => ({ id: String(p.placeId), text: String(p.text?.text ?? "").slice(0, 160) }));
    return json({ configured: true, suggestions });
  } catch {
    return json({ configured: true, suggestions: [], error: "lookup failed" });
  }
}
