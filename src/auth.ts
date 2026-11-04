import { sendLeadEmail } from "./email.ts";
import type { Env } from "./types.ts";

const SESSION_COOKIE = "pm_session";
const LOGIN_MINUTES = 15;
const SESSION_DAYS = 14;
const MAX_LINKS_PER_HOUR = 5;

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/** Step 1: user types their email. Always answers the same way so nobody can probe which emails exist. */
export async function requestLoginLink(env: Env, origin: string, rawEmail: unknown): Promise<void> {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase().slice(0, 200) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>();
  if (!user) return;

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_tokens WHERE user_id = ? AND created_at > datetime('now', '-1 hour')",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_LINKS_PER_HOUR) return;

  const token = randomToken();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), user.id, inFuture(LOGIN_MINUTES * 60_000))
    .run();

  const link = `${origin}/api/auth/verify?token=${token}`;
  const result = await sendLeadEmail(
    env,
    email,
    "Your PaintersMax sign-in link",
    `Click to sign in (valid ${LOGIN_MINUTES} minutes, works once):\n\n${link}\n\nIf you didn't ask for this, ignore this email.`,
  );
  // Local development only: print the link when no email key is set.
  if (result === "skipped" && env.DEV_LOG_LINKS === "1") console.log("DEV LOGIN LINK:", link);
}

/** Step 2: user clicks the link. Burns the token and starts a session. */
export async function verifyLoginLink(env: Env, token: string | null): Promise<{ cookie: string } | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const hash = await sha256Hex(token);
  // Single UPDATE makes "use once" safe even if the link is clicked twice at the same moment.
  const used = await env.DB.prepare(
    "UPDATE login_tokens SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id",
  )
    .bind(hash, new Date().toISOString())
    .first<{ user_id: number }>();
  if (!used) return null;

  const session = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(session), used.user_id, inFuture(SESSION_DAYS * 86_400_000))
    .run();
  return {
    cookie: `${SESSION_COOKIE}=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`,
  };
}

export interface SessionUser {
  userId: number;
  companyId: number;
  email: string;
  companyName: string;
}

export async function getSessionUser(env: Env, request: Request): Promise<SessionUser | null> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT u.id AS userId, u.company_id AS companyId, u.email AS email, c.name AS companyName
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<SessionUser>();
  return row ?? null;
}

export async function endSession(env: Env, request: Request): Promise<string> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
