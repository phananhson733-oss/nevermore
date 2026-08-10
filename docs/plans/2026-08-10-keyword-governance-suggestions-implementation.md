# Keyword Governance Suggestions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a production-ready Keyword governance suggestion flow that pre-generates one-click approval suggestions, fixes the current keyword review save failure boundary, and keeps Artifact/UI aligned with the real authenticated behavior.

**Architecture:** Reuse the existing `async_runs + immutable AnalysisInvocation + worker child task` pattern already used by Topic Model generation, but keep the new capability isolated behind its own task identity, run ledger, invocation-attempt ledger, and pending-suggestion table. Preserve `keyword_review_decisions` as the only effective governance authority; pending suggestions remain separate until a human approves or edits them.

**Tech Stack:** Next.js App Router, TypeScript, Zod/OpenAPI contract generation, Drizzle/PostgreSQL ordered migrations, pg-boss worker jobs, Vitest, existing Growth Map/Keyword governance repositories.

---

### Task 1: Lock the contract and authority surface

**Files:**
- Modify: `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md`
- Modify: `authority/implementation-spec-v0.4/openapi.yaml`
- Modify: `packages/contracts/src/zod/keyword-governance.ts`
- Modify: `packages/contracts/src/zod/keyword-governance.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `packages/contracts/src/zod/growth-map.test.ts`
- Modify: `packages/contracts/src/generated/openapi.ts`

**Step 1: Write the failing contract tests**

- Add a strict `pendingSuggestion` review-detail shape covering:
  - suggestion identity and version
  - expected governance revision
  - deterministic readiness state
  - suggested status/intent/buyerStage/topic/page mapping/reason
  - customer-safe lineage summary only
- Add a strict approve command schema for:
  - `POST /projects/{projectId}/audit/keywords/{keywordId}/review-suggestions/{suggestionId}/approve`
  - body with only `expectedGovernanceRevision` and `suggestionVersion`
- Add negative tests that reject:
  - client-supplied actor IDs
  - client-supplied provider facts
  - missing suggestion version
  - malformed readiness state

**Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest packages/contracts/src/zod/keyword-governance.test.ts packages/contracts/src/zod/growth-map.test.ts
```

Expected: FAIL on missing `pendingSuggestion` and approve-command contract support.

**Step 3: Implement the minimal contract changes**

- Extend keyword governance Zod types with the new pending suggestion read model.
- Extend Growth Map projection types only where the authenticated UI actually reads the new field.
- Add the new approve path to `openapi.yaml` without broadening unrelated keyword endpoints.
- Regenerate or update `packages/contracts/src/generated/openapi.ts` so generated types match the authority file exactly.

**Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest packages/contracts/src/zod/keyword-governance.test.ts packages/contracts/src/zod/growth-map.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md authority/implementation-spec-v0.4/openapi.yaml packages/contracts/src/zod/keyword-governance.ts packages/contracts/src/zod/keyword-governance.test.ts packages/contracts/src/zod/growth-map.ts packages/contracts/src/zod/growth-map.test.ts packages/contracts/src/generated/openapi.ts
git commit -m "feat(growth-map): add keyword suggestion contracts"
```

### Task 2: Add durable DB ledgers and fix review save error classification

**Files:**
- Create: `packages/db/migrations/0051_keyword_review_suggestions.sql`
- Modify: `packages/db/migrations/schema-smoke.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/keyword-governance-suggestion-runs.ts`
- Create: `packages/db/src/repositories/keyword-governance-suggestion-runs.test.ts`
- Create: `packages/db/src/repositories/keyword-governance-suggestion-invocation-attempts.ts`
- Create: `packages/db/src/repositories/keyword-governance-suggestion-invocation-attempts.test.ts`
- Modify: `packages/db/src/repositories/keyword-governance.ts`
- Modify: `packages/db/src/repositories/keyword-governance.test.ts`
- Create or modify: `packages/db/src/__tests__/keyword-review-suggestions.integration.test.ts`
- Modify: `packages/db/src/migrate-check.ts`
- Modify: `packages/db/src/migration-version.test.ts`

**Step 1: Write the failing repository and integration tests**

- Add migration/schema smoke expectations for:
  - `keyword_review_suggestions`
  - `keyword_governance_suggestion_generation_runs`
  - `keyword_governance_suggestion_invocation_attempts`
- Add real PostgreSQL integration tests that prove:
  - one pending suggestion per keyword scope
  - only legal `pending -> approved|superseded` transition
  - run/attempt reservation and terminalization fences
  - `reviewKeyword` still advances exactly one revision and appends exactly one decision
  - stale/missing page and stale/missing topic become typed failures instead of opaque Drizzle 500s
  - corrupted ledger/mirror state fails closed with rollback

**Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest packages/db/src/repositories/keyword-governance.test.ts packages/db/src/migration-version.test.ts packages/db/src/repositories/keyword-governance-suggestion-runs.test.ts packages/db/src/repositories/keyword-governance-suggestion-invocation-attempts.test.ts packages/db/src/__tests__/keyword-review-suggestions.integration.test.ts
```

