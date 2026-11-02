# PaintersMax

Website plus AI quote tool for painting companies. One Cloudflare Worker serves the static site (`public/`) and the API (`src/`).

## How it works
- `POST /api/quote` validates the form, calculates a price range in code (`src/pricing.ts`), asks an AI model to write a short friendly explanation (`src/ai.ts`), saves the lead and quote in D1, and emails the company through Resend.
- The AI never sets prices. Numbers come from the rate table; each company will be able to override rates later (`companies.settings`).
- Routing (edit in `src/ai.ts`): simple jobs go to Gemini, jobs with photos go to OpenAI, commercial and apartment jobs go to Anthropic. If a provider has no key or fails, the next one is tried, and with no keys at all it returns a canned "demo" summary.
- `GET /api/health` shows which keys are set (true/false only, never values).
- Try the form at `/quote`.

## Secrets (Cloudflare: worker -> Settings -> Variables and Secrets). Never commit these.
`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`
Set `NOTIFY_EMAIL` (plain variable) to where lead alerts should go.

## Database
D1 database `paintersmax-db`. Schema is in `migrations/`. New migrations: `npm run db:remote` (needs a Cloudflare login) or run the SQL in the Cloudflare D1 console.

## Local development
```
npm install
npm run db:local
npm run dev        # http://localhost:8787
npm test
```

## Roadmap
1. [done] Landing page, quote API, database, lead email
2. DFW Painters site on dfwpainters.pro
3. Company login and lead dashboard
4. Photo uploads and before/after images (OpenAI)
5. Stripe subscriptions and per-plan usage limits
6. Text alerts (Twilio) after A2P registration
