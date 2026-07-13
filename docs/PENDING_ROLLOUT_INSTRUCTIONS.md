# Pending Rollout Instructions

Last updated: 2026-07-13

## Current verified state

- Trading Floor reads live data with server-side pagination.
- The production composite Trading Floor index has a verified index-scan plan.
- The Google Drive export is accessible and staged-import tooling is committed.
- Normalization v4 has deterministic regression coverage for HKD context,
  ambiguous dollar signs, price pairs, discounts, bundles, WTS/WTB, and brand
  inference.
- Price Research uses comparable WTS cohorts and standard 1.5x IQR fences.
- Production reports an estimated 2,634,269 `watch_records` rows.
- PR #1 and the production shadow-normalization follow-up are merged.
- `/api/shadow-normalize` supports protected, bounded 200-row batches and
  fails closed to a read-only sample when shadow storage is unavailable.
- A production read-only sample on 2026-07-13 analyzed 200 rows: 143 (71.5%)
  received at least one change/review flag. Counts were bundle split 58,
  no candidate 32, intent 24, reference 20, price 11, brand 8, currency 3.
- Persistence remains disabled until the additive shadow schema is applied.
  The repeating cron is intentionally not enabled while schema status is pending.
- Price Research smoke testing for Rolex 126610LN returned a robust cohort and
  excluded 108 extreme observations, confirming that legacy price contamination
  remains visible but separated from included statistics.

## Completed PR #1 verification

The PR is merged. Production `/api/ingest?page=1&pageSize=10` returns
`status: ok` through server-key access with the multi-million-row estimate.

## Production environment

Read-only Trading Floor requires:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

Server-side ingestion and administrative writes additionally require one of:

```text
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY (legacy)
```

Never expose a secret/server key through a `VITE_` or other browser variable.

## Historical CSV

1. Copy the 2.30 GB Drive CSV into a private Google Cloud Storage bucket.
2. Apply the staging migration.
3. Deploy `tools/drive-import` as a Cloud Run Job.
4. Run the job with a restricted database URL and the private `gs://` URI.
5. Run `tools/drive-import/validate_staging.sql`.
6. Reconcile counts, duplicate IDs, malformed prices, bundle candidates, and
   differences against `public.watch_records`.
7. Do not promote or overwrite normalized rows until the quality report is approved.

## Reprocessing order

```text
staged source rows
-> normalization v4 shadow output
-> compare old vs new fields
-> approve correction rules
-> reprocess affected records in batches
-> refresh analytics
```

Run normalization in shadow mode first. Preserve old values, parser version,
raw evidence, and correction reason for every changed record.

## Green API

Connect Green API only after historical staging and normalization shadow tests
are stable. Every webhook event must first enter `raw_messages`; it must not
write directly to final analytics or Trading Floor tables.

## Credentials

Rotate all credentials previously exposed in chat or source. Production,
Preview, migration, and storage credentials must be separate and least-privilege.
