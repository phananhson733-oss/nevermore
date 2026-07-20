# Connected Growth Audit & Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend Nevermore into a versioned complete audit-and-optimization platform, proving a technical audit-to-recheck vertical slice before migrating market, demand, content, publishing, and client self-service.

**Architecture:** Nevermore remains the only product shell and system of record. Its existing Source → Snapshot → Evidence → Finding → Review → Action → Artifact chain is extended, not duplicated. gengrowth-agents and gengrowth-flow-mvp are capability and parity sources accessed through versioned Shadow-first contracts.

**Tech Stack:** Node.js 24, pnpm 10, TypeScript strict, Next.js 16 App Router, React 19, TanStack Query, next-intl, Zod, OpenAPI 3.1, PostgreSQL/Drizzle, pg-boss, Vitest, Playwright, Supabase, Railway.

---

## Execution Preconditions

- Execute in a dedicated clean worktree created from commit 5ec4210 or a later reviewed commit.
- Rebase or selectively port concurrent user-owned Nevermore changes. Never reset or overwrite the dirty main worktree.
- The v0.2 authority package is frozen and explicitly defers RBAC, customer portal, CMS writes, recheck, attribution, and AI-answer monitoring. Product code must not cross those boundaries until Tasks 1–2 establish a reviewed v0.3 contract.
- Treat /Users/wzb/Code/gengrowth-agents and the Flow repository as read-only capability sources during Phase 0. Never add runtime imports from sibling repositories.
- Keep Full Audit audit-only. Owners, effort, remediation steps, backlog state, and assignments belong to Findings, Plan, and Delivery.
- Preserve honest data semantics: unavailable is null/no_data, never zero, failure, or generated evidence.

## Phase 0 — Authority and Parity

### Task 1: Create the reviewed v0.3 authority package

**Files:**

- Create: /Users/wzb/Code/nevermore/signalframe-mvp/implementation-spec-v0.3/MVP-IMPLEMENTATION-SPEC.md
- Create: /Users/wzb/Code/nevermore/signalframe-mvp/implementation-spec-v0.3/openapi.yaml
- Create: /Users/wzb/Code/nevermore/signalframe-mvp/implementation-spec-v0.3/schema.sql
- Create: /Users/wzb/Code/nevermore/signalframe-mvp/implementation-spec-v0.3/scripts/verify-spec.mjs
- Reference: docs/plans/2026-07-20-connected-growth-audit-optimization-design.md

**Step 1: Write the failing verifier assertions**

Require:

- product version 0.3.0 and contract version 2026-07-20;
- audit report, module, URL, create-run, and recheck operations;
- capability run, audit scope, audit module result, site page, and page snapshot tables;
- an audit response forbidden-field check for action/backlog/remediation fields;
- unchanged Evidence/Finding/Review/Action/Artifact ownership invariants;
- three separate taxonomies: report modules, technical checks, and action domains.

**Step 2: Run the verifier**

    node /Users/wzb/Code/nevermore/signalframe-mvp/implementation-spec-v0.3/scripts/verify-spec.mjs

Expected: FAIL while the normative and machine contracts are incomplete.

**Step 3: Write the minimum normative delta**

- Full Audit and technical recheck become in scope.
- Eight report modules and A0–A14 deep technical taxonomy are defined.
- Audit remains audit-only.
- Nevermore Evidence/Finding/Review/Action/Artifact remains canonical.
- Existing action domains remain valid; accessibility, security_reliability, and compliance become explicit new action domains when those Findings gain remediation templates.
- Shadow, Canary, and Authoritative are normative capability modes.
- Customer membership and publishing stay in later v0.3 milestones, not the first slice.

**Step 4: Update OpenAPI and SQL together**

Every route, enum, status, table, constraint, and nullable/no-data rule must exist in the narrative, OpenAPI, and SQL contracts before app code.

**Step 5: Verify and commit**

    node /Users/wzb/Code/nevermore/signalframe-mvp/implementation-spec-v0.3/scripts/verify-spec.mjs
    git add implementation-spec-v0.3
    git commit -m "spec: define connected growth v0.3 contract"

Expected: verifier PASS and one authority-only commit.

### Task 2: Pin the app to the v0.3 authority

