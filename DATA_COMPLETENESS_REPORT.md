# WF2 — Data Completeness & Price-Research Readiness Report

**Date:** 2026-08-20
**Scope:** What is actually populated in wf2 (`reviewed_workbook_inventory`),
and why Price Research shows sparse results for most brands.

---

## 1. Inventory (what IS there — this is NOT broken)

- **1,117,500 rows** in `reviewed_workbook_inventory` (partial copy; prod has 8.5M).
- All brands present: Richard Mille, Audemars Piguet, Rolex, Patek, Tudor,
  Cartier, Vacheron, etc. — 129 brands in prod.
- Models + references are populated (e.g. Tudor = 185 models, 29K rows; RM = 141 models).
- **Listing *inventory* is fine.** The Trading Floor browse returns models and
  references correctly once the brand is in the browse allowlist.

## 2. Price evidence — the REAL reason Price Research looks empty

Every row carries a `price_evidence_status`, and the split is:

| price_evidence_status | rows | % | Meaning |
|---|---|---|---|
| `DATED_FX_PROVENANCE_REQUIRED` | 628,701 | 56% | Price exists but needs FX conversion (mostly HKD→USD) that was never applied |
| `CURRENCY_AMBIGUOUS_OR_MISSING` | 424,319 | 38% | A number exists but NO currency → cannot be trusted as USD |
| `SOURCE_EXPLICIT_USD_MATCH` | 49,728 | 4.5% | ✅ Explicit USD — the ONLY status Price Research accepts |
| `EXPLICIT_USD_PRICE_CONFLICT` | 14,744 | 1.3% | Quarantined — conflicting price evidence |
| `SOURCE_REFERENCE_UNPROVEN` | 8 | ~0% | Unproven reference |

**Conclusion:** only **49,728 rows (4.5%)** are currency-verified and eligible
for Price Research. The other 95% have price *numbers* but no trusted USD
currency, so the evidence-first system correctly withholds them.

## 3. Currency breakdown (the root cause)

| source_currency | rows | notes |
|---|---|---|
| HKD | 628,178 | 56% — needs FX conversion (never done) |
| *(empty)* | 424,327 | 38% — no currency at all |
| USDT | 58,985 | crypto-stablecoin pricing (not converted) |
| USD | 5,487 | ✅ the only clean USD |
| EUR / CNY / GBP / CHF | ~350 | minor |

**Root cause of sparse prices:** the Green API WhatsApp source messages
predominantly listed prices in **HKD** (Hong Kong dealers) or **no currency**,
and the original pipeline's **FX-conversion step was never completed** across
the historical ingest. This is a pre-existing condition, identical in the live
prod database — not a WF2 regression.

## 4. Dealer / user rating

`rating` and `dealer_rating` are **sparse/absent** for the imported workbook
rows. Dealer enrichment (rating, verified-user status, reply counts) lives in a
separate `dealers` / `dealer_lineage` pipeline that was not joined into the
workbook inventory for most rows. This is also a pre-existing gap, not
introduced by the rebuild.

## 5. Per-brand Price-Research readiness (verified USD row counts)

| Brand | verified USD rows | Price Research status |
|---|---|---|
| Richard Mille | 38,440 | ✅ full (can show prices + study) |
| Audemars Piguet | 9,338 | ✅ strong |
| Patek Philippe | 1,197 | partial |
| Rolex | 369 | partial |
| Vacheron Constantin | 267 | partial |
| Cartier / Panerai / others | < 50 | minimal |
| Tudor | 9 | ❌ almost none |
| Hublot / JLC / Breguet | < 10 | ❌ |

## 6. What this means for your goals

- **"Watch by watch, model by model on the site"** — works for INVENTORY
  (Trading Floor shows all listings). ✅
- **"Price Research with prices + price study"** — only works for
  currency-verified brands (Richard Mille, AP). For Tudor/Rolex/etc. it shows
  little because the HKD/empty-currency rows were never FX-converted.
- **"User/dealer rating"** — missing across the board; separate enrichment needed.

## 7. The actual fixes (in priority order)

1. **Currency + FX resolution pass** — parse currency from raw Green API text
   (the `raw_message` already contains "HKD", "hk$", "usdt", etc.), apply real
   FX rates, and set `price_evidence_status = SOURCE_EXPLICIT_USD_MATCH`.
   This alone unlocks ~1M rows for Price Research. THE core missing step.

2. **Dealer-rating enrichment** — join `dealers`/`dealer_lineage` data into the
   inventory (rating, verified status, phone lineage).

3. **Compute upgrade** — the free-tier Micro instance times out the aggregate
   FX/price queries at scale; a paid tier is required for a full re-run.

## 8. Recommendation

The quickest way to SEE a complete, correct Price Research (with prices + study
+ references) is to use **Richard Mille** as the demonstration brand — it
already has 38K verified-USD rows. For Tudor and other HKD-heavy brands to fill,
the **currency/FX resolution pass** (item 1) is mandatory and is the genuine
body of remaining work.
