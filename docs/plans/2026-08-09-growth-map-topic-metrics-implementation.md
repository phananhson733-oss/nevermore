# Growth Map Topic Automation and Keyword Metrics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Preserve real DataForSEO keyword difficulty and search intent, create
the first confirmed Topic Model automatically through a durable structured-LLM
child run, keep all user revisions authoritative, and restore the approved
Artifact Growth Map Keyword/Topic experience without inventing unavailable
facts.

**Architecture:** Extend the immutable DataForSEO observation at its parser
boundary; expose a provenance-bearing search-intent projection without changing
the meaning of the existing governed `intent`; add an Analysis Refresh v3
optional child run that freezes bounded keyword input, reserves a model call,
persists its invocation, then atomically creates and system-confirms the first
Topic revision and assigns eligible keywords. The UI consumes only confirmed
Topic authority and complete, identity-checked Growth Map inventories.

**Tech Stack:** TypeScript, Zod, Next.js App Router, React Query, Drizzle ORM,
PostgreSQL migrations and triggers, Vitest unit/integration projects,
Playwright mock/real-browser tests, OpenAPI-generated contracts.

---

## Execution rules

- Work only in
  `/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/growth-map-topic-metrics-20260809`.
- Baseline is `origin/main@743f99d709e28e85617234bdf64cac93bd331e3a`.
- Follow TDD for every behavioral slice: add the smallest failing test, run it
  and capture the expected failure, write the minimum implementation, rerun the
  narrow test, then run the relevant regression set.
- The active authority order is implementation spec, OpenAPI, generated schema,
  spec lock, implementation. Any new enum, table, operation, or orchestration
  step must update that chain atomically.
- Do not run paid DataForSEO calls, write to hosted databases, commit, push,
  create a pull request, deploy, or perform any external write. At each task's
  normal commit checkpoint, record `git diff --check`, `git status --short`, and
  the verification result instead; committing remains a separate Owner
  authorization.
- Keep existing governed `intent` backward compatible. KD is never inferred.
  Missing facts stay nullable with explicit limitations.
- A published diagnostic generation reads only frozen refs. Never substitute a
  newer observation, Topic revision, or review decision.
- Automation runs only when both confirmed Topic and draft Topic are absent.
  It must skip rather than overwrite when concurrent or user-authored state
  appears.
- Any repository SQL, FK, trigger, or transaction change needs a disposable
  real-PostgreSQL test; fake executors are not sufficient completion evidence.
- After every implementation task, run a specification compliance review. Run
  a code-quality review only after specification compliance passes.

## Task 1: Retain DataForSEO KD and provider intent

**Execution status (2026-08-09):** implemented locally and independently
verified. A clean-HEAD audit reproduced the parser RED; the composite v1/v2
wrapper RED reproduced both values being replaced by `null`; two later review
RED loops closed custom-client validation gaps in the composite and direct
adapters and a final security RED removed extra-field Snapshot smuggling; the
final narrow suite passed 76 tests and `@sf/sources` typecheck. No live provider call or
external write occurred. Keep the RED descriptions below as historical TDD
evidence, not as instructions to expect a new failure in the modified worktree.

**Files:**

- Modify: `packages/sources/src/dataforseo/client.test.ts`
- Modify: `packages/sources/src/dataforseo/client.ts`
- Modify: `packages/sources/src/dataforseo/adapter.test.ts`
- Modify: `packages/sources/src/dataforseo/adapter.ts`
- Modify: `packages/sources/src/observations.ts`
- Modify if fixture parity requires it:
  `packages/sources/src/dataforseo/search-landscape.test.ts`
- Modify if fixture parity requires it:
  `packages/sources/src/dataforseo/search-landscape-v2.test.ts`
- Modify: `packages/sources/src/dataforseo/search-landscape.ts`
- Modify: `packages/sources/src/csv/normalize.ts`

**Step 1: Add parser RED cases.**

Add ranked-keyword payload fixtures that prove:

- `keyword_data.keyword_properties.keyword_difficulty` is retained as an
  integer from `0` through `100`;
- `keyword_data.search_intent_info.main_intent` accepts exactly
  `informational | navigational | commercial | transactional`;
- absent fields become `null`;
- fractional, non-numeric, negative, above-100 KD and unknown intent fail the
  provider-response boundary instead of becoming zero or another enum.

Run:

```bash
pnpm exec vitest run --project unit \
  packages/sources/src/dataforseo/client.test.ts
```

Expected RED: assertions fail because `DataForSeoRankedKeywordRow` and
`parseRow` currently drop both fields.

**Step 2: Add the minimal parser implementation.**

Extend `DataForSeoRankedKeywordRow` and `parseRow` with nullable
`keywordDifficulty` and `providerSearchIntent`. Validate present values
strictly at this boundary; do not use truthiness so KD `0` survives.