**Files:**

- Modify: package.json
- Modify: packages/contracts/src/zod/health.ts
- Modify: scripts/verify-spec-lock.mjs
- Create: scripts/spec-v0.3-lock.json
- Modify: docs/PROGRESS.md

**Step 1: Update lock expectations first**

Set expected product and contract versions to 0.3.0 and 2026-07-20, leaving runtime code unchanged.

**Step 2: Verify the expected failure**

    pnpm verify:spec

Expected: FAIL on versions, authority hashes, operations, and tables.

**Step 3: Pin the reviewed authority**

- Bump package version and runtime contract version.
- Hash only the reviewed v0.3 files.
- Retain exact-set checks for operations, async operations, queues, tables, and rules.

**Step 4: Verify and commit**

    pnpm verify:spec
    pnpm contracts:check
    git add package.json packages/contracts/src/zod/health.ts scripts/verify-spec-lock.mjs scripts/spec-v0.3-lock.json docs/PROGRESS.md
    git commit -m "chore: pin connected growth v0.3 authority"

Expected: both verification commands PASS.

### Task 3: Freeze the capability ownership and parity matrix

**Files:**

- Create: docs/migration/connected-growth-capability-matrix.md
- Create: fixtures/audit/relayops-audit-manifest.json
- Create: fixtures/audit/relayops-audit-expected.json
- Create: scripts/verify-audit-fixture.mjs
- Create: scripts/verify-audit-fixture.test.mjs

**Step 1: Write a failing fixture verifier**

Reject any capability row missing:

- source owner;
- input/output contract;
- evidence provenance;
- no-data behavior;
- live/partial/planned/unavailable maturity;
- side-effect class;
- reuse/extract/adapter/rebuild decision;
- parity fixture and tolerance;
- target authority milestone.

**Step 2: Run it**

    node --test scripts/verify-audit-fixture.test.mjs

Expected: FAIL because the matrix and fixtures are missing.

**Step 3: Add the matrix**

Map:

- Nevermore’s current 11 rules, five business domains, and three artifact types;
- gengrowth-agents eight report modules, 17 analysis modules, A0–A14 technical checks, and GEO H1–H6;
- Flow keyword, cluster, SERP, research, draft, QA, publish, index, and recap capabilities;
- Wiki authority A/B/C/D.

The matrix must explicitly mark design-only or feature-flagged gengrowth-agents capabilities as planned/partial, not live.

**Step 4: Add deterministic fixtures**

Include measured failure, pass, no data, partial coverage, provenance, affected URL sample, rule version, and capability version.

**Step 5: Verify and commit**

    node --test scripts/verify-audit-fixture.test.mjs
    git add docs/migration fixtures/audit scripts/verify-audit-fixture.mjs scripts/verify-audit-fixture.test.mjs
    git commit -m "test: freeze audit capability parity fixtures"

## Phase 1 — Read-only Full Audit

### Task 4: Add audit taxonomy and response contracts

**Files:**

- Create: packages/contracts/src/zod/audit.ts
- Create: packages/contracts/src/zod/audit.test.ts
- Modify: packages/contracts/src/index.ts
- Modify: openapi/mvp.yaml

**Step 1: Write failing Zod tests**

Cover:

- exactly eight report module IDs;
- pass/warning/failed/no_data/pending;
- nullable score;
- source status and freshness;
- rule, finding, and affected URL counts;
- no owner, effort, remediation, assignment, or backlog fields in AuditReport.

**Step 2: Run the focused test**

    pnpm vitest run --project unit packages/contracts/src/zod/audit.test.ts

Expected: FAIL because schemas are absent.

**Step 3: Implement the strict schema**

The public module enum is:

    performance
    accessibility
    best_practices
    technical_seo
    content
    ai_geo
    links
    compliance

AuditModuleProjection contains:

- id;
- nullable score;
- status;
- source summaries;
- measured and no-data rule counts;
- finding count;
- latest observed time.

**Step 4: Add API contracts**

Add:

- GET project audit;
- GET audit module;
- GET audit URLs;
- GET audit URL detail.

