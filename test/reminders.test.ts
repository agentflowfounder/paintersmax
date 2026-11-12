import test from "node:test";
import assert from "node:assert/strict";
import { reminderDue, reminderText } from "../src/reminders.ts";
import { sanitizeInvoice } from "../src/jobdocs.ts";

test("reminderDue: day 7 then day 14, then stop", () => {
  assert.equal(reminderDue(3, 0), null);
  assert.equal(reminderDue(7, 0), 1);
  assert.equal(reminderDue(10, 1), null);
  assert.equal(reminderDue(14, 1), 2);
  assert.equal(reminderDue(30, 2), null);
  assert.equal(reminderDue(20, 0), 1);
});

test("reminder text never states an amount, in either language", () => {
  for (const es of [false, true]) {
    const t = reminderText({ n: 2, es, customer: "Ana Perez", company: "Tyler Painters", number: "1001", jobTitle: "Fence", notes: "" });
    assert.doesNotMatch(t.subject + t.body, /\$|\d{3,}\.\d\d/);
    assert.match(t.body, /1001|Ana/);
  }
});

test("reminders are off unless explicitly true", () => {
  assert.equal(sanitizeInvoice({}).reminders, false);
  assert.equal(sanitizeInvoice({ reminders: "yes" }).reminders, false);
  assert.equal(sanitizeInvoice({ reminders: true }).reminders, true);
});
