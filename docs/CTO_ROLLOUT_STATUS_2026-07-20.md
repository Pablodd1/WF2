# CTO rollout status - 2026-07-20

## Completed in this rollout

1. Applied the repository security-hardening migration to production. Optional
   objects that do not exist in the live schema are now skipped safely.
2. Added and applied database-backed quotas for the public paid-AI routes.
   Anonymous and authenticated roles cannot call the quota RPC; service role can.
3. Rechecked the 13 blocked Patek/Rolex dial-review rows. All 12 live Rolex
   `116500LN` rows are already White. The live Rolex `52506` row is already Ice
   Blue. Stale shadow proposals remain isolated from customer data and must not
   overwrite those correct live values.
4. Stopped the completed Railway cursor worker. It was processing zero rows and
   polling Supabase about every five seconds.
5. Ran the requested 200-image exact-lineage pilot. Six records passed every
   source identity and brand/reference gate and were linked. No lower-confidence
   records were published.

## Image pilot evidence

| Metric | Result |
| --- | ---: |
| Raw image filenames | 16,989 |
| Spaces CSV rows scanned | 1,821,738 |
| Filename lineage matches inspected | 1,000 |
| Customer-safe exact matches | 6 |
| Linked | 6 |
| Guessed or force-linked | 0 |

## Current production safeguards

- Raw messages remain preserved.
- WTB observations stay out of asking-price analytics.
- Bundle parents remain visible until reviewed child sets reconcile.
- Images require exact source identity plus brand/reference agreement.
- Paid-AI routes use shared database-backed quotas keyed by a one-way client hash.
- The completed Railway cursor worker is scaled to zero.

## Next inputs and gates

1. Receive the local path to the manually unbundled UTF-8 CSV parts and run the
   1,000-row lineage/intake audit before any staging import.
2. Receive the legacy `auctions` export keyed by `id`, including `front_image`,
   original posting date, seller identity/contact, company, and raw text.
3. Reconcile the 194 unfilled image targets through `auctions.front_image`; keep
   image work after listing lineage and duplicate review.
4. Resolve the 315 blocked children in the existing 25-parent canary before any
   parent is suppressed.
5. Reconcile the production migration ledger and configure protected GitHub
   migration secrets before enabling automatic production migrations.
6. Schedule analytics refresh and database maintenance away from customer traffic.

## Required environment variable

Set a random server-only `AI_RATE_LIMIT_SECRET` in Vercel production and preview.
Until it is set, the server uses the Supabase service-role secret as the HMAC key;
the client address itself is never stored.
