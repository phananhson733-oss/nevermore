# GSC Daily Search Briefing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a real, stateless GSC Daily Search Briefing in the Marketing Tools hub that turns complete Search Console history into at most three evidence-backed changes and handoffs.

**Architecture:** Keep Google grant resolution, quota, request budgets and transport binding in `apps/marketing`. Add a pure, schema-versioned `packages/public-tools/src/daily-briefing` projection that owns windows, cadence, evidence floors, change classification and action ordering. Render the approved Artifact shape with current GenGrowth tokens, and carry private query/page handoffs through one-time tab-scoped storage rather than URLs.

**Tech Stack:** TypeScript strict ESM, Next.js 16.2 App Router, React 19, next-intl, Tailwind CSS 4, Vitest 4, existing `@sf/public-tools` and `@sf/sources` GSC seams.

---

> Authorization note: the repository normally expects frequent commits in this
> workflow, but the current user request does not authorize commit, push, PR or
> deploy. Every commit step below is replaced by a local diff checkpoint.

### Task 1: Freeze the Daily Briefing machine contract and bounded reads

**Files:**
- Create: `packages/public-tools/src/daily-briefing/types.ts`
- Create: `packages/public-tools/src/daily-briefing/report.test.ts`
- Create: `packages/public-tools/src/daily-briefing/report.ts`
- Create: `packages/public-tools/src/daily-briefing/run.test.ts`
- Create: `packages/public-tools/src/daily-briefing/run.ts`
- Create: `packages/public-tools/src/daily-briefing/index.ts`
- Modify: `packages/public-tools/src/gsc-analytics/page-reader.test.ts`
- Modify: `packages/public-tools/src/gsc-analytics/page-reader.ts`
- Modify: `packages/public-tools/src/index.ts`

**Step 1: Write failing page-read budget tests**

Add tests proving `readQueryPageRows(client, window, budget, 1)` performs one
page, reports `truncated: true` when that page is full, and never requests a
second page. Also prove the default still uses the existing shared cap.

**Step 2: Run the page-reader test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit packages/public-tools/src/gsc-analytics/page-reader.test.ts
```

Expected: FAIL because `readQueryPageRows` does not accept the fourth argument.

**Step 3: Add the minimal optional `maxPages` parameter**

Clamp it exactly like `readQueryRows`: positive integer, never above
`GSC_MAX_PAGES`, and mark a full final allowed page as truncated. Do not change
existing callers' default behavior.

**Step 4: Verify GREEN for the shared reader**

Run the same focused test. Expected: PASS.

**Step 5: Write the failing Daily Briefing contract tests**

Define a wished-for API around these exported types and constants:

```ts
export const DAILY_BRIEFING_SCHEMA_VERSION = "daily_search_briefing.v1";
export const BRIEFING_WINDOW_DAYS = 7;
export const DAILY_CADENCE_MIN_IMPRESSIONS = 1_000;
export const BRIEFING_MIN_ROW_IMPRESSIONS = 100;
export const BRIEFING_MATERIAL_CHANGE_RATIO = 0.15;
export const BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE = 3;
export const BRIEFING_STABLE_POSITION_DELTA = 0.5;
export const DAILY_BRIEFING_ACTION_LIMIT = 3;

export type DailyBriefingCadence = "daily" | "weekly";
export type DailyBriefingEvidenceState =
  | "observed"
  | "not_observed"
  | "partial"
  | "unavailable";
export type DailyBriefingChangeKind =
  | "click_opportunity"
  | "stable_position_click_decline"
  | "first_observed";
