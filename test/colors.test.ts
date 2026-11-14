import test from "node:test";
import assert from "node:assert/strict";
import { IMAGE_MODELS, SURFACES, SWATCHES, cleanColorRequest, repaint, repaintPrompt } from "../src/colors.ts";

const img = "data:image/jpeg;base64,AAAA";

test("the request needs a color, a surface and a photo", () => {
  assert.deepEqual(cleanColorRequest({ image: img, hex: "#a3b59b", surface: "walls" }), { hex: "#A3B59B", surface: "walls", mime: "image/jpeg", data: "AAAA" });
  assert.equal((cleanColorRequest({ image: img, hex: "green", surface: "walls" }) as any).error, "Choose a color.");
  assert.equal((cleanColorRequest({ image: img, hex: "#A3B59B", surface: "roof" }) as any).error, "Choose what to paint.");
  assert.equal((cleanColorRequest({ image: img, hex: "#A3B59B", surface: "toString" }) as any).error, "Choose what to paint.");
  assert.equal((cleanColorRequest({ image: "data:application/pdf;base64,AAAA", hex: "#A3B59B", surface: "walls" }) as any).error, "Choose a photo first.");
  assert.equal((cleanColorRequest({ hex: "#A3B59B", surface: "walls" }) as any).error, "Choose a photo first.");
  assert.match((cleanColorRequest({ image: "data:image/png;base64," + "A".repeat(4_000_001), hex: "#A3B59B", surface: "walls" }) as any).error, /too large/);
});

test("the instruction names the surface and the color, and says to change nothing else", () => {
  const p = repaintPrompt("#263A53", "cabinets");
  assert.match(p, /Repaint the cabinets in this photo with the paint color #263A53 \(red 38, green 58, blue 83\)/);
  assert.match(p, /Change only that surface/);
  assert.match(p, /Do not add text, labels, logos or borders/);
});

test("our starter colors are plain names, with no paint brand names or numbers", () => {
  assert.ok(SWATCHES.length >= 12);
  for (const s of SWATCHES) {
    assert.match(s.hex, /^#[0-9A-F]{6}$/);
    assert.doesNotMatch(s.name, /\d|sherwin|benjamin|behr|valspar|ppg|\bSW\b|\bBM\b/i);
  }
  assert.ok(Object.keys(SURFACES).includes("siding"));
});

test("repaint tries the next image model when one is retired, and returns the picture", async () => {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    if (String(url).includes(IMAGE_MODELS[0])) return new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/png", data: "QUJD" } }] } }] }), { status: 200 });
  }) as any;
  try {
    const out = await repaint({ GEMINI_API_KEY: "k" } as any, { hex: "#263A53", surface: "walls", mime: "image/jpeg", data: "AAAA" });
    assert.deepEqual(out, { ok: true, mime: "image/png", data: "QUJD", model: IMAGE_MODELS[1] });
    assert.equal(calls.length, 2);
    // A model set in the settings goes first.
    calls.length = 0;
    await repaint({ GEMINI_API_KEY: "k", MODEL_GEMINI_IMAGE: "my-image-model" } as any, { hex: "#263A53", surface: "walls", mime: "image/jpeg", data: "AAAA" });
    assert.match(calls[0], /my-image-model/);
    // No picture in any answer: a clear failure, never a crash.
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "no" }] } }] }), { status: 200 })) as any;
    const bad = await repaint({ GEMINI_API_KEY: "k" } as any, { hex: "#263A53", surface: "walls", mime: "image/jpeg", data: "AAAA" });
    assert.equal(bad.ok, false);
    assert.equal((await repaint({} as any, { hex: "#263A53", surface: "walls", mime: "image/jpeg", data: "AAAA" })).ok, false);
  } finally {
    globalThis.fetch = real;
  }
});
