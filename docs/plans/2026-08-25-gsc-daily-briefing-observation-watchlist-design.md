# GSC Daily Briefing Observation Watchlist Design

**Status:** Approved for implementation and release on 2026-08-25

**Decision:** Keep the existing high-confidence query/query-page change and
action gates unchanged. Add a bounded, observation-only query watchlist so a
real property can still show concrete queries and pages when no query clears an
action rule. Move the property fallback out of the query/page table and render
it as a separate site-wide trend. Observation rows never create actions,
handoffs, persistence, or URL state.

## 1. Why the shipped result is too sparse

The supplied Artifact demonstrates the intended daily workflow with three
illustrative query/page changes and three matched actions. Those mock rows were
constructed to clear the strict signal gates. They are presentation examples,
not evidence that every real property will produce three actions.

The 2026-08-25 production runs showed the missing real-data state:

- `astrologywiki.com` had 540 visible query rows, two rows at or above the
  100-impression action sample floor, one row between 50 and 99 impressions,
  zero selected query/page changes, and one observed property-wide decline;
- `gengrowth.ai` had 172 visible query rows, three rows at or above the action
  sample floor, one row between 50 and 99 impressions, zero selected query/page
  changes, and one observed property-wide decline;
- the existing result exposed only the property fallback and one generic
  downstream action, so the visitor could not see which concrete queries were
  evaluated or which lower-sample query should be watched.

The core counts were correct. The product gap was the missing middle state
between a strict action signal and a site-wide fallback.

## 2. Authority and superseded presentation decisions

The following boundaries remain authoritative:

- real GSC facts only; no mock row may enter a production result;
- unavailable is not zero;
- no blanket reduction of the 100-impression action floor;
- 50–99-impression rows are observation-only and cannot trigger a handoff;
- query/page actions remain exact matches to selected query/page changes;
- the public tool remains facts-only, quota-bound, non-canonical, and
  non-persistent.

This design supersedes only these earlier presentation decisions:

1. `2026-08-24-gsc-daily-briefing-signal-yield-design.md` section 7 placed a
   property fallback inside the query/page table. The property fallback now
   renders as a separate site-wide trend card.
2. `2026-08-24-gsc-daily-briefing-artifact-sections-design.md` treated the
   query/page table as strict changes only. The table now contains strict
   changes first and may fill unused rows with clearly labelled observations.
3. Customer copy no longer calls an impression-only eligibility threshold an
   “action sample floor” or calls a site-wide observed trend a “fallback”.

Property fallback calculation, existing change kinds, action destinations,
quota, GSC reads, and private handoff contracts remain unchanged.

## 3. Goals and non-goals

### Goals

1. Give a practitioner concrete query/page facts to inspect on a normal day,
   even when strict actions are sparse.
2. Preserve a visible, unambiguous confidence boundary between “act” and
   “observe”.
3. Keep at most three query/page rows, ordered deterministically.
4. Render the property-wide trend separately from query/page evidence.
5. Preserve honest partial, unavailable, attribution, and privacy semantics.
6. Reproduce the Artifact's useful density and work-list hierarchy without
   reproducing its mock values or padding action counts.

### Non-goals

- No adaptive or property-relative action threshold in this release.
- No action, CTA, or handoff for an observation row.
- No causal explanation for a query or property movement.
- No LLM ranking, recommendation, or generated copy.
- No scheduled monitoring, persistence, database, Worker, authenticated App,
  provider, OAuth, or additional GSC request.
- No guarantee that every low-volume property has three watchlist rows.

## 4. Additive result contract

`DailyBriefingResult` adds one required, additive field while keeping
`daily_search_briefing.v1` and all existing fields compatible:

```ts
type DailyBriefingQueryWatchlist = {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly items: readonly DailyBriefingQueryObservation[];
};

type DailyBriefingQueryObservation = {
  readonly kind: "evaluation_eligible" | "sample_building";
  readonly query: string;
  readonly page: string | null;
  readonly pageEvidence: "observed" | "unavailable";
  readonly current: GscQueryRow;
  readonly previous: GscQueryRow | null;
};
```

The field is additive JSON on a Marketing-owned route; no persisted or external
schema consumes it. Existing consumers ignore unknown fields, while the
Marketing result component is deployed at the same immutable commit as the
producer.

