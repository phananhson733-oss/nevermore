# Artifact Convergence and Production Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Safely migrate the hosted SignalFrame database, converge the authenticated product shell and key review screens on the approved Artifact visual baseline without importing mock authority, build a representative canonical acceptance dataset with visual regression coverage, and release one verified web/worker SHA for online testing.

**Architecture:** Preserve every existing canonical API, server projection, audit rule, locale invariant, and asynchronous-run contract. Move only presentation composition toward the Artifact: the shell becomes a program cockpit, Overview keeps a five-stage narrative even when data is sparse, Sources adds a real readiness/provenance summary, and Report becomes a document-preview plus machine-manifest workspace. Production migration is additive and backup-first; web readiness is not accepted until the database, migration view, pg-boss schema, and live worker lease are all healthy.

**Tech Stack:** Next.js 16 App Router, React 19, CSS Modules, Supabase Auth/PostgreSQL/Storage, pg-boss worker, Vitest, Playwright, Vercel web deployment, Railway Hobby worker-only deployment.

---

### Task 1: Production backup, preflight, migration, and readiness foundation

**Files:**
- Read: `packages/db/migrations/0002_async_run_terminal_invariant.sql`
- Read: `packages/db/migrations/0003_artifact_status_transition.sql`
- Read: `packages/db/migrations/0004_artifact_revision_output_locale.sql`
- Read: `packages/db/migrations/0005_artifact_transition_invariants.sql`
- Read: `packages/db/migrations/0006_observability_metrics.sql`
- Read: `packages/db/migrations/0007_export_bundle_invariants.sql`
- Read: `packages/db/migrations/0008_bcp47_locale_grammar.sql`
- Read: `packages/db/migrations/0009_async_run_contract_version.sql`
- Verify: `packages/db/src/migrate-check.ts`
- Verify: `apps/web/src/app/api/mvp/health/ready/route.ts`
- Evidence: `/Users/wzb/.codex/backups/signalframe/qeeocwurjslqppjxlsbk/<timestamp>/`

**Step 1: Record the immutable pre-migration target**

Confirm production project ref, database host mode, server version, current application migration state, current custom-domain SHA, and the candidate release SHA without printing credentials.

**Step 2: Audit historical rows against the dangerous migrations**

Run read-only queries proving:

- every existing artifact revision can inherit a non-null artifact locale;
- every export bundle has a valid object key and same-scope export run;
- every canonical locale value satisfies the incoming BCP-47 grammar.

Expected: all invalid counts are zero.

**Step 3: Create and verify a logical backup**

Create a custom-format `pg_dump` archive scoped to the `app` schema and data, record SHA-256 and permissions, list all archive entries, restore it into an explicitly named disposable local database, compare key table counts, and drop the disposable target.

Expected: 28 application tables restore and the key production row counts match.

**Step 4: Apply migrations**

Run:

```bash
DATABASE_URL='<production session-mode URL>' pnpm db:migrate
```

Expected: migrations complete through `0009_async_run_contract_version` with no data repair required.

**Step 5: Prove idempotency and structure**

Run:

```bash
DATABASE_URL='<production session-mode URL>' pnpm db:migrate
DATABASE_URL='<production session-mode URL>' pnpm db:migrate:check
DATABASE_URL='<production session-mode URL>' pnpm db:smoke
```

Expected: second migration is a no-op, the migration view reports `0009_async_run_contract_version`, and all smoke probes pass.

**Step 6: Establish persistent worker readiness**

Deploy the worker from the same frozen SHA and environment as web, verify pg-boss schema creation, recovery sweep, and held readiness lease. Do not treat `/live` as sufficient.

**Step 7: Verify hosted readiness**

Expected: `/api/mvp/health/version` resolves to the release SHA, `/live` is 200, `/ready` is 200, and authenticated workspace reads succeed.

### Task 2: Canonical project shell and program cockpit

**Files:**
- Modify: `apps/web/src/app/p/[projectId]/layout.tsx`
- Modify: `apps/web/src/app/p/[projectId]/layout.module.css`
- Modify: `apps/web/src/app/p/[projectId]/_nav.tsx`
- Create: `apps/web/src/app/p/[projectId]/_project-switcher.tsx`
- Create or modify: `apps/web/src/lib/services/project-shell.ts`
- Test: `apps/web/src/lib/services/__tests__/project-shell.test.ts`
- Test: `e2e/mobile-shell.mock.spec.ts`
- Test: `apps/web/src/app/p/[projectId]/_e2e-shell.test.ts`

**Step 1: Write failing shell projection tests**

