# CTO rollout status

**Date:** July 21, 2026  
**Scope:** customer marketplace rollout, worker lifecycle, seller lineage, currency, emoji-price safety, taxonomy, and forecast gates

## Executive status

The customer marketplace is live. The All inventory and Want to Buy deep links
now load bounded customer-safe rows directly from Supabase. The completed
normalization cursor is no longer polled indefinitely by Railway. No public
forecast has been released, no uncertain seller identity has been presented as
a verified dealer, and no private contact evidence has been exposed.

## Verified production behavior

| Gate | Evidence | Decision |
| --- | --- | --- |
| Trading Floor all inventory | Approximately 1,551,923 customer-visible rows after excluding legacy non-market types | Accepted as a planner estimate, not an exact billing count |
| Want to Buy | Approximately 183,305 rows; direct production API and deep link both return 48 records with buyer-request actions | Accepted |
| Cursor pagination | 20 pages, 960 unique IDs, zero repeated IDs, advancing cursor on every page | Accepted |
| Initial deep-link load | PR #62 prevents the mount debounce from clearing the first response | Merged after Preview canary |
| Vercel | `watchfacts-poc` and `wf` production deployments succeeded for merge `cef57d5` | Accepted |
| Railway normalization worker | Final log emitted `lease_complete` and `worker_complete`; service status is `Completed` | Stop polling; restart only for a new approved bounded job |
| Currency converter | Production `/api/fx-rates` returns HTTP 200, eight currencies, ECB reference date 2026-07-20, and USD/HKD 7.840626640994223 | Accepted as display-only conversion |

## Seller and source-date lineage

The private seller export and exact raw-message reconciliation produced:

| Metric | Count |
| --- | ---: |
| Seller export rows scanned | 1,293,376 |
| Exact parent matches ready for private staging | 5,350 |
| Mixed or conflicting parent intent rows blocked | 98 |
| Unmatched parents | 44,552 |
| Staged children with exact seller/date evidence | 2,781 |
| Matched WTS children | 1,495 |
| Matched WTB children | 1,286 |
| Seller-aware repost review clusters | 345 |

The 98 blocked rows include mixed WTS/WTB source messages. They must remain
blocked until line segmentation identifies the intent of each child. They must
not contribute to public dealer activity totals.

### Production staging blocker

The additive private tables `seller_listing_lineage_staging` and
`seller_child_lineage_staging` are not present in production; PostgREST returns
`PGRST205` for both. The migrations pass 16 focused safety tests and deny all
`anon` and `authenticated` access, but the production migration ledger and
automatic migration workflow are not yet reconciled. Therefore no lineage rows
were written during this rollout.

Required action:

1. Apply only migrations
   `20260720220000_seller_listing_lineage_staging.sql` and
   `20260721120000_seller_child_lineage_staging.sql` through a stable reviewed
   SQL path.
2. Verify both tables are service-role-only.
3. Stage a 100-parent canary, sample raw message, phone, source timestamp,
   intent, and image filename, then stage the 5,350 exact parent matches.
4. Stage child lineage only after its parent rows exist.
5. Do not assign `dealer_id` or publish contact until an approved directory
   identity and contact consent are proven.

## Emoji-price status

Normalization v4 already decodes standard Unicode keycap digits and full-width
digits while preserving the exact raw price token. An unresolved pictographic
dealer code receives `EMOJI_PRICE_AMBIGUOUS` and is blocked from automatic
promotion. No AI model is allowed to guess the digit, multiplier, currency, or
price represented by a private emoji.

Remaining evidence requirement: add Alex's original raw message examples as
regression fixtures. Screenshots alone are insufficient when the exact Unicode
sequence is unknown.

## Non-watch taxonomy status

Production currently has eight `OTHER` records. All eight come from the
`jewelry_archive` media pilot, have an image, and lack normalized brand and
reference fields. This is enough to label the source cohort as jewelry archive
evidence, but not enough to claim a complete Handbags, Jewelry, Accessories,
and Other marketplace taxonomy.

Required action:

1. Add independent `category` and `intent` fields to the normalized listing
   contract.
2. Classify only from source evidence; leave unresolved values null/review.
3. Add category-specific required fields and filters after the migration has a
   reviewed canary.
4. Do not infer category from an image alone.

## Three-month forecast decision

Keep `ENABLE_PRICE_FORECASTS=false`. The latest read-only audit requested five
recurring John cohorts plus 50 stratified reference cohorts. Zero cohorts were
forecast-ready and zero were release candidates. Current blockers are dated
monthly history, verified seller diversity, recency, sample size for many
cohorts, and measured rolling-backtest performance.

The customer UI may show a forecast-readiness state. It may not show an
expected future price, confidence interval, or directional claim until the
exact reference + dial + condition cohort passes every gate and owner review.

## Product decisions saved

- Use separate pages for Discover, Want to Buy, Price Research, Post, Account,
  Dealer Profile, Settings, Help, and later Billing/Pricing.
- Use explicit `Load more` cursor pagination. Mobile requests 24 rows and
  desktop requests 48; do not use unbounded infinite scroll.
- Mobile discovery uses a sticky search/filter entry and a full-height filter
  sheet. Filters execute in Postgres.
- The currency converter is display-only and never changes stored prices.
- Public browsing remains open. Posting and account changes require auth.
- Billing/Pricing remains hidden until plans, entitlements, taxes, refunds, and
  the payment provider are approved.

## Next safe work order

1. Deploy and canary the two private lineage migrations.
2. Stage 100 exact seller-lineage parents, review evidence, then stage the
   approved 5,350-row cohort privately.
3. Review the 345 seller-aware repost clusters; do not delete source evidence.
4. Add Alex's exact emoji-price messages to regression tests.
5. Design and canary the independent luxury-category migration.
6. Materialize dated, seller-aware comparable cohorts before rerunning
   forecast readiness.
7. Resume image-to-child lineage only after parent/child and seller lineage are
   proven.

