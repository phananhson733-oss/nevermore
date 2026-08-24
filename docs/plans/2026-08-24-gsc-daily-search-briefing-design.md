# GSC Daily Search Briefing Design

**Status:** Approved by the owner on 2026-08-24

**Implementation boundary:** `gengrowth.ai` Marketing Public Tools only

**Target route:** `/tools/daily-search-briefing` and `/zh/tools/daily-search-briefing`

## 1. Problem

SEO operators repeatedly open Search Console each morning to answer a small set
of questions before deciding what to inspect next:

- What changed on the latest complete day?
- Did the same direction hold across a less noisy seven-day window?
- Which query/page changes are large and well-supported enough to deserve
  attention today?
- Which existing focused tool should receive the evidence next?
- Which Search Console safety reports still require a human check because the
  API cannot read them?

The supplied workbook is the domain-discovery source for this daily need. It is
an operator SOP covering a full day of GSC, GA4, competitor, content, link and
maintenance work; it is not an instruction to put every task into this tool.
The Claude Artifact controls the briefing's information density and interaction
shape, while current repository contracts control real capability, privacy and
evidence claims.

## 2. Product outcome

Add an independent, real Search Console tool to the Marketing Tools hub. Each
run reads the visitor's granted property, recomputes a stateless report, shows
at most three evidence-backed changes and at most three next actions, and keeps
all unavailable or partial evidence explicit.

This is not:

- a mock or demo report;
- a scheduler, monitor or notification service;
- an authenticated `app.gengrowth.ai` canonical analysis run;
- a GA4, index-coverage, competitor, backlink or content-production tool;
- a database-backed report history;
- a statistical-significance engine.

## 3. System boundary

```text
Browser
  -> apps/marketing page and POST route
  -> existing cookie-backed GSC grant and shared GSC gate
  -> Search Console final Search Analytics reads
  -> packages/public-tools daily-briefing deterministic projection
  -> no-store private response
  -> report held only in current React state
```

- `apps/marketing` owns the route, grant resolution, quota/concurrency gate,
  request budget, transport binding, localization and UI.
- `packages/public-tools` owns date windows, evidence floors, cadence,
  comparisons, change classification, action ordering and the versioned output
  contract.
- `packages/sources` remains the only Search Console HTTP transport.
- The tool does not import from `apps/web`, write canonical product tables, call
  a model, or perform an external mutation.
- The existing Google grant cookie may persist because it is the already-shipped
  authorization mechanism. Report data and self-check state do not persist.

## 4. Date and read plan

All dates use Search Console's Pacific calendar.

- Latest complete day: current Pacific date minus three days.
- Previous comparable day: the immediately preceding Pacific date.
- Current weekly window: seven complete days ending on the latest complete day.
- Previous weekly window: the preceding seven non-overlapping complete days.

One bounded report run requests:

1. one date-dimension read covering both weekly windows;
2. current and previous query reads, at most one 25,000-row page each;
3. current and previous query/page reads, at most one 25,000-row page each;
4. current and previous property-total reads.

The date series is the required primary evidence. Query and query/page evidence
is an optional attachment: if it fails, truncates, disagrees on aggregation, or
lacks sufficient coverage, KPI output remains available and affected changes
and actions are withheld with a machine-readable limitation.

The query/page read must never continue after the request budget expires. A
shared abort signal cancels sibling reads when the optional attachment fails so
provider calls do not continue after the response or gate release.

## 5. KPI semantics

The report exposes Clicks, Impressions, CTR and exposure-weighted Average
Position for:

- latest complete day versus previous complete day;
- current seven days versus previous seven days.

Ratios and deltas are nullable. Missing days, a zero denominator, malformed
provider values or contradictory aggregation yield `null`, never zero or an
estimate. The UI labels Average Position as exposure-weighted and always shows
the latest-complete date, the Pacific-time basis and the three-day finalization
lag.

Daily deltas provide context. Action selection uses weekly or baseline evidence,
not the single-day movement.

## 6. Cadence

The briefing has a versioned cadence decision:

- `daily` when the current complete seven-day window has at least 1,000
  impressions;
- `weekly` below that floor or when a complete daily comparison is unavailable.

Weekly cadence retains the seven-day comparison and suppresses day-level
interpretation. It explains that the downgrade prevents ordinary small-sample
movement from being presented as a daily signal.

## 7. Evidence floors and honest language

The Artifact's phrase “significance test” is intentionally replaced with
“evidence threshold.” Existing code documents that its binomial tail probability
is continuous disclosure, not a valid hit/no-hit significance test without
leave-one-out uncertainty, empirical-Bayes shrinkage and FDR control.

Version-one evidence floors are:

- at least 100 impressions for an individual query or query/page candidate;
- at least 15% relative movement and three absolute clicks for a material click
  change;
- average-position difference at most 0.5 for “position stable”;
- query/page attribution coverage at least the existing 0.8 floor before a page
  is named as the query's carrier;
- existing site CTR curve and leave-one-out quality gates before a CTR gap is
  named.

