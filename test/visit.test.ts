import test from "node:test";
import assert from "node:assert/strict";
import { addDaysIso, friendlyDate, friendlyTime, isIsoDate, todayLocal } from "../src/dates.ts";
import { cleanVisit, sendVisitReminders, visitEmail, visitIcs, visitWhen } from "../src/visit.ts";
import { portalVisit } from "../src/portal.ts";

test("dates: valid ISO dates, add days, friendly text and local today", () => {
  assert.ok(isIsoDate("2026-11-14"));
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("11/14/2026"));
  assert.equal(addDaysIso("2026-11-30", 1), "2026-12-01");
  assert.equal(addDaysIso("2026-01-01", -1), "2025-12-31");
  assert.equal(friendlyDate("2026-11-17"), "Tue, Nov 17");
  assert.equal(friendlyTime("10:00"), "10:00 AM");
  assert.equal(friendlyTime("00:05"), "12:05 AM");
  assert.equal(friendlyTime("13:30"), "1:30 PM");
  assert.equal(friendlyTime("25:00"), "");
  // 03:00 UTC on Nov 14 is still the evening of Nov 13 in the US
  assert.equal(todayLocal(Date.UTC(2026, 10, 14, 3, 0)), "2026-11-13");
  assert.equal(todayLocal(Date.UTC(2026, 10, 14, 15, 0)), "2026-11-14");
});

test("cleanVisit needs a real date that is not in the past, and keeps the rest tidy", () => {
  assert.match(cleanVisit({}, "2026-11-14").error ?? "", /Pick a date/);
  assert.match(cleanVisit({ date: "2026-11-13" }, "2026-11-14").error ?? "", /today or a day ahead/);
  const ok = cleanVisit({ date: "2026-11-17", time: "10:00", notes: "  bring ladder  ", notify: true, lang: "es" }, "2026-11-14").visit!;
  assert.deepEqual(ok, { date: "2026-11-17", time: "10:00", notes: "bring ladder", notify: true, lang: "es" });
  const loose = cleanVisit({ date: "2026-11-14", time: "9am", notify: "yes", lang: "fr" }, "2026-11-14").visit!;
  assert.equal(loose.time, "");
  assert.equal(loose.notify, false); // emailing is only ever on when explicitly true
  assert.equal(loose.lang, "en");
});

test("visit wording in both languages", () => {
  assert.equal(visitWhen({ date: "2026-11-17", time: "10:00", lang: "en" }), "Tue, Nov 17 at 10:00 AM");
  assert.equal(visitWhen({ date: "2026-11-17", time: "", lang: "en" }), "Tue, Nov 17");
  assert.match(visitWhen({ date: "2026-11-17", time: "10:00", lang: "es" }), /a las 10:00 AM/);
});

test("visit emails state only the date, time and address, and never private notes or money", () => {
  for (const es of [false, true]) {
    for (const kind of ["confirm", "update", "reminder", "cancel"] as const) {
      const t = visitEmail(kind, { es, customer: "Ana Perez", company: "Tyler Painters", when: "Tue, Nov 17 at 10:00 AM", address: "1420 Maple Street, Plano, TX" });
      assert.match(t.subject + t.body, /Tyler Painters/);
      assert.match(t.body, /Ana/);
      assert.match(t.body, /Nov 17/);
      assert.doesNotMatch(t.subject + t.body, /\$\d/);
      if (kind !== "cancel") assert.match(t.body, /Maple Street/);
    }
  }
  assert.match(visitEmail("reminder", { es: false, customer: "Ana", company: "T", when: "w", address: "" }).subject, /tomorrow/);
});

