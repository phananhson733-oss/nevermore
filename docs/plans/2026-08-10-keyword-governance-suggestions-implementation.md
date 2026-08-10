# Growth Map Keyword Governance Suggestions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** Ship the approved single-keyword experience in the authenticated
Growth Map: GenGrowth produces a durable, provenance-bearing governance
suggestion asynchronously; the normal customer action is one click to approve;
the existing full form appears only after `展开修改`; provider facts remain
truthful; and known PostgreSQL review failures no longer surface as an opaque
500.

**Architecture:** Add a distinct
`keyword_governance_suggestion_generation` async operation backed by one
canonical `async_runs` row, an immutable frozen-input extension row, an
invocation-attempt fence, and versioned pending suggestion rows. A bounded
structured-model worker resolves prompt-local Topic/Page keys against frozen
allowlists and inserts suggestions without changing effective Keyword
governance. Current review detail reads the current pending suggestion.
One-click approval and edited approval atomically append the existing canonical
user decision, advance the Keyword projection once, and terminalize the
suggestion. Published diagnostic generations remain frozen.

**Tech Stack:** TypeScript, Zod, Next.js App Router, React Query, React,
Drizzle ORM, PostgreSQL migrations/triggers/functions, pg-boss, OpenAI
structured output through the repository model-client boundary, Vitest,
Playwright, repository-owned Artifact source, OpenAPI generation and authority
verifiers.

---

## Execution rules

- Work only in
  `/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727`.
- Feature baseline is `main@65a36a6c47f91cf56b77a6e6f8d2bc429f1af9c9` plus the
  architecture correction in the companion design document.
- The Owner explicitly authorized implementation. Local commits are allowed to
  create an immutable release candidate. Do not push, migrate production,
  deploy, repair production data, or invoke a paid provider/model without a
  separate explicit authorization.
- Follow strict TDD for every behavioral slice: smallest RED, prove the failure,
  minimum GREEN, focused regression, then spec review and code-quality review.
- The active authority order is implementation spec -> authority OpenAPI ->
  generated contract -> spec lock -> implementation. Keep the two OpenAPI
  copies byte-identical.
- Do not weaken append-only, projection, Topic, Page, actor, or invocation
  constraints. Genuine repository/trigger changes require a disposable
  loopback PostgreSQL integration test.
- Do not infer or generate KD, search volume, provider intent, rank, current
  URL, Snapshot/Observation identity, timestamp, stable UUID, revision, actor,
  or approval facts.
- Current/unpinned review reads may include a pending suggestion. Pinned
  published generations must never read one.
- Model calls happen outside transactions. `reserved` and `outcome_unknown`
  invocation attempts block silent duplicate paid calls.
- No batch customer approval in v1. One model invocation may generate at most
  100 independently reviewable Keyword suggestions.
- Artifact source is an acceptance fixture, not the product implementation.
  Product DB/worker/API/UI behavior must be complete before Artifact parity can
  be called done.

## Task 1: Lock strict public and worker contracts

**Files:**

- Modify: `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md`
- Modify: `authority/implementation-spec-v0.4/openapi.yaml`
- Modify: `openapi/mvp.yaml`
- Create: `packages/contracts/src/zod/keyword-governance-suggestions.ts`
- Create: `packages/contracts/src/zod/keyword-governance-suggestions.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `packages/contracts/src/zod/growth-map.test.ts`
- Modify: `packages/contracts/src/zod/index.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/keyword-library-openapi.test.ts`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Modify: `scripts/verify-implementation.mjs`
- Modify: `scripts/verify-implementation-source.test.mjs`
- Regenerate after all authority changes: `scripts/spec-v0.4-lock.json`

**Step 1: Write contract RED tests.**

Define strict versioned shapes for:

- frozen generation manifest with 1-100 ordered candidate Keywords, exact
  governance revisions, confirmed Product Profile/Topic revision, bounded
  Topic/Page prompt-local allowlists, market/language, deterministic evidence,
  and hashes;
- structured model output with one result per prompt-local Keyword key and no
  DB UUIDs or provider facts;
- public pending suggestion with
  `generating | pending_ready | pending_needs_review | stale | unavailable`,
  suggested governance fields, deterministic readiness/limitation, safe
  provenance summary, and immutable suggestion/version identity;
- `ApproveKeywordReviewSuggestionRequest` carrying only exact expected
  governance revision and suggestion version;
- review detail `pendingSuggestion`, required on current reads as nullable and
  always null on pinned reads.

Reject extra keys, duplicate prompt-local keys, more than 100 candidates,
unresolved Topic/Page identities, generated intent without successful
AnalysisInvocation lineage, provider intent with model lineage, and client-owned
actor/timestamp/provider fields.

Run:

```bash
pnpm exec vitest run --project unit \
  packages/contracts/src/zod/keyword-governance-suggestions.test.ts \
  packages/contracts/src/zod/growth-map.test.ts \
  packages/contracts/src/keyword-library-openapi.test.ts
