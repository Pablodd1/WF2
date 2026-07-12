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

