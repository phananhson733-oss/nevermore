# Marketing Competitor Keyword Gap Design

Date: 2026-08-24
Status: Approved in conversation
Target: `apps/marketing` on `gengrowth.ai`

## Goal

Add an independent, signed-in Marketing tool that compares one site with 1-5
user-entered competitor domains. Competitor facts come from DataForSEO. When an
authorized Search Console property is selected, it describes only the user's
own site as an optional first-party overlay. The tool runs on demand and does
not schedule refreshes.

## Confirmed decisions

- The tool is independent from Keyword Opportunity Map.
- It stays entirely inside `apps/marketing`, `packages/public-tools`, and
  `packages/sources`.
- Existing Marketing Supabase sign-in is the primary admission boundary.
- Existing Google grant, property selection, request gates, and GSC readers are
  reused as an optional first-party overlay; they do not gate DFS gap results.
- The user enters 1-5 competitor domains manually.
- Competitor data comes from DataForSEO.
- GSC and DataForSEO remain separately labelled evidence sources.
- No cron, weekly run, next-refresh date, or cross-run “new this week” state.
- No Product App, canonical App database, Worker, pg-boss, or App OpenAPI
  dependency.
- Results are non-canonical and non-persistent. Responses are private/no-store.
- No user-credit debit is claimed until this tool has an independently
  calibrated price and an atomic ledger integration.

## Approaches considered

### A. Add a competitor lane to Keyword Opportunity Map

This would reuse the most code, but it would mix two different jobs. Keyword
Opportunity Map starts from site propositions and candidate expansion;
Competitor Keyword Gap starts from explicit competitor domains. It would also
inherit a long crawl/LLM/SERP pipeline that the simple gap job does not need.

Decision: rejected.

### B. Port the authenticated `gengrowth-agents` overlap module

The historical module already has a domain-intersection API, hook, and UI. It
is App-bound, limited to three competitors, fans out three provider calls per
competitor, collapses later competitor ranks through first-wins deduplication,
and conflates some missing metrics with zero.

Decision: use only as protocol and fixture reference; do not port its runtime
or aggregation logic.

### C. Independent Marketing tool with a single bounded POST

Reuse the current connected-tool shell, Marketing identity and GSC grant, and
the shared DataForSEO HTTP client. Add a dedicated provider operation, a pure
contract/aggregator, one Marketing handler, and one client surface.

Decision: selected. This is the smallest architecture that keeps the tool
independent and evidence-honest.

## User flow

1. The public landing page explains the tool and its data boundaries.
2. A signed-out visitor sees the existing sign-in/connect experience.
3. A signed-in visitor enters the site domain and may choose an
   already-authorized GSC property for the same site.
4. The visitor selects market and language.
5. The visitor enters 1-5 competitor domains as removable chips.
6. The visitor starts one analysis.
7. The server verifies the Supabase identity before any paid call.
8. If the visitor selected a property, the server resolves its Google grant and
   reads bounded GSC query and query-page evidence. A missing or failed overlay
   remains explicit but does not block DFS.
9. The server calls DataForSEO once per competitor in parallel.
10. The server merges competitor rows by normalized keyword and overlays any
    GSC evidence without changing either source's provenance.
11. The client renders complete, partial, unavailable, empty, and truncated
    states.

## Request contract

```ts
interface CompetitorKeywordGapRequestV1 {
  readonly property?: string;
  readonly siteDomain: string;
  readonly competitorDomains: readonly string[];
  readonly marketCode: string;
  readonly languageCode: string;
}
```

Server validation owns all expensive bounds:

- exactly 1-5 unique normalized competitor hostnames;
- no competitor may normalize to the site hostname;
- no credentials, ports, IP literals, paths, queries, or fragments;
- explicit supported market/language pair;
- server-owned organic rank ceiling and per-competitor result cap;
- bounded JSON request size.

## Provider strategy

