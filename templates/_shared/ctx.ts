import type { RenderCtx } from "../../src/siterender.ts";
import type { Door, Lang, TemplateConfig, Theme } from "../../src/sitetheme.ts";

/** Everything a template's renderer gets. Built by src/sitetemplates.ts; templates never read the database. */
export interface ThemeRenderCtx extends RenderCtx {
  cfg: TemplateConfig;
  theme: Theme;
  /** The language of the template's own words (menu, buttons). The painter's text stays in the site's language. */
  uiLang: Lang;
  /** Address of this same page in the other language. */
  langHref: string;
  door: Door;
  /** AI credits left, or null when unknown. */
  balance: number | null;
  /** Google Maps Embed browser key, added by the Worker at serve time. Never stored in a template or the site. */
  mapsKey: string;
  /** "/templates/<id>/<version>/" */
  assetBase: string;
  /** "/templates/_platform/1.0.0/" */
  platformBase: string;
  /** Where forms post leads. */
  leadEndpoint: string;
}
