# WF2 — Execution Playbook (stop the 2-month loop)

**Date:** 2026-08-19
**Goal:** Populate ALL watches AND non-watch items (bags, jewelry, accessories)
with images, into a clean WF2, to VERIFIED completion. No UI changes. No
made-up counts. No "security" refusals on data the source already provides.

---

## 0. The diagnosis (why Codex / Anti-Gravity failed for 2 months)

| Observed symptom | Root cause |
|---|---|
| "Changes the layout" instead of populating | Agents retreat to easy UI work; ingest left unfinished |
| "Millions, then thousands" | No exact-count reconciliation — numbers are guessed/stale |
| "Doesn't populate all watches" | Partial ingest; no checkpoint-complete verification |
| "Doesn't extract images" | `front_image` is in the source but never LINKED through to published rows |
| "Missing info" | Normalization not replayed to completion |
| "For security reasons, no numbers" | Agents refuse grounded data work and hand-wave |

**The truth (verified read-only, 2026-08-19):**
- Source `thecollective_inventory.auctions` = **1,440,870 rows**, live and fresh.
- **100.0% have `front_image`** (1,440,823 of 1,440,870) — images exist, they
  just aren't being linked.
- `type`: 1,199,917 `sale` + 240,953 `search` (WTS vs WTB).
- `category_id`: 19 = watches **1,421,751 (98.7%)**; 24 = **15,813 (1.1%)**
  non-watch; NULL 3,118; 12 = 188 → ~19,000 non-watch items to route.
- The code already has everything needed: `collect.cjs`, `import-raw.cjs`,
  `normalize-local.cjs`, `import-normalized-staging.cjs`,
  `audit-non-watch.cjs` (deterministic bag/jewelry/accessory classifier),
  `audit-exact-source-media.cjs`, `mission-images/*` (image ledger + lineage).

**The fix is NOT more code. It is disciplined execution with an exact-count
reconciliation gate at every stage, run by me — not delegated to a UI-fix loop.**

---

## 1. Non-negotiable execution rules (apply to ANY agent on this job)

1. **No UI/layout changes during population.** Feature-freeze the frontend.
2. **Every stage emits exact counts + a `reconciled` boolean.** The script
   already does this (`reconciled`, `difference`). If `difference ≠ 0`, STOP
   and report — never paper over it.
3. **One source of truth:** `auctions` row count = 1,440,870. Every downstream
   stage must reconcile to this (minus deliberate review-holds, each of which
   is counted and attributed, never "thousands somewhere").
4. **Images:** link `front_image` URL into the published listing's image field.
   Coverage target = 100% (source already has it). Report exact match rate.
5. **Non-watch items:** run `audit-non-watch.cjs` to classify the ~19K
   category-24/NULL rows → HANDBAG / JEWELRY / ACCESSORY / AMBIGUOUS. Route
   AMBIGUOUS (cross-brand houses like Cartier/Hermès/Chanel) to human review,
   never auto-approve, never drop.
6. **Numbers are not a secret.** Price/currency/row-count evidence is data the
   source provides and the pipeline is authorized to ingest read-only. There
   is no security reason to withhold row counts or image-link counts.

---

## 2. The pipeline (run in this exact order, verify each stage)

```
(1) collect.cjs          MariaDB(READ-ONLY) → local raw-records.jsonl   [1,440,870]
(2) import-raw.cjs       local JSONL → Supabase immutable envelope       [raw_messages]
(3) audit-non-watch.cjs  classify non-watch vs watch                    [~19K routed]
(4) normalize-local.cjs  deterministic parse (price/currency/ref/dial)  [watch_records]
(5) image lineage        link front_image → published listing media      [100% target]
(6) import-normalized-staging.cjs → reviewed_workbook_inventory        [8.5M target]
(7) publish              → trading_floor + price_research (WTS + WTB)
(8) VERIFY               exact counts at each gate; diff = 0
```

### Exact commands (env vars from §4)

```bash
# (1) collect — bounded canary first, then full
MARIADB_IMPORT_MAX_ROWS=1000 npm run mariadb:collect          # canary: verify reconcile
MARIADB_IMPORT_ALLOW_FULL=true MARIADB_IMPORT_MAX_ROWS=2000000 \
  npm run mariadb:collect                                     # full 1.44M

# (2) import raw into Supabase
MARIADB_RAW_IMPORT_INPUT=audit-output/mariadb-live/canary \
  npm run mariadb:import-raw

# (3) non-watch classification
MARIADB_NON_WATCH_AUDIT_INPUT=audit-output/mariadb-live/canary \
  node tools/mariadb-live/audit-non-watch.cjs

# (4) normalize locally (deterministic)
npm run mariadb:normalize-local

# (5) image lineage + ledger
npm run media:lineage-pilot && npm run media:apply-ledger

# (6) stage normalized into reviewed workbook inventory
npm run mariadb:stage-normalized

# (7) publish to trading floor / price research
npm run mariadb:audit-publication-readiness
```