An absent prior query/page row is `not_observed`, not zero. A later row may be
called “first observed in this comparison,” never “newly indexed” or “first ever
shown.” Counts of filtered rows refer only to the rows actually read; a truncated
read cannot claim a property-wide hidden count.

## 8. Change and action projection

The report emits at most one top candidate from each ordered class:

1. `click_opportunity` — a current query with a usable leave-one-out site CTR
   baseline and a positive click gap, plus a sufficiently covered page mapping;
2. `stable_position_click_decline` — material weekly click loss while average
   position stays within 0.5;
3. `first_observed` — a sufficiently visible query/page pair not observed in the
   previous comparison window, described with the anonymization caveat.

Within a class, deterministic descending evidence order and stable lexical
tie-breaks are used. No opaque composite score is introduced. Missing classes
are not padded, so a report may contain zero to three changes/actions.

The corresponding handoffs are:

- click opportunity -> GSC Opportunity Finder;
- stable-position decline -> Traffic Drop Diagnosis;
- first observed / near-page-one -> On-Page SEO Checker.

Each action names the evidence record that triggered it. It does not promise
that a rewrite, investigation or page change will recover clicks or ranking.

## 9. Private handoff

Private GSC property, query and page values must not enter URL query parameters,
analytics events or server logs merely to move between tools.

The browser writes one minimal `gengrowth.tool-handoff.v1` payload to
`sessionStorage`, with source, destination, property, query, page, evidence id
and a short expiry. Navigation stays same-origin. The destination validates the
shape and destination, consumes and deletes it immediately, then uses only the
inputs it already supports:

- preselect property on GSC tools;
- prefill page URL and target query on On-Page SEO Checker;
- show a compact source-evidence notice without claiming the destination has
  rerun yet.

Malformed, expired, cross-destination or inaccessible storage silently produces
no handoff. This is tab-scoped, local-only transit, not report persistence.

## 10. Manual Actions and Security Issues

The briefing runs without these answers. After a report appears, it shows two
human-check rows with direct Search Console links. Each row can be marked
“checked, no notification” for the current page only.

- Unchecked remains explicitly `not confirmed`.
- The state is not sent to the API, stored in a cookie, or carried to another
  run.
- The report never treats an unchecked or checked UI control as provider-
  observed evidence.
- These reminders are outside the maximum-three automated action list.

## 11. Hourly budget

The existing shared GSC gate remains the only counter: 10 admitted GSC tool runs
per IP per hour, shared across GSC tools. Its allowed result exposes the consumed
hit count to the daily-briefing handler so the response can show the remaining
count. No second counter or client-derived estimate is added.

## 12. Page and visual structure

The new page is a fourth connected Marketing tool and uses the current
GenGrowth design tokens, navigation, theme switch and responsive shell. It
adapts the Artifact rather than copying its mock-review chrome.

Connected result order:

1. title, concise purpose and property/run controls;
2. data-through, lag, cadence and remaining-run facts;
3. four KPI cards with compact trend lines;
4. evidence-threshold disclosure;
5. at most three changes;
6. at most three action cards;
7. the two human self-checks;
8. limitations and no-persistence statement.

The Artifact's “MOCK review” banner, review-notes block and example values are
not shipped. The page supports EN/ZH, dark/light, desktop and 390px mobile with
no horizontal overflow. Tables become stacked evidence cards on narrow screens.

## 13. Registry and discovery

- Add `daily-search-briefing` to the `ConnectedTool` exhaustive registry and GSC
  connect allow-list.
- Add the card before GSC Opportunity Finder in the diagnosis group.
- Add both locale URLs to the marketing sitemap and canonical tests.
- Generate metadata, SoftwareApplication, HowTo, FAQ and breadcrumb structured
  data from the same visible content contract.

## 14. Error and limitation boundary

The handler reuses existing public-tool parsing, grant, property, gate and error
contracts:

- 400 invalid request;
- 401 no or revoked grant;
- 404 property not in the grant;
- 409 another GSC run in progress;
- 429 hourly budget exhausted;
- 503 quota store or grant refresh temporarily unavailable;
- 502 required date-series read failed.

Optional query evidence failure returns 200 with a limitation. Every successful
response is `Cache-Control: no-store, private`, `mode: public_preview`,
`persistence: none`, and schema-versioned.

## 15. Verification

Acceptance requires:

- RED/GREEN unit coverage for every new deterministic behavior;
- reader and handler tests for budgets, cancellation, grants, property scope,
  quota, partial evidence and remaining-run count;
- component tests for all connection, loading, success, weekly, partial and
  self-check states;
- exhaustive i18n, connected-tool registry, hub-order, sitemap and canonical
  tests;
- lint, typecheck, focused unit tests, the full unit project and Marketing
  production build;
- local browser verification for EN/ZH, dark/light, desktop/mobile, keyboard
  operation, no console/page errors and no 390px overflow;
- final diff and secret review.

No commit, push, PR, deploy, database migration or production GSC run is part of
the current authorization.
