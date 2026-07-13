# Pending Rollout Instructions

Last updated: 2026-07-12

## Current verified state

- Trading Floor reads live data with server-side pagination.
- The production composite Trading Floor index has a verified index-scan plan.
- The Google Drive export is accessible and staged-import tooling is committed.
- Normalization v4 has deterministic regression coverage for HKD context,
  ambiguous dollar signs, price pairs, discounts, bundles, WTS/WTB, and brand
  inference.
- Price Research uses comparable WTS cohorts and standard 1.5x IQR fences.

## Before merging PR #1

1. Wait for Vercel Preview and Supabase Preview checks to pass on the latest commit.
2. Verify `/trading` returns listings and pagination/filter/search work.
3. Verify `/api/ingest?page=1&pageSize=50` returns `status: ok`.
4. Test `/api/price-research` with one exact reference having at least ten records.
5. Confirm no production migration contains a destructive statement.
6. Review the final PR diff and merge only after the Preview smoke test passes.

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