```

The envelope must use `createPublicToolResult` with tool
`daily_search_briefing`, scope `property`, mode `public_preview`, persistence
`none`, and carry:

- current and previous day/window boundaries;
- nullable day and seven-day KPI comparisons;
- cadence and its reason;
- zero to three `changes` and matching `actions`;
- `filteredObservedRows` plus whether that count is complete;
- query/property coverage and anonymized shares when comparable;
- machine-readable limitations;
- latest complete date and PT/final-lag metadata.

Tests must cover:

1. PT/DST-safe non-overlapping date windows;
2. daily cadence at 1,000 weekly impressions and weekly below it;
3. missing day becomes unavailable rather than zero;
4. exposure-weighted position aggregation;
5. positive leave-one-out CTR gap produces one Opportunity Finder action;
6. material click loss with stable position produces one Traffic Drop action;
7. absent prior row becomes `first_observed`, never a numeric zero baseline;
8. query/page coverage below 0.8 withholds the page and action;
9. no more than one action per class and three total, with stable ordering;
10. truncated evidence makes the filtered count partial and withholds derived
    actions;
11. aggregation-basis mismatch makes coverage/anonymization unavailable;
12. no candidate is padded into an action.

**Step 6: Run contract tests and verify RED**

Run:

```bash
pnpm exec vitest run --project unit packages/public-tools/src/daily-briefing/report.test.ts
```

Expected: FAIL because the module does not exist.

**Step 7: Implement the minimum pure report projection**

Reuse, do not duplicate:

- `latestFinalWindow`, `shiftDate`;
- `buildSiteCtrCurve`, `buildEvidenceTable`, `splitBrandQueries`;
- `queryPageCoverage`, `MIN_DIMENSION_COVERAGE`;
- `createPublicToolResult`.

Use ordered class selection rather than a weighted score. A missing prior pair
is represented with `previous: null` and state `not_observed`. Nullable ratios
must stay null for zero or absent denominators.

**Step 8: Verify report GREEN**

Run the focused report tests. Expected: PASS.

**Step 9: Write failing run-orchestration tests**

The wished-for entry point is:

```ts
runDailyBriefing({
  client,
  now,
  brandTerms,
  brandTermsConfirmed,
  budget,
}): Promise<DailyBriefingEnvelope>
```

Tests must prove:

- one date read plus current/previous query, query-page and totals reads;
- both row shapes are capped to one page;
- required date read failure rejects;
- any optional query attachment failure returns KPI plus
  `query_evidence_unavailable`;
- optional siblings receive the same abort signal through the injected client
  seam or stop through the shared budget;
- expired budget does not start later pages;
- malformed/missing date keys are omitted, not invented.

**Step 10: Run orchestration tests and verify RED**

Expected: FAIL because `runDailyBriefing` is absent.

**Step 11: Implement minimal orchestration and verify GREEN**

Read the date series first. Execute optional window reads concurrently, catch
them as one attachment, and pass either complete evidence or null into the pure
report. Export the module from both `daily-briefing/index.ts` and the package
root.

**Step 12: Run the complete core slice**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/gsc-analytics/page-reader.test.ts \
  packages/public-tools/src/daily-briefing/report.test.ts \
  packages/public-tools/src/daily-briefing/run.test.ts
pnpm --filter @sf/public-tools typecheck
```

Expected: all PASS.

**Step 13: Local diff checkpoint**

Run `git diff --check` and inspect only the files listed in Task 1. Do not
commit.

### Task 2: Bind the contract to the shared Marketing GSC gate

**Files:**
- Modify: `apps/marketing/src/lib/tools/gsc-gate.test.ts`
- Modify: `apps/marketing/src/lib/tools/gsc-gate.ts`
- Create: `apps/marketing/src/lib/tools/daily-briefing-reader.test.ts`
- Create: `apps/marketing/src/lib/tools/daily-briefing-reader.ts`
- Create: `apps/marketing/src/lib/tools/daily-briefing-handler.test.ts`
- Create: `apps/marketing/src/lib/tools/daily-briefing-handler.ts`
- Create: `apps/marketing/src/app/api/tools/daily-search-briefing/route.ts`

**Step 1: Write the failing remaining-budget gate test**

After an allowed quota result with `hits: 2`, expect:

```ts
expect(result).toMatchObject({ ok: true, remaining: 8, limit: 10 });
```

Existing refusal shapes and all other tool callers must remain compatible.

**Step 2: Verify RED, implement the additive gate fields, verify GREEN**