### 4.1 Collection evidence

- `observed`: current and previous query reads and query/page reads are complete,
  internally aggregation-consistent, and comparable across windows. Items may
  be emitted, including an honestly empty array.
- `partial`: the read exposes only a prefix. `items` is empty because a prefix
  must not be ranked as a property-wide watchlist.
- `unavailable`: required reads are missing, invalid, or aggregation-incompatible.
  `items` is empty and the UI must not render that as measured zero.

The watchlist uses the existing signal-funnel evidence state rather than
creating a second completeness interpretation.

## 5. Observation eligibility and ordering

Observations are derived only after the existing strict changes have been
selected.

### 5.1 Kinds

`evaluation_eligible` means:

- the current query row has at least 100 impressions; and
- the query was not selected as an existing strict change.

It communicates “the sample was large enough to evaluate, but this run did not
select an action signal.” It does not claim that every independent signal path
was evaluated when, for example, brand terms were unconfirmed.

`sample_building` means:

- the current query row has 50–99 impressions; and
- the query was not selected as an existing strict change.

It communicates “continue observing; the sample cannot trigger an action.”

Rows below 50 impressions remain outside the primary work list. They stay
available in Search Console and in the aggregate observed-row count, but are
not promoted into this product surface.

### 5.2 Stable selection

The query/page table retains a maximum of three rows in total:

```text
selected strict query/page changes + watchlist observations <= 3
```

After excluding queries already selected as strict changes, observations sort
by this fixed order:

1. `evaluation_eligible` before `sample_building`;
2. absolute current-versus-previous click delta, descending; a missing previous
   row contributes no delta and sorts after observed deltas within its tier;
3. current impressions, descending;
4. query, ascending, as the deterministic tie-breaker.

The watchlist fills only the unused portion of the three-row query/page limit.
It never changes strict-change ordering or action ordering.

## 6. Page attribution

An observation may name a page only when the page evidence is strong enough for
its observation tier.

- Query-to-page visible-impression coverage must be at least 80%.
- For `evaluation_eligible`, the selected page row must have at least 100
  impressions.
- For `sample_building`, the selected page row must have at least 50
  impressions.
- Among eligible page rows for the query, select the row with the most current
  impressions; break ties by page ascending.

When these rules do not produce a page:

- keep the real query;
- set `page` to `null` and `pageEvidence` to `unavailable`;
- render “主要页面证据不足” / “Primary page evidence unavailable”;
- do not synthesize, guess, or reuse a stale page.

This lower page floor applies only to an explicitly non-actionable
`sample_building` observation. Existing strict change attribution remains at
its current action floor.

## 7. Result information architecture

After a successful run, the decision path becomes:

1. run facts;
2. four KPI cards;
3. compact evidence-yield summary;
4. optional **site-wide trend** card;
5. **queries and pages to review today** table;
6. **today's recommended actions**;
7. manual/security self-checks;
8. detailed evidence, limitations, and methodology.

### 7.1 Evidence-yield summary

The compact strip uses parallel, not falsely additive, language. For example:

```text
540 visible queries: 2 reached the evaluation sample floor; 0 strict
query/page changes were selected; 3 observations are shown; 1 site-wide trend
is shown.
```

Chinese customer copy uses “可评估样本门槛”, “严格变化”, “观察项”, and “站点整体
趋势”. It does not expose the internal term `fallback`.

The second line continues to explain the 50–99 observation tier.

### 7.2 Site-wide trend

When `propertyFallback` is present, render a separate bordered card before the
query/page table:

- site-wide trend kind and evidence state;
- previous seven days to current seven days for clicks, impressions, CTR, and
  exposure-weighted position;
- the current no-attribution interpretation;
- a visible link to the existing property-scope action in the ranked action
  list.

The card never appears under a Query/Page column and never invents a query or
page. Its action is not duplicated in the later action list; the primary action
list remains the one canonical location for CTAs. The trend card may reference
the ranked action by label but does not contain a second button.

### 7.3 Query/page table

The section title becomes “今天需要看的查询词与页面” / “Queries and pages to
review today”. It preserves the Artifact's dense five-column layout:

