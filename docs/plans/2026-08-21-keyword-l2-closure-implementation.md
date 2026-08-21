# Keyword Opportunity L2 Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the original L2 page-selection contract, expose exact 20-page selection statistics, and make failed-run error/cost reporting honest without expanding billing or Blog Agent scope.

**Architecture:** Add a pure full-URL L2 classifier and source-aware candidate frontier in `@sf/sources`, project a compact selection summary through the existing two-stage Marketing contract, then move stage-two cost telemetry to a single success/failure boundary. Keep L1 inventory untouched and preserve old token tolerance.

**Tech Stack:** TypeScript 5.9, Next.js 16.2, React 19, next-intl, Vitest 4, `@sf/sources`, `@sf/public-tools`, `@sf/marketing`.

---

### Task 1: Freeze the L2 classifier contract

**Files:**
- Create: `packages/sources/src/crawl/context-profile-candidate.ts`
- Create: `packages/sources/src/crawl/context-profile-candidate.test.ts`
- Modify: `packages/sources/src/crawl/page-value.ts`
- Modify: `packages/sources/src/crawl/page-value.test.ts`

**Steps:**

1. Write route-table tests for original exclusions, locale variants, common
   semantic variants, blog/resource list roots, content descendants, query/path
   pagination, foreign locale and custom shallow fallbacks.
2. Run the two test files and record RED caused by the missing classifier.
3. Implement the smallest pure classifier with explicit reason and route kind;
   remove about/about equivalents from the positive product score tier.
4. Rerun and record GREEN.

### Task 2: Make the crawl frontier source-aware

**Files:**
- Modify: `packages/sources/src/crawl/parse-page.ts`
- Modify: `packages/sources/src/crawl/parse-page.test.ts`
- Modify: `packages/sources/src/crawl/context-profile.ts`
- Modify: `packages/sources/src/crawl/context-profile.test.ts`
- Modify: `packages/sources/src/crawl/context-profile-failures.test.ts`

**Steps:**

1. Write tests proving navigation sidecar extraction, required category order,
   pre-request hard exclusion, L1 retention, replenishment, and exact selection
   summary/truncation semantics.
2. Run the focused files and record RED.
3. Add ephemeral navigation targets, typed source inputs, dedupe with strongest
   source, classifier-before-request, deterministic ordering, and summary.
4. Rerun and record GREEN.

### Task 3: Project and render selection statistics

**Files:**
- Modify: `apps/marketing/src/lib/tools/keyword-context-crawl.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/types.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.test.ts`
- Modify: `apps/marketing/src/components/tools/keyword-map-tool.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/lib/tools/keyword-map-messages.test.ts`

**Steps:**

1. Write tests requiring new stage-one response/token fields, final-context
   projection, old-token tolerance, and exact EN/ZH stage-one/stage-two copy.
2. Run focused tests and record RED.
3. Wire the compact summary through the existing two-stage flow and render it
   without adding state, routes, or public excluded URLs.
4. Rerun and record GREEN.

### Task 4: Close error and cost honesty

**Files:**
- Modify: `apps/marketing/src/lib/tools/keyword-cost-guard.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-cost-guard.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/lib/tools/keyword-map-messages.test.ts`

**Steps:**

1. Write tests proving one cost record on report success, one on a failure after
   provider cost was booked, correct `reportProduced`, preserved actual cost and
   LLM counts, and charge-free generic copy.
2. Run focused tests and record RED.
3. Move the handler's only report call to a `finally` boundary with bounded
   mutable counters and replace the unsupported copy.
4. Rerun and record GREEN.

### Task 5: Record full original-spec closure

**Files:**
- Create: `docs/external-reviews/2026-08-21-keyword-opportunity-original-spec-closure.md`

**Steps:**

1. Reconcile all 2026-08-19 requirements with the approved deltas and current
   code using `implemented`, `partial`, `superseded`, `deferred`, or
   `unverified` only.
2. Link every conclusion to code/tests and name unresolved calibration, cache,
   hosted/provider, or handoff evidence without fabricating completion.

### Task 6: Review and verify

**Steps:**

1. Request independent specification review, then code-quality review; address
   every Critical/Important item with a fresh RED→GREEN test.
2. Run all changed-file tests plus the existing keyword v2 suite.
3. Run package typechecks/lint for `@sf/sources`, `@sf/public-tools`, and
   `@sf/marketing`; run Marketing build, repository unit tests, typecheck,
   `verify:docs`, `verify:spec`, `secrets:scan`, and `git diff --check`.
4. Report pre-existing repository failures separately. Do not weaken gates or
   edit unrelated files.
5. Inspect final diff/status. Keep the branch local unless the owner separately
   authorizes commit/push/PR/deployment.
