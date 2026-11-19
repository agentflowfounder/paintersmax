import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_SB, TEMPLATES, buildInput, checkPrompt, cleanSettings, estimate, expired, fieldsFrom, finalPrompt, isFalMedia, isModelId, isQueueUrl, mediaIn, missingRequired,
  pollJob, refund, reserve, spent, cleanItem, SAFETY_TAIL,
} from "../src/sandbox.ts";
import { cleanLanding, renderLanding } from "../src/landing.ts";

/** SQLite shaped like D1, with real change counts so compare-and-swap works. */
function realEnv(extra: Record<string, unknown> = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE companies (id INTEGER PRIMARY KEY, slug TEXT);INSERT INTO companies (id, slug) VALUES (1, 'paintersmax-master');");
  db.exec("CREATE TABLE usage_counters (company_id INTEGER NOT NULL, feature TEXT NOT NULL, period TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, feature, period));");
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);");
  const DB = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      const bound = (...a: any[]) => ({
        async first() { return (st.get(...a) as any) ?? null; },
        async run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; },
        async all() { return { results: st.all(...a) }; },
      });
      return { bind: bound, ...bound() };
    },
  };
  const r2 = new Map<string, { body: Uint8Array; type: string }>();
  const FILES = {
    async put(k: string, v: any, o: any) {
      const body = v instanceof ArrayBuffer ? new Uint8Array(v) : typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(await new Response(v).arrayBuffer());
      r2.set(k, { body, type: o?.httpMetadata?.contentType });
    },
    async get(k: string) { const o = r2.get(k); return o ? { size: o.body.byteLength, body: o.body } : null; },
    async delete(k: string) { r2.delete(k); },
  };
  return { env: { DB, FILES, FAL_KEY: "k-secret", ...extra } as any, db, r2 };
}

// Shaped like fal's real OpenAPI for a text-to-video model.
const OPENAPI = {
  paths: {
    "/fal-ai/demo/video": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/DemoInput" } } } } } },
    "/fal-ai/demo/video/requests/{request_id}": { get: {} },
  },
  components: {
    schemas: {
      DemoInput: {
        required: ["prompt"],
        properties: {
          prompt: { type: "string" },
          duration: { type: "string", enum: ["4s", "6s", "8s"], default: "8s", title: "Duration" },
          aspect_ratio: { type: "string", enum: ["16:9", "9:16"], default: "16:9" },
          resolution: { type: "string", enum: ["720p", "1080p"] },
          generate_audio: { type: "boolean", default: true },
          num_frames: { anyOf: [{ type: "integer", minimum: 10, maximum: 100 }, { type: "null" }] },
          steps: { type: "integer", enum: [10, 20] },
          image_url: { type: "string" },
          negative_prompt: { anyOf: [{ type: "string" }, { type: "null" }] },
          seed: { type: "integer" },
          sync_mode: { type: "boolean" },
          webhook_url: { type: "string" },
        },
      },
    },
  },
};

test("sandbox: off by default; limits are clamped", () => {
  assert.equal(cleanSettings(null).enabled, false);
  assert.deepEqual(cleanSettings(undefined), DEFAULT_SB);
  const s = cleanSettings({ enabled: true, perRunUsd: 999, dailyUsd: -5, monthlyUsd: "20", keepDays: 1 });
  assert.deepEqual(s, { enabled: true, perRunUsd: 100, dailyUsd: 0, monthlyUsd: 20, keepDays: 7 });
});

test("sandbox: any fal model id is accepted, odd ones are not", () => {
  for (const ok of ["fal-ai/flux/schnell", "fal-ai/kling-video/v2.1/standard/text-to-video", "bytedance/seedance/v1/pro/image-to-video", "fal-ai/flux-pro/v1.1"]) assert.ok(isModelId(ok), ok);
  for (const bad of ["", "flux", "fal-ai/../x", "https://evil.com/x", "fal-ai/x?y=1", "Fal-AI/x"]) assert.ok(!isModelId(bad), bad);
});