**Step 3: Add adapter RED cases.**

Assert the canonical `CsvKeywordProjection` value JSON contains both fields for
ranked-keyword observations and keeps explicit nulls when absent. Assert v1 and
v2 search-landscape wrappers preserve the same normalized shape.

Run:

```bash
pnpm exec vitest run --project unit \
  packages/sources/src/dataforseo/adapter.test.ts \
  packages/sources/src/dataforseo/search-landscape.test.ts \
  packages/sources/src/dataforseo/search-landscape-v2.test.ts
```

Expected RED: normalized projections do not yet contain either field.

**Step 4: Extend the canonical observation projection.**

Add the two nullable fields to `CsvKeywordProjection` and map the parsed row
without changing observation kind, source identity, deduplication, or snapshot
semantics.

**Step 5: Verify the slice.**

Run the four tests above together, then:

```bash
pnpm --filter @sf/sources typecheck
git diff --check
```

## Task 2: Specify and expose provenance-bearing search intent

**Files:**

- Modify: `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md`
- Modify: `authority/implementation-spec-v0.4/openapi.yaml`
- Modify: `openapi/mvp.yaml`
- Regenerate: `scripts/spec-v0.4-lock.json`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `packages/contracts/src/keyword-library-openapi.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.test.ts`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Modify: `scripts/verify-implementation.mjs`
- Modify: `apps/web/src/lib/services/growth-map-keywords.test.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.integration.test.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.test.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.ts`

**Step 1: Lock the contract with RED tests.**

Add `GrowthMapKeywordSearchIntent` with:

- nullable `value`;
- authority
  `user_confirmed | governed_legacy | provider_observed | llm_generated | unavailable`;
- nullable Snapshot, Observation, and AnalysisInvocation IDs;
- nullable `observedAt` and `limitation`.

Keep the existing `intent` property unchanged. Add contract tests rejecting:

- provider intent without Snapshot/Observation lineage;
- LLM intent without AnalysisInvocation lineage;
- unavailable intent with a non-null value;
- unrecognized authorities or widened client fields.

Run:

```bash
pnpm exec vitest run --project unit \
  packages/contracts/src/keyword-library-openapi.test.ts
```

Expected RED: generated/Zod contracts lack `searchIntent`.

**Step 2: Update authority and regenerate contracts.**

Document the precedence and frozen-generation semantics in the implementation
spec and both OpenAPI sources, regenerate the TypeScript OpenAPI output, then
make the Zod schema exactly match the public contract.

**Step 3: Add live and frozen service RED cases.**

Cover:

1. user-confirmed intent wins over provider facts;
2. provider-observed intent is read from the exact occurrence
   `value_json.providerSearchIntent` and keeps its Snapshot/Observation lineage;
3. legacy governed intent is labeled `governed_legacy` rather than fabricated
   as provider/user authority;
4. absent sources yield `unavailable`, not an inferred classification;
5. pinned generations never read a newer provider observation or decision;
6. KD still comes only from the exact `/valueJson/keywordDifficulty` pointer.

The contract reserves `llm_generated`, but Task 2 must not emit that authority
from an invocation-less row. Runtime LLM fallback and its precedence below
provider facts are added only after Tasks 3-5 introduce the durable invocation
FK and generated-decision path. This keeps Task 2 independently truthful rather
than fabricating model lineage before the schema exists.

Run:

```bash
pnpm exec vitest run --project unit \
  apps/web/src/lib/services/growth-map-keywords.test.ts
```

Expected RED: keyword projection has no separate resolver or field.

**Step 4: Implement the read resolver.**

Resolve the field from the exact live or frozen rows already loaded by the
service. Do not introduce a second unpinned query. Preserve existing integrity
and limitation checks.

**Step 5: Verify authority and service.**

```bash
pnpm contracts:generate
node scripts/generate-spec-v0.4-lock.mjs
pnpm contracts:check
pnpm openapi:lint
pnpm verify:authority
pnpm verify:spec
pnpm exec vitest run --project unit \
  packages/contracts/src/keyword-library-openapi.test.ts \
  apps/web/src/lib/services/growth-map-keywords.test.ts
git diff --check
```

## Task 3: Add durable Topic-generation and invocation lineage schema

**Files:**

