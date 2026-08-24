# GSC Daily Briefing Signal Yield Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the existing high-confidence query/page signals while adding one evidence-bounded property fallback and a truthful signal funnel so materially moving properties no longer collapse into unexplained empty results.

**Architecture:** Add a backward-compatible `propertyFallback` and `signalFunnel` to the pure `@sf/public-tools` result without widening the existing query/page change arrays. Extend the tab-scoped Marketing handoff with an exact scope discriminator, then render the additive property result through the existing Artifact-aligned table and ranked action list. Keep all Search Analytics reads, existing query thresholds, auth, quota, persistence, and Product boundaries unchanged.

**Tech Stack:** TypeScript, `@sf/public-tools`, Next.js 16, React 19, next-intl, Vitest/jsdom, existing Marketing sessionStorage handoff, Vercel Git deployment.

---

### Task 1: Add the pure property-level fallback

**Files:**
- Modify: `packages/public-tools/src/daily-briefing/types.ts`
- Modify: `packages/public-tools/src/daily-briefing/report.ts`
- Test: `packages/public-tools/src/daily-briefing/report.test.ts`

**Step 1: Write failing property-fallback tests**

Add an Astrology-shaped regression where both weekly windows exceed 1,000
impressions, clicks fall `70 -> 35`, impressions fall `7,000 -> 4,900`, position
worsens `10 -> 12`, and all query rows stay below 100 impressions:

```ts
it("falls back to an observed property click decline when query signals are empty", () => {
  const result = report(astrologyShapedInput()).result;

  expect(result.changes).toEqual([]);
  expect(result.actions).toEqual([]);
  expect(result.propertyFallback).toMatchObject({
    change: {
      kind: "sitewide_click_decline",
      query: null,
      page: null,
      clickChange: -35,
      clickChangeRatio: -0.5,
      impressionChange: -2_100,
      impressionChangeRatio: -0.3,
      positionDelta: 2,
    },
    action: {
      kind: "sitewide_click_decline",
      destination: "traffic-drop-diagnosis",
    },
  });
});
```

Add separate tests for:

- `sitewide_visibility_decline` after click decline does not qualify;
- `sitewide_visibility_gain` from click gain;
- `sitewide_visibility_gain` from impression gain plus position improvement;
- exact boundary values (`3`, `15%`, `100`, `1.0`);
- missing click denominator;
- either weekly window below 1,000 impressions;
- unavailable weekly comparison;
- stable property returns `null`;
- an existing query/page change suppresses fallback.

**Step 2: Run the core test and verify RED**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/daily-briefing/report.test.ts
```

Expected: FAIL because `propertyFallback` and property kinds do not exist.

**Step 3: Add the additive types and constants**

Add:

```ts
export type DailyBriefingPropertyChangeKind =
  | "sitewide_click_decline"
  | "sitewide_visibility_decline"
  | "sitewide_visibility_gain";

export interface DailyBriefingPropertyChange {
  readonly kind: DailyBriefingPropertyChangeKind;
  readonly evidence: "observed";
  readonly query: null;
  readonly page: null;
  readonly current: DailyBriefingKpis;
  readonly previous: DailyBriefingKpis;
  readonly clickChange: number;
  readonly clickChangeRatio: number | null;
  readonly impressionChange: number;
  readonly impressionChangeRatio: number | null;
  readonly positionDelta: number | null;
}