Test accessible project options, current project selection, non-zero confirmed-finding badge, non-zero artifact badge, and a canonical 90-day program position. Zero counts must not render fake badges.

**Step 2: Run the targeted tests and verify failure**

```bash
pnpm exec vitest run --project unit apps/web/src/lib/services/__tests__/project-shell.test.ts
```

Expected: FAIL because the shell projection and switcher do not yet exist.

**Step 3: Implement the server-backed shell projection**

Use canonical repositories/services only. Keep project isolation and 404-not-403 behavior intact. Never hardcode Artifact counts.

**Step 4: Implement the cockpit UI**

Add the project switcher, live diagnosis/studio badges, program progress block, help/settings affordances, and account treatment while preserving live routes, locale controls, logout, keyboard navigation, and unsaved-context navigation protection.

**Step 5: Verify desktop and mobile shell behavior**

```bash
pnpm exec vitest run --project unit apps/web/src/lib/services/__tests__/project-shell.test.ts apps/web/src/app/p/[projectId]/_e2e-shell.test.ts
pnpm exec playwright test --config=playwright.mock.config.ts e2e/mobile-shell.mock.spec.ts
```

Expected: project switching and badges are canonical, and the compact mobile shell remains reachable without horizontal page overflow.

### Task 3: Overview five-stage narrative with honest sparse states

**Files:**
- Modify: `apps/web/src/app/p/[projectId]/overview/_overview.tsx`
- Modify: `apps/web/src/app/p/[projectId]/overview/overview.module.css`
- Modify as needed: `apps/web/src/lib/services/workspace-view.ts`
- Test: `apps/web/src/lib/services/__tests__/workspace-view-overview.test.ts`
- Test: `e2e/overview-read-model.mock.spec.ts`

**Step 1: Write failing narrative tests**

Assert that Context, Sources, Diagnosis, Plan, and Delivery remain visible in ready, partial, and empty canonical states. Assert that unavailable values are labeled rather than invented.

**Step 2: Run the focused tests and verify failure**

```bash
pnpm exec vitest run --project unit apps/web/src/lib/services/__tests__/workspace-view-overview.test.ts
pnpm exec playwright test --config=playwright.mock.config.ts e2e/overview-read-model.mock.spec.ts
```

**Step 3: Recompose the screen**

Retain the editorial hero, health metrics, highest-leverage action, evidence pulse, weekly delivery focus, and coverage limitations. Upgrade the current three-stage rail to the approved five-stage value chain. In sparse states, preserve the composition and replace missing values with explicit next-step guidance.

**Step 4: Add an evidence-bound footer**

Expose analysis window, latest snapshot time, and limitations from canonical fields. Do not synthesize success percentages or priorities.

**Step 5: Verify both locales and breakpoints**

Expected: the screen keeps its narrative shape at 1920, 1440, and 390 widths and both UI locales, with no fake customer-content translation.

### Task 4: Sources readiness summary and canonical provenance

**Files:**
- Modify: `apps/web/src/app/p/[projectId]/sources/_sources.tsx`
- Modify: `apps/web/src/app/p/[projectId]/sources/sources.module.css`
- Test: `apps/web/src/lib/services/__tests__/sources.test.ts`
- Test or create: `e2e/sources-readiness.mock.spec.ts`

**Step 1: Write failing readiness and provenance tests**

Assert real connected/usable/partial/unavailable counts, source-family completeness, immutable snapshot count, and latest dataset/schema/method/checksum metadata. No snapshot must produce an explicit unavailable state, not fabricated provenance.

**Step 2: Implement the readiness summary**

Place a high-level readiness panel between the hero and provider cards. Derive every bar and status from `sources.data` and `snapshots.data`; do not copy the Artifact's hardcoded 83%.

**Step 3: Implement page and card provenance**

Show dataset key, schema version, method version, source window, captured time, row count, and abbreviated checksum from the immutable latest snapshot. Add the page footline summarizing snapshot count and confirming that credentials are never rendered.

**Step 4: Verify interactions and accessibility**

```bash
pnpm exec vitest run --project unit apps/web/src/lib/services/__tests__/sources.test.ts
pnpm exec playwright test --config=playwright.mock.config.ts e2e/sources-readiness.mock.spec.ts
```

Expected: existing collect/connect/import flows still work and the new summary is keyboard- and screen-reader-readable.

### Task 5: Report preview plus machine manifest workspace

**Files:**
- Modify: `apps/web/src/app/p/[projectId]/report/_report.tsx`
- Modify: `apps/web/src/app/p/[projectId]/report/report.module.css`
- Test or create: `e2e/report-workspace.mock.spec.ts`
- Protect: `apps/web/src/lib/services/__tests__/report-projection.integration.test.ts`

