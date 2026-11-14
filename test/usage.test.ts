import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_LIMITS, FEATURES, consume, dayKey, isFeature, monthKey, normalizePlan } from "../src/usage.ts";

// Tiny in-memory stand-in for D1 that understands just the statements usage.ts runs.
function fakeEnv(extra: Record<string, unknown> = {}) {
  const rows = new Map<string, number>();
  const DB = {
    prepare(sql: string) {
      return {
        bind(...a: any[]) {
          return {
            async first() {
              const [cid, feature, period, limit] = a;
              const k = `${cid}|${feature}|${period}`;
              const cur = rows.get(k);
              if (cur === undefined) { rows.set(k, 1); return { count: 1 }; }
              if (cur + 1 <= limit) { rows.set(k, cur + 1); return { count: cur + 1 }; }
              return null;
            },
            async run() {
              const [cid, feature, period] = a;
              const k = `${cid}|${feature}|${period}`;
              rows.set(k, (rows.get(k) ?? 0) + 1);
            },
          };
        },
      };
    },
  };
  return { env: { DB, ...extra } as any, rows };
}

test("free plan stops at its monthly limit and records missed", async () => {
  const { env, rows } = fakeEnv();
  const co = { id: 1, plan: "free" };
  for (let i = 0; i < PLAN_LIMITS.free.ai_quote; i++) assert.equal((await consume(env, co, "ai_quote")).allowed, true);
  const r = await consume(env, co, "ai_quote");
  assert.equal(r.allowed, false);
  assert.equal((r as any).reason, "monthly_limit");
  assert.equal(rows.get(`1|ai_quote:missed|${monthKey()}`), 1);
});

test("features outside the plan are refused and counted as missed", async () => {
  const { env, rows } = fakeEnv();
  const r = await consume(env, { id: 2, plan: "free" }, "hd_render");
  assert.equal((r as any).reason, "not_in_plan");
  assert.equal(rows.get(`2|hd_render:missed|${monthKey()}`), 1);
});

test("visitor daily cap applies before the company allowance", async () => {
  const { env } = fakeEnv();
  const co = { id: 3, plan: "basic" };
  for (let i = 0; i < 3; i++) assert.equal((await consume(env, co, "hd_render", "v1")).allowed, true);
  assert.equal((await consume(env, co, "hd_render", "v1") as any).reason, "visitor_limit");
  assert.equal((await consume(env, co, "hd_render", "v2")).allowed, true);
});

test("kill switch blocks everything", async () => {
  const { env } = fakeEnv({ AI_KILL_SWITCH: "1" });
  assert.equal((await consume(env, { id: 4, plan: "pro" }, "ai_quote") as any).reason, "kill_switch");
});

test("helpers", () => {
  assert.equal(normalizePlan("weird"), "free");
  assert.equal(isFeature("hd_render"), true);
  assert.equal(isFeature("nope"), false);
  assert.match(dayKey(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(FEATURES.length, 14);
});

import { effectivePlan, trialDaysLeft } from "../src/usage.ts";
test("free trial: basic limits for 14 days, then free", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const fresh = { plan: "free", createdAt: "2026-11-19 12:00:00" };
  assert.equal(effectivePlan(fresh, now), "basic");
  assert.equal(trialDaysLeft(fresh, now), 13);
  const old = { plan: "free", createdAt: "2026-11-01 00:00:00" };
  assert.equal(effectivePlan(old, now), "free");
  assert.equal(trialDaysLeft(old, now), 0);
  assert.equal(effectivePlan({ plan: "pro", createdAt: "2026-11-19 12:00:00" }, now), "pro");
  assert.equal(effectivePlan({ plan: "free" }, now), "free");
  assert.equal(effectivePlan({ plan: "free", createdAt: "garbage" }, now), "free");
});
