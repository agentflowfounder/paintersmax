import { getSessionUser } from "./auth.ts";
import { readBlob, str, updateBlob } from "./kv.ts";
import type { Env } from "./types.ts";

/**
 * Who can use the admin control panel, and what each person can see and change.
 *
 * Everyone in admin is a user of the PaintersMax master company (slug paintersmax-master).
 *  - A user of that company whose login role is "owner" and who has no entry in the team list is the master admin (Rogelio).
 *  - Employees are added from the Security tab. They get a login in the master company (role "staff") and a role in the team list.
 *  - Anyone else, including a staff login with no role, gets "Not found" (admin stays invisible).
 *
 * Every change made in admin is written to the audit log: one row per entry, never edited, never deleted (no code path removes them).
 */

export const ADMIN_COMPANY_SLUG = "paintersmax-master";

export type AdminRole = "owner" | "support" | "sales" | "billing" | "readonly";
export const ADMIN_ROLES: AdminRole[] = ["owner", "support", "sales", "billing", "readonly"];
export const isAdminRole = (v: unknown): v is AdminRole => typeof v === "string" && (ADMIN_ROLES as string[]).includes(v);

export type Area = "clients" | "subscriptions" | "credits" | "promos" | "research" | "feedback" | "domains" | "sites" | "content" | "broadcasts" | "settings" | "security";
export const AREAS: Area[] = ["clients", "subscriptions", "credits", "promos", "research", "feedback", "domains", "sites", "content", "broadcasts", "settings", "security"];

/** What each role sees and changes (the blueprint approved 2026-11-14). */
export const PERMS: Record<AdminRole, { see: Area[]; change: Area[] }> = {
  owner: { see: AREAS, change: AREAS },
  support: { see: ["clients", "credits", "feedback", "domains", "sites", "content"], change: ["clients", "credits", "feedback", "sites", "content"] },
  sales: { see: ["clients", "subscriptions", "promos", "research", "broadcasts"], change: ["promos", "research"] },
  billing: { see: ["clients", "subscriptions", "credits", "promos", "domains"], change: ["subscriptions", "domains"] },
  readonly: { see: ["clients", "subscriptions", "credits", "promos", "research", "feedback", "domains", "sites", "content", "broadcasts"], change: [] },
};

/** Limits a role works inside. The owner has none beyond the hard caps in each tool. */
export const ROLE_LIMITS: Record<AdminRole, { maxGrantCredits: number; maxPromoBonus: number }> = {
  owner: { maxGrantCredits: 100000, maxPromoBonus: 5000 },
  support: { maxGrantCredits: 200, maxPromoBonus: 0 },
  sales: { maxGrantCredits: 0, maxPromoBonus: 500 },
  billing: { maxGrantCredits: 0, maxPromoBonus: 0 },
  readonly: { maxGrantCredits: 0, maxPromoBonus: 0 },
};

export const can = (role: AdminRole, area: Area, what: "see" | "change") => PERMS[role][what].includes(area);

export interface AdminActor {
  userId: number;
  email: string;
  role: AdminRole;
  ip: string;
}

export interface TeamMember {
  email: string;
  role: AdminRole | "removed";
  addedOn: string;
  addedBy: string;
}
export const TEAM_KEY = "admin:team";
export function readTeam(raw: unknown): TeamMember[] {
  // Stored as a plain list. ({members: [...]} is read too.)
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.members) ? (raw as any).members : [];
  const out: TeamMember[] = [];
  for (const m of list) {
    const email = str(m?.email, 200).toLowerCase();
    if (!email || out.some((x) => x.email === email)) continue;
    out.push({ email, role: isAdminRole(m?.role) || m?.role === "removed" ? m.role : "readonly", addedOn: str(m?.addedOn, 10), addedBy: str(m?.addedBy, 200) });
  }
  return out.slice(0, 100);
}
export const loadTeam = (env: Env) => readBlob(env, TEAM_KEY, readTeam);

/** The role a master-company login has: its team entry, or owner for an original owner login with no entry. */
export function roleFor(login: { email: string; loginRole: string }, team: TeamMember[]): AdminRole | null {
  const m = team.find((t) => t.email === login.email.toLowerCase());
  if (m) return m.role === "removed" ? null : m.role;
  return login.loginRole === "owner" ? "owner" : null;
}

/** The signed-in admin, or null for everyone else (who should get a plain 404). */
export async function adminActor(env: Env, request: Request): Promise<AdminActor | null> {
  const user = await getSessionUser(env, request);
  if (!user) return null;
  const row = await env.DB.prepare("SELECT c.slug AS slug, u.role AS loginRole FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?")
    .bind(user.userId)
    .first<{ slug: string; loginRole: string }>();
  if (row?.slug !== ADMIN_COMPANY_SLUG) return null;
  const role = roleFor({ email: user.email, loginRole: row.loginRole }, await loadTeam(env));
  if (!role) return null;
  return { userId: user.userId, email: user.email, role, ip: (request.headers.get("cf-connecting-ip") ?? "").slice(0, 45) };
}

// ---------------------------------------------------------------- audit log

