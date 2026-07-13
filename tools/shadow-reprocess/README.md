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

