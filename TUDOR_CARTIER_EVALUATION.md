# WF2 — Tudor & Cartier Currency Evaluation (final)

**Date:** 2026-08-20
**Status:** EVALUATION ONLY. No data written. No prod touched. No API changes.

---

## Executive summary

The two brands have **two different currency problems**, and only one is
safely fixable from the data already in wf2.

| Brand | Problem | Fixable from wf2? |
|---|---|---|
| Tudor | Explicit "HKD"/"hk$" in text, but a **half-applied FX conversion** left 32% of rows corrupt (junk values like $3, or raw HKD as USD) | ✅ YES — currency parser recovers correct USD |
| Cartier | **Bare `$` with no currency word** in 80% of rows (14,587), and no dealer/region signal to tell if `$` = HKD or USD | ❌ NO — genuinely ambiguous without dealer metadata |

---

## Brand 1: Tudor — FX conversion corruption (FIXABLE)

**Profile** (6,717 HKD rows):
- 67% correctly converted to USD
- 17% junk (price maimed to ~$0: "HKD 9,500" → $3)
- 5% raw HKD mislabeled as USD
- 10% null

**Parser dry-run (400 rows):** 129 corrupt (32%), 267 correct, 4 unparseable.
Verified before→after (real rows):
- "91650-0005 N2 HKD 12,000" → null → **$1,538**
- "91650-0002 HKD 9,500" → $3 → **$1,218**
- "28600-0003 HKD 13,000" → $1 → **$1,667**

All repairs are realistic Tudor secondary-market USD. Parser is correct after
adding a `< $100 → reject` guard (routes date/fragments to review).

## Brand 2: Cartier — bare-`$` ambiguity (NOT FIXABLE from wf2)

**Profile** (18,260 rows):
- 14,587 (80%) have `source_currency = NULL`
- Of those: 5,616 use a bare `$`, ~8,971 have NO currency signal at all
- Raw examples: "Wssa0062 $62000 -16", "WSSA0037 N11 $69000−20%"

**Why it can't be fixed safely:** `$` is genuinely ambiguous. Hong Kong dealers
used `$` to mean HKD (so "$62,000" ≈ $7,949 USD), but there is no currency word,
no region, no phone_code, no dealer field in wf2 to disambiguate. Guessing USD
would be ~8× wrong; guessing HKD would be wrong for genuine-USD sellers. The
evidence-first pipeline correctly left these NULL.

**What WOULD fix Cartier:** the dealer/region metadata in the MariaDB
`auctions` source (`from_number`, `phone_code`, `region`, `company_id`) — a HK
phone code strongly implies HKD. That rejoin is a separate, larger task.

## Conclusion & recommendation

1. **Tudor repair is safe and ready** — the currency parser, with the `< $100`
   guard, correctly fixes the 32% corrupt HKD rows. This fills Price Research
   for Tudor with real USD prices.

2. **Cartier requires dealer-metadata rejoin** from MariaDB to resolve the
   bare-`$` ambiguity. Not safe to fix from wf2 alone.

3. **No mistake was made**: only dry-runs were run; no rows were written; the
   parser's date-vs-price bug was caught and fixed during dry-run verification.

**Files:** parser `/tmp/wf2_currency_repair.py` (read-only), this report in-repo.
