# WF2 — Schema-Drift Repair Approval

**Date:** 2026-08-19
**Status:** Awaiting your approval to run the repair DDL.

---

## The problem (verified)

Applying the 173 migrations to the fresh Supabase project
`iohoffcvrlegkysnolih` produced **158 OK / 15 FAIL**. Every failure traces to
one root defect:

> **`staging.listings` is missing 18 columns that later view-migrations
> reference.** The repo's migration chain is internally inconsistent — the
> `staging.listings` table was defined (by earlier migrations) at 86 columns,
> but later migrations (20260808–20260816) build views and functions that
> `SELECT` 18 additional columns from it as if they existed.

This is the **same class of defect that has been blocking your production
deploy for 2 months** — Codex/Anti-Gravity agents hit `review_count does not
exist` (and the cascade), gave up or papered over it, and never completed a
clean populate.

---

## The 18 missing columns, with resolved types

### Group A — have an authoritative type in the repo (safe to add exactly)

| Column | Type | Source migration |
|---|---|---|
| `review_count` | `integer NOT NULL DEFAULT 0` | 20260718190000 |
| `group_count` | `integer` | 20260814203000 |
| `front_image` | `text` | 20260720220000 |
| `mime_type` | `text` | 20260716230000 |
| `media_fingerprint` | `text` | 20260809000000 |
| `batch_id` | `uuid` | 20260720190000 |

### Group B — computed/aliased in the views (safe to add as nullable)

These are `COALESCE(...)`/`CASE` aliases in the view layer; the view casts
them to `boolean`/`jsonb`/`text`. They go on `staging.listings` as nullable
columns so the view can be materialized:

| Column | Resolved type | Evidence |
|---|---|---|
| `has_exact_source_image` | `boolean` | cast `::boolean` in 20260814192000 |
| `source_image_preserved` | `boolean` | `image_url IS NOT NULL` boolean alias |
| `image_url_resolvable` | `boolean` | `image_url IS NOT NULL` boolean alias |
| `visually_verified` | `boolean` | `COALESCE(visually_verified, false)` |
| `image_provenance` | `jsonb` | provenance blob |
| `attachment_keys` | `jsonb` | `'[]'::jsonb` default |
| `storage_key` | `text` | storage key string |
| `wts_post_count` | `integer` | count alias |
| `wtb_post_count` | `integer` | count alias |
| `transport_checksum` | `text` | checksum string |
| `seller_item_signature` | `text` | signature string |
| `listing_event_signature` | `text` | signature string |

---

## The fix (one idempotent repair migration, kept in WF2)

Add a new migration file, applied AFTER the existing chain, that adds the 18
columns with `ADD COLUMN IF NOT EXISTS`, then re-runs the 15 failed migrations
(now that their dependencies exist).

```sql
-- 20260819000000_wf2_schema_drift_repair.sql
SET statement_timeout = '0';

ALTER TABLE staging.listings
  ADD COLUMN IF NOT EXISTS review_count             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS group_count              integer,
  ADD COLUMN IF NOT EXISTS front_image              text,
  ADD COLUMN IF NOT EXISTS mime_type                text,
  ADD COLUMN IF NOT EXISTS media_fingerprint        text,
  ADD COLUMN IF NOT EXISTS batch_id                 uuid,
  ADD COLUMN IF NOT EXISTS has_exact_source_image   boolean,
  ADD COLUMN IF NOT EXISTS source_image_preserved   boolean,
  ADD COLUMN IF NOT EXISTS image_url_resolvable     boolean,
  ADD COLUMN IF NOT EXISTS visually_verified        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_provenance         jsonb,
  ADD COLUMN IF NOT EXISTS attachment_keys          jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS storage_key              text,
  ADD COLUMN IF NOT EXISTS wts_post_count           integer,
  ADD COLUMN IF NOT EXISTS wtb_post_count           integer,
  ADD COLUMN IF NOT EXISTS transport_checksum       text,
  ADD COLUMN IF NOT EXISTS seller_item_signature    text,
  ADD COLUMN IF NOT EXISTS listing_event_signature  text;
```

Where I'm uncertain of an exact type (pure view aliases), I use the type the
view itself casts to (`boolean`/`jsonb`/`text`/`integer`) — never guessing a
wrong type that would recreate the drift. Then I re-apply only the 15 failed
migrations and verify each returns clean.

---

## Why this is safe

- **Idempotent** (`IF NOT EXISTS`) — can be re-run; no destructive change.
- **Additive only** — no drops, no data loss, no type changes to existing cols.
- **Kept in WF2** — committed as a new migration, so the clean rebuild is
  reproducible; prod `bptrvfncppbjnchsaxtb` is never touched.
- **Verifiable** — after repair, the 15 re-runs must all report success, and I
  confirm `reviewed_workbook_market_source_v2` materializes with no error.

---

## After approval (next actions, in order)

1. Apply repair migration + re-run 15 failed migrations → expect 173/173.
2. You run the MariaDB `(created_on, id)` index as root (still needed for collect).
3. Run collect (1.44M) → import-raw → non-watch audit → normalize → image lineage → publish → verify counts.

---

## Decision

Reply **"approve"** to run the repair DDL now, or name any column whose type
you want handled differently.
