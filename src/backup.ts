import type { Env } from "./types.ts";

/** Tables that hold sign-in secrets. They are never put in a backup file. */
export const SKIP_TABLES = /^(sessions|login_tokens|_cf_.*|sqlite_.*|d1_migrations)$/;
const ROW_CAP = 50000;
export const LAST_BACKUP_KEY = "lastbackup";

/**
 * A plain JSON copy of the database for the owner to keep. Sign-in tables are left out,
 * and each table stops at ROW_CAP rows (the file says so if that ever happens).
 */
export async function databaseBackup(env: Env, today: string): Promise<{ filename: string; json: string }> {
  const names = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const truncated: string[] = [];
  for (const { name } of names.results ?? []) {
    if (SKIP_TABLES.test(name) || !/^[A-Za-z0-9_]+$/.test(name)) continue;
    const rows = await env.DB.prepare(`SELECT * FROM "${name}" LIMIT ${ROW_CAP + 1}`).all();
    const list = rows.results ?? [];
    if (list.length > ROW_CAP) {
      truncated.push(name);
      list.length = ROW_CAP;
    }
    tables[name] = list;
    counts[name] = list.length;
  }
  const json = JSON.stringify({ app: "paintersmax", madeOn: today, note: "Sign-in tables (sessions, login_tokens) are not included.", truncated, counts, tables });
  return { filename: `paintersmax-backup-${today}.json`, json };
}
