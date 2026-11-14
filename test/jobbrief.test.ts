import { test } from "node:test";
import assert from "node:assert/strict";
import { briefText, cleanBrief, cleanDraftAI, draftPrompt, JOB_TYPES, JOB_TYPE_IDS } from "../src/jobbrief.ts";
import { quantityOptions, draftLines } from "../src/estimate.ts";

test("job types come in the order the painter asked for, plus an odd-job type", () => {
  assert.deepEqual(JOB_TYPE_IDS, ["interior", "exterior", "power_wash", "commercial", "wood_stain", "custom"]);
  assert.equal(JOB_TYPES.find((t) => t.id === "custom")!.trade, null);
});

test("a brief keeps only real questions and real options", () => {
  const b = cleanBrief({
    type: "interior",
    details: "  Two bedrooms\r\nand a hall  ",
    answers: { areas: ["Kitchen", "Hacked", "Ceilings"], rooms: "3", walls: "Good", height: "Made up", nope: "x" },
    photoNote: "water stain on the ceiling",
  }, "t");
  assert.deepEqual(b.answers.areas, ["Kitchen", "Ceilings"]);
  assert.equal(b.answers.rooms, "3");
  assert.equal(b.answers.walls, "Good");
  assert.equal(b.answers.height, undefined);
  assert.equal((b.answers as any).nope, undefined);
  assert.equal(b.details, "Two bedrooms\nand a hall");
  assert.equal(cleanBrief({ type: "bogus" }).type, "interior");
});

test("the brief is turned into plain lines for the AI", () => {
  const b = cleanBrief({ type: "exterior", answers: { stories: "2", condition: "Peeling or cracking", areas: ["Trim", "Doors"] }, details: "Dog in yard" });
  const t = briefText(b);
  assert.match(t, /Job type: Exterior/);
  assert.match(t, /How many stories\? 2/);
  assert.match(t, /Trim, Doors/);
  assert.match(t, /Painter's notes: Dog in yard/);
});

test("the AI reply is cleaned: only the painter's own price-list keys survive and there are no prices", () => {
  const options = [{ key: "small", label: "Small room", unit: "ea" }, { key: "ceiling", label: "Ceiling", unit: "ea" }];
  const ai = cleanDraftAI({ scope: "Paint the rooms.", quantities: { small: 3, ceiling: "2", hacked: 9, medium: 4, bad: -1 }, extraLines: [{ description: "Spot prime rust", qty: 2, unit: "hr", unitPrice: 999 }, { description: "" }], inclusions: ["Two coats", ""], assumptions: ["x"], questions: ["Who buys paint?"] }, options);
  assert.deepEqual(ai.quantities, { small: 3, ceiling: 2 });
  assert.equal(ai.extraLines.length, 1);
  assert.equal((ai.extraLines[0] as any).unitPrice, undefined);
  assert.deepEqual(ai.inclusions, ["Two coats"]);
  assert.match(draftPrompt(cleanBrief({ type: "interior", details: "x" }), options, "Dallas", []), /small: Small room/);
  assert.doesNotMatch(draftPrompt(cleanBrief({ type: "interior", details: "x" }), options, "Dallas", []), /Spanish/);
  assert.match(draftPrompt(cleanBrief({ type: "interior", details: "x" }), options, "Dallas", [], "es"), /in plain Spanish/);
});

test("the AI's quantities are priced by code from the painter's own list", () => {
  const data = { small: 200, ceiling: 80, base_pct: 10 };
  const options = quantityOptions("per_room", data);
  assert.deepEqual(options.map((o) => o.key).sort(), ["ceiling", "small"]);
  const lines = draftLines("per_room", data, { small: 3, ceiling: 2 }, "interior");
  assert.equal(lines.find((l) => l.description === "Small room")!.unitCents, 20000);
  assert.equal(lines.find((l) => l.description === "Ceiling")!.qty, 2);
  assert.deepEqual(quantityOptions("sqft_wall", { low: 2, high: 3 }).map((o) => o.key), ["sqft"]);
});