export interface DailyBriefingPropertyFallback {
  readonly change: DailyBriefingPropertyChange;
  readonly action: {
    readonly kind: DailyBriefingPropertyChangeKind;
    readonly destination: "traffic-drop-diagnosis" | "seo-quick-wins";
  };
}
```

`DailyBriefingResult` adds:

```ts
readonly propertyFallback: DailyBriefingPropertyFallback | null;
```

Export and freeze:

```ts
export const BRIEFING_PROPERTY_MIN_WEEKLY_IMPRESSIONS = 1_000;
export const BRIEFING_PROPERTY_MIN_ABSOLUTE_IMPRESSION_CHANGE = 100;
export const BRIEFING_PROPERTY_POSITION_DELTA = 1;
```

Reuse `BRIEFING_MATERIAL_CHANGE_RATIO` and
`BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE` rather than duplicating 15% and 3.

**Step 4: Implement one pure fallback selector**

Add a private `propertyFallbackFor(weekly)` with the approved priority:

```ts
if (!weeklyObservedOrBothWindowsBelowFloor) return null;
if (clickDelta <= -3 && clickRatio <= -0.15) return clickDecline;
if (
  impressionDelta <= -100 &&
  impressionRatio <= -0.15 &&
  positionDelta !== null &&
  positionDelta >= 1
) return visibilityDecline;
if (clickGainClears || impressionAndPositionGainClears) return visibilityGain;
return null;
```

Call it only after `selectChanges` and only when `changes.length === 0`.

Do not modify the existing query/page candidate functions, thresholds, arrays,
or action ordering.

**Step 5: Run RED tests to GREEN**

Run the focused core test, then:

```bash
pnpm --filter @sf/public-tools typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/public-tools/src/daily-briefing/{types,report,report.test}.ts
git commit -m "fix(public-tools): add Daily Briefing property fallback"
```

### Task 2: Add an evidence-aware signal funnel

**Files:**
- Modify: `packages/public-tools/src/daily-briefing/types.ts`
- Modify: `packages/public-tools/src/daily-briefing/report.ts`
- Test: `packages/public-tools/src/daily-briefing/report.test.ts`

**Step 1: Write failing funnel tests**

Cover an observed complete read containing rows below 50, between 50–99, and at
or above 100. Assert exact independent lane counts:

```ts
expect(result.signalFunnel).toEqual({
  evidence: "observed",
  observedQueryRows: 6,
  observationCandidates: 2,
  actionEligibleQueries: 3,
  ctrBaselineRows: 1,
  clickOpportunityCandidates: 1,
  stableDeclineCandidates: 0,
  firstObservedCandidates: 0,
  pageAttributionWithheld: 0,
  selectedQueryChanges: 1,
  propertyFallbackShown: false,
});
```

Also test:

- 50 and 99 are observation-only; 100 is action-eligible;
- unconfirmed brand terms make CTR baseline/opportunity counts `null`, not 0;
- partial evidence exposes only prefix `observedQueryRows`, with downstream
  counts `null`;
- unavailable evidence uses null counts;
- property fallback sets `propertyFallbackShown=true` while
  `selectedQueryChanges=0`;
- page attribution withheld is counted rather than represented only as a
  boolean.

**Step 2: Run the test and verify RED**

Expected: FAIL because `signalFunnel` does not exist.

**Step 3: Add the funnel type**

Use the exact design contract. Keep every unavailable count nullable.

**Step 4: Instrument the existing candidate branches**

Extend the internal candidate result with counts already available during one
pass:

```ts
{
  observedQueryRows,
  observationCandidates,
  actionEligibleQueries,
  ctrBaselineRows,
  clickOpportunityCandidates,
  stableDeclineCandidates,
  firstObservedCandidates,
  pageAttributionWithheld,
}
```

Do not build a second candidate loop. Do not claim the three independent lanes
sum to the observed total.

**Step 5: Implement partial/unavailable states**

Create one helper that derives funnel evidence from `queryEvidenceState` and
comparability. A missing or mixed basis must remain unavailable, never a zero
funnel.

**Step 6: Run GREEN and commit**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/daily-briefing/report.test.ts
pnpm --filter @sf/public-tools typecheck
git add packages/public-tools/src/daily-briefing/{types,report,report.test}.ts
git commit -m "feat(public-tools): explain Daily Briefing signal rejection"
```

### Task 3: Make the private handoff scope-aware

**Files:**
- Modify: `apps/marketing/src/lib/tools/tool-handoff.ts`
- Modify: `apps/marketing/src/lib/tools/tool-handoff.test.ts`
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.tsx`
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`
- Modify: `apps/marketing/src/components/tools/quick-wins-tool.tsx`
- Modify: `apps/marketing/src/components/tools/quick-wins-tool.test.tsx`
- Modify: `apps/marketing/src/components/tools/traffic-drop-tool.tsx`
- Modify: `apps/marketing/src/components/tools/traffic-drop-tool.test.tsx`
- Modify: `apps/marketing/src/components/tools/on-page-checker.tsx`
- Modify: `apps/marketing/src/components/tools/on-page-checker.test.tsx`

**Step 1: Write failing handoff validation tests**

Add exact scope cases:

```ts
expect(writeToolHandoff(storage, now, {
  source: "daily-search-briefing",
  destination: "traffic-drop-diagnosis",
  scope: "property",
  property,
  query: null,
  page: null,
  evidenceId,
})).toBe(true);
```

Reject:

- property scope with non-null query or page;
- property scope to On-Page;
- query/page scope with null/blank query or page;
- missing/unknown scope;
- extra keys.

Preserve TTL, consume-once, future-createdAt, destination mismatch, malformed
JSON, storage throw, and URL-privacy tests.

**Step 2: Run handoff tests and verify RED**

Expected: FAIL because `scope` is not part of the exact contract.

**Step 3: Implement a discriminated handoff payload**

Keep one exact key set including `scope`. Validate the two legal shapes with
positive assertions. Existing Daily query/page action writes add
`scope: "query_page"`.

**Step 4: Write destination-consumer RED tests**

- Quick Wins imports a property-scope handoff, selects the property, shows the
  handoff notice, and does not fetch.
- Traffic Drop does the same and resets property-owned answers/brand
  confirmation.
- On-Page refuses property scope and keeps its fields empty.
- Existing query/page imports remain unchanged.

**Step 5: Implement the minimal consumers**

Quick Wins and Traffic Drop already use only `handoff.property`; accept both
scopes. On-Page requires `scope === "query_page"` before reading query/page.

