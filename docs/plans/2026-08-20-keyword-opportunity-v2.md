# Keyword Opportunity Map v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich every non-zero generated keyword with complete, provenance-bearing SERP evidence, classify results into eligible/excluded/incomplete sections, and raise the keyword context page limit to 20 without adding Blog Agent handoff.

**Architecture:** Keep the existing two-request Marketing flow and public-preview envelope. Extend the crawl token, provider adapters, and keyword domain contract additively, then run an immutable all-candidate SERP plan with a bounded 10-lane worker pool so individual provider failures become incomplete rows instead of discarding successful work.

**Tech Stack:** TypeScript 5.9, Next.js 16.2 Route Handlers, Vitest 4, React 19, DataForSEO Live Advanced/Labs, Google Search Analytics, guarded public HTTP, Marketing Supabase cache pattern.

**Authorization:** Local edits and tests only. Do not commit, push, open a PR, deploy, migrate a hosted database, or run a paid provider canary without a later explicit authorization.

---

### Task 1: Freeze the v2 result and evidence contract

**Files:**
- Modify: `packages/public-tools/src/keyword-opportunity/types.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/next-checks.ts`
- Create: `packages/public-tools/src/keyword-opportunity/signals.ts`
- Create: `packages/public-tools/src/keyword-opportunity/signals.test.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.test.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/next-checks.test.ts`

**Step 1: Write failing type/behavior tests**

Add tests that require:

- schema version `keyword_opportunity_map.v2`;
- `KeywordOpportunityIncomplete` and exhaustive incomplete-reason values;
- eligible rows to carry provider intent, optional SERP intent, organic result
  title/URL, three evidence signals, AI Overview evidence, and a decision basis;
- unavailable signal evidence to remain unavailable, never false;
- explicit-zero, positive existing-page evidence, complete all-negative signals,
  and incomplete evidence to classify into distinct sections;
- AI Overview assessment to add a discount only, never exclude;
- coverage to remove only the overlap check it actually settles.

**Step 2: Verify RED**

Run:

```bash
pnpm vitest run \
  packages/public-tools/src/keyword-opportunity/signals.test.ts \
  packages/public-tools/src/keyword-opportunity/report.test.ts \
  packages/public-tools/src/keyword-opportunity/next-checks.test.ts
```

Expected: FAIL because v2 types, signals, and incomplete output do not exist.

**Step 3: Implement the minimum domain model**

- Preserve `rows` as eligible output and `withheld` as true exclusions for old
  bundle tolerance.
- Add `incomplete` as a third list.
- Add exhaustive constant arrays and compile-time completeness checks for every
  new union.
- Put deterministic three-signal evaluation in `signals.ts`.
- Keep provider facts and LLM inference in separate fields.

**Step 4: Verify GREEN**

Run the Step 2 command and expect all files to pass.

**Step 5: Review diff**

Inspect only the files above. Do not commit without authorization.

### Task 2: Define one shared stable display order and CSV contract

**Files:**
- Modify: `packages/public-tools/src/keyword-opportunity/csv.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/csv.test.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/index.ts`

**Step 1: Write failing tests**

Require a single helper to order eligible/excluded/incomplete candidates by:

1. disposition;
2. positive signal count descending;
3. AI answer discount absent before present;
4. volume descending, null last;
5. normalized keyword ascending.

Require CSV to include provider intent, inferred intent, three signal evidence,
AI Overview state, coverage, decision reason, and availability without exporting
null as zero or weakening formula protection.

**Step 2: Verify RED**

```bash
pnpm vitest run packages/public-tools/src/keyword-opportunity/csv.test.ts
```

Expected: FAIL on missing v2 columns/order helper.

**Step 3: Implement minimal ordering/export**

Share the helper with UI consumers; do not create a second sort in React.

**Step 4: Verify GREEN**

Run the Step 2 command and expect PASS.

**Step 5: Review diff**

Do not commit without authorization.

### Task 3: Raise keyword context collection and prompt input to 20 pages

**Files:**
- Modify: `packages/sources/src/crawl/context-profile.ts`
- Modify: `packages/sources/src/crawl/context-profile.test.ts`
- Modify: `packages/sources/src/crawl/context-profile-failures.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-prompts.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-prompts.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`

**Step 1: Write failing tests**

- Expect `CONTEXT_PROFILE_CRAWL_BUDGET.maxUrls === 20`.
- Prove failed candidates replenish until 20 successful pages.
- Expect `MAX_PROMPT_PAGES === 20` and prove page 20 is present while page 21 is
  absent from the proposition prompt.