- Create: `packages/db/migrations/0048_topic_model_generation.sql`
- Modify: `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md`
- Modify: `authority/implementation-spec-v0.4/openapi.yaml`
- Modify: `authority/implementation-spec-v0.4/schema.sql`
- Modify: `authority/implementation-spec-v0.4/scripts/schema-smoke.sql`
- Modify: `packages/db/migrations/schema-smoke.sql`
- Regenerate: `scripts/spec-v0.4-lock.json`
- Modify: `scripts/verify-implementation.mjs`
- Modify: `openapi/mvp.yaml`
- Modify: `packages/artifacts/src/types.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/migrate-check.ts`
- Modify: `packages/db/src/migration-version.test.ts`
- Modify: `packages/db/src/repositories/async-runs.ts`
- Modify: `packages/db/src/repositories/analysis-invocations.ts`
- Modify: `packages/db/src/repositories/analysis-refresh-runs.test.ts`
- Modify: `packages/db/src/repositories/analysis-refresh-runs.ts`
- Modify: `packages/db/src/repositories/growth-map.test.ts`
- Modify: `packages/db/src/repositories/growth-map.ts`
- Modify: `packages/contracts/src/openapi-discriminators.test.ts`
- Create: `packages/db/src/repositories/topic-model-generation-runs.ts`
- Create: `packages/db/src/repositories/topic-model-generation-runs.test.ts`
- Create:
  `packages/db/src/repositories/topic-model-generation-invocation-attempts.ts`
- Create:
  `packages/db/src/repositories/topic-model-generation-invocation-attempts.test.ts`
- Create:
  `packages/db/src/__tests__/topic-model-generation-runs.integration.test.ts`
- Modify: `packages/db/src/index.ts`

**Step 1: Add authority/schema RED assertions.**

Specify Analysis Refresh plan v3 and a new optional `topic_model` step before
`growth_audit`. Specify `topic_model_generation` as an internal async-run kind,
`topic_model_generation_run` as its resource type, and
`topic_model_generation` as an AnalysisInvocation task.

This child is deliberate rather than a reuse of the current pre-freeze
auto-governance hook: `runAnalysisRefresh` executes that hook inside a database
transaction, while a provider/model network call must run outside every
transaction and needs durable reservation/recovery. Do not put the LLM call in
the existing hook. Before adding the kind, prove in RED tests that no existing
async kind can truthfully own a Topic-generation resource or its
outcome-unknown reservation.

Add migration/version tests for:

- one resource row sharing the child `async_runs.id`;
- immutable workspace/project/parent-refresh/input-manifest/input-hash fields;
- terminal status/result accounting without raw prompt/output storage;
- one durable invocation-attempt ledger with reservation, finalization,
  `outcome_unknown`, budget, and configuration fencing;
- nullable `keyword_review_decisions.analysis_invocation_id` FK;
- a constraint that generated fallback intent requires a successful matching
  Topic-generation invocation while deterministic/provider/user decisions do
  not fake one;
- privileges revoked from `anon` and `authenticated`;
- Analysis Refresh plan manifest/hash/ordinal/step constraints updated to v3.
- published-generation readers accept the exact v3 manifest while retaining
  exact v1/v2 readability and ordering; no historical run is rewritten or
  reclassified;
- recovery, RunKind/result discriminators, health/queue routing, table and
  routine inventories, and Growth Map publishability tests cover the new
  internal child explicitly.

Run:

```bash
pnpm exec vitest run --project unit \
  packages/db/src/migration-version.test.ts \
  packages/contracts/src/openapi-discriminators.test.ts \
  packages/db/src/repositories/topic-model-generation-runs.test.ts
```

Expected RED: migration, enum, repository, and plan v3 do not exist.

**Step 2: Implement the ordered migration and repository.**

Follow the Product Profile invocation-attempt transition pattern. Store only a
bounded frozen manifest and hashes, never full provider payloads or model text.
Expose repository methods for create/get, reserve, finalize, mark outcome
unknown, and terminalize with exact run attempt fencing.

**Step 3: Update the authority bundle atomically.**

Append migration `0047` verbatim to canonical `schema.sql`; update table/index/
trigger/function inventories and exact Analysis Refresh plan v3 constraints;
regenerate contract output and the spec lock rather than hand-editing hashes.
Update every v1/v2/v3 manifest consumer found by `rg`, including Growth Map
published-generation selection. Add regression fixtures proving existing v1
and v2 runs remain readable and the v3 Topic step cannot change frozen facts.

**Step 4: Prove the SQL on disposable PostgreSQL.**

Use a loopback disposable database named for this task. Run the integration
test and migration/smoke commands. Expected behaviors include idempotent second
migration, illegal transition rejection, stale attempt rejection, FK rejection,
and rollback leaving no half-confirmed result.

```bash
DATABASE_URL="$SIGNALFRAME_TOPIC_TEST_DATABASE_URL" \
  pnpm test:integration -- \
  packages/db/src/__tests__/topic-model-generation-runs.integration.test.ts
DATABASE_URL="$SIGNALFRAME_TOPIC_TEST_DATABASE_URL" pnpm db:migrate:check
DATABASE_URL="$SIGNALFRAME_TOPIC_TEST_DATABASE_URL" pnpm db:smoke
git diff --check
```

If the task-specific database URL is unavailable, report this gate as
unverified; do not point tests at a hosted or non-disposable database.

