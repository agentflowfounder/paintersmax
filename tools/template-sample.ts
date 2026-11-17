/**
 * Draws every page of a template with a sample company, for design review and screenshots (no database needed).
 *   node --experimental-strip-types tools/template-sample.ts <templateId> <outDir> [preview|live] [en|es]
 * Then serve <outDir> with the repo's public/ folder at /templates (see the template README).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DOOR_LIMITS, firstDraft, pathOf } from "../src/sitecore.ts";
import { renderWithTemplate } from "../src/sitetemplates.ts";

const [id = "sunset-sand", out = "sample-out", mode = "preview", lang = "en"] = process.argv.slice(2);
const site = firstDraft({ name: "Sample Painting Co", phone: "(903) 555-0142", email: "hello@samplepainting.example", address: "100 Sample Street", city: "Tyler", state: "TX", zip: "75701", license: "", trades: ["interior", "exterior", "cabinets"], cities: ["Tyler, TX", "Longview, TX", "Whitehouse, TX", "Lindale, TX"], insured: true, warrantyMonths: 24, lang: lang as "en" | "es" }, DOOR_LIMITS.launch);
site.template = id;
site.business.hours = "Mon to Fri 8 AM to 5 PM";
const file = (p: string) => (p === "/" ? "index.html" : `${p.replace(/^\//, "").replace(/\//g, "_")}.html`);
mkdirSync(out, { recursive: true });
for (const page of site.pages) {
  const html = renderWithTemplate({
    site, page, company: { id: 1, slug: "sample-painting", name: "Sample Painting Co" }, origin: "https://sample-painting.paintersmax.app",
    link: (p) => file(p), quoteHref: "#quote", photoSrc: (pid) => `/photos/${pid}`, cityPages: [], preview: mode === "preview", reviews: [],
  }, { reg: {}, door: "launch", balance: 40, uiLang: lang as "en" | "es", langHref: "#", mapsKey: "" });
  writeFileSync(`${out}/${file(pathOf(page))}`, html);
  console.log(file(pathOf(page)));
}
