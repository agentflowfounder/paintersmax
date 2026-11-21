import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanOrient, embedUrl, heroVideoHtml, parseSearch, parseYouTube, readHelp, videoHtml } from "../src/youtube.ts";
import { paintingDay, parseForecast } from "../src/weather.ts";

test("youtube: links of every kind give the same id; junk gives null", () => {
  const id = "dQw4w9WgXcQ";
  for (const u of [`https://www.youtube.com/watch?v=${id}&t=3`, `youtu.be/${id}?si=x`, `https://m.youtube.com/watch?v=${id}`, `https://youtube.com/embed/${id}`, `https://music.youtube.com/watch?v=${id}`, id]) assert.equal(parseYouTube(u)?.id, id, u);
  assert.deepEqual(parseYouTube(`https://youtube.com/shorts/${id}`), { id, short: true });
  for (const bad of ["", "https://evil.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=short", "<script>", null, 5]) assert.equal(parseYouTube(bad as any), null);
});

test("youtube: embeds are privacy-friendly; hero is muted and looped; markup is escaped", () => {
  const id = "dQw4w9WgXcQ";
  assert.match(embedUrl(id), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.match(embedUrl(id, { hero: true }), /mute=1.*loop=1.*playlist=dQw4w9WgXcQ/);
  assert.match(videoHtml(id, "tall", '"><img src=x>', "Play"), /pm-video-tall/);
  assert.doesNotMatch(videoHtml(id, "wide", '"><img src=x>', "Play"), /<img src=x>/);
  assert.match(heroVideoHtml(id, "wide"), /data-yt-hero/);
  assert.equal(cleanOrient("tall"), "tall");
  assert.equal(cleanOrient("x"), "wide");
});

test("youtube: search results keep only real video ids; help map keeps only known spots", () => {
  assert.equal(parseSearch({ items: [{ id: { videoId: "dQw4w9WgXcQ" }, snippet: { title: "T", channelTitle: "C" } }, { id: { videoId: "bad" } }, {}] }).length, 1);
  const m = readHelp({ welcome: { yt: "https://youtu.be/dQw4w9WgXcQ", title: { en: "Hi" } }, nope: { yt: "dQw4w9WgXcQ" }, jobs: { yt: "junk" } });
  assert.deepEqual(Object.keys(m), ["welcome"]);
});

test("weather: forecast converts to F and mph and marks painting days", () => {
  const day = (hiC: number, loC: number, rain: number, kmh: number, rh: number) => ({ displayDate: { year: 2026, month: 3, day: 9 }, maxTemperature: { degrees: hiC, unit: "CELSIUS" }, minTemperature: { degrees: loC, unit: "CELSIUS" }, daytimeForecast: { weatherCondition: { description: { text: "Sunny" } }, precipitation: { probability: { percent: rain } }, wind: { speed: { value: kmh, unit: "KILOMETERS_PER_HOUR" } }, relativeHumidity: rh } });
  const d = parseForecast({ forecastDays: [day(25, 15, 5, 10, 50), day(25, 15, 60, 10, 50), day(38, 25, 0, 5, 40), day(2, -3, 0, 5, 40), day(22, 12, 0, 40, 40), day(22, 12, 0, 5, 95), day(22, 12, 0, 5, 50)] });
  assert.equal(d.length, 5);
  assert.deepEqual([d[0].hiF, d[0].loF, d[0].windMph, d[0].date], [77, 59, 6, "2026-03-09"]);
  assert.deepEqual(d.map((x) => x.good), [true, false, false, false, false]);
  assert.equal(d[1].why, "Rain likely");
  assert.equal(paintingDay(75, 60, 10, 5, 50).good, true);
  assert.equal(paintingDay(75, 60, 10, 20, 50).why, "Too windy");
  assert.deepEqual(parseForecast({}), []);
});

import { cleanSite, DOOR_LIMITS, firstDraft, MAX_WEATHER_PLACES } from "../src/sitecore.ts";

test("site: videos keep a real id and a shape; weather is limited to 2 places and needs Contractor", () => {
  const base: any = firstDraft({ name: "Test Painting", phone: "", email: "", trades: ["interior"], cities: ["Tyler, TX"], lang: "en" } as any, (DOOR_LIMITS as any).grow);
  assert.ok(base);
  const home = base.pages.find((p: any) => p.kind === "home");
  home.blocks.push(
    { id: "v1", type: "video", heading: "Hi", yt: "https://youtu.be/dQw4w9WgXcQ", orient: "tall", kind: "testimonial", caption: "c" },
    { id: "v2", type: "video", heading: "Bad", yt: "https://evil.com/x" },
    { id: "w1", type: "weather", heading: "", place: "Tyler, TX" },
    { id: "w2", type: "weather", heading: "", place: "Dallas, TX" },
    { id: "w3", type: "weather", heading: "", place: "Plano, TX" },
    { id: "w4", type: "weather", heading: "", place: "" },
  );
  base.media = { on: true, heroYt: "https://youtube.com/shorts/dQw4w9WgXcQ", heroOrient: "wide" };
  const grow = cleanSite(base, (DOOR_LIMITS as any).grow, "grow");
  assert.ok(grow.ok);
  if (grow.ok) {
    const bl = grow.site.pages.find((p) => p.kind === "home")!.blocks;
    assert.equal(bl.filter((b) => b.type === "video").length, 1);
    assert.deepEqual(bl.find((b) => b.type === "video"), { id: "v1", type: "video", heading: "Hi", yt: "dQw4w9WgXcQ", orient: "tall", kind: "testimonial", caption: "c" });
    assert.equal(bl.filter((b) => b.type === "weather").length, MAX_WEATHER_PLACES);
    assert.deepEqual(grow.site.media, { on: true, heroYt: "dQw4w9WgXcQ", heroOrient: "tall" });
  }
  const launch = cleanSite(base, (DOOR_LIMITS as any).launch, "launch");
  assert.ok(launch.ok);
  if (launch.ok) assert.equal(launch.site.pages.find((p) => p.kind === "home")!.blocks.filter((b) => b.type === "weather").length, 0);
});
