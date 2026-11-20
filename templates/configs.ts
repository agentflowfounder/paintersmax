import type { TemplateConfig } from "../src/sitetheme.ts";
import { config as sunsetSand } from "./sunset-sand/site.config.ts";

/**
 * Every template the platform knows, with every version still in use. Configs only (no drawing code), so the site
 * rules in src/sitecore.ts can check a painter's choices without loading the renderers.
 *
 * Adding a template: make templates/<slug>/ with site.config.ts and render.ts, put its CSS and JS in
 * public/templates/<slug>/<version>/, then add it here and in renderers.ts. Admin turns it on per door.
 * New version of a template: keep the old version's entry and assets so admin can roll back.
 */

const legacy = (id: string, name: string, cls: TemplateConfig["class"], en: string, es: string): TemplateConfig => ({
  configVersion: 1, id, name, version: "1.0.0", class: cls, legacy: true,
  description: { en, es },
  inspiration: "PaintersMax original (first website builder, 2026-11-15).",
  license: "Original PaintersMax code. System fonts and Newsreader (SIL Open Font License).",
  tokens: [], fonts: [], pages: ["home", "services", "gallery", "about", "contact", "service", "custom"], sections: [], blocks: ["instant_quote", "review_request"],
  i18n: { en: {}, es: {} }, imageSlots: [],
  imageProvider: { kind: "none", endpoint: "/api/site/image-ai", ready: false, creditFeature: null },
  seo: { schemaType: "HousePainter", ogImageSlot: null },
  contact: { name: "Sample Painting Co", phone: "(555) 555-0100", email: "hello@sample.example", address: "", city: "", state: "", hours: "" },
  mapsMode: "drawn-only",
});

/** id -> version -> config. */
export const TEMPLATE_VERSIONS: Record<string, Record<string, TemplateConfig>> = {
  classic: { "1.0.0": legacy("classic", "Classic", "free", "Simple and clear. Navy header, white pages. On Free it is one page with five tabs.", "Simple y claro. Encabezado azul marino, páginas blancas. En Gratis es una página con cinco pestañas.") },
  bold: { "1.0.0": legacy("bold", "Bold", "free", "Dark gradient banner and larger type. On Free it is one page with five tabs.", "Portada oscura con degradado y letra más grande. En Gratis es una página con cinco pestañas.") },
  "sunset-sand": { "1.0.0": sunsetSand },
};

/** The newest version of each template (highest semver). */
export function latestVersion(id: string): string | null {
  const v = Object.keys(TEMPLATE_VERSIONS[id] ?? {});
  if (!v.length) return null;
  return v.sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    return 0;
  })[v.length - 1];
}

export const TEMPLATE_IDS = Object.keys(TEMPLATE_VERSIONS);
export const configOf = (id: string, version?: string | null): TemplateConfig | null => {
  const vs = TEMPLATE_VERSIONS[id];
  if (!vs) return null;
  return vs[version ?? ""] ?? vs[latestVersion(id) ?? ""] ?? null;
};