For the missing-keyword candidate pool, call DataForSEO Labs Google Domain
Intersection once per competitor:

```json
{
  "target1": "competitor.example",
  "target2": "site.example",
  "intersections": false,
  "item_types": ["organic"],
  "location_code": 2840,
  "language_code": "en",
  "limit": 100,
  "order_by": ["keyword_data.keyword_info.search_volume,desc"]
}
```

`intersections:false` means target1 ranks while target2 does not in the same
provider dataset. With at most five competitors, the route makes at most five
pairwise calls. `Promise.allSettled` preserves successful competitors when one
fails, but the failed competitor remains explicit in coverage.

The first implementation does not perform per-keyword SERP Advanced or domain
authority enrichment. That evidence can be added later behind its own cap. The
v1 table must not claim weak-page, forum, stale-content, or AI Overview facts
that it did not collect.

## GSC overlay

GSC is first-party evidence about the selected property only. Exact normalized
query matches are projected into these states:

- `observed_strong`: a query row exists and average position is at or above the
  server-owned competitive threshold;
- `observed_weak`: a query row exists but average position is weaker;
- `not_observed_in_gsc_query_sample`: the bounded query sample completed but no
  exact row was observed;
- `gsc_query_sample_not_read`: the query sample was not successfully read.

An absent GSC row never becomes “zero impressions” or “the site has no page.” A
positive query-page row may support an `optimize_existing` next step. Without a
positive page observation, the next step is `review_content_gap`, not a claim
that a new page must be created.

## Result contract

The shared contract uses a versioned `competitor_keyword_gap.v1` envelope with:

- `run.status`: `complete | partial | unavailable`;
- `capturedAt`, market, language, site domain, and requested competitors;
- one coverage record per competitor with `complete | unavailable`, row counts,
  total count, truncation, and a bounded failure code;
- aggregated keyword rows with a `competitorRanks` domain-to-rank map;
- provider metric availability that distinguishes `available`,
  `explicit_zero`, and `provider_no_data`;
- GSC status and optional positive query/query-page observations;
- top-level requested/completed/unavailable competitor counts and result
  truncation.

The aggregator is a pure function keyed by normalized keyword. It merges later
competitor ranks instead of dropping them. Provider failure is not absence, and
provider silence is not numeric zero.

## Error handling

- `401 authentication_required`: no Marketing identity.
- `400 invalid_input`: malformed body, unsupported market/language, invalid
  property/domain, or competitor count outside 1-5.
- Supabase auth failure is returned before DataForSEO is called.
- A requested GSC property must be present in both the sealed page session and
  the refreshed grant. Grant/read failure marks the overlay unavailable; it
  does not relabel DFS rows or discard successfully collected competitor data.
- Existing per-IP GSC and public-tool gates are reused.
- `502 keyword_source_unavailable`: no competitor call completed.
- Partial provider completion returns `200` with `run.status=partial` and
  explicit unavailable competitor coverage.
- A successful provider response with zero rows is a complete empty result.
- Provider credentials and raw responses never cross the public contract or
  appear in logs.

## UI structure

- Reuse `ConnectedToolPage`, the current property selector/connect panel, market
  and language styling, elapsed-time pattern, error-code allow-list pattern,
  and result-card tokens.
- Add a labelled competitor-domain entry control with removable chips and a
  visible `n / 5` counter.
- Keep DataForSEO estimates and GSC observations in separate columns/badges.
- Default sort: competitor count descending, best competitor rank ascending,
  then available search volume descending; unavailable volume sorts last.
- Show `completed / requested competitors`, row cap/truncation, capture time,
  and provider limitations.
- Use a semantic table with `thead`, scoped column headers, a caption, keyboard
  accessible controls, inline validation, and `aria-live` for async state.
- The table may scroll horizontally on narrow screens; the document itself may
  not overflow horizontally.

## Artifact shape fidelity amendment

