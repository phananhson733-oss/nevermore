# Keyword Opportunity Calibration Baseline

Date: 2026-08-28
Status: harness verified; real threshold calibration still unverified
Artifact: `2026-08-28-keyword-opportunity-calibration-baseline.json`
Input SHA-256: `c34de278771475d1e2b440e652f499ebf796f79d1d91bbd189e515493702d761`

## Evidence boundary

The input is a three-candidate synthetic regression fixture. It proves that the
offline replay is deterministic and that policy/threshold changes produce the
expected flips. It does **not** prove production precision, recall, opportunity
yield, or the correctness of the 24-month and 5k/50k/100k thresholds.

The generated JSON therefore carries:

```json
{
  "synthetic": true,
  "calibrated": false
}
```

Those fields must remain true/false respectively until an owner-reviewed,
anonymized production snapshot and label ledger are committed.

## Harness result

| Variant | Eligible | Incomplete | Excluded | Missed synthetic positives |
| --- | ---: | ---: | ---: | ---: |
| strict-v2 | 0 | 1 | 2 | 2 |
| positive-first-v3 | 1 | 0 | 2 | 1 |
| positive-first + weak-tier 10k | 2 | 0 | 1 | 0 |

The first flip proves the monotonic-policy regression: one observed young-domain
signal remains eligible when a sibling measurement is unavailable. The second
threshold flip only proves that the grid runner changes the expected synthetic
candidate. It is not authority to ship 10k.

The JSON also reports observed/not-observed/unavailable/not-evaluated signal
prevalence for every variant. When labels exist, precision inputs, false
positives and missed positives are broken down by lane, requesting-site rank
tier and discovery basis instead of being available only as one global total.

## Required real calibration input

Each anonymized candidate needs:

- stable candidate id, lane and discovery basis;
- requesting-site rank;
- explicit-zero and already-covered facts;
- SERP completion;
- every usable page-one domain age in months, with unresolved entries kept null;
- every usable page-one organic ETV, with unresolved entries kept null;
- community-result state;
- owner label and review note in a separate ledger.

Run:

```bash
pnpm exec tsx scripts/keyword-opportunity-calibration.mjs -- <snapshot.json> --out <report.json>
```

Before changing numeric thresholds, review precision, false-positive eligible
rows, missed true opportunities and disposition flips by lane, site-rank tier
and discovery basis. A unit-test boundary pass is not calibration evidence.