## Task 4: Build the bounded structured Topic LLM client

**Files:**

- Create: `packages/artifacts/src/llm/topic-model-client.test.ts`
- Create: `packages/artifacts/src/llm/topic-model-client.ts`
- Modify: `packages/artifacts/src/index.ts`

**Step 1: Add client RED cases.**

Model input must contain only bounded canonical groups, representative keywords,
aggregate volume, provider-intent distribution, bounded URLs, market/language,
and already-authorized Product Profile/ICP facts. Tests must prove raw provider
responses, credentials, review bodies, arbitrary page content, actor IDs,
timestamps, and server-owned revision/UUID/hash fields are absent.

Output validation must reject:

- empty or multiple roots;
- duplicate topic keys/labels;
- depth beyond root plus one level;
- unknown or duplicate group assignments;
- excessive nodes/groups/labels;
- unrecognized intent values;
- client-authored IDs, revision, actor, timestamps, confirmation, or hashes.

Run:

```bash
pnpm exec vitest run --project unit \
  packages/artifacts/src/llm/topic-model-client.test.ts
```

Expected RED: module does not exist.

**Step 2: Implement deterministic input and strict result parsing.**

Mirror the Product Profile structured-client seam and injectable provider
transport. Canonicalize and hash input/output deterministically. Compile valid
output into server-consumable root/child intents and group assignments; allocate
no persistent IDs in this package.

**Step 3: Verify the package.**

```bash
pnpm exec vitest run --project unit \
  packages/artifacts/src/llm/topic-model-client.test.ts
pnpm --filter @sf/artifacts typecheck
git diff --check
```

## Task 5: Materialize and system-confirm the first Topic revision

**Files:**

- Create: `apps/worker/src/topic-model/run-topic-model-generation.test.ts`
- Create: `apps/worker/src/topic-model/run-topic-model-generation.ts`
- Create: `packages/contracts/src/zod/topic-model-generation.ts`
- Create: `packages/contracts/src/zod/topic-model-generation.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/repositories/topic-model-generation-runs.test.ts`
- Modify: `packages/db/src/repositories/topic-model-generation-runs.ts`
- Modify: `packages/db/src/__tests__/topic-model-generation-runs.integration.test.ts`
- Modify: `packages/db/src/repositories/topic-models.test.ts`
- Modify: `packages/db/src/repositories/topic-models.ts`
- Modify: `packages/db/src/repositories/keyword-governance.test.ts`
- Modify: `packages/db/src/repositories/keyword-governance.ts`
- Modify: `packages/db/src/index.ts`
- Create:
  `apps/worker/src/topic-model/__tests__/run-topic-model-generation.integration.test.ts`

**Step 1: Add worker/repository RED cases.**

Cover:

- no confirmed model + no draft + eligible evidence creates revision 1;
- the root and child nodes come from validated model output with repository-owned
  UUIDs;
- confirmation records `system_auto`, the exact nine-key generation basis,
  input hash, prompt-set version, successful invocation ID, frozen
  keyword/group coverage, and its fixed server-owned reason;
  assigned/skipped/unassigned coverage and explicit limitations are derived
  from the exact revision's append-only decisions plus durable run outcome
  without mutating that basis;
- provider intent is used before LLM fallback;
- every generated fallback decision carries the invocation ID;
- keyword assignments target the exact new confirmed Topic revision;
- user decisions, moved keyword revisions, unknown groups, and conflicts are
  skipped and accounted for;
- an existing confirmed model or draft, including one appearing after input
  freeze, produces a safe no-op and no model write;
- invalid/rejected/provider-failed model calls create no draft, confirmation, or
  assignment;
- a crash after provider return marks outcome unknown and never silently repeats
  the call.

Run:

```bash
pnpm exec vitest run --project unit \
  packages/db/src/repositories/topic-models.test.ts \
  packages/db/src/repositories/keyword-governance.test.ts \
  apps/worker/src/topic-model/run-topic-model-generation.test.ts
```

Expected RED: no worker and no topic-aware system-assignment contract exist.

**Step 2: Add explicit system-confirm metadata.**

Extend repository-owned response metadata without accepting confirmation mode,
provenance, actor, UUID, revision, or timestamps from public clients. Legacy
confirmed rows map to a truthful legacy/user mode; they are never guessed as AI.

Define `topic-model-generation-input.v1` once as an internal strict Zod
contract shared by the parent orchestrator, child worker, durable-run
repository, and provenance reader. It is not a browser mutation contract. The
LLM projection omits keyword IDs, governance revisions, and exact provider
Snapshot/Observation lineage even though those facts remain frozen server-side.

**Step 3: Implement topic-aware system assignments.**

