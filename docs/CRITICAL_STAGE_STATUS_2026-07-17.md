# Critical Stage Status - 2026-07-17

## Verified production state

- `main` includes the image-showcase and duplicate-audit merges.
- Vercel production is ready at `watchfacts-poc.vercel.app`.
- The Trading Floor image endpoint returns 100 exact-lineage image rows.
- The customer promotion gate permits 39 of those rows and withholds 61 incomplete, implausible, non-WTS, or non-approved rows.
- The 39 remain subject to human image/catalog agreement before the image rail is treated as fully verified inventory.

## Price Research canaries

Production checks were run for the owner-critical references.

| Reference | Total sampled evidence | Eligible observations | Unique offers | Reposts | Selected cohort | Included statistics |
|---|---:|---:|---:|---:|---|---:|
| Patek Philippe 3712/1A | 1,291 | 23 | 10 | 13 | Used / Blue | 9 |
| Patek Philippe 5712/1A | 5,000 capped | 2,487 | 1,053 | 1,434 | Used / Blue | 395 |
| Rolex 116500LN | 5,000 capped | 3,849 | 1,621 | 2,228 | Unknown condition / White | 575 |
| Rolex 52506 | 1,657 | 1,320 | 557 | 763 | New / Blue | 336 |

The API previously labeled every retained exclusion as an outlier. The branch now separates:

- required-field/catalog exclusions;
- reposts counted once;
- plausibility-floor failures;
- IQR statistical outliers.

## Human review contract

- Approval requires one catalog-confirmed candidate.
- Bundle, no-candidate, currency, price-parse, and dial ambiguity flags block approval.
- Approval updates `watch_records` transactionally, writes immutable audit rows, sets `human_edited=true`, and sets confidence to exactly 100.
- A new non-blocking database constraint enforces confidence 0-100 for new and updated rows. Legacy validation remains a separate audited cleanup.

## Dealer/poster lineage

- Historical watch rows do not currently expose a reliable dealer relationship.
- Read-only scan: 17,000 `raw_records` rows, all from `auction_watches`.
- 10,491 rows (61.7%) have a source `company_id`.
- Those rows contain 1,580 unique source-company identities.
- 6,509 rows lack `company_id` and must remain unresolved unless another immutable source key is verified.
- The additive migration introduces private `dealers`, `dealer_source_identities`, and `watch_records.dealer_id`; it performs no guessed backfill.

## Security and resource corrections

- `.env.prod`, `.env.production`, and `.env.vercel` are removed from Git tracking while local copies remain ignored.
- Credential rotation and Git-history remediation are still mandatory because untracking does not erase prior commits.
- Legacy dashboard and analytics routes now redirect to live, source-backed pages; the 117,744-row static snapshot is no longer linked from production navigation.

## Release blockers still open

1. Apply the duplicate-audit `(brand, id)` index concurrently outside a migration transaction.
2. Complete full Patek duplicate scan and review false positives before any suppression.
3. Human-check image/reference/dial agreement for the 39 promoted image candidates.
4. Run unknown-dial and catalog-mismatch remediation globally.
5. Backfill only verified dealer identities after reviewing the additive schema and conflict report.
6. Rotate all exposed credentials and clean repository history.
7. Provision dealer accounts/MFA/recovery before removing the temporary beta skip.