**Step 5: Verify and commit**

    pnpm contracts:generate
    pnpm contracts:check
    pnpm vitest run --project unit packages/contracts/src/zod/audit.test.ts
    pnpm openapi:lint
    git add packages/contracts openapi/mvp.yaml
    git commit -m "feat(contracts): add honest full-audit projection"

### Task 5: Build the audit read model from canonical Nevermore data

**Files:**

- Create: apps/web/src/lib/services/audit-projection.ts
- Create: apps/web/src/lib/services/__tests__/audit-projection.test.ts
- Modify: apps/web/src/lib/services/diagnostic-load.ts
- Reference: packages/engine/src/registry.ts
- Reference: packages/db/src/schema.ts

**Step 1: Write failing projection tests**

Prove:

- current Nevermore rules map into report modules without creating new Findings;
- skipped/inconclusive rules increment no-data, not failed;
- a module without measurement has score null and status no_data;
- Finding links retain real Evidence;
- no remediation fields leak into the response.

**Step 2: Run**

    pnpm vitest run --project unit apps/web/src/lib/services/__tests__/audit-projection.test.ts

Expected: FAIL because getProjectAudit is absent.

**Step 3: Implement deterministic versioned mapping**

Map explicit rule IDs, never infer module names from prefixes. Examples:

- TECH-HTTP-001 and TECH-CANONICAL-002 → technical_seo;
- TECH-LINKGRAPH-005 → links;
- SEARCH-DECAY-002 and CONTENT rules → content;
- GEO rules → ai_geo.

Modules not measured by current rules remain explicit No Data.

**Step 4: Verify and commit**

    pnpm vitest run --project unit apps/web/src/lib/services/__tests__/audit-projection.test.ts
    pnpm typecheck
    git add apps/web/src/lib/services/audit-projection.ts apps/web/src/lib/services/__tests__/audit-projection.test.ts apps/web/src/lib/services/diagnostic-load.ts
    git commit -m "feat(web): project canonical data into full audit"

### Task 6: Expose project-scoped audit APIs

**Files:**

- Create: apps/web/src/app/api/mvp/projects/[projectId]/audit/route.ts
- Create: apps/web/src/app/api/mvp/projects/[projectId]/audit/route.test.ts
- Create: apps/web/src/app/api/mvp/projects/[projectId]/audit/modules/[moduleId]/route.ts
- Create: apps/web/src/app/api/mvp/projects/[projectId]/audit/urls/route.ts
- Create: apps/web/src/app/api/mvp/projects/[projectId]/audit/urls/[urlId]/route.ts

**Step 1: Write failing route tests**

Cover current-project read, malformed UUID/module, cross-workspace 404-not-403, no-run empty projection, and invalid cursor.

**Step 2: Run**

    pnpm vitest run --project unit apps/web/src/app/api/mvp/projects/\[projectId\]/audit/route.test.ts

Expected: FAIL because the routes do not exist.

**Step 3: Implement routes**

Use operatorRoute, parseUuidParam, strict Zod parsing, ok, and project-scoped services. Route Handlers must not query Drizzle directly.

**Step 4: Verify and commit**

    pnpm vitest run --project unit apps/web/src/app/api/mvp/projects/\[projectId\]/audit/route.test.ts
    pnpm typecheck
    git add apps/web/src/app/api/mvp/projects/\[projectId\]/audit
    git commit -m "feat(api): expose project full-audit reads"

### Task 7: Add the Full Audit product surface

**Files:**

- Create: apps/web/src/app/p/[projectId]/audit/page.tsx
- Create: apps/web/src/app/p/[projectId]/audit/_audit.tsx
- Create: apps/web/src/app/p/[projectId]/audit/_audit-view-model.ts
- Create: apps/web/src/app/p/[projectId]/audit/_audit-view-model.test.ts
- Create: apps/web/src/app/p/[projectId]/audit/audit.module.css
- Create: apps/web/src/lib/api/hooks-audit.ts
- Modify: apps/web/src/app/p/[projectId]/layout.tsx
- Modify: apps/web/src/app/p/[projectId]/nav.module.css
- Modify: packages/i18n/src/messages/en.json
- Modify: packages/i18n/src/messages/zh-CN.json
- Create: e2e/full-audit.mock.spec.ts
- Modify: e2e/mock-api.ts

