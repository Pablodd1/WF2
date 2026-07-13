# WatchFacts Agent Instructions

These instructions apply to the whole repository.

## Mission

WatchFacts is a watch-market intelligence platform. The system ingests dealer messages, preserves raw evidence, splits messages into candidate listings, classifies WTS/WTB intent, normalizes watches and prices, reconciles references against catalog data, validates media when available, routes uncertainty to review, and powers Trading Floor, Price Research, Admin, and analytics.

## Non-Negotiables

- Do not work directly on `main`; use reviewable branches.
- Do not commit credentials, `.env*` files, service-role keys, database passwords, storage secrets, API keys, screenshots containing secrets, or prompt transcripts containing secrets.
- Preserve raw messages unchanged.
- Do not normalize during the initial historical migration.
- Do not send the historical archive through an LLM.
- Do not assume `$` means USD.
- Do not default unresolved currency to USD.
- Do not silently expand partial references to a specific full reference without supporting evidence.
- Do not discard outliers; flag them and preserve them.
- Do not load millions of rows into browser memory.
- Every normalized record must retain lineage to source message, context block or line, parser version, media, and decision evidence.

## Required Phase 1 Behavior

Phase 1 is documentation and audit only. Do not change product behavior, schemas, deployment config, API contracts, or UI behavior unless the user explicitly approves a follow-up fix branch.

Allowed Phase 1 actions:

- Read code and docs.
- Run non-destructive checks such as `npm ci`, `npm run lint`, and `npm run build`.
- Create or update audit documentation.
- Report confirmed findings, risks, missing evidence, and recommended PR sequence.

Disallowed Phase 1 actions:

- Connecting to production systems.
- Running migration scripts against live databases.
- Opening production webhooks.
- Modifying parser behavior.
- Modifying UI behavior.
- Committing secrets.

## Local Commands

Use these checks when relevant:

```bash
npm ci
npm run lint
npm run build
```

Current Phase 1 result on 2026-07-12:

- `npm ci`: passed.
- `npm run build`: passed.
- `npm run lint`: failed with existing lint issues.

## Canonical Architecture

Historical MySQL/MariaDB and future Green API messages must converge into the same pipeline:

```text
source events
-> immutable raw_messages
-> context blocks
-> listing_candidates
-> deterministic extraction
-> catalog reconciliation
-> AI only for ambiguity
-> human review when needed
-> approved records and analytics views
```

## Data Rules

- Raw evidence is immutable.
- Claimed values and normalized/catalog-confirmed values are distinct.
- WTS and WTB analytics are separate.
- Price analytics use asking price, not retail/list price.
- FX rate, FX source, and FX date must be retained.
- Images are linked first to raw messages, then later associated to individual candidates by validation.

## Migration Rules

Historical migration is copy first, normalize later:

```text
Legacy MySQL/MariaDB
-> staging raw import
-> verification
-> production raw_messages
-> normalization workers
```

The migration must be read-only on source, batch-based, checkpointed, idempotent, and verified by exact counts, date ranges, missing IDs, duplicate source identities, random samples, and media-link integrity.

## Review Standard

For every finding include:

- Severity
- Classification
- File and line
- Current behavior
- Evidence
- Business/data impact
- Security/operational impact
- Recommended correction
- Regression tests required
- Migration or dependency risk

