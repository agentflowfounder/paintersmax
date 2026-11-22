import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { clearSamples, sampleCount, saveSamplesSetting, seedSamples } from "../src/samples.ts";
import { aiExceptions, siteStuck } from "../src/exceptions.ts";
import { buildTierDemo, fillPlaceholders, TIER_DEMOS } from "../src/tierdemos.ts";
import { grantCredits, creditView } from "../src/credits.ts";
import { readDoorRecord } from "../src/sitecore.ts";

/** SQLite shaped like D1: the real migrations, with prepare/bind/run/first/all/batch. */
function env() {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init", "0004_usage", "0007_wizard_core", "0010_app_settings", "0014_job_file"]) db.exec(readFileSync(new URL(`../migrations/${f}.sql`, import.meta.url), "utf8"));
  const wrap = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => wrap(sql, a),
    run: async () => { const r = db.prepare(sql).run(...(args as any[])); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    first: async () => (db.prepare(sql).get(...(args as any[])) as any) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) as any[] }),
  });
  return { DB: { prepare: (s: string) => wrap(s), batch: async (list: any[]) => { for (const l of list) await l.run(); return []; } }, db } as any;
}

test("sample content is added once, marked, and cleared without touching real rows", async () => {
  const e = env();
  e.db.exec("INSERT INTO companies (id, slug, name) VALUES (7, 'tyler', 'Tyler')");
  assert.equal((await seedSamples(e, 7, "en")).seeded, true);
  assert.equal((await seedSamples(e, 7, "en")).seeded, false);
  assert.equal(await sampleCount(e, 7), 2);
  // A real customer and job the painter added later.
  e.db.exec("INSERT INTO customers (id, company_id, name) VALUES (900, 7, 'Real Customer')");
  e.db.exec("INSERT INTO jobs (company_id, customer_id, title) VALUES (7, 900, 'Real job')");
  const r = await clearSamples(e, 7);
  assert.ok(r.removed >= 3);
  assert.equal(await sampleCount(e, 7), 0);
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE company_id = 7").get().n, 1);
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM customers WHERE company_id = 7").get().n, 1);
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM documents").get().n, 0);
});

test("sample content can be turned off for new accounts, and Spanish accounts get Spanish samples", async () => {
  const e = env();
  e.db.exec("INSERT INTO companies (id, slug, name) VALUES (8, 'a', 'A'), (9, 'b', 'B')");
  await saveSamplesSetting(e, false);
  assert.equal((await seedSamples(e, 8, "en")).seeded, false);
  await saveSamplesSetting(e, true);
  assert.equal((await seedSamples(e, 9, "es")).seeded, true);
  assert.match(e.db.prepare("SELECT title FROM jobs WHERE company_id = 9").get().title, /^Ejemplo/);
});

test("exceptions: failing AI tools and stuck paid sites", () => {
  const rows = [{ tool: "estimate_draft", model: "m", calls: 10, ok: 6, errorPct: 40 }, { tool: "chat", model: "m", calls: 2, ok: 0, errorPct: 100 }, { tool: "ok", model: "m", calls: 20, ok: 20, errorPct: 0 }];
  const x = aiExceptions(rows);
  assert.equal(x.length, 1);
  assert.equal(x[0].severity, "high");
  assert.equal(siteStuck("free", null, 90, "2026-11-22"), null);
  assert.equal(siteStuck("launch", null, 3, "2026-11-22"), null);
  assert.match(siteStuck("grow", null, 9, "2026-11-22")!, /never published/);
  assert.match(siteStuck("grow", "2026-08-01T00:00:00Z", 100, "2026-11-22")!, /not published/);
});

test("two credit grants that land at the same moment both survive", async () => {
  const e = env();
  e.db.exec("INSERT INTO companies (id, slug, name) VALUES (5, 'c', 'C')");
  await Promise.all([1, 2, 3, 4].map((n) => grantCredits(e, 5, { id: `pay:${n}`, credits: 100, source: "pack" }, "2026-11-22")));
  assert.equal((await creditView(e, 5, "2026-11-22")).balance, 400);
  // The same payment reported twice adds once.
  await grantCredits(e, 5, { id: "pay:1", credits: 100, source: "pack" }, "2026-11-22");
  assert.equal((await creditView(e, 5, "2026-11-22")).balance, 400);
});

test("tier demo sites build, publish and stay out of client counts", async () => {
  assert.ok(!fillPlaceholders({ x: ["a [fill this] b"] }).x[0].includes("["));
  const e = env();
  for (const d of TIER_DEMOS) {
    const r = await buildTierDemo(e, d, "2026-11-22T00:00:00Z");
    assert.deepEqual(r, { slug: d.slug, ok: true });
    const co = e.db.prepare("SELECT id, plan FROM companies WHERE slug = ?").get(d.slug);
    assert.ok(e.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(`sitelive:${co.id}`));
    assert.equal(readDoorRecord(JSON.parse(e.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(`sitedoor:${co.id}`).value)).door, d.door);
  }
  // Rebuilding does not create duplicates.
  await buildTierDemo(e, TIER_DEMOS[0], "2026-11-23T00:00:00Z");
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM companies WHERE slug LIKE 'demo-%'").get().n, 2);
});

test("admin-edited sample text is used, always keeps the word Sample, and Spanish keeps its own", async () => {
  const e = env();
  e.db.exec("INSERT INTO companies (id, slug, name) VALUES (21, 'a', 'A'), (22, 'b', 'B')");
  await saveSamplesSetting(e, true, { customer: "Pat Lee", job: "Kitchen cabinets", worker: "Sample Crew Lead", note: "Hello" });
  await seedSamples(e, 21, "en");
  assert.equal(e.db.prepare("SELECT name FROM customers WHERE company_id = 21").get().name, "Sample: Pat Lee");
  assert.equal(e.db.prepare("SELECT title FROM jobs WHERE company_id = 21").get().title, "Sample: Kitchen cabinets");
  assert.equal(e.db.prepare("SELECT name FROM workers WHERE company_id = 21").get().name, "Sample Crew Lead");
  await seedSamples(e, 22, "es");
  assert.match(e.db.prepare("SELECT name FROM customers WHERE company_id = 22").get().name, /ejemplo/i);
});

test("tier demos rebuild by themselves only after they were built once and something changed", async () => {
  const { syncTierDemos, buildAllTierDemos, TIER_DEMO_SIG_KEY } = await import("../src/tierdemos.ts");
  const e = env();
  assert.equal(await syncTierDemos(e), "none"); // never auto-creates
  await buildAllTierDemos(e, "2026-11-22T00:00:00Z");
  assert.equal(await syncTierDemos(e), "same");
  e.db.prepare("UPDATE app_settings SET value = ? WHERE key = ?").run(JSON.stringify({ sig: "old limits" }), TIER_DEMO_SIG_KEY);
  assert.equal(await syncTierDemos(e, "2026-12-01T00:00:00Z"), "rebuilt");
  assert.equal(await syncTierDemos(e), "same");
});