Add a separate internal `applyGeneratedTopicAssignments` path with an exact
confirmed `topicNodeId/topicModelRevision` pair and the successful model
invocation for generated fallback intent. Reuse only the low-level advisory
lock, confirmed-topic validation, append-only decision insertion, and
human-decision skip rules. Do **not** widen or change the meaning of the current
evidence-only `applySystemApprovals` path: it remains classification-free,
Topic-free, and invocation-free. Generated assignments may use the existing
truthful `system_suggestion` decision origin only if contract tests keep it
visibly distinct from human review. Never overwrite a human decision.

**Step 4: Implement the network-free/network/post-call transaction phases.**

Freeze and reserve in a short transaction, call the injected structured client
outside every DB transaction, finalize the immutable invocation, then create,
confirm, and assign in one transaction guarded by the existing per-project Topic
writer lock.

**Step 5: Verify with disposable PostgreSQL.**

```bash
DATABASE_URL="$SIGNALFRAME_TOPIC_TEST_DATABASE_URL" \
  pnpm test:integration -- \
  apps/worker/src/topic-model/__tests__/run-topic-model-generation.integration.test.ts
git diff --check
```

## Task 6: Orchestrate Analysis Refresh plan v3

**Files:**

- Modify: `packages/db/src/queue.test.ts`
- Modify: `packages/db/src/queue.ts`
- Modify: `apps/worker/src/analysis-refresh/run-analysis-refresh.test.ts`
- Modify: `apps/worker/src/analysis-refresh/run-analysis-refresh.ts`
- Modify: `apps/worker/src/analysis-refresh/payload.ts`
- Modify: `apps/worker/src/analysis-refresh/notify-parent.test.ts`
- Modify: `apps/worker/src/analysis-refresh/notify-parent.ts`
- Modify: `apps/worker/src/health-snapshot.test.ts`
- Modify: `apps/worker/src/health-snapshot.ts`
- Modify: `apps/worker/src/handlers/handlers-registration.test.ts`
- Modify: `apps/worker/src/handlers/recovery.test.ts`
- Modify: `apps/worker/src/handlers/recovery.ts`
- Modify: `apps/worker/src/handlers/index.ts`
- Create: `apps/worker/src/handlers/topic-model-generation.test.ts`
- Create: `apps/worker/src/handlers/topic-model-generation.ts`
- Modify: `apps/worker/src/index.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/web/src/lib/services/__tests__/analysis-refresh.integration.test.ts`
- Modify: `apps/web/src/lib/services/__tests__/published-growth-map-fixture.ts`
- Modify: `packages/db/src/repositories/growth-map.test.ts`
- Modify: `packages/db/src/repositories/growth-map.ts`
- Modify: `e2e/analysis-refresh.real.integration.vitest.ts`

**Step 1: Add orchestration RED cases.**

Assert the exact plan:

```text
crawl -> gsc -> ga4 -> dataforseo -> dataforseo_backlinks
      -> topic_model -> growth_audit
```

The Topic step is optional and must:

- skip without child creation for existing confirmed, existing draft, or
  insufficient evidence;
- enqueue exactly one internal child otherwise;
- mark the parent partial with a durable limitation when the child fails;
- allow Growth Audit to continue on that optional failure;
- never hold the parent transaction across the model call;
- recover queued/stale child runs through the correct queue and notify the
  exact parent step with attempt fencing.

Run:

```bash
pnpm exec vitest run --project unit \
  apps/worker/src/analysis-refresh/run-analysis-refresh.test.ts \
  apps/worker/src/analysis-refresh/notify-parent.test.ts \
  apps/worker/src/handlers/recovery.test.ts
```

Expected RED: plan v2 has no Topic step or queue.

**Step 2: Implement child creation, queueing, parent observation, and recovery.**

Use the server-frozen request payload only. Do not expose a new browser command
for raw provider/model options. Keep retry behavior consistent with the durable
invocation-attempt ledger.

**Step 3: Extend the real-chain fake-model test.**

Inject a deterministic fake structured client and keep all live network calls
disabled. Prove the first refresh gets a confirmed model before Growth Audit
freezes governance, and a second refresh skips generation without another model
call.

```bash
DATABASE_URL="$SIGNALFRAME_TOPIC_E2E_DATABASE_URL" \
  pnpm exec vitest run --project integration \
  e2e/analysis-refresh.real.integration.vitest.ts
git diff --check
```

## Task 7: Expose Topic generation/confirmation provenance in the workspace

**Files:**

