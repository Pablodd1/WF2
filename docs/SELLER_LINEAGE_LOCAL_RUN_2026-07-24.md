# Seller Lineage Local Reconciliation - 2026-07-24

## Scope

Read-only reconciliation of the local seller export:

- seller source: `User list all details..csv`;
- seller rows scanned: **1,293,376**;
- unbundled raw-message batches: **16**;
- unbundled parent rows: **761,489**.

Output was written outside the repository to:

`wf-data-canary/audit-output/dealer-lineage/seller-lineage/run-2026-07-24/`

## Results

| Classification | Rows |
|---|---:|
| Exact match-ready | 16,094 |
| Review required | 288 |
| Unmatched | 745,107 |
| 100-row deterministic canary | 100 |
| Matched rows missing seller name | 449 |
| Matched rows with front image | 16,381 |

The totals reconcile to **761,489** parent rows.

## Reason counts

| Reason | Rows |
|---|---:|
| `NO_EXACT_SELLER_LINEAGE` | 318,374 |
| `SELLER_NAME_MISSING` | 449 |
| `INTENT_MISMATCH` | 288 |
| `TITLE_HASH_ONLY_TIMESTAMP_MISMATCH` | 426,733 |
| `FRONT_IMAGE_MISSING` | 1 |

## Interpretation

The 16,094 match-ready rows meet the deterministic local evidence rules and are eligible for a private staging canary. They are not verified dealers and are not public contact authorization.

The 288 intent conflicts must remain review-required. They must not be auto-published because the seller export and unbundled parent disagree on WTS/WTB intent.

The 745,107 unmatched rows are not evidence of bad listings. They lack an exact seller-lineage match in the supplied export, so the system correctly leaves identity/date/contact unresolved.

## Safe next step

Use only the generated `canary-100.jsonl` for the first Preview/private staging write after verifying the Preview schema. Review each canary against the raw message, seller identity, original date, intent, and image lineage. Do not backfill `watch_records.dealer_id`, publish phone numbers, attach images, or promote to the Trading Floor from this local result alone.

Production writes: **0**.

Public contact changes: **0**.

## Local canary gate

The prepared 100-row canary was validated locally through the same staging-row
release gate used by the Preview writer:

| Check | Result |
|---|---:|
| Rows requested | 100 |
| Release-gate passes | 100 |
| Release-gate failures | 0 |
| Unique lineage keys | 100 |
| Intent conflicts | 0 |
| Missing original dates | 0 |
| Missing images | 0 |
| Missing seller names | 5 |
| Dealer assignments | 0 |

This proves the local canary is structurally safe for private staging. It does
not prove that the Preview database has the required schema or that any dealer
identity should be verified. The next step remains a bounded Preview write,
followed by a read-back reconciliation.
