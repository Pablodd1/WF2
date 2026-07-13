# Railway Shadow Normalization Worker

This worker accelerates the archive scan without exposing Supabase credentials
to the browser or changing `watch_records`. It writes only:

- `normalization_shadow_v4`
- `normalization_shadow_checkpoints`
- `normalization_worker_leases`

## Before deployment

Apply this migration in the **WatchFacts production Supabase SQL Editor**:

```text
supabase/migrations/20260713030000_normalization_worker_lease.sql
```

The lease prevents the Railway worker and Vercel cron from advancing the same
checkpoint simultaneously.

## Railway configuration

1. Create a new Railway service from `Pablodd1/wf`.
2. Railway detects `railway.json`; do not expose a public domain for this
   service.
3. Add these service environment variables from the existing WatchFacts Vercel
   Production configuration:

```text
SUPABASE_URL=<existing production value>
SUPABASE_SERVICE_ROLE_KEY=<existing production value>
SHADOW_JOB_NAME=normalization-v4-production
SHADOW_BATCH_SIZE=1000
SHADOW_ROWS_PER_LEASE=10000
SHADOW_IDLE_DELAY_MS=15000
```

4. Deploy one replica only. Do not configure multiple replicas.
5. Verify Railway logs show `worker_started`, then `lease_complete`.
6. Check production progress at:

```text
https://watchfacts-poc.vercel.app/api/shadow-status
```

## Throughput tuning

Start with the values above. If several `lease_complete` cycles finish cleanly,
increase `SHADOW_BATCH_SIZE` to `2000`, then separately increase
`SHADOW_ROWS_PER_LEASE` to `20000`. Keep exactly one replica and preserve the
lease migration.

Once the worker is advancing reliably, remove the Vercel shadow-normalize cron
from `vercel.json` in a separate deployment. Never run both without the lease.
