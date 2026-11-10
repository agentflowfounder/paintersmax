import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "./types.ts";

/**
 * Turns a finished HTML document into a real PDF with Cloudflare Browser Rendering.
 * Returns null when the browser is unavailable (local dev, plan limit, error) so callers can fall back to HTML.
 * JavaScript is turned off: documents are plain HTML and must never run scripts.
 */
export async function htmlToPdf(env: Env, html: string): Promise<Uint8Array | null> {
  if (!env.BROWSER) return null;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    const pdf = await page.pdf({ format: "letter", printBackground: true, margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" } });
    return pdf;
  } catch (err) {
    console.error("pdf failed", String(err));
    return null;
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}

const b64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64Text = (s: string) => b64(new TextEncoder().encode(s));

/** Email attachment for a document: a PDF when possible, otherwise the printable HTML page. `base` has no extension. */
export async function documentAttachment(env: Env, base: string, html: string): Promise<{ filename: string; content: string }> {
  const pdf = await htmlToPdf(env, html);
  return pdf ? { filename: `${base}.pdf`, content: b64(pdf) } : { filename: `${base}.html`, content: b64Text(html) };
}
