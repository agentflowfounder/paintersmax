import type { Env, QuoteRequest } from "./types.ts";

/** What the AI sees in the customer's photos. It never sets prices; only scope, effort weights and questions. */
export interface Brief {
  projectSummary: string; // 2-3 sentences, safe to show the customer
  rooms: string[]; // areas or rooms visible
  surfaces: { name: string; condition: string; prep: string; weight: number }[]; // weight = relative effort, 1-10
  materials: string[]; // e.g. "Interior eggshell, 2 gal", rough quantities only
  hours: { low: number; high: number }; // crew hours, rough
  concerns: string[]; // moisture, peeling, lead-paint age risk, repairs
  questions: string[]; // things the painter should confirm on site
  confidence: "low" | "medium" | "high";
}

const PROMPT = (q: QuoteRequest, lowD?: number, highD?: number) =>
  [
    "You are an experienced painting estimator reviewing customer photos before a site visit.",
    `Job type: ${q.jobType}. Customer-stated size: ${q.sqft ? q.sqft + " sq ft" : "not given"}. ZIP: ${q.zip ?? "n/a"}.`,
    `Customer notes: ${(q.details ?? "none").slice(0, 1000)}`,
    lowD === undefined ? "Do NOT mention or invent any prices." : `The ballpark price range ($${lowD} to $${highD}) is calculated elsewhere. Do NOT mention or invent any prices.`,
    "Describe only what you can actually see. If a photo is unclear, say so and lower your confidence.",
    "Return ONLY JSON with this shape:",
    '{"projectSummary":string(max 60 words, friendly, for the customer),"rooms":string[],"surfaces":[{"name":string,"condition":string,"prep":string,"weight":number 1-10}],"materials":string[],"hours":{"low":number,"high":number},"concerns":string[],"questions":string[],"confidence":"low"|"medium"|"high"}',
    "Keep every list under 8 items. Plain text values, no markdown.",
  ].join("\n");

function parse(text: string): Brief | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const arr = (v: unknown, n = 8) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, n).map((x: string) => x.slice(0, 200)) : []);
    const surfaces = Array.isArray(j.surfaces)
      ? j.surfaces.slice(0, 8).map((s: any) => ({
          name: String(s?.name ?? "").slice(0, 80),
          condition: String(s?.condition ?? "").slice(0, 160),
          prep: String(s?.prep ?? "").slice(0, 160),
          weight: Math.min(10, Math.max(1, Math.round(Number(s?.weight) || 1))),
        }))
      : [];
    if (!j.projectSummary || !surfaces.length) return null;
    return {
      projectSummary: String(j.projectSummary).slice(0, 500),
      rooms: arr(j.rooms),
      surfaces,
      materials: arr(j.materials),
      hours: { low: Math.max(0, Number(j.hours?.low) || 0), high: Math.max(0, Number(j.hours?.high) || 0) },
      concerns: arr(j.concerns),
      questions: arr(j.questions),
      confidence: j.confidence === "high" || j.confidence === "medium" ? j.confidence : "low",
    };
  } catch {
    return null;
  }
}

async function viaGemini(env: Env, text: string, photos: { mime: string; data: string }[]): Promise<string> {
  const model = env.MODEL_GEMINI ?? "gemini-2.5-flash";
  const call = (thinkingOff: boolean) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [{ parts: [{ text }, ...photos.map((p) => ({ inline_data: { mime_type: p.mime, data: p.data } }))] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          // Thinking tokens are billed as output and are not needed for reading photos.
          ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    });
  let r = await call(true);
  if (r.status === 400) r = await call(false); // some models do not accept the thinking setting
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const j = (await r.json()) as any;
  return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function viaOpenAI(env: Env, text: string, photos: { mime: string; data: string }[]): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.MODEL_OPENAI ?? "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text },
            ...photos.map((p) => ({ type: "image_url", image_url: { url: `data:${p.mime};base64,${p.data}` } })),
          ],
        },
      ],
    }),
  });
  if (!r.ok) throw new Error(`openai ${r.status}`);
  const j = (await r.json()) as any;
  return j.choices?.[0]?.message?.content ?? "";
}

/** Reads the photos and returns a structured brief, or null if no provider worked. */
export async function writeBrief(env: Env, q: QuoteRequest, lowCents?: number, highCents?: number): Promise<{ provider: string; brief: Brief } | null> {
  if (!q.photos?.length) return null;
  const text = PROMPT(q, lowCents === undefined ? undefined : Math.round(lowCents / 100), highCents === undefined ? undefined : Math.round(highCents / 100));
  const order: ("gemini" | "openai")[] = ["gemini", "openai"];
  for (const p of order) {
    if (p === "gemini" ? !env.GEMINI_API_KEY : !env.OPENAI_API_KEY) continue;
    try {
      const out = p === "gemini" ? await viaGemini(env, text, q.photos) : await viaOpenAI(env, text, q.photos);
      const brief = parse(out);
      if (brief) return { provider: p, brief };
    } catch (err) {
      console.error("brief provider failed", p, String(err));
    }
  }
  return null;
}

const d = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-US");

/** Splits the calculated range across surfaces by effort weight. Numbers come from pricing.ts, not the AI. */
export function draftLines(brief: Brief, lowCents: number, highCents: number) {
  const total = brief.surfaces.reduce((a, s) => a + s.weight, 0) || 1;
  return brief.surfaces.map((s) => ({
    ...s,
    low: Math.round((lowCents * s.weight) / total / 5000) * 5000,
    high: Math.round((highCents * s.weight) / total / 5000) * 5000,
  }));
}

/** Plain-text brief for the painter: what the job is, a draft estimate, and what to check on site. */
export function ownerBriefText(brief: Brief, lowCents?: number, highCents?: number): string {
  const priced = lowCents !== undefined && highCents !== undefined;
  const lines = draftLines(brief, lowCents ?? 0, highCents ?? 0);
  return [
    "AI PROJECT BRIEF (from the customer's photos; confirm everything on site)",
    `Confidence: ${brief.confidence}`,
    "",
    brief.projectSummary,
    brief.rooms.length ? `\nAreas seen: ${brief.rooms.join(", ")}` : "",
    "",
    priced ? "DRAFT ESTIMATE (ballpark split of the range shown to the customer)" : "SCOPE SEEN IN PHOTOS (no price: size was not given)",
    ...lines.map((l) => `- ${l.name}${priced ? `: ${d(l.low)} to ${d(l.high)}` : ""}\n    Condition: ${l.condition}\n    Prep: ${l.prep}`),
    priced ? `Total: ${d(lowCents!)} to ${d(highCents!)}` : "",
    brief.hours.high ? `Rough crew time: ${brief.hours.low} to ${brief.hours.high} hours` : "",
    brief.materials.length ? `\nMATERIALS (rough)\n${brief.materials.map((m) => "- " + m).join("\n")}` : "",
    brief.concerns.length ? `\nWATCH OUT FOR\n${brief.concerns.map((m) => "- " + m).join("\n")}` : "",
    brief.questions.length ? `\nASK ON SITE\n${brief.questions.map((m) => "- " + m).join("\n")}` : "",
    "\nThis brief is AI-generated from photos and is not a firm quote.",
  ]
    .filter((x) => x !== "")
    .join("\n");
}
