# Keyword Opportunity Workflow Durability Design

Date: 2026-08-28
Status: approved by Owner through explicit `授权 Workflow`
Baseline: `origin/main@b7ce298eefbc07e9ee769ce2e2f88eb93ff42f42`
Production predecessor: PR #236 / `bea97d9cb1e92bacc8cb63c482f0b7deedec6410`

## Objective

Make the paid half of the Marketing Low-Competition Keywords tool survive a
page reload, browser disconnect, function termination and deployment handoff
without turning provider gaps into negatives or replaying every completed paid
stage.

This release is authorized to add Vercel Workflow SDK/configuration and billed
Workflow Steps/Storage. It is not authorized to add a database migration,
`apps/web`, Railway Worker, Product writes, a saved App project, publishing, or
a new customer-history surface.

## Existing Boundary

Stage one remains the current synchronous site-context request:

```text
POST /api/tools/hidden-keywords/context
  -> authenticated bounded crawl
  -> user-visible proposition confirmation
  -> sealed gg_kw_context token
```

The current stage-two request performs candidate generation, validation, GSC
coverage, all-candidate SERP sampling, interpretation, enrichment and report
assembly in one 300-second function. Its evidence contract is already v3 and
must not change meaning merely because execution becomes durable.

## Considered Approaches

### A. One workflow with one coarse step

Wrap the existing stage-two handler in one `"use step"` function.

Rejected. It preserves the same 300-second failure unit. A retry after a crash
replays candidate generation, volume pricing, every completed SERP request and
all enrichments. It adds Workflow billing without delivering the requested
durability or cost isolation.

### B. Fine-grained Marketing Workflow with paid checkpoints

Keep request-bound authorization at the Marketing route. Start one workflow
whose paid facts are frozen at separate step boundaries; sample each SERP
keyword in its own step and run at most ten of those steps concurrently.

Selected. It keeps the current Marketing runtime and evidence contract, avoids
new database/Worker authority, and prevents a later failure from replaying
already completed steps. One provider call can still be repeated if the
provider succeeds and the hosting process dies before Workflow records that
single step's output; no current provider idempotency key can close that exact
crash window. The design limits the exposure to one call rather than an entire
run and never claims exactly-once provider billing.

### C. Canonical PostgreSQL + pg-boss run authority

Persist a public run row and provider-attempt fences in Supabase, enqueue work
to the Railway Worker, and reuse the Product async-run read model.

Rejected for this release. It provides the strongest exactly-once attempt
authority but requires migrations, Worker deployment and a new Product/state
boundary that the Owner did not authorize. It would also turn a Marketing
public tool into an `apps/web` dependency.

## Architecture

### Next.js integration

- Add stable `workflow@4.8.5` to `apps/marketing`.
- Wrap the existing Marketing Next config with `withWorkflow` from
  `workflow/next`, outside the existing `next-intl` wrapper.
- Retain the monorepo `outputFileTracingRoot` and Turbopack root.
- The existing proxy matcher already excludes any path containing a dot, so
  `/.well-known/workflow/**` bypasses locale middleware. Add a contract test so
  a future matcher cannot capture it.
- Do not add Workflow environment variables. Vercel's managed World is used in
  deployed environments; local tests use the Workflow Vitest integration.

### Request-bound start admission

The new client sends:

```json
{
  "contextToken": "sealed-stage-one-token",
  "requestId": "client-generated-uuid"
}
```

and the header:

```text
X-Keyword-Workflow-Version: keyword_workflow.v1
```

The route performs, before `start()`:

1. same-origin mutation check;
2. current `gg_id` authentication;
3. JSON/body-size and UUID validation;
4. `gg_kw_context` decryption and `token.sub === identity.sub` binding;
5. GSC per-IP admission and current grant resolution;
6. re-sealing the verified context and usable GSC grant into workflow-specific
   ciphertext with a 24-hour expiry;
7. creating a caller-bound run token after Workflow returns its opaque run id.

No raw access token, refresh token, property list, client IP or identity is
stored as plaintext Workflow metadata. Stable `workflow@4.8.5` exposes no run
attributes option, so this release writes no custom run metadata at all.

The start response is:

```text
202 Accepted
Cache-Control: no-store, private
Retry-After: 2

{
  "data": {
    "status": "running",
    "runToken": "sealed-run-owner-token"
  }
}
```

The sealed run token contains the Workflow run id, caller subject, purpose,
schema version and expiry. It is necessary but not sufficient to read a run:
the status route also requires the current identity cookie to name the same
subject. Tampered, foreign and absent tokens share one not-found response.

### Duplicate-start control

The browser creates `requestId` before the start request and retains it across
a lost response or page reload. The server derives a SHA-256 key from
`identity.sub + requestId` and passes only that digest to the workflow.

