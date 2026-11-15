import { sha256Hex } from "./auth.ts";

/** The visitor's network address as Cloudflare reports it (empty in local tests). */
export const clientIp = (request: Request): string => request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "";

/**
 * A per-visitor key for the daily caps on public AI tools. It is bound to the network address, so a script that
 * invents a new browser id on every call still shares one allowance. The browser id (when the page sends one)
 * keeps two people behind the same address apart.
 */
export async function visitorKey(request: Request, browserId?: unknown): Promise<string> {
  const id = typeof browserId === "string" && browserId ? browserId.slice(0, 64) : (request.headers.get("user-agent") ?? "").slice(0, 200);
  return (await sha256Hex(`${clientIp(request)}|${id}`)).slice(0, 32);
}

/**
 * True when a signed-in browser is sending a write that another site started (a cross-site request forgery).
 * The session cookie is SameSite=Lax, which already blocks other sites; this also blocks sibling subdomains
 * (client websites on *.paintersmax.app share the site with the app) and any browser that sends an Origin header
 * that is not ours. Public forms from client sites carry no session cookie, so they are never affected.
 */
export function crossSiteWrite(request: Request, hasSession: boolean): boolean {
  if (!hasSession) return false;
  const m = request.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && origin !== new URL(request.url).origin) return true;
  return false;
}