```

Expected RED: schemas, generated API operation, and detail field do not exist.

**Step 2: Add the minimal authority and contract implementation.**

Add a scoped operation:

```text
POST /api/mvp/projects/{projectId}/audit/keywords/{keywordId}/
  review-suggestions/{suggestionId}/approve
```

Document `keyword_governance_suggestion_generation` as an internal async
operation. Keep model/provider/config internal; the public API cannot choose
them.

**Step 3: Generate and verify.**

```bash
pnpm contracts:generate
pnpm contracts:check
pnpm openapi:lint
cmp openapi/mvp.yaml authority/implementation-spec-v0.4/openapi.yaml
pnpm exec vitest run --project unit \
  packages/contracts/src/zod/keyword-governance-suggestions.test.ts \
  packages/contracts/src/zod/growth-map.test.ts \
  packages/contracts/src/keyword-library-openapi.test.ts
pnpm --filter @sf/contracts typecheck
pnpm --filter @sf/contracts lint
git diff --check
```

## Task 2: Add 0051 durable authority and repositories

**Files:**

- Create: `packages/db/migrations/0051_keyword_review_suggestions.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/migration-version.ts`
- Modify: `packages/db/src/migration-version.test.ts`
- Modify: `packages/db/src/migrate-check.ts`
- Create: `packages/db/src/repositories/keyword-review-suggestions.ts`
- Create: `packages/db/src/repositories/keyword-review-suggestions.test.ts`
- Create: `packages/db/src/repositories/keyword-governance-suggestion-generation-runs.ts`
- Create: `packages/db/src/repositories/keyword-governance-suggestion-generation-runs.test.ts`
- Create: `packages/db/src/repositories/keyword-governance-suggestion-invocation-attempts.ts`
- Create: `packages/db/src/repositories/keyword-governance-suggestion-invocation-attempts.test.ts`
- Modify: `packages/db/src/repositories/async-runs.ts`
- Modify: `packages/db/src/repositories/async-runs.test.ts`
- Modify: `packages/db/src/repositories/keyword-governance.ts`
- Modify: `packages/db/src/repositories/keyword-governance.test.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/__tests__/keyword-review-suggestions.integration.test.ts`
- Modify: `packages/db/src/__tests__/migration-progress.integration.test.ts`
- Regenerate: `authority/implementation-spec-v0.4/schema.sql`
- Modify/regenerate: `packages/db/migrations/schema-smoke.sql`
- Modify/regenerate: `authority/implementation-spec-v0.4/scripts/schema-smoke.sql`

**Step 1: Capture database RED.**

Add tests for:

- the async kind/result-type authority and active-key idempotency;
- immutable bounded generation input and exact hashes;
- reservation/finalization/outcome-unknown paid-call fence;
- exactly one pending suggestion per Keyword/current revision;
- suggestion payload immutability and only legal terminal transitions;
- exact workspace/project/Keyword/Topic revision/Page/AnalysisInvocation scope;
- stale governance revision, inactive Topic/Page, cross-project lineage,
  unsuccessful invocation, duplicate output, and partial batch insert rollback;
- atomic one-click approval: one revision, one user decision, one terminalized
  suggestion, exact replay idempotency;
- edited PATCH terminalizes the current exact suggestion as `edited`;
- current human-governed/GenerativeQuery rows cannot receive a pending
  suggestion.

Run unit tests first, then the real test against a freshly migrated disposable
PostgreSQL. Expected RED: migration/tables/repositories do not exist.

**Step 2: Implement migration and repository authority.**

Create three tables:

1. `keyword_review_suggestions`;
2. `keyword_governance_suggestion_generation_runs` sharing the `async_runs` ID;
3. `keyword_governance_suggestion_invocation_attempts`.

Lifecycle status stays on `async_runs`. Suggestion resolution is the only
mutable business field and is protected by a transition trigger. Approval uses
one DB transaction and the existing project Topic-governance writer lock.

**Step 3: Run genuine PostgreSQL and package gates.**

```bash
pnpm exec vitest run --project unit \
  packages/db/src/repositories/keyword-review-suggestions.test.ts \
  packages/db/src/repositories/keyword-governance-suggestion-generation-runs.test.ts \
  packages/db/src/repositories/keyword-governance-suggestion-invocation-attempts.test.ts \
  packages/db/src/repositories/keyword-governance.test.ts \
  packages/db/src/migration-version.test.ts