test("visit calendar file: one event, a stable UID, timed or all day, and a cancel version", () => {
  const now = new Date(Date.UTC(2026, 10, 14, 12, 0));
  const timed = visitIcs({ jobId: 7, company: "Tyler Painters", address: "1420 Maple, Plano", date: "2026-11-17", time: "10:00", now });
  assert.match(timed, /UID:visit-7@paintersmax\.app/);
  assert.match(timed, /DTSTART:20261117T100000/);
  assert.match(timed, /DURATION:PT1H/);
  assert.match(timed, /METHOD:PUBLISH/);
  assert.match(timed, /LOCATION:1420 Maple\\, Plano/);
  const allDay = visitIcs({ jobId: 7, company: "T", address: "", date: "2026-11-30", time: "", now });
  assert.match(allDay, /DTSTART;VALUE=DATE:20261130/);
  assert.match(allDay, /DTEND;VALUE=DATE:20261201/);
  const gone = visitIcs({ jobId: 7, company: "T", address: "", date: "2026-11-17", time: "10:00", cancel: true, now });
  assert.match(gone, /METHOD:CANCEL/);
  assert.match(gone, /STATUS:CANCELLED/);
  assert.ok(timed.endsWith("\r\n") && timed.split("\r\n").every((l) => l.length <= 75));
});

/** A tiny stand-in for D1 that returns the rows we give it and remembers the writes. */
function fakeEnv(rows: any[]) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const env: any = {
    RESEND_API_KEY: "k",
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              all: async () => ({ results: sql.startsWith("SELECT") ? rows : [] }),
              run: async () => {
                writes.push({ sql, args });
                return { meta: {} };
              },
              first: async () => null,
            };
          },
        };
      },
    },
  };
  return { env, writes };
}

test("day-before reminder goes out once, only in daytime hours, and is recorded", async () => {
  const realFetch = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = (async (_u: any, init: any) => {
    sent.push(JSON.parse(init.body));
    return new Response("{}", { status: 200 });
  }) as any;
  try {
    const row = { id: 7, company_id: 1, data: JSON.stringify({ visit: { date: "2026-11-17", time: "10:00", notes: "PRIVATE NOTE", notify: true, lang: "en", status: "booked" } }), customer: "Ana Perez", email: "ana@example.com", address: "1420 Maple Street", city: "Plano", zip: "75074", company: "Tyler Painters", notify_email: "owner@example.com" };
    // 9 AM local on Nov 16 (UTC-6): 15:00 UTC
    const a = fakeEnv([row]);
    const n = await sendVisitReminders(a.env, Date.UTC(2026, 10, 16, 15, 0));
    assert.equal(n, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to[0], "ana@example.com");
    assert.match(sent[0].subject, /tomorrow/);
    assert.doesNotMatch(sent[0].text, /PRIVATE NOTE/);
    assert.ok(a.writes.some((w) => /visit\.reminded/.test(w.sql) && w.args[0] === "2026-11-17"));
    // 4 AM local: too early, nothing is sent
    const b = fakeEnv([row]);
    assert.equal(await sendVisitReminders(b.env, Date.UTC(2026, 10, 16, 10, 0)), 0);
    assert.equal(sent.length, 1);
    // no email key: nothing is sent
    const c = fakeEnv([row]);
    c.env.RESEND_API_KEY = "";
    assert.equal(await sendVisitReminders(c.env, Date.UTC(2026, 10, 16, 15, 0)), 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the customer page shows only a booked visit that has not passed", () => {
  const today = todayLocal();
  const soon = addDaysIso(today, 3);
  const mk = (v: unknown) => JSON.stringify({ visit: v });
  assert.match(portalVisit(mk({ status: "booked", date: soon, time: "09:30" }), false, "1 Main St")!.when, /9:30 AM/);
  assert.equal(portalVisit(mk({ status: "booked", date: soon }), false, "1 Main St")!.address, "1 Main St");
  assert.equal(portalVisit(mk({ status: "cancelled", date: soon }), false), null);
  assert.equal(portalVisit(mk({ status: "done", date: soon }), false), null);
  assert.equal(portalVisit(mk({ status: "booked", date: addDaysIso(today, -5) }), false), null);
  assert.equal(portalVisit("{not json", false), null);
  assert.equal(portalVisit(null, false), null);
});
