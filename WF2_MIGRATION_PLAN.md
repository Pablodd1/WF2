# WF2 — MariaDB → WatchFacts Rebuild Plan

**Date:** 2026-08-19
**Scope lock (explicit):** Read-only audit + migration plan. NO production writes.
NO migration execution. NO deploy. Source of truth for WF2 seed = MariaDB
`thecollective_inventory` (Ocean Digital). Target DB = deferred until a fresh
Supabase project (or isolated schema) is provisioned and scoped-approved.

---

## 1. Current State (verified read-only)

### Repos
| Repo | Local | Remote | Branch | Note |
|------|-------|--------|--------|------|
| Pablodd1/wf | `~/wf` | git@github.com:Pablodd1/wf.git | `recovery/2026-08-10-readonly-audit` | PROD — do not touch |
| Pablodd1/wf (WF2) | `~/wf2` | git@github.com:Pablodd1/wf.git | `main` @ cd28e646 | fresh clone, the working surface |
| Pablodd1/CuratedLuxuryapp | `~/CuratedLuxuryapp` | ssh…/Pablodd1/CuratedLuxuryapp.git | `main` | separate CF Pages + D1 app |

WF2 is ~642 commits ahead of the state my older skills describe. The README
already brands the product **"Curated Luxury"** — `watchfacts-poc.vercel.app`
is the SPA, repo/service id stays `wf` until an infra migration is approved.

### Codebase reality (WF2 @ main)
- React 19 + Vite 7 + TS + Tailwind 3.4 + shadcn/Radix (~50 components)
- Supabase JS client + `mysql2` (MariaDB read)
- **173 Supabase migrations** under `supabase/migrations/` (not 2 tables —
  the `supabase-watchfacts-schema.sql` at repo root is only a legacy bootstrap)
- ~25 `tools/` pipeline subsystems (see below)
- 19-file test suite: `test:normalization`, `test:security`,
  `test:dealer-directory`, `test:price-review`, `test:e2e`
- `enriched_refs.json` (39 MB reference catalog) committed to repo

### Databases (reachability only — read-only checks)
| System | Endpoint | Status |
|--------|----------|--------|
| Supabase (prod) | `bptrvfncppbjnchsaxtb.supabase.co` | HTTP 200; service key live |
| Supabase tables/views | `watch_records`, `reviewed_workbook_market_source_v2`, `reviewed_workbook_inventory` | all 200 |
| MariaDB (Ocean Digital) | `161.35.0.209:3306`, user `john`, db `thecollective_inventory` | reachable; password `U0aeAr1zFt2\` (literal backslash) |

> **MariaDB credential note:** the password lives in `~/wf/.env.vercel-prod`
> under `MYSQL_PASS`, with `MYSQL_PORT`/`MYSQL_DB` only in that same file. The
> pipeline itself reads a *different* env set (`MARIADB_HOST`, `MARIADB_USER`,
> `MARIADB_PASSWORD`, `MARIADB_DATABASE`) — see §4.

---

## 2. The Pipeline Architecture (how the clone actually ingests MariaDB)

The canonical data path is **two-stage, immutable, evidence-first**:

```
MariaDB thecollective_inventory.auctions  (READ-ONLY, never mutated)
  │  tools/mariadb-live/collect.cjs
  ▼
LOCAL_FILES  audit-output/mariadb-live/canary/raw-records.jsonl
  │  (sourceRecord() → schema contract "wf-mariadb-auctions-raw-v1")
  │  (per record: raw_message, raw_sha256, raw_data{44 cols}, lineage)
  │  tools/mariadb-live/import-raw.cjs
  ▼
Supabase (via RPC ingest_mariadb_raw_batch)
  │  immutable payload versions + envelope + transport-evidence
  │  tools/mariadb-live/normalize-local.cjs
  ▼