test("sandbox: model settings come from the model's own schema", () => {
  const { fields, required } = fieldsFrom(OPENAPI);
  assert.deepEqual(required, ["prompt"]);
  const names = fields.map((f) => f.name);
  assert.deepEqual(names.slice(0, 3), ["aspect_ratio", "duration", "resolution"]);
  for (const hidden of ["prompt", "seed", "sync_mode", "webhook_url"]) assert.ok(!names.includes(hidden), hidden);
  assert.equal(fields.find((f) => f.name === "image_url")!.type, "image");
  assert.deepEqual(fields.find((f) => f.name === "num_frames"), { name: "num_frames", type: "integer", label: "num frames", hint: "", def: undefined, min: 10, max: 100 });
  assert.equal(fields.find((f) => f.name === "steps")!.numeric, true);
  assert.equal(fields.find((f) => f.name === "negative_prompt")!.type, "text");
});

test("sandbox: input keeps only allowed values", () => {
  const { fields, required } = fieldsFrom(OPENAPI);
  const ok = buildInput(fields, { duration: "6s", aspect_ratio: "9:16", generate_audio: false, steps: "20", num_frames: 50.4, image_url: "https://x.com/a.jpg", junk: "drop me", sync_mode: true }, "p");
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.input, { prompt: "p", duration: "6s", aspect_ratio: "9:16", generate_audio: false, steps: 20, num_frames: 50, image_url: "https://x.com/a.jpg" });
    assert.deepEqual(missingRequired(required, ok.input), []);
  }
  assert.equal(buildInput(fields, { duration: "99s" }, "p").ok, false);
  assert.equal(buildInput(fields, { num_frames: 1000 }, "p").ok, false);
  assert.equal(buildInput(fields, { image_url: "http://insecure/a.jpg" }, "p").ok, false);
});

test("sandbox: prompts keep other brands and real people out; the helper adds no text, no logos", () => {
  assert.equal(checkPrompt("a wall painted in Sherwin-Williams green").ok, false);
  assert.equal(checkPrompt("a celebrity painting a fence").ok, false);
  assert.equal(checkPrompt("hi").ok, false);
  const c = checkPrompt("  a fresh navy\nliving room wall  ");
  assert.ok(c.ok && c.prompt === "a fresh navy living room wall");
  assert.ok(finalPrompt("x", true, "image").endsWith(SAFETY_TAIL));
  assert.match(SAFETY_TAIL, /no text.*no logos/i);
  assert.equal(finalPrompt("x", false, "image"), "x");
  assert.equal(finalPrompt("music", true, "audio"), "music");
});

test("sandbox: price estimates follow fal's billing unit", () => {
  assert.equal(estimate({ unitPrice: 0.08, unit: "images", currency: "USD" }, { num_images: 3 }, 2).usd, 0.24);
  assert.equal(estimate({ unitPrice: 0.003, unit: "megapixels", currency: "USD" }, {}, 2).usd, 0.003);
  const v = estimate({ unitPrice: 0.15, unit: "seconds", currency: "USD" }, { duration: "8s", resolution: "1080p" }, 2);
  assert.equal(v.usd, 1.2);
  assert.match(v.note, /Higher resolution/);
  assert.equal(estimate({ unitPrice: 0.1, unit: "seconds", currency: "USD" }, {}, 2).usd, 0.5); // 5 seconds assumed
  assert.equal(estimate({ unitPrice: 0.05, unit: "1000 characters", currency: "USD" }, { prompt: "x".repeat(1500) }, 2).usd, 0.1);
  const gpu = estimate({ unitPrice: 0.00017, unit: "compute seconds", currency: "USD" }, {}, 2);
  assert.deepEqual([gpu.usd, gpu.rough], [2, true]);
  assert.deepEqual([estimate(undefined, {}, 1.5).usd, estimate(undefined, {}, 1.5).rough], [1.5, true]);
});

