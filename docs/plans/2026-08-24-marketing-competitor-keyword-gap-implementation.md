# Marketing Competitor Keyword Gap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an independent signed-in Marketing tool that aggregates DataForSEO keyword gaps for 1-5 manual competitors and optionally overlays the user's existing GSC evidence.

**Architecture:** Add one first-class `domain_intersection/live` operation to the shared DataForSEO client, one pure versioned contract/aggregator in `@sf/public-tools`, and one single-POST Marketing handler. The client page uses Marketing Supabase auth as the admission boundary; an existing GSC property is optional evidence, never the source of competitor facts and never a prerequisite for DFS results.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest 4, next-intl, Supabase Auth, existing Google Search Console reader, DataForSEO Labs.

**Permission note:** Local code and tests are authorized. Commit, push, PR, deploy, migrations, production configuration, and real provider calls are not authorized; commit steps below are checkpoints only and must not be executed in this task.

---

### Task 6: Converge the post-run surface on the approved Artifact shape

**Files:**

- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-tool.tsx`
- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx`
- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-results.tsx`
- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/i18n/messages.test.ts`
- Modify: `apps/marketing/src/i18n/competitor-keyword-gap-messages.test.tsx`
- Modify: `apps/marketing/src/components/tools/connected-tool-page.tsx`
- Modify: `apps/marketing/src/components/tools/connected-tool-page.test.tsx`
- Modify: `apps/marketing/src/app/[locale]/tools/competitor-keyword-gap/page.tsx`
- Modify: `apps/marketing/src/app/[locale]/tools/competitor-keyword-gap/page.test.ts`

**Step 1: Write RED hierarchy and metric tests**

Add result tests that require:

- site and every competitor in a compact scope strip;
- three overview metrics identified by stable `data-summary-metric` values;
- the GSC overview metric to show an unavailable marker rather than `0` when
  the overlay was not requested or unavailable;
- a five-column decision table: keyword, DFS estimates, competitor ranks, own-
  site GSC evidence, and next check;
- a distinct recommendation cell using the existing deterministic `nextStep`;
- technical coverage details after the table, open for partial/truncated runs;
- an always-visible data-boundary section;
- a table min-width inside its own `overflow-x-auto` wrapper.

Add a tool test proving the form panel and result surface are siblings rather
than one being nested inside the other.

Add shell/page tests proving `compactConnected` suppresses only the downstream
reference sections for an authenticated tool. The signed-out account gate and
the default behavior of every other connected tool must remain unchanged. Add
a single-run assertion for moving the viewport to newly mounted results without
creating another network request or repeated scroll.

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx \
  apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx
```

Expected: assertion-level failures against the existing technically ordered,
nested-card result surface.

**Step 2: Implement the minimum truthful dashboard hierarchy**

Keep the existing request, auth, provider, report, and error behavior intact.
Split the Tool JSX into an outer tool section, one form panel, and a sibling
results component. After a successful response is mounted, move the viewport to
that result once; do not use a continuous animation or fake progress. Add an
explicit, default-off `compactConnected` shell prop and enable it only on this
authenticated competitor-gap page. In Results, derive only:

```ts
const returnedGapRows = result.rows.length;
const observedGscRows = result.rows.filter((row) =>
  row.gsc.queryStatus === "observed_strong" ||
  row.gsc.queryStatus === "observed_weak",
).length;
```

Render `observedGscRows` only when `overlayStatus` is `available` or `partial`.
Do not add weekly deltas, SERP claims, credits, action counts, or persistence.

**Step 3: Add exact EN/ZH messages and parity coverage**

Add scoped copy for the scope strip, returned-row overview, completed-
competitor overview, GSC-observed overview, technical details, decision-table
groups, and four data boundaries. Extend the real NextIntl integration test so
neither locale can regress to literal key paths.

**Step 4: Run GREEN and package gates**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx \
  apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx \
  apps/marketing/src/i18n/competitor-keyword-gap-messages.test.tsx \
  apps/marketing/src/i18n/messages.test.ts
pnpm --filter @sf/marketing typecheck
pnpm exec eslint \
  apps/marketing/src/components/tools/competitor-keyword-gap-tool.tsx \
  apps/marketing/src/components/tools/competitor-keyword-gap-results.tsx
```

