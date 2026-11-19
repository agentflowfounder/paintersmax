import { escapeHtml as e } from "./settings.ts";
import type { Block } from "./sitecore.ts";
import { videoHtml } from "./ytcore.ts";

/** Markup for the two newer blocks, shared by every template. Styles live in /templates/_platform/<v>/blocks.css, behavior in blocks.js. */

const L = {
  en: { play: "Play video", wx: "Painting weather", good: "Good day to paint", poor: "Not ideal", rain: "rain", wind: "wind", loading: "Loading the forecast…", kinds: { intro: "Meet us", testimonial: "Hear from a customer", message: "A message from us", how: "How we work" } },
  es: { play: "Ver video", wx: "Clima para pintar", good: "Buen día para pintar", poor: "No es ideal", rain: "lluvia", wind: "viento", loading: "Cargando el pronóstico…", kinds: { intro: "Conózcanos", testimonial: "Un cliente opina", message: "Un mensaje nuestro", how: "Cómo trabajamos" } },
} as const;

export function videoBlock(b: Extract<Block, { type: "video" }>, lang: "en" | "es", companyName: string): string {
  const t = L[lang];
  const head = b.heading || t.kinds[b.kind];
  return `<div class="pm-vblock pm-vblock-${b.orient}"><h2>${e(head)}</h2>${videoHtml(b.yt, b.orient, head || companyName, t.play)}${b.caption ? `<p class="pm-vcap">${e(b.caption)}</p>` : ""}</div>`;
}

export function weatherBlock(place: string, heading: string, lang: "en" | "es"): string {
  const t = L[lang];
  return `<div class="pm-wx" data-weather="${e(place)}" data-good="${e(t.good)}" data-poor="${e(t.poor)}" data-rain="${e(t.rain)}" data-wind="${e(t.wind)}" data-lang="${lang}"><h2>${e(heading || `${t.wx}: ${place}`)}</h2><div class="pm-wx-days" aria-live="polite"><p class="pm-wx-load">${e(t.loading)}</p></div></div>`;
}
