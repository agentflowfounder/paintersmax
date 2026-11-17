import type { ThemeRenderCtx } from "./_shared/ctx.ts";
import { render as sand100 } from "./sunset-sand/render.ts";

/** id@version -> drawing function. Legacy templates (classic, bold) are drawn by src/siterender.ts and are not listed. */
export const RENDERERS: Record<string, (x: ThemeRenderCtx) => string> = {
  "sunset-sand@1.0.0": sand100,
};
