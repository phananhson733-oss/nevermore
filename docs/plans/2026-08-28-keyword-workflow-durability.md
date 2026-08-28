# Keyword Opportunity Workflow Durability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the paid Keyword Opportunity Map pipeline into caller-bound Vercel Workflow steps that survive reloads and process termination while preserving the v3 evidence contract, old-client compatibility and honest persistence/cost semantics.

**Architecture:** Keep stage-one crawl/confirmation synchronous. The versioned stage-two client starts a Marketing-only Workflow and polls it with a sealed identity-bound run token; legacy callers without the workflow header retain the current synchronous 200 path. Paid facts are frozen in separate steps, with one SERP keyword per step and at most ten concurrent calls; no database, Worker or Product surface is added.

**Tech Stack:** TypeScript strict, Next.js 16.2/Turbopack, React 19, `workflow@4.8.5`, `@workflow/vitest`, Vitest 4, Playwright 1.61, existing AES-GCM sealed-token/auth/GSC/provider seams.

---

### Task 1: Install and prove the Workflow compiler boundary

**Files:**
- Modify: `apps/marketing/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/marketing/next.config.ts`
- Modify: `apps/marketing/next.config.test.ts`
- Modify: `apps/marketing/src/proxy.test.ts`

**Step 1: Freeze the pre-integration build evidence**

Run the current Marketing build and prove it has no Workflow-generated internal
route yet. Configuration is the TDD skill's explicit exception; the Owner has
authorized this configuration change, and the production build is its primary
behavioral verifier.

Add regression assertions that:

- the exported config retains all Marketing redirects after wrapping;
- the proxy passes `/.well-known/workflow/v1/flow` through without locale
  rewrite or redirect;
- no customer API route is broadened by the matcher change.

**Step 2: Run the regression baseline**

```bash
pnpm exec vitest run --project unit apps/marketing/next.config.test.ts apps/marketing/src/proxy.test.ts
```

Expected: existing proxy/redirect behavior passes; the pre-integration build
evidence shows no registered Workflow route.

**Step 3: Add pinned dependencies**

```bash
pnpm --filter @sf/marketing add workflow@4.8.5
pnpm --filter @sf/marketing add --save-dev @workflow/vitest@4.0.21
```

Read the installed version's complete bundled docs before using any API:

```bash
rg --files node_modules | rg '/workflow/docs/.*\.mdx$'
```

Open the exact stable docs for Next.js, `start`, `getRun`, hooks,
serialization, errors and Vitest. If the package layout differs, locate the
same resources under pnpm's package directory rather than guessing from v5
main-branch docs.

**Step 4: Wrap Next config**

Compose `withWorkflow(withNextIntl(nextConfig))`. Preserve `output:
"standalone"`, `turbopack.root`, `outputFileTracingRoot`, redirects, rewrites
and security headers.

Keep the existing proxy matcher if the test proves its dot exclusion already
bypasses `.well-known`; do not rewrite a correct regex merely for appearance.

**Step 5: Run GREEN and build**

```bash
pnpm exec vitest run --project unit apps/marketing/next.config.test.ts apps/marketing/src/proxy.test.ts
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing build
```

Expected: tests and Workflow-aware production build pass, and the build emits
the Workflow internal route.

**Step 6: Commit**

```bash
git add apps/marketing/package.json apps/marketing/next.config.ts apps/marketing/next.config.test.ts apps/marketing/src/proxy.test.ts pnpm-lock.yaml
git commit -m "build(marketing): enable vercel workflow"
```

### Task 2: Freeze persistence, sealed-token and public async contracts

**Files:**
- Modify: `packages/public-tools/src/contract.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/types.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.test.ts`
- Modify: `apps/marketing/src/lib/auth/sealed-cookie.ts`
- Modify: `apps/marketing/src/lib/auth/sealed-cookie.test.ts`
- Create: `apps/marketing/src/lib/tools/keyword-workflow-contract.ts`
- Create: `apps/marketing/src/lib/tools/keyword-workflow-contract.test.ts`

**Step 1: Write failing persistence tests**

Assert:

- the legacy synchronous keyword payload remains `persistence: "none"`;
- the durable builder can emit `persistence: "workflow_managed"`;
- every other public-tool helper still defaults to `none`;
- an arbitrary unsupported persistence value is not assignable.

**Step 2: Write failing token tests**

Add distinct sealed purposes for:

```text
gg_kw_workflow_input
gg_kw_workflow_grant
gg_kw_workflow_run
```

