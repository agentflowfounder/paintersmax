import { listDomains, removeDomain, setDomain } from "./domains.ts";
import { RESERVED_SLUGS } from "./settings.ts";
import { adminTickerView, saveConfig } from "./ticker.ts";
import { getSessionUser, requestLoginLink } from "./auth.ts";
import { normalizePlan } from "./usage.ts";
import type { Env } from "./types.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** The owner's own company. Only people who log in to it can use the admin page. */
export const ADMIN_COMPANY_SLUG = "paintersmax-master";

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "client";
}

async function uniqueSlug(env: Env, name: string): Promise<string> {
  let base = slugify(name);
  if (RESERVED_SLUGS.has(base)) base = `${base}-painting`;
  for (let n = 0; n < 50; n++) {
    const slug = n === 0 ? base : `${base}-${n + 1}`;
    const hit = await env.DB.prepare("SELECT 1 FROM companies WHERE slug = ?").bind(slug).first();
    if (!hit) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export type ProvisionResult =
  | { ok: true; companyId: number; slug: string; created: boolean }
  | { ok: false; error: string };

/**
 * Creates a client: a company, its owner login and a sign-in email. Safe to call twice for the same email
 * (a payment webhook may repeat): the second call changes nothing and reports created = false.
 */
export async function provisionClient(env: Env, origin: string, input: { name: unknown; email: unknown; plan: unknown }): Promise<ProvisionResult> {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase().slice(0, 200) : "";
  if (!name) return { ok: false, error: "Company name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "A valid owner email is required." };
  const plan = normalizePlan(input.plan);

  const existing = await env.DB.prepare("SELECT u.company_id AS id, c.slug AS slug FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = ?").bind(email).first<{ id: number; slug: string }>();
  if (existing) return { ok: true, companyId: existing.id, slug: existing.slug, created: false };

  const slug = await uniqueSlug(env, name);
  const company = await env.DB.prepare("INSERT INTO companies (slug, name, plan, notify_email) VALUES (?, ?, ?, ?)").bind(slug, name, plan, email).run();
  const companyId = Number(company.meta.last_row_id);
  await env.DB.prepare("INSERT INTO users (company_id, email, role) VALUES (?, ?, 'owner')").bind(companyId, email).run();
  try {
    await requestLoginLink(env, origin, email);
  } catch (err) {
    console.error("welcome link failed", String(err));
  }
  return { ok: true, companyId, slug, created: true };
}

/** GET lists every client. POST with action "create" adds one; "plan" changes a client's plan. Owner company only. */
export async function handleAdmin(request: Request, env: Env): Promise<Response> {
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
    if (b?.action === "create") {
      const r = await provisionClient(env, new URL(request.url).origin, b);
      if (!r.ok) return json({ error: r.error }, 400);
      return json({ ok: true, slug: r.slug, created: r.created });
    }
    if (b?.action === "ticker_save") {
      const cfg = await saveConfig(env, b.config);
      return json({ ok: true, config: cfg });
    }
    if (b?.action === "domain_set") {
      const r = await setDomain(env, b.host, b.slug);
      return r.ok ? json({ ok: true, host: r.host }) : json({ error: r.error }, 400);
    }
    if (b?.action === "domain_remove") {
      return (await removeDomain(env, b.host)) ? json({ ok: true }) : json({ error: "Domain not found." }, 404);
    }
    if (b?.action === "plan") {
      const id = Number(b?.companyId);
      if (!Number.isInteger(id)) return json({ error: "Client not found." }, 404);
      const res = await env.DB.prepare("UPDATE companies SET plan = ? WHERE id = ?").bind(normalizePlan(b?.plan), id).run();
      return res.meta.changes ? json({ ok: true }) : json({ error: "Client not found." }, 404);
    }
    return json({ error: "Unknown action." }, 400);
  }

  if (new URL(request.url).searchParams.get("domains") === "1") return json({ domains: await listDomains(env) });
  if (new URL(request.url).searchParams.get("ticker") === "1") return json(await adminTickerView(env));

  const rows = await env.DB.prepare(
    `SELECT c.id, c.slug, c.name, c.plan, c.created_at AS createdAt,
            (SELECT GROUP_CONCAT(email, ', ') FROM users WHERE company_id = c.id) AS owners,
            (SELECT COUNT(*) FROM jobs WHERE company_id = c.id) AS jobs,
            (SELECT COUNT(*) FROM leads WHERE company_id = c.id) AS leads
       FROM companies c ORDER BY c.id`,
  ).all();
  return json({ clients: rows.results });
}