- Modify: `authority/implementation-spec-v0.4/openapi.yaml`
- Modify: `openapi/mvp.yaml`
- Modify: `packages/contracts/src/zod/keyword-governance.ts`
- Modify: `packages/contracts/src/zod/growth-map.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `packages/contracts/src/keyword-library-openapi.test.ts`
- Modify: `packages/contracts/src/topic-model-openapi.test.ts`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Modify: `packages/db/src/repositories/topic-models.test.ts`
- Modify: `packages/db/src/repositories/topic-models.ts`
- Modify: `apps/web/src/lib/services/growth-map-topic-model.test.ts`
- Modify: `apps/web/src/lib/services/growth-map-topic-model.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.test.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.test.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.ts`
- Modify:
  `apps/web/src/app/api/mvp/projects/[projectId]/audit/topic-model/route.test.ts`

**Step 1: Add contract/service RED cases.**

The confirmed workspace must expose a typed, read-only generation summary:

- `confirmationMode: system_auto | user | legacy`;
- origin/generation version;
- successful invocation ID only for model-generated rows;
- prompt set, input hash, generated time;
- keyword/group/assigned/unassigned/skipped counts;
- explicit limitations.

Draft mutation requests must reject these server-owned fields.

`confirmedBy` is the actual confirmation actor: it is the server-resolved user
for a user confirmation and is `null` for `system_auto`. The initiating actor
for an automatic run remains the structural server-owned `createdBy` fact; it
must never be copied into `confirmedBy` or presented as proof of manual review.
`confirmationMode` is derived from validated server-authored generation
provenance across repository, service, hook, and UI layers. It is never
accepted from a public mutation.

For `system_auto`, derive `assignedCount` from append-only decisions matching
the exact generation invocation and Topic revision. Derive skipped keywords
and unassigned groups by comparing those decisions with the exact bounded
keyword/group inventory frozen in that generation run; require the durable run
to point to the same confirmed revision. Strict-parse the metadata-only durable
outcome stored on the child async run and cross-check its counts and reason
codes against those exact facts; never trust that progress object alone.
Missing or inconsistent outcome metadata fails closed or emits an explicit
conservative limitation. Do not persist or guess these mutable outcome counts
in the immutable nine-key generation basis.

**Step 2: Implement strict legacy and generated parsing.**

Parse `generation_basis` fail closed. Do not call a malformed generated row a
human confirmation or silently omit required invocation lineage.

Expose the exact `topicModelRevision` alongside every non-null Keyword Topic
reference. A pinned Keyword projection may join a Topic workspace/insight row
only when both the stable Topic Node ID and that revision match; a still-active
node in a newer model is not proof that the historical assignment belongs to
the newer revision.

**Step 3: Verify contract and service.**

```bash
pnpm contracts:generate
pnpm contracts:check
pnpm exec vitest run --project unit \
  packages/contracts/src/topic-model-openapi.test.ts \
  packages/db/src/repositories/topic-models.test.ts \
  apps/web/src/lib/services/growth-map-topic-model.test.ts
git diff --check
```

## Task 8: Match the Artifact Keyword/Topic workspace with real facts

**Files:**

- Modify:
  `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts`
- Modify:
  `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.test.tsx`
  if present, otherwise add the narrowest adjacent component/source test
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/growth-map.module.css`
- Modify: `packages/i18n/src/messages/zh-CN.json`
- Modify: `packages/i18n/src/messages/en.json`
- Modify: `packages/i18n/src/__tests__/parity.test.ts`
- Modify: `e2e/mock-api.ts`
- Modify: `e2e/growth-map.mock.spec.ts`

**Step 1: Add Keyword UI RED cases.**

Assert:

- Topic status/gateway appears above the keyword master-detail workspace;
- pending, generated/system-confirmed, user-confirmed, failed, and unavailable
  states are distinct;
- the table shows Topic, resolved search intent plus authority badge, search
  volume, KD, rank/URL, source, freshness, and review state;
- unavailable KD/intent renders an explanation, never `0` or a guessed label;
- the detail rail shows Topic -> mapped page -> CTA and same-topic demand;
- `调整 Topic` and Keyword review continue through confirmed authority and the
  existing explicit conflict-confirmation flow.

Run the narrow unit/component tests and:

```bash
pnpm exec playwright test --config=playwright.mock.config.ts \
  e2e/growth-map.mock.spec.ts
```

Expected RED: automation provenance and Artifact-level Topic composition are not
visible.

**Step 2: Implement the minimal UI composition.**

Reuse `TopicMapGateway`, `TopicMapDialog`, `KeywordDetailPanel`, and
`KeywordReviewDialog`. Do not fork a second governance editor or recompute
server-owned facts in the component.

**Step 3: Verify accessibility, locale parity, and responsive behavior.**

Prove keyboard tab/selection/dialog behavior, accessible labels, no horizontal
overflow at the supported compact viewport, and Chinese/English key parity.

## Task 9: Reconcile and restore Pages URL/Topic/Opportunity views safely

**Files:**

- Modify:
  `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts`
- Modify:
  `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/growth-map.module.css`
- Modify: `packages/i18n/src/messages/zh-CN.json`
- Modify: `packages/i18n/src/messages/en.json`
- Modify: `e2e/mock-api.ts`
- Modify: `e2e/growth-map.mock.spec.ts`
- Modify: `e2e/growth-map.real.spec.ts`

