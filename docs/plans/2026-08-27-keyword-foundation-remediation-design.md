# Low-Competition Keyword Foundation Remediation Design

Date: 2026-08-27
Status: approved by the owner for implementation and production release
Base: `origin/main@5a72561454139999976f7c1bfbf64a7a3ebd9ff4`

## Goal

Make the Low-Competition Keywords result explainable and internally
reconcilable, stop treating a model attribution as an observed answer page,
admit a candidate once one independently observed opportunity signal is
positive, and create the evidence needed to calibrate thresholds without a
paid reproduction run.

This design is the first of two releases. It changes no database, Worker,
Product App, environment variable, or hosted queue. A second release may move
the paid pipeline to Vercel Workflow only after the owner separately approves
the new Workflow runtime and its Steps/Storage usage.

## Current Production Evidence

The 2026-08-27 AstrologyWiki run reconciled as follows:

- generated/deduplicated: `150 / 150`;
- validation: `97 provider_no_data + 0 explicit_zero + 53 available = 150`;
- final disposition: `94 eligible + 34 withheld + 22 incomplete = 150`;
- SERP: `150 planned`, `145 complete`, `5 provider_unavailable`;
- provider-recorded cost: `$0.580328`;
- stage two LLM usage: 16 requests, 242,955 input tokens, 17,738 output tokens.

The run proves that the public result can be partial while the run-level banner
names only the SERP gap. It does not retain enough privacy-safe summary data to
reconstruct the 22 incomplete reasons after the browser result is gone.

## Decisions

### 1. Bump the result contract to v3

The decision algorithm and public evidence contract change, so the schema
literal becomes `keyword_opportunity_map.v3`. The UI remains tolerant of a v2
payload during a deployment-skew window, but every new producer emits v3.

### 2. Use monotonic three-valued decision logic

The three opportunity signals are an OR rule:

```text
one or more observed positives        -> eligible
no positive and any unavailable       -> incomplete
all three complete and not observed   -> excluded
```

Unavailable evidence never becomes false. A known positive also never becomes
unknown merely because a sibling signal did not resolve. The row keeps every
missing sibling fact and remains visibly partial at the evidence level.

### 3. Replace the bare supporting-page URL with provenance

The result carries a page reference only as one of these sources:

```text
gsc_observed_query_page  measured query-page evidence
lexical_page_match       deterministic title/heading token overlap
inventory_url_match      deterministic sitemap-path token overlap
llm_proposition_source   the crawled page from which a model proposition came
```

The shape uses `availability: available | unavailable`, not `observed`, because
an LLM proposition source is not an observed answer relationship. The existing
`supportingPageUrl` remains optional and deprecated for a short v2 compatibility
window; v3 UI and CSV read only the provenance-bearing field.

Labels are source-specific:

- GSC: `Measured query page`;
- lexical: `Related crawled page`;
- inventory: `Possible existing page`;
- LLM attribution: `Candidate source page`.

No non-GSC source may be labelled `Page that answers it` or `Already served`.
GEO eligibility continues to use the same three page-one signals as SEO; it
does not silently restore the historical supporting-page hard gate.

### 4. Emit a complete, privacy-safe run ledger

Every v3 result contains `process`:

```text
validation
  requested, available, explicitZero, providerNoData, accounted

serp
  planned, dispatched, completed, failed, failureReasons, accounted

decisions
  eligible, withheld, incomplete, positiveWithUnavailableSignals,
  withheldReasons, incompleteReasons, accounted

supportingPages
  counts by provenance plus unavailable

signals
  state-combination counts without keyword text

thresholds
  policyVersion, youngDomainMonths, siteDomainRank,
  siteRankTier, lowOrganicTrafficThreshold

durationsMs
  total, validation, coverage, serpSampling, serpInterpretation,
  domainEnrichment, report
```

The server logs the same bounded summary once. It must not log site URLs,
keywords, prompts, provider bodies, credentials, cookies, model free text, or
per-domain result lists.

The UI shows the reason histograms in the screening-process disclosure and
offers a local `Export audit JSON` button. The JSON is the exact public result
already present in the browser; exporting it creates no server persistence.
CSV keeps its eligible-row purpose and adds only supporting-page provenance.