Run `apps/marketing/src/lib/tools/gsc-gate.test.ts`, add `remaining` and `limit`
only to the allowed branch, and rerun. Do not add a second counter.

**Step 3: Write failing request-scoped reader tests**

`createDailyBriefingReader({ accessToken, now })` must construct the existing
`createSearchAnalyticsClient` with:

- request-scoped access token;
- Node transport from `@sf/sources`;
- 15-second per-call timeout;
- one shared remaining-time function;
- one abort signal cleaned up after the run.

No access token may be captured at module scope or logged.

**Step 4: Verify RED, implement the minimal reader, verify GREEN**

Use dependency injection for `fetchImpl` only where the existing source client
supports it. Keep a 45-second whole-request budget inside a 60-second route.

**Step 5: Write failing handler tests**

Drive the same branches as `quick-wins-handler`:

- strict JSON/content type/body-size validation;
- property required, no unknown fields if the existing parser supports that
  invariant;
- cheap cookie session check before the gate;
- property outside cookie grant -> 404;
- 409/429/503 gate response is forwarded;
- token refresh is inside the gate;
- refreshed grant missing property -> 404;
- revoked -> 401 reconnectable code;
- temporary grant error -> 503;
- report success -> private no-store 200 with remaining count;
- core failure -> stable `gsc_unavailable` 502;
- release runs exactly once on every admitted exit.

Request body:

```ts
{
  property: string,
  brandTerms?: string[],
  brandTermsConfirmed?: boolean
}
```

Apply the existing 10-term/60-character limits. Unconfirmed terms may be sent
as candidates but do not enter the confirmed brand split.

**Step 6: Verify RED, implement the minimal handler, verify GREEN**

Reuse `readPublicToolJson`, `readTrafficDropSession`,
`resolveTrafficDropGrant`, `openGscGate` and `refuseWithoutGrant`. The success
response is `{ data: envelope, meta: { rateLimit: { limit, remaining } } }` with
`Cache-Control: no-store, private`.

**Step 7: Add the thin Node route**

Set `runtime = "nodejs"`, `maxDuration = 60`, bind `extractClientIp` and build
the request-scoped reader only after grant resolution.

**Step 8: Run the backend slice**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/tools/gsc-gate.test.ts \
  apps/marketing/src/lib/tools/daily-briefing-reader.test.ts \
  apps/marketing/src/lib/tools/daily-briefing-handler.test.ts
pnpm --filter @sf/marketing typecheck
```

Expected: all PASS.

**Step 9: Local diff checkpoint**

Run `git diff --check`; verify no secret, property, token or query logging. Do
not commit.

### Task 3: Add the private one-time cross-tool handoff

**Files:**
- Create: `apps/marketing/src/lib/tools/tool-handoff.test.ts`
- Create: `apps/marketing/src/lib/tools/tool-handoff.ts`
- Modify: `apps/marketing/src/components/tools/quick-wins-tool.tsx`
- Modify: `apps/marketing/src/components/tools/quick-wins-tool.test.tsx`
- Modify: `apps/marketing/src/components/tools/traffic-drop-tool.tsx`
- Modify: `apps/marketing/src/components/tools/traffic-drop-results.test.tsx`
- Modify: `apps/marketing/src/components/tools/on-page-checker.tsx`
- Modify: `apps/marketing/src/components/tools/on-page-checker.test.tsx`

**Step 1: Write failing storage-contract tests**

Define a small contract:

```ts
type ToolHandoffDestination =
  | "seo-quick-wins"
  | "traffic-drop-diagnosis"
  | "on-page-seo-check";

