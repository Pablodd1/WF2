# Image Reconciliation

## Target Behavior

Images attach first to raw messages and source attachments. Later, image analysis can associate one or more image regions with one or more listing candidates.

```text
raw_message
-> message_media
-> listing_candidates
-> optional image_candidate_assertions
```

## Rules

- Do not overwrite text claims with image guesses.
- Use image evidence to confirm or flag mismatch.
- Store image confidence separately from text confidence.
- Collage images may correspond to several listings.
- Missing image should not block raw text migration.

## Required Media Manifest

```text
source_message_id
source_attachment_id
source_group_id
source_timestamp
source_object_key
source_filename
mime_type
source_size
etag
sha256
target_bucket
target_object_key
migration_status
verification_status
error_code
```

## Current Risk

The audit did not confirm a complete media manifest or reliable message-to-image-to-candidate relationship.

## 100-Image Pilot

The pilot deliberately separates **media discovery** from **listing attachment**:

1. `npm run media:seed-manifest` streams the DigitalOcean inventory CSV, verifies public image URLs, and selects a bounded sample. It modifies no listing rows.
2. Set `APPLY_MEDIA_MANIFEST=true` only after the `media_manifest` migration is deployed. This registers reachable objects as `discovered` evidence.
3. `npm run media:pilot` attempts indexed source-ID matching. It defaults to dry-run and requires `APPLY_MEDIA_LINKS=true` before it can call the atomic attachment RPC.
4. A zero-match result is a data-contract finding, not permission to guess. The source database attachment/message relationship must be joined before images appear on customer listings.

Validated pilot evidence (2026-07-16):

- 100 real image objects were selected from the production inventory and returned successful HTTP checks.
- The first 25,001 inventory rows produced 94 image candidates but zero trustworthy direct `watch_records.id` matches.
- Therefore the 100-object pilot is manifest-only. Customer-facing listing attachment remains disabled until the legacy message/attachment lineage is proven.

Required local variables:

```text
MEDIA_INVENTORY_CSV=C:/Users/jasme/Downloads/thecollective-prod_inventory.csv
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
MEDIA_MANIFEST_LIMIT=100
```

