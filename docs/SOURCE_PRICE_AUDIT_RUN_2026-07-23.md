# Source Price Audit Run - 2026-07-23

## Purpose

Read-only verification of Price Research source rows before any broad price
publication or correction. The runner never writes to `watch_records`.

## Durable checkpoint

- Rows scanned: `940,000`
- Source-backed eligible rows: `75,821`
- Withheld rows: `864,179`
- Cohorts with at least five structurally eligible observations: `1,775`
- Output directory: local, ignored `outputs/source-price-cohorts-canary/`

## Important exclusions observed

The largest gates at the latest report were unsplit bundle parents, ambiguous
or unverified currency, catalog model/dial mismatches, and ambiguous reference
segmentation. These records remain excluded rather than being assigned a price
or included in market analytics.

## Execution issue

The initial 30,000-row runner timed out. Restarting with 5,000-row checkpoints
worked through 940,000 rows. The next batch ended with a Railway/Supabase
network `fetch failed` error. The wrapper stopped itself after the failure.

Do not start another automatic retry loop until the Railway connection path is
verified. Resume manually from the persisted checkpoint with a bounded batch,
then confirm the checkpoint advances before continuing.

## Release implication

This audit is evidence gathering only. It does not approve corrections and it
does not make the currently unmerged emoji-bullet price-isolation fix live.