Prove cross-purpose replay, tampering, expiry and wrong root keys fail closed.
The run token schema must reject a missing/wrong version, empty run id, empty
subject and expired token.

**Step 3: Write failing async-contract tests**

Define and validate:

```ts
type KeywordWorkflowStartInput = {
  contextToken: string;
  requestId: string;
};

type KeywordWorkflowStartResponse = {
  data: { status: "running"; runToken: string };
};

type KeywordWorkflowStatusInput = { runToken: string };
```

Also define bounded running, redirect and completed responses plus the two new
stable error codes `keyword_run_unavailable` and `keyword_run_cancelled`.

Test same-origin validation, UUID/body bounds, `no-store, private` headers and
that no DTO exposes a raw Workflow run id.

**Step 4: Run RED**

```bash
pnpm exec vitest run --project unit packages/public-tools/src/keyword-opportunity/report.test.ts apps/marketing/src/lib/auth/sealed-cookie.test.ts apps/marketing/src/lib/tools/keyword-workflow-contract.test.ts
```

Expected: missing literals, purposes and parsers.

**Step 5: Implement the minimum contract**

Extend the generic persistence union, but keep `createPublicToolResult`
defaulting to `none`. Give the keyword payload builder an explicit optional
persistence argument whose default remains `none`.

Use allow-list parsing at every browser/system boundary. Never accept a raw
run id from the client.

**Step 6: Run GREEN and commit**

```bash
pnpm exec vitest run --project unit packages/public-tools/src/keyword-opportunity/report.test.ts apps/marketing/src/lib/auth/sealed-cookie.test.ts apps/marketing/src/lib/tools/keyword-workflow-contract.test.ts
git add packages/public-tools/src/contract.ts packages/public-tools/src/keyword-opportunity apps/marketing/src/lib/auth/sealed-cookie* apps/marketing/src/lib/tools/keyword-workflow-contract*
git commit -m "feat(marketing): define keyword workflow contract"
```

### Task 3: Extract shared deterministic pipeline stages

**Files:**
- Create: `apps/marketing/src/lib/tools/keyword-opportunity-stages.ts`
- Create: `apps/marketing/src/lib/tools/keyword-opportunity-stages.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`

**Step 1: Write failing stage tests**

Specify pure functions for:

- deduplicating/capping candidate drafts while retaining generated count;
- projecting provider validation and compact coverage into priced candidates;
- normalizing one returned/missing SERP sample;
- building interpretation indexes without accepting duplicate keys;
- deriving ordered organic-domain enrichment targets;
- assembling observations and the v3 report from serializable entry arrays;
- merging stage durations, unavailable-stage flags, LLM usage and cost deltas.

Cover all existing v3 facts: explicit zero, provider no-data, coverage
truncation, four SERP failure reasons, positive-plus-unavailable signals and
all four supporting-page sources.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/keyword-opportunity-stages.test.ts
```

Expected: module missing.

**Step 3: Implement pure functions only**

Accept/return plain readonly objects and arrays. Convert `Map` values only
inside a single function invocation; no `Map`, function, client, cookie jar,
AbortController or promise crosses a stage DTO.

**Step 4: Rewire the synchronous handler**

Replace copied inline transformations with the new helpers without changing
HTTP behavior, provider call order, cost logs or v3 payload bytes.

**Step 5: Run GREEN and compatibility suite**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/keyword-opportunity-stages.test.ts apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts packages/public-tools/src/keyword-opportunity/report.test.ts
```

Expected: all current sync-handler tests and new stage tests pass.

**Step 6: Commit**

```bash
git add apps/marketing/src/lib/tools/keyword-opportunity-stages* apps/marketing/src/lib/tools/keyword-opportunity-handler*
git commit -m "refactor(marketing): expose keyword pipeline stages"
```

### Task 4: Implement paid-safe Workflow steps

**Files:**
- Create: `apps/marketing/src/lib/tools/keyword-opportunity-workflow.ts`
- Create: `apps/marketing/src/lib/tools/keyword-opportunity-workflow.test.ts`
- Create: `apps/marketing/src/lib/tools/keyword-opportunity-workflow-runtime.ts`
- Create: `apps/marketing/src/lib/tools/keyword-opportunity-workflow-runtime.test.ts`
- Create: `apps/marketing/vitest.workflow.config.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-cost-guard.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-cost-guard.test.ts`

**Step 1: Write failing runtime tests**

Using injected offline seams, prove:

- candidate expansion and validation return frozen snapshots and cost/usage
  deltas;
