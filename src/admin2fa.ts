import { readCookie, sha256Hex } from "./auth.ts";
import { sendLeadEmail } from "./email.ts";
import { readBlob, updateBlob, writeBlob } from "./kv.ts";
import type { Env } from "./types.ts";

/**
 * Second step for admin sign-in (approved 2026-11-16): a 6-digit code emailed to the admin, entered once per day on the admin page.
 * The usual sign-in (email link or Google) is step one. Everyone with admin rights, owner and staff, goes through this.
 *
 * Plan: switch to an authenticator-app code plus recovery codes when V1 of the control panel is finished (Rogelio asked to be reminded).
 *
 * Break-glass: setting the Cloudflare variable ADMIN_2FA to "off" turns this step off, in case the email never arrives.
 *
 * Stored in app_settings: a2c:<userId> (the code that was emailed, as a hash, with its expiry and attempts), a2v:<hash of the session> (this session is verified).
 */

export const CODE_MINUTES = 10;
export const VERIFIED_HOURS = 24;
const MAX_TRIES = 5;
const MAX_SENDS_PER_HOUR = 5;
const SESSION_COOKIE = "pm_session";

export const twoStepOn = (env: Env) => env.ADMIN_2FA !== "off";

interface CodeRow {
  hash: string;
  expires: number;
  tries: number;
  sends: number[]; // times (ms) codes were sent in the last hour
}
const readCode = (raw: unknown): CodeRow => ({
  hash: typeof (raw as any)?.hash === "string" ? (raw as any).hash.slice(0, 64) : "",
  expires: Number((raw as any)?.expires) || 0,
  tries: Number((raw as any)?.tries) || 0,
  sends: Array.isArray((raw as any)?.sends) ? (raw as any).sends.map(Number).filter((n: number) => Number.isFinite(n)).slice(-20) : [],
});
const codeKey = (u: number) => `a2c:${u}`;
const verKey = (h: string) => `a2v:${h}`;

async function sessionHash(request: Request): Promise<string> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return token && /^[0-9a-f]{64}$/.test(token) ? sha256Hex(token) : "";
}

/** True when this signed-in session already passed the code step in the last day (or the step is switched off). */
export async function isVerified(env: Env, request: Request, userId: number): Promise<boolean> {
  if (!twoStepOn(env)) return true;
  const h = await sessionHash(request);
  if (!h) return false;
  const v = await readBlob(env, verKey(h), (r) => r as { userId?: number; at?: number } | null);
  return !!v && v.userId === userId && Number(v.at) > Date.now() - VERIFIED_HOURS * 3600_000;
}

const digits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
const hashOf = (userId: number, code: string) => sha256Hex(`a2:${userId}:${code}`);

/** Emails a new code. At most 5 an hour. */
export async function sendCode(env: Env, userId: number, email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = Date.now();
  const code = digits();
  const hash = await hashOf(userId, code);
  const r = await updateBlob(env, codeKey(userId), readCode, (cur) => {
    const recent = cur.sends.filter((t) => t > now - 3600_000);
    if (recent.length >= MAX_SENDS_PER_HOUR) return { error: "Too many codes this hour. Try again later." };
    return { value: { hash, expires: now + CODE_MINUTES * 60_000, tries: 0, sends: [...recent, now] } };
  });
  if (!r.ok) return r;
  const res = await sendLeadEmail(env, email, "Your PaintersMax admin code", `Your admin code is ${code}\n\nIt works for ${CODE_MINUTES} minutes. If you did not just sign in to PaintersMax admin, ignore this email.`);
  if (res === "skipped" && env.DEV_LOG_LINKS === "1") console.log("DEV ADMIN CODE:", code);
  return { ok: true };
}

/** Checks the code. Five wrong tries burn it. A right code marks this session verified for a day. */
export async function verifyCode(env: Env, request: Request, userId: number, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const code = typeof raw === "string" ? raw.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code." };
  const h = await sessionHash(request);
  if (!h) return { ok: false, error: "Sign in again." };
  const hash = await hashOf(userId, code);
  let good = false;
  const r = await updateBlob(env, codeKey(userId), readCode, (cur) => {
    if (!cur.hash || cur.expires < Date.now()) return { error: "That code ran out. Send a new one." };
    if (cur.tries >= MAX_TRIES) return { error: "Too many wrong tries. Send a new code." };
    if (cur.hash === hash) {
      good = true;
      return { value: { ...cur, hash: "", tries: 0 } }; // a code works once
    }
    return { value: { ...cur, tries: cur.tries + 1 } };
  });
  if (!r.ok) return r;
  if (!good) return { ok: false, error: "That code is not right." };
  await writeBlob(env, verKey(h), { userId, at: Date.now() });
  return { ok: true };
}
