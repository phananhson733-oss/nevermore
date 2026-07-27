# Nevermore Customer Artifact and Production Convergence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Converge the completed Nevermore v0.3 audit and Content Shadow work into one protected `main` baseline, deliver a complete Chinese-first customer Artifact, then add authorized GitHub/WordPress publishing and honest GSC/GA4/UTM before-after attribution without creating a second product lifecycle.

**Architecture:** Nevermore remains the repository, product boundary, authorization boundary, and system of record; GenGrowth is the customer-facing brand. Preserve the canonical chain `Project → Snapshot/Observation → Evidence → Finding → Review → Action → Artifact Revision → Approval → Authorized Publication → Recheck/Outcome Observation → Results`. Add publication and attribution only as versioned v0.4 extensions after the current v0.3 branch, customer UI, documentation, and Artifact have been converged and verified.

**Tech Stack:** TypeScript, Next.js App Router, React 19, Zod, OpenAPI 3.1, Drizzle ORM, PostgreSQL, pg-boss, Vitest, Playwright, pnpm, Node.js 24, GitHub App APIs, WordPress REST API, GSC, GA4.

---

## Product and naming authority

- Internal repository/product program: **Nevermore**.
- Customer-facing product brand: **GenGrowth**.
- `signalframe-mvp-app`, `@sf/*`, `signalframe.*` schema identifiers, database names, historical export versions, and problem type URLs are compatibility implementation identifiers. They are not customer-visible branding and are not renamed in this convergence milestone.
- Customer UI is Chinese-first. Stable nouns such as SEO, GEO, ICP, JTBD, Keyword, Competitor, Content Brief, GitHub, CMS, UTM, GSC, and GA4 remain in English where clearer.
- English-market content deliverables remain English; surrounding controls, decisions, limitations, and results explanations remain Chinese.

## Canonical customer information architecture

Primary project navigation remains exactly:

1. `概览`
2. `增长地图`
3. `执行中心`
4. `效果追踪`

Secondary routes:

- `/context`: product profile and ICP review.
- `/sources`: customer-managed connections.

Compatibility routes:

- `/diagnosis` → `/growth-map`
- `/plan` and `/studio` → `/execution`
- `/report` → `/results`

Customer-managed connections are exactly:

- Google Search Console
- Google Analytics 4
- GitHub

Crawl, Sitemap, CSV, DataForSEO, SERP, Suggest/PAA, AI citation observation, competitor corpus, and research retrieval remain internal evidence capabilities. Their provenance may be disclosed beside evidence, but they are not presented as customer-managed connector cards.

## Capability truth labels

Every customer-visible capability must resolve to one of:

- `live`: backed by a canonical route/service and real provider adapter;
- `scenario`: deterministic demonstration data, clearly labelled `场景数据`;
- `planned`: visible only when the customer needs to understand a coming capability; no active-looking control;
- `unavailable`: configured capability cannot currently be used, with a concrete reason.

No button may return a generic toast in place of the promised destination or decision. A visible action must navigate, open a real dialog/drawer, execute a real command, or be non-interactive with an explicit planned/unavailable label.

---

### Task 1: Preserve all authored work and establish the v03 integration baseline

**Files:**

- Preserve from main:
  - `docs/artifacts/GenGrowth-Interactive-Artifact.html`
  - `docs/artifacts/GenGrowth-Product-Manual.html`
  - `scripts/build-product-manual.mjs`
  - `scripts/build-static-customer-artifact.mjs`
  - `scripts/verify-product-manual.cjs`
  - `scripts/verify-static-customer-artifact.cjs`
- Preserve from v03:
  - `docs/plans/2026-07-21-unified-growth-opportunity-prd.md`
  - `docs/plans/2026-07-21-unified-growth-opportunity-design.md`
  - `docs/plans/2026-07-21-unified-growth-opportunity-implementation.md`
  - all authored `docs/plans/2026-07-24-*.md`, `2026-07-25-*.md`, and `2026-07-27-*.md`
- Modify: `.gitignore`

**Step 1: Prove branch topology**

Run:

```bash
git merge-base main codex/unified-growth-opportunity-v03
git rev-list --left-right --count main...codex/unified-growth-opportunity-v03
```

Expected: merge base equals current `main`; output is `0 180` or a later `0 N`.

**Step 2: Preserve main-only authored files on a local safety branch**

Create `codex/pre-v03-local-preservation-20260727` from current `main`. Commit only the six Artifact/manual source files. Do not add `.gstack`.

