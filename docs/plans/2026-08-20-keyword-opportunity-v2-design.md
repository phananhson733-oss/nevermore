# Keyword Opportunity Map v2 Design

Date: 2026-08-20
Status: approved for local implementation
Base: `origin/main@1ccc61465f6407004395bda370b2da9ece1cd796`

## Goal

Upgrade the Marketing-owned low-competition keyword tool so every generated
candidate except a provider-confirmed zero-volume term receives a complete SERP
evidence pass. The result must separate eligible, excluded, and incomplete
keywords, preserve provider and inference provenance, and expose a stable
keyword evidence contract that a later Blog Agent can consume.

This remains a read-only Marketing tool. It does not create an App Artifact,
start Content Shadow, generate a blog draft, publish content, or write to a CMS.

## Approved Decisions

1. Keep the existing generated-candidate ceiling of 150. The ceiling bounds the
   LLM output contract; it is not a SERP sampling quota.
2. Every deduplicated candidate except `explicit_zero` receives a SERP attempt.
   `provider_no_data` candidates are included.
3. Remove the aggregate provider-cost ceiling and account-wide daily run breaker
   from this v2 execution path during the initial implementation.
4. Use bounded parallel SERP execution in the existing second request. Preserve
   per-call deadlines, provider concurrency protection, no replay after an
   outcome-unknown transport failure, and explicit per-keyword failure states.
5. Increase the context crawl to 20 successfully projected pages and allow the
   proposition extraction prompt to consume those 20 pages.
6. Do not build the Blog Agent handoff in this change. Design the result fields
   so a later handoff does not need to reinterpret or fabricate evidence.
7. AI Overview presence/content is a ranking discount in v2, not a hard veto.
8. Coverage copy must describe observed evidence, never claim zero exposure or
   confirmed site-wide absence from a missing GSC/sitemap row.

## Non-Goals

- No new App route, canonical App table, Artifact, Action, or Content Shadow run.
- No commit, push, PR, deployment, hosted migration, or paid production canary
  in the current authorization.
- No opaque opportunity score.
- No Ahrefs DR or Semrush Authority Score conversion.
- No claim that a lexical cluster is proven to belong on one page.
- No promise that a draft or published page exists.

## Existing Components to Reuse

- `packages/sources/src/crawl/context-profile.ts`: guarded same-origin context
  crawl, sitemap discovery, page-value ranking, and bounded worker pool.
- `apps/marketing/src/lib/tools/keyword-prompts.ts`: hostile-input isolation,
  strict structured replies, candidate provenance, and bounded LLM output.
- `packages/sources/src/dataforseo/keyword-metrics.ts`: Keyword Overview, SERP
  Advanced, and bulk domain rank transport with response/body/deadline guards.
- `packages/sources/src/dataforseo/labs-traffic.ts`: market/language-scoped bulk
  estimated organic traffic (`organicEtv`).
- `packages/public-tools/src/seo-audit/serp-shape.ts`: AI/community item-type
  vocabulary.
- `packages/public-tools/src/keyword-opportunity/*`: explicit-zero versus
  provider-no-data semantics, coverage evidence, withheld reasons, clustering,
  report assembly, CSV formula protection, and locale-completeness tests.
- `apps/marketing/src/lib/tools/crawl-cache.ts` and Marketing Supabase RPC
  patterns: server-only, provenance-bearing, fail-soft evidence cache pattern.

## Architecture

```text
Stage 1: site context

submitted verified property URL
        |
        +--> guarded homepage/robots/sitemap reads
        |       |
        |       +--> URL inventory evidence + completeness/truncation
        |
        +--> page-value ranked fetches until 20 successful pages
                |
                +--> proposition extraction from up to 20 pages
                +--> sealed context token

Stage 2: keyword evidence

sealed context token
        |
        +--> candidate expansion <= 150
        +--> deduplicate
        +--> Keyword Overview batch
        +--> GSC query and query+page positive observations
        +--> all candidates except explicit_zero enter SERP plan
                |
                +--> bounded parallel SERP Advanced calls
                +--> per-keyword success/failure result
                |
                +--> globally deduplicate registrable domains
                        +--> bulk DataForSEO rank
                        +--> bulk organic ETV by market/language
                        +--> RDAP registration observations
        |
        +--> deterministic three-signal evaluation
        +--> optional, versioned SERP/AIO interpretation
        +--> eligible / excluded / incomplete
        +--> clusters + stable display ordering + CSV
```