Hard invariants:

```text
deduplicated == available + explicitZero + providerNoData
deduplicated == eligible + withheld + incomplete
serp.planned == serp.completed + sum(serp.failureReasons)
serp.dispatched == serp.planned - budget_exhausted
```

An invariant failure is a contract bug. Tests fail; production still returns
the evidence with `accounted: false` rather than inventing a missing count.

### 5. Make calibration executable without claiming fake calibration

Add a pure replay module and CLI that consume an exported v3 result plus an
optional human-label ledger. The harness compares:

- v2 strict unknown-first policy;
- v3 positive-first policy;
- candidate young-domain cutoffs;
- candidate ETV tier thresholds.

Without labels it reports yield, incomplete rate, exclusion rate, signal
prevalence, and verdict flips. With labels it also reports precision, false
positives, and missed true opportunities by lane, site tier, and discovery
basis.

No numeric threshold changes in this release. The 24-month and
5k/50k/100k values remain explicitly provisional until a committed,
owner-reviewed label corpus proves a replacement. Synthetic fixtures test the
harness; they are never described as calibration data.

### 6. Correct public methodology copy

All EN/ZH surfaces say:

- the model proposes candidates and a provider prices them;
- SERP requests run through a replenishing pool of up to ten concurrent calls,
  not fixed waves;
- the funnel measures `page-one weakness context`, not the v3 decision gate;
- a candidate-source page is not an observed answer page;
- positive evidence may admit a row even when a sibling signal is unavailable,
  and the missing sibling remains visible.

### 7. Add a paid-call-free tool E2E

A dedicated Marketing Playwright spec covers:

1. signed-out connection gate;
2. connected `read -> confirm -> run -> result` with mocked context and
   opportunities responses;
3. a result containing eligible, incomplete, and withheld rows plus a fully
   reconciled process ledger;
4. partial-empty wording;
5. an opportunities error returning to confirmation rather than discarding the
   context;
6. audit JSON export and evidence provenance labels.

The test aborts any unexpected API request and never calls GSC, an LLM,
DataForSEO, RDAP, or production.

## Runtime Completion Boundary

This release improves deadline and provider diagnosis but does not claim to be
durable. The existing 300-second route remains until one of these is explicitly
approved:

1. **Vercel Workflow (recommended):** durable steps, persisted run state,
   retries, progress and final result; new dependency, Next config, and billed
   Workflow Steps/Storage.
2. **Signed client batching:** no new infrastructure, but not a durable
   server-side executor and therefore not an acceptable substitute for the
   final objective.

No migration, queue, Product dependency, new environment variable, or Workflow
configuration enters this first release.

## Error Handling

- A candidate-generation or keyword-validation failure remains a hard request
  failure.
- Per-keyword SERP and enrichment gaps remain typed evidence, never negative.
- A positive signal may survive a sibling gap, but the row and run ledger keep
  that gap visible.
- Missing process fields from a v2 payload render as `not measured`, never zero.
- Audit export uses JSON text generated from the in-memory public payload and
  applies no HTML interpretation.

## Verification

- RED/GREEN unit tests for positive-first logic and every supporting-page
  provenance source.
- Handler tests for all ledger counts, durations, invariant failures and safe
  summary logging.
- Report/CSV/UI tests for v2 skew compatibility and v3 output.
- Calibration replay tests with synthetic labelled and unlabelled fixtures.
- Dedicated Marketing Playwright E2E with unexpected-network guard.
- Focused keyword suite, Marketing typecheck/lint/build, repository typecheck,
  unit tests, mock E2E, spec/docs/boundary/secrets gates, and diff check.
- Independent specification, correctness, security/privacy and UI review.
- After merge: exact Marketing SHA/READY/aliases/live-copy/runtime-log evidence,
  then independent Product candidate and `app.gengrowth.ai` identity evidence.

## Non-Goals of the First Release

- no numeric threshold change without labels;
- no paid production reproduction;
- no server-side storage of result keywords;
- no database migration;
- no `apps/web`, Worker, Railway or Product change;
- no Blog Agent, draft, Artifact, CMS write or automatic publishing;
- no claim that the synchronous route is durable.
