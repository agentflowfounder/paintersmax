import { getSessionUser } from "./auth.ts";
import { consume, refund, usageSummary } from "./usage.ts";
import type { Env } from "./types.ts";

/**
 * Color preview (painter side): the painter picks a photo of the customer's room or house, a color and what to paint,
 * and an AI image model repaints just that surface. It is a sales aid, not a color match: screens and light change how a
 * color looks, so every result says "test a sample first and check with the paint store".
 *
 * The photo and the preview are never stored. Each preview is metered (color_repaint) and a failed one costs nothing.
 * We ship our own plain color names only. Paint brand names and numbers belong to the brands, so the painter may type
 * one as a label for their own notes, but we do not keep a brand color list.
 */

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const SURFACES = {
  walls: "the interior walls",
  ceiling: "the ceiling",
  trim: "the trim, baseboards and door and window casings",
  cabinets: "the cabinets",
  doors: "the doors",
  front_door: "the front door",
  siding: "the exterior siding or main exterior walls",
  ext_trim: "the exterior trim, fascia and window and door trim",
  garage: "the garage door",
  fence: "the fence",
} as const;
export type Surface = keyof typeof SURFACES;

/** Our own starter colors: plain names, no brand names or numbers. */
export const SWATCHES: { name: string; hex: string }[] = [
  { name: "Soft white", hex: "#F4F1EA" }, { name: "Warm white", hex: "#EFE7D8" }, { name: "Cream", hex: "#EADFC4" }, { name: "Light greige", hex: "#D8D0C2" },
  { name: "Greige", hex: "#BDB3A3" }, { name: "Warm beige", hex: "#CDB99C" }, { name: "Light gray", hex: "#D5D7D6" }, { name: "Medium gray", hex: "#A3A7A8" },
  { name: "Charcoal", hex: "#4A4D50" }, { name: "Soft black", hex: "#2B2B2D" }, { name: "Pale blue", hex: "#C9DAE4" }, { name: "Slate blue", hex: "#6F879A" },
  { name: "Navy", hex: "#263A53" }, { name: "Sage green", hex: "#A9B59B" }, { name: "Olive green", hex: "#6F7550" }, { name: "Forest green", hex: "#33483A" },
  { name: "Butter yellow", hex: "#EFD98F" }, { name: "Terracotta", hex: "#B9694A" }, { name: "Barn red", hex: "#7C2D26" }, { name: "Chocolate brown", hex: "#4E382C" },
];

export interface ColorIn {
  hex: string;
  surface: Surface;
  mime: "image/jpeg" | "image/png" | "image/webp";
  data: string; // base64, no data: prefix
}
export const MAX_IMAGE_BASE64 = 4_000_000; // about 3 MB of photo

export function cleanColorRequest(i: any): ColorIn | { error: string } {
  const hex = typeof i?.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(i.hex.trim()) ? i.hex.trim().toUpperCase() : "";
  if (!hex) return { error: "Choose a color." };
  if (!Object.hasOwn(SURFACES, String(i?.surface))) return { error: "Choose what to paint." };
  const m = typeof i?.image === "string" ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(i.image) : null;
  if (!m) return { error: "Choose a photo first." };
  if (m[2].length > MAX_IMAGE_BASE64) return { error: "That photo is too large. Try a smaller one." };
  return { hex, surface: i.surface as Surface, mime: m[1] as ColorIn["mime"], data: m[2] };
}

const rgb = (hex: string) => [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));

/** The instruction for the image model. Only the chosen surface changes; everything else must stay as it is. */
export function repaintPrompt(hex: string, surface: Surface): string {
  const [r, g, b] = rgb(hex);
  return [
    `Repaint ${SURFACES[surface]} in this photo with the paint color ${hex} (red ${r}, green ${g}, blue ${b}).`,
    "Change only that surface. Keep everything else exactly as it is: the room or house, furniture, floors, windows, plants, people, the camera angle and the framing.",
    "Keep the real lighting, shadows and texture so it looks like a true photo of the same place after painting, with an even, finished coat.",
    "Do not add or remove objects. Do not add text, labels, logos or borders. Return only the edited photo.",
  ].join(" ");
}