writeToolHandoff(storage, now, payload): boolean;
consumeToolHandoff(storage, now, destination): ToolHandoff | null;
```

Tests must cover valid round-trip, delete-on-consume, 10-minute expiry,
destination mismatch, malformed JSON, oversized field rejection, unavailable
storage and no raw payload in a URL.

**Step 2: Verify RED, implement the minimal helper, verify GREEN**

Use one versioned key, strict runtime shape checks and bounded property/query/page
lengths. Catch `sessionStorage` access failures. Do not use localStorage,
cookies, query parameters or network calls.

**Step 3: Write failing destination-consumption tests**

- Quick Wins consumes only a matching handoff and preselects a granted property.
- Traffic Drop does the same and resets property-owned self-check/brand state.
- On-Page consumes URL and target query into its existing controlled fields.
- Every surface displays a compact “from Daily Search Briefing” notice until the
  user changes the imported input.
- A property not in the granted list is ignored.

**Step 4: Verify RED, add minimal client-side effects, verify GREEN**

Read storage only inside `useEffect`, preserving server/client hydration. Do not
auto-run any destination tool; imported evidence is a prefill, not a result.

**Step 5: Run the handoff slice and checkpoint**

Run focused tests plus Marketing typecheck, then `git diff --check`. Do not
commit.

### Task 4: Render the Daily Search Briefing result surface

**Files:**
- Create: `apps/marketing/src/components/tools/daily-search-briefing-tool.test.tsx`
- Create: `apps/marketing/src/components/tools/daily-search-briefing-tool.tsx`
- Create: `apps/marketing/src/components/tools/daily-search-briefing-results.test.tsx`
- Create: `apps/marketing/src/components/tools/daily-search-briefing-results.tsx`

**Step 1: Write failing UI state tests**

Cover:

- no grant -> shared GSC connect panel;
- grant with no property -> honest empty-property state and disconnect;
- property picker, candidate brand terms and explicit confirmation;
- loading resets stale report and announces status;
- success renders actual property, latest-complete date, cadence and remaining
  count;
- four KPI cards render null as unavailable, not zero;
- weekly cadence suppresses day interpretation;
- partial query evidence renders KPI plus limitation;
- zero/one/two/three changes without padding;
- narrow layout uses cards rather than an overflowing table;
- revoked grant includes reconnect path;
- known error-code allow-list never renders raw unknown codes;
- self-checks appear only after success, begin unconfirmed, can be checked for
  current component state, and reset on rerun/property change;
- action click writes one handoff then navigates to the localized destination.

**Step 2: Run tests and verify RED**

Expected: FAIL because the components do not exist.

**Step 3: Implement the minimum state machine and presentation**

Use existing `GscConnectPanel`, `GscDisconnect`, `formatPropertyLabel`,
`trackMarketingEvent`, current Tailwind design tokens and lucide icons. Keep the
Artifact order but remove all mock-review chrome and values.

KPI trend lines may use a small inline SVG built from the returned fourteen-day
series; it must be decorative with a text equivalent, no new chart dependency.

Self-check links use the existing Search Console paths/helpers. A checked box
means “visitor marked checked on this page,” never provider-observed evidence.

**Step 4: Verify GREEN and refactor only after green**

Run both component tests. Split pure formatting helpers only if duplication is
visible; do not create a generic dashboard framework.

**Step 5: Run accessibility-focused assertions**

Verify real headings, labels, button names, `aria-busy`, status/live regions,
keyboard-operable self-checks and action links.

**Step 6: Local diff checkpoint**

Run focused tests, Marketing typecheck and `git diff --check`. Do not commit.

### Task 5: Register the page, localized content, hub and sitemap

**Files:**
- Create: `apps/marketing/src/app/[locale]/tools/daily-search-briefing/page.tsx`
- Modify: `apps/marketing/src/components/tools/connected-tool-content.ts`
- Modify: `apps/marketing/src/components/tools/connected-tool-page.tsx`
- Modify: `apps/marketing/src/app/[locale]/tools/page.tsx`
- Modify: `apps/marketing/src/app/[locale]/tools/tools-hub-contract.test.ts`
- Modify: `apps/marketing/src/config/sitemap-tools.ts`
- Modify: `apps/marketing/src/config/sitemap-tools.test.ts`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/i18n/messages.test.ts`

**Step 1: Write failing registry and route tests**

Expect `daily-search-briefing` to be:

- first in the diagnosis hub;
- exhaustive in `ConnectedTool` and `CONNECTED_TOOLS`;
- present in the GSC connect allow-list;
- present in both locale sitemaps with canonical parity;
- absent from `apps/web` routes and authenticated product authority;
- backed by EN/ZH key parity.

