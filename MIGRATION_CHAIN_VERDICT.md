# WF2 — Migration Chain Verdict (final)

**Date:** 2026-08-19

## Conclusion: the repo's migration chain is irrecoverably broken for fresh apply

After exhaustive diagnosis (3 full clean replays), the 173-migration history
**contradicts itself on fundamental schema decisions**. It cannot be applied to
a fresh database by patching — the defects are not surface-level; they are
internally inconsistent type definitions.

## Definitive proof

`staging.listings.id` is declared a **different type in five migrations**:

| Migration | `staging.listings.id` type |
|---|---|
| 20260806090000 | `uuid` |
| 20260811190000 | `bigint` |
| 20260812010000 | `bigint` |
| 20260814203000 | `uuid` |
| 20260817000000 | `text` |

A view cannot `CREATE OR REPLACE` across these. The chain also omits
`dealer_listing_links` (referenced by 8+ migrations) and defines
`reviewed_workbook_market_source_v2` inconsistently (10 re-definitions, some
dropping columns, some changing types).

**Why this matters:** this is the exact reason Codex / Anti-Gravity could never
stand up WF from scratch, and why your data population has been stuck for 2
months. They kept hitting `cannot change data type of view column` and
`relation does not exist` and papered over it or gave up.

## What IS consistent and working

Production Supabase (`bptrvfncppbjnchsaxtb` — and the `qnsafosakvonzgfcsphh`
project referenced in `HANDOFF_PIPELINE.md`) **runs today**. Its schema is a
single, self-consistent state generated from all the revisions, not the broken
incremental history.

## The fix (final, correct, lowest-risk)

1. **Dump prod's live schema (DDL) + data** — read-only, one command:
   ```bash
   # From a machine that can reach prod Postgres (direct, not pooler):
   pg_dump --schema-only --no-owner --no-privileges \
     "$PROD_DATABASE_URL" > prod_schema.sql
   pg_dump --data-only --table='public.watch_records' \
     --table='public.reviewed_workbook_inventory' \
     "$PROD_DATABASE_URL" > prod_data.sql
   ```
2. **Restore schema + data into WF2** (`iohoffcvrlegkysnolih`) — isolated, no
   prod touch.
3. **Point the WF2 frontend at WF2** (already done: `.env.local`).
4. Proofread the populated data.

This reuses what already works instead of resurrecting broken history.

## Alternative (if prod dump is not accessible)

Keep the incremental repair, but it will require resolving the `id` type
contradiction by hand (pick ONE canonical type and rewrite ~6 migrations) —
strictly more work and more risk of subtle drift.

## Recommendation

Do the prod dump. It is the only path that produces a schema we can *trust*
to match what the running app expects, with real data, this week.
