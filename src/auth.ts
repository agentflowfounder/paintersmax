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

/** True when the request carries a session cookie (valid or not); used to decide whether a write needs the same-origin check. */
export const hasSessionCookie = (request: Request): boolean => !!readCookie(request.headers.get("cookie"), SESSION_COOKIE);

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

  return startSession(env, used.user_id);
}

/** Opens a signed-in session for a user and returns the cookie that carries it. */
export async function startSession(env: Env, userId: number): Promise<{ cookie: string }> {
  const session = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(session), userId, inFuture(SESSION_DAYS * 86_400_000))
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

/**
 * The page a sign-in link opens. Opening the link does NOT use it up: the painter taps "Sign in" and that POST does.
 * Email safety scanners (Outlook Safe Links, company virus checkers) open every link in an email before the person
 * does; when a plain visit used the link, those scanners burned it and the painter saw "invalid or expired".
 * Scanners do not press buttons, so the link still works when the painter taps it. English and Spanish on one page.
 */
export function signInLinkPage(token: string | null, state: "ready" | "bad"): Response {
  const ok = state === "ready" && !!token && /^[0-9a-f]{64}$/.test(token);
  const body = ok
    ? `<h1>Sign in to PaintersMax</h1><p class="es">Iniciar sesión en PaintersMax</p>
<form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${token}"><button type="submit">Sign in · Entrar</button></form>
<p class="small">This link works once and for 15 minutes.<br><span class="es">Este enlace funciona una vez y por 15 minutos.</span></p>`
    : `<h1>This sign-in link has expired</h1><p class="es">Este enlace de acceso ya no funciona</p>
<p>Links work once and for 15 minutes. Ask for a new one and use the newest email.<br><span class="es">Los enlaces funcionan una vez y por 15 minutos. Pida uno nuevo y use el correo más reciente.</span></p>
<p><a class="btn" href="/login">Get a new link · Pedir un enlace nuevo</a></p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sign in · PaintersMax</title>
<style>body{margin:0;background:#F7F5F1;color:#0F1B2D;font:17px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
main{background:#fff;border-radius:14px;padding:28px 24px;max-width:420px;width:100%;box-shadow:0 2px 16px rgba(15,27,45,.08);text-align:center}
h1{font-size:24px;margin:0 0 4px}.es{color:#5b6472;margin-top:0}.small{font-size:14px;color:#5b6472}
button,.btn{display:inline-block;margin:18px 0 8px;background:#0F1B2D;color:#fff;border:0;border-radius:10px;padding:14px 28px;font-size:18px;font-weight:600;text-decoration:none;cursor:pointer;min-width:220px}</style></head>
<body><main>${body}</main></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