DATABASE_URL=<disposable-loopback-db> pnpm exec vitest run --project integration \
  packages/db/src/__tests__/keyword-review-suggestions.integration.test.ts \
  packages/db/src/__tests__/migration-progress.integration.test.ts
DATABASE_URL=<disposable-loopback-db> pnpm db:migrate
DATABASE_URL=<disposable-loopback-db> pnpm db:migrate
DATABASE_URL=<disposable-loopback-db> pnpm db:migrate:check
DATABASE_URL=<disposable-loopback-db> pnpm db:smoke
pnpm --filter @sf/db typecheck
pnpm --filter @sf/db lint
git diff --check
```

Drop the disposable database and verify it no longer exists.

## Task 3: Fix current human-review PostgreSQL failure boundaries

**Files:**

- Modify: `packages/db/src/repositories/keyword-governance.ts`
- Modify: `packages/db/src/repositories/keyword-governance.test.ts`
- Modify: `packages/db/src/__tests__/keyword-governance-foundation.integration.test.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.test.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.integration.test.ts`
- Modify: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.test.ts`

**Step 1: Add production-shaped RED.**

Exercise the real path in disposable PostgreSQL:

```text
CSV occurrence -> Keyword materialization -> Topic draft/patch/confirm
  -> approved + Topic + new_asset human review
```

Assert success, one revision advance, and one append-only decision. Add corrupt
mirror/ledger, stale Page/Topic, and named constraint cases; require complete
rollback and typed service behavior.

**Step 2: Add surgical error classification.**

Classify known SQLSTATE + named constraint pairs into stale Page, stale Topic,
revision conflict, or dependency-integrity errors. Unknown database errors stay
500 after sanitized structured logging. Logs may contain scope IDs, operation,
SQLSTATE, constraint, and revision only; never Keyword text, SQL parameters,
prompt, provider payload, or secrets.

**Step 3: Verify no trigger weakening.**

Run the DB integration file, web service/route unit files, DB/Web typecheck and
lint, and `git diff --check`.

## Task 4: Implement deterministic freezer and structured model client

**Files:**

- Create: `packages/artifacts/src/llm/keyword-governance-suggestion-client.ts`
- Create: `packages/artifacts/src/llm/keyword-governance-suggestion-client.test.ts`
- Modify: `packages/artifacts/src/index.ts`
- Modify: `packages/artifacts/src/types.ts`
- Create: `apps/worker/src/keyword-governance-suggestions/frozen-input.ts`
- Create: `apps/worker/src/keyword-governance-suggestions/frozen-input.test.ts`
- Create: `apps/worker/src/keyword-governance-suggestions/resolution.ts`
- Create: `apps/worker/src/keyword-governance-suggestions/resolution.test.ts`