**Step 1: Add routing and complete-inventory RED cases.**

First inventory the current production components: complete URL/opportunity
cursor readers and legacy-parameter cleanup already exist, while the visible
three-way page-view switch and first-class confirmed-Topic cluster rail were
removed. Reuse the former; replace only the tests that intentionally lock out
the latter. Do not rebuild existing collectors or confuse dead-parameter
scrubbing with an already-shipped cluster view.

Reintroduce canonical `view=url | cluster | opportunity`, with `opportunity` as
the default. Preserve exact deep links for selected URL, Topic, opportunity,
and finding while scrubbing hidden state from other views.

Assert cluster aggregation only completes after all opaque cursor pages for URL,
keyword, opportunity, and confirmed Topic inventories share the same diagnostic
run and Topic revision. Any cursor/run/revision drift must fail closed.

**Step 2: Implement view-model aggregation.**

Build stable Topic rows from the exact confirmed Topic revision and complete
inventories. Compute page membership, same-topic demand, search-volume totals,
coverage gaps, primary CTA, and highest-priority opportunity without relying on
the current cursor page or legacy URL DTO labels alone.

**Step 3: Compose the Artifact shell.**

Restore `按 URL / 按主题簇 / 按机会`, default `按机会`, with master-detail rails and
Topic -> page -> CTA handoff. Match the approved Artifact spacing, hierarchy,
and states while retaining production accessibility and error semantics.

**Step 4: Verify deep links and real route behavior.**

Run view-model/unit tests, mock Playwright, then the narrow real-browser Growth
Map test against the disposable fixture. No production endpoint is used.

## Task 10: Add truthful recollection state and safe trigger

**Files:**

- Modify: `authority/implementation-spec-v0.4/openapi.yaml`
- Modify: `openapi/mvp.yaml`
- Modify: `packages/contracts/src/zod/growth-map.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `packages/contracts/src/keyword-library-openapi.test.ts`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Modify: `scripts/verify-implementation.mjs`
- Modify: `apps/web/src/lib/services/growth-map-keywords.test.ts`
- Modify: `apps/web/src/lib/services/growth-map-keywords.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.test.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `packages/i18n/src/messages/zh-CN.json`
- Modify: `packages/i18n/src/messages/en.json`
- Modify: `e2e/growth-map-run.mock.spec.ts`

**Step 1: Add stale-source RED cases.**

An old DataForSEO observation lacking KD/provider intent must remain immutable
and show `需要重新采集`. A pinned published generation must remain unchanged
after newer collection. The action must reuse the existing server-owned
Analysis Refresh command and accept no provider credentials, budget, endpoint,
or arbitrary source options from the client.

**Step 2: Implement status and command handoff.**

Expose one narrow read-only recommendation only for historical DataForSEO
Observations that lack the newly captured keys:

```text
recollection:
  reason = historical_dataforseo_observation_missing_fields
  fields = keyword_difficulty | provider_search_intent
```

An explicitly present provider `null` is not historical absence and must not
set this recommendation. Render the exact reason and expected effect, then link
to the existing server-owned Analysis Refresh control rather than creating a
second provider command. Keep paid-call execution outside local verification
and outside this implementation authorization.

**Step 3: Verify with mocked collection only.**

Run service/unit and mock run tests. Assert no live provider transport is
constructed.

## Task 11: Full verification and acceptance matrix

**Files:**

- Modify: `docs/plans/2026-08-09-growth-map-topic-metrics-implementation.md`
  only to append factual verification results
- Modify only if required by repository consistency checks:
  `docs/PROGRESS.md`, `docs/INFRASTRUCTURE.md`

**Step 1: Inspect the complete diff.**

```bash
git status --short
git diff --stat
git diff --check
git diff -- authority/implementation-spec-v0.4 openapi/mvp.yaml \
  packages/db/migrations packages/sources packages/artifacts \
  packages/contracts apps/worker apps/web e2e packages/i18n
```

Every changed line must trace to this plan. Remove only unused code introduced
by these tasks; do not clean unrelated code.

**Step 2: Run authority and generated-source gates.**

```bash
pnpm verify:docs
pnpm verify:authority
pnpm verify:spec
pnpm verify:spec:test
pnpm implementation:check
pnpm contracts:check
pnpm openapi:lint
pnpm deploy:check
```

**Step 3: Run static and unit gates.**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

**Step 4: Run disposable-PostgreSQL gates.**

```bash
DATABASE_URL="$SIGNALFRAME_TOPIC_TEST_DATABASE_URL" pnpm db:migrate:check
DATABASE_URL="$SIGNALFRAME_TOPIC_TEST_DATABASE_URL" pnpm db:smoke
DATABASE_URL="$SIGNALFRAME_TOPIC_TEST_DATABASE_URL" pnpm test:integration
```

