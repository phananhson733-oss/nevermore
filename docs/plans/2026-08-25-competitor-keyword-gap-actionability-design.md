# Competitor Keyword Gap Actionability v1.1 Design

Date: 2026-08-25
Status: Approved in conversation (option A)
Target: `apps/marketing` on `gengrowth.ai`
Base: `a9f42f7810a11d04134415b7777ed5aa071eea94`

## Goal

Make the existing signed-in, on-demand competitor keyword gap tool read like the
approved Artifact using only evidence the current DFS and GSC calls already
collect. Fix the live table typography, surface first-party GSC observations,
produce differentiated next checks, and provide a private handoff to the
existing On-Page SEO Checker. Do not add another paid provider request.

## Production evidence that drives this revision

The 2026-08-25 production run for `astrologywiki.com` versus `astro.com`
returned:

- 100 displayed rows from 38,537 provider-reported rows;
- a usable 28-day GSC overlay;
- 10 rows with positive GSC observations and an observed page;
- 90 rows not observed in the bounded exact-query sample;
- 90 identical `review_content_gap` recommendations;
- 10 identical `optimize_existing` recommendations.

The current table parent computes to 12-12.5px, but paragraph children compute
to 17.44px with 30.52px line-height. The cause is the global prose rule:

```css
p {
  font-size: clamp(0.97rem, 1.4vw, 1.09rem);
  line-height: 1.65;
}
```

The table relies on inheritance while rendering its compact data as `<p>`
elements, so the prose rule wins. This is a scoped typography bug, not a font
download failure.

## Confirmed boundaries

- The tool remains independent, signed-in, manual, and non-persistent.
- The user still enters 1-5 competitors.
- DataForSEO Domain Intersection remains the only paid competitor request.
- GSC remains optional, first-party, bounded, and separately labelled.
- A missing GSC row never becomes zero impressions or proof of no page.
- No weekly history, refresh job, credit claim, LLM recommendation, crawl,
  database write, or canonical Product/App action is added.
- SERP page-one enrichment, weak-site evidence, forum/age signals, AI Overview,
  and true winnability remain a separately costed second phase.

## Result contract v2

The public envelope becomes `competitor_keyword_gap.v2`. There is no persisted
v1 data and the page/API deploy together, so a clean versioned replacement is
safer than silently changing v1 recommendation semantics.

### GSC query evidence

Keep the existing four query states:

- `observed_strong`
- `observed_weak`
- `not_observed_in_gsc_query_sample`
- `gsc_query_sample_not_read`

Add an explicit evidence basis:

```ts
type GscQueryEvidenceBasis = "query" | "query_page" | null;
```

An exact positive query row is primary evidence. If no query row exists but one
or more exact positive query-page rows do, they are still positive first-party
evidence, but the UI labels their basis and does not claim they are a complete
query total.

### GSC page evidence

```ts
type GscPageStatus =
  | "observed_sufficient"
  | "observed_partial"
  | "not_observed_in_gsc_query_page_sample"
  | "gsc_query_page_sample_not_read";
```

For an exact query:

1. Sum the visible query-page impressions.
2. Compare them with the exact query impressions when those exist.
3. `queryPageCoverage = visiblePageImpressions / queryImpressions`.
4. Page attribution is sufficient only when:
   - a safe HTTP(S) page exists;
   - the query-page read is not truncated;
   - coverage is finite, between 0 and 1 inclusive;
   - coverage is at least 0.8.
5. A positive page row that misses this threshold remains
   `observed_partial`; it is displayed, not discarded.
6. Query-page truncation never erases an already observed positive page.

The selected page keeps its own impressions and weighted average position.

### Four next-check lanes

```ts
type CompetitorKeywordGapNextStep =
  | "optimize_existing"
  | "review_existing_query"
  | "review_content_gap"
  | "verify_own_coverage";
```

Decision table:

| Evidence | Next step |
|---|---|
| weak query observation + sufficient page attribution | `optimize_existing` |
| strong query observation | `review_existing_query` |
| any positive observation without sufficient page attribution | `review_existing_query` |
| complete, untruncated query sample miss | `review_content_gap` |
| GSC omitted, unavailable, unread, or truncated miss | `verify_own_coverage` |