**Step 1: Add parser/freezer/resolver RED.**

Prove:

- only candidate + unreviewed `search_query` Keywords enter inventory;
- later human decisions and GenerativeQuery rows are excluded;
- exact primary market/language, confirmed Product Profile/Topic revision and
  valid occurrences are required;
- deterministic order and 100-item bound;
- provider intent wins and remains provider lineage;
- exact owned URL/Page attribution wins before model inference;
- model only fills missing governance fields;
- prompt-local keys must resolve to the frozen allowlist;
- duplicate/missing/extra outputs, unknown keys, invented facts and unsafe text
  fail the whole batch closed;
- hashes are deterministic and bounded.

**Step 2: Implement minimum structured client and resolver.**

Reuse the existing injected provider boundary and invocation metadata shape.
Do not make a live provider call in tests. Do not hold a DB transaction during
the network call.

**Step 3: Verify packages.**

Run focused Artifact/Worker unit tests, package lint/typecheck, and diff check.

## Task 5: Implement independent async generation and enqueueing

**Files:**

- Create: `apps/worker/src/keyword-governance-suggestions/run-keyword-governance-suggestion-generation.ts`
- Create: `apps/worker/src/keyword-governance-suggestions/run-keyword-governance-suggestion-generation.test.ts`
- Create: `apps/worker/src/keyword-governance-suggestions/__tests__/run-keyword-governance-suggestion-generation.integration.test.ts`
- Create: `apps/worker/src/handlers/keyword-governance-suggestion-generation.ts`
- Create: `apps/worker/src/handlers/keyword-governance-suggestion-generation.test.ts`
- Modify: `apps/worker/src/handlers/handlers-registration.test.ts`
- Modify: `apps/worker/src/handlers/recovery.ts`
- Modify: `apps/worker/src/handlers/recovery.test.ts`
- Modify: `apps/worker/src/health-snapshot.ts`
- Modify: `apps/worker/src/health-snapshot.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/index.test.ts`
- Modify: `apps/worker/src/analysis-refresh/run-analysis-refresh.ts`
- Modify: `apps/worker/src/analysis-refresh/run-analysis-refresh.test.ts`
- Modify: the CSV-import and Topic-confirmation orchestration services located
  during implementation, with focused tests.

**Step 1: Add orchestration RED.**

Cover active-key idempotency, bounded pagination, reservation outside provider
call, success, invalid output, retryable failure, rejected output,
outcome-unknown, stale run, concurrent human review, partial-insert rollback,
recovery queue selection, and health metrics.

Analysis Refresh/CSV/Topic confirmation enqueue the independent job only after
their authoritative commit. They do not wait for model completion, and enqueue
failure does not falsify the already completed source operation.

**Step 2: Implement the six-step worker fence.**

```text
claim async run -> freeze/verify input -> reserve attempt -> commit
  -> call model -> persist invocation -> resolve allowlists/insert suggestions
  -> terminalize run
```

No paid retry after `outcome_unknown`. Existing pending exact-hash suggestions
are idempotently reused; stale pending suggestions are superseded, never
overwritten.

**Step 3: Verify unit and real integration.**

Use a fake injected model for unit/integration and a disposable PostgreSQL for
the full worker repository path. Run Worker lint/typecheck and remove the DB.

## Task 6: Add read, approve and edited-resolution web flows

**Files:**

- Modify: `apps/web/src/lib/services/growth-map-keywords.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.test.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.integration.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/review-suggestions/[suggestionId]/approve/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/review-suggestions/[suggestionId]/approve/route.test.ts`
- Modify: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.ts`
- Modify: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.test.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.test.ts`

**Step 1: Add service/API RED.**

Assert current detail returns the exact current pending suggestion while pinned
detail returns null. One-click approval uses server actor, ignores no
client-supplied lineage, returns authoritative r+1 detail, supports exact replay,
and rejects stale/cross-scope/invalid Topic/Page suggestions without partial
writes. Existing PATCH resolves the exact current suggestion as `edited`.