**Step 5: Run browser and Artifact gates.**

```bash
pnpm test:e2e:artifact
pnpm test:e2e:mock
DATABASE_URL="$SIGNALFRAME_TOPIC_E2E_DATABASE_URL" pnpm test:e2e:real
```

**Step 6: Run security and external-effect checks.**

- Verify live network is disabled in every deterministic LLM/Analysis Refresh
  test.
- Scan the diff for credentials, raw prompt/output text, `.env`, `.vercel`, and
  provider payload fixtures containing customer data.
- Verify no provider request, hosted migration, GitHub write, commit, push, PR,
  deployment, or production mutation occurred.

**Step 7: Record the acceptance matrix.**

Report each requirement as `completed`, `partial`, `deferred`, or `unverified`
with the exact command/evidence. A green UI test cannot substitute for absent
provider data, and passing fake tests cannot substitute for real PostgreSQL.
Do not claim completion while any required gate is skipped or stale.

## Final verification snapshot (2026-08-09)

- `completed` DataForSEO KD and provider-intent truthfulness. The direct and
  composite adapters retain `keyword_difficulty` and `main_intent`; KD `0` is
  retained, absent values are explicit `null`, and malformed present values
  fail closed. Focused source tests and typecheck are green, and the real
  PostgreSQL diagnostic chain consumes the same canonical shape.

- `completed` search-intent authority and historical recollection semantics.
  The exact precedence is user-confirmed, provider-observed, invocation-backed
  LLM, governed legacy, then unavailable. Frozen and live reads preserve exact
  revisions and observation lineage. Historical provider rows that genuinely
  predate the two fields receive a read-only recollection recommendation;
  explicit provider `null` does not.

- `completed` durable Topic generation, first system confirmation, later human
  adjustment, attempt fencing, outcome-unknown handling, and the
  network-outside-transaction boundary. Focused real PostgreSQL evidence is
  green: Topic worker `7/7`, Topic persistence `9/9`, auto-governance `4/4`,
  Growth Map repository `2/2`, diagnostic `24/24`, Analysis Refresh real chain
  `2/2`, and web Analysis Refresh `3/3`.

- `completed` Artifact-facing Growth Map structure and interaction boundary.
  The formal UI has URL, Topic-cluster, and Opportunity views; defaults to
  Opportunity; exposes Topic/KD/search-intent authority/recollection; and uses
  exact Diagnostic Run and Topic revision joins. This is a structural,
  interaction, and data-authority reproduction of the approved Artifact, not a
  claim of literal pixel identity.

- `completed` authority, OpenAPI, generated source, migration, and documentation
  consistency. `pnpm verify:docs`, `pnpm verify:authority`,
  `pnpm verify:spec`, `pnpm verify:spec:test`,
  `pnpm implementation:check`, `pnpm contracts:check`,
  `pnpm openapi:lint`, and `pnpm deploy:check` are green. The authority inventory
  is 79 operations, 10 async kinds, 80 tables, 12 rules, and 48 migrations.

- `completed` full automated verification. Unit tests are `651 files / 8335
  tests`; disposable-real-PostgreSQL integration tests are `88 files / 624
  tests`; the production build is green for Marketing and Web; Artifact browser
  tests are `20/20`; mock browser tests are `214/214`; and canonical real browser
  segments are `42/42`, AC-044 `1/1`, and AC-045 `1/1`.

- `completed` disposable database verification. Applying migrations twice is
  idempotent with zero additional migrations on each check; migration inventory
  is 80 app tables, 109 indexes, 156 triggers, and 79 routines; schema smoke
  completed inside its rollback boundary.

- `completed` final static, hygiene, and security gates. `pnpm typecheck`,
  `pnpm lint`, and `git diff --check` are green. `pnpm secrets:scan` reports no
  credentials or secret values, and its four redaction suites are `75/75`.

- `partial` exact Topic-generation-failed gateway state. The truthful public read
  contract exposes confirmed Topic, draft, and read failure, but does not expose
  the exact server-owned Topic child failure. The UI links to the existing run
  diagnosis and does not infer a failure from missing confirmation.

- `partial` CTA in the Topic-to-page conversion rail. The current formal DTO has
  no authoritative CTA field, so the rail marks CTA unavailable with an explicit
  limitation rather than substituting buyer stage or Opportunity output.

- `unverified` live production provider/LLM values. No paid DataForSEO request,
  hosted LLM call, or production-data recollection was authorized or performed;
  deterministic/offline provider seams and production-shaped real-PostgreSQL
  fixtures verify the implementation boundary without claiming live values.

- `completed` external-effect safety. No hosted database write, commit, push,
  PR, deployment, or production mutation occurred in this worktree session.