- compact coverage emits only candidate records and never access tokens/full
  GSC rows;
- one SERP keyword calls the provider once and maps a thrown post-dispatch
  failure to `transport_outcome_unknown` without throwing;
- ten keyword-step promises are the maximum concurrent wave;
- interpretation failure returns unavailable interpretation, preserving SERP
  facts;
- rank, traffic and RDAP snapshots use ordered entries and null honestly;
- assembly performs no external call and emits `workflow_managed`.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/keyword-opportunity-workflow-runtime.test.ts apps/marketing/src/lib/tools/keyword-cost-guard.test.ts
```

Expected: workflow runtime and cost-delta APIs missing.

**Step 3: Implement effect functions with injected dependencies**

Keep direct effect functions free of Workflow directives so unit tests drive
real orchestration logic. Every paid effect catches known transport/provider
errors and returns a typed outcome rather than exposing the step to an unsafe
automatic retry.

Add pure cost-delta snapshot/merge helpers; do not revive the dormant daily or
per-run admission caps.

**Step 4: Write failing workflow-orchestration tests**

With the official Vitest plugin, assert:

- deterministic hook conflict returns `redirect` before paid effects;
- successful flow checkpoints all stages and returns a v3 envelope;
- a fault after several completed SERP keyword steps resumes without invoking
  those completed steps again;
- a terminal candidate/validation failure returns its stable code;
- workflow output and attributes contain no subject, cookie, token, URL,
  keyword list or provider body beyond the encrypted input and intended
  persisted step results.

**Step 5: Run RED**

```bash
pnpm exec vitest run --config apps/marketing/vitest.workflow.config.ts
```

Expected: workflow function/config missing.

**Step 6: Add directive wrappers and workflow function**

Use `"use step"` functions only for wrappers around the tested effects. The
`"use workflow"` function performs deterministic orchestration, hook conflict
handling, at-most-ten SERP waves, interpretation chunks, parallel enrichments
and terminal assembly.

Do not claim exactly-once provider calls across the provider-success/process-
crash window; document and test the one-call risk boundary.

**Step 7: Run GREEN and commit**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/keyword-opportunity-workflow-runtime.test.ts apps/marketing/src/lib/tools/keyword-cost-guard.test.ts
pnpm exec vitest run --config apps/marketing/vitest.workflow.config.ts
git add apps/marketing/src/lib/tools/keyword-opportunity-workflow* apps/marketing/src/lib/tools/keyword-cost-guard* apps/marketing/vitest.workflow.config.ts
git commit -m "feat(marketing): run keyword map as durable steps"
```

### Task 5: Add authenticated start and status handlers

**Files:**
- Create: `apps/marketing/src/lib/tools/keyword-workflow-handler.ts`
- Create: `apps/marketing/src/lib/tools/keyword-workflow-handler.test.ts`
- Modify: `apps/marketing/src/app/api/tools/hidden-keywords/opportunities/route.ts`
- Create: `apps/marketing/src/app/api/tools/hidden-keywords/opportunities/status/route.ts`
- Create: `apps/marketing/src/app/api/tools/hidden-keywords/opportunities/status/route.test.ts`

**Step 1: Write failing start-handler tests**

Assert the exact order and boundary:

1. same-origin/auth/body validation;
2. context purpose/expiry/sub binding;
3. GSC gate before grant renewal;
4. encrypted workflow context/grant snapshots only;
5. `start()` with non-sensitive attributes;
6. identity-bound sealed run token;
7. gate release on success, refusal and exception;
8. `202`, `Retry-After: 2`, `no-store, private`.

Prove the workflow seam is not called for signed-out, foreign-token,
cross-origin, malformed, rate-limited, revoked or temporarily unavailable
requests.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/keyword-workflow-handler.test.ts
```

Expected: handler missing.

**Step 3: Implement version negotiation**

When `X-Keyword-Workflow-Version` equals `keyword_workflow.v1`, call the new
start handler. Otherwise call the unchanged synchronous handler and return its
legacy `200 + data.result` response.

The workflow branch reads current raw sealed grant cookies only after the
existing grant resolver has confirmed/renewed them; it never passes raw
credentials or identity to `start()`.

**Step 4: Write failing status tests**

Cover queued, running, completed, redirect, typed failed, SDK failed,
cancelled, missing, expired, tampered and foreign tokens. Foreign and absent
must be identical 404 responses. Every response must be private/no-store and
must omit raw run ids/errors/events.

**Step 5: Run RED, implement, run GREEN**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/keyword-workflow-handler.test.ts apps/marketing/src/app/api/tools/hidden-keywords/opportunities/status/route.test.ts
```

