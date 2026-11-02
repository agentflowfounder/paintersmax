# PaintersMax

Website plus AI quote tool for painting companies.

## Layout
- `public/` — PaintersMax marketing site (paintersmax.app)
- `wrangler.jsonc` — Cloudflare Worker config that serves `public/`

## Deploy
Cloudflare dashboard → Workers & Pages → Create → Import a repository → pick this repo.
Cloudflare builds and deploys on every push to `main`. Then add the custom domain `paintersmax.app` under the Worker's Settings → Domains & Routes.

API keys (Anthropic, Stripe, Resend) go in the Worker's Settings → Variables and Secrets, never in this repo.

## Roadmap
1. PaintersMax landing page on paintersmax.app
2. DFW Painters site on dfwpainters.pro (replaces the old `paintersmax-v2` Worker)
3. AI quote form: job details in, price range out, lead saved (D1) and emailed (Resend)
4. Lead dashboard for painting companies
5. Stripe subscription signup