**Step 1: Write failing view-model and Playwright tests**

Assert:

- eight module tiles;
- technical risk leads the page;
- No Data is visually distinct from pass/fail;
- coverage, freshness, module, Finding, URL, and Evidence drilldowns work;
- Audit contains no assignment, owner, fix steps, or backlog controls;
- 390 px and 1440 px have no root overflow.

**Step 2: Verify failure**

    pnpm vitest run --project unit apps/web/src/app/p/\[projectId\]/audit/_audit-view-model.test.ts
    pnpm playwright test --config=playwright.mock.config.ts e2e/full-audit.mock.spec.ts

Expected: FAIL because the page is absent.

**Step 3: Implement the page**

Sections:

1. run/scope/data completeness;
2. overall health and top risk;
3. eight modules;
4. measured Findings;
5. URL inventory;
6. evidence sample, history, and exports.

**Step 4: Verify and commit**

    pnpm vitest run --project unit apps/web/src/app/p/\[projectId\]/audit/_audit-view-model.test.ts
    pnpm playwright test --config=playwright.mock.config.ts e2e/full-audit.mock.spec.ts
    pnpm lint
    pnpm typecheck
    git add apps/web/src/app/p/\[projectId\]/audit apps/web/src/lib/api/hooks-audit.ts apps/web/src/app/p/\[projectId\]/layout.tsx apps/web/src/app/p/\[projectId\]/nav.module.css packages/i18n e2e
    git commit -m "feat(web): add evidence-first full audit"

## Phase 2 — Capability Runs and Technical Optimization

### Task 8: Add capability and audit persistence

**Files:**

- Create: packages/db/migrations/0010_connected_growth_audit.sql
- Modify: packages/db/src/schema.ts
- Modify: packages/db/migrations/schema-smoke.sql
- Create: packages/db/src/repositories/capability-runs.ts
- Create: packages/db/src/repositories/audit-runs.ts
- Create: packages/db/src/repositories/site-pages.ts
- Create: packages/db/src/__tests__/audit-runs.integration.test.ts
- Modify: packages/db/src/index.ts

**Step 1: Write failing integration tests**

Assert:

- capability run shares async run ID;
- audit run references capability run and immutable scope;
- module result has nullable score plus measured/no-data counts;
- page identity is project-scoped normalized URL;
- page snapshots and module results are append-only;
- mode is shadow/canary/authoritative;
- cross-project reads return no rows.

**Step 2: Run**

    pnpm vitest run --project integration packages/db/src/__tests__/audit-runs.integration.test.ts

Expected: FAIL because tables are absent.

**Step 3: Implement only these new tables**

- capability_runs;
- audit_runs;
- audit_module_results;
- site_pages;
- page_snapshots.

Do not duplicate findings, actions, artifacts, review events, or async run state.

**Step 4: Verify and commit**

    pnpm db:migrate:check
    pnpm db:smoke
    pnpm vitest run --project integration packages/db/src/__tests__/audit-runs.integration.test.ts
    git add packages/db
    git commit -m "feat(db): persist versioned audit capability runs"

### Task 9: Add the versioned Full Audit worker contract

**Files:**

- Modify: packages/db/src/queue.ts
- Modify: packages/db/src/queue.test.ts
- Create: packages/contracts/src/zod/capabilities.ts
- Create: packages/contracts/src/zod/capabilities.test.ts
- Create: apps/worker/src/audit/run-full-audit.ts
- Create: apps/worker/src/audit/run-full-audit.test.ts
- Create: apps/worker/src/handlers/audit.ts
- Modify: apps/worker/src/index.ts

**Step 1: Write failing queue and manifest tests**

The queue payload contains only runId, workspaceId, projectId, and contractVersion. Persisted manifest contains capability version, snapshots, scope, devices, modules, mode, rule set, side-effect scope, and hash.

**Step 2: Run**

    pnpm vitest run --project unit packages/db/src/queue.test.ts packages/contracts/src/zod/capabilities.test.ts apps/worker/src/audit/run-full-audit.test.ts

Expected: FAIL on missing audit.full queue and handler.

**Step 3: Implement a fixture-backed Shadow runner**

