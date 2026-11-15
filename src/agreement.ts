import { sha256Hex } from "./auth.ts";
import type { Env } from "./types.ts";

/** The version of the Early Access Agreement on /early-access-agreement. Bump it when the text changes, so each acceptance names the text that was agreed to. */
export const AGREEMENT_VERSION = "early-access-2026-11-15-v2";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * Sign-up must carry { agreed: true }. When it does, this saves who agreed, when and to which version, and returns null so sign-up goes on.
 * When it does not, it returns the answer to send back. Records live in app_settings under agree:<sha256 of the email>:<version>.
 */
export async function requireAgreement(request: Request, env: Env): Promise<Response | null> {
  let b: any = null;
  try {
    b = await request.clone().json();
  } catch {
    return null; // not valid JSON: the sign-up handler gives its own error
  }
  if (b?.agreed !== true) return json({ error: "Please tick the box to agree to the Early Access Agreement, the Terms and the Privacy Policy." }, 400);
  const email = typeof b?.email === "string" ? b.email.trim().toLowerCase().slice(0, 200) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null; // the sign-up handler explains the bad email
  const key = `agree:${(await sha256Hex(email)).slice(0, 40)}:${AGREEMENT_VERSION}`;
  const value = JSON.stringify({ email, version: AGREEMENT_VERSION, at: new Date().toISOString() });
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO NOTHING").bind(key, value).run();
  return null;
}
