import test from "node:test";
import assert from "node:assert/strict";
import { cleanSchedule, findConflicts, overlaps } from "../src/schedule.ts";

test("cleanSchedule validates dates, time and crew", () => {
  const ok = cleanSchedule({ start: "2026-11-17", end: "2026-11-19", startTime: "08:30", crew: ["Luis", " luis ", "Ana  M", ""], notes: " bring ladders " });
  assert.deepEqual(ok.schedule, { start: "2026-11-17", end: "2026-11-19", startTime: "08:30", crew: ["Luis", "Ana M"], notes: "bring ladders" });
  assert.equal(cleanSchedule({ start: "2026-11-17" }).schedule!.end, "2026-11-17");
  assert.match(cleanSchedule({ start: "2026-02-30" }).error!, /start date/);
  assert.match(cleanSchedule({ start: "2026-11-17", end: "2026-11-16" }).error!, /before/);
  assert.match(cleanSchedule({ start: "2026-01-01", end: "2026-12-31" }).error!, /120/);
  assert.equal(cleanSchedule({ start: "2026-11-17", startTime: "25:00" }).schedule!.startTime, "");
  assert.equal(cleanSchedule({ start: "2026-11-17", crew: Array.from({ length: 20 }, (_, i) => "c" + i) }).schedule!.crew.length, 10);
});

test("overlaps and crew conflicts", () => {
  assert.equal(overlaps({ start: "2026-11-17", end: "2026-11-19" }, { start: "2026-11-19", end: "2026-11-20" }), true);
  assert.equal(overlaps({ start: "2026-11-17", end: "2026-11-18" }, { start: "2026-11-19", end: "2026-11-20" }), false);
  const others = [{ jobId: 2, title: "Fence", start: "2026-11-18", end: "2026-11-20", crew: ["luis", "Bo"] }, { jobId: 3, title: "Deck", start: "2026-12-01", end: "2026-12-02", crew: ["Luis"] }];
  assert.deepEqual(findConflicts({ jobId: 1, start: "2026-11-17", end: "2026-11-18", crew: ["Luis", "Ana"] }, others), [{ crew: "Luis", jobId: 2, title: "Fence" }]);
  assert.deepEqual(findConflicts({ jobId: 2, start: "2026-11-18", end: "2026-11-20", crew: ["Luis"] }, others), []);
});
