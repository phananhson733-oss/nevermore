# GSC Daily Briefing Signal Yield Design

**Status:** Approved on 2026-08-24

**Decision:** Preserve the three existing high-confidence query/query-page
signals, add one bounded property-level fallback only when those signals are
empty, and expose a truthful signal-rejection funnel. Rows with 50–99
impressions are observation candidates only and never trigger an automated
handoff.

## 1. Problem and production evidence

All four connected properties repeatedly rendered zero changes and zero
actions. This is not an OAuth, Search Analytics transport, aggregation, or UI
rendering failure.

The confirmed AstrologyWiki production run proved that both query windows and
both query/page windows were complete and comparable. It evaluated 540 visible
query rows, reported no query-evidence limitation, and still produced no
candidate. A minimal offline reproduction also produced a 50% weekly click
decline, 30% impression decline, and two-position loss while returning empty
`changes` and `actions` because its only query had 50 impressions.

The root cause is the v1 projection contract:

- it recognizes only `click_opportunity`, `stable_position_click_decline`, and
  `first_observed`;
- every action is mapped from one selected change;
- the rule set has no property-level result when site-wide KPIs move materially
  but no single query/page clears every evidence gate;
- `filteredObservedRows` says only that rows did not enter those three classes,
  but the UI does not explain which gate rejected them.

The supplied Artifact remains the interaction and presentation authority, but
its rows are illustrative examples intentionally constructed to clear the
gates. Production must never pad a report with those values.

## 2. Goals and non-goals

### Goals

1. Keep the current query/query-page findings unchanged and first in priority.
2. Prevent a materially moving property from ending in an unexplained empty
   report merely because attribution is too sparse.
3. Emit at most one honest property-level fallback, never a fabricated query or
   page.
4. Explain the rejection path with countable evidence.
5. Preserve the maximum-three result/action surface and private same-tab
   handoff.

### Non-goals

- No causal diagnosis from aggregate KPIs.
- No claim that ranking, demand, content, an algorithm update, or a technical
  issue is the unique cause.
- No blanket reduction of the existing 100-impression action floor.
- No 50–99-impression query may trigger an automated action.
- No persistence, scheduled monitoring, new provider, database, Worker, or
  authenticated Product dependency.

## 3. Additive property fallback contract

The existing `DailyBriefingChange` and `DailyBriefingAction` query/page
contracts remain byte-for-byte compatible. Property fallback is additive so
existing consumers do not need to accept nullable query/page values.

```ts
type DailyBriefingPropertyFallback = {
  readonly change: DailyBriefingPropertyChange;
  readonly action: DailyBriefingPropertyAction;
};

type DailyBriefingPropertyAction = {
  readonly kind: PropertyChangeKind;
  readonly destination: "traffic-drop-diagnosis" | "seo-quick-wins";
};
```

`DailyBriefingResult` adds:

```ts
readonly propertyFallback: DailyBriefingPropertyFallback | null;
```

It is non-null only when the existing selected query/page `changes` array is
empty. The UI may present it in the same Artifact table and ranked action list,
but it never inserts a fake row into the query/page machine contract.

### Property change

```ts
type DailyBriefingPropertyChange = {
  readonly kind:
    | "sitewide_click_decline"
    | "sitewide_visibility_decline"
    | "sitewide_visibility_gain";
  readonly query: null;
  readonly page: null;
  readonly current: DailyBriefingChangeMetrics;
  readonly previous: DailyBriefingChangeMetrics;
  readonly clickChange: number;
  readonly clickChangeRatio: number | null;
  readonly impressionChange: number;
  readonly impressionChangeRatio: number | null;
  readonly positionDelta: number | null;
};
```

The shared metrics type contains clicks, impressions, CTR, and nullable
exposure-weighted position. It does not contain a synthetic query identifier.

## 4. Property fallback rules

Property fallback is considered only when:

- no query/query-page change was selected;
- the current and previous complete seven-day KPI windows are both observed;
- both windows contain at least 1,000 impressions.

At most one fallback is emitted in this fixed priority order.

### 4.1 Site-wide click decline

Emit `sitewide_click_decline` when:

- click delta is at most `-3`; and
- click ratio is at most `-15%`.

The interpretation reports the observed weekly click, impression, CTR, and
position deltas, then explicitly says query/page evidence did not support a
more specific attribution.

Destination: Traffic Drop Diagnosis.

### 4.2 Site-wide visibility decline

Consider only when the click-decline rule did not fire. Emit
`sitewide_visibility_decline` when:

- impression ratio is at most `-15%`;
- absolute impression loss is at least 100; and
- exposure-weighted position worsened by at least `+1.0`.

Destination: Traffic Drop Diagnosis.