- Prove a 20-page context token round-trips under the stage-two body limit with
  multibyte headings and long safe URLs.

**Step 2: Verify RED**

```bash
pnpm vitest run \
  packages/sources/src/crawl/context-profile.test.ts \
  packages/sources/src/crawl/context-profile-failures.test.ts \
  apps/marketing/src/lib/tools/keyword-prompts.test.ts \
  apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts
```

Expected: FAIL on the existing 14/12 page ceilings and token budget.

**Step 3: Implement minimum changes**

- Raise the two keyword-specific page ceilings to 20.
- Retain max depth, guarded transport, pacing, request/byte ceilings, page-value
  ordering, and replenishment semantics.
- Increase only the sealed-token/request byte ceiling demonstrated necessary by
  the failing 20-page fixture.
- Update stale comments and localized run-context copy that state 14 pages.

**Step 4: Verify GREEN**

Run the Step 2 command and expect PASS.

**Step 5: Review diff**

Do not commit without authorization.

### Task 4: Expose bounded sitemap inventory evidence

**Files:**
- Modify: `packages/sources/src/crawl/context-profile.ts`
- Modify: `packages/sources/src/crawl/context-profile.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-context-crawl.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/coverage.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/coverage.test.ts`

**Step 1: Write failing tests**

Require context-profile to return:

```ts
{
  urls: readonly string[];
  fetched: boolean;
  complete: boolean;
  documentsRead: number;
  truncationReasons: readonly (
    | "seed_cap"
    | "child_document_cap"
    | "url_cap"
    | "nested_index_skipped"
    | "off_origin_filtered"
    | "budget_stopped"
  )[];
}
```

Cover no sitemap, child cap, URL cap, nested index, off-origin child, and budget
stop. Require URL/slug evidence to produce `possible_existing_page` only, never
confirmed coverage or confirmed absence.

**Step 2: Verify RED**

```bash
pnpm vitest run \
  packages/sources/src/crawl/context-profile.test.ts \
  packages/public-tools/src/keyword-opportunity/coverage.test.ts \
  apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts
```

Expected: FAIL because context-profile returns only candidate URL strings.

**Step 3: Implement minimum source and token projection**

- Make sitemap reading return URLs plus explicit completeness metadata.
- Carry the bounded inventory projection through `KeywordContextToken`.
- Keep the current source caps initially; when any cap is reached, mark the
  inventory incomplete rather than claiming site-wide absence.
- Bound token bytes and fail explicitly if the evidence cannot be carried.

**Step 4: Verify GREEN**

Run Step 2 and expect PASS.

**Step 5: Review diff**

Do not commit without authorization.

### Task 5: Add positive query-page GSC coverage evidence

**Files:**
- Modify: `packages/public-tools/src/gsc-analytics/page-reader.ts`
- Modify: `packages/public-tools/src/gsc-analytics/page-reader.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-coverage-reader.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-coverage-reader.test.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/coverage.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/coverage.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`

**Step 1: Write failing tests**

- Read paged `dimensions: ["query", "page"]` rows with explicit truncation.
- Positive query-page rows must name the page that received impressions.
- Missing rows under a complete or truncated sample remain `not_observed`, never
  `zero_exposure`.
- A failed read remains `gsc_query_sample_not_read`.

**Step 2: Verify RED**

```bash
pnpm vitest run \
  packages/public-tools/src/gsc-analytics/page-reader.test.ts \
  apps/marketing/src/lib/tools/keyword-coverage-reader.test.ts \
  packages/public-tools/src/keyword-opportunity/coverage.test.ts
```

Expected: FAIL on missing query-page reader/result shape.

**Step 3: Implement minimum reader and coverage index**

Reuse `createSearchAnalyticsClient`; do not change persistent GSC observation
shapes or claim a complete query universe.

**Step 4: Verify GREEN**

Run Step 2 and expect PASS.

**Step 5: Review diff**

Do not commit without authorization.

### Task 6: Extend DataForSEO SERP Advanced parsing

**Files:**
- Modify: `packages/sources/src/dataforseo/keyword-metrics.ts`
- Modify: `packages/sources/src/dataforseo/keyword-metrics.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-providers.ts`
- Create: `apps/marketing/src/lib/tools/keyword-providers.test.ts`

**Step 1: Write failing parser/seam tests**

