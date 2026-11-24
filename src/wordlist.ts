import { getSessionUser } from "./auth.ts";
import type { Env } from "./types.ts";

/**
 * A painter's word list for voice notes. Phones mishear trade words ("sheet rock", "Sherman Williams", "estimated bed").
 * Built-in fixes plus the painter's own, applied to the words after dictation. Saved per company in app_settings.
 *  GET  /api/wordlist -> { defaults: [[heard, write]], custom: [[heard, write]] }
 *  POST /api/wordlist {custom: [[heard, write]]}
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const DEFAULT_WORDS: Array<[string, string]> = [
  ["sherman williams", "Sherwin-Williams"],
  ["sherwin williams", "Sherwin-Williams"],
  ["benjamin more", "Benjamin Moore"],
  ["bear paint", "Behr paint"],
  ["kills primer", "Kilz primer"],
  ["sheet rock", "Sheetrock"],
  ["dry wall", "drywall"],
  ["base board", "baseboard"],
  ["base boards", "baseboards"],
  ["knock down", "knockdown"],
  ["primmer", "primer"],
  ["estimated bed", "estimate bid"],
  ["estimate bed", "estimate bid"],
  ["pressure washer", "pressure washing"],
  ["spackling", "spackle"],
];

export const MAX_CUSTOM = 60;

/** Keeps only well-formed pairs: short, no angle brackets. */
export function cleanWords(raw: unknown): Array<[string, string]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const p of raw) {
    if (!Array.isArray(p)) continue;
    const a = String(p[0] ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40);
    const b = String(p[1] ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!a || !b || a === b.toLowerCase() || seen.has(a)) continue;
    seen.add(a);
    out.push([a, b]);
    if (out.length >= MAX_CUSTOM) break;
  }
  return out;
}

/** Applies the pairs (whole words, any capitals) to a piece of dictated text. The server copy is used by tests and the quick price. */
export function applyWords(text: string, pairs: Array<[string, string]>): string {
  let t = text;
  for (const [a, b] of pairs) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
    t = t.replace(re, (_m, pre) => pre + b);
  }
  return t;
}

export async function handleWordList(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const key = `wordlist:${user.companyId}`;
  if (request.method === "POST") {
    const b: any = await request.json().catch(() => null);
    const custom = cleanWords(b?.custom);
    await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, JSON.stringify(custom)).run();
    return json({ ok: true, custom });
  }
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  let custom: Array<[string, string]> = [];
  try { custom = cleanWords(row ? JSON.parse(row.value) : []); } catch { custom = []; }
  return json({ defaults: DEFAULT_WORDS, custom });
}