Expected: the safety branch contains reproducible Artifact sources while the `main` pointer remains unchanged.

**Step 3: Preserve v03 authored planning work**

Commit the three modified authority/plan documents, all untracked human-authored blueprints, and this umbrella plan on `codex/unified-growth-opportunity-v03`.

Do not add:

- `apps/web/.next-codex-step4/`
- `apps/web/.next-demo-3112/`
- `apps/web/.next-mock-3112/`
- `apps/web/.next-probe-3155/`

**Step 4: Ignore generated local runtime output**

Add narrow ignore entries for `.gstack/` and `apps/web/.next-*/`. Do not delete existing QA evidence or runtime directories.

**Step 5: Bring the preserved Artifact sources onto v03**

Cherry-pick the safety commit containing only the Artifact/manual files.

**Step 6: Verify preservation**

Run:

```bash
git status --short
node scripts/verify-static-customer-artifact.cjs
node scripts/verify-product-manual.cjs
git diff --check
```

Expected: human-authored sources are committed; only ignored generated state remains; both Artifact verifiers pass or produce a concrete update list without data loss.

---

### Task 2: Replace stale project authority and progress reporting

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/PROGRESS.md`
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`
- Verify: `scripts/spec-v0.3-lock.json`
- Verify: `authority/implementation-spec-v0.3/`

**Step 1: Write a failing documentation consistency test**

Create or extend a Node verifier test that fails when:

- customer product version differs from `package.json`;
- `docs/PROGRESS.md` reports operation/table/async counts different from `scripts/spec-v0.3-lock.json`;
- `CLAUDE.md` names the old v0.2 authority as current;
- primary navigation documentation is not the four-entry model;
- documentation calls the current Content Shadow published.

**Step 2: Run the test and verify failure**

Expected: FAIL on stale `0.2.0`, `26 API`, `5 async`, `28 tables`, and permanent “no CMS/GitHub” wording.

**Step 3: Update the authority narrative**

Document:

- Nevermore internal / GenGrowth customer naming;
- active v0.3 authority and contract;
- current four-route product baseline;
- completed Slice 1 and Slice 2 capabilities;
- current no-external-write boundary as a v0.3 fact;
- v0.4 publication/attribution as the next reviewed slice, not an already-shipped claim.

Do not change v0.3 machine authority to claim v0.4 operations before their routes, migrations, and tests exist.

**Step 4: Regenerate factual progress**

Populate `docs/PROGRESS.md` from current evidence:

- exact HEAD and branch;
- package/contract version;
- migration range;
- API/async/table/rule counts;
- fresh lint/typecheck/unit/build/targeted E2E evidence;
- repository-recorded integration/real E2E evidence clearly distinguished from freshly rerun evidence;
- remaining hosted/provider/Owner gates.

**Step 5: Verify**

Run:

```bash
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
node --test <documentation-consistency-test>
git diff --check
```

Expected: all PASS.

---

### Task 3: Converge customer branding and the visible connection surface

**Files:**

- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/new-project/page.tsx`
- Modify: `apps/web/src/app/p/[projectId]/layout.tsx`
- Modify: `packages/i18n/src/messages/zh-CN.json`
- Modify: `packages/i18n/src/messages/en.json`
- Modify: `apps/web/src/app/p/[projectId]/sources/_sources.tsx`
- Modify: `apps/web/src/app/p/[projectId]/sources/sources.module.css`
- Modify: `e2e/mock-api.ts`
- Modify: `e2e/critical-flows.mock.spec.ts`
- Test: `packages/i18n/src/__tests__/parity.test.ts`
- Test: `apps/web/src/app/p/[projectId]/sources/_sources-readiness.test.ts`

**Step 1: Write failing brand and connection tests**

Assert:

- metadata, login, new project, and project shell render `GenGrowth`, not `SignalFrame`;
- the Chinese UI remains the default;
- the customer-managed connector cards are exactly GSC, GA4, and GitHub;
- GitHub is labelled `待接入` until the live adapter lands and has no fake connect success;
- Crawl, CSV, and DataForSEO are absent from the customer-managed card collection;
- internal-source readiness remains available to audit gates and evidence projections;
- every visible connector action opens a real configuration dialog/route or is an explicit non-action state.

**Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run --project unit packages/i18n/src/__tests__/parity.test.ts 'apps/web/src/app/p/[projectId]/sources/_sources-readiness.test.ts'
pnpm playwright test --config=playwright.mock.config.ts e2e/critical-flows.mock.spec.ts
```

Expected: FAIL on SignalFrame copy, five visible providers, and missing GitHub card.

