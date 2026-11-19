/** Pure YouTube helpers (no network, no database), safe to use anywhere. */

/** A YouTube video id out of a pasted link (watch, youtu.be, shorts, embed, live) or a bare 11-character id. */
export function parseYouTube(input: unknown): { id: string; short: boolean } | null {
  const v = typeof input === "string" ? input.trim() : "";
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return { id: v, short: false };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "").toLowerCase();
  let id = "";
  let short = false;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? "";
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = u.searchParams.get("v") ?? "";
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) {
      id = parts[1] ?? "";
      short = parts[0] === "shorts";
    }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? { id, short } : null;
}

export type Orient = "wide" | "tall";
export const cleanOrient = (v: unknown): Orient => (v === "tall" ? "tall" : "wide");

/** The embed address. `hero` plays muted and looped (browsers only autoplay muted video). */
export function embedUrl(id: string, o: { hero?: boolean; autoplay?: boolean } = {}): string {
  const q = ["rel=0", "modestbranding=1", "playsinline=1"];
  if (o.hero) q.push("autoplay=1", "mute=1", "loop=1", `playlist=${id}`, "controls=0");
  else if (o.autoplay) q.push("autoplay=1");
  return `https://www.youtube-nocookie.com/embed/${id}?${q.join("&")}`;
}
export const thumbUrl = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/**
 * A click-to-play video card: shows the thumbnail and loads the player only when tapped, so a page with videos stays fast
 * and no YouTube cookie is set until a visitor plays. blocks.js (platform) swaps the button for the iframe.
 * `orient` sets the frame: wide is 16:9, tall is 9:16 (phone video, shorts) shown at a phone-like width.
 */
export function videoHtml(id: string, orient: Orient, title: string, playLabel: string): string {
  return `<div class="pm-video pm-video-${orient}" data-yt="${id}"><button type="button" class="pm-video-play" aria-label="${esc(playLabel)}: ${esc(title)}" style="background-image:url(${thumbUrl(id)})"><span class="pm-video-btn" aria-hidden="true"></span></button><noscript><a href="https://www.youtube.com/watch?v=${id}">${esc(title)}</a></noscript></div>`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The hero video: autoplay, muted, loop, no controls. Wide and tall both fill the hero card. */
export function heroVideoHtml(id: string, orient: Orient): string {
  return `<div class="pm-video pm-video-hero pm-video-${orient}" data-yt-hero="${id}"><iframe src="${embedUrl(id, { hero: true })}" title="Video" allow="autoplay; encrypted-media; picture-in-picture" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}