**Step 2: Implement current projection and mutations.**

Use the DB transaction authority from Task 2. After success invalidate current
detail, all unpinned Keyword list pages, Topic insight/coverage and selected
rail keys. Never invalidate a pinned historical generation into current data.

**Step 3: Verify routes/services/hooks.**

Run focused unit and real PostgreSQL integration tests, Web lint/typecheck and
diff check.

## Task 7: Implement conclusion-first Growth Map UI

**Files:**

- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/growth-map.module.css`
- Modify: `packages/i18n/src/messages/zh-CN.json`
- Modify: `packages/i18n/src/messages/en.json`
- Modify: `packages/i18n/src/__tests__/parity.test.ts`
- Modify: `e2e/growth-map-keyword-review.mock.spec.ts`
- Modify as fixture parity requires:
  `e2e/complete-four-module-workbench.mock.spec.ts`

**Step 1: Capture browser RED.**

For a Chinese candidate Keyword with a ready suggestion, assert the default
review surface shows the compact conclusion and exactly one primary
`批准系统建议` action; no select, checkbox or required reason textarea is visible.
`展开修改` reveals the prefilled current advanced form. Add English parity,
keyboard/focus, stale, generating, needs-review and unavailable cases.

**Step 2: Implement minimal UI.**

Reuse the Artifact master-detail hierarchy and current dialog. Do not add a
second competing form. Approval errors distinguish stale refresh, invalid
suggestion/edit, and dependency retry/support. Successful approval refreshes
the row and rail.

**Step 3: Verify UI.**

Run view-model/component tests, i18n parity/lint/typecheck, focused Playwright,
Web typecheck/lint and CSS parse/diff check.

## Task 8: Add Artifact scenario parity and complete release gates

**Files:**

- Modify: `docs/artifact-src/workspace-data.js`
- Modify: `docs/artifact-src/client-app.js`
- Modify: `docs/artifact-src/styles.css`
- Regenerate: `docs/artifacts/GenGrowth-Interactive-Artifact.html`
- Modify the existing deterministic Artifact verification tests/scripts only as
  required by the new scenario.
- Regenerate after all final authority changes:
  `scripts/spec-v0.4-lock.json`
- Update mechanical inventory/head documentation required by repository
  verifiers.

**Step 1: Add Artifact scenario RED.**

Add one ready suggestion and one needs-review exception. Default rail is
concise; expanded editor is optional; approval creates an explicit scenario
receipt and does not claim a live API call.

**Step 2: Regenerate deterministically.**

Build the generated HTML from source and prove a second regeneration has zero
diff. Do not hand-edit the generated HTML.

**Step 3: Run complete gates.**

At minimum:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm contracts:check
pnpm openapi:lint
pnpm verify:authority
pnpm verify:spec
pnpm verify:spec:test
pnpm verify:docs
pnpm secrets:scan
pnpm deploy:check
pnpm typecheck:e2e
pnpm exec playwright test e2e/growth-map-keyword-review.mock.spec.ts
git diff --check
cmp openapi/mvp.yaml authority/implementation-spec-v0.4/openapi.yaml
cmp packages/db/migrations/schema-smoke.sql \
  authority/implementation-spec-v0.4/scripts/schema-smoke.sql
```

Run the real browser/PostgreSQL review flow on a disposable loopback database.
Drop all test databases and confirm no residual process/database. Request a
final spec-compliance review and then a code-quality/security review. Fix every
P0/P1/P2 before completion.

**Step 4: Create an immutable release candidate.**

Verify the worktree is clean, commit the completed implementation on the
authorized branch, and report the exact SHA plus all gates. Keep these states
separate:

- locally implemented and committed;
- pushed to a remote feature/main ref;
- production database migrated;
- Worker deployed and ready at the same SHA;
- Vercel production alias healthy at the same SHA.

Only the first state is authorized by this implementation request. Do not
perform the remaining external writes without an explicit release command.