Read the committed fixture and write only canonical page snapshots, evidence, rule results, and module results. Never call a sibling repository or external publisher.

**Step 4: Verify and commit**

    pnpm vitest run --project unit packages/db/src/queue.test.ts packages/contracts/src/zod/capabilities.test.ts apps/worker/src/audit/run-full-audit.test.ts
    pnpm typecheck
    git add packages/db/src/queue.ts packages/db/src/queue.test.ts packages/contracts apps/worker
    git commit -m "feat(worker): run versioned full-audit shadows"

### Task 10: Port the first parity-gated technical capability set

**Files:**

- Create: packages/engine/src/audit/module-taxonomy.ts
- Create: packages/engine/src/audit/module-taxonomy.test.ts
- Create: packages/engine/src/audit/technical-rules.ts
- Create: packages/engine/src/audit/technical-rules.test.ts
- Modify: packages/engine/src/registry.ts
- Modify: packages/engine/src/action-templates.ts
- Modify: apps/worker/src/audit/run-full-audit.ts
- Create: apps/worker/src/audit/audit-parity.test.ts

**Step 1: Select a bounded first rule set**

Use only measured HTTP, canonical, robots/noindex, sitemap contradiction, internal-link/orphan, CWV, structured-data, and AI-crawler rules. All unimplemented checks remain No Data.

**Step 2: Write failing parity tests**

Compare status, current value, affected URL count, evidence source, severity, and no-data state against frozen fixtures.

**Step 3: Run**

    pnpm vitest run --project unit packages/engine/src/audit apps/worker/src/audit/audit-parity.test.ts

Expected: FAIL because rules are absent.

**Step 4: Port reviewed pure logic**

Never runtime-import gengrowth-agents. Preserve stable rule/check IDs, thresholds, versions, confidence rules, and provenance comments.

**Step 5: Verify and commit**

    pnpm vitest run --project unit packages/engine/src/audit apps/worker/src/audit/audit-parity.test.ts
    pnpm verify:spec
    pnpm typecheck
    git add packages/engine apps/worker/src/audit
    git commit -m "feat(engine): add parity-gated technical audit rules"

### Task 11: Close Finding → Technical Ticket → Recheck

**Files:**

- Modify: apps/web/src/lib/services/finding-review.ts
- Modify: apps/web/src/lib/services/__tests__/finding-review.integration.test.ts
- Modify: packages/artifacts/src/templates/technical-ticket.ts
- Modify: packages/artifacts/src/templates/technical-ticket.test.ts
- Create: apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/recheck/route.ts
- Create: apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/recheck/route.test.ts
- Create: apps/worker/src/audit/run-recheck.ts
- Create: apps/worker/src/audit/run-recheck.test.ts
- Modify: apps/web/src/app/p/[projectId]/plan/_plan.tsx
- Modify: apps/web/src/app/p/[projectId]/studio/_studio.tsx
- Create: e2e/audit-technical-vertical.mock.spec.ts

**Step 1: Write the failing vertical E2E**

Flow:

1. inspect canonical-conflict Finding and Evidence;
2. confirm it;
3. observe same-transaction Action creation;
4. generate technical_ticket;
5. inspect validation and rollback sections;
6. request recheck;
7. observe a new immutable audit run and before/after checkpoint.

**Step 2: Run**

    pnpm playwright test --config=playwright.mock.config.ts e2e/audit-technical-vertical.mock.spec.ts

Expected: FAIL at recheck.

**Step 3: Implement the recheck contract**

Recheck creates a new capability/async run referencing Action, Finding, target URLs, and prior run. It never edits the prior observation.

**Step 4: Verify and commit**

    pnpm vitest run --project unit packages/artifacts/src/templates/technical-ticket.test.ts apps/worker/src/audit/run-recheck.test.ts
    pnpm vitest run --project integration apps/web/src/lib/services/__tests__/finding-review.integration.test.ts
    pnpm playwright test --config=playwright.mock.config.ts e2e/audit-technical-vertical.mock.spec.ts
    git add apps/web packages/artifacts apps/worker e2e/audit-technical-vertical.mock.spec.ts
    git commit -m "feat: close technical audit optimization loop"

Stop here for product review before migrating content.