**Step 3: Implement presentation-only provider separation**

Keep existing Crawl/CSV/DataForSEO service contracts and internal operations intact. Change only the customer presentation:

- GSC and GA4 use their real existing controls;
- GitHub renders an honest `planned` card in this task;
- internal sources move into a compact evidence-readiness summary without connection controls.

**Step 4: Replace customer-visible branding**

Replace only customer-visible strings. Do not rename packages, database schemas, contract IDs, historical export versions, or test database prefixes.

**Step 5: Verify**

Run the focused unit/E2E tests, `pnpm lint`, `pnpm typecheck`, and `git diff --check`.

---

### Task 4: Verify v03 and fast-forward Nevermore main

**Files:**

- Review: all `main...codex/unified-growth-opportunity-v03` changes
- Verify: `.github/workflows/ci.yml`
- Verify: `docs/PROGRESS.md`

**Step 1: Run the complete candidate gate**

Run:

```bash
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
pnpm openapi:lint
pnpm contracts:check
pnpm db:migrate:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e:mock
pnpm build
git diff --check
```

Use a fresh explicitly disposable loopback database for database-backed gates.

**Step 2: Review the complete diff**

Obtain correctness, security, and accessibility review. Resolve all P0/P1 findings and any P2 that can cause client-visible inconsistency or data dishonesty.

**Step 3: Advance main without rewriting history**

After proving `main` is an ancestor, advance `main` using `--ff-only`. Preserve the local safety branch and Artifact history until the merged SHA passes all gates.

**Step 4: Verify the exact merged SHA**

Rerun spec, lint, typecheck, unit, targeted browser, build, and `git diff --check` on `main`.

Expected: Nevermore `main` is the sole local integration baseline.

---

### Task 5: Rebuild the complete Chinese-first customer Artifact from the unified baseline

**Files:**

- Modify: `scripts/build-static-customer-artifact.mjs`
- Modify: `scripts/build-product-manual.mjs`
- Modify: `scripts/verify-static-customer-artifact.cjs`
- Modify: `scripts/verify-product-manual.cjs`
- Regenerate: `docs/artifacts/GenGrowth-Interactive-Artifact.html`
- Regenerate: `docs/artifacts/GenGrowth-Product-Manual.html`
- Create: `e2e/complete-customer-artifact.spec.ts`

**Step 1: Write failing completeness tests**

The Artifact must contain:

- all four primary modules, not only completed slices;
- product profile and connection setup as secondary flows;
- at least eight URLs with URL-specific selection and details;
- Keyword and Competitor libraries with source provenance;
- real-looking but explicitly labelled scenario content for future publication/attribution;
- readable Technical Ticket, Metadata Rewrite, Content Brief, English Blog Draft, QA, Revision Review, Publish/Change Receipt, UTM plan, and Results;
- Chinese-first controls and English article output;
- no dead tabs, rows, buttons, dialogs, pagination, or browser-history interactions;
- no internal `slide`, phase, queue, rule-instruction, or architecture narration as hero content;
- 1440/1024/768/390 no root overflow and 16px minimum primary reading text.

**Step 2: Prove current Artifact failure**

Run both current verifiers and the new Playwright test. Record every missing interaction or stale module.

**Step 3: Build from one canonical scenario model**

Generate both HTML deliverables from the same deterministic model. Every count, URL, Keyword, Competitor, Artifact, receipt, and result must derive from that one model to prevent cross-page drift.

**Step 4: Make every interaction stateful**

Use query/hash/history state for:

- primary route;
- Growth Map object mode;
- selected URL/Keyword/Competitor;
- filters;
- selected execution item;
- dialogs/drawers;
- Results window.

**Step 5: Verify**

Run syntax checks, both Node verifiers, Playwright at four viewports, axe, keyboard/dialog checks, browser back/forward checks, and screenshot review.

---

### Task 6: Close external research and content-quality gaps

**Files:**

- Modify: `packages/flow-shadow/src/research/research-pack.ts`
- Modify: `packages/flow-shadow/src/research/manifest.ts`
- Modify: `packages/flow-shadow/src/qa/*`
- Modify: `apps/web/src/lib/services/content-shadow.ts`
- Modify: `apps/worker/src/content-shadow/run-content-shadow.ts`
- Modify: `apps/web/src/app/p/[projectId]/execution/_content-shadow.tsx`
- Modify: `apps/web/src/app/p/[projectId]/execution/_qa-view.ts`
- Test: existing Flow Shadow unit/integration/E2E suites