Expected: FAIL because the migration, schema, and typed repository behavior do not exist yet.

**Step 3: Implement the minimal database layer**

- Add ordered migration `0051_keyword_review_suggestions.sql` with:
  - task/result enums for the new async child
  - run table keyed by `async_runs.id`
  - invocation-attempt ledger with reserve/finalize/outcome-unknown fence
  - suggestion table with immutable content and one legal terminal transition
- Extend `schema.ts` and repository classes only for operations needed in v1:
  - create or supersede a pending suggestion batch
  - read current pending suggestion
  - reserve/finalize one invocation attempt
  - approve or supersede one suggestion
- In `keyword-governance.ts`, map SQLSTATE/constraint classes into typed keyword governance failures instead of rethrowing raw Drizzle errors.

**Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest packages/db/src/repositories/keyword-governance.test.ts packages/db/src/migration-version.test.ts packages/db/src/repositories/keyword-governance-suggestion-runs.test.ts packages/db/src/repositories/keyword-governance-suggestion-invocation-attempts.test.ts packages/db/src/__tests__/keyword-review-suggestions.integration.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/db/migrations/0051_keyword_review_suggestions.sql packages/db/migrations/schema-smoke.sql packages/db/src/schema.ts packages/db/src/repositories/keyword-governance-suggestion-runs.ts packages/db/src/repositories/keyword-governance-suggestion-runs.test.ts packages/db/src/repositories/keyword-governance-suggestion-invocation-attempts.ts packages/db/src/repositories/keyword-governance-suggestion-invocation-attempts.test.ts packages/db/src/repositories/keyword-governance.ts packages/db/src/repositories/keyword-governance.test.ts packages/db/src/__tests__/keyword-review-suggestions.integration.test.ts packages/db/src/migrate-check.ts packages/db/src/migration-version.test.ts
git commit -m "feat(db): add keyword suggestion ledgers"
```

### Task 3: Add the internal worker child that generates suggestions

**Files:**
- Create: `apps/worker/src/keyword-governance/run-keyword-governance-suggestions.ts`
- Create: `apps/worker/src/keyword-governance/run-keyword-governance-suggestions.test.ts`
- Create: `apps/worker/src/keyword-governance/__tests__/run-keyword-governance-suggestions.integration.test.ts`
- Create: `apps/worker/src/handlers/keyword-governance-suggestions.ts`
- Create: `apps/worker/src/handlers/keyword-governance-suggestions.test.ts`
- Modify: `apps/worker/src/handlers/recovery.ts`
- Modify: `apps/worker/src/handlers/analysis-refresh.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/context.ts`
- Modify: `packages/artifacts/src/types.ts`
- Create or modify: `packages/artifacts/src/llm/keyword-governance-suggestion-client.ts`
- Create or modify: `packages/artifacts/src/llm/keyword-governance-suggestion-client.test.ts`

**Step 1: Write the failing worker tests**

- Add unit tests for:
  - bounded input freeze
  - deterministic-first mapping before LLM fallback
  - prompt-local key round-trip validation
  - invalid structured output fail-closed behavior
- Add handler tests for:
  - pg-boss queue registration
  - parent notification path
  - retry and outcome-unknown handling
- Add integration tests proving the worker:
  - creates one internal child run
  - persists one immutable AnalysisInvocation on success
  - supersedes older pending suggestions on input drift
  - never generates on ineligible keywords

**Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest apps/worker/src/keyword-governance/run-keyword-governance-suggestions.test.ts apps/worker/src/handlers/keyword-governance-suggestions.test.ts apps/worker/src/keyword-governance/__tests__/run-keyword-governance-suggestions.integration.test.ts packages/artifacts/src/llm/keyword-governance-suggestion-client.test.ts
```

