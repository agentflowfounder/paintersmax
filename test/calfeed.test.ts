import test from "node:test";
import assert from "node:assert/strict";
import { buildIcs, crewToText, fold, parseCrew } from "../src/calfeed.ts";

const job = { jobId: 4, title: "Fence; paint, stain", customer: "Ana Perez", address: "1 Main St, Dallas", start: "2026-11-17", end: "2026-11-19", startTime: "08:30", crew: ["Luis", "Ana"], notes: "Bring ladders\nGate code 1234" };

test("ICS has CRLF, escaped text, all-day multi-day events with an exclusive end", () => {
  const ics = buildIcs("Tyler, Painters jobs", [job], new Date("2026-11-12T00:00:00Z"));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /X-WR-CALNAME:Tyler\\, Painters jobs/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261117/);
  assert.match(ics, /DTEND;VALUE=DATE:20261120/);
  assert.match(ics, /SUMMARY:08:30 Fence\; paint\\, stain - Ana Perez/);
  assert.match(ics, /DESCRIPTION:Crew: Luis\\, Ana\\nBring ladders\\nGate code 1234/);
  assert.match(ics, /DTSTAMP:20261112T000000Z/);
  for (const line of ics.split("\r\n")) assert.ok(line.length <= 75, line);
});

test("single-day job with a time becomes a timed event", () => {
  const ics = buildIcs("x", [{ ...job, end: "2026-11-17" }], new Date("2026-11-12T00:00:00Z"));
  assert.match(ics, /DTSTART:20261117T083000/);
  assert.match(ics, /DURATION:PT8H/);
});

test("fold splits long lines with a leading space", () => {
  const f = fold("X:" + "a".repeat(200));
  assert.ok(f.split("\r\n").every((l) => l.length <= 75));
  assert.equal(f.replace(/\r\n /g, ""), "X:" + "a".repeat(200));
});

test("parseCrew reads name, email, phone and language", () => {
  const c = parseCrew("Luis, luis@x.com, 214-555-0101, es\nAna\nluis, dup@x.com\n\nBo, not-an-email, +1 (214) 555-0102");
  assert.deepEqual(c, [
    { name: "Luis", email: "luis@x.com", phone: "214-555-0101", lang: "es" },
    { name: "Ana", email: "", phone: "", lang: "en" },
    { name: "Bo", email: "", phone: "+1 (214) 555-0102", lang: "en" },
  ]);
  assert.equal(crewToText(c), "Luis, luis@x.com, 214-555-0101, es\nAna\nBo, +1 (214) 555-0102".replace("Bo, +1", "Bo, +1"));
});