Expected after implementation: PASS.

**Step 6: Commit**

```bash
git add apps/marketing/src/lib/tools/keyword-workflow-handler* apps/marketing/src/app/api/tools/hidden-keywords/opportunities
git commit -m "feat(marketing): expose durable keyword run status"
```

### Task 6: Add tab-scoped client recovery and honest copy

**Files:**
- Create: `apps/marketing/src/lib/tools/keyword-workflow-client.ts`
- Create: `apps/marketing/src/lib/tools/keyword-workflow-client.test.ts`
- Modify: `apps/marketing/src/components/tools/keyword-map-tool.tsx`
- Create: `apps/marketing/src/components/tools/keyword-map-tool.test.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.tsx`
- Modify: `apps/marketing/src/components/tools/connected-tool-content.ts`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/lib/tools/keyword-map-messages.test.ts`

**Step 1: Write failing pure-client tests**

Test pointer parsing/version/expiry/property binding, storage getter/setter
failure, request-id reuse, start response normalization, status response
normalization, server Retry-After parsing and capped poll delay.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/keyword-workflow-client.test.ts
```

Expected: module missing.

**Step 3: Implement the pure client contract**

Use a versioned `sessionStorage` record. Storage failure is a degradation, not
a reason to block an in-memory run. Never place a run/context token in the URL,
analytics event or console.

**Step 4: Write failing component tests**

Drive the real component with fake fetch/storage/timers and assert:

- legacy 200 still renders immediately;
- 202 writes pointer and enters tracking;
- refresh pointer resumes one run without another paid request;
- start request lost before response reuses the same request id;
- redirect adopts the owner token;
- only one status poll is in flight;
- completed clears pointer and renders result;
- failed/cancelled/not-found retain valid confirmation context;
- unmount aborts polling;
- one stable live region announces restored/running/completed/failed states.

**Step 5: Run RED, wire the component, run GREEN**

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/keyword-map-tool.test.tsx apps/marketing/src/lib/tools/keyword-workflow-client.test.ts
```

Expected after implementation: PASS.

**Step 6: Correct persistence copy**

Replace keyword-tool-only claims of no server storage with the exact boundary:
read-only GSC, Workflow-managed checkpoints, no App project history and no
cross-run history UI. Update result/export comments that currently say nothing
is stored server-side.

Add messages for restoring/tracking, stable workflow errors and managed
persistence. Preserve EN/ZH parity.

**Step 7: Run copy/result tests and commit**

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/keyword-map-tool.test.tsx apps/marketing/src/components/tools/keyword-map-results.test.tsx apps/marketing/src/lib/tools/keyword-map-messages.test.ts
git add apps/marketing/src/lib/tools/keyword-workflow-client* apps/marketing/src/components/tools/keyword-map-tool* apps/marketing/src/components/tools/keyword-map-results.tsx apps/marketing/src/components/tools/connected-tool-content.ts apps/marketing/src/i18n/messages
git commit -m "feat(marketing): resume keyword workflow in the tab"
```

### Task 7: Extend hermetic browser and Workflow integration coverage

**Files:**
- Modify: `apps/marketing/e2e/low-competition-keywords.spec.ts`
- Modify: `apps/marketing/playwright.config.ts` only if Workflow Local World
  needs a test-only port/configuration
- Modify: `apps/marketing/vitest.workflow.config.ts`

**Step 1: Write failing E2E scenarios**

Mock only context/start/status and known shell endpoints. Cover:

- context 200 -> start 202 -> running -> completed result;
- page reload while tracking -> same run token -> completed;
- duplicate redirect adoption;
- terminal workflow failure retains confirmation context;
- legacy synchronous 200 result;
- audit JSON shows `workflow_managed` for durable completion.

Keep the server environment scrubbed with `env -i`, block all non-local browser
egress and abort every unexpected API request. No test may call GSC, an LLM,
DataForSEO, RDAP, Vercel production or a real Workflow World.

**Step 2: Run RED**

```bash
pnpm exec playwright test apps/marketing/e2e/low-competition-keywords.spec.ts --config apps/marketing/playwright.config.ts
```

Expected: old synchronous mock protocol does not satisfy async scenarios.

**Step 3: Implement minimum test wiring and run GREEN**

```bash
pnpm --filter @sf/marketing build
pnpm exec playwright test apps/marketing/e2e/low-competition-keywords.spec.ts --config apps/marketing/playwright.config.ts
pnpm exec vitest run --config apps/marketing/vitest.workflow.config.ts
```

