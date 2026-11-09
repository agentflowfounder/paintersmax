import type { Env, JobType, Provider, QuoteRequest } from "./types.ts";

/** Which provider handles which kind of job. Edit here, or later move to per-company settings. */
export function pickProviders(req: QuoteRequest): Provider[] {
  let order: Provider[];
  if (req.jobType === "commercial" || req.jobType === "multifamily") order = ["anthropic", "openai", "gemini"];
  else if (req.photoUrls && req.photoUrls.length > 0) order = ["openai", "gemini", "anthropic"];
  else order = ["gemini", "openai", "anthropic"];
  return order;
}

const keyFor = (env: Env, p: Provider) =>
  p === "anthropic" ? env.ANTHROPIC_API_KEY : p === "openai" ? env.OPENAI_API_KEY : env.GEMINI_API_KEY;

function prompt(req: QuoteRequest, low: number, high: number): string {
  return [
    "You write short, friendly painting-estimate summaries for a painting company's customers.",
    `Job type: ${req.jobType}. Size: ${req.sqft} sq ft. ZIP: ${req.zip ?? "n/a"}.`,
    `Customer notes: ${(req.details ?? "none").slice(0, 1000)}`,
    `The price range is already calculated: $${low} to $${high}. Do NOT change or invent other prices.`,
    "In under 90 words: explain what the range likely covers, name 2 things that could move the price, and invite them to book a free on-site estimate.",
    "Plain text only, no markdown.",
  ].join("\n");
}

async function callGemini(env: Env, text: string): Promise<string> {
  const model = env.MODEL_GEMINI ?? "gemini-flash-latest";
  const call = (thinkingOff: boolean) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        // A 90-word summary does not need thinking tokens (they are billed as output).
        generationConfig: { ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}), maxOutputTokens: 400 },
      }),
    });
  let r = await call(true);
  if (r.status === 400) r = await call(false);
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const j = (await r.json()) as any;
  return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callOpenAI(env: Env, text: string): Promise<string> {
  const model = env.MODEL_OPENAI ?? "gpt-4.1-mini";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
  });
  if (!r.ok) throw new Error(`openai ${r.status}`);
  const j = (await r.json()) as any;
  return j.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(env: Env, text: string): Promise<string> {
  const model = env.MODEL_ANTHROPIC ?? "claude-sonnet-5-5";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: "user", content: text }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}`);
  const j = (await r.json()) as any;
  return j.content?.[0]?.text ?? "";
}

const CALLERS = { gemini: callGemini, openai: callOpenAI, anthropic: callAnthropic } as const;

const dollars = (cents: number) => Math.round(cents / 100).toLocaleString("en-US");

/** Tries providers in priority order; falls back to a canned summary (demo) if no key works. */
export async function writeSummary(
  env: Env,
  req: QuoteRequest,
  lowCents: number,
  highCents: number,
): Promise<{ provider: Provider | "demo"; summary: string }> {
  const text = prompt(req, Number(dollars(lowCents).replace(/,/g, "")), Number(dollars(highCents).replace(/,/g, "")));
  for (const p of pickProviders(req)) {
    if (!keyFor(env, p)) continue;
    try {
      const out = (await CALLERS[p](env, text)).trim();
      if (out) return { provider: p, summary: out };
    } catch (err) {
      console.error("AI provider failed", p, String(err));
    }
  }
  return {
    provider: "demo",
    summary:
      `Based on ${req.sqft.toLocaleString("en-US")} sq ft of ${labelFor(req.jobType)} work, your estimated range is ` +
      `$${dollars(lowCents)} to $${dollars(highCents)}. Final price depends on surface condition, prep work and paint choice. ` +
      "Book a free on-site estimate to lock in an exact price.",
  };
}

function labelFor(j: JobType) {
  return j === "both" ? "interior and exterior" : j;
}