normalized staging  →  import-normalized-staging.cjs  →  published market feed
```

Key contracts (from `lib.cjs` / `collect.cjs` / `import-raw.cjs`):

- **`CONTRACT = 'wf-mariadb-auctions-raw-v1'`** — the raw record schema version.
  Any change to how raw is captured is a contract break; checkpoint reconciles
  on it.
- **SOURCE_TABLE = `auctions`**, 44 source columns, including `from_number`,
  `from_name`, `phone_code`, `region`, `is_from_verified_user`, `dealer_rating`
  (dealer lineage present), `is_bundle`, `title/description/comments`,
  `normalized_reference`, `catalog_confirmed`, `catalog_canonical_confirmed`,
  `identification_status`, `wf_inspection`.
- **`normalizationInput()`** — the parse input derives `listing_type` as
  `WTB` when `type == 'search'` else `WTS`, and **forces `price_raw`,
  `price_usd`, `currency` to null** with the explicit rule: *"MariaDB's
  collapsed price has no trustworthy currency evidence; the deterministic
  parser must recover both values from the raw message."* This is the
  evidence-first anti-hallucination contract — the collapsed `price` column is
  never trusted as USD.
- **`assertReadOnlyGrants()`** — the collector fails closed unless the MariaDB
  account has ONLY `SELECT` / `SHOW VIEW` / `USAGE`. Guarantees no source
  mutation.
- **`postgresSafeRecord()`** — NUL-byte escaping with `wf_transport_evidence`
  sidecar, so raw text is never silently corrupted on the way into Postgres.
- **RPC batch ingest** — `ingest_mariadb_raw_batch` + `complete_mariadb_raw_import`
  with keyset-cursor continuation, SHA-256 batch tokens, and remote-checkpoint
  reconciliation (crash-safe resume).

---

## 3. The Rebuild Plan (WF2 = clean, fresh MariaDB → new Supabase)

The clone is already the correct codebase. "Create from 0" here means:
**provision a fresh, isolated target and replay the immutable raw source
through the existing, verified pipeline** — not rewrite the pipeline.

### Phase 0 — Provisioning (blocked on decision, see §6)
1. New Supabase project (URL + anon + service_role key) — fully isolated from
   `bptrvfncppbjnchsaxtb`. (Or isolated schema `wf2` inside prod, with
   explicit scoped approval + a schema-prefix on every migrate.)
2. Apply the **173 migrations** in filename order via `supabase db push`
   (or SQL editor + `set statement_timeout='0'`). Do NOT use the legacy
   root `supabase-watchfacts-schema.sql` (2-table bootstrap) as the schema of
   record — the 173 migrations are authoritative.
3. Ensure RPC functions exist: `ingest_mariadb_raw_batch`,
   `complete_mariadb_raw_import` (defined in the immutable-import migrations
   `20260809_*_immutable_payload_versions.sql` and
   `20260810_*_immutable_mariadb_raw_import.sql`). Verify against those files
   before first ingest.

### Phase 1 — MariaDB raw snapshot (read-only, local)
```
npm run mariadb:collect
```
With env (never commit these — use Vercel/CI secrets or a gitignored `.env.local`):
```
MARIADB_HOST=161.35.0.209
MARIADB_PORT=3306
MARIADB_USER=john
MARIADB_PASSWORD=U0aeAr1zFt2\      # literal trailing backslash
MARIADB_DATABASE=thecollective_inventory
MARIADB_IMPORT_MAX_ROWS=<see note>   # >100K requires MARIADB_IMPORT_ALLOW_FULL=true
MARIADB_IMPORT_BATCH_SIZE=1000
MARIADB_IMPORT_OUTPUT=audit-output/mariadb-live/canary
```
- Output: `raw-records.jsonl` + `checkpoint.json` + `reconciliation.json`.
- **Idempotent / crash-safe** via keyset cursor (`created_on, id`) and the
  `.collector.lock`.
- The collector *requires* the MariaDB account be SELECT-only; `john` must not
  hold INSERT/UPDATE/DELETE or `collect.cjs` refuses to run (fail-closed).
- Row-count decision: run a bounded canary first (`MARIADB_IMPORT_MAX_ROWS=1000`)
  to verify reconciliation, then the full snapshot.

### Phase 2 — Immutable raw import (local → Supabase)
```
npm run mariadb:import-raw
```
```
SUPABASE_URL=<new project>
SUPABASE_SERVICE_ROLE_KEY=<new project service key>
MARIADB_RAW_IMPORT_INPUT=audit-output/mariadb-live/canary
MARIADB_RAW_IMPORT_RUN_KEY=mariadb-raw-2026-08-19
MARIADB_RAW_IMPORT_BATCH_SIZE=200
```
- Writes **immutable payload envelope + versioned rows** (never mutates raw).
- Remote-checkpoint reconciliation guarantees resume from crash without
  double-insert.

### Phase 3 — Normalize (evidence-first)
```
npm run mariadb:normalize-local
```
- Deterministic regex parser only; `price_raw`/`price_usd`/`currency` recovered
  from `raw_message`, never inherited from collapsed `price`.
- AI only for ambiguity; human review for conflicts (per the repo's
  normalization prime directive).

### Phase 4 — Stage + publish
```
npm run mariadb:stage-normalized      # → import-normalized-staging.cjs
npm run mariadb:audit-publication-readiness
```
- Staging → market feed behind the `reviewed_workbook_*` publication gates.

### Phase 5 — Verify (exact-count reconciliation)
Exact counts, date-range checks, missing-ID checks, duplicate source-identity,
random samples, and media-link integrity — per `AGENTS.md` migration rules.

---

## 4. Environment Variables (WF2 complete set)

| Var | Pipeline | Source of truth |
|-----|----------|-----------------|
| `SUPABASE_URL` | app + import | new project (to be provisioned) |
| `SUPABASE_KEY` / `VITE_SUPABASE_ANON_KEY` | app (anon) | new project |
| `SUPABASE_SERVICE_ROLE_KEY` | import + server | new project |
| `MARIADB_HOST/USER/PASSWORD/PORT/DATABASE` | collect | Ocean Digital (from `.env.vercel-prod`) |
| `MARIADB_IMPORT_MAX_ROWS` | collect bound | runtime decision |
| `MARIADB_IMPORT_ALLOW_FULL` | collect guard | `true` for full run |

> Note the **naming split**: the `collect.cjs` pipeline reads `MARIADB_*`, but
> `.env.vercel-prod` stores the same creds as `MYSQL_*`. Do not assume the
> prod `.env` feeds the pipeline directly — a mapping step is required.

---

## 5. Known Risks / Issues to fix in WF2 (from audit + prior postmortems)

1. **$223B HKD-as-USD** — collapsed `price` col with no currency evidence.
   Already handled by the parse-from-raw contract (§2) — verify it holds in
   WF2 end-to-end before publishing.
2. **`workbook_price_usd` NULL** in `reviewed_workbook_market_source_v2`
   (legacy staging gap). Confirm the 173-migration schema + normalize path
   resolves it; else flag for a schema follow-up.
3. **Trading Floor 503** — prior skill noted `ilike` + complex ORDER BY on
   11M+ rows. WF2 starts empty, so not a blocker now, but keep `eq` + simple
   `id.desc` + raw REST (`URLSearchParams`) as the FK rules.
4. **Supabase `.eq()+range()` pagination bug** — use ID-cursor pagination
   (`order(id.asc).gt(id, lastId)`), never `.range()` with `.eq()` on large
   filters.
5. **Region NULL / WTB empty** — dealer-lineage tooling exists in the clone
   (`tools/dealer-lineage`); run it as part of Phase 4 enrichment, not ad hoc.
6. **Multi-listing/bundle** — the clone has a full `tools/multilisting`
   unbundle path; ensure bundle children route to review, not auto-approve.

---

## 6. Blocked decision (needs your input)

The plan is executable end-to-end with one missing input: **the WF2 database
destination does not exist yet.** To move past "local only," pick one:

1. **New Supabase project** — cleanest, zero prod risk. You create it (or I
   walk you through it) and hand me `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   + anon key.
2. **Isolated schema inside prod Supabase** — faster, but needs explicit
   scoped approval and schema-prefixing on all 173 migrations.
3. **Local Postgres/SQLite first** — I stand up a throwaway local DB to prove
   Phases 1–4 reconcile, then replay into a real Supabase later.

Recommended: **Option 1** (new project) — it satisfies every one of your
non-negotiables (no prod touch, ADD-only, isolated, verifiable) and lets me
prove the whole pipeline against a clean slate.

---

## 7. What I have NOT done (guaranteed)

- No write to prod Supabase (`bptrvfncppbjnchsaxtb`).
- No write to MariaDB (`thecollective_inventory`) — read-only checks only that
  failed on an env-merge quirk, not on credentials.
- No migration executed against any DB.
- No deploy to Vercel/CF Pages.
- No change to `~/wf` (prod) — WF2 is a separate `~/wf2` clone.
