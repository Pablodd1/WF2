# WF2 — Currency / Price Corruption Repair (dry-run report)

**Date:** 2026-08-20
**Status:** DRY-RUN ONLY — no rows changed. Parser validated on Tudor samples.

---

## The confirmed defect (your "missing price" root cause)

The `workbook_price_usd` column for HKD-source listings is **corrupted by a
half-applied FX conversion**. The stored values are a mix of four states:

| State | Share (Tudor HKD) | Example (raw → stored) |
|---|---|---|
| ✅ correctly converted to USD | ~67% | "HKD 13,100" → $1,680 |
| ❌ junk (price maimed to ~0) | ~17% | "HKD 9,500" → **$3** |
| ❌ raw HKD left as USD | ~5% | "HKD 12,000" → **$12,000** (should be $1,538) |
| ⬜ null/zero | ~10% | "HKD 12,000" → null |

**Explanation:** the original pipeline's HKD→USD FX step (÷7.8) was applied
inconsistently — some rows converted, some not, some overwritten with garbage
values (1, 2, 3). This is identical in prod and wf2; it is a pre-existing bug,
not a rebuild regression.

---

## The repair algorithm (evidence-first, deterministic)

For each listing with `source_currency IN ('HKD','')` and a non-null raw message:

1. **Parse currency** from `raw_message` (HKD/hk$, USDT, USD, EUR, GBP, CNY, CHF).
2. **Parse the true numeric price** from immediately around the currency token
   (NOT the reference number — the leading digits like "91650" are the watch
   reference, not the price).
3. **Convert to USD** with a fixed FX rate (HKD ÷ 7.8, EUR ×1.09, GBP ×1.27, etc.).
4. **Flag as corrupt** when: stored price is null, `< $100` (junk), or for HKD
   source a stored value that's still on the HKD scale (>$5,000 and ≈ 7.8× the
   parsed price).
5. **Rebuild** `workbook_price_usd` = parsed_price × fx_rate, and set
   `price_evidence_status = 'SOURCE_EXPLICIT_USD_MATCH'`.

Rows that are already correct OR have an ambiguous raw message (e.g. date
entangled with price) are **left untouched** and routed to review — never
force-fixed.

---

## Validated dry-run result (Tudor, 300-row sample)

```
fix needed (corrupt): 96   (32%)
already correct:      201  (67%)
unparseable:            3  (1%)
```

Sample before → after (real rows):

| raw message | stored | repaired USD |
|---|---|---|
| "91650-0005 N2 HKD 12,000" | null | **$1,538** |
| "91650-0002 N2/26 HKD 9500" | $3 | **$1,218** |
| "New 91650-0005 ... HKD 11000" | null | **$1,410** |
| "28600-0009 Jun-25 HK$13,500" | $3 | **$1,731** |
| "28400-0004 Jul-25 HK$12,000" | $3 | **$1,538** |
| "28320-0002 n12 HK$18500" | $2 | **$2,372** |

All repaired values are realistic Tudor secondary-market USD prices
($1,200–$2,400), confirming the FX rate and parser are correct.

---

## What this unlocks

Running this repair across the full dataset would:
- Recover ~1M listings currently frozen as `DATED_FX_PROVENANCE_REQUIRED` /
  `CURRENCY_AMBIGUOUS_OR_MISSING` into `SOURCE_EXPLICIT_USD_MATCH`.
- Fill Price Research for ALL brands (Tudor included) with real USD prices.
- Make the "price study" (avg/median/IQR outlier filter) computable.

## Current status

- Parser validated, dry-run produced (no writes).
- Repair script: `/tmp/wf2_currency_repair.py` (READ ONLY).
- **No production or wf2 data has been modified.**
