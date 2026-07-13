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

A cursor-paged, protected read-only production sample analyzed 1,000 distinct
records with normalization v4. Results:

- 718 records flagged (71.8%). Flags overlap because a row can require more
  than one correction or review action.
- `BUNDLE_SPLIT_REQUIRED`: 259
- `NO_CANDIDATE`: 165
- `REFERENCE_CHANGED`: 132
- `INTENT_CHANGED`: 104
- `PRICE_CHANGED`: 66
- `BRAND_CHANGED`: 60
- `CURRENCY_CHANGED`: 12

The result was not persisted because the additive shadow tables are not yet in
the production Supabase schema.

## Immediate blocker

Apply this additive migration in the production Supabase SQL Editor:

`supabase/migrations/20260713003000_normalization_shadow_v4.sql`

The repository also contains the idempotent, new-timestamp retry migration
`supabase/migrations/20260713012000_apply_normalization_shadow_v4.sql`. It is
for Supabase Git integration, which deploys only new migration files from
`main` when its Deploy to production setting is enabled.

The configured production `DATABASE_URL` is malformed for direct Postgres use:
its host resolves as `base`. The shadow worker no longer depends on it and no
longer runs DDL from Vercel. Do not restore automatic DDL. Apply the checked-in
SQL in Supabase, then repair or remove the obsolete `DATABASE_URL` separately.

Expected status before migration:

```json
{"status":"schema_pending","total":0,"changed":0,"pending":0,"bundles":0,"flagCounts":{}}
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