test("sandbox: daily and monthly limits stop runs; refunds give the money back", async () => {
  const { env } = realEnv();
  const s = cleanSettings({ enabled: true, perRunUsd: 2, dailyUsd: 1, monthlyUsd: 1.5 });
  const now = Date.UTC(2026, 10, 17, 18);
  const a = await reserve(env, s, 0.6, now);
  assert.ok(a.ok);
  const b = await reserve(env, s, 0.6, now);
  assert.equal(b.ok, false);
  assert.match((b as any).error, /today's limit/);
  assert.deepEqual(await spent(env, now), { todayUsd: 0.6, monthUsd: 0.6 });
  // Next day: the day is fresh, but the month stops it.
  const tomorrow = now + 86400000;
  assert.ok((await reserve(env, s, 0.8, tomorrow)).ok);
  const c = await reserve(env, s, 0.15, tomorrow);
  assert.match((c as any).error, /month's limit/);
  assert.equal((await spent(env, tomorrow)).todayUsd, 0.8, "a refused month leaves the day as it was");
  if (a.ok) await refund(env, a.mills, a.day, a.month);
  assert.equal((await spent(env, now)).todayUsd, 0);
  assert.equal((await spent(env, tomorrow)).monthUsd, 0.8);
  assert.equal((await reserve(env, s, 5, now)).ok, false, "one run can never pass the cap");
});

test("sandbox: only fal's queue and media hosts are trusted", () => {
  assert.ok(isQueueUrl("https://queue.fal.run/fal-ai/flux/requests/abc-123/status"));
  assert.ok(!isQueueUrl("https://queue.fal.run.evil.com/x"));
  assert.ok(!isQueueUrl("http://queue.fal.run/x"));
  assert.ok(isFalMedia("https://v3.fal.media/files/a.mp4"));
  assert.ok(!isFalMedia("https://evil.com/fal.media/a.mp4"));
  const m = mediaIn({ images: [{ url: "https://v3.fal.media/a.png", content_type: "image/png" }, { url: "https://evil.com/b.png" }], video: { url: "https://fal.media/files/c.mp4" }, audio_file: { url: "https://fal.media/d.mp3" }, timings: { url: "https://fal.media/e.png" } });
  assert.deepEqual(m, [{ url: "https://v3.fal.media/a.png", mime: "image/png" }, { url: "https://fal.media/files/c.mp4", mime: "video/mp4" }, { url: "https://fal.media/d.mp3", mime: "audio/mpeg" }]);
});

test("sandbox: a queued job is polled, saved to R2 with a note, and a failed one is refunded", async () => {
  const { env, r2 } = realEnv();
  const s = cleanSettings({ enabled: true, dailyUsd: 5, monthlyUsd: 50 });
  const held = await reserve(env, s, 0.4);
  assert.ok(held.ok);
  if (!held.ok) return;
  const job = { id: "job0001", model: "fal-ai/demo/video", kind: "video", prompt: "wall reveal", statusUrl: "https://queue.fal.run/fal-ai/demo/requests/r1/status", responseUrl: "https://queue.fal.run/fal-ai/demo/requests/r1", mills: held.mills, rough: false, day: held.day, month: held.month, by: "owner@x.com", at: new Date().toISOString(), state: "queued", items: [], tries: 0 };
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").bind("sandbox:job:job0001", JSON.stringify(job)).run();
  let phase = "IN_PROGRESS";
  const video = new Uint8Array(5000).fill(3);
  const f = (async (u: any, init?: any) => {
    const url = String(u);
    if (url.endsWith("/status")) {
      assert.equal(init.headers.authorization, "Key k-secret");
      return new Response(JSON.stringify({ status: phase }), { status: phase === "COMPLETED" ? 200 : 202 });
    }
    if (url.startsWith("https://queue.fal.run/")) return new Response(JSON.stringify({ video: { url: "https://v3.fal.media/files/out.mp4", content_type: "video/mp4" } }), { status: 200 });
    if (url === "https://v3.fal.media/files/out.mp4") return new Response(video, { headers: { "content-type": "video/mp4", "content-length": "5000" } });
    throw new Error("unexpected " + url);
  }) as typeof fetch;
  assert.equal((await pollJob(env, "job0001", f))!.state, "running");
  phase = "COMPLETED";
  const done = await pollJob(env, "job0001", f);
  assert.equal(done!.state, "done");
  assert.equal(done!.items.length, 1);
  const keys = [...r2.keys()].sort();
  assert.equal(keys.length, 2);
  assert.match(keys[0], new RegExp(`^sandbox/${held.month}/[a-z0-9]+\\.json$`));
  assert.match(keys[1], /\.mp4$/);
  const note = JSON.parse(new TextDecoder().decode(r2.get(keys[0])!.body));
  assert.deepEqual([note.prompt, note.model, note.costUsd, note.by, note.aiMade], ["wall reveal", "fal-ai/demo/video", 0.4, "owner@x.com", true]);
  // Polling again does not save twice.
  assert.equal((await pollJob(env, "job0001", f))!.items.length, 1);
  assert.equal([...r2.keys()].length, 2);
  assert.equal((await spent(env)).todayUsd, 0.4);

  // A job fal rejects gives the money back.
  const held2 = await reserve(env, s, 0.3);
  if (!held2.ok) return;
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").bind("sandbox:job:job0002", JSON.stringify({ ...job, id: "job0002", mills: held2.mills })).run();
  const bad = (async (u: any) => (String(u).endsWith("/status") ? new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 }) : new Response(JSON.stringify({ detail: [{ msg: "image_url is required" }] }), { status: 422 }))) as typeof fetch;
  const failed = await pollJob(env, "job0002", bad);
  assert.equal(failed!.state, "failed");
  assert.match(failed!.error!, /image_url/);
  assert.equal((await spent(env)).todayUsd, 0.4);
});

