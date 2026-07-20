# Batch 002 review control

## Release state

- Batch ID: `f94506b0-17a9-4656-9b51-9e81ed052ab8`
- Pending staged children after v6 reconciliation: 57,569
- Review-ready: 36,861
- Human correction required: 20,708
- Superseded v5 rows retained as blocked audit evidence: 453
- Published by this staging run: 0
- Dealer or seller attribution recovered: 0

The records remain in `watch_staging`. They are not returned by the public
Trading Floor or Price Research APIs until a reviewer approves an individual
row through the audited publication function.

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
- 8,580 normalized listing fingerprints appearing under more than one parent.

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