Expected: PASS.

**Step 5: Verify the actual post-run browser state**

Build Marketing, run it locally, and use a browser-only deterministic fetch
fixture to exercise the real form and result components without a paid
provider call. Verify desktop and 390x844 screenshots against the Artifact:

- context -> overview -> legend -> decision table -> details -> boundaries;
- full-width sibling results, not double-nested cards;
- no document horizontal overflow;
- table wrapper scrolls independently;
- no console errors;
- no weekly, next-refresh, credits, SERP, or persisted-action claims.

**Step 6: Checkpoint only**

Do not commit without separate authorization.

### Task 1: Add the DataForSEO Domain Intersection client contract

**Files:**

- Modify: `packages/sources/src/dataforseo/client.ts`
- Create: `packages/sources/src/dataforseo/domain-intersection.test.ts`
- Modify: `packages/sources/src/index.ts`

**Step 1: Write the failing request-shape test**

Create a fixture-backed test that constructs `HttpDataForSeoClient`, calls:

```ts
await client.domainIntersection({
  target1: "competitor.example",
  target2: "site.example",
  locationCode: 2840,
  languageCode: "en",
  intersections: false,
  limit: 100,
});
```

Assert the captured POST is exactly one task with:

```ts
expect(body).toEqual([
  {
    target1: "competitor.example",
    target2: "site.example",
    location_code: 2840,
    language_code: "en",
    intersections: false,
    item_types: ["organic"],
    include_clickstream_data: false,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
    limit: 100,
    offset: 0,
  },
]);
```

**Step 2: Run RED**

Run:

```bash
pnpm exec vitest run --project unit packages/sources/src/dataforseo/domain-intersection.test.ts
```

Expected: FAIL because the URL, interface, and `domainIntersection()` method do not exist.

**Step 3: Add the minimum provider types and method**

Add:

```ts
export const DATAFORSEO_DOMAIN_INTERSECTION_LIVE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live";

export interface DataForSeoDomainIntersectionRequest {
  readonly target1: string;
  readonly target2: string;
  readonly locationCode?: number;
  readonly locationName?: string;
  readonly languageCode: string;
  readonly intersections: boolean;
  readonly limit: number;
}

export interface DataForSeoDomainIntersectionRow {
  readonly keyword: string;
  readonly searchVolume: number | null;
  readonly cpc: number | null;
  readonly keywordDifficulty: number | null;
  readonly providerIntent: DataForSeoProviderSearchIntent | null;
  readonly firstDomainRank: number | null;
  readonly secondDomainRank: number | null;
}
```

Return the same bounded provider metadata style as existing Labs methods:

```ts
interface DataForSeoDomainIntersectionResponse {
  readonly rows: readonly DataForSeoDomainIntersectionRow[];
  readonly totalCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}
```

Validate target/location/language/limit before transport. Parse nested
`keyword_data.keyword`, nullable keyword metrics, `keyword_properties`,
`search_intent_info`, and both domain SERP elements. Reuse the existing Basic
Auth, timeout, redirect rejection, bounded JSON, task-status, and transport
error helpers.

**Step 4: Add parsing and failure tests**

Cover:

- official nested keyword shape;
- `null` search volume/KD/CPC stays `null`;
- malformed present KD or rank fails closed;
- task error and HTTP error map to stable `SourceError` codes;
- timeout/abort and oversized response use existing transport semantics;
- default provider `limit` cannot exceed 1,000;
- credentials never appear in thrown messages.

**Step 5: Run GREEN and the existing client suite**

```bash
pnpm exec vitest run --project unit \
  packages/sources/src/dataforseo/domain-intersection.test.ts \
  packages/sources/src/dataforseo/client.test.ts \
  packages/sources/src/dataforseo/competitors-domain.test.ts \
  packages/sources/src/dataforseo/serp-competitors.test.ts
```

Expected: PASS.

**Step 6: Checkpoint only**

Do not commit without separate authorization.

### Task 2: Create the pure competitor-gap contract and aggregator

**Files:**

