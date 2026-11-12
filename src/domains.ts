import type { Env } from "./types.ts";

/**
 * Client-owned domains. The owner adds the domain to Cloudflare, points it at this worker, then maps it to a company here.
 * The mapping lives in app_settings under "domain:<host>" so no database change is needed.
 */

export const isPlatformHost = (h: string) =>
  h === "paintersmax.app" || h.endsWith(".paintersmax.app") || h.endsWith(".workers.dev") || h === "localhost" || h === "127.0.0.1";

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/** A clean, lowercase host name, or null when it is not a valid public domain we may map. */
export function cleanHost(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const h = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!HOST_RE.test(h) || isPlatformHost(h)) return null;
  return h;
}

const key = (host: string) => `domain:${host}`;

/** The company slug mapped to this host, or null. Only called for hosts that are not ours. */
export async function slugForHost(env: Env, hostname: string): Promise<string | null> {
  const h = hostname.toLowerCase();
  if (isPlatformHost(h) || !HOST_RE.test(h)) return null;
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key(h)).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setDomain(env: Env, host: unknown, slug: unknown): Promise<{ ok: true; host: string } | { ok: false; error: string }> {
  const h = cleanHost(host);
  if (!h) return { ok: false, error: "Enter a full domain such as rivera-painting.com (not a paintersmax.app address)." };
  const s = typeof slug === "string" ? slug.trim().slice(0, 60) : "";
  const co = s ? await env.DB.prepare("SELECT slug FROM companies WHERE slug = ?").bind(s).first<{ slug: string }>() : null;
  if (!co) return { ok: false, error: "Client not found." };
  const taken = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key(h)).first<{ value: string }>();
  if (taken && taken.value !== co.slug) return { ok: false, error: `That domain is already connected to ${taken.value}. Remove it there first.` };
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key(h), co.slug).run();
  return { ok: true, host: h };
}

export async function removeDomain(env: Env, host: unknown): Promise<boolean> {
  const h = cleanHost(host);
  if (!h) return false;
  const r = await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(key(h)).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function listDomains(env: Env): Promise<{ host: string; slug: string }[]> {
  const { results } = await env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'domain:%' ORDER BY key").all<{ key: string; value: string }>();
  return (results ?? []).map((r) => ({ host: r.key.slice(7), slug: r.value }));
}