Require:

- organic title and URL;
- AI Overview markdown and async-loaded flag;
- concrete community items with position/title/URL/domain;
- `null` when the provider omitted a block, distinct from an observed empty list;
- `loadAsyncAiOverview: true` to serialize as `load_async_ai_overview: true`;
- provider seam to preserve every field unchanged.

The markdown preserved here is server-only provider evidence. It is not part of
the public result contract.

**Step 2: Verify RED**

```bash
pnpm vitest run \
  packages/sources/src/dataforseo/keyword-metrics.test.ts \
  apps/marketing/src/lib/tools/keyword-providers.test.ts
```

Expected: FAIL on missing typed fields/request option.

**Step 3: Implement minimum parser/seam changes**

Do not expose raw provider JSON or add unused snippet fields.

**Step 4: Verify GREEN**

Run Step 2 and expect PASS.

**Step 5: Review diff**

Do not commit without authorization.

### Task 7: Add bulk traffic and RDAP registration evidence

**Files:**
- Modify: `packages/sources/src/dataforseo/labs-traffic.ts`
- Create: `packages/sources/src/dataforseo/labs-traffic.test.ts`
- Create: `packages/sources/src/rdap/domain-registration.ts`
- Create: `packages/sources/src/rdap/domain-registration.test.ts`
- Modify: `packages/sources/src/index.ts`
- Modify: `packages/sources/package.json`
- Modify: `apps/marketing/src/lib/tools/keyword-providers.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-providers.test.ts`

**Step 1: Write failing tests**

- Chunk more than 1,000 traffic targets without losing input identity.
- Preserve market/language and `organicEtv: null` semantics.
- Normalize hostnames to registrable-domain lookup inputs.
- Parse RDAP `registration` separately from reregistration/last-changed events.
- Missing/malformed registration remains unavailable.
- Bound response bytes, redirect behavior, and per-call timeout.
- Deduplicate domains before either provider call.

**Step 2: Verify RED**

```bash
pnpm vitest run \
  packages/sources/src/dataforseo/labs-traffic.test.ts \
  packages/sources/src/rdap/domain-registration.test.ts \
  apps/marketing/src/lib/tools/keyword-providers.test.ts
```

Expected: FAIL on missing chunking/RDAP/provider seams.

**Step 3: Implement minimum adapters**

- Reuse provider HTTP abort/body guards.
- Fetch only registration evidence; no owner/contact fields.
- Use long finite cache seams patterned after Marketing evidence caches, but do
  not add a hosted migration in this authorization. The default implementation
  may be request-local until the cache migration is separately authorized.

**Step 4: Verify GREEN**

Run Step 2 and expect PASS.

**Step 5: Review diff**

Do not commit without authorization.

### Task 8: Execute every non-zero candidate with bounded parallelism

**Files:**
- Modify: `apps/marketing/src/lib/tools/keyword-providers.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-providers.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-cost-guard.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-cost-guard.test.ts`
- Modify: `apps/marketing/src/app/api/tools/hidden-keywords/opportunities/route.ts`

**Step 1: Write failing orchestration tests**

- 150 candidates with no explicit zeros cause 150 SERP attempts.
- Explicit-zero candidates cause zero SERP attempts.
- Provider-no-data and already-covered candidates are still attempted.
- Maximum in-flight SERP calls equals `KEYWORD_SERP_CONCURRENCY = 10`.
- Output order matches input order despite out-of-order completion.
- One transient failure creates one incomplete result while successes survive.
- Outcome-unknown transport failure is not retried.
- Only successful SERPs contribute domains to bulk rank/traffic/RDAP.
- The v2 path does not call aggregate cost admission or daily budget refusal.
- Actual costs are still recorded and logged.

**Step 2: Verify RED**

```bash
pnpm vitest run \
  apps/marketing/src/lib/tools/keyword-providers.test.ts \
  apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts \
  apps/marketing/src/lib/tools/keyword-cost-guard.test.ts
```

Expected: FAIL on the 20-item slice, serial loop, all-or-nothing error path, and
budget gates.

**Step 3: Implement minimal worker-pool execution**

- Build the immutable plan before dispatch.
- Use ten workers, one shared iterator, and indexed result slots.
- Fail fast only on configuration/authentication failures that invalidate every
  call; turn query-specific failures into typed outcomes.
- Remove the v2 aggregate budget admission and daily breaker from the handler,
  but retain per-IP/per-target admission and cost telemetry.

