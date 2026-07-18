# WatchFacts v4.2 Bundle Canary - CTO Release Report

Date: 2026-07-18

## Executive decision

The v4.2 bundle parser changes are ready for code review and a larger shadow canary. They are not approved for automatic child materialization or duplicate suppression yet.

The validation was read-only. No `watch_records`, shadow rows, Trading Floor records, Price Research records, or production review decisions were changed.

## Scope

- 1,000 existing production shadow rows flagged `BUNDLE_SPLIT_REQUIRED`
- 1,000 matching immutable source records
- 11,287 extracted watch candidates
- Comparison against the existing `v4.1-dial-context` shadow output
- Local re-analysis with `v4.2-line-condition`

The repeatable audit command is:

```powershell
$env:BUNDLE_CANARY_ROWS="1000"
railway run node tools/shadow-reprocess/bundle-canary-report.cjs
```

The detailed JSON is written locally to `audit-output/bundle-canary-v42/report.json` and remains ignored by Git.

## Verified results

| Check | Result |
| --- | ---: |
| Source records requested/found | 1,000 / 1,000 |
| Missing source records | 0 |
| Existing candidates | 11,287 |
| v4.2 candidates | 11,287 |
| Rows with changed candidate count | 0 |
| Candidates with exact raw-line lineage | 11,287 (100%) |
| Candidates missing raw-line lineage | 0 |
| Candidates with references | 11,287 (100%) |
| Explicit-condition candidates checked | 2,699 |
| Condition corrections proposed | 2,190 |
| Candidates with price and currency resolved | 8,420 (74.6%) |
| Candidates left unresolved instead of guessed | 2,867 (25.4%) |
| Suspicious sub-$500 candidates before fixes | 1,558 |
| Suspicious sub-$500 candidates after fixes | 107 |
| Reduction in suspicious low prices | 93.1% |
| Million-plus candidates after fixes | 253 |

The remaining 107 sub-$500 values are explicit malformed or scale-less source text such as `$1.25`, `hkd368`, `810HKD`, or `1.42k HKD`. The parser must not silently add a missing `K` or `M`. These values remain attached to their raw lines and must be excluded by the plausibility/review gates.

Million-plus values are not automatically errors in this market. They include explicit rare-watch asks and must be evaluated by reference/configuration cohorts rather than a global ceiling.

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

## Test evidence

- 39 targeted normalization and shadow-reprocess tests pass.
- The full normalization contract suite passes: 91/91 tests.
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
3. Run 10,000 bundle parents through the new version with checkpoints.
4. Review all sub-$500 outputs, a sample of million-plus outputs, currency chains, and explicit-condition changes.
5. Confirm Price Research excludes plausibility failures, unresolved prices/currencies, and unsplit parents.
6. Approve and materialize child records in a bounded batch only after the shadow review passes.
7. Suppress duplicate parents only after child lineage and counts reconcile.

## Release condition

Code merge: approved after CI.

Production data mutation: not approved in this report. It requires the 10,000-row shadow gate, review evidence, and a separate checkpointed v4.2 job.