**Step 6: Run GREEN and commit**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/tools/tool-handoff.test.ts \
  apps/marketing/src/components/tools/quick-wins-tool.test.tsx \
  apps/marketing/src/components/tools/traffic-drop-tool.test.tsx \
  apps/marketing/src/components/tools/on-page-checker.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx
pnpm --filter @sf/marketing typecheck
git add <the ten assigned files>
git commit -m "fix(marketing): support property-scoped tool handoff"
```

### Task 4: Render the fallback and signal funnel

**Files:**
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.tsx`
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/i18n/daily-briefing-messages.test.ts`

**Step 1: Write failing property-row tests**

Render an envelope with no query changes and an Astrology-shaped
`propertyFallback`. Require:

- the changes table renders one property row;
- Query/Page cell says `Entire Search Console property` / `整个 Search Console
  站点`;
- no synthetic query or page appears;
- clicks and position show previous week -> current week;
- the interpretation names observed movement and explicitly denies specific
  attribution;
- the ranked property action has one property-scope internal CTA and weekly KPI
  evidence;
- existing query change/action rendering remains unchanged.

**Step 2: Write failing funnel UI tests**

Require the compact strip to render:

```text
540 visible queries -> 2 reached the action sample floor ->
0 query/page signals; 1 property-level fallback shown.
```

Require detailed independent lanes, observation-only 50–99 wording, and
partial/unavailable null handling without `0` substitution.

**Step 3: Run UI tests and verify RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts
```

**Step 4: Add localized property/funnel messages**

Add EN/ZH keys for:

- three property change kinds;
- property evidence label;
- entire-property cell;
- three property action titles/bodies/destinations;
- compact funnel summary;
- each independent lane;
- observation-only explanation;
- stable-property empty state.

Add every production key to `REQUIRED_LEAF_PATHS` and verify placeholders match
between locales.

**Step 5: Render the additive result**

Derive presentation lists without mutating the envelope:

```ts
const displayedQueryChanges = result.changes.slice(0, 3);
const propertyFallback =
  displayedQueryChanges.length === 0 ? result.propertyFallback : null;
```

Render property fallback through dedicated branches in the existing table and
action list. Its CTA writes `scope: "property"`, `query:null`, and `page:null`.

Do not pass property fallback through `matchingActions`, which remains the exact
query/page matcher.

**Step 6: Run GREEN and commit**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-tool.test.tsx \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts
pnpm --filter @sf/marketing typecheck
git add <the five assigned files>
git commit -m "fix(marketing): surface Daily Briefing property signals"
```

### Task 5: Verify, review, and release

**Files:**
- Review all files changed in Tasks 1–4
- Modify only when a valid review finding has a new failing regression

**Step 1: Run focused core and UI regressions**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/daily-briefing/report.test.ts \
  packages/public-tools/src/daily-briefing/run.test.ts \
  apps/marketing/src/lib/tools/tool-handoff.test.ts \
  apps/marketing/src/components/tools/daily-briefing-tool.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/quick-wins-tool.test.tsx \
  apps/marketing/src/components/tools/traffic-drop-tool.test.tsx \
  apps/marketing/src/components/tools/on-page-checker.test.tsx \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts
```

**Step 2: Run static/build gates**

```bash
pnpm --filter @sf/public-tools typecheck
pnpm --filter @sf/marketing typecheck
git diff --name-only -z origin/main...HEAD -- '*.ts' '*.tsx' | \
  xargs -0 pnpm exec eslint --max-warnings=0
pnpm --filter @sf/marketing build
pnpm secrets:scan
git diff --check origin/main...HEAD
```

Run full `pnpm test` once and separate unchanged baseline failures by blob SHA.

**Step 3: Run two-stage and final review**

Use `superpowers:requesting-code-review` after each task and for the whole diff.
Fix every valid finding with RED first.

Review specifically:

- property fallback precedence and threshold boundaries;
- unavailable/null versus zero funnel semantics;
- exact query/page backward compatibility;
- property-scope handoff privacy;
- On-Page rejection of property scope;
- no causal copy;
- EN/ZH parity;
- no backend, GSC reader, Product, Worker, or DB drift.

**Step 4: Push, PR, merge, and deploy**

1. Push `fix/daily-briefing-signal-yield`.
2. Create a PR with the production-empty root cause and test evidence.
3. Wait for both Vercel previews.
4. Merge the reviewed SHA.
5. Wait for exact-SHA Marketing Production `READY` and `gengrowth.ai` alias.
6. Independently confirm `app.gengrowth.ai` retains its pre-release production
   deployment; restore it if a shared push promotes Product.
7. Verify EN/ZH, API, sitemap, build/runtime errors, browser console, dark/light,
   and 390px no overflow.

**Step 5: Real-property acceptance**

After the hourly shared GSC quota resets and the user gives action-time approval
for the four named properties, run each once. Record:

- KPI movement;
- query/page changes;
- property fallback;
- signal funnel;
- limitations;
- resulting action.

A report may remain empty only when both query/page and property thresholds stay
inside noise, and its funnel must make that reason inspectable.
