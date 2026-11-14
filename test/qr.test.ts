import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeQr, qrSvg } from "../src/qr.ts";

const rows = (q: NonNullable<ReturnType<typeof makeQr>>) => q.modules.map((r) => r.map((c) => (c ? 1 : 0)).join(""));

test("a short address fits version 3 and the picture never changes (checked once with a real decoder)", () => {
  const q = makeQr("https://paintersmax.app/q/dfw-painters", "M")!;
  assert.equal(q.version, 3);
  assert.equal(q.size, 29);
  assert.equal(createHash("sha256").update(rows(q).join("\n")).digest("hex").slice(0, 16), "639d750ba0a79bff");
});

test("finder squares, timing lines and the dark module are in place", () => {
  const q = makeQr("hello", "M")!;
  assert.equal(q.version, 1);
  const m = q.modules;
  for (const [cx, cy] of [[3, 3], [q.size - 4, 3], [3, q.size - 4]]) {
    assert.equal(m[cy][cx], true); // center
    assert.equal(m[cy][cx + 2], false); // light ring
    assert.equal(m[cy][cx + 3], true); // dark ring
  }
  for (let i = 8; i < q.size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0);
    assert.equal(m[i][6], i % 2 === 0);
  }
  assert.equal(m[q.size - 8][8], true);
});

test("size grows with the text, and text that is too long gives null", () => {
  assert.equal(makeQr("a".repeat(14), "M")!.version, 1);
  assert.equal(makeQr("a".repeat(15), "M")!.version, 2);
  assert.ok(makeQr("a".repeat(150), "M")!.version <= 10);
  assert.equal(makeQr("a".repeat(400), "M"), null);
  assert.equal(makeQr("é".repeat(110), "M"), null); // 220 bytes, more than version 10 holds (213)
});

test("the same text always gives the same code, and different text gives a different one", () => {
  assert.deepEqual(rows(makeQr("abc")!), rows(makeQr("abc")!));
  assert.notDeepEqual(rows(makeQr("abc")!), rows(makeQr("abd")!));
});

test("svg has a quiet zone, valid colors only, and a path", () => {
  const s = qrSvg("https://paintersmax.app", { color: "#0F1B2D" })!;
  assert.match(s, /^<svg [^>]*viewBox="0 0 (\d+) \1"/);
  assert.ok(s.includes('fill="#0F1B2D"'));
  assert.ok(qrSvg("x", { color: 'red" onload="x' })!.includes('fill="#000000"'));
  assert.ok(qrSvg("x", { background: "none-ish" })!.includes('fill="none"'));
  assert.equal(qrSvg("a".repeat(400)), null);
});