test("sandbox: items are kept 90 days, favorites and public ones forever", () => {
  const now = Date.UTC(2026, 10, 17);
  const old = cleanItem({ id: "abc123", r2: "sandbox/x.png", at: new Date(now - 91 * 86400000).toISOString() })!;
  assert.equal(expired(old, 90, now), true);
  assert.equal(expired({ ...old, fav: true }, 90, now), false);
  assert.equal(expired({ ...old, public: true }, 90, now), false);
  assert.equal(expired({ ...old, at: new Date(now - 10 * 86400000).toISOString() }, 90, now), false);
});

test("sandbox: starter prompts cover the brief and ask for no faces", () => {
  const ids = TEMPLATES.map((t) => t.id);
  for (const id of ["before-after", "painter-at-work", "color-reveal", "mockup", "promo-10s", "thumbnail"]) assert.ok(ids.includes(id), id);
  assert.match(TEMPLATES.find((t) => t.id === "painter-at-work")!.prompt, /face is not visible/);
  assert.deepEqual([TEMPLATES.find((t) => t.id === "promo-10s")!.ratio, TEMPLATES.find((t) => t.id === "promo-10s")!.duration], ["9:16", "10"]);
  for (const t of TEMPLATES) assert.ok(checkPrompt(t.prompt).ok, t.id);
});

test("landing: an AI sandbox image or video shows with a made-with-AI label; a YouTube video wins", () => {
  const img = cleanLanding({ name: "ab", status: "live", media: "abc123def", mediaType: "image" })!;
  const en = renderLanding(img, "en", { origin: "https://paintersmax.app", preview: false });
  assert.match(en, /<img src="\/media\/ai\/abc123def"/);
  assert.match(en, /Image made with AI/);
  assert.match(renderLanding(img, "es", { origin: "https://paintersmax.app", preview: false }), /Imagen hecha con IA/);
  const vid = cleanLanding({ name: "ab", media: "abc123def", mediaType: "video" })!;
  assert.match(renderLanding(vid, "en", { origin: "o", preview: true }), /<video src="\/media\/ai\/abc123def" autoplay muted loop playsinline/);
  const both = cleanLanding({ name: "ab", media: "abc123def", mediaType: "image", yt: "dQw4w9WgXcQ" })!;
  assert.doesNotMatch(renderLanding(both, "en", { origin: "o", preview: true }), /made with AI/);
  assert.equal(cleanLanding({ name: "ab", media: "../x", mediaType: "image" })!.media, "");
  assert.equal(cleanLanding({ name: "ab", media: "abc123def", mediaType: "pdf" })!.media, "");
});
