# Shadow Promotion Policy

## Purpose

`normalization_shadow_v4` is an evidence and review table. It is not a live
listing source and it must not be copied into `watch_records` by a generic bulk
update.

## Hard blocks

The following flags always require human review and cannot be promoted:

- `BUNDLE_SPLIT_REQUIRED`
- `NO_CANDIDATE`
- `CURRENCY_AMBIGUOUS`
- `PRICE_PARSE_FAILED`

This protects the exact failure modes seen in dealer data: multi-watch posts,
catalog aliases, bare `$` values, price-only lines, and incomplete listings.

## Catalog-confirmation gate

A single-candidate proposal may advance only to `CATALOG_CONFIRMATION_REQUIRED`
when all of these are true:

1. Candidate has both brand and reference.
2. WTS posts have an asking price, original currency, and explicit or inherited
   currency evidence (`explicit_line_currency`, `section_context`, or
   `message_context`).
3. WTB posts may omit price, but still require candidate identity.
4. No hard-block flag is present.

The catalog match must validate reference-to-brand and configuration before any
live mutation. Catalog confirmation is a separate recorded operation, not an
LLM guess.

## Live promotion

There is intentionally no live-promotion endpoint yet. Before adding one,
require all of:

- A reviewed catalog match record.
- An audit record containing source id, prior values, new values, policy
  version, catalog match id, operator, and timestamp.
- One transaction per source record.
- A rollback path using the stored prior values.
- A staged cohort with analytics comparison before broad rollout.

The policy implementation lives in
`tools/shadow-reprocess/promotion-policy.cjs` and is unit tested. It returns a
disposition only; it never writes to `watch_records`.
