# WatchFacts Restart Handoff - 2026-07-13

## Production state

- Repository: `Pablodd1/wf`
- Production Vercel project: `watchfacts-poc`
- Production URL: `https://watchfacts-poc.vercel.app`
- Production `/api/ingest` is healthy with server-key access.
- Full archive estimate: 2,634,269 records.
- Market-ready estimate: 2,632,776 dated records.
- Trading Floor has Market-ready and Full archive modes.
- Price Research for Rolex 126610LN returns a robust cohort using 1.5x IQR.
- No live `watch_records` values were changed by the shadow work.

## Normalization evidence

A protected read-only production sample analyzed 200 records with normalization
v4. Results:

- 143 records flagged (71.5%).
- `BUNDLE_SPLIT_REQUIRED`: 58
- `NO_CANDIDATE`: 32
- `INTENT_CHANGED`: 24
- `REFERENCE_CHANGED`: 20
- `PRICE_CHANGED`: 11
- `BRAND_CHANGED`: 8
- `CURRENCY_CHANGED`: 3

The result was not persisted because the additive shadow tables are not yet in
the production Supabase schema.

## Immediate blocker

Apply this additive migration in the production Supabase SQL Editor:

`supabase/migrations/20260713003000_normalization_shadow_v4.sql`

The configured direct `DATABASE_URL` resolves to an IPv6-only Supabase host from
Vercel and its stored password is stale for the available pooler routes. Do not
keep retrying automatic DDL from Vercel. Apply the checked-in SQL in Supabase.

Expected status before migration:

```json
{"status":"schema_pending","total":0,"changed":0,"pending":0,"bundles":0}
```

## Resume sequence

1. Sign in to the production Supabase dashboard.
2. Open SQL Editor and run the shadow migration above.
3. Verify `https://watchfacts-poc.vercel.app/api/shadow-status` returns
   `status: ok`.
4. Configure a temporary `SHADOW_RUN_TOKEN` in Vercel Production.
5. Invoke `GET /api/shadow-normalize` with header `x-shadow-token` set to that
   value. Each call is bounded to 200 records.
6. Confirm shadow totals increase and live `watch_records` remain unchanged.
7. Process 10,000 shadow rows, inspect flag rates and representative samples,
   then approve correction rules before any live promotion.
8. Remove the temporary trigger token after the controlled run.

Do not enable a repeating cron until shadow persistence succeeds and a bounded
sample has been reviewed.

## Verification commands

```bash
npm run test:normalization
npm run build
curl "https://watchfacts-poc.vercel.app/api/ingest?page=1&pageSize=10&quality=market"
curl "https://watchfacts-poc.vercel.app/api/ingest?page=1&pageSize=10&quality=archive"
curl "https://watchfacts-poc.vercel.app/api/shadow-status"
curl "https://watchfacts-poc.vercel.app/api/price-research?reference=126610LN"
```

## Durable requirements

Continue using `AGENTS.md`, `WATCHFACTS_MASTER_SPEC.md`, and the `docs/`
architecture files as the project source of truth. Key rules remain:

- Preserve raw evidence and lineage.
- Never assume `$` means USD.
- Apply section-level HKD context.
- Split bundles before final normalization.
- Keep WTS and WTB separate.
- Preserve and flag outliers.
- Never load millions of records into browser memory.
- Normalize in shadow mode before promoting corrections.
- Connect Green API only after historical normalization is stable.

## UI/UX work

UI/UX work can continue in parallel on a separate branch. Keep API contracts,
route names, review states, and normalization schemas stable. The current
Market-ready/Full archive control is intentional and should be preserved.
