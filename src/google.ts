import { randomToken, readCookie, startSession } from "./auth.ts";
import type { Env } from "./types.ts";

const STATE_COOKIE = "pm_oauth_state";
const DEFAULT_BASE = "https://paintersmax.app";

const base = (env: Env) => (env.GOOGLE_REDIRECT_BASE || DEFAULT_BASE).replace(/\/+$/, "");
const redirect = (to: string, cookies: string[] = []) => {
  const h = new Headers({ location: to });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
};
const clearState = `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=0`;

/** Reads the claims out of a Google ID token. It arrives straight from Google over TLS, so no signature check is needed. */
export function readIdToken(idToken: unknown): { email?: string; emailVerified: boolean; aud?: string; iss?: string } | null {
  if (typeof idToken !== "string") return null;
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    return { email: typeof claims.email === "string" ? claims.email.toLowerCase() : undefined, emailVerified: claims.email_verified === true || claims.email_verified === "true", aud: claims.aud, iss: claims.iss };
  } catch {
    return null;
  }
}

/** GET /api/auth/config tells the login page which sign-in methods are switched on. */
export function handleAuthConfig(env: Env): Response {
  return new Response(JSON.stringify({ google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) }), { headers: { "content-type": "application/json" } });
}

/** GET /api/auth/google starts the Google sign-in. Always runs on the canonical address so the cookie and Google's redirect agree. */
export async function handleGoogleStart(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect("/login?error=google_off");
  const url = new URL(request.url);
  const canonical = new URL(base(env));
  if (url.host !== canonical.host) return redirect(`${canonical.origin}/api/auth/google`);
  const state = randomToken();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${canonical.origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [`${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=600`]);
}

/** GET /api/auth/google/callback finishes the sign-in. Only emails that already have an account get in; nothing is created here. */
export async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect("/login?error=google_off");
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const saved = readCookie(request.headers.get("cookie"), STATE_COOKIE);
  if (url.searchParams.get("error")) return redirect("/login?error=google_cancelled", [clearState]);
  if (!state || !code || !saved || state !== saved) return redirect("/login?error=google_failed", [clearState]);

  const form = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: `${new URL(base(env)).origin}/api/auth/google/callback`,
    grant_type: "authorization_code",
  });
  const r = await fetch(env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  if (!r.ok) {
    console.error("google token exchange failed", r.status);
    return redirect("/login?error=google_failed", [clearState]);
  }
  const claims = readIdToken(((await r.json().catch(() => ({}))) as any).id_token);
  if (!claims?.email || !claims.emailVerified || claims.aud !== env.GOOGLE_CLIENT_ID || !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss ?? "")) {
    return redirect("/login?error=google_failed", [clearState]);
  }
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(claims.email).first<{ id: number }>();
  if (!user) return redirect("/login?error=no_account", [clearState]);
  const session = await startSession(env, user.id);
  return redirect("/dashboard", [session.cookie, clearState]);
}