**Step 2: Verify RED**

Run the hub, sitemap and message tests. Expected: FAIL on the missing slug/keys.

**Step 3: Add the localized connected-tool content and page**

The Server Component must:

- set `dynamic = "force-dynamic"` because it renders cookie-backed grant state;
- await `params` and `getMessages()` in Next 16 style;
- read the shared GSC session in parallel with messages;
- generate canonical metadata from the same visible content;
- render SoftwareApplication, HowTo, FAQ and breadcrumb JSON-LD from that
  content;
- pass only the daily-briefing message subtree to the client provider;
- render no mock values.

Copy must distinguish:

- observed versus not observed;
- evidence threshold versus statistical significance;
- daily versus weekly cadence;
- read-only connection versus report persistence;
- GSC API boundaries for manual and security reports.

**Step 4: Verify GREEN**

Run hub, sitemap and i18n tests, then Marketing typecheck.

**Step 5: Local diff checkpoint**

Inspect the complete route/registry/i18n diff. Do not commit.

### Task 6: Integration review and repository gates

**Files:**
- Modify only files already named above if a failing test proves a defect.

**Step 1: Run all focused tests**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/gsc-analytics/page-reader.test.ts \
  packages/public-tools/src/daily-briefing \
  apps/marketing/src/lib/tools/gsc-gate.test.ts \
  apps/marketing/src/lib/tools/daily-briefing-reader.test.ts \
  apps/marketing/src/lib/tools/daily-briefing-handler.test.ts \
  apps/marketing/src/lib/tools/tool-handoff.test.ts \
  apps/marketing/src/components/tools/daily-search-briefing-tool.test.tsx \
  apps/marketing/src/components/tools/daily-search-briefing-results.test.tsx \
  apps/marketing/src/app/[locale]/tools/tools-hub-contract.test.ts \
  apps/marketing/src/config/sitemap-tools.test.ts \
  apps/marketing/src/i18n/messages.test.ts
```

Expected: PASS with no warnings.

**Step 2: Run package and repository static gates**

```bash
pnpm --filter @sf/public-tools lint
pnpm --filter @sf/public-tools typecheck
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing typecheck
pnpm test
pnpm build
pnpm secrets:scan
git diff --check
```

Expected: PASS. If a pre-existing unrelated failure appears, record it with the
exact command and confirm it reproduces on the baseline before changing code.

**Step 3: Review dependency and authority boundaries**

Confirm:

- no `apps/web` or canonical DB import;
- no new package or lockfile change;
- no token/query/property logging;
- no public URL carrying private GSC evidence;
- no report persistence;
- no model/provider call outside GSC;
- no authority/OpenAPI/database change.

**Step 4: Fresh spec-compliance and code-quality review**

Dispatch independent reviewers against the approved design and actual diff.
Resolve every Critical or Important issue and rerun the relevant gates.

### Task 7: Local browser acceptance

**Files:**
- Create no screenshot baseline unless an existing test convention requires it.
- Modify production files only after a failing automated or browser repro.

**Step 1: Start Marketing locally with deterministic GSC fixture seams**

Use existing test injection patterns; never put a real access token in source,
logs or browser storage. Verify the disconnected page directly and the result
states through the deterministic route seam.

**Step 2: Verify routes and themes**

For `/tools/daily-search-briefing` and `/zh/tools/daily-search-briefing`, check:

- desktop dark and light;
- 390px mobile dark and light;
- connected/disconnected, daily/weekly, complete/partial and no-action states;
- Tools hub card and navigation;
- action handoff prefill and delete-on-consume;
- keyboard navigation, visible focus and self-check labels;
- no horizontal overflow;
- no page or console errors;
- no unexpected external requests.

**Step 3: Final diff and status report**

Run:

```bash
git status --short --branch
git diff --stat
git diff --check
```

Report local changes, all command results, any unverified real-provider behavior,
and explicitly state that nothing was committed, pushed, deployed or migrated.
