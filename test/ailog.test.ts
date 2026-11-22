import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { aiScorecard, aiToday, approxTokens, foldScorecard, logAiCall, rateAiAnswer } from "../src/ailog.ts";
import { SKIP_TABLES } from "../src/backup.ts";

function realEnv(extra: Record<string, string> = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE usage_counters (company_id INTEGER NOT NULL, feature TEXT NOT NULL, period TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, feature, period));");
  db.exec("CREATE TABLE companies (id INTEGER PRIMARY KEY, slug TEXT);");
  db.exec("INSERT INTO companies (id, slug) VALUES (1, 'paintersmax-master')");
  const DB = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      const run = (a: any[]) => ({
        async first() { return (st.get(...a) as any) ?? null; },
        async run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; },
        async all() { return { results: st.all(...a) }; },
      });
      return { bind: (...a: any[]) => run(a), ...run([]) };
    },
  };
  return { env: { DB, ...extra } as any, db };
}
const day = () => new Date().toISOString().slice(0, 10);

test("approxTokens is about one token per four characters", () => {
  assert.equal(approxTokens(""), 0);
  assert.equal(approxTokens("abcd"), 1);
  assert.equal(approxTokens("abcde"), 2);
});

test("foldScorecard: cost, speed, errors, thumbs and reasons per tool and model", () => {
  const rows = [
    ["n", 10], ["ok", 9], ["ms", 30000], ["in", 1_000_000], ["out", 100_000], ["up", 3], ["down", 1], ["down_wrong", 1],
  ].map(([m, n]) => ({ feature: `ailog:job_chat:claude-haiku-5-5:${m}`, n: n as number }));
  rows.push({ feature: "ailog:site_write:mystery-model:n", n: 2 }, { feature: "other:thing", n: 5 });
  const out = foldScorecard(rows);
  assert.equal(out.length, 2);
  const h = out.find((r) => r.model === "claude-haiku-5-5")!;
  assert.equal(h.calls, 10);
  assert.equal(h.errorPct, 10);
  assert.equal(h.avgMs, 3000);
  assert.equal(h.thumbsUpPct, 75);
  assert.deepEqual(h.reasons, { wrong: 1 });
  // $0.10 in + $0.05 out = 15 cents
  assert.equal(h.costCents, 15);
  assert.equal(h.costPerCallCents, 1.5);
  const m = out.find((r) => r.model === "mystery-model")!;
  assert.equal(m.costCents, null);
  assert.equal(m.thumbsUpPct, null);
});

test("logAiCall and rateAiAnswer write counters that aiScorecard and aiToday read back", async () => {
  const { env } = realEnv();
  await logAiCall(env, { tool: "job_chat", model: "gemini-3.8-flash", ms: 1200, tokensIn: 400, tokensOut: 100, ok: true });
  await logAiCall(env, { tool: "job_chat", model: "gemini-3.8-flash", ms: 15000, tokensIn: 400, tokensOut: 0, ok: false });
  assert.equal(await rateAiAnswer(env, { tool: "job_chat", model: "gemini-3.8-flash", rating: "down", reason: "too_long" }), true);
  await rateAiAnswer(env, { tool: "job_chat", model: "gemini-3.8-flash", rating: "down", reason: "not-a-reason" });
  await rateAiAnswer(env, { tool: "job_chat", model: "gemini-3.8-flash", rating: "up" });
  const rows = await aiScorecard(env, day());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].calls, 2);
  assert.equal(rows[0].ok, 1);
  assert.equal(rows[0].down, 2);
  assert.equal(rows[0].up, 1);
  assert.deepEqual(rows[0].reasons, { too_long: 1 });
  const t = await aiToday(env, day());
  assert.equal(t.calls, 2);
  assert.equal(t.errors, 1);
  assert.equal(t.killSwitch, false);
  assert.deepEqual(t.slow, ["job_chat/gemini-3.8-flash"]);
  assert.equal((await aiToday(realEnv({ AI_KILL_SWITCH: "1" }).env, day())).killSwitch, true);
});

test("logging never throws, even when the database is broken", async () => {
  const env: any = { DB: { prepare() { throw new Error("db down"); } } };
  await logAiCall(env, { tool: "x", model: "y", ms: 1, tokensIn: 1, tokensOut: 1, ok: true });
  assert.equal(await rateAiAnswer(env, { tool: "x", model: "y", rating: "up" }), false);
});

test("backup leaves out sign-in tables", () => {
  for (const n of ["sessions", "login_tokens", "sqlite_sequence", "_cf_KV", "d1_migrations"]) assert.ok(SKIP_TABLES.test(n), n);
  for (const n of ["companies", "jobs", "app_settings", "usage_counters"]) assert.ok(!SKIP_TABLES.test(n), n);
});

import { alertEmail, newLevels, readAlert, DEFAULT_DAILY_CENTS } from "../src/aialert.ts";
import { readBlind, scoreBlindTest, shuffle, BLIND_KEY } from "../src/blindtest.ts";

test("spend alert: levels cross once, limits are clamped, email says nothing was paused", () => {
  assert.deepEqual(newLevels(0, 500, []), []);
  assert.deepEqual(newLevels(260, 500, []), [50]);
  assert.deepEqual(newLevels(450, 500, [50]), [80]);
  assert.deepEqual(newLevels(600, 500, [50, 80]), [100]);
  assert.deepEqual(newLevels(600, 500, [50, 80, 100]), []);
  assert.deepEqual(newLevels(600, 0, []), []);
  assert.equal(readAlert(null).dailyCents, DEFAULT_DAILY_CENTS);
  assert.equal(readAlert({ dailyCents: 5 }).dailyCents, DEFAULT_DAILY_CENTS);
  assert.equal(readAlert({ dailyCents: 2500, sent: [50, 7] }).sent.length, 1);
  assert.match(alertEmail(100, 612, 500).body, /nothing was paused/);
  assert.match(alertEmail(50, 260, 500).subject, /50%/);
});

test("blind test: shuffle keeps every item; scoring saves quality once and reveals models", async () => {
  assert.deepEqual(shuffle([1, 2, 3, 4]).sort(), [1, 2, 3, 4]);
  const { env, db } = realEnv();
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);");
  const t = { id: "t1", tool: "job_chat", question: "q", at: "x", scored: false, answers: [
    { label: "A", provider: "haiku", model: "claude-haiku-5-5", text: "a", ms: 900, ok: true },
    { label: "B", provider: "gemini", model: "gemini-3.8-flash", text: "b", ms: 2000, ok: true },
  ] };
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run(BLIND_KEY, JSON.stringify([t]));
  assert.equal(readBlind(JSON.parse(JSON.stringify([t]))).length, 1);
  const bad = await scoreBlindTest(env, "t1", { A: 5 });
  assert.equal(bad.ok, false);
  const r = await scoreBlindTest(env, "t1", { A: 5, B: 3 });
  assert.equal(r.ok, true);
  const rows = await aiScorecard(env, day());
  const h = rows.find((x) => x.model === "claude-haiku-5-5")!;
  assert.equal(h.quality, 5);
  assert.equal(h.wins, 1);
  assert.equal(rows.find((x) => x.model === "gemini-3.8-flash")!.wins, 0);
  const again = await scoreBlindTest(env, "t1", { A: 1, B: 1 });
  assert.equal(again.ok, false);
});
