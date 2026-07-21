# Seller Lineage Canary Report

**Date:** 2026-07-21  
**Mode:** read-only local scan and dry-run staging  
**Production writes:** 0

## Scope

The seller export was reconciled against the 16 preserved unbundled parent raw-message files. The scan used exact raw-message SHA-1 evidence, phone identity, and source timestamp evidence. It did not infer dealers, publish contact information, attach images, or change listings.

## Results

| Measure | Count |
| --- | ---: |
| Parent raw messages scanned | 761,489 |
| Seller rows scanned | 1,293,376 |
| Exact match-ready parent rows | 16,094 |
| Review-required parent rows | 288 |
| Unmatched parents | 745,107 |
| Match-ready rows with a front image | 16,381 |
| Match-ready rows missing observed seller name | 449 |
| Canary rows selected | 100 |
| Canary rows dry-run staged | 100 |
| Production writes | 0 |

## Reasons requiring caution

| Reason | Count |
| --- | ---: |
| No exact seller lineage | 318,374 |
| Seller name missing | 449 |
| Seller intent mismatch | 288 |
| Timestamp mismatch after title-hash match | 426,733 |
| Front image missing | 1 |

The high unmatched count is not evidence that the listings are invalid. It means the seller export does not provide enough exact identity/date evidence to attach a seller safely. Those parents remain unmatched and must not receive inferred dealer identity or public contact information.

## Safe next step

1. Apply the two private seller-lineage migrations in Supabase Preview.
2. Insert only the 100-parent canary using the existing checkpointed stage command.
3. Inspect raw message, seller phone, seller name, source date, intent, and image filename for the canary.
4. Stage child lineage only after the parent canary passes.
5. Keep dealer assignment, public contact, duplicate suppression, and image publication disabled until identity and consent gates pass.

The generated local artifacts are under `audit-output/dealer-lineage/seller-lineage/`; they are intentionally excluded from Git because they contain private contact evidence.