The existing two-request shape remains. The first request still returns a
short-lived identity-bound token. The second request performs the complete
keyword evidence pass. If bounded parallelism cannot reliably complete within
the deployed function ceiling, deployment is blocked and the same per-keyword
contract becomes the input/output of a later durable async executor; the domain
contract must not change for that migration.

## Evidence Contract

The v2 schema version is `keyword_opportunity_map.v2`. The public-tool envelope
remains `mode: public_preview` and `persistence: none`; evidence caches do not
turn a run into canonical product persistence.

Every candidate keeps:

```text
keyword
lane
discoveryBasis
questionForm
propositionIndex
validation
coverage
serp
signals
decision
remainingDecisions
clusterId
```

### Validation

```text
availability: available | explicit_zero | provider_no_data
volume: number | null
difficulty: number | null
providerIntent: informational | navigational | commercial | transactional | null
```

`explicit_zero` is excluded before SERP. `provider_no_data` is not zero and
continues to SERP.

### Coverage

The internal evidence states remain more precise than the customer-facing
action buckets:

```text
observed_query_page
observed_query_without_page_attribution
possible_existing_page
not_observed_in_bounded_inventory
gsc_sample_not_read
inventory_unavailable
inventory_truncated
```

Only a positive GSC query+page observation proves that a specific page received
impressions for the candidate. A missing row never proves zero exposure.

### SERP

```text
status: complete | unavailable
failureReason: provider_unavailable | provider_no_data | transport_outcome_unknown | null
observedAt
organicResults[<=10]: position, domain, url, title
pageItemTypes
communityResults: position, domain, url, source
aiOverviewObservation (server-only): availability, markdown, loadedAsync
domainRanks
domainTraffic
domainRegistrations
```

All remote free text is bounded and treated as untrusted data. Organic titles
render as text and CSV keeps formula-injection protection. AI Overview markdown
is only model/decision input on the server and never enters the public payload.

### Three Deterministic Signals

1. `young_domain`: the newest usable RDAP `registration` observation is no more
   than 24 months old.
2. `low_organic_traffic_domain`: at least one page-one domain has a known
   market/language-scoped organic ETV below the threshold for the requesting
   site's DataForSEO rank tier.
3. `community_result`: a provider community item or versioned domain fallback
   appears with a reportable position.

Initial site-rank tiers are explicitly versioned and calibration-pending:

```text
rank 1..200   -> new_or_weak  -> ETV < 5,000
rank 201..500 -> medium       -> ETV < 50,000
rank 501..1000-> strong       -> ETV < 100,000
rank 0/null   -> unavailable  -> no traffic signal verdict
```

DataForSEO rank 0 is the provider's no-backlink-data conflation and is not
treated as measured weakness.

### AI Overview

AI Overview evidence is separate from the three deterministic signals. The
server-side report observation retains the bounded markdown long enough to run
interpretation and the discount rule:

```text
availability: observed | not_observed | unavailable
markdown: string | null
loadedAsync: boolean | null
answerAssessment: complete | partial | not_answered | unavailable
reason: string | null
modelId: string | null
promptVersion: string | null
```

The public result is an explicit allow-list projection of that observation:

```text
availability, loadedAsync, answerAssessment, reason, modelId, promptVersion
```

It never contains `markdown`, including in eligible and incomplete rows. This
keeps the document's internal-field boundary intact while leaving the future
Blog Agent handoff deferred.

In v2, `complete` adds an `ai_overview_answer_discount` marker but does not
exclude the candidate. The discount additionally requires observed, non-empty
private markdown. The assessment cannot overwrite provider facts.

### Decision

```text
eligible:
  SERP complete
  coverage is not observed_query_page
  at least one of the three deterministic signals is positive

excluded:
  provider-confirmed explicit zero; or
  positive existing-page GSC evidence; or
  all three signals are complete and negative

incomplete:
  SERP or any signal required for the three-question decision is unavailable
```

