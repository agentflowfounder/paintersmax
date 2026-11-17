import { test } from "node:test";
import assert from "node:assert/strict";
import { callFal, modelInput, promptFor, readImageAiSettings } from "../src/imageai.ts";
import { configOf } from "../templates/configs.ts";
import { CREDIT_COST } from "../src/credits.ts";

const cfg = configOf("sunset-sand")!;
const hero = cfg.imageSlots.find((s) => s.slot === "HOME-HERO")!;

test("image ai: off by default, settings are cleaned", () => {
  assert.equal(readImageAiSettings(undefined).enabled, false);
  const s = readImageAiSettings({ enabled: true, dailyCap: 9999, draftModel: "evil/model", qualityModel: "fal-ai/nano-banana-2" });
  assert.deepEqual(s, { enabled: true, dailyCap: 100, draftModel: "fal-ai/flux/schnell", qualityModel: "fal-ai/nano-banana-2" });
  assert.equal(CREDIT_COST.site_image, 3);
  assert.equal(CREDIT_COST.site_image_draft, 1);
});

test("image ai: every photo space has four prompts and the story spaces are all 600x750", () => {
  for (const sl of cfg.imageSlots) assert.equal(sl.prompts?.length, 4, sl.slot);
  for (const n of [1, 2, 3, 4]) {
    const sl = cfg.imageSlots.find((s) => s.slot === `STORY-${n}`)!;
    assert.deepEqual([sl.w, sl.h, sl.ratio], [600, 750, "4:5"]);
    for (const p of sl.prompts!) assert.match(p, /600x750/);
  }
});

test("image ai: prompt comes from the template; the note is short and plain", () => {
  assert.equal(promptFor(hero, 0, undefined), hero.prompts![0]);
  assert.equal(promptFor(hero, 5, undefined), hero.prompts![1]);
  assert.equal(promptFor(hero, -1, undefined), hero.prompts![3]);
  const p = promptFor(hero, 0, "warmer <b>light</b>\nplease " + "x".repeat(300));
  assert.ok(!p.includes("<") && !p.includes("\n") && p.length < hero.prompts![0].length + 140);
});

test("image ai: model input keeps the shape of the photo space", () => {
  const draft = modelInput("fal-ai/flux/schnell", hero, "p") as any;
  assert.equal(draft.image_size.width % 16, 0);
  assert.ok(Math.abs(draft.image_size.width / draft.image_size.height - 1.6) < 0.05);
  assert.equal((modelInput("fal-ai/nano-banana-2", hero, "p") as any).aspect_ratio, "16:10" === hero.ratio ? "auto" : hero.ratio);
});

test("image ai: calls fal with the key, accepts only fal media hosts and image types", async () => {
  const bytes = new Uint8Array(2000).fill(7);
  const mk = (url: string, type = "image/jpeg") => (async (u: any, init?: any) => {
    const s = String(u);
    if (s.startsWith("https://fal.run/")) {
      assert.equal(init.headers.authorization, "Key secret123");
      return new Response(JSON.stringify({ images: [{ url, width: 1024, height: 640 }] }), { status: 200 });
    }
    return new Response(bytes, { status: 200, headers: { "content-type": type } });
  }) as typeof fetch;
  const env: any = { FAL_KEY: "secret123" };
  const ok = await callFal(env, "fal-ai/flux/schnell", {}, mk("https://v3.fal.media/files/x.jpg"));
  assert.equal(ok?.w, 1024);
  assert.equal(await callFal(env, "fal-ai/flux/schnell", {}, mk("https://evil.example/x.jpg")), null);
  assert.equal(await callFal(env, "fal-ai/flux/schnell", {}, mk("http://v3.fal.media/x.jpg")), null);
  assert.equal(await callFal(env, "fal-ai/flux/schnell", {}, mk("https://v3.fal.media/x.html", "text/html")), null);
  assert.equal(await callFal({} as any, "fal-ai/flux/schnell", {}, mk("https://v3.fal.media/x.jpg")), null);
});
