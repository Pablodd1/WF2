# Batch 002 review control

## Release state

- Batch ID: `f94506b0-17a9-4656-9b51-9e81ed052ab8`
- Pending staged children after v8 reconciliation: 58,945
- Review-ready: 36,772
- Human correction required: 22,173
- Superseded rows retained as blocked audit evidence: 849
- Published by this staging run: 0
- Dealer or seller attribution recovered: 0

The records remain in `watch_staging`. They are not returned by the public
Trading Floor or Price Research APIs until a reviewer approves an individual
row through the audited publication function.

The v8 staging writer checks the existing verdict before every upsert. It may
refresh `PENDING` rows and insert missing rows, but it never overwrites an
`APPROVED`, `REJECTED`, or blocked human decision. At rollout time this batch
had zero approved and zero rejected decisions. Exact reconciliation reported
58,945 expected and existing pending rows, with zero stale or missing rows.

## Admin workflow

`/review-queue` now has two independent lanes:

1. **Unbundled batch 002** reads `watch_staging`, supports full-batch search and
   pagination, and separates review-ready rows from rows needing correction.
2. **Normalization corrections** keeps the existing
   `normalization_shadow_v4` workflow unchanged.

Approval of an unbundled child requires:

- reviewer or administrator authentication;
- an exact preserved raw-child line;
- catalog-confirmed brand and reference;
- a review-ready bucket;
- a valid WTS price and currency when the child is WTS;
- explicit duplicate review acknowledgment.

The transaction writes confidence as exactly `100`, records an immutable audit
snapshot, and publishes one child ID. Rejections require a reason and do not
publish. Rows in the correction lane cannot be approved.

## Duplicate audit

The full staging manifest was audited before enabling publication:

- 335 exact-repeat clusters within the same parent message, covering 704 rows.
- 8,731 normalized listing fingerprints appearing under more than one parent.

Exact repeats in one parent may mean repeated formatting, quantity, or duplicate
inventory and require human review. Cross-parent matches are only repost
candidates. They must not be deleted without seller identity and source-date
lineage.

## Special-dial remediation

The owner-reference audit found that standalone `Tiffany` shorthand could be
lost when a suffixed reference was canonicalized before dial extraction. The
raw-evidence parser now preserves that shorthand as `Tiffany Blue` globally.
All 207 pending batch rows containing exact Tiffany evidence were moved to the
human-correction lane with catalog-dial confirmation set to false. None were
published. A public Trading Floor lookup for a remediated staging ID returned
`404` after reconciliation.

The final v8 rollout repeated that isolation test with staged child
`badf785a-9c5b-5b39-80ba-feb8f15ad6cc`; the production Trading Floor detail
endpoint returned `404`. No `watch_records` row was created by staging or
reconciliation.

## Reference cleanup evidence

The supplied brand-by-brand cleanup examples are now represented in the shared
reference-quality gate and regression suite. Covered failure classes include:

- prices, dates, condition text, and item IDs captured as references;
- accessories such as straps, bracelets, links, boxes, and bags;
- brand-only or model-only values without a source-supported reference;
- wrong-brand references and mixed-brand child lines;
- multiple watch references in one purported child line;
- valid dotted, hyphenated, spaced, vintage, and six-digit brand formats that
  must not be destroyed by over-cleaning.

The gate extracts a correction only when one exact, brand-compatible reference
is visible in the preserved source. Ambiguous rows remain in human correction
with explicit reason codes. It does not select the first plausible reference
from a stock list and does not use catalog data to invent a missing reference.

## Critical references in batch 002

The staged batch contains review work for the owner-tested references:

- Patek Philippe `5712/1A`: 1,261 candidate rows.
- Patek Philippe `5712/1R`: 20 candidate rows, primarily `5712/1R-001`.
- Patek Philippe `3712/1A`: 107 candidate rows.
- Rolex `116500LN`: 345 candidate rows.
- Rolex `52506`: 145 candidate rows.

The sample review found repeated raw lines in the Patek cohorts and both
review-ready and human-correction rows in the Rolex cohorts. These references
should be searched first in the Admin queue and reviewed per dial before broad
publication.

## Remaining blocker

The source records available through production contain original timestamps but
no seller name, seller phone, dealer ID, or region for this batch. The Admin UI
shows `DEALER_ATTRIBUTION_MISSING`; it does not invent contact information.
Dealer lineage must be recovered from another source database/export before
dealer profiles and WhatsApp contact can be complete.
