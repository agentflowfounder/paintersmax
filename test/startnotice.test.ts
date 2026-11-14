import test from "node:test";
import assert from "node:assert/strict";
import { noticeIsDue, noticeMinute, noticePlan, sendStartNotices, startNoticeEmail } from "../src/startnotice.ts";
import { cleanSchedule } from "../src/schedule.ts";

// US local time is UTC minus 6 hours. 2026-11-16 is a Monday, so tomorrow's start is 2026-11-17.
const at = (local: string) => Date.parse(local + "Z") + 6 * 3600 * 1000; // "2026-11-16T09:00:00" local -> epoch

test("the notice goes out at the start time, but never before 8 AM or after 7 PM", () => {
  assert.equal(noticeMinute(""), 8 * 60);
  assert.equal(noticeMinute("06:30"), 8 * 60);
  assert.equal(noticeMinute("13:15"), 13 * 60 + 15);
  assert.equal(noticeMinute("22:00"), 19 * 60);
  assert.equal(noticeMinute("garbage"), 8 * 60);
});

test("noticeIsDue: only the day before, inside the window, once", () => {
  const s = { start: "2026-11-17", startNotice: true as const };
  assert.equal(noticeIsDue(s, at("2026-11-16T07:59:00")), false); // too early
  assert.equal(noticeIsDue(s, at("2026-11-16T08:00:00")), true);
  assert.equal(noticeIsDue(s, at("2026-11-16T19:59:00")), true);
  assert.equal(noticeIsDue(s, at("2026-11-16T20:00:00")), false); // window closed
  assert.equal(noticeIsDue(s, at("2026-11-15T10:00:00")), false); // two days before
  assert.equal(noticeIsDue(s, at("2026-11-17T09:00:00")), false); // the day itself
  assert.equal(noticeIsDue({ ...s, noticed: "2026-11-17" }, at("2026-11-16T10:00:00")), false); // already sent
  assert.equal(noticeIsDue({ ...s, noticed: "2026-11-10" }, at("2026-11-16T10:00:00")), true); // an old date does not count
  assert.equal(noticeIsDue({ start: "2026-11-17" }, at("2026-11-16T10:00:00")), false); // painter did not ask
  assert.equal(noticeIsDue({ ...s, startTime: "13:00" }, at("2026-11-16T12:00:00")), false);
  assert.equal(noticeIsDue({ ...s, startTime: "13:00" }, at("2026-11-16T13:05:00")), true);
});

test("noticePlan tells the painter where the notice stands when saving", () => {
  const now = at("2026-11-16T10:00:00");
  assert.equal(noticePlan({ start: "2026-11-20" }, now), "none");
  assert.equal(noticePlan({ start: "2026-11-20", startNotice: true }, now), "queued");
  assert.equal(noticePlan({ start: "2026-11-17", startNotice: true }, now), "queued");
  assert.equal(noticePlan({ start: "2026-11-17", startNotice: true }, at("2026-11-16T21:00:00")), "soon");
  assert.equal(noticePlan({ start: "2026-11-16", startNotice: true }, now), "soon");
  assert.equal(noticePlan({ start: "2026-11-17", startNotice: true, noticed: "2026-11-17" }, now), "sent");
});

test("cleanSchedule keeps the notice choice and language, and drops them when unticked", () => {
  const base = { start: "2026-11-17", end: "2026-11-19", startTime: "08:00", crew: ["Luis"], notes: "Gate code 1234" };
  assert.deepEqual(cleanSchedule({ ...base, startNotice: true, noticeLang: "es" }).schedule, { ...base, startNotice: true, noticeLang: "es" });
  assert.deepEqual(cleanSchedule({ ...base, startNotice: true }).schedule?.noticeLang, "en");
  assert.equal("startNotice" in (cleanSchedule(base).schedule as object), false);
  assert.equal("startNotice" in (cleanSchedule({ ...base, startNotice: "yes" }).schedule as object), false);
});

test("the email names the day, time, address and plan, and never the crew notes", () => {
  const o = { es: false, customer: "Ana Perez", company: "Tyler Painters", title: "Fence", start: "2026-11-17", end: "2026-11-19", startTime: "08:00", address: "12 Oak St, Dallas, 75201" };
  const en = startNoticeEmail(o);
  assert.equal(en.subject, "We start tomorrow: Tyler Painters");
  assert.match(en.body, /^Hi Ana,/);
  assert.match(en.body, /When: Tue, Nov 17 at 8:00 AM/);
  assert.match(en.body, /Address: 12 Oak St, Dallas, 75201/);
  assert.match(en.body, /work through Thu, Nov 19/);
  assert.doesNotMatch(en.body, /Gate code|\$/);
  const es = startNoticeEmail({ ...o, es: true });
  assert.match(es.subject, /^Mañana empezamos/);
  assert.match(es.body, /^Hola Ana,/);
  assert.match(es.body, /a las 8:00 AM/);
  const oneDay = startNoticeEmail({ ...o, end: "2026-11-17", startTime: "", address: "" });
  assert.doesNotMatch(oneDay.body, /work through|Address:| at /);
});

function fakeEnv(rows: any[]) {
  const runs: { sql: string; args: unknown[] }[] = [];
  const env: any = {
    RESEND_API_KEY: "test",
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return { all: async () => ({ results: rows }), run: async () => { runs.push({ sql, args }); } };
          },
        };
      },
    },
  };
  return { env, runs };
}

test("sendStartNotices emails once, records it, and skips jobs that are not due", async () => {
  const sent: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: any, init: any) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as any;
  try {
    const due = { id: 5, company_id: 1, title: "Fence", customer: "Ana Perez", email: "ana@example.com", address: "12 Oak St", city: "Dallas", zip: "75201", company: "Tyler Painters", notify_email: "tyler@example.com", data: JSON.stringify({ schedule: { start: "2026-11-17", end: "2026-11-17", startTime: "", crew: [], notes: "private", startNotice: true, noticeLang: "en" } }) };
    const already = { ...due, id: 6, data: JSON.stringify({ schedule: { start: "2026-11-17", startNotice: true, noticed: "2026-11-17" } }) };
    const { env, runs } = fakeEnv([due, already]);
    assert.equal(await sendStartNotices(env, at("2026-11-16T09:00:00")), 1);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["ana@example.com"]);
    assert.equal(sent[0].reply_to, "tyler@example.com");
    assert.match(sent[0].subject, /We start tomorrow/);
    assert.doesNotMatch(sent[0].text, /private/);
    assert.ok(runs.some((r) => /schedule\.noticed/.test(r.sql) && r.args[0] === "2026-11-17" && r.args[2] === 5));
    assert.ok(runs.some((r) => /INSERT INTO job_events/.test(r.sql)));
    // Outside the 8 AM to 8 PM window nothing is sent.
    sent.length = 0;
    assert.equal(await sendStartNotices(env, at("2026-11-16T06:00:00")), 0);
    assert.equal(sent.length, 0);
    // A failed send is not recorded, so the next run tries again.
    globalThis.fetch = (async () => new Response("no", { status: 500 })) as any;
    const f = fakeEnv([due]);
    assert.equal(await sendStartNotices(f.env, at("2026-11-16T09:00:00")), 0);
    assert.equal(f.runs.length, 0);
    // No email key: nothing happens.
    const g = fakeEnv([due]);
    g.env.RESEND_API_KEY = "";
    assert.equal(await sendStartNotices(g.env, at("2026-11-16T09:00:00")), 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