**Step 1: Write failing quality tests**

Cover:

- governed external source retrieval with immutable URL/content hash/captured time;
- first-party page content, not identity alone, for link and claim decisions;
- duplicate-content and near-duplicate detection;
- unsupported external factual claims fail closed;
- brand-voice and claim-restriction checks;
- research source metrics and evidence refs;
- complete revision history, not only current/judged/brief;
- deterministic replay with no hidden network access.

**Step 2: Add a provider boundary**

Use the existing source/snapshot/evidence model. Network retrieval happens only in a controlled worker adapter with URL safety, size/time limits, provenance, and cost limits. Pure QA remains deterministic and receives frozen inputs.

**Step 3: Render customer-readable research and QA**

Show conclusions first. Put source manifests, hashes, rules, and detailed claims in drawers.

**Step 4: Verify**

Run Flow Shadow unit, integration, content vertical E2E, security, and deterministic replay tests.

---

### Task 7: Version the v0.4 authorized-publication authority

**Files:**

- Create: `authority/implementation-spec-v0.4/`
- Create: `scripts/spec-v0.4-lock.json`
- Create: `packages/contracts/src/zod/publication.ts`
- Create: `packages/contracts/src/zod/publication.test.ts`
- Create: `packages/db/migrations/0022_publication_foundation.sql`
- Modify: `openapi/mvp.yaml`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Modify: all independent authority/implementation verifiers

**Step 1: Write failing contract and verifier tests**

The publication contract must require:

- project/site-scoped target;
- provider kind `github | wordpress`;
- exact approved Artifact Revision;
- preview reference;
- idempotency key;
- side-effect class `external_write`;
- explicit authorization snapshot;
- rollback plan;
- current remote revision precondition.

Reject:

- stale approval;
- mutable/unfrozen content;
- provider target outside the project/site;
- missing preview or rollback data;
- replay with a different request hash;
- a second active publication for the same target;
- any positive Results claim derived only from a receipt.

**Step 2: Add append-only publication persistence**

Introduce narrowly owned tables:

- `publication_targets`;
- `publication_attempts`;
- `publication_receipts`.

`async_runs` remains status truth. The new tables own target identity, frozen request/approval/preview/rollback lineage, remote response facts, and immutable receipts—not a second generic workflow status.

**Step 3: Evolve authority atomically**

Update v0.4 narrative, SQL, OpenAPI, lock, generated contracts, route expectations, migration expectations, package/runtime versions, and both verifiers in the same commit.

**Step 4: Verify**

Run contract, migration, authority, implementation, OpenAPI, generation, and integration gates.

---

### Task 8: Implement GitHub PR and WordPress publish adapters

**Files:**

- Create: `packages/publishing/`
- Create: `apps/web/src/lib/services/publication.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/publications/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/publications/[publicationId]/route.ts`
- Create: `apps/worker/src/publication/`
- Create: `apps/worker/src/handlers/publication.ts`
- Modify: `apps/worker/src/handlers/recovery.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/web/src/app/p/[projectId]/sources/_sources.tsx`
- Modify: `apps/web/src/app/p/[projectId]/execution/*`

**Step 1: Write adapter contract tests**

Use deterministic fake providers to prove:

- preflight and remote revision checks;
- dry-run/preview;
- idempotent create/update;
- partial failure recording;
- rollback reference creation;
- secret redaction;
- bounded time/body/retry behavior;
- exact remote IDs/URLs/checksums in receipts.

**Step 2: Implement GitHub as the first live connector**

Use GitHub App installation authorization. The safe default delivery is:

1. create/update a branch;
2. commit the exact approved revision;
3. open a PR;
4. wait for human merge;
5. verify merged SHA and deployed/live URL separately.

Never auto-merge by default.

**Step 3: Implement WordPress as the first CMS adapter**

Use a site-scoped WordPress REST credential stored encrypted. Default to draft or scheduled post creation; publishing requires a separate explicit approval. Record post ID, revision, canonical URL, status, and rollback reference.

**Step 4: Connect customer UI**

The GitHub card becomes live only after the route/provider path exists. Execution exposes Preview, Create PR/Create Draft, Receipt, Retry, and Rollback Request with precise permission/error states.

**Step 5: Verify**

Run unit/integration/mock E2E, recovery, secret-scan, and one Owner-approved sandbox-provider smoke for each adapter. Never run live writes against an unapproved repository/site.

---

### Task 9: Add immutable measurement windows and UTM attribution

**Files:**