A signal with unavailable evidence is never `false`. Therefore “three signals
all negative” is legal only when all three were actually completed.

## Ordering

Display ordering is deterministic and shared by UI and CSV:

1. eligible before excluded before incomplete;
2. eligible rows by positive signal count descending;
3. rows without AI Overview answer discount first;
4. measured volume descending, null last;
5. normalized keyword ascending as the stable tie-break.

The UI keeps three sections rather than putting placeholders in the eligible
table. Each excluded/incomplete row carries one exact reason.

## L1 Inventory and L2 Context

L1 and L2 share guarded transport but produce different evidence:

- L1 returns URL-only inventory plus `documentsRead`, `urlsDiscovered`,
  `truncated`, and `limitation`. It cannot claim completeness when sitemap
  discovery was absent, failed, off-origin, recursively capped, or truncated.
- L2 consumes the ranked URL candidates and fetches up to 20 successful pages.
  Existing page-value scoring remains authoritative. Homepage header/footer
  membership may boost priority but does not replace the multilingual scorer.

The sealed token carries only the bounded URL inventory facts needed for
coverage, not arbitrary page bodies. Token and request byte limits are raised
only as far as tests prove necessary for 20 URLs plus inventory metadata.

## Provider Execution

Build an immutable SERP execution plan before starting the first call. Execute
it with a fixed worker pool and preserve input order in the collected result.
Each slot is attempted once. Transport timeouts are outcome-unknown and are not
silently retried.

Aggregate cost admission is disabled for this initial v2 implementation, but
actual provider cost is still recorded for calibration. Per-keyword failures do
not throw away successful samples; they become `incomplete` rows.

After SERP completion, deduplicate domains once across the whole run before
bulk rank, traffic, and RDAP enrichment. Traffic cache identity includes domain,
location, Labs language, metric version, and observation month. RDAP cache
identity uses the registrable domain and carries the source and observation
time; it uses a long finite TTL rather than permanent truth.

## Error Handling

- Authentication, token identity, invalid input, and GSC grant failures keep
  their existing HTTP/error-code behavior.
- Candidate-generation or Keyword Overview failure remains a hard run failure:
  no unvalidated candidate payload is returned.
- Individual SERP, rank, traffic, RDAP, or AIO interpretation failures are
  per-keyword evidence gaps. The response may be partial but does not erase
  completed evidence.
- Missing sitemap and truncated inventory are visible coverage limitations.
- No remote error body, prompt, credential, or unbounded third-party content is
  logged or returned.

## UI

The result keeps the run context and funnel, then renders:

1. Eligible keywords with keyword, volume, KD, provider/inferred intent,
   weakest rank/domain/position, three signal facts, AI Overview state,
   coverage action, and remaining decisions.
2. Similar-keyword groups with an explicit lexical-only limitation.
3. Excluded keywords grouped by exact reason.
4. Incomplete detection grouped by exact missing stage and retry guidance.

The existing `nextChecks` column becomes `remainingDecisions`. Coverage removes
only the overlap check it actually settles; commercial fit and uncertain intent
remain visible. No Blog Agent button is added.

## Verification Strategy

All behavior changes use red-green TDD. Required coverage includes:

- 20 successful L2 pages, replenishment, and token round-trip;
- inventory unavailable/truncated/complete states;
- GSC query+page positive evidence and top-row/privacy-safe absence semantics;
- explicit zero excluded before SERP;
- provider-no-data candidates still sampled;
- every eligible candidate receives one SERP attempt under bounded concurrency;
- per-keyword SERP failures remain incomplete while successes survive;
- AI Overview markdown, community items, titles, and URLs parse with byte bounds;
- private AI Overview markdown reaches interpretation/discounting but never an
  eligible or incomplete public payload row;
- rank 0, unresolved rank, unresolved traffic, and RDAP missing events remain
  unavailable rather than false/zero;
- traffic/RDAP cache identity and expiry;
- three-signal decision truth table;
- stable sorting and CSV/UI parity;
- plain-text rendering and CSV formula-injection guards;
- no Blog/App handoff or canonical write.

No paid provider request is necessary for deterministic acceptance. A separately
authorized canary is required before any production deployment.