An observed query is never routed to new-content review merely because its page
dimension is incomplete.

### Deterministic ordering

Rows are grouped by next-check lane:

1. `optimize_existing`
2. `review_existing_query`
3. `review_content_gap`
4. `verify_own_coverage`

Within observed lanes, weaker observations precede strong ones, then real GSC
impressions descend. Remaining ties use the existing deterministic DFS order:
competitor count descending, best competitor rank ascending, available search
volume descending, keyword ascending.

This is an actionability order, not a claimed SERP winnability score.

## Private On-Page Checker handoff

Extend the tab-scoped `gengrowth.tool-handoff.v1` union with a
`competitor-keyword-gap` query-page payload.

The payload includes:

- exact selected GSC property;
- keyword;
- observed page;
- bounded evidence id;
- market code;
- language code.

The destination URL remains only the locale-preserving
`/tools/on-page-seo-check`. Query, page, and property remain in
`sessionStorage`, never in the URL or analytics.

The On-Page Checker consumes the handoff once, validates the market/language
against its current allow-lists, seeds the URL/query/market/language, removes
the handoff, and renders the existing imported-intent notice.

If writing storage fails, navigation is prevented and an inline error is shown.

## Result information architecture

The post-run sequence stays:

1. run context;
2. three overview metrics;
3. source legend;
4. four next-check filter chips with counts;
5. compact decision table;
6. technical coverage details;
7. durable evidence boundaries.

### Six compact columns

1. **Keyword**
   - 15-16px semibold;
   - provider intent as a small label.
2. **Monthly search volume — DFS estimate**
   - one tabular number;
   - no three-line metric stack.
3. **Competitor coverage — DFS estimate**
   - compact domain/rank chips.
4. **Your status — GSC 28-day observation**
   - one coloured state pill;
   - one compact metric line when observed;
   - optional page path.
5. **Opportunity signals — DFS estimate**
   - keyword difficulty;
   - best competitor rank;
   - explicitly not called SERP competitiveness.
6. **Next check**
   - evidence-qualified label;
   - an action only when the evidence supports it.

DFS `ownState` is explained once in the legend, not repeated on every row.
Rows with no GSC values do not render two dash-only metric lines.

### Typography isolation

Every table text node receives an explicit size/line-height, or uses a
non-paragraph data element. Target rhythm:

- table base: 13px / 1.45;
- keyword: 15.5px / 1.25 / 600;
- metadata: 12px / 1.35;
- recommendation: 13px / 1.4;
- chips: 11-12px;
- headers: 11-12px / 600;
- numeric cells: tabular numerals.

The global prose `p` rule remains unchanged for the rest of Marketing.

### Progressive rows

- Default: first 10 rows of the active filter.
- Show the exact remaining count.
- “Show all” renders the active filter’s remaining rows.
- “Show less” returns to 10.
- Changing filter resets to 10.
- All/optimize/review-existing/content-gap/evidence-needed counts remain
  visible.

No virtualization is introduced for the bounded 100-row v1.1 result.

## Actions

- `optimize_existing` with sufficient page evidence:
  write handoff, then open On-Page SEO Checker.
- `review_existing_query` with a visible page:
  allow opening the observed page; if attribution is sufficient, also allow the
  checker handoff.
- `review_content_gap`:
  copy the keyword for a manual review; do not create a Brief automatically.
- `verify_own_coverage`:
  focus the GSC property selector and instruct the user to select/reconnect,
  then rerun.

## Test and browser acceptance

- Pure report tests cover every query/page/next-step branch, coverage threshold,
  truncation, positive query-page-only evidence, null versus zero, and ordering.
- Handoff tests cover both sources, exact-key rejection, TTL, one-time consume,
  market/language validation, and private URL boundary.
- Results tests cover four lane counts, observed-first order, compact states,
  no dash-only GSC rows, CTA qualification, storage failure, top 10/expand,
  EN/ZH parity, semantic table and keyboard scroll.
- Browser computed-style acceptance checks keyword/GSC/recommendation cell
  sizes remain below the global prose clamp.
- The real 100-row production-shaped fixture verifies 10 observed rows appear
  first, 90 misses remain bounded candidates, and document horizontal overflow
  stays zero at desktop and 390px.