## Phase 3 — Market, Demand, and Content Shadow

### Task 12: Add Market/Demand contracts and persistence

**Files:**

- Create: packages/contracts/src/zod/demand.ts
- Create: packages/contracts/src/zod/demand.test.ts
- Create: packages/db/migrations/0011_market_demand.sql
- Modify: packages/db/src/schema.ts
- Create: packages/db/src/repositories/topics.ts
- Create: packages/db/src/repositories/competitors.ts
- Create: packages/db/src/repositories/queries.ts
- Create: packages/db/src/__tests__/market-demand.integration.test.ts

**Step 1: Write failing invariants**

- Competitor relation types are explicit.
- SearchQuery and GenerativeQuery are separate.
- Both can reference Topic.
- Search volume/KD cannot appear on GenerativeQuery.
- AI observation records platform, locale, question version, time, and answer hash.
- Metric snapshots are append-only.

**Step 2: Implement, verify, and commit**

    pnpm vitest run --project unit packages/contracts/src/zod/demand.test.ts
    pnpm vitest run --project integration packages/db/src/__tests__/market-demand.integration.test.ts
    pnpm db:migrate:check
    git add packages/contracts packages/db
    git commit -m "feat: add governed market and demand domains"

### Task 13: Add a sandboxed Flow Shadow adapter

**Files:**

- Create: packages/contracts/src/zod/flow-adapter.ts
- Create: packages/contracts/src/zod/flow-adapter.test.ts
- Create: apps/worker/src/flow/compatibility-adapter.ts
- Create: apps/worker/src/flow/compatibility-adapter.test.ts
- Create: apps/worker/src/flow/output-normalizer.ts
- Create: fixtures/flow/keyword-to-draft-manifest.json
- Create: fixtures/flow/keyword-to-draft-output.json

**Step 1: Write security and parity tests**

Reject arbitrary commands, unresolved paths, shell metacharacters, credentials/full content in queue payloads, unknown output fields, and external writes in Shadow mode.

**Step 2: Implement a fixed allowlist adapter**

Accept only named versioned capabilities in a controlled directory against a pinned Flow commit/container. Validate output before canonical writes.

**Step 3: Verify and commit**

    pnpm vitest run --project unit packages/contracts/src/zod/flow-adapter.test.ts apps/worker/src/flow
    pnpm secrets:scan
    git add packages/contracts apps/worker/src/flow fixtures/flow
    git commit -m "feat(worker): add sandboxed flow shadow adapter"

### Task 14: Add Content Item, governed knowledge, and multi-type Delivery

**Files:**

- Create: packages/db/migrations/0012_content_operations.sql
- Modify: packages/db/src/schema.ts
- Create: packages/db/src/repositories/content-items.ts
- Create: packages/contracts/src/zod/content-operations.ts
- Create: apps/web/src/app/p/[projectId]/market/page.tsx
- Create: apps/web/src/app/p/[projectId]/demand/page.tsx
- Create: apps/web/src/app/p/[projectId]/content/page.tsx
- Modify: apps/web/src/app/p/[projectId]/studio/_studio.tsx
- Modify: packages/i18n/src/messages/en.json
- Modify: packages/i18n/src/messages/zh-CN.json
- Create: e2e/content-growth-shadow.mock.spec.ts

**Step 1: Write failing chain tests**

Prove:

- competitor → Topic → independent SEO/GEO demand → opportunity;
- Content Item references confirmed Evidence;
- Research Pack records A/B/C/D authority;
- D-level research cannot satisfy a publishable fact gate;
- Delivery renders technical_ticket, metadata_rewrite, and content_brief without becoming Blog-only.

**Step 2: Implement Shadow-only content operations**

Stop at reviewed Artifact Revision. Show Nevermore-vs-Flow parity differences; do not write to a CMS.

**Step 3: Verify and commit**

    pnpm playwright test --config=playwright.mock.config.ts e2e/content-growth-shadow.mock.spec.ts
    pnpm lint
    pnpm typecheck
    git add packages/db packages/contracts apps/web packages/i18n e2e/content-growth-shadow.mock.spec.ts
    git commit -m "feat(web): add content growth shadow workflow"