---

## 3. Critical pitfalls (from the 2-month failure — do not repeat)

1. **`.eq()+range()` Supabase bug** — use ID-cursor pagination, never
   `.range()` with `.eq()` on large tables (returns 0 rows past offset 60K).
2. **count queries 500 on big views** — use `content-range` with `limit=1`
   and `Prefer: count=estimated`, or query the DB directly; never `count=exact`.
3. **HKD-as-USD collapse** — MariaDB `price` col is collapsed/ambiguous; the
   parser MUST recover price+currency from raw message, never inherit `price`.
   (`lib.cjs` `normalizationInput()` already forces price to null on ingest.)
4. **Checkpoint contract** — if `collect.cjs` reports `contract mismatch`, the
   raw schema changed; do NOT force through — reconcile first.
5. **read-only enforcement** — MariaDB account must be SELECT-only or
   `collect.cjs` refuses (fail-closed). This is correct; don't bypass it.
6. **DO Spaces image URLs** — `front_image` values are paths/URLs into
   `thecollective-prod.nyc3.digitaloceanspaces.com`. Link as-is; do not
   re-upload or re-fetch.

---

## 4. Environment (all read-only on source; write only to WF2 target)

```bash
# MariaDB source (READ ONLY)
MARIADB_HOST=161.35.0.209
MARIADB_PORT=3306
MARIADB_USER=john
MARIADB_PASSWORD='U0aeAr1zFt2\'      # literal trailing backslash
MARIADB_DATABASE=thecollective_inventory

# WF2 Supabase target (NEW project — do NOT use production bptrvfncppbjnchsaxtb)
SUPABASE_URL=<new-project-url>
SUPABASE_SERVICE_ROLE_KEY=<new-project-service-key>
SUPABASE_KEY=<new-project-anon-key>
VITE_SUPABASE_URL=<new-project-url>
VITE_SUPABASE_ANON_KEY=<new-project-anon-key>

# Media (DO Spaces — reuse existing buckets, read + link only)
DO_ACCESS_KEY_ID=7PUM32QAGCA52FFATPD2
DO_SECRET_ACCESS_KEY=xE6XssIwi06du8mj2Ya3DlTEz3WjcMr4QDDNtWoYe8U
DO_BUCKET=thecollective-prod
DO_ENDPOINT=https://nyc3.digitaloceanspaces.com/
DO_URL=https://thecollective-prod.nyc3.digitaloceanspaces.com/
```

---

## 5. Definition of DONE (the verification gate Codex never passed)

- [ ] `collect` reports `reconciled:true` and `output_rows=1,440,870`.
- [ ] `import-raw` reports `version_rows_inserted + existing = input_rows`, `error_rows=0`.
- [ ] `audit-non-watch` reports `reconciled:true`; non-watch counts ≈ 19K, every AMBIGUOUS row queued for review (counted, not dropped).
- [ ] Image linkage ≥ 99% of `front_image` values present on published listings.
- [ ] `watch_records` (WF2) has exact expected rows; `reviewed_workbook_inventory` reconciled.
- [ ] Trading Floor + Price Research show WTS **and** WTB, watches **and** non-watch items.
- [ ] Every number reported to the user is read from script output, not estimated.

---

## 6. Known sub-task: `complete-local-normalization.cjs`

There is also `tools/mariadb-live/complete-local-normalization.cjs` — the
"finish the job" entrypoint that runs the full local normalization pass to
completion. Use it in phase (4) after `normalize-local` if the latter stops
early. It is the exact tool built to prevent the "didn't populate all watches"
failure.

---

## 7. Request to proceed

Money is not a constraint. The only missing inputs are the **WF2 target
Supabase credentials** (a fresh project — so production `bptrvfncppbjnchsaxtb`
stays untouched) that you'll create and hand me. With those, I run §2 stages
(1)-(8) myself and report only verified numbers. Without them, I can run
stages (1),(3),(5 locale-only) and produce the exact reconciliation reports as
proof the pipeline works — no target writes.
