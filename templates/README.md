# Website template library

Painter websites are one Site document each (src/sitecore.ts). A template is a theme that draws that document. The painter's words, pages and photos never depend on the template, so switching templates never loses content.

## Pieces

| Where | What |
| --- | --- |
| `templates/<slug>/site.config.ts` | The template's settings: tokens (colors), fonts, sections (with pages, default order, on/off), platform blocks, English and Spanish words, image slots with AI prompts, `imageProvider`, SEO, placeholder contact, maps mode. |
| `templates/<slug>/render.ts` | Draws one page from the Site document and the painter's theme. |
| `public/templates/<slug>/<version>/` | The template's CSS and JS (served as static files, cached). Old versions stay so admin can roll back. |
| `templates/_shared/` | Icons, the render context type, and the platform blocks every template uses (instant quote, Color Studio, before/after, cities, map, business info, chat helper, estimate form, reviews, gated cards). |
| `public/templates/_platform/1.0.0/` | CSS and JS for the platform blocks. They use the template's tokens, so they match each look. |
| `templates/configs.ts`, `templates/renderers.ts` | The list of templates and versions. |
| `src/sitetheme.ts` | Shared types, the cleaning of a painter's theme choices, font list, Site schema versions and upgrade steps. |
| `src/siteblocks.ts` | Platform blocks with their lowest door, AI-credit cost and ready flag (the feature ladder). |
| `src/sitetemplates.ts` | The registry (admin's settings in app_settings `sitetpl:registry`), door rules, picker list, and drawing a page with the right template and version. |
| `src/sitetemplatesapi.ts` | Admin API (on/off, doors, name, order, note, version rollback, thumbnail), the thumbnail route and the `/api/site/image-ai` hook. |
| `public/templates-admin.html` | Admin screen. `public/site.html` "Look and Google" tab is the client picker and theme editor. |

## Rules every template follows

- Every template defines the shared tokens: `--c-bg --c-bg2 --c-surface --c-ink --c-ink-soft --c-line --c-brand --c-brand-ink --c-accent --c-accent2`, `--f-display --f-body`, `--r-sm --r-md --r-lg --r-pill`.
- Required sections: business info, services, cities, instant quote, Color Studio, before and after, map, chat helper, estimate request form, reviews, footer with a lead form, Spanish toggle and legal links. Tap-to-call and a quote form on every page.
- Contact info in samples is placeholder only (555-01xx, `.example`).
- The Google Maps key is never in a template. The Worker passes `GOOGLE_MAPS_BROWSER_KEY` at serve time; without it the drawn map shows.
- Visitors never see painter-only cards (locked, needs credits, coming soon) or the photo-slot labels. The painter sees them in preview.
- "Create with AI" buttons stay disabled until the in-house image tool is built and `imageProvider.ready` is true.

## Adding a template

1. Make `templates/<slug>/site.config.ts` and `render.ts` (copy sunset-sand's as a start), and `public/templates/<slug>/1.0.0/`.
2. Add it to `templates/configs.ts` and `templates/renderers.ts`.
3. Draw a sample: `node --experimental-strip-types tools/template-sample.ts <slug> /tmp/out preview en`, serve `/tmp/out` with `public/templates` linked at `/templates`, and check 375, 768 and 1280 widths.
4. `npm test` checks the required sections, both languages, placeholder contact and a config swap.

## A new version of a template

Add `templates/<slug>/` changes under a new version (keep the old config and assets), list both versions in `configs.ts` and `renderers.ts`. Sites draw with the newest unless admin pins an older one.

## A new feature on sites

Add a block in `src/siteblocks.ts` (lowest door, credit cost, `ready: false` until its endpoint exists), add its section to the templates that should show it, and if the Site document needs a new field, add an upgrade step in `src/sitetheme.ts` and raise `SITE_SCHEMA`. Old sites keep working.

## Testing a template on a branch preview

Cloudflare builds a test copy of a pull request's branch (separate test database and photo bucket, no cron). In the Cloudflare dashboard open paintersmax-site, Deployments, switch Production to the branch, and open the newest build. "Builds for Preview branches" must be on under Settings, Builds, Previews Base.