**Step 1: Write failing structure and print tests**

Assert a desktop two-column workspace with a customer document preview and sticky machine manifest. Under print media, assert that shell, controls, and manifest chrome are hidden and the canonical report document is linear and printable.

**Step 2: Build the customer document preview**

Recompose existing canonical `project`, `coverage`, `findings`, `actions`, `artifacts`, `limitations`, and `methodology` into an editorial document cover and numbered sections. Preserve server order and output locale exactly.

**Step 3: Promote export state into the manifest rail**

Reuse the existing export mutation, polling, bundle status, manifest metadata, and signed download behavior. The rail must stay visible on desktop and collapse below the document on narrow screens.

**Step 4: Implement print flattening**

Add print rules that remove interactive chrome and card shadows, expand the document to page width, and avoid hiding canonical content.

**Step 5: Verify projection identity and responsive behavior**

```bash
pnpm exec vitest run --project unit apps/web/src/lib/services/__tests__/report-pagination.test.ts
pnpm exec playwright test --config=playwright.mock.config.ts e2e/report-workspace.mock.spec.ts
```

Expected: no UI-side priority recomputation, no locale rewrite, and no horizontal overflow at 390/1440/1920.

### Task 6: Representative canonical acceptance fixture and visual regression

**Files:**
- Modify: `e2e/real-chain-fixture.ts`
- Modify: `e2e/real-vertical-chains.spec.ts`
- Create: `e2e/canonical-visual-regression.spec.ts`
- Create: `e2e/canonical-visual-regression.spec.ts-snapshots/*.png`
- Modify as needed: `playwright.config.ts`

**Step 1: Write a failing canonical fixture test**

Create a RelayOps-style B2B SaaS profile through the real project/context APIs, real CSV import worker, and deterministic offline provider seam. Require representative crawl, GSC, GA4, findings, actions, ready artifacts, and export state.

**Step 2: Extend the real fixture**

Reuse `completeContextBody`, `keywordGapCsv`, `seedOfflineProviderSnapshots`, diagnosis, review, artifact, and export paths. Do not add browser route stubs or UI-only read models.

**Step 3: Add stable visual assertions**

Capture Overview, Sources, Studio, and Report at 1920, 1440, and 390 widths with animation disabled and deterministic time/data. Commit the Playwright baselines.

**Step 4: Run real responsive, accessibility, and visual suites**

```bash
E2E_DATABASE_URL='<fresh loopback database>' pnpm exec playwright test --config=playwright.config.ts e2e/real-vertical-chains.spec.ts e2e/canonical-visual-regression.spec.ts e2e/responsive.spec.ts e2e/a11y.spec.ts
```

Expected: the real application/worker/database chain passes, all visual baselines match, axe has no serious/critical violations, and every breakpoint is overflow-free.

### Task 7: Full release verification, review, merge, push, and promotion

**Files:**
- Review: all changed files
- Verify: `.github/workflows/ci.yml`
- Verify: `docs/LAUNCH-CHECKLIST.md`

**Step 1: Run static and contract gates**

```bash
pnpm lint
pnpm typecheck
pnpm verify:spec
pnpm openapi:lint
pnpm contracts:check
pnpm implementation:check
pnpm deploy:check
pnpm secrets:scan
```

**Step 2: Run unit, integration, migration, restore, and E2E gates**

Use fresh explicitly named loopback databases. Run unit tests, integration tests, two migration passes, migrate-check, schema smoke, restore drill, real E2E, and mock E2E. Drop all disposable databases afterward.

**Step 3: Review the complete diff**

Run `git diff --check`, inspect every changed file, and obtain a correctness/security/accessibility review. Resolve all P0/P1/P2 findings.

**Step 4: Commit and integrate**

Commit the isolated branch, merge it into current `main`, rerun the release gates on the merged tree, and push without force.

**Step 5: Deploy one immutable SHA**

Deploy migration job, persistent worker, and Vercel web from the same SHA. Promote the custom domain only after `/ready` is 200 on the candidate.

**Step 6: Perform authenticated hosted acceptance**

Using the user's logged-in Chrome session, verify project switching, all seven routes, source collection controls, diagnosis evidence, plan/studio flows, report export, both UI locales, and the 1920/1440/mobile responsive states. Confirm the custom-domain version endpoint reports the promoted SHA.

**Step 7: Close the release**

Record backup evidence, migration version, worker readiness evidence, CI run, deployment URL, promoted SHA, and any remaining provider/Owner-only gates. Mark completion only when every requirement above has direct evidence.