## Phase 4 — Membership, Publishing, and Measurement

### Task 15: Add project memberships and policy enforcement

**Files:**

- Create: packages/db/migrations/0013_project_memberships.sql
- Create: packages/contracts/src/zod/memberships.ts
- Create: apps/web/src/lib/auth/project-access.ts
- Create: apps/web/src/lib/auth/project-access.test.ts
- Modify: all v0.3 project Route Handlers
- Create: e2e/project-role-isolation.spec.ts

**Steps:**

1. Write failing role and cross-tenant tests.
2. Implement memberships, invitations, Automation Policy, and Publish Authorization.
3. Enforce server-side; UI hiding remains presentational.
4. Run integration/E2E isolation tests.
5. Commit: feat(auth): enforce project membership policies.

### Task 16: Add immutable approval and CMS Canary publishing

**Files:**

- Create: packages/db/migrations/0014_review_publication.sql
- Create: packages/contracts/src/zod/publishing.ts
- Create: apps/worker/src/publishing/connector.ts
- Create: apps/worker/src/publishing/oracle-github-canary.ts
- Create: apps/worker/src/publishing/reconcile.ts
- Create: apps/web/src/app/p/[projectId]/publish/page.tsx
- Create: e2e/publish-canary.mock.spec.ts

**Steps:**

1. Write failing tests for Revision-bound approval, authorization scope, idempotency, timeout → Parked, and Reconcile-before-retry.
2. Implement a single-project/single-content-type Canary.
3. Run only against the approved astrologywiki test chain after Shadow parity.
4. Verify duplicate prevention and recovery evidence.
5. Commit: feat: add governed CMS canary publishing.

### Task 17: Add technical and content measurement checkpoints

**Files:**

- Create: packages/db/migrations/0015_performance_checkpoints.sql
- Create: packages/contracts/src/zod/measurement.ts
- Create: apps/worker/src/measurement/run-checkpoint.ts
- Create: apps/web/src/app/p/[projectId]/measurement/page.tsx
- Create: e2e/measurement-loop.mock.spec.ts

**Steps:**

1. Write failing tests separating prediction, estimate, observed baseline, and post-delivery actual.
2. Persist immutable 0/7/14/30/60-day checkpoints.
3. Add technical before/after plus Search/Conversion/AI observations.
4. Feed verified outcomes into priority projections without mutating historic Evidence.
5. Commit: feat: close connected growth measurement loop.

## Final Verification

### Task 18: Prove the requested platform scope

**Files:**

- Modify: docs/PROGRESS.md
- Modify: docs/LAUNCH-CHECKLIST.md
- Create: docs/migration/connected-growth-cutover-report.md

**Step 1: Run the full gate**

    pnpm verify:spec
    pnpm contracts:check
    pnpm openapi:lint
    pnpm db:migrate:check
    pnpm db:smoke
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm test:integration
    pnpm test:e2e:mock
    pnpm implementation:check
    pnpm deploy:check
    pnpm secrets:scan

Expected: all PASS.

**Step 2: Audit each requirement**

The cutover report links authoritative evidence for:

- full URL/site audit and technical/non-content diagnostics;
- honest No Data;
- Finding review and cross-domain plan;
- current three delivery types;
- competitor, keyword, independent SEO/GEO demand, and daily content;
- governed fact/approval chain;
- CMS idempotency and recovery;
- recheck and post-publication measurement;
- managed service and self-service isolation;
- Shadow/Parity/Canary results.

Unverified items remain incomplete even if tests are green.

**Step 3: Review and commit evidence**

    git status --short
    git diff --check
    git diff --stat HEAD~1
    git add docs/PROGRESS.md docs/LAUNCH-CHECKLIST.md docs/migration/connected-growth-cutover-report.md
    git commit -m "docs: record connected growth cutover evidence"

## Recommended Execution Order

Complete Tasks 1–11 and stop for product review at the technical vertical slice. Only after audit-only boundaries, data honesty, Finding governance, and recheck are proven should Tasks 12–14 migrate Content Growth. Tasks 15–17 require separate security and external-write review.

The high-fidelity Artifact may be completed now as a design-validation deliverable. Production implementation must not start until the v0.3 authority is reviewed.
