import { loadMarkets, saveMarkets } from "./ratecatalog.ts";
import { listDomains, removeDomain, setDomain } from "./domains.ts";
import { RESERVED_SLUGS } from "./settings.ts";
import { adminTickerView, saveConfig } from "./ticker.ts";
import { requestLoginLink } from "./auth.ts";
import { adminActor, can, logAudit, ROLE_LIMITS, type Area } from "./adminroles.ts";
import { ACT_AREAS, adminAct, adminView } from "./admincp.ts";
import { grantCredits } from "./credits.ts";
import { grantWelcome } from "./starter.ts";
import { todayLocal } from "./dates.ts";
import { normalizePlan } from "./usage.ts";
import { fastAnthropicModel, setTextDefault, sideBySide, textDefault } from "./assistant.ts";
import { geminiModel } from "./gemini.ts";
import { adminHelpDelete, adminHelpDismiss, adminHelpDraft, adminHelpSave, adminHelpView } from "./helplib.ts";
import { ADMIN_KEY, GROUP_LABELS, inEmailEngine, loadAdmin, readAdmin, RULES } from "./notices.ts";
import type { Env } from "./types.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** The owner's own company. Only people who log in to it (with an admin role, see adminroles.ts) can use the admin page. */
export { ADMIN_COMPANY_SLUG } from "./adminroles.ts";

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
  | { ok: true; companyId: number; slug: string; created: boolean; welcome?: { status: "granted" | "held" | "off"; credits: number; expiresOn: string } }
  | { ok: false; error: string };

/**
 * Creates a client: a company, its owner login and a sign-in email. Safe to call twice for the same email
 * (a payment webhook may repeat): the second call changes nothing and reports created = false.
 */
export async function provisionClient(env: Env, origin: string, input: { name: unknown; email: unknown; plan: unknown }, o: { capped?: boolean; sendLink?: boolean } = {}): Promise<ProvisionResult> {
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
  // Every new company starts with welcome credits, added once (the grant id is the company id). Amount and days are the
  // starter campaign settings; public sign-ups also count against its daily ceiling (see starter.ts).
  const welcome = await grantWelcome(env, companyId, todayLocal(), { capped: o.capped === true }).catch((err) => {
    console.error("welcome credits failed", String(err));
    return undefined;
  });
  if (o.sendLink !== false) {
    try {
      await requestLoginLink(env, origin, email);
    } catch (err) {
      console.error("welcome link failed", String(err));
    }
  }
  return { ok: true, companyId, slug, created: true, welcome };
}

/** The area each of the original admin actions belongs to (the newer ones are in admincp.ts ACT_AREAS). */
const OLD_ACT_AREAS: Record<string, Area> = {
  create: "clients", plan: "subscriptions", credits_grant: "credits",
  ticker_save: "settings", markets_set: "settings", aimodel_set: "settings", aimodel_test: "settings", notices_set: "settings",
  domain_set: "domains", domain_remove: "domains",
  help_save: "content", help_delete: "content", help_dismiss: "content", help_draft: "content",
};
/** Actions that only read or draft, so they are not written to the audit log. */
const NOT_LOGGED = new Set(["aimodel_test", "help_draft"]);
const OLD_VIEW_AREAS: Record<string, Area> = { markets: "settings", domains: "domains", notices: "settings", help: "content", aimodel: "settings", ticker: "settings" };

/**
 * /api/admin. GET returns a view (?clients=1, ?client=<id>, ?subs=1 ... see admincp.ts, plus the original views).
 * POST {action, ...} changes something. Every request checks the signed-in admin's role for the area, and every change
 * goes to the audit log. Anyone who is not an admin gets "Not found".
 */
