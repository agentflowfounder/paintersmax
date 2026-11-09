import { getSessionUser } from "./auth.ts";
import { isTrade, METHODS, PROFILE_CAPS, sanitizeProfile, sanitizeRateData } from "./profile.ts";
import { normalizePlan } from "./usage.ts";
import type { Env } from "./types.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const parse = (s: string | null | undefined) => {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

/** Business profile and rate cards for the signed-in painter. */
export async function handleProfile(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  const company = await env.DB.prepare("SELECT id, name, plan FROM companies WHERE id = ?")
    .bind(user.companyId)
    .first<{ id: number; name: string; plan: string }>();
  if (!company) return json({ error: "Not found." }, 404);

  if (request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const profile = sanitizeProfile(body?.profile, company.plan);
    const step = typeof body?.setupStep === "string" ? body.setupStep.replace(/[^a-z_]/g, "").slice(0, 30) || "start" : "start";
    await env.DB.prepare(
      `INSERT INTO company_profiles (company_id, data, setup_step, completed, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(company_id) DO UPDATE SET data = excluded.data, setup_step = excluded.setup_step,
         completed = excluded.completed, updated_at = datetime('now')`,
    )
      .bind(company.id, JSON.stringify(profile), step, body?.completed === true ? 1 : 0)
      .run();
    return json({ ok: true });
  }

  const row = await env.DB.prepare("SELECT data, setup_step, completed FROM company_profiles WHERE company_id = ?")
    .bind(company.id)
    .first<{ data: string; setup_step: string; completed: number }>();
  const cards = await env.DB.prepare("SELECT trade, audience, method, data FROM rate_cards WHERE company_id = ?")
    .bind(company.id)
    .all<{ trade: string; audience: string; method: string; data: string }>();
  const plan = normalizePlan(company.plan);
  return json({
    company: company.name,
    plan,
    caps: PROFILE_CAPS[plan],
    profile: parse(row?.data),
    setupStep: row?.setup_step ?? "start",
    completed: row?.completed === 1,
    rateCards: cards.results.map((c) => ({ trade: c.trade, audience: c.audience, method: c.method, data: parse(c.data) })),
  });
}

/** Saves one rate card (one trade, retail or builder). */
export async function handleRateCard(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (!isTrade(body?.trade)) return json({ error: "Unknown trade." }, 400);
  if (!(METHODS as readonly string[]).includes(String(body?.method))) return json({ error: "Unknown pricing method." }, 400);
  const audience = body?.audience === "builder" ? "builder" : "retail";
  const company = await env.DB.prepare("SELECT plan FROM companies WHERE id = ?").bind(user.companyId).first<{ plan: string }>();
  // Builder rate cards are for Basic and Pro only.
  if (audience === "builder" && ["free", "starter"].includes(normalizePlan(company?.plan))) {
    return json({ error: "Builder rate cards are available on the Basic and Pro plans." }, 403);
  }
  const data = sanitizeRateData(body?.data) ?? {};
  await env.DB.prepare(
    `INSERT INTO rate_cards (company_id, trade, audience, method, data, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(company_id, trade, audience) DO UPDATE SET method = excluded.method, data = excluded.data, updated_at = datetime('now')`,
  )
    .bind(user.companyId, body.trade, audience, body.method, JSON.stringify(data))
    .run();
  return json({ ok: true });
}
