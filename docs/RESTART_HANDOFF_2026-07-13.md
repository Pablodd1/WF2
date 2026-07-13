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
- Normalization v4 regression coverage includes Chinese price and intent forms:
  the HKD Chinese alias and ten-thousand multiplier parse correctly, a Chinese
  HKD section header applies to following bare-dollar prices, and Chinese buy
  requests classify as WTB.
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

That initial read-only sample was not persisted because the shadow schema was
not yet installed at that point. It has since been installed and a persisted,
isolated 10,000-row shadow run has completed.

### Persisted shadow review run

- `rowsAnalyzed`: 10,200
- `changed` / pending review: 7,830
- `BUNDLE_SPLIT_REQUIRED`: 2,712
- `NO_CANDIDATE`: 850
- `REFERENCE_CHANGED`: 1,872
- `INTENT_CHANGED`: 330
- `PRICE_CHANGED`: 1,645
- `BRAND_CHANGED`: 532
- `CURRENCY_CHANGED`: 909
- `CURRENCY_AMBIGUOUS`: 1,250
- `PRICE_PARSE_FAILED`: 328

No rows in `public.watch_records` were modified. The purpose of this result is
to prioritize parser fixes and human-review cohorts, not to auto-promote all
changes. The first review found and corrected two parser hazards: Patek
four-digit suffix references such as `5935A-001`, and six-digit asking prices
such as `195000 USD` being misread as Rolex references.

Protected sample review confirms that the remaining `NO_CANDIDATE` cohort is
mixed and must not be bulk-filled: it includes valid catalog-alias requests
such as `WTB BATMAN 2020+ PLEASE PM`, unsupported-brand references such as
`Carrier W4BB0021`, and lines whose legacy reference must be retained until a
candidate can be proven. Multi-watch inventory messages are correctly retained
as linked bundle proposals rather than flattened into one final listing.

## Shadow schema status

The production schema is now installed. The additive migration remains the
authoritative schema reference:

`supabase/migrations/20260713003000_normalization_shadow_v4.sql`

The repository also contains the idempotent, new-timestamp retry migration
`supabase/migrations/20260713012000_apply_normalization_shadow_v4.sql`.

## 2026-07-13 recovery update

- The production Supabase project has **no GitHub integration**. Pushing new
  migration files to `main` does not apply them to production.
- The current production `DATABASE_URL` is malformed (its host resolves as
  `base`), so it cannot be used as a direct migration connection.
- The authenticated Supabase dashboard is the available execution path. Run
  either shadow migration in its SQL Editor; both are additive and idempotent.
- After a successful SQL Editor run, verify:

  ```text
  https://watchfacts-poc.vercel.app/api/shadow-status
  ```

  It must return `status: "ok"` before creating a temporary trigger token or
  invoking the persisted shadow worker.

The configured production `DATABASE_URL` is malformed for direct Postgres use:
its host resolves as `base`. The shadow worker no longer depends on it and no
longer runs DDL from Vercel. Do not restore automatic DDL. Apply the checked-in
SQL in Supabase, then repair or remove the obsolete `DATABASE_URL` separately.

Historical pre-migration status:

```json
{"status":"schema_pending","total":0,"changed":0,"pending":0,"bundles":0,"flagCounts":{}}
```

## Resume sequence

1. Inspect protected representative samples for each high-volume review flag.
2. Add narrowly targeted parser tests and fixes only where samples demonstrate
   a deterministic issue.
3. Run a second 10,000-row pass after the fixes using a new checkpoint job
   such as `normalization-v4-reference-fix`. This re-evaluates the same
   deterministic cursor cohort and replaces only its shadow proposals, then
   compare flag rates and sample quality.
4. Draft a promotion policy with auto-promote gates and explicit human-review
   reasons. Do not run it until approved.
5. Remove the temporary trigger token after the controlled review cycle.

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