At the beginning of the workflow, a deterministic hook token owns that digest.
The workflow checks `hook.getConflict()` before paid work. A duplicate workflow
returns the active owner's run id and performs no provider or model call. The
status route converts that owner id into a new caller-bound run token, and the
client adopts it.

This closes duplicate clicks and lost-response retries before paid work. The
Workflow SDK does not currently offer atomic start-and-hook registration; the
conflict check is therefore part of the workflow contract and must be covered
by integration tests.

The existing v2 decision to avoid the dormant account-wide dollar/run breaker
is preserved. Workflow authorization is not authority to change opportunity
yield or reintroduce the old cost cap. Duplicate prevention and per-IP GSC
admission remain mandatory.

## Durable Steps

### 1. Expand candidate plan

Input: encrypted context snapshot.

Work:

- open the context snapshot;
- call the existing candidate LLM seam;
- normalize, deduplicate and cap at 150;
- retain exact LLM request/token/retry usage.

Output: generated count, immutable candidate drafts, usage and measured
duration.

Known LLM/config/schema failures return a typed terminal workflow outcome.
They are not thrown into automatic Workflow retries after provider dispatch.

### 2. Validate volumes

Input: candidate drafts plus market/language from the encrypted context.

Work: one existing keyword-overview call and three-state normalization.

Output: provider rows, requested count, cost delta and measured duration.

An error returns a typed terminal workflow outcome. A completed result is
durably frozen and never repeated by later stages.

### 3. Read compact GSC coverage

Input: candidate drafts, encrypted context and encrypted grant snapshot.

Work:

- open the grant snapshot in a step with full Node.js access;
- read bounded query and query-page evidence;
- immediately project only per-candidate coverage state and supporting-page
  provenance;
- discard raw access credentials and full GSC row collections from step output.

Output: one compact coverage record per candidate, paging limitations and
measured duration.

Coverage failure remains optional evidence and adds `gsc_coverage`; truncation
adds `gsc_coverage_truncated`. Neither becomes a zero or negative.

Validation and coverage run concurrently after candidate expansion.

### 4. Prepare immutable SERP plan

A pure step combines candidate, validation and compact coverage snapshots. It
excludes only provider-confirmed explicit zero and freezes the ordered sample
plan. It performs no network call.

### 5. Sample one keyword per step

Each sample target calls the existing SERP provider seam in its own step.
Workflow runs batches of at most ten steps concurrently, preserving the public
methodology's replenishing concurrency boundary while checkpointing every
keyword independently.

The step catches provider/transport failures and returns one typed unavailable
sample. It does not throw a normal error that would automatically repeat a
possibly charged request. Returned reasons remain:

- `provider_unavailable`;
- `provider_no_data`;
- `transport_outcome_unknown`;
- `budget_exhausted` only for an explicitly undispatched plan item.

There is no route-wide wall-clock budget inside Workflow. `budget_exhausted`
therefore remains readable for legacy/synchronous results but is not fabricated
for a workflow step that was actually scheduled.

### 6. Interpret completed SERPs

Complete samples are split into the existing bounded interpretation chunks.
Each chunk is one step. Failure returns unavailable interpretations and does
not remove provider facts or exclude candidates.

### 7. Enrich domains

Three independent steps run concurrently:

- provider domain ranks;
- provider estimated organic traffic;
- RDAP registration evidence.

`Map` objects never cross a durable boundary; every step returns ordered entry
arrays or null. Rank/traffic failures preserve unavailable states. RDAP failure
remains a per-domain unavailable observation.

### 8. Assemble result and cost receipt

A final pure step reconstructs maps, observations, thresholds, durations and
the v3 process ledger, then calls the existing public-tools report builder. It
issues no external request.

The workflow returns one discriminated outcome:

```ts
type KeywordWorkflowOutcome =
  | { kind: "completed"; payload: KeywordOpportunityEnvelope }
  | { kind: "redirect"; ownerRunId: string }
  | { kind: "failed"; code: KeywordOpportunityErrorCode };
```

Cost telemetry carries a run id and per-endpoint deltas so duplicate log lines
are correlatable. It is observability, not an exactly-once billing ledger.

## Status and Result API

Add:

```text
POST /api/tools/hidden-keywords/opportunities/status
```

Request:

```json
{ "runToken": "sealed-run-owner-token" }
```

The route is JSON-only, same-origin, authenticated and `no-store, private`.
It opens the token, rechecks the caller subject and then reads `getRun(runId)`.

Responses:

- queued/running: `200 {data:{status,runToken}}` + `Retry-After: 2`;
- completed result: `200 {data:{status:"completed",result}}`;
- duplicate redirect: `200 {data:{status:"redirect",runToken}}`;
- typed workflow failure: the existing stable error envelope/status mapping;
- cancelled: stable `keyword_run_cancelled` error;
- missing/tampered/foreign/expired: identical `404 keyword_run_unavailable`.

No response contains a raw Workflow run id, error stack, provider body, prompt,
credential or Vercel internal event.

## Client State and Reload Recovery