/** Image models to try, in order. MODEL_GEMINI_IMAGE in the Cloudflare settings goes first when it is set. */
export const IMAGE_MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"];

export type Repaint = { ok: true; mime: string; data: string; model: string } | { ok: false; why: string };

export async function repaint(env: Env, i: ColorIn): Promise<Repaint> {
  if (!env.GEMINI_API_KEY) return { ok: false, why: "no gemini key" };
  const models = [...new Set([env.MODEL_GEMINI_IMAGE, ...IMAGE_MODELS].filter(Boolean) as string[])];
  const tried: string[] = [];
  for (const model of models) {
    let r: Response;
    try {
      r = await fetch(`${env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: i.mime, data: i.data } }, { text: repaintPrompt(i.hex, i.surface) }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });
    } catch (err) {
      tried.push(`${model} network`);
      continue;
    }
    if (!r.ok) {
      let msg = "";
      try {
        msg = String(((await r.json()) as any)?.error?.message ?? "").replace(/\s+/g, " ").slice(0, 100);
      } catch {
        msg = "";
      }
      tried.push(`${model} ${r.status}${msg ? ` (${msg})` : ""}`);
      continue; // a retired or unknown model, a quota problem: try the next one
    }
    const j = (await r.json().catch(() => null)) as any;
    for (const p of j?.candidates?.[0]?.content?.parts ?? []) {
      const d = p?.inlineData ?? p?.inline_data;
      const mime = d?.mimeType ?? d?.mime_type;
      if (d?.data && typeof mime === "string" && /^image\/(png|jpeg|webp)$/.test(mime)) return { ok: true, mime, data: d.data, model };
    }
    tried.push(`${model} no image (${j?.candidates?.[0]?.finishReason ?? j?.promptFeedback?.blockReason ?? "empty"})`);
  }
  console.error("color preview failed", tried.join("; "));
  return { ok: false, why: tried.join("; ") };
}

/**
 * /api/colors (signed in)
 *  GET   the starter colors, the surfaces, and this month's previews used and allowed
 *  POST  {image: "data:image/jpeg;base64,...", hex, surface}  ->  {image: "data:image/png;base64,..."}
 */
export async function handleColors(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const co = await env.DB.prepare("SELECT id, plan, created_at AS createdAt FROM companies WHERE id = ?").bind(user.companyId).first<{ id: number; plan: string; createdAt: string }>();
  if (!co) return json({ error: "Not found." }, 404);
  if (request.method === "GET") {
    const f = (await usageSummary(env, co)).features.find((x) => x.feature === "color_repaint")!;
    return json({ swatches: SWATCHES, surfaces: Object.keys(SURFACES), used: f.used, limit: f.limit, creditUses: f.creditUses });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const i = cleanColorRequest(b);
  if ("error" in i) return json({ error: i.error }, 400);
  const u = await consume(env, co, "color_repaint");
  if (!u.allowed) {
    const msg = u.reason === "not_in_plan" ? "Color previews on a photo are not in your plan. You can still show the color next to the photo, or upgrade for previews." : u.reason === "kill_switch" ? "Color previews are paused right now. You can still show the color next to the photo." : "You have used this month's color previews. You can still show the color next to the photo, or add AI credits for more.";
    return json({ error: msg, reason: u.reason }, 429);
  }
  const out = await repaint(env, i);
  if (!out.ok) {
    await refund(env, co, "color_repaint");
    return json({ error: "The preview could not be made right now, and it did not count. Try again, or show the color next to the photo." }, 502);
  }
  return json({ image: `data:${out.mime};base64,${out.data}`, used: u.used, limit: u.limit, credit: u.credit ?? 0 });
}