Expected: FAIL because the worker path does not exist.

**Step 3: Implement the minimal async flow**

- Add a distinct async identity, queue name, and handler for keyword governance suggestion generation.
- Mirror Topic Model’s durable reserve/call/finalize flow, but keep the input/output contract specific to keyword governance suggestions.
- Trigger enqueue only from authoritative events already in scope for this release:
  - post-refresh current keyword materialization
  - CSV keyword materialization path
  - confirmed Topic Model revision materialization
- Keep batching bounded and idempotent; do not add per-keyword jobs.

**Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest apps/worker/src/keyword-governance/run-keyword-governance-suggestions.test.ts apps/worker/src/handlers/keyword-governance-suggestions.test.ts apps/worker/src/keyword-governance/__tests__/run-keyword-governance-suggestions.integration.test.ts packages/artifacts/src/llm/keyword-governance-suggestion-client.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/keyword-governance/run-keyword-governance-suggestions.ts apps/worker/src/keyword-governance/run-keyword-governance-suggestions.test.ts apps/worker/src/keyword-governance/__tests__/run-keyword-governance-suggestions.integration.test.ts apps/worker/src/handlers/keyword-governance-suggestions.ts apps/worker/src/handlers/keyword-governance-suggestions.test.ts apps/worker/src/handlers/recovery.ts apps/worker/src/handlers/analysis-refresh.ts apps/worker/src/index.ts apps/worker/src/context.ts packages/artifacts/src/types.ts packages/artifacts/src/llm/keyword-governance-suggestion-client.ts packages/artifacts/src/llm/keyword-governance-suggestion-client.test.ts
git commit -m "feat(worker): generate keyword governance suggestions"
```

### Task 4: Wire authenticated services and API endpoints

**Files:**
- Modify: `apps/web/src/lib/services/growth-map-keywords.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.test.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.integration.test.ts`
- Modify: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.ts`
- Modify: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/review-suggestions/[suggestionId]/approve/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/review-suggestions/[suggestionId]/approve/route.test.ts`
- Modify: `apps/web/src/lib/services/analysis-refresh.ts`
- Modify: `apps/web/src/lib/services/__tests__/analysis-refresh.integration.test.ts`

**Step 1: Write the failing service and route tests**

- Add review-detail tests asserting `pendingSuggestion` appears only on current authenticated reads.
- Add approve-route tests asserting:
  - exact replay idempotency
  - stale revision conflict
  - stale Topic/Page lineage rejection
  - approved suggestion produces an authoritative updated detail response
- Add PATCH tests asserting:
  - edited review resolves the pending suggestion as `edited`
  - manual path still works with no suggestion
  - typed DB integrity failures return differentiated API errors

**Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest apps/web/src/lib/services/growth-map-keywords.test.ts apps/web/src/lib/services/growth-map-keywords.integration.test.ts apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.test.ts apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/review-suggestions/[suggestionId]/approve/route.test.ts apps/web/src/lib/services/__tests__/analysis-refresh.integration.test.ts
```

Expected: FAIL on missing approve endpoint and missing pending-suggestion behavior.

**Step 3: Implement the minimal service layer**