The component adds a `tracking` phase while retaining the existing visual
running panel and one stable live region.

Before start, it writes a versioned tab-scoped pointer to `sessionStorage`:

```ts
interface KeywordWorkflowPointerV1 {
  readonly version: "keyword_workflow_pointer.v1";
  readonly requestId: string;
  readonly context: ContextState;
  readonly createdAt: number;
  readonly runToken: string | null;
}
```

The pointer contains the already-visible public-page propositions plus sealed
tokens. It is not a server authority. Invalid shape, expiry, property mismatch
or storage exceptions fail closed and clear/ignore the pointer.

On mount:

- pointer with `runToken` -> restore `tracking` and poll;
- pointer with only `requestId/contextToken` -> resubmit the same request id;
- completed -> render the result and clear the pointer;
- redirect -> replace the run token and continue polling;
- terminal failure/cancel/not-found -> clear the run token, retain valid
  context when possible and return to confirmation;
- inaccessible session storage -> keep the ordinary in-memory flow working.

Poll cadence starts from the server's `Retry-After` and caps at five seconds.
Only one poll can be in flight. Component unmount cancels the request.

The new client handles both protocols atomically:

- `200 + data.result`: legacy synchronous completion;
- `202 + data.runToken`: workflow tracking;
- any other 2xx shape: sanitized protocol error.

The server keeps the current synchronous handler for callers that omit
`X-Keyword-Workflow-Version`. This protects a browser bundle loaded before the
deployment from interpreting a valid 202 as failure. The compatibility branch
is explicitly temporary and remains covered until a later release removes it.

## Persistence Truth

Workflow necessarily persists run inputs, step outputs and the final result in
Vercel-managed state so it can resume. The result must no longer claim
`persistence: "none"`.

Extend the shared literal with `workflow_managed`, keep every other public tool
defaulting to `none`, and emit `workflow_managed` only from the durable keyword
path. Public EN/ZH copy must say:

- Search Console access is read-only;
- the run is checkpointed in Vercel Workflow-managed state;
- it is not written to GenGrowth App project history;
- no saved-history or cross-run comparison UI is provided.

Do not call it temporary or promise a deletion/retention period until the
platform exposes and the product adopts an enforceable retention policy.

## Security and Privacy Invariants

- Same identity required at context, start and every status read.
- Foreign and absent run tokens are indistinguishable.
- Same-origin JSON POST for start and status.
- `Cache-Control: no-store, private` on every response.
- GSC credentials are workflow-purpose ciphertext and never step output.
- Client IP, raw identity, access/refresh tokens and complete GSC rows are never
  persisted in plaintext Workflow state.
- No custom Workflow run metadata is written.
- No raw Workflow run id appears in browser storage or responses.
- No raw provider/model/GSC error string reaches a response or log.
- Completed paid steps are never called again by later workflow replay.
- A single paid call may still repeat in the provider-success/process-crash
  window; the product and telemetry make no exactly-once claim.
- No App database, canonical table, Worker queue or Product route is touched.

## Testing

### Pure/unit

- sealed workflow input/run/grant purpose isolation and expiry;
- start/status input validation and same-origin refusal;
- caller-bound run-token ownership and foreign/absent equivalence;
- duplicate hook conflict returns redirect before paid seams;
- cost and LLM usage delta aggregation;
- provider exception mapping without automatic retry;
- one-keyword SERP step and ten-step concurrency plan;
- coverage compaction preserves all v3 provenance/unknown semantics;
- final workflow result emits `workflow_managed` while legacy sync remains
  `none`;
- pointer parsing, expiry, storage failure and 200/202 protocol normalization;
- poll single-flight, redirect adoption and terminal cleanup.

### Workflow integration

Use `@workflow/vitest` with deterministic offline seams. Prove:

- start -> running -> completed result;
- replay skips completed paid steps;
- duplicate request id produces one paid owner and one redirect;
- a failure after several SERP steps keeps completed steps and resumes from the
  first uncommitted item;
- failed/cancelled/missing runs expose only stable public errors.

### Browser

Extend the paid-call-free Marketing E2E:

- context 200 -> start 202 -> running -> completed;
- refresh during tracking resumes the same run token;
- duplicate start adopts the owner;
- terminal error retains confirmation context;
- legacy synchronous 200 still renders;
- unexpected API and external network requests remain blocked.

### Release

- Workflow health/build registration for the unique deployment;
- exact SHA and `gengrowth.ai` alias;
- signed-out 401 boundary without paid calls;
- authenticated deterministic test seam only in local/preview, never a
  production bypass;
- Workflow run visible in Vercel observability with no sensitive custom
  metadata;
- independent Product deployment/domain identity check.

## Non-Goals

- no numeric threshold change;
- no real paid provider canary;
- no provider exactly-once claim;
- no long-term report history or cross-run comparison;
- no cancellation UI in this release;
- no database, Worker, Product or publishing change.