export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const actor = await adminActor(env, request);
  if (!actor) return json({ error: "Not found." }, 404);
  const today = todayLocal();

  if (request.method === "POST") {
    let b: any;
    try {
      b = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const action = typeof b?.action === "string" ? b.action : "";
    const area = ACT_AREAS[action] ?? OLD_ACT_AREAS[action];
    if (!area) return json({ error: "Unknown action." }, 400);
    // Outreach on a missed renewal can be marked by billing (subscriptions) or by sales (research).
    const allowed = can(actor.role, area, "change") || (action === "sub_outreach" && can(actor.role, "research", "change"));
    if (!allowed) return json({ error: "Your role cannot make this change. Ask the owner." }, 403);
    if (ACT_AREAS[action]) {
      const r = await adminAct(env, actor, b, today);
      if (!r.ok) return json({ error: r.error }, r.status ?? 400);
      await logAudit(env, actor, action, { companyId: r.companyId ?? null, detail: r.detail });
      return json({ ok: true, ...(r.data ?? {}) });
    }
    const res = await oldAction(request, env, b, actor.role);
    if (res.ok && !NOT_LOGGED.has(action)) {
      const cid = Number(b?.companyId);
      await logAudit(env, actor, action, { companyId: Number.isInteger(cid) ? cid : null, detail: auditOf(b) });
    }
    return res;
  }

  const url = new URL(request.url);
  const view = await adminView(env, actor, url, today);
  if (view) {
    if (!can(actor.role, view.area, "see")) return json({ error: "Your role cannot see this." }, 403);
    if ("csv" in view) return new Response(view.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${view.filename}"`, "cache-control": "no-store" } });
    if (view.data === null) return json({ error: "Not found." }, 404);
    return json(view.data);
  }
  const old = Object.keys(OLD_VIEW_AREAS).find((k) => url.searchParams.get(k) === "1");
  if (!can(actor.role, old ? OLD_VIEW_AREAS[old] : "clients", "see")) return json({ error: "Your role cannot see this." }, 403);
  return oldView(env, url);
}

/** A short, safe summary of an original action for the audit log (no long text). */
function auditOf(b: any): string {
  const o: Record<string, unknown> = {};
  for (const k of ["name", "email", "plan", "host", "slug", "credits", "note", "id", "rule", "home", "digest", "default"]) if (b?.[k] !== undefined && typeof b[k] !== "object") o[k] = String(b[k]).slice(0, 80);
  if (b?.article?.title) o.article = String(b.article.title).slice(0, 80);
  return JSON.stringify(o);
}

async function oldAction(request: Request, env: Env, b: any, role: keyof typeof ROLE_LIMITS): Promise<Response> {
  {
    if (b?.action === "create") {
      const r = await provisionClient(env, new URL(request.url).origin, b);
      if (!r.ok) return json({ error: r.error }, 400);
      return json({ ok: true, slug: r.slug, created: r.created });
    }
    if (b?.action === "ticker_save") {
      const cfg = await saveConfig(env, b.config);
      return json({ ok: true, config: cfg });
    }
    if (b?.action === "markets_set") {
      return json({ ok: true, markets: await saveMarkets(env, b.markets) });
    }
    if (b?.action === "domain_set") {
      const r = await setDomain(env, b.host, b.slug);
      return r.ok ? json({ ok: true, host: r.host }) : json({ error: r.error }, 400);
    }
    if (b?.action === "domain_remove") {
      return (await removeDomain(env, b.host)) ? json({ ok: true }) : json({ error: "Domain not found." }, 404);
    }
    if (b?.action === "help_save") {
      const r = await adminHelpSave(env, b.article);
      return r.ok ? json({ ok: true, article: r.article }) : json({ error: r.error }, 400);
    }
    if (b?.action === "help_delete") {
      return (await adminHelpDelete(env, String(b.id ?? ""))) ? json({ ok: true }) : json({ error: "Article not found." }, 404);
    }
    if (b?.action === "help_dismiss") {
      await adminHelpDismiss(env, String(b.id ?? ""));
      return json({ ok: true });
    }
    if (b?.action === "help_draft") {
      const d = await adminHelpDraft(env, String(b.question ?? "").slice(0, 400), String(b.hint ?? "").slice(0, 1000));
      return d ? json({ ok: true, draft: d }) : json({ error: "The AI could not write a draft right now. Write the answer yourself, or try again." }, 503);
    }
    if (b?.action === "credits_grant") {
      // Add AI credits to a client (for example after they pay for a pack another way). Works on every plan.
      const max = ROLE_LIMITS[role].maxGrantCredits;
      if (Number(b?.credits) > max) return json({ error: max ? `Your role can add up to ${max} credits at a time.` : "Your role cannot add credits." }, 403);
      const id = Number(b?.companyId);
      const co = Number.isInteger(id) ? await env.DB.prepare("SELECT id FROM companies WHERE id = ?").bind(id).first() : null;
      if (!co) return json({ error: "Client not found." }, 404);
      const r = await grantCredits(env, id, { id: `admin:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`, credits: Number(b?.credits), source: "admin", note: typeof b?.note === "string" ? b.note.trim().slice(0, 100) : "" }, todayLocal());
      return r.ok ? json({ ok: true }) : json({ error: r.error ?? "Could not add credits." }, 400);
    }
    if (b?.action === "aimodel_set") {
      if (b.default !== "gemini" && b.default !== "haiku") return json({ error: "Choose Gemini or Haiku." }, 400);
      await setTextDefault(env, b.default);
      return json({ ok: true, default: b.default });
    }
    if (b?.action === "aimodel_test") {
      const q = typeof b.question === "string" ? b.question.trim().slice(0, 500) : "";
      if (!q) return json({ error: "Type a question to test." }, 400);
      return json({ answers: await sideBySide(env, q) });
    }
    if (b?.action === "notices_set") {
      // One switch per reminder and place: "default" follows the plan, "all" turns it on for every plan, "off" hides it from everyone.
      const rule = RULES.find((r) => r.id === b?.rule);
      if (!rule) return json({ error: "Reminder not found." }, 404);
      const cur = await loadAdmin(env);
      const next = readAdmin({ ...cur, [rule.id]: { home: b?.home ?? cur[rule.id]?.home, digest: inEmailEngine(rule) ? b?.digest ?? cur[rule.id]?.digest : "default" } });
      await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(ADMIN_KEY, JSON.stringify(next)).run();
      return json({ ok: true });
    }
    if (b?.action === "plan") {
      const id = Number(b?.companyId);
      if (!Number.isInteger(id)) return json({ error: "Client not found." }, 404);
      const res = await env.DB.prepare("UPDATE companies SET plan = ? WHERE id = ?").bind(normalizePlan(b?.plan), id).run();
      return res.meta.changes ? json({ ok: true }) : json({ error: "Client not found." }, 404);
    }
    return json({ error: "Unknown action." }, 400);
  }
}

async function oldView(env: Env, url: URL): Promise<Response> {
  if (url.searchParams.get("markets") === "1") return json({ markets: await loadMarkets(env) });
  if (url.searchParams.get("domains") === "1") return json({ domains: await listDomains(env) });
  if (url.searchParams.get("notices") === "1") {
    const sw = await loadAdmin(env);
    return json({ rules: RULES.map((r) => ({ id: r.id, group: GROUP_LABELS[r.group], label: r.label, canDigest: inEmailEngine(r), emailDefault: r.digest, always: !!r.always, home: sw[r.id]?.home ?? "default", digest: sw[r.id]?.digest ?? "default" })) });
  }
  if (url.searchParams.get("help") === "1") return json(await adminHelpView(env));
  if (url.searchParams.get("aimodel") === "1") return json({ default: await textDefault(env, 0), gemini: geminiModel(env), haiku: fastAnthropicModel(env), haikuKey: !!env.ANTHROPIC_API_KEY });
  if (url.searchParams.get("ticker") === "1") return json(await adminTickerView(env));

  const rows = await env.DB.prepare(
    `SELECT c.id, c.slug, c.name, c.plan, c.created_at AS createdAt,
            (SELECT GROUP_CONCAT(email, ', ') FROM users WHERE company_id = c.id) AS owners,
            (SELECT COUNT(*) FROM jobs WHERE company_id = c.id) AS jobs,
            (SELECT COUNT(*) FROM leads WHERE company_id = c.id) AS leads
       FROM companies c ORDER BY c.id`,
  ).all();
  return json({ clients: rows.results });
}
