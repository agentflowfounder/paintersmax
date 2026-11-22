import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { GROW_STEPS, activeGrow, advance, extraRoom, growthOffer, readGrow, stepCents, stepsCents } from "../src/growth.ts";
import { extraCities, limitsFor, readDoorRecord, upgradeCents } from "../src/sitecore.ts";
import { applyGrowthSteps, loadDoor } from "../src/sitebuilder.ts";
import { doorCharge } from "../src/starter.ts";
import { creditView } from "../src/credits.ts";
import { sanitizeProfile } from "../src/profile.ts";

test("the five steps add up to exactly the upgrade price, for both climbs", () => {
  for (const from of ["launch", "grow"] as const) {
    const to = from === "launch" ? "grow" : "signature";
    assert.equal(stepsCents(from, 0, 5), upgradeCents(from, to));
    assert.equal(stepsCents(from, 0, 2) + stepsCents(from, 2, 3), upgradeCents(from, to));
  }
  assert.equal(stepCents("launch", 1), 2000);
  assert.equal(stepCents("free", 1), 0);
  assert.equal(stepCents("signature", 1), 0);
});

test("the five steps add up to exactly the room of the next door", () => {
  assert.deepEqual(extraRoom("launch", 5), { pages: 5, services: 3, photos: 45, cities: 7 });
  assert.deepEqual(extraRoom("grow", 5), { pages: 5, services: 4, photos: 75, cities: 20 });
  assert.deepEqual(extraRoom("launch", 0), { pages: 0, services: 0, photos: 0, cities: 0 });
  // Never more room than the next door, never less than the step before.
  let prev = 0;
  for (let k = 0; k <= 5; k++) { const r = extraRoom("launch", k).cities; assert.ok(r >= prev); prev = r; }
});

test("room from steps raises the limits and the city cap, and only for the door above", () => {
  const rec = readDoorRecord({ door: "launch", grow: { to: "grow", steps: 2, paidCents: 4000 } });
  assert.deepEqual(rec.grow, { to: "grow", steps: 2, paidCents: 4000 });
  assert.deepEqual(limitsFor("launch", rec), { pages: 7, services: 4, photos: 48 });
  assert.equal(extraCities("launch", rec), 2);
  // A stale record (the door moved) adds nothing.
  assert.deepEqual(limitsFor("grow", rec), { pages: 10, services: 6, photos: 75 });
  assert.equal(activeGrow("grow", rec.grow), null);
  assert.equal(readGrow({ to: "grow", steps: 5, paidCents: 1 }), null);
  assert.equal(readGrow({ to: "launch", steps: 2, paidCents: 1 }), null);
  const p = sanitizeProfile({ cities: ["A, TX", "B, TX", "C, TX", "D, TX", "E, TX"] }, "starter", 2);
  assert.equal(p.cities.length, 5);
  assert.equal(sanitizeProfile({ cities: ["A, TX", "B, TX", "C, TX", "D, TX"] }, "starter").cities.length, 3);
});

test("the offer shows the next step, and the one-time upgrade is cheaper by what was paid", () => {
  assert.equal(growthOffer("free", null), null);
  assert.equal(growthOffer("signature", null), null);
  const o0 = growthOffer("launch", null)!;
  assert.equal(o0.to, "grow");
  assert.equal(o0.next.step, 1);
  assert.equal(o0.next.cents, 2000);
  assert.deepEqual(o0.next.adds, { pages: 1, services: 0, photos: 9, cities: 1 });
  const o2 = growthOffer("launch", { to: "grow", steps: 2, paidCents: 4000 })!;
  assert.equal(o2.next.step, 3);
  assert.equal(o2.upgradeLeftCents, 6000);
  assert.equal(doorCharge("launch", "grow", null, "2026-11-22", 4000).cents, 6000);
  assert.equal(doorCharge("launch", "grow", null, "2026-11-22").cents, 10000);
});

test("advancing: partial steps are saved, the fifth step moves the door up", () => {
  assert.deepEqual(advance("launch", null, 1, 2000), { grow: { to: "grow", steps: 1, paidCents: 2000 }, upgrade: false });
  assert.deepEqual(advance("launch", { to: "grow", steps: 1, paidCents: 2000 }, 2, 4000), { grow: { to: "grow", steps: 3, paidCents: 6000 }, upgrade: false });
  assert.equal(advance("launch", { to: "grow", steps: 4, paidCents: 8000 }, 1, 2000).upgrade, true);
  assert.equal(advance("launch", null, GROW_STEPS, 10000).upgrade, true);
  assert.equal(advance("signature", null, 1, 2000).upgrade, false);
});

/** A SQLite database shaped like D1 with what the growth payment touches. */
function env() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE usage_counters (company_id INTEGER NOT NULL, feature TEXT NOT NULL, period TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, feature, period));");
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);");
  db.exec("CREATE TABLE companies (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, plan TEXT, settings TEXT, notify_email TEXT, created_at TEXT, stripe_customer_id TEXT);");
  db.exec("INSERT INTO companies (id, slug, name, plan) VALUES (3, 'tyler', 'Tyler Painters', 'starter');");
  const wrap = (st: any, a: any[]) => ({
    async first() { return (st.get(...a) as any) ?? null; },
    async run() { st.run(...a); return { meta: { changes: 1 } }; },
    async all() { return { results: st.all(...a) }; },
  });
  const DB = { prepare(sql: string) { const st = db.prepare(sql); return { bind: (...a: any[]) => wrap(st, a), ...wrap(st, []) }; }, async batch(s: any[]) { for (const x of s) await x.run(); return []; } };
  return { DB } as any;
}

test("a paid step adds room once; the fifth moves the door to Contractor with its credits", async () => {
  const e = env();
  assert.equal(await applyGrowthSteps(e, 3, "grow", 1, "cs_1", 2000), "steps");
  assert.equal(await applyGrowthSteps(e, 3, "grow", 1, "cs_1", 2000), "ignored"); // same payment reported twice
  let d = await loadDoor(e, 3, "starter");
  assert.equal(d.door, "launch");
  assert.equal(d.rec.grow?.steps, 1);
  assert.equal(d.limits.pages, 6);
  assert.equal(await applyGrowthSteps(e, 3, "grow", 2, "cs_2", 4000), "steps");
  d = await loadDoor(e, 3, "starter");
  assert.equal(d.rec.grow?.steps, 3);
  assert.equal(await applyGrowthSteps(e, 3, "grow", 2, "cs_3", 4000), "upgraded");
  d = await loadDoor(e, 3, "starter");
  assert.equal(d.door, "grow");
  assert.equal(d.rec.grow, undefined);
  assert.deepEqual(d.limits, { pages: 10, services: 6, photos: 75 });
  const today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal((await creditView(e, 3, today)).balance, 500); // the door's credits, once
  // A payment for a door that is not next is ignored.
  assert.equal(await applyGrowthSteps(e, 3, "grow", 1, "cs_4", 2000), "ignored");
  assert.equal(await applyGrowthSteps(e, 3, "free", 1, "cs_5", 2000), "ignored");
});