- Create: `packages/public-tools/src/competitor-keyword-gap/types.ts`
- Create: `packages/public-tools/src/competitor-keyword-gap/validation.ts`
- Create: `packages/public-tools/src/competitor-keyword-gap/report.ts`
- Create: `packages/public-tools/src/competitor-keyword-gap/index.ts`
- Create: `packages/public-tools/src/competitor-keyword-gap/validation.test.ts`
- Create: `packages/public-tools/src/competitor-keyword-gap/report.test.ts`
- Modify: `packages/public-tools/src/index.ts`
- Modify: `packages/public-tools/package.json`

**Step 1: Write RED validation tests**

Specify the desired API first:

```ts
expect(parseCompetitorKeywordGapInput({
  siteDomain: "https://WWW.Acme.com/",
  competitorDomains: ["one.example", "https://two.example/"],
  marketCode: "US",
  languageCode: "en",
})).toEqual({
  ok: true,
  value: {
    siteDomain: "acme.com",
    competitorDomains: ["one.example", "two.example"],
    marketCode: "US",
    languageCode: "en",
  },
});
```

Add separate failing cases for zero, five, and six competitors; duplicate and
self domains after normalization; userinfo; port; IP literal; path/query/hash;
invalid labels; and unsupported value shapes.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit packages/public-tools/src/competitor-keyword-gap/validation.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement the minimum request parser**

Use constants:

```ts
export const COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION =
  "competitor_keyword_gap.v1";
export const COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS = 5;
export const COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT = 100;
```

Return a discriminated `{ok,value}|{ok:false}` result. The parser normalizes
only public hostname syntax; provider market resolution remains an app/server
dependency.

**Step 4: Write RED aggregation tests**

Drive these behaviors:

- the same normalized keyword from three competitors merges all three ranks;
- later competitors never overwrite a better rank for the same domain;
- one unavailable competitor yields top-level `partial` and explicit coverage;
- all unavailable competitors yield `unavailable`;
- a successful zero-row competitor remains `complete`;
- search-volume `null`, explicit `0`, and positive values stay distinct;
- GSC positive rows are impression-weighted and exact-normalized;
- requested but failed/truncated GSC is not “not observed”;
- a strong GSC observation is `observed_strong`, a weak one is
  `observed_weak`, and a completed miss is
  `not_observed_in_gsc_query_sample`;
- query-page evidence projects `optimize_existing`; no positive page projects
  `review_content_gap`;
- sort is competitor count desc, best rank asc, available volume desc, keyword
  identity asc;
- provider total count greater than returned rows sets truncation.

**Step 5: Implement the minimum versioned report builder**

The public result must include:

```ts
type GapRunStatus = "complete" | "partial" | "unavailable";
type MetricAvailability = "available" | "explicit_zero" | "provider_no_data";
type GscOverlayStatus = "not_requested" | "available" | "partial" | "unavailable";
```

Represent each competitor's completion independently. Build rows from a
`Map<normalizedKeyword, MutableAggregate>` internally, then freeze plain
objects/arrays at the boundary. Never expose provider credentials or raw JSON.

**Step 6: Run GREEN**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/competitor-keyword-gap/validation.test.ts \
  packages/public-tools/src/competitor-keyword-gap/report.test.ts
```

Expected: PASS.

**Step 7: Checkpoint only**

Do not commit without separate authorization.

### Task 3: Implement the authenticated Marketing handler and route

**Files:**

- Create: `apps/marketing/src/lib/tools/competitor-keyword-gap-handler.ts`
- Create: `apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts`
- Create: `apps/marketing/src/app/api/tools/competitor-keyword-gap/route.ts`

**Step 1: Write RED authentication and refusal tests**

Inject every effect. Verify:

- Supabase auth `unauthenticated` -> `401 auth_required`;
- auth `unavailable` or throw -> `503 auth_unavailable`;
- invalid media type/body/input refuses before provider creation;
- missing DataForSEO credentials refuses before any provider call;
- an acquired in-flight slot is released on success and every failure;
- duplicate in-flight request -> `409 search_in_progress` with Retry-After;
- every response uses `Cache-Control: no-store, private`.

Run RED:

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts
```

**Step 2: Implement single-POST orchestration**

The dependency surface should include:

