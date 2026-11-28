# Plan limits audit (2026-11-28)

Decision from Rogelio: KEEP every limit as it is. No code changes. Limits are checked and reviewed again before launch on 2026-12-01.

| Limit | Free / Local Pro / Contractor / Commercial | What it protects | Safeguard in place |
|---|---|---|---|
| Vehicles | 1 / 2 / 5 / 25 | Storage and clutter | Plan count enforced on add |
| Services on profile | Open (all) | None | Round 10 |
| Cities a painter may pick | Open, up to 30 | None | Round 10 |
| Published city pages | 1 / 3 / 10 / 30 | Page writing cost | Publish follows the plan |
| File storage | 0.5 GB / 2 GB / 10 GB / 50 GB | Cloud storage cost | Quota with warning |
| Single file size | 8 MB | Upload size | Photos shrunk automatically |
| Commercial bids | 0 / 0 / 1 / unlimited | AI estimate cost | Plan count |
| Monthly AI allowances | per feature, see src/usage.ts PLAN_LIMITS | AI cost | Monthly ceiling plus credits |
| Google address lookup | Free: off. Paid: 150 a day per company | Google Places cost | Daily allowance; Free uses our city list |
| Visitor daily caps | 3 to 10 a day per visitor | Abuse | Per-visitor caps |
| Customer photo uploads per job | 12 | Abuse of customer link | Count cap |
| Credit records | 200 per account | Database guard | Count cap |
| Free credit window | 90 days | Trial cost | Pricing setting |
| Builder rate sheets | No cap found | n/a | n/a |

AI spend alert: the daily limit (Admin > AI health) warns at 50%, 80% and 100%. It does not pause AI. AI_KILL_SWITCH=1 is the only stop.
