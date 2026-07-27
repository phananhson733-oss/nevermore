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
- Crawl, CSV, and DataForSEO remain in service/audit readiness and evidence
  provenance, but their names and controls do not appear on the customer
  Connections page. A generic aggregate readiness explanation may remain; it
  must not look like another connector collection or use an unexplained hidden
  denominator. Customer-visible analysis readiness is derived only from GSC and
  GA4; GitHub remains a planned delivery connector and is not counted as an
  analysis source.
- Customer-visible snapshot history is fetched with server-side GSC and GA4
  provider filters. Hidden provider rows and cursors must not affect visible
  history counts, completeness, retry states, or Load More behavior.

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

- Create: `docs/artifact-src/README.md`
- Create: `docs/artifact-src/styles.css`
- Create: `docs/artifact-src/workspace-data.js`
- Create: `docs/artifact-src/client-app.js`
- Create: `scripts/resolve-artifact-source.mjs`
- Modify: `scripts/build-static-customer-artifact.mjs`
- Modify: `scripts/build-product-manual.mjs`
- Modify: `scripts/verify-static-customer-artifact.cjs`
- Modify: `scripts/verify-product-manual.cjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
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

Run both current verifiers and the new Playwright test. Record every missing
interaction or stale module. The current hard-coded
`/Users/.../.codex/visualizations` input and
`/tmp/gengrowth-artifact-jsdom-*` dependency must fail this reproducibility
gate; generated output containing any workstation path must also fail.

**Step 3: Bring the executable Artifact source into the repository**

Vendor the historical `styles.css`, `workspace-data.js`, and `client-app.js` as
the initial `docs/artifact-src/` baseline, preserving provenance in its README.
After that commit, the historical visualization folder is reference-only and
must never be a build or verification input.

Declare `jsdom` as a normal repository development dependency and wire:

- `artifact:build`;
- `artifact:manual`;
- `artifact:verify`;
- `artifact:regen`;
- `test:e2e:artifact`.

CLI overrides may remain as diagnostics, but all defaults must resolve from the
repository root. The builders and verifiers must reject absolute user paths,
`.codex/visualizations`, the historical `/tmp` dependency root, and remote asset
dependencies in generated customer files.

**Step 4: Build both outputs from one canonical scenario model**

Generate the interactive HTML and manual from the same repo-owned deterministic
`workspace-data.js`. Every count, URL, Keyword, Competitor, Artifact, receipt,
and result must derive from that one model to prevent cross-page drift. The
manual may inspect the built Artifact, but it may not read a second external
workspace snapshot.

**Step 5: Make every interaction stateful**

Use query/hash/history state for:

- primary route;
- Growth Map object mode;
- selected URL/Keyword/Competitor;
- filters;
- selected execution item;
- dialogs/drawers;
- Results window.

**Step 6: Verify**

Run `pnpm artifact:regen`, both Node verifiers with no dependency-path
arguments, Playwright at four viewports, axe, keyboard/dialog checks, browser
back/forward checks, screenshot review, and `git diff --check`. Re-run generation
once more and require a clean diff.

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

### Task 7: Review the v0.4 authority without promoting the live contract

**Files:**

- Create: `authority/implementation-spec-v0.4/`
- Create: `authority/implementation-spec-v0.4/openapi.candidate.yaml`
- Create: `authority/implementation-spec-v0.4/schema.candidate.sql`
- Create: `authority/implementation-spec-v0.4/provider-boundaries.md`
- Create: `authority/implementation-spec-v0.4/acceptance-matrix.md`
- Create: `scripts/spec-v0.4-candidate-lock.json`
- Modify: authority discovery so v0.4 is reported as `candidate` while v0.3 remains active

**Step 1: Write failing candidate-authority verifier tests**

The candidate publication contract must require:

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

The provider boundary must also specify:

- GitHub App installation authorization, repository selection, branch/base-branch scope, and permission checks;
- WordPress site-scoped credential setup, encrypted-secret reference, capability probe, and author/status limits;
- separate `delivery_receipt` and `change_receipt` semantics;
- a reconciliation path that confirms GitHub merge plus live deployment, or WordPress `publish` plus a live canonical URL;
- explicit `pending`, `unavailable`, and revocation behavior.

**Step 2: Model append-only persistence without a second target truth**

The candidate schema may introduce narrowly owned tables such as:

- `artifact_approval_events`;
- `publication_destinations`;
- `publication_attempts`;
- `publication_receipts`.

`async_runs` remains status truth. Publication rows reference the canonical
`target_ref`, action, Artifact, and exact Artifact Revision. They own only the
provider destination, frozen authorization/preview/rollback request, remote
response facts, and immutable receipt facts. They never create or own a second
canonical target identity.

`execution_artifacts.status = ready` is not a durable approval event. The
candidate must therefore define an append-only `artifact_approval_events`
authority bound to one exact `artifact_revision_id`, revision number and content
hash. Publication attempts reference that event with an enforced foreign key.
Editing the Artifact, superseding/revoking the approval, changing the QA gate,
or changing the content hash makes the approval ineligible before any external
write. A response-only Content Shadow review receipt or `updated_at` timestamp
must never be used as publication authorization truth.

**Step 3: Keep the current contract untouched**

Do not modify `openapi/mvp.yaml`, generated clients, active migrations, runtime
packages, or the v0.3 lock in this task. The v0.4 folder is a reviewed,
non-normative candidate until Task 8 promotes candidate authority together with
working routes, repositories, workers, provider adapters, and tests in one
atomic implementation change.

**Step 4: Verify**

Run the candidate-authority verifier, current v0.3 authority/spec verifiers, and
`git diff --check`. Expected: v0.4 candidate passes its review matrix while the
active machine surface remains exactly v0.3.

---

### Task 8: Atomically promote authorization, publication, and provider adapters

**Files:**

- Create: `packages/contracts/src/zod/delivery-connections.ts`
- Create: `packages/contracts/src/zod/delivery-connections.test.ts`
- Create: `packages/contracts/src/zod/artifact-approval.ts`
- Create: `packages/contracts/src/zod/artifact-approval.test.ts`
- Create: `packages/contracts/src/zod/publication.ts`
- Create: `packages/contracts/src/zod/publication.test.ts`
- Create: `packages/db/migrations/0022_publication_foundation.sql`
- Create: artifact-approval, delivery-connection and publication repositories
- Create: `packages/publishing/`
- Create: GitHub App install/callback/repository-selection routes
- Create: WordPress site/credential/capability-probe routes
- Create: `apps/web/src/lib/services/publication.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/publications/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/publications/[publicationId]/route.ts`
- Create: `apps/worker/src/publication/`
- Create: `apps/worker/src/handlers/publication.ts`
- Modify: `apps/worker/src/handlers/recovery.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/web/src/app/p/[projectId]/sources/_sources.tsx`
- Modify: `apps/web/src/app/p/[projectId]/execution/*`
- Modify: `openapi/mvp.yaml`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Create: `scripts/spec-v0.4-lock.json`
- Modify: v0.4 authority and all independent authority/implementation verifiers

**Step 1: Write connection, publication, and adapter contract tests**

Use deterministic fake providers to prove:

- append-only approval of one exact Artifact Revision/content hash, explicit
  reviewer/acknowledgement/QA lineage, stale-revision refusal and revocation;
- GitHub installation/repository authorization and WordPress site capability probing;
- project/site ownership, revocation, encrypted-secret references, and redacted responses;
- preflight and remote revision checks;
- dry-run/preview;
- idempotent create/update;
- partial failure recording;
- rollback reference creation;
- secret redaction;
- bounded time/body/retry behavior;
- exact remote IDs/URLs/checksums in receipts.

Reject a publication request until its provider destination is live, scoped to
the project/site, and the exact Artifact Revision has a current append-only
approval event. `execution_artifacts.status = ready` alone is never sufficient.

**Step 2: Implement GitHub as the first live delivery connector**

Use GitHub App installation authorization. The safe default delivery is:

1. create/update a branch;
2. commit the exact approved revision;
3. open a PR;
4. wait for human merge;
5. verify merged SHA and deployed/live URL separately.

Creating or updating a PR produces a `delivery_receipt`, not a
`change_receipt`. Never auto-merge by default. A reconciler or explicit
confirmation route creates the immutable `change_receipt` only after the merge
SHA and the actual live/deployed URL have been verified.

**Step 3: Implement WordPress as the first CMS adapter**

Use a site-scoped WordPress REST credential stored encrypted. Default to draft or scheduled post creation; publishing requires a separate explicit approval. Record post ID, revision, canonical URL, status, and rollback reference.

A draft/scheduled creation produces a `delivery_receipt`. The reconciler creates
a `change_receipt` only when WordPress reports `publish` and the canonical URL
passes the bounded live-page verification.

**Step 4: Promote the live contract atomically**

In the same implementation change, promote the reviewed v0.4 candidate into
`openapi/mvp.yaml`, migration `0022`, generated contracts, runtime package
versions, lock, route expectations, and both authority/implementation
verifiers. Flip authority discovery from v0.4 `candidate` to v0.4 `active` in
that same commit, after all promotion gates pass. No operation or table enters
the active lock without its working route/repository/worker and tests.

**Step 5: Connect customer UI**

The GitHub card becomes live only after its installation, repository selection,
permission, and readiness path exists. WordPress setup is exposed only in the
publication destination flow; it does not become a fourth top-level customer
data-source card. Execution exposes Preview, Create PR/Create Draft, Delivery
Receipt, Change Receipt, Retry, and Rollback Request with precise
permission/error states.

**Step 6: Verify**

Run current and candidate authority checks, contract, migration, unit,
integration, mock E2E, recovery, secret-scan, and one Owner-approved
sandbox-provider delivery smoke for each adapter. Never run live writes against
an unapproved repository/site. A PR-open or Draft-create smoke proves delivery,
not publication.

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

- target/action/artifact revision/`change_receipt` lineage;
- optional `delivery_receipt` lineage for timeline and audit display only;
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

Anchor outcome collection only to an actual `change_receipt`. A
`delivery_receipt` for an open PR, draft, or scheduled post keeps the window
`pending` and never starts the outcome clock. A configured provider without a
usable snapshot remains unavailable. Missing rows never become zero.

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

One deterministic acceptance project must complete:

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
→ Delivery Receipt
→ human merge/publish and live URL verification
→ Change Receipt
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

PR creation and draft creation are delivery smoke tests. If the Owner also
approves a sandbox merge/publish, verify the resulting Change Receipt. Without
that additional approval, hosted acceptance must show `pending`, not fabricate a
publication or outcome.

**Step 4: Refresh the complete Artifact**

The standalone customer Artifact must represent the complete released product, not only earlier completed slices. Scenario-only values remain labelled.

**Step 5: Separate release acceptance from elapsed-time measurement follow-up**

The release SHA may pass at T0 with:

- deterministic provider fixtures proving full window classification;
- live delivery smoke receipts;
- honest real-project states of `pending`, `insufficient_data`, or
  `unavailable`;

When a real immutable Change Receipt exists, schedule the elapsed-time follow-up
against that receipt and the release SHA. When the Owner has approved only a
delivery smoke and no Change Receipt exists, do not schedule a measurement
follow-up yet; hosted acceptance passes with an honest delivery-only `pending`
state.

After the configured absolute window has elapsed, append the real GSC/GA4/UTM
outcome observations and rerun the customer Results review. Do not hold the code
release hostage to future data, and do not treat missing elapsed-time evidence
as zero or positive lift.

**Step 6: Stop gate**

Do not mark the implementation complete until every code/runtime requirement has
direct test evidence, provider delivery smoke is recorded when Owner-approved,
honest pending/unavailable states pass, and the Owner approves the
customer-visible product walkthrough. Do not mark the operational measurement
follow-up complete until its real absolute window has elapsed and been reviewed.