**Step 4: Verify GREEN**

Run Step 2 and expect PASS.

**Step 5: Review diff**

Do not commit without authorization.

### Task 9: Add optional versioned SERP/AIO interpretation

**Files:**
- Modify: `apps/marketing/src/lib/tools/keyword-prompts.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-prompts.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-llm-client.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-signal-evidence.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/types.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.test.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/signals.ts`

**Step 1: Write failing tests**

- Provider intent remains unchanged.
- A bounded structured prompt interprets top-ten titles/URLs and available AIO
  markdown as data, not instructions.
- Output carries `serpIntentInference`, `answerAssessment`, reason, model, and
  prompt version.
- Invalid/empty/model-unavailable interpretation leaves inference unavailable;
  it does not erase provider facts or exclude the keyword.
- A complete-answer assessment adds only the AI discount.
- Report input keeps bounded AIO markdown for interpretation and the discount;
  the public eligible/incomplete evidence shape explicitly picks only
  availability, async status, assessment, reason, model, and prompt version.
- Public payload JSON never contains the AIO markdown or a `markdown` property.

**Step 2: Verify RED**

```bash
pnpm vitest run \
  apps/marketing/src/lib/tools/keyword-prompts.test.ts \
  apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts
```

Expected: FAIL on missing interpretation seam.

**Step 3: Implement minimum structured interpretation**

Batch bounded inputs, reuse strict JSON/no-free-text-fallback behavior, keep the
model call outside provider/cache transactions, and use an explicit report
projection rather than structural typing or object spread at the public
boundary.

**Step 4: Verify GREEN**

Run Step 2 and expect PASS.

**Step 5: Review diff**

Do not commit without authorization.

### Task 10: Render eligible, excluded, and incomplete sections

**Files:**
- Modify: `apps/marketing/src/components/tools/keyword-map-results.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.test.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-tool.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/lib/tools/keyword-map-messages.test.ts`
- Modify: `apps/marketing/src/components/tools/keyword-map-article.tsx`

**Step 1: Write failing UI/copy tests**

Require:

- eligible table with provider/inferred intent and raw three-signal evidence;
- AI Overview observed/not-observed/unavailable and discount labels;
- exact coverage action copy without zero-exposure/site-wide-absence claims;
- separate excluded and incomplete sections/counts/retry guidance;
- `remainingDecisions` instead of deleting every next check;
- 20-page run context/truncation copy;
- lexical clustering limitation;
- no Blog Agent/handoff button;
- complete English/Chinese copy for every enum.

**Step 2: Verify RED**

```bash
pnpm vitest run \
  apps/marketing/src/components/tools/keyword-map-results.test.tsx \
  apps/marketing/src/lib/tools/keyword-map-messages.test.ts
```

Expected: FAIL on missing v2 sections/keys.

**Step 3: Implement minimum UI**

Reuse the shared ordering helper and plain JSX text rendering. Avoid a second
state store or new route.

**Step 4: Verify GREEN**

Run Step 2 and expect PASS.

**Step 5: Review diff**

Do not commit without authorization.

### Task 11: Verify the full local implementation

**Files:**
- Inspect every file changed by Tasks 1-10.

**Step 1: Run focused v2 tests**

Run all files named in Tasks 1-10 with one `pnpm vitest run` command. Expected:
all pass, no network/provider request.

**Step 2: Run package gates**

```bash
pnpm --filter @sf/public-tools typecheck
pnpm --filter @sf/public-tools lint
pnpm --filter @sf/sources typecheck
pnpm --filter @sf/sources lint
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
```

Expected: all commands exit 0.

**Step 3: Run repository gates**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm verify:spec
pnpm verify:docs
pnpm secrets:scan
git diff --check
```

Report unrelated baseline failures separately; do not weaken tests or modify
unrelated files to manufacture green output.

**Step 4: Run build and local browser verification**

```bash
pnpm --filter @sf/marketing build
```

Use deterministic mocked/offline provider seams to verify the full UI flow,
including 150 planned SERPs, partial failures, three sections, and 20-page
context. Do not use production credentials.

**Step 5: Independent review**

Request a reviewer against `origin/main...HEAD` plus the uncommitted diff. Fix
Critical/Important findings with new red-green tests, then rerun affected gates.

**Step 6: Final status**

Report local files, test evidence, unresolved production/provider canary, and
the absence of commit/push/deploy/migration. Do not commit without authorization.
