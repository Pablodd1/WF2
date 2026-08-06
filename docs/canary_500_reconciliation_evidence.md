# Genuine 500-Record Canary Execution & Reconciliation Audit Report

> **Audit Verdict**: **PASS — Production Ingestion Pipeline Verified**  
> **Environment**: Live Supabase PostgreSQL (`db.qnsafosakvonzgfcsphh.supabase.co`)  
> **Repository Commit**: `6941627b` on `main`  
> **Security Audit**: Temporary login role `pipeline_worker` has been disabled, revoked, and safely dropped (`role_exists = 0` in `pg_roles`). Zero credentials are stored or exposed.

---

## 1. Live Database & PostgREST Count Summary

| Layer / View | DB Table / View Name | Exact Live Row Count | PostgREST `Content-Range` Header | Status / Validation Notes |
|---|---|---:|---|---|
| **Raw Ingestion** | `raw.payloads` | **500** | `0-0/500` | Immutable raw payloads enqueued |
| **Job Queue** | `jobs.processing_jobs` | **500** | `0-0/500` | 100% processed to `normalized` |
| **Staging Parents** | `staging.listings` (`parent_id IS NULL`) | **500** | N/A | Parent listings enqueued by worker |
| **Staging Children** | `staging.listings` (`parent_id IS NOT NULL`) | **860** | N/A | Split bundle child listings |
| **Staging Total** | `staging.listings` (All) | **1,360** | N/A | Total staging listings ($500 + 860 = 1,360$) |
| **Trading Floor** | `public.reviewed_workbook_market_source_v2` | **500** | `0-0/500` | `HTTP 200 OK` — Public seller consent enabled |
| **Price Research** | `public.price_research_verified_source` | **12** | `0-0/12` | `HTTP 200 OK` — Includes `listing_status = 'APPROVED'` |

---

## 2. Data Quality Audit: 500 Parents Ineligibility Breakdown

The 500 parent listings fall into the following exact SQL classifications:

| Parent `price_research_status` | Count | Share (%) | Data Quality Cause & Pipeline Behavior |
|---|---:|---:|---|
| `ineligible_identity` | **175** | 35.0% | Raw post lacks canonical brand or standard model reference number |
| `ineligible_bundle` | **129** | 25.8% | Multi-watch listing / bundle (requires unbundling & child review) |
| `ineligible_wtb` | **105** | 21.0% | "Want To Buy" / ISO intent post (buying request, not a WTS offer) |
| `ineligible_no_price` | **52** | 10.4% | Price not supplied in raw post ("PM for price", "Offer", etc.) |
| `ineligible_non_watch` | **27** | 5.4% | Handbags, jewelry, straps, accessories (Birkin, Cartier ring, cufflinks) |
| **`eligible`** | **12** | **2.4%** | Single WTS watch listing with complete brand + reference + price |
| **Total Parents** | **500** | **100.0%** | **Sum of all 500 parent listings** |

### Insights on 12 / 500 Price Research Eligibility (2.4%)
1. **Unsplit Bundles (129 parents = 25.8%)**: Bundles contain **860 child watches**. Once child listings undergo review/image matching, eligible children transition into Price Research.
2. **WTB Intent (105 parents = 21.0%)**: Buyer posts are correctly published to Trading Floor but excluded from Price Research sale benchmarks.
3. **Missing Reference Identity (175 parents = 35.0%)**: Dealer posts with descriptive text but no reference number require catalog mapping to qualify for Price Research.

---

## 3. Exact SQL Status Breakdown of 860 Children

### By `price_research_status`
| `price_research_status` | Count | Share (%) | Status Notes |
|---|---:|---:|---|
| `ineligible_bundle_child_pending_review` | **860** | 100.0% | Quarantined from Price Research pending review |

### By `trading_floor_status`
| `trading_floor_status` | Count | Share (%) | Status Notes |
|---|---:|---:|---|
| `bundle_child_pending_review` | **860** | 100.0% | Quarantined on Trading Floor to suppress parent multi-watch image |

### By `normalization_status`
| `normalization_status` | Count | Share (%) | Status Notes |
|---|---:|---:|---|
| `normalized` | **648** | 75.3% | Brand, reference, and attributes fully parsed |
| `partially_normalized` | **209** | 24.3% | Brand or reference extracted, minor attributes pending |
| `needs_review` | **3** | 0.4% | Attribute extraction validation required |
| **Total Children** | **860** | **100.0%** | **Total child listings extracted from 129 bundles** |

---

## 4. Persisted Low-Price Plausibility Evidence

- **Test Case**: Listing `34 HKD` (equivalent to `$4.35 USD`).
- **Live Database Record (`staging.listings`)**:
  - `id`: `bc036403-6663-5dde-a009-ec9376a4961e`
  - `raw_message_text`: `Hublot 565.NX.8970.RX 2024 Green (38mm) 34HKD...`
  - `price_original`: `34.00 HKD`
  - `price_usd`: `$4.35`
  - `price_research_status`: `ineligible_bundle`
  - `provenance_metadata`: `{"brand": "db+parsed", "reference": "db+parsed", "price": "db+parsed", "dial": "parsed", "plausibility_reason": "SUSPICIOUS_LOW_PRICE_4.35_<_$50"}`

---

## 5. Security & Worker Code Hardening Verification

1. **Role Removal**:
   - `pipeline_worker` role has been safely disabled (`NOLOGIN`), ungranted, and dropped.
   - Verified via SQL: `SELECT count(*) FROM pg_roles WHERE rolname = 'pipeline_worker';` $\rightarrow$ **`0`**.

2. **Connection Error Handling (`--require-postgres`)**:
   - `get_db_connection()` now fails closed with `RuntimeError` on any PostgreSQL connection failure when `--require-postgres` or `REQUIRE_POSTGRES=1` is set. Fallback to SQLite is blocked.

3. **Duplicate Detection Error Handling**:
   - `check_duplicate_payload()` raises database exceptions directly, forcing transaction rollback and job failure rather than silently allowing duplicate ingestion.

---
*Sanitized Audit Evidence Report — WatchFacts Ingestion Pipeline*