| Column | Content |
| --- | --- |
| Status | strict change kind, “观察”, or “样本积累中” |
| Query / Page | real query and attributed page, or an explicit page-unavailable label |
| Clicks | previous to current; missing previous is “not observed”, never zero |
| Position | previous to current; unavailable remains unavailable |
| Interpretation | strict kind copy or bounded observation copy |

Strict changes appear first. Observation rows fill unused slots. Observation
copy is fixed and evidence-bounded:

- `evaluation_eligible`: “样本达到评估门槛，但本次没有形成严格动作信号；继续观察。”
- `sample_building`: “当前为 50–99 次曝光，仅用于积累样本；不会触发动作。”

No observation row gets an up/down/new badge, causal language, action rank, CTA,
or destination.

### 7.4 Actions

The existing “今日建议动作” ranked list remains strict:

- selected query/page actions remain exact matches to strict changes;
- a property action remains backed by the separate site-wide trend;
- observation rows never enter `matchingActions`, handoff storage, action count,
  or destination tools;
- the list may contain fewer than three items.

The interface explicitly says that action counts are evidence-driven and are
not padded.

## 8. Responsive, accessibility, and visual behavior

- Desktop keeps one aligned, bordered Artifact-style table.
- At 390px, each logical row becomes one stacked record with visible field
  labels and no horizontal page overflow.
- The table retains `table`, `row`, `columnheader`, and `cell` semantics.
- Observation status is conveyed in text, not color alone.
- Query and page values wrap without entering links or URL state.
- Dark and light themes use existing GenGrowth tokens.
- The header receives Artifact-like visual weight; it must not collapse into a
  low-contrast one-pixel strip.
- Empty, partial, and unavailable watchlists remain complete explanatory panels,
  not skeletons or missing sections.

## 9. Privacy and persistence

- No new GSC request is made; the watchlist reuses the current bounded reads.
- No property, query, page, or observation enters a URL.
- No observation is written to local/session storage or a canonical product
  table.
- Existing action handoffs keep their exact-key, TTL, consume-once, destination,
  and fail-closed validation.
- The public tool remains non-canonical and creates no App project, report, or
  analysis run.

## 10. Testing acceptance

### Core pure tests

- exact 49/50/99/100 impression boundaries;
- strict changes excluded from observations;
- strict changes plus observations never exceed three query/page rows;
- stable ordering by tier, absolute click delta, impressions, and query;
- missing previous row uses null/not-observed semantics;
- page coverage boundary at 0.799 and 0.8;
- 49/50 and 99/100 page-row floors by observation tier;
- partial and unavailable reads emit no ranked items and no fake zero;
- aggregation mismatch remains unavailable;
- brand terms unconfirmed do not block non-CTR observations and do not pretend
  the CTR path was evaluated;
- existing changes, actions, property fallback, funnel counts, thresholds, and
  sorting remain unchanged.

### Marketing UI tests

- property trend is outside the query/page table;
- strict rows precede observation rows;
- status, current/previous metrics, page-unavailable state, and interpretations
  are correct;
- observations render no CTA and write no handoff;
- action count remains strict and unpadded;
- observed-empty, partial, and unavailable watchlist states differ;
- EN/ZH keys and placeholders match;
- keyboard, table semantics, dark/light tokens, and 390px no-overflow remain.

### Release gates

- focused public-tools and Marketing suites;
- `@sf/public-tools` and `@sf/marketing` typechecks;
- changed-file ESLint and `git diff --check`;
- Marketing production build and secret/redaction scan;
- applicable repository authority, docs, contract, and deploy checks;
- independent correctness/privacy and frontend review;
- immutable Marketing deployment SHA and alias verification;
- Product production alias must remain on its pre-release identity unless a
  separate Product promotion is explicitly authorized;
- after action-time authorization, run the four named properties once and
  verify that observations, site-wide trends, and strict action counts match the
  production envelope without clicking downstream CTAs.

## 11. Scope boundary

Expected implementation scope:

- `packages/public-tools/src/daily-briefing/*` for the pure additive watchlist;
- `apps/marketing/src/components/tools/daily-briefing-results*` for rendering;
- Daily Briefing EN/ZH messages and their parity test;
- this design and its implementation plan.

No change is expected in `apps/web`, Worker, database, migrations, OAuth,
Search Analytics transport, source connection behavior, quota, or downstream
tool execution.