```ts
interface CompetitorKeywordGapDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly readGscSession: () => Promise<TrafficDropSession>;
  readonly resolveGscGrant: () => Promise<GrantResolution>;
  readonly readGscCoverage: (input: KeywordCoverageReadInput) => Promise<KeywordCoverageRead>;
  readonly resolveMarket: typeof resolveDataForSeoMarket;
  readonly credentials: () => {login:string;password:string} | null;
  readonly createProvider: (credentials: Credentials) => DataForSeoDomainIntersectionClient;
  readonly acquireSlot: (key: string) => PublicToolSlot;
  readonly extractClientIp: (headers: Headers) => string;
  readonly now: () => Date;
  readonly log: (record: BoundedRunLog) => void;
}
```

Order:

1. authenticate;
2. bounded JSON parse and input validation;
3. resolve market/language;
4. acquire per-IP in-flight slot;
5. if `property` was requested, validate it against the sealed session and
   attempt refreshed grant + bounded coverage read; capture unavailable state
   without throwing away DFS;
6. execute one `domainIntersection()` per competitor with `Promise.allSettled`;
7. build the pure report;
8. emit one bounded cost/status log;
9. release slot in `finally`.

The handler does not call LLM, crawl, App APIs, Worker, or database repositories.

**Step 3: Add provider/GSC behavior tests**

Cover:

- five competitors create exactly five pairwise calls;
- every call uses competitor as `target1`, site as `target2`, and
  `intersections:false`;
- four successes plus one provider error -> `200 partial`;
- no successful provider calls -> `502 keyword_source_unavailable`;
- all successful zero-row calls -> `200 complete` empty;
- omitted property -> no GSC session/grant/read call and `not_requested`;
- selected ungranted property -> GSC `unavailable`, DFS still runs;
- grant refresh/read failure -> GSC `unavailable`, DFS still runs;
- successful GSC overlay reaches the pure report unchanged;
- the final log contains counts, total provider cost, status, and
  `reportProduced`, but no domains, queries, access token, credentials, or raw
  provider error prose.

**Step 4: Wire the route**

Use Node runtime. Build request-scoped `HttpDataForSeoClient` and GSC coverage
reader after admission. Keep credentials server-only. Set a platform duration
that covers five parallel Labs Live calls plus one bounded optional GSC read,
with tighter dependency deadlines.

**Step 5: Run GREEN**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts \
  apps/marketing/src/lib/auth/server-auth-user.test.ts \
  apps/marketing/src/lib/tools/keyword-coverage-reader.test.ts
```

Expected: PASS.

**Step 6: Checkpoint only**

Do not commit without separate authorization.

### Task 4: Build the client tool and result surface

**Files:**

- Create: `apps/marketing/src/components/tools/competitor-keyword-gap-tool.tsx`
- Create: `apps/marketing/src/components/tools/competitor-keyword-gap-results.tsx`
- Create: `apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx`
- Create: `apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx`

**Step 1: Write RED interaction tests**

Use jsdom and accessible queries to specify:

- signed-out run opens `SignInDialog` and never POSTs the tool API;
- signed-in state enables the form;
- a visitor can add/remove normalized competitor chips;
- duplicate, self, invalid, and sixth competitors show inline errors;
- the visible counter is `n / 5`;
- an existing GSC property is optional and can be deselected;
- running state sets `aria-busy` and an `aria-live` elapsed/status message;
- success, partial, unavailable, empty, and retry states render distinct copy;
- a partial response names coverage counts but not hidden provider prose;
- source badges keep DataForSEO and GSC facts separate;
- the table has a caption, `thead`, scoped headers, and a horizontal table
  container without document-level overflow classes.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx \
  apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx
```

Expected: FAIL because the components do not exist.

**Step 3: Implement the minimum state machine**

Use `idle | running | done`; preserve the last valid result until a new run
starts. Check `/api/auth/session` immediately before a paid run, following the
existing Agent workbench. Use `SignInDialog` for signed-out visitors.

Inputs:

- site domain;
- optional GSC property selector when properties exist;
- market and language;
- competitor entry plus removable chips.

Results:

- coverage summary;
- keyword, provider volume/KD/intent, competitor rank chips;
- GSC state/impressions/position/page;
- next step based only on positive evidence;
- explicit partial/unavailable/truncated limitations.

**Step 4: Run GREEN**

Run the same two files and expect PASS.