export interface AuditEntry {
  at: string; // ISO time
  by: string; // admin email
  role: string;
  action: string;
  companyId: number | null;
  detail: string;
  ip: string;
}

/** Keeps the log readable and small: no long text, no secrets. */
export function auditDetail(d: unknown): string {
  if (d == null) return "";
  const s = typeof d === "string" ? d : JSON.stringify(d);
  return s.replace(/\s+/g, " ").slice(0, 400);
}

export async function logAudit(env: Env, actor: Pick<AdminActor, "email" | "role" | "ip">, action: string, o: { companyId?: number | null; detail?: unknown } = {}): Promise<void> {
  const at = new Date().toISOString();
  const entry: AuditEntry = {
    at,
    by: actor.email,
    role: actor.role,
    action: action.slice(0, 60),
    companyId: Number.isInteger(o.companyId) && (o.companyId as number) > 0 ? (o.companyId as number) : null,
    detail: auditDetail(o.detail),
    ip: actor.ip ?? "",
  };
  const key = `audit:${at}:${crypto.randomUUID().slice(0, 8)}`;
  try {
    await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind(key, JSON.stringify(entry)).run();
  } catch (err) {
    console.error("audit write failed", String(err));
  }
}

/** Newest first. `before` is the `at` of the last entry already shown, for the next page. */
export async function listAudit(env: Env, o: { companyId?: number; by?: string; before?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(Number(o.limit) || 100, 1), 300);
  const upper = o.before && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(o.before) ? `audit:${o.before}` : "audit;";
  const where = ["key >= 'audit:'", "key < ?"];
  const binds: unknown[] = [upper];
  if (o.companyId) {
    where.push("json_extract(value, '$.companyId') = ?");
    binds.push(o.companyId);
  }
  if (o.by) {
    where.push("json_extract(value, '$.by') = ?");
    binds.push(o.by.toLowerCase());
  }
  const rows = await env.DB.prepare(`SELECT value FROM app_settings WHERE ${where.join(" AND ")} ORDER BY key DESC LIMIT ?`).bind(...binds, limit).all<{ value: string }>();
  const out: AuditEntry[] = [];
  for (const r of rows.results ?? []) {
    try {
      out.push(JSON.parse(r.value));
    } catch {
      /* skip */
    }
  }
  return out;
}

// ---------------------------------------------------------------- team management (owner only)

export interface TeamView {
  email: string;
  role: AdminRole | "removed";
  addedOn: string;
  lastSignIn: string | null;
}

export async function teamView(env: Env): Promise<TeamView[]> {
  const team = await loadTeam(env);
  const logins = await env.DB.prepare(
    `SELECT u.email AS email, u.role AS loginRole, (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS lastSignIn
       FROM users u JOIN companies c ON c.id = u.company_id WHERE c.slug = ?`,
  )
    .bind(ADMIN_COMPANY_SLUG)
    .all<{ email: string; loginRole: string; lastSignIn: string | null }>();
  const out: TeamView[] = [];
  for (const l of logins.results ?? []) {
    const m = team.find((t) => t.email === l.email.toLowerCase());
    const role = m ? m.role : l.loginRole === "owner" ? "owner" : "removed";
    out.push({ email: l.email, role, addedOn: m?.addedOn ?? "", lastSignIn: l.lastSignIn });
  }
  return out;
}

/** Adds an employee (or changes a role). The email gets a login in the master company if it has none. */
export async function setTeamRole(env: Env, actor: AdminActor, rawEmail: unknown, rawRole: unknown, today: string): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const email = str(rawEmail, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  const role: AdminRole | "removed" | null = rawRole === "removed" ? "removed" : isAdminRole(rawRole) ? rawRole : null;
  if (!role) return { ok: false, error: "Choose a role." };
  if (email === actor.email.toLowerCase()) return { ok: false, error: "You cannot change your own role." };
  const master = await env.DB.prepare("SELECT id FROM companies WHERE slug = ?").bind(ADMIN_COMPANY_SLUG).first<{ id: number }>();
  if (!master) return { ok: false, error: "The PaintersMax company is missing." };
  const login = await env.DB.prepare("SELECT id, company_id AS companyId FROM users WHERE email = ?").bind(email).first<{ id: number; companyId: number }>();
  if (login && login.companyId !== master.id) return { ok: false, error: "That email already belongs to a client account. Use a different email for admin work." };
  if (role === "removed" && !login) return { ok: false, error: "That person is not on the team." };
  let created = false;
  if (!login) {
    await env.DB.prepare("INSERT INTO users (company_id, email, role) VALUES (?, ?, 'staff')").bind(master.id, email).run();
    created = true;
  }
  const r = await updateBlob(env, TEAM_KEY, readTeam, (team) => {
    const rest = team.filter((t) => t.email !== email);
    return { value: [...rest, { email, role, addedOn: team.find((t) => t.email === email)?.addedOn || today, addedBy: actor.email }] };
  });
  if (!r.ok) return r;
  // A removed person (or a changed role) signs in again, so an old open session never keeps old rights.
  const uid = login?.id ?? (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>())?.id;
  if (uid && (role === "removed" || login)) await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(uid).run();
  return { ok: true, created };
}
