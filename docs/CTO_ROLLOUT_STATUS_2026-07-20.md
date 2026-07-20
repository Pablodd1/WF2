# CTO rollout status - 2026-07-20

## Completed in this rollout

1. Applied the repository security-hardening migration to production. Optional
   objects that do not exist in the live schema are now skipped safely.
2. Added and applied database-backed quotas for the public paid-AI routes.
   Anonymous and authenticated roles cannot call the quota RPC; service role can.
3. Rechecked the 13 blocked Patek/Rolex dial-review rows. All 12 live Rolex
   `116500LN` rows are already White. The live Rolex `52506` row is already Ice
   Blue. Stale shadow proposals remain isolated from customer data and must not
   overwrite those correct live values.
4. Stopped the completed Railway cursor worker. It was processing zero rows and
   polling Supabase about every five seconds.
5. Ran the requested 200-image exact-lineage pilot. Six records passed every
   source identity and brand/reference gate and were linked. No lower-confidence
   records were published.

## Image pilot evidence

| Metric | Result |
| --- | ---: |
| Raw image filenames | 16,989 |
| Spaces CSV rows scanned | 1,821,738 |
| Filename lineage matches inspected | 1,000 |
| Customer-safe exact matches | 6 |
| Linked | 6 |
| Guessed or force-linked | 0 |

## Current production safeguards

- Raw messages remain preserved.
- WTB observations stay out of asking-price analytics.
- Bundle parents remain visible until reviewed child sets reconcile.
- Images require exact source identity plus brand/reference agreement.
- Paid-AI routes use shared database-backed quotas keyed by a one-way client hash.
- The completed Railway cursor worker is scaled to zero.

## Next inputs and gates

1. Receive the local path to the manually unbundled UTF-8 CSV parts and run the
   1,000-row lineage/intake audit before any staging import.
2. Receive the legacy `auctions` export keyed by `id`, including `front_image`,
   original posting date, seller identity/contact, company, and raw text.
3. Reconcile the 194 unfilled image targets through `auctions.front_image`; keep
   image work after listing lineage and duplicate review.
4. Resolve the 315 blocked children in the existing 25-parent canary before any
   parent is suppressed.
5. Reconcile the production migration ledger and configure protected GitHub
   migration secrets before enabling automatic production migrations.
6. Schedule analytics refresh and database maintenance away from customer traffic.

## Environment status

A random server-only `AI_RATE_LIMIT_SECRET` is configured in Vercel Production
and Preview. The client address itself is never stored.

## Follow-up branch ready for review

Branch: `codex/batch-002-full-normalization`

The branch was rebased onto current `main` on 2026-07-20. It contains the
post-PR-53 client-facing safeguards and workflows below. No production data was
modified by these commits.

1. Numeric watch references remain searchable; an exact numeric
   reference/price collision is withheld as `REFERENCE_TOKEN_AS_PRICE`.
2. Trading Floor uses cursor pagination: 24 records per mobile request and 48
   per desktop request, with bounded in-browser accumulation and an explicit
   `Load more` action.
3. Trading Floor discovery separates category, WTS/WTB intent, condition, and
   location. WTB does not require an asking price and is excluded from price
   averages.
4. The currency converter is display-only and uses dated ECB exchange-rate
   evidence. It cannot mutate normalized source or USD prices.
5. Standard numeric keycap/full-width emoji prices are parsed
   deterministically. Private pictographic price codes are never guessed and
   receive `EMOJI_PRICE_AMBIGUOUS` for human review.
6. Authenticated dealers can submit WTS and WTB records into a moderated
   `PENDING_REVIEW` queue. Submissions never write directly to public listings.
7. Three-month forecasts are generated only for exact reference + dial +
   condition cohorts meeting sample, recency, dealer-diversity, and rolling
   backtest gates. Public values remain disabled unless
   `ENABLE_PRICE_FORECASTS=true` is deliberately set after owner QA.
8. The authenticated account workspace includes profile, verified activity,
   moderated submissions, display settings, billing status, and support
   tickets. Billing is explicitly inactive during beta.
9. Lightweight Tools, Apps, Community, and Company pages now provide public
   navigation without claiming unreleased apps or commercial plans.

## Verification completed

- Production build passes after rebase.
- 127 normalization tests pass.
- 20 security tests pass.
- Touched frontend files pass ESLint.
- Phone QA at 390 x 844 found no document-level horizontal overflow on Trading
  Floor or Price Research. The Price Research heading contrast issue found in
  screenshot review was corrected on the branch.
- Bundle rows, ambiguous currency/emoji prices, and reference-shaped prices
  remain excluded from automatic publication or price analytics.

## Current deployment gate

The former Supabase Preview branch for the already-merged PR was removed. The
Vercel branch preview therefore loads the new UI but reports that the Trading
Floor database is not configured and returns zero records. That zero is an
environment state, not a validated marketplace total.

Before merge:

1. Open a fresh pull request from `codex/batch-002-full-normalization` to
   `main`; the installed GitHub integration can read checks but returned `403`
   when asked to create the PR.
2. Confirm that Supabase creates a fresh Preview branch and applies
   `20260721000000_dealer_listing_submissions.sql` and
   `20260721020000_dealer_workspace.sql` successfully.
3. Confirm both Vercel preview checks are Ready on the current head.
4. Test cursor page 1/page 2 for WTS and WTB against Preview Supabase, checking
   no overlap and stable descending source-date order.
5. Verify a linked dealer can edit only its own profile, see its own listings,
   and create a support ticket. Beta skip must not permit these writes.
6. Keep forecasts disabled until the five John references and a stratified
   50-reference backtest report are approved.

## Deliberately deferred

- The repository-wide ESLint baseline still contains 155 pre-existing issues
  in legacy components. The new/touched files pass targeted lint; broad cleanup
  remains a separate performance/debt task.
- Seller attribution for batch 002 remains blocked by missing source envelope
  fields for most parent rows. No seller name, phone, dealer identity, or region
  may be inferred.
- Image linkage remains after exact listing/source/dealer lineage. Six exact
  pilot links are proven; lower-confidence media must not be published.
- The 54,170 staged unbundled children remain pending review. Review-ready does
  not mean customer-approved, and bundle parents must not be suppressed until
  their child sets reconcile.