**Step 5: Checkpoint only**

Do not commit without separate authorization.

### Task 5: Add the independent page, copy, tools hub, and sitemap

**Files:**

- Create: `apps/marketing/src/app/[locale]/tools/competitor-keyword-gap/page.tsx`
- Modify: `apps/marketing/src/components/tools/connected-tool-content.ts`
- Modify: `apps/marketing/src/app/[locale]/tools/page.tsx`
- Modify: `apps/marketing/src/config/sitemap-tools.ts`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/app/[locale]/tools/tools-hub-contract.test.ts`
- Modify: `apps/marketing/src/config/sitemap-tools.test.ts`
- Modify: `apps/marketing/src/app/sitemap.test.ts`
- Modify: any directly affected `_DIR.md` files that already inventory these folders

**Step 1: Write RED routing/inventory/copy tests**

Add the new slug to expected tool surfaces before production code. Assert:

- the page exports correct metadata and renders the tool;
- `/tools/competitor-keyword-gap` appears once in the tools hub;
- the active route is in the sitemap and no retired alias is emitted;
- English and Chinese message namespaces have identical keys;
- copy says on-demand, 1-5 manual competitors, DFS estimates, optional GSC,
  no automatic refresh, and no fixed credit charge.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/app/[locale]/tools/tools-hub-contract.test.ts \
  apps/marketing/src/config/sitemap-tools.test.ts \
  apps/marketing/src/app/sitemap.test.ts \
  apps/marketing/src/i18n/messages.test.ts
```

Expected: FAIL for the absent page/slug/messages.

**Step 3: Implement the page and inventory**

Reuse the current Marketing tool shell and JSON-LD components, but do not use
the GSC-specific hero CTA as the primary login boundary. The client tool owns
Supabase sign-in. Pass the already-available GSC property list only as optional
overlay choices.

**Step 4: Run GREEN**

Run the same inventory/message tests plus the component tests. Expect PASS.

**Step 5: Checkpoint only**

Do not commit without separate authorization.

### Task 6: Verify the whole local story

**Files:**

- Review all files changed by Tasks 1-5
- Update the design/implementation plan only if the implemented contract differs

**Step 1: Focused regression suite**

```bash
pnpm exec vitest run --project unit \
  packages/sources/src/dataforseo/domain-intersection.test.ts \
  packages/sources/src/dataforseo/client.test.ts \
  packages/public-tools/src/competitor-keyword-gap/validation.test.ts \
  packages/public-tools/src/competitor-keyword-gap/report.test.ts \
  apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts \
  apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx \
  apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx \
  apps/marketing/src/app/[locale]/tools/tools-hub-contract.test.ts \
  apps/marketing/src/config/sitemap-tools.test.ts \
  apps/marketing/src/app/sitemap.test.ts \
  apps/marketing/src/i18n/messages.test.ts
```

Expected: all pass.

**Step 2: Package gates**

```bash
pnpm --filter @sf/sources typecheck
pnpm --filter @sf/sources lint
pnpm --filter @sf/public-tools typecheck
pnpm --filter @sf/public-tools lint
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
```

Expected: exit 0.

**Step 3: Repository gates proportional to the change**

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm secrets:scan
```

Expected: exit 0, with any documented pre-existing baseline exception separated
from this branch's diff.

**Step 4: Deterministic browser smoke**

Start the Marketing app with test-only provider seams. Verify desktop and 390px:

- signed-out -> sign-in dialog;
- 1 and 5 competitor entry;
- partial provider result;
- optional GSC badge;
- table-only horizontal scroll;
- no page-level horizontal overflow;
- no console/page errors.

No production, authenticated customer, or billable provider call is part of
this smoke.

**Step 5: Independent review and final diff audit**

- Ask a reviewer agent to inspect only the branch diff for correctness,
  security, evidence honesty, and missing tests.
- Inspect `git diff --check`, `git diff --stat`, and every changed file.
- Confirm no `apps/web`, Worker, authority, OpenAPI, migration, production
  config, or lockfile change entered the diff.

**Step 6: Stop at local handoff**

Report the worktree path, baseline SHA, changed files, fresh verification
outputs, remaining unverified provider/production risks, and that nothing was
committed, pushed, deployed, or migrated.
