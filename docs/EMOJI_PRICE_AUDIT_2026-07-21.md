# Emoji price audit - 2026-07-21

## Production result

- Exact materialized `EMOJI_PRICE_AMBIGUOUS` rows: **0**
- Postgres planned estimate for the same filter: **175**
- Rows returned by the exact read-only audit: **0**
- Prices changed: **0**
- Meanings inferred: **0**

The planned value is a query-planner estimate, not evidence that 175 records
exist. The exact count and filtered page both returned zero.

## Interpretation

Normalization v4 already decodes standard Unicode keycap digits and full-width
digits deterministically. It preserves the exact raw price token. A private
pictographic dealer code is never assigned a numeric meaning automatically.

The completed production shadow pass does not currently contain materialized
rows with the newer `EMOJI_PRICE_AMBIGUOUS` flag. The next safe step is a
bounded read-only re-scan with the current parser. It is not safe to build a
price codebook from screenshots or to let an AI guess what a symbol means.

## Audit command

`npm run audit:emoji-prices`

The command:

1. reads only rows already flagged in `normalization_shadow_v4`;
2. reports exact and planned counts separately;
3. inventories pictographs by Unicode code point;
4. masks phone, email, and URL patterns in local private samples;
5. pseudonymizes source record identities;
6. never changes prices, currencies, listings, or review decisions.

Local samples are written under ignored `audit-output/` and must not be
committed. Raw copied message examples from Alex remain the required evidence
for any dealer-specific symbol mapping.
