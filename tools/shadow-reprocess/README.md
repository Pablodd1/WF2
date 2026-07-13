# Normalization v4 shadow reprocessor

This worker reads existing `watch_records`, computes normalization v4 proposals,
and writes only to `normalization_shadow_v4`. It never updates live listings.

Start with:

```text
DRY_RUN=true
MAX_ROWS=1000
BATCH_SIZE=250
```

After reviewing dry-run output and applying the shadow migration, run with
`DRY_RUN=false`. Checkpoints make repeated bounded runs resumable.

Required secrets:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
```

This container can run as a Railway service, Render background worker, or Cloud
Run Job. Railway is the fastest operational path if the project is already connected.

## Targeted remediation

After a parser correction, re-evaluate one existing shadow-review bucket before
changing any live data. The remediation worker updates only
`normalization_shadow_v4`; it never writes `watch_records`.

Start with a bounded dry run:

```text
DRY_RUN=true
REMEDIATION_FLAG=PRICE_PARSE_FAILED
REMEDIATION_MAX_ROWS=1000
REMEDIATION_BATCH_SIZE=250
node tools/shadow-reprocess/remediate-shadow-flag.cjs
```

Review the `cleared` and `stillFlagged` totals. Only then run the same bounded
job with `DRY_RUN=false`. Increase the maximum gradually after each measured
result; do not run a full bucket blindly.

