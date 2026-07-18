# WatchFacts v4.2 Bundle Canary - CTO Release Report

Date: 2026-07-18

## Executive decision

The v4.2 bundle parser changes passed the 10,000-parent release gate and are ready for code review and deployment as a separately checkpointed shadow job. They are not approved for automatic child materialization or duplicate suppression yet.

The validation was read-only. No `watch_records`, shadow rows, Trading Floor records, Price Research records, or production review decisions were changed.

## Scope

- 10,000 existing production shadow rows flagged `BUNDLE_SPLIT_REQUIRED`
- 10,000 matching immutable source records
- 115,486 extracted watch candidates
- Comparison against the existing `v4.1-dial-context` shadow output
- Local re-analysis with `v4.2-line-condition`

The repeatable audit command is:

```powershell
$env:BUNDLE_CANARY_ROWS="10000"
$env:BUNDLE_CANARY_PAGE_SIZE="500"
$env:BUNDLE_CANARY_CONCURRENCY="5"
railway run node tools/shadow-reprocess/bundle-canary-report.cjs
```

The final detailed JSON was written locally to `audit-output/bundle-canary-v42-10k-final-gate/report.json` and remains ignored by Git. The report records the last source ID so a later cohort can continue without re-auditing this range.

## Verified results

| Check | Result |
| --- | ---: |
| Source records requested/found | 10,000 / 10,000 |
| Missing source records | 0 |
| Existing candidates | 115,486 |
| v4.2 candidates | 115,486 |
| Rows with changed candidate count | 0 |
| Candidates with exact raw-line lineage | 115,486 (100%) |
| Candidates missing raw-line lineage | 0 |
| Candidates with references | 115,486 (100%) |
| Explicit-condition candidates checked | 24,475 |
| Condition corrections proposed | 20,136 |
| Candidates with price and currency resolved | 83,305 (72.1%) |
| Candidates left unresolved instead of guessed | 32,181 (27.9%) |
| Suspicious sub-$500 candidates before fixes | 1,558 |
| Suspicious sub-$500 candidates after final 10k gate | 1,154 (1.0% of candidates) |
| Million-plus candidates after final 10k gate | 2,933 (2.5% of candidates) |

The remaining sub-$500 values are explicit malformed or scale-less source text such as `$1.25`, `hkd368`, `810HKD`, or `1.42k HKD`. The parser must not silently add a missing `K` or `M`. These values remain attached to their raw lines and must be excluded by the plausibility/review gates.

Price provenance is now part of the audit. Of the 1,154 low values, 799 came from explicit line currency, 320 from an existing structured source currency, and 35 from section currency. Of the 2,933 million-plus values, 545 came from explicit line currency, 2,341 from an existing structured source currency, and 47 from section currency. Million-plus values are not automatically errors in this market. They include explicit rare-watch asks and must be evaluated by reference/configuration cohorts rather than a global ceiling.

All 32,181 unresolved candidates are intentionally withheld from Price Research. No multiplier is invented and no ambiguous dollar sign is silently converted to USD.

## Defects corrected

1. A collapsed bundle's structured parent price could be copied into children that had no line-level price. Source-price fallback is now allowed only for a single-candidate message.
2. `HK` beside an amount is recognized as HKD, while location phrases such as `arrive HK` do not establish currency context.
3. Alphanumeric certificate tokens such as `SC330` no longer merge into a nearby price.
4. Shared currency tokens no longer turn years or limited-edition counts into prices, for example `2018 HKD 720,000`.
5. Dual-currency bridges preserve outward pairs, for example `498k USDT 3.85m HKD`.
6. Chained pairs select the correct sides, for example `2024 HKD 1.545M USDT 200,000`.
7. Punctuation such as `HKD:1340000` is accepted.
8. Month/year fragments following a price no longer replace it, for example `$225,000hkd 5/2025`.
9. Explicit line-level `New` or `Used` overrides inherited section condition. Missing condition remains unresolved and is never changed to `Used` by default.
10. A comma-delimited date can no longer merge with a following price, for example `N12/2024,3.1M hkd` now resolves to `3.1M HKD`, not `20.2431B HKD`.
11. A following word can no longer donate its first letter as a multiplier, for example `HKD 20,000 White Tag` remains `20,000 HKD`.
12. Reference suffixes are protected from section-level multiplier inference, for example Rolex `14060M` is not interpreted as `14.06B HKD`. With no explicit price evidence, the candidate remains unresolved.

## Test evidence

- 33 targeted parser tests pass.
- The full normalization contract suite passes: 94/94 tests after the final reference-suffix regression was added.
- Targeted ESLint checks pass.
- The production frontend build passes.
- The final canary completed against production source evidence in read-only mode.
- Raw messages remain immutable.

Repository-wide lint still reports the previously documented baseline of 154 errors and 2 warnings in unrelated legacy modules. This branch adds no targeted lint errors. The legacy lint backlog remains a separate cleanup workstream and should not be mixed into the bundle parser rollout.

## Railway status

The Railway service is online, but the current job `normalization-v4-dial-production` is complete at its existing cursor. Logs repeatedly show `processed=0, complete=true`, followed by `lease_busy`. It is not applying this v4.2 bundle work.

Do not reset or reuse that checkpoint. The v4.2 rollout needs a distinct job name/checkpoint so it can be monitored independently and resumed safely.

## Safe rollout sequence

1. Merge and deploy the parser/test changes after CI passes.
2. Start a new shadow-only job such as `normalization-v42-bundle-canary`; do not mutate `watch_records`.
3. The 10,000-parent read-only gate is complete; preserve its report as release evidence.
4. Deploy the same cohort through the new shadow-only job and reconcile its persisted shadow output against this local report.
5. Confirm Price Research excludes plausibility failures, unresolved prices/currencies, and unsplit parents.
6. Approve and materialize child records in a bounded batch only after the shadow review passes.
7. Suppress duplicate parents only after child lineage and counts reconcile.

## Release condition

Code merge: approved after CI.

Production data mutation: not approved in this report. The read-only 10,000-row gate passed, but persisted shadow output must still reconcile under a separate checkpointed v4.2 job before bounded child materialization is approved.