- Create: `packages/contracts/src/zod/measurement.ts`
- Create: `packages/contracts/src/zod/measurement.test.ts`
- Create: `packages/db/migrations/0023_measurement_windows.sql`
- Create: `packages/db/src/repositories/measurement-windows.ts`
- Create: `apps/web/src/lib/services/measurement.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/measurement-windows/route.ts`
- Create: `apps/worker/src/measurement/`
- Modify: `openapi/mvp.yaml`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Modify: v0.4 authority and verifiers

**Step 1: Write failing measurement-contract tests**

Require:

- target/action/artifact revision/publication receipt lineage;
- immutable baseline and outcome snapshot IDs;
- absolute before/after windows;
- timezone;
- URL and canonical URL;
- UTM source/medium/campaign/content identity;
- provider/source freshness;
- sample size and limitation;
- direct and assisted conversion definitions;
- `technical_verified | observed | insufficient_data | unavailable | regressed`;
- nullable metrics where unavailable.

**Step 2: Add persistence without claiming causality**

Introduce narrowly owned measurement-window and campaign identity tables. Reuse canonical GSC/GA4 snapshots and normalized observations. Do not duplicate raw provider data.

**Step 3: Add asynchronous collection**

Anchor outcome collection to the actual publication/change receipt. A configured provider without a usable snapshot remains unavailable. Missing rows never become zero.

**Step 4: Verify**

Run migration, repository isolation, provider fixture, idempotency, unavailable/null, and window-classification tests.

---

### Task 10: Upgrade Results to customer-readable before/after attribution

**Files:**

- Modify: `apps/web/src/lib/services/recheck-results.ts`
- Create or modify: `apps/web/src/lib/services/measurement-results.ts`
- Modify: `apps/web/src/app/p/[projectId]/results/_results.tsx`
- Modify: `apps/web/src/app/p/[projectId]/results/results.module.css`
- Modify: `apps/web/src/app/p/[projectId]/results/_report-document.tsx`
- Modify: Results export projections
- Test: Results unit/integration/E2E suites

**Step 1: Write failing Results tests**

Assert the page separately renders:

- technical recheck;
- page-level GSC before/after;
- GA4 landing/conversion before/after;
- UTM audit table;
- direct and assisted conversions;
- AI/GEO observation when available;
- publication/change timeline;
- source/freshness/window/sample/limitation;
- pending, insufficient, unavailable, and regressed states.

**Step 2: Preserve separate query boundaries**

Technical recheck remains a truthful independent projection. Measurement failure cannot erase technical verification, and report/export failure cannot erase either result block.

**Step 3: Implement Chinese-first result explanation**

Use exact dates and plain Chinese explanations. Do not use “lift” or causal language unless a separately reviewed experimental design supports it.

**Step 4: Verify**

Run Results unit/integration/mock/real E2E, export, print, mobile, accessibility, and no-overflow tests.

---

### Task 11: Complete the end-to-end customer and production acceptance

**Files:**

- Update: `docs/PROGRESS.md`
- Update: `docs/LAUNCH-CHECKLIST.md`
- Create: `docs/reviews/2026-XX-XX-nevermore-v0.4-stop-gate.md`
- Update: complete customer Artifact and manual

**Step 1: Prove the complete chain**

One test project must complete:

```text
Product URL
→ Product Profile review
→ GSC/GA4/GitHub readiness
→ Growth Audit
→ URL/Keyword/Competitor Growth Map
→ content or technical Opportunity
→ Action and Artifact Revision
→ English Draft / Code Fix review
→ authorized GitHub PR or WordPress Draft
→ Publication/Change Receipt
→ technical recheck
→ GSC/GA4/UTM outcome window
→ Results and customer export
```

**Step 2: Run full repository gates**

Run all authority, contract, migration, lint, typecheck, unit, integration, mock E2E, real E2E, build, secret, restore, responsive, accessibility, and visual gates on the exact release SHA.

**Step 3: Run hosted safe acceptance**

Deploy Vercel Web and Railway Worker from the same immutable SHA. Verify:

- `/health/version`;
- worker readiness lease;
- authenticated project flow;
- live GSC/GA4 reads;
- Owner-approved GitHub sandbox PR;
- Owner-approved WordPress sandbox draft;
- no secrets/customer payloads in evidence.

**Step 4: Refresh the complete Artifact**

The standalone customer Artifact must represent the complete released product, not only earlier completed slices. Scenario-only values remain labelled.

**Step 5: Stop gate**

Do not mark complete until every explicit requirement has direct code/runtime/test evidence and the Owner approves the customer-visible product walkthrough.