### 4.3 Site-wide visibility gain

Consider only when neither decline rule fired. Emit `sitewide_visibility_gain`
when either:

- clicks increased by at least 3 and at least 15%; or
- impressions increased by at least 15%, absolute impressions increased by at
  least 100, and position improved by at least `-1.0`.

Destination: GSC Opportunity Finder.

These rules describe direction and magnitude only. They do not name a page,
query, or cause.

## 5. Action and handoff contract

Existing query/page actions remain unchanged. The additive property fallback
action contains only kind and destination; it does not claim a query or page.

The tab-scoped handoff becomes scope-aware while retaining exact-key,
short-TTL, and fail-closed validation:

- `query_page` requires non-empty query and page;
- `property` requires both query and page to be `null`;
- property scope is valid only for Traffic Drop Diagnosis and GSC Opportunity
  Finder;
- On-Page SEO Check accepts only query/page scope;
- destination tools continue to consume the property and never auto-run.

No property, query, or page enters a URL.

## 6. Signal funnel

The result adds an evidence-aware `signalFunnel`:

```ts
type DailyBriefingSignalFunnel = {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly observedQueryRows: number | null;
  readonly observationCandidates: number | null; // 50–99 impressions
  readonly actionEligibleQueries: number | null; // >=100 impressions
  readonly ctrBaselineRows: number | null;
  readonly clickOpportunityCandidates: number | null;
  readonly stableDeclineCandidates: number | null;
  readonly firstObservedCandidates: number | null;
  readonly pageAttributionWithheld: number | null;
  readonly selectedQueryChanges: number;
  readonly propertyFallbackShown: boolean;
};
```

Rules:

- Counts are complete only when both query and query/page windows are observed
  and comparable.
- A partial read may expose the observed-row count only as a prefix; all
  downstream funnel counts remain `null`.
- An unavailable read uses `null`, never zero.
- Branch counts do not pretend to add to one linear total; the UI labels CTR,
  decline, and first-observed as independent candidate lanes.

`filteredObservedRows` remains for v1 compatibility but is no longer the only
explanation shown to visitors.

## 7. Result UI

The existing Artifact-aligned table and ranked action list remain.

### Property fallback row

- Change cell: localized property-level kind and `PROPERTY` evidence chip.
- Query/Page cell: localized “Entire Search Console property”; no fake value.
- Clicks and Position: previous seven days → current seven days.
- Interpretation: observed KPI movement plus the no-attribution boundary.

### Property action row

- Numbered with the existing accessible rank.
- Evidence area shows property and weekly KPI comparison, not query/page.
- CTA writes a property-scope handoff and opens Traffic Drop or Opportunity
  Finder.

### Funnel disclosure

The compact noise strip reports the useful top line, for example:

```text
540 visible queries → 2 reached the action sample floor →
0 query/page signals; 1 property-level fallback shown.
```

The detailed evidence section shows the independent lane counts and explicitly
labels 50–99-impression rows as observation-only.

## 8. Empty states

A truly stable property may still return no change. In that case:

- no fake fallback is emitted;
- the empty changes panel says site-wide weekly KPIs also stayed within the
  fallback thresholds;
- the funnel shows why query/page signals were absent;
- actions remain empty.

The product is required to explain an empty report, not guarantee a non-empty
one.

## 9. Testing and release acceptance

### Core tests

- Astrology-shaped weekly decline emits one property fallback and Traffic Drop
  action despite all query rows staying below 100 impressions.
- Existing query/page changes suppress the property fallback.
- Click decline, visibility decline, visibility gain, boundary values, missing
  denominators, incomplete weekly evidence, and sub-1,000-impression windows.
- Funnel observed/partial/unavailable semantics and 50–99 observation counts.
- Maximum-three and deterministic ordering remain unchanged.

### Handoff tests

- Exact validation for both scopes.
- Property scope rejects non-null query/page and On-Page destination.
- Existing query/page privacy, TTL, consume-once, and storage-failure behavior
  remains.
- Traffic Drop and Quick Wins import the property but never auto-run.

### UI tests

- Property row never renders synthetic query/page text.
- Property action shows weekly KPI evidence and one internal CTA.
- Funnel never renders null as zero.
- EN/ZH required keys and placeholders stay aligned.
- Existing query/page table, ranked actions, preview/reset, and mobile semantics
  remain green.

### Production

- Release remains Marketing/public-tools only; no `apps/web`, Worker, DB, or
  migration deployment.
- Verify exact Marketing deployment SHA and independently retain Product
  production identity.
- After action-time approval, rerun all four properties after the shared hourly
  quota resets. A property may remain empty only when both the query/page and
  property fallback thresholds are not met, and its funnel must explain why.