- Extend current keyword detail projection to include the nullable pending suggestion.
- Add the approve service path that:
  - locks the keyword and suggestion
  - revalidates current Topic/Page authority
  - appends one user decision
  - advances one current revision
  - terminalizes the suggestion as `accepted`
- Keep the existing PATCH route as the expanded-edit escape hatch and resolve the suggestion as `edited` when applicable.
- Map typed failures into stable HTTP responses instead of generic 500s where the service now knows the class.

**Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest apps/web/src/lib/services/growth-map-keywords.test.ts apps/web/src/lib/services/growth-map-keywords.integration.test.ts apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.test.ts apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/review-suggestions/[suggestionId]/approve/route.test.ts apps/web/src/lib/services/__tests__/analysis-refresh.integration.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/lib/services/growth-map-keywords.ts apps/web/src/lib/services/growth-map-keywords.test.ts apps/web/src/lib/services/growth-map-keywords.integration.test.ts apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.ts apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.test.ts apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/review-suggestions/[suggestionId]/approve/route.ts apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/review-suggestions/[suggestionId]/approve/route.test.ts apps/web/src/lib/services/analysis-refresh.ts apps/web/src/lib/services/__tests__/analysis-refresh.integration.test.ts
git commit -m "feat(api): approve keyword governance suggestions"
```

### Task 5: Replace the default form UI with one-click approval and keep Artifact parity

**Files:**
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `apps/web/src/lib/services/growth-map.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `docs/artifact-src/client-app.js`
- Modify: `docs/artifact-src/workspace-data.js`
- Modify: `docs/artifact-src/styles.css`

**Step 1: Write the failing UI/view-model tests**

- Add view-model tests for:
  - suggestion summary state
  - one-click approval command payload
  - `展开修改` revealing the full existing form
  - honest unavailable/stale copy paths
- Add component tests or focused render assertions for:
  - default compact suggestion card
  - primary `批准系统建议`
  - secondary `展开修改`
  - no forced checkbox-by-checkbox workflow
- Add Artifact behavior tests or snapshot verification for the same interaction hierarchy.

**Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts
```

Expected: FAIL because the current UI always opens the full form-first review path.

**Step 3: Implement the minimal UI changes**

- Keep the master-detail Growth Map layout intact.
- Change the keyword rail and review dialog so the default state is:
  - concise system suggestion summary
  - one-click approval
  - optional expand/edit path
- Reuse the existing form fields for expanded edit instead of inventing a second advanced editor.
- Keep null/unavailable states explicit; do not render invented zeros or fake AI counts.
- Update Artifact source to mirror the implemented interaction hierarchy, but keep it scenario-only.

**Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.ts apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx apps/web/src/lib/services/growth-map.ts packages/contracts/src/zod/growth-map.ts docs/artifact-src/client-app.js docs/artifact-src/workspace-data.js docs/artifact-src/styles.css
git commit -m "feat(ui): add one-click keyword suggestion approval"
```

### Task 6: Regenerate authority artifacts and run production-shape verification

**Files:**
- Modify as produced by the repo’s existing codegen/build steps only

**Step 1: Run the failing end-to-end verification commands**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest
pnpm test:db
pnpm lint
pnpm typecheck
```

Expected: reveal any remaining contract drift, DB fixture breakage, or UI compile errors.

**Step 2: Fix only the failures caused by Tasks 1-5**

- Regenerate any checked-in authority or contract outputs required by the repo.
- Update exact failing tests only where the new approved behavior changes the asserted output.
- Do not refactor unrelated Growth Map behavior.

**Step 3: Run the verification commands again**

Run:

```bash
cd /Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/main-integration-task4-20260727
pnpm vitest
pnpm test:db
pnpm lint
pnpm typecheck
```

Expected: PASS.

**Step 4: Build and verify the Artifact output**

Run the repository’s existing Artifact build command, then verify that:

- the generated HTML updates deterministically from `docs/artifact-src/*`
- the new keyword suggestion interaction is present in the scenario output
- the generated file changes are limited to this feature

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(growth-map): ship keyword governance suggestions"
```
