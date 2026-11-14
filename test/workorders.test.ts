import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanWo, renderWorkOrder, woLabel, woTotalCents } from "../src/workorders.ts";

test("cleans input and drops empty lines", () => {
    const b = cleanWo({ scope: "  Fix fascia ", lines: [{ description: "Boards", qty: 2, unitCents: 5000 }, { description: "", qty: 1, unitCents: 100 }, { description: "Zero", qty: 0, unitCents: 100 }], daysAdded: -3, language: "es" });
    assert.equal(b.scope, "Fix fascia");
    assert.equal(b.lines.length, 1);
    assert.equal(b.daysAdded, 0);
    assert.equal(b.language, "es");
});
test("adds up the total in code", () => {
    assert.equal(woTotalCents([{ description: "a", qty: 1.5, unitCents: 10000 }, { description: "b", qty: 2, unitCents: 2550 }]), 20100);
});
test("labels WO and CO", () => {
    assert.equal(woLabel("work_order", 3), "WO-3");
    assert.equal(woLabel("change_order", 4), "CO-4");
});
test("renders escaped text and an approve form only when pending with a token", () => {
    const base = { company: "Tyler <b>Painters", customer: "Ana", jobTitle: "House", number: 1, kind: "change_order", title: "Extra <script>", body: cleanWo({ scope: "x", lines: [{ description: "Boards", qty: 1, unitCents: 10000 }] }), status: "sent" };
    const pending = renderWorkOrder({ ...base, token: "t" });
    assert.ok((pending).includes("data-d=\"approve\""));
    assert.ok(!(pending).includes("<script>Extra"));
    assert.ok((pending).includes("$100.00"));
    const done = renderWorkOrder({ ...base, status: "approved", decidedBy: "Ana", decidedAt: "2026-11-13 10:00:00", token: "t" });
    assert.ok(!(done).includes("data-d=\"approve\""));
    assert.ok((done).includes("Approved"));
    assert.ok(!(renderWorkOrder({ ...base })).includes("data-d=\"approve\""));
});


import { changeOrderInvoiceLines } from "../src/workorders.ts";
test("approved change orders become labelled invoice lines; sent ones are counted as pending", () => {
  const body = (lines: unknown[]) => JSON.stringify({ scope: "x", reason: "", lines, daysAdded: 0, language: "en" });
  const r = changeOrderInvoiceLines([
    { number: 3, kind: "change_order", title: "Hall", status: "approved", body: body([{ description: "Repaint hallway ceiling", qty: 1, unitCents: 25000 }, { description: "Extra primer", qty: 2, unitCents: 1500 }]) },
    { number: 4, kind: "change_order", title: "Gate", status: "sent", body: body([{ description: "Gate", qty: 1, unitCents: 9000 }]) },
    { number: 5, kind: "change_order", title: "Declined", status: "declined", body: body([{ description: "Nope", qty: 1, unitCents: 9000 }]) },
    { number: 6, kind: "work_order", title: "WO", status: "approved", body: body([{ description: "Work order", qty: 1, unitCents: 9000 }]) },
    { number: 7, kind: "change_order", title: "Broken", status: "approved", body: "{not json" },
  ]);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[0].description, "CO-3 Repaint hallway ceiling");
  assert.equal(r.totalCents, 28000);
  assert.equal(r.pending, 1);
});