The supplied `竞品词差距周报` Artifact remains the visual and information-
hierarchy reference, but not the authority for capabilities the user rejected
after review. The production tool must therefore feel like the Artifact's
decision dashboard without reintroducing weekly history, scheduled refresh,
credits, SERP enrichment, or action persistence that v1 does not possess.

Three approaches were considered for the post-run surface:

1. Pixel-copy the weekly report, including period deltas, next refresh, credits,
   SERP competitiveness, and action counts. Rejected because those values would
   be synthetic or would require persistence, scheduled jobs, additional paid
   providers, and a ledger.
2. Reuse the Artifact's information sequence and controlled density while
   projecting only fields proven by the v1 envelope. Selected.
3. Add a separate persistent report route. Rejected because the confirmed tool
   is a simple, non-canonical, on-demand Marketing utility.

The selected post-run hierarchy is:

1. a compact complete/partial/unavailable status banner;
2. a scope strip showing the site, `vs`, every requested competitor, market,
   language, and capture time as chips/metadata;
3. three overview cards for returned gap rows, completed competitors, and GSC-
   observed rows in the returned sample;
4. a visible DFS-estimate versus GSC-observation legend;
5. one decision table that groups provider estimates, competitor ranks, own-
   site GSC evidence, and the deterministic next check into separate columns;
6. technical competitor coverage and conditional truncation details after the
   decision table, expanded automatically when the run is incomplete;
7. an always-visible data-boundary note explaining provider estimates, bounded
   GSC sampling, unavailable competitor traffic/conversion facts, and the
   manual-snapshot lifecycle.

Counts must name their scope. `rows.length` is “returned gap rows,” not the
unknown universe of all gaps. GSC-observed rows may be numeric only when the
overlay sample was read; a not-requested or unavailable sample displays an
unavailable marker rather than zero.

The form and results are siblings. Results must not be nested inside the form
panel, because double card padding reduced the usable mobile result width to
244px in the first browser implementation. On narrow screens the scope and KPI
cards stack, while only the table wrapper scrolls horizontally. The document
must retain zero horizontal overflow.

The shell has two deliberate modes. Signed-out visitors retain the complete
Marketing explanation, FAQ, and account gate. Once server authentication has
passed, this tool uses a compact connected mode: it keeps the task hero and live
tool but suppresses the downstream workflow/output/FAQ acquisition sections.
That prevents an authenticated report workflow from reading like a second long
landing page while preserving the public acquisition surface.

After a successful manual run, focus remains under user control but the viewport
may move once to the newly mounted result region so the response is not hidden
below the completed form. This is navigation to newly produced content, not a
fake progress transition; it must not create repeated scrolling or ignore
reduced-motion preferences.

## Non-goals

- Scheduled or automatic refresh.
- Historical comparisons or “new this week.”
- Competitor auto-discovery.
- App project persistence or canonical Keyword/Competitor Library writes.
- LLM candidate generation or interpretation.
- Per-keyword SERP Advanced, AI Overview, RDAP, or authority enrichment in v1.
- Content brief generation or automatic Action creation.
- User-credit deduction or a fixed 25-credit claim.
- Commit, push, deploy, migration, or production provider validation in this
  local implementation task.

## Test strategy

1. Provider client contract tests for request direction,
   `intersections:false`, organic-only scope, parsing, null metrics, timeout,
   bounded body, task errors, and provider cost metadata.
2. Pure contract tests for domain validation, 1/5/6 bounds, deduplication,
   first-party/third-party provenance, multi-competitor merging, partial
   coverage, null-vs-zero, sorting, and truncation.
3. Handler tests for authentication, grant/property validation, GSC-before-DFS
   ordering, zero paid calls on refusal, all/partial/no provider success, and
   private no-store responses.
4. Client tests for domain chips, submit states, GSC/DFS badges, partial and
   empty results, retry, accessibility, and narrow viewport behavior.
5. Focused typecheck/lint/build and a local browser smoke with deterministic
   provider seams. No real provider request is required for acceptance.
