import type { Env } from "./types.ts";

/**
 * Small helpers for the app_settings table, which holds JSON blobs by key (no database change needed for new data).
 * updateBlob is a compare-and-swap: two admins saving at the same moment never overwrite each other's change.
 */

export async function readBlob<T>(env: Env, key: string, clean: (raw: unknown) => T): Promise<T> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  try {
    return clean(r ? JSON.parse(r.value) : null);
  } catch {
    return clean(null);
  }
}

export async function writeBlob(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  )
    .bind(key, JSON.stringify(value))
    .run();
}

/**
 * Reads the blob, lets `change` return the new value (or an error message), and saves it only if nobody else saved in between.
 * Retries a few times when someone else did.
 */
export async function updateBlob<T, R = T>(
  env: Env,
  key: string,
  clean: (raw: unknown) => T,
  change: (cur: T) => { value: T; result?: R } | { error: string },
): Promise<{ ok: true; value: T; result?: R } | { ok: false; error: string }> {
  for (let i = 0; i < 6; i++) {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
    let cur: T;
    try {
      cur = clean(row ? JSON.parse(row.value) : null);
    } catch {
      cur = clean(null);
    }
    const out = change(cur);
    if ("error" in out) return { ok: false, error: out.error };
    const next = JSON.stringify(out.value);
    const res = row
      ? await env.DB.prepare("UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ? AND value = ?").bind(next, key, row.value).run()
      : await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO NOTHING").bind(key, next).run();
    if (res.meta.changes) return { ok: true, value: out.value, result: out.result };
  }
  return { ok: false, error: "Someone else saved at the same moment. Try again." };
}

/** Every row whose key starts with `prefix` (a key range, so the primary key index is used). */
export async function blobsWithPrefix(env: Env, prefix: string, limit = 2000): Promise<{ key: string; value: unknown }[]> {
  const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
  const rows = await env.DB.prepare("SELECT key, value FROM app_settings WHERE key >= ? AND key < ? LIMIT ?").bind(prefix, end, limit).all<{ key: string; value: string }>();
  const out: { key: string; value: unknown }[] = [];
  for (const r of rows.results ?? []) {
    try {
      out.push({ key: r.key, value: JSON.parse(r.value) });
    } catch {
      /* a broken row is skipped */
    }
  }
  return out;
}

export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const newId = () => `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