Expected: all hermetic browser and Workflow integration cases pass.

**Step 4: Commit**

```bash
git add apps/marketing/e2e/low-competition-keywords.spec.ts apps/marketing/playwright.config.ts apps/marketing/vitest.workflow.config.ts
git commit -m "test(marketing): cover durable keyword workflow"
```

### Task 8: Security, correctness and release verification

**Files:**
- Verify only; modify only branch-caused failures.
- Persist: `docs/external-reviews/2026-08-28-keyword-workflow-verification.md`

**Step 1: Focused verification**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/auth/sealed-cookie.test.ts \
  apps/marketing/src/lib/tools/keyword-workflow-contract.test.ts \
  apps/marketing/src/lib/tools/keyword-opportunity-stages.test.ts \
  apps/marketing/src/lib/tools/keyword-opportunity-workflow-runtime.test.ts \
  apps/marketing/src/lib/tools/keyword-workflow-handler.test.ts \
  apps/marketing/src/lib/tools/keyword-workflow-client.test.ts \
  apps/marketing/src/components/tools/keyword-map-tool.test.tsx \
  apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts \
  packages/public-tools/src/keyword-opportunity/report.test.ts
pnpm exec vitest run --config apps/marketing/vitest.workflow.config.ts
pnpm exec playwright test apps/marketing/e2e/low-competition-keywords.spec.ts --config apps/marketing/playwright.config.ts
```

**Step 2: Dependency/security checks**

```bash
pnpm audit --prod
pnpm secrets:scan
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing build
```

Review:

- no secrets/customer data in attributes/logs;
- status ownership and foreign/absent equivalence;
- same-origin JSON-only mutation boundary;
- sessionStorage never enters URL/analytics;
- paid steps return typed outcomes rather than ordinary retryable errors;
- no DB, Worker, Product or environment-variable change.

**Step 3: Repository gates**

```bash
pnpm verify:docs
pnpm verify:authority
pnpm verify:spec
pnpm verify:spec:test
pnpm implementation:check
pnpm contracts:check
pnpm openapi:lint
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:mock
pnpm deploy:check
git diff --check
```

Prove every baseline failure against unchanged `origin/main`; never weaken a
gate or modify an unrelated failure merely to green the branch.

**Step 4: Independent reviews**

Request architecture/correctness, security/privacy/cost and UI/accessibility
reviews over `origin/main...HEAD`. Resolve every Critical/Important finding and
rerun affected gates.

**Step 5: Persist verification and commit**

Record exact commands, counts, known baseline exceptions, Workflow SDK/package
versions and the no-exactly-once limitation.

```bash
git add docs/external-reviews/2026-08-28-keyword-workflow-verification.md
git commit -m "docs(marketing): verify durable keyword workflow"
```

### Task 9: PR, production Workflow and canary

**Files:**
- Git/GitHub/Vercel state only.

**Step 1: Freeze release boundary**

Confirm the exact diff contains only Marketing, public-tools contracts,
lockfile and documentation. Confirm no migration, `apps/web`, Worker, Product
or production environment-variable edit.

**Step 2: Push and create the PR**

Push the reviewed branch, create a focused PR and wait for both Vercel previews.
Verify the Marketing preview build registers Workflow internal endpoints and
the Product preview contains no Product-source change.

**Step 3: Merge only the reviewed SHA**

After all checks and reviews pass, merge the exact head SHA. Verify GitHub
merge state and `origin/main` independently.

**Step 4: Verify Marketing production**

Wait for the exact merge SHA to become a READY Marketing production deployment
with `gengrowth.ai` and `www.gengrowth.ai` aliases. Verify:

- live page and new managed-persistence copy;
- signed-out start/status 401 boundaries without paid calls;
- browser console/page errors;
- Vercel Workflow health/registration and a non-sensitive deterministic
  Workflow run if an official no-provider test entrypoint exists;
- runtime error/fatal logs in the canary window.

Do not introduce a production provider bypass and do not run a paid live map.

**Step 5: Verify Product independently**

Record Product candidate status/SHA/aliases and the actual
`app.gengrowth.ai` deployment identity. A READY Product candidate is not proof
that the Product custom domain changed.

**Step 6: Complete the goal only after evidence audit**

Check every design requirement against source, tests, PR, deployment and live
runtime evidence. Mark complete only when the durable Workflow path is both
deployed and verified; otherwise report the exact remaining blocker.
