import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDesign, FREE_SAVES, isPng, MAX_SETS, needsCredit, readLogos } from "../src/logos.ts";

const png = new Uint8Array(200); [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => (png[i] = b));

test("logos: only real PNG files are accepted", () => {
  assert.equal(isPng(png), true);
  assert.equal(isPng(new Uint8Array(200)), false);
  assert.equal(isPng(new Uint8Array([0x89, 0x50])), false);
  assert.equal(isPng(new TextEncoder().encode("<svg onload=alert(1)>".padEnd(200))), false);
});

test("logos: state is cleaned, capped at 4 sets, and the active set must exist", () => {
  const sets = Array.from({ length: 7 }, (_, i) => ({ id: `${i}`.repeat(12).slice(0, 12), name: `<b>L${i}</b>`, kind: i % 2 ? "upload" : "studio", design: { concept: "x", primary: "red", name: "<i>Co</i>" }, v: 2, at: "t" }));
  const st = readLogos({ sets: [...sets, { id: "bad" }], activeId: sets[1].id, used: "3" });
  assert.equal(st.sets.length, MAX_SETS);
  assert.equal(st.activeId, sets[1].id);
  assert.equal(st.used, 3);
  assert.equal(st.sets[0].name.includes("<"), false);
  assert.deepEqual([st.sets[0].design?.concept, st.sets[0].design?.primary, st.sets[0].design?.name], ["box", "#1f3a5f", "iCo/i"]);
  assert.equal(st.sets[1].design, undefined);
  assert.equal(readLogos({ sets: [], activeId: "zzzzzzzzzzzz" }).activeId, "");
  assert.deepEqual(readLogos(null), { sets: [], activeId: "", used: 0 });
});

test("logos: the first 4 design saves are free, then 1 credit; admin never pays", () => {
  assert.equal(needsCredit({ sets: [], activeId: "", used: FREE_SAVES - 1 }, false), false);
  assert.equal(needsCredit({ sets: [], activeId: "", used: FREE_SAVES }, false), true);
  assert.equal(needsCredit({ sets: [], activeId: "", used: 50 }, true), false);
  assert.equal(cleanDesign(null), undefined);
});
