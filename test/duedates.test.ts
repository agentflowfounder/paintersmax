import test from "node:test";
import assert from "node:assert/strict";
import { dueWords, nextDue, type DueFacts } from "../src/duedates.ts";
import { daysBetween, localDateOf, todayLocal } from "../src/dates.ts";

const base: DueFacts = { stage: "lead", createdAt: "2026-11-10 15:00:00", updatedAt: "2026-11-10 15:00:00" };

test("localDateOf reads database and ISO timestamps in US time", () => {
  assert.equal(localDateOf("2026-11-10 15:00:00"), "2026-11-10");
  assert.equal(localDateOf("2026-11-10 03:00:00"), "2026-11-09"); // 03:00 UTC is still the evening before
  assert.equal(localDateOf("2026-11-10T15:00:00.000Z"), "2026-11-10");
  assert.equal(localDateOf(""), "");
  assert.equal(localDateOf(null), "");
  assert.equal(localDateOf("not a date"), "");
});

test("daysBetween counts whole days, positive when the second date is later", () => {
  assert.equal(daysBetween("2026-11-14", "2026-11-16"), 2);
  assert.equal(daysBetween("2026-11-14", "2026-11-14"), 0);
  assert.equal(daysBetween("2026-11-14", "2026-11-13"), -1);
  assert.equal(daysBetween("2026-02-27", "2026-03-02"), 3);
});

test("a new lead is due a reply the next day", () => {
  assert.deepEqual(nextDue(base), { step: "Reply to the new lead", due: "2026-11-11" });
});

test("a lead with a booked visit is due on the visit day; with a draft estimate it is due to be finished", () => {
  assert.deepEqual(nextDue({ ...base, visitDate: "2026-11-18" }), { step: "Site visit", due: "2026-11-18" });
  assert.deepEqual(nextDue({ ...base, estStatus: "draft", estUpdatedAt: "2026-11-12 16:00:00" }), { step: "Finish and send the estimate", due: "2026-11-14" });
});

test("bid stage: follow up three days after sending, contract the day after signing", () => {
  assert.deepEqual(nextDue({ ...base, stage: "bid", estStatus: "sent", estUpdatedAt: "2026-11-10 16:00:00" }), { step: "Follow up on the estimate", due: "2026-11-13" });
  assert.deepEqual(nextDue({ ...base, stage: "bid", estStatus: "signed", signedAt: "2026-11-11T18:00:00.000Z", estUpdatedAt: "2026-11-11 18:00:00" }), { step: "Build and send the contract", due: "2026-11-12" });
  assert.deepEqual(nextDue({ ...base, stage: "bid", estStatus: "draft", estUpdatedAt: "2026-11-10 16:00:00" }), { step: "Send the estimate", due: "2026-11-12" });
});

test("contract and scheduled stages lead to the calendar and the start day", () => {
  assert.deepEqual(nextDue({ ...base, stage: "contract", signedAt: "2026-11-10 20:00:00" }), { step: "Put the job on the calendar", due: "2026-11-12" });
  assert.deepEqual(nextDue({ ...base, stage: "scheduled", scheduleStart: "2026-11-17" }), { step: "Start the job", due: "2026-11-17" });
  assert.deepEqual(nextDue({ ...base, stage: "scheduled" }), { step: "Put the job on the calendar", due: "2026-11-12" });
});

test("in progress is due on the last scheduled day, or has nothing to suggest without a schedule", () => {
  assert.deepEqual(nextDue({ ...base, stage: "in_progress", scheduleEnd: "2026-11-19" }), { step: "Finish the work", due: "2026-11-19" });
  assert.equal(nextDue({ ...base, stage: "in_progress" }), null);
});

test("punch and invoiced stages lead to the invoice and payment follow-up", () => {
  assert.deepEqual(nextDue({ ...base, stage: "punch" }), { step: "Build and send the invoice", due: "2026-11-11" });
  assert.deepEqual(nextDue({ ...base, stage: "invoiced", invStatus: "sent", invUpdatedAt: "2026-11-10 16:00:00" }), { step: "Follow up on payment", due: "2026-11-17" });
  assert.deepEqual(nextDue({ ...base, stage: "invoiced", invStatus: "draft", invUpdatedAt: "2026-11-10 16:00:00" }), { step: "Send the invoice", due: "2026-11-11" });
  assert.equal(nextDue({ ...base, stage: "invoiced", invStatus: "paid" }), null);
});

test("closed, lost and unknown stages suggest nothing, and unreadable timestamps never throw", () => {
  assert.equal(nextDue({ ...base, stage: "closed" }), null);
  assert.equal(nextDue({ ...base, stage: "lost" }), null);
  assert.equal(nextDue({ ...base, stage: "something_new" }), null);
  assert.equal(nextDue({ stage: "lead", createdAt: "", updatedAt: "" }), null);
  assert.equal(nextDue({ ...base, stage: "bid", estStatus: "sent", visitDate: "bad", estUpdatedAt: "garbage", updatedAt: "2026-11-10 16:00:00" })?.due, "2026-11-13");
});

test("dueWords says today, tomorrow, a weekday, a date, and how late", () => {
  const today = "2026-11-14"; // a Saturday
  assert.deepEqual(dueWords("2026-11-14", today), { when: "today", late: false });
  assert.deepEqual(dueWords("2026-11-15", today), { when: "tomorrow", late: false });
  assert.deepEqual(dueWords("2026-11-17", today), { when: "Tuesday", late: false });
  assert.deepEqual(dueWords("2026-11-20", today), { when: "Friday", late: false });
  assert.equal(dueWords("2026-11-24", today).when, "Tue, Nov 24");
  assert.deepEqual(dueWords("2026-11-13", today), { when: "was due yesterday", late: true });
  assert.deepEqual(dueWords("2026-11-10", today), { when: "was due Tue, Nov 10", late: true });
});

test("todayLocal is the date six hours behind UTC", () => {
  assert.equal(todayLocal(Date.parse("2026-11-14T05:00:00Z")), "2026-11-13");
  assert.equal(todayLocal(Date.parse("2026-11-14T06:00:00Z")), "2026-11-14");
});
