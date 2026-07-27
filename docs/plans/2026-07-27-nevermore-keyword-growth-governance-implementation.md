# Nevermore Keyword Growth Governance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the audited 13 keyword/SEO/GEO requests into a production-ready Nevermore capability that preserves one canonical opportunity lifecycle, presents every capability inside the existing Chinese-first four-module customer Artifact, and closes the loop from governed keyword decisions through execution evidence to receipt-backed measurement.

**Architecture:** Extend the existing append-only keyword, competitor, evidence, finding, action, artifact, and observation foundation instead of creating a parallel SEO product. Introduce stable Topic identities and append-only governance decisions, project them through versioned OpenAPI read/write contracts, then add monitoring and external evidence only after their lineage and provider boundaries are real.

**Tech Stack:** TypeScript, Next.js App Router, React 19, Zod, OpenAPI 3.1, Drizzle ORM, PostgreSQL, pg-boss, Vitest, Playwright, Node.js 24, pnpm.

---

## Implementation authority

- Design: `docs/plans/2026-07-27-nevermore-keyword-growth-governance-design.md`
- Original requirements: `gengrowth-ops/inbox-maboyang/00-inbox/2026-07-23-gengrowth工具优化需求-关键词库模块.md`
- Current customer IA: `概览 / 增长地图 / 执行中心 / 效果追踪`
- Customer-visible connectors: GSC, GA4, GitHub only
- Internal product/repository: Nevermore
- Customer brand: GenGrowth
- Current production baseline begins at commit `df2e001`
- Use `@frontend-design` for Artifact and graph/chart UI work.
- Use `@tdd-workflow` for every database, contract, service, route, and UI slice.
- Before each stage exit, use `@verification-loop` or the repository-equivalent verification commands.

## Completion rule

An audited requirement is not complete because its Artifact screen exists. Each requirement receives a row in the acceptance matrix and may be marked complete only when all applicable evidence exists:

1. migration/schema;
2. repository/domain invariant;
3. Zod/OpenAPI/generated client;
4. service/route/mutation;
5. Chinese-first UI and accessible interaction;
6. unit/integration/E2E;
7. real provider or explicit unavailable state.

Requirement 9 has two independent completion flags:

- `rank_history_complete`;
- `receipt_backed_results_complete`.

The whole requirement is complete only when both are true.

---

## Required convergence prerequisite and migration allocation

Tasks 1–3 below may run immediately because they create only the repository-owned
complete customer Artifact and its secondary audit Evidence. The default
experience must be `概览 / 增长地图 / 执行中心 / 效果追踪`; the requirement register
must never become a fifth module or the primary page.

Before Task 4 begins:

1. complete the review-only Task 7 candidate authority; and
2. implement and verify Tasks 8–9 of:

`docs/plans/2026-07-27-nevermore-customer-artifact-and-production-convergence.md`

That prerequisite atomically owns:

- `0022_publication_foundation.sql`;
- `0023_measurement_windows.sql`;
- Publication/Change Receipt;
- immutable Measurement Window;
- the v0.4 authority and global verifier promotion.

Convergence Task 10 is not a storage or authority prerequisite for Topic
identity, Keyword Review decisions, duplicate governance, Artifact sources,
Action blockers/progress, or raw Keyword Rank History. It may proceed in
parallel after Tasks 8–9, but it must be complete before Keyword Task 19 begins
receipt-backed Results work.

Do not create a Keyword migration while those two reserved migrations are absent. Do not renumber the publication/measurement migrations from this plan. After the prerequisite is merged into the same branch and fresh-database verification passes, Keyword Growth owns the following allocation:

| Migration | Owner |
| --- | --- |
| `0024_keyword_governance_foundation.sql` | Topic identity and Keyword Review ledger |
| `0025_keyword_relation_governance.sql` | duplicate/cannibalization relations |
| `0026_action_execution_state.sql` | blockers and business progress |
| `0027_opportunity_decision_ledger.sql` | durable opportunity decisions |
| `0028_internal_link_observations.sql` | only if the edge audit proves a new table is necessary |
| `0029_content_decay_monitor.sql` | decay policy and alert state |
| `0030_competitor_monitoring.sql` | schedule, snapshots, deltas |
| `0031_keyword_voc_sources.sql` | Interview/User Review source expansion |
| `0032_geo_citation_observations.sql` | GEO observations |
| `0033_backlink_observations.sql` | backlink observations/import |

If another reviewed change lands a migration before Task 4 starts, stop and update this allocation in both design/implementation authority before writing SQL. Never resolve a collision by silently renaming a migration after it has been applied.

Every stage that changes OpenAPI operations or app tables must update, in the same stage-gate commit:

- `scripts/verify-implementation.mjs`;
- `scripts/verify-implementation-source.test.mjs`;
- the active spec/authority lock introduced by the v0.4 prerequisite;
- exact expected operation/table/async-route counts.

The local `verify-keyword-stage-gates` script is additive. It never replaces `pnpm implementation:check`.

---

## Stage 0 — Integrated four-module customer Artifact

### Task 1: Freeze the integrated product and secondary-audit source contract

**Files:**

- Create: `docs/keyword-audit-artifact-src/README.md`
- Create: `docs/keyword-audit-artifact-src/audit-data.js`
- Create: `scripts/verify-keyword-audit-data.test.mjs`
- Modify: `package.json`

**Step 1: Write the failing data verifier**

Create a Node test that imports/evaluates `audit-data.js` and asserts:

```js
assert.equal(audit.requirements.length, 13);
assert.deepEqual(
  audit.requirements.map((item) => item.id),
  Array.from({ length: 13 }, (_, index) => index + 1),
);
assert.deepEqual(
  new Set(audit.requirements.map((item) => item.decision)),
  new Set(["adopt", "rewrite", "defer"]),
);
```

For every requirement assert non-empty:

- source statement;
- current truth state;
- current canonical evidence label;
- decision and rationale;
- rewritten acceptance;
- affected modules;
- implementation stage;
- dependencies;
- completion evidence;
- not-included boundary.

Also assert:

- only GSC, GA4, and GitHub appear in `customerVisibleConnectors`;
- all 13 original requirements are represented once;
- requirement 9 has two completion flags;
- requirement 11 is not in the current launch stage;
- requirement 12 says `observation`, not causal attribution;
- no workstation path, credential, `SignalFrame`, `signalframe-mvp-app`, or `@sf/` appears in customer-visible data.

Add and verify `integratedProduct` as the primary contract:

- exactly four modules in this order: `overview / growth-map / execution / results`;
- a unified lifecycle from URL/Product Profile through Growth Map, Execution,
  Receipt and Results;
- all 13 capabilities mapped into those four modules with an entry point,
  canonical objects, governed action and next hop;
- `current / next / provider-dependent` truth states;
- only GSC, GA4 and GitHub as customer-visible connections;
- the original `requirements` register marked `secondary-evidence`;
- no RelayOps scenario identity or fabricated business metrics.

**Step 2: Run the test and verify failure**

Run:

```bash
node --test scripts/verify-keyword-audit-data.test.mjs
```

Expected: FAIL because the source does not exist.

**Step 3: Add the repository-owned audit source**

Define:

```js
window.NevermoreKeywordAudit = Object.freeze({
  version: "2.0.0",
  reviewedAt: "2026-07-27",
  title: "Nevermore · SEO/GEO 增长工作台",
  customerVisibleConnectors: ["GSC", "GA4", "GitHub"],
  integratedProduct: {
    requirementsEvidenceRole: "secondary-evidence",
    modules: [/* overview, growth-map, execution, results */],
    capabilities: [/* all 13 requirements placed in existing modules */],
    canonicalObjects: [/* current and target truth */],
    lifecycle: [/* complete cross-module flow */],
    crossModuleJourneys: [/* content, technical, monitoring */],
  },
  requirements: [/* exact 13 audited records */],
  modules: [/* compatibility projection of the four modules */],
  stages: [/* stage 1, 2, 3 */],
  acceptanceLayers: [/* data, contract, service, ui, mutation, tests, provider */],
});
```

The source contains the complete product placement plus the real audit evidence,
not RelayOps scenario metrics. Use Chinese for explanatory copy and English only
for stable product/domain nouns.

**Step 4: Add a source README**

Document:

- the original requirement provenance;
- design document authority;
- current/target truth labels;
- standalone generated output path;
- deterministic build rule;
- no remote asset or workstation path rule;
- primary Artifact is the complete four-module product experience;
- audit decisions are secondary Evidence, not the product IA;
- target screens are not production-completion evidence.

**Step 5: Run the test and verify pass**

Run:

```bash
node --test scripts/verify-keyword-audit-data.test.mjs
```

Expected: PASS, 13 requirements covered.

**Step 6: Commit**

```bash
git add package.json docs/keyword-audit-artifact-src scripts/verify-keyword-audit-data.test.mjs
git commit -m "docs(keyword): freeze audit artifact data"
```

---

### Task 2: Build the Chinese-first integrated product interface

**Files:**

- Create: `docs/keyword-audit-artifact-src/styles.css`
- Create: `docs/keyword-audit-artifact-src/audit-app.js`
- Create: `scripts/build-keyword-audit-artifact.mjs`
- Create: `docs/artifacts/Nevermore-Keyword-Growth-Audit.html`
- Modify: `package.json`

**Step 1: Write a failing generated-output test**

Extend the data verifier or create `scripts/verify-keyword-audit-artifact.cjs` and assert:

```js
assert.match(html, /data-keyword-audit-build="2\.0-static"/);
assert.match(html, /data-primary-experience="growth-workspace"/);
assert.match(html, /Nevermore · SEO\/GEO 增长工作台/);
assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet/i);
assert.doesNotMatch(html, /\bfetch\s*\(/);
```

Use JSDOM to assert:

- default route is Overview, not the requirement audit;
- the primary nav is exactly the existing four modules;
- Growth Map exposes Page, Keyword, Topic, Competitor, Internal Link,
  Keyword History and External Evidence object views;
- all 13 capabilities have a module entry, readable detail and governed next hop;
- repeated module/object switching and browser history restore state;
- GSC/GA4/GitHub are the only customer connection cards;
- the 13-row audit exists only in a secondary Evidence Dialog;
- no generic toast, mock metric or remote call is used as a visible destination.

**Step 2: Run the verifier and verify failure**

Run:

```bash
node scripts/verify-keyword-audit-artifact.cjs
```

Expected: FAIL because output/source is missing.

**Step 3: Implement the visual system**

Use the existing Nevermore editorial growth-workspace direction:

- warm paper background;
- forest green structural color;
- vermilion review stamps;
- readable Chinese body at 16–18px;
- high-contrast focus ring;
- four-module sidebar, main product surface and contextual detail rail at wide desktop;
- one-column module/detail flow on mobile;
- no small mono-heavy card wall;
- no purple gradients;
- no remote font.

Required regions:

```html
<header>项目身份、GSC / GA4 / GitHub 与方案依据</header>
<nav aria-label="客户工作区">概览 / 增长地图 / 执行中心 / 效果追踪</nav>
<main id="product-content" data-product-surface="overview">
  <section>当前模块的完整客户工作区</section>
  <aside>上下文详情与下一跳</aside>
</main>
<dialog data-audit-evidence-dialog>13 条审核证据</dialog>
```

**Step 4: Implement deterministic state and interactions**

State shape:

```js
const state = {
  view: "overview",
  object: null,
  capability: null,
  target: null,
};
```

Serialize it into:

```text
#/growth-map?object=keyword-library&capability=keyword-relation-governance
```

All list/tab/filter buttons must be delegated through one stable event handler and re-render safely after every click.

**Step 5: Implement the standalone builder**

Read the three source files, guard all paths with `artifact-path-guard.cjs`, inline CSS/JS, escape `</script`, write:

`docs/artifacts/Nevermore-Keyword-Growth-Audit.html`

Do not apply the customer Artifact's automatic `Nevermore → GenGrowth`
sanitizer; this file remains the formal Nevermore product contract even though
its UI is customer-readable. Reject workstation paths, compatibility package
names, network dependencies, credentials, RelayOps scenario identity and
unlabelled mock metrics.

**Step 6: Build and verify**

Run:

```bash
pnpm artifact:keyword-audit
node scripts/verify-keyword-audit-artifact.cjs
```

Expected: both PASS; output is fully standalone.

**Step 7: Commit**

```bash
git add package.json docs/keyword-audit-artifact-src docs/artifacts/Nevermore-Keyword-Growth-Audit.html scripts/build-keyword-audit-artifact.mjs scripts/verify-keyword-audit-artifact.cjs
git commit -m "feat(keyword): deliver interactive audit artifact"
```

---

### Task 3: Add integrated-workspace browser, accessibility, and visual regression gates

**Files:**

- Create: `scripts/serve-keyword-audit-artifact.mjs`
- Create: `playwright.keyword-audit.config.ts`
- Create: `e2e/keyword-audit-artifact.spec.ts`
- Modify: `package.json`

**Step 1: Write the failing Playwright spec**

Cover:

- repository-owned source and generated file;
- no network request;
- `lang=zh-CN`;
- exact four-module primary navigation;
- repeated module, Growth Map object and capability switching;
- all 13 capability entries and governed next hops;
- 13 audit rows only inside secondary Evidence;
- exactly GSC/GA4/GitHub customer connections;
- no RelayOps/mock metrics/toast/network;
- back/forward state restoration;
- desktop 1440×1000;
- tablet 1024×768;
- mobile 390×844;
- no page horizontal overflow;
- focus trap and Escape for dialogs/drawers;
- keyboard operation;
- `prefers-reduced-motion`;
- Axe serious/critical violations equal zero;
- 16px minimum main reading text.

**Step 2: Run and verify failure**

Run:

```bash
pnpm test:e2e:keyword-audit
```

Expected: FAIL because server/config is missing.

**Step 3: Implement the dedicated server/config**

Use port 4175, refuse reuse, serve only:

- `/healthz`;
- `/`;
- `/Nevermore-Keyword-Growth-Audit.html`.

**Step 4: Make the browser test pass**

Fix actual interaction/accessibility/layout defects. Do not weaken selectors or skip Axe failures.

**Step 5: Verify deterministic generation**

Run:

```bash
pnpm artifact:keyword-audit
git diff --exit-code -- docs/artifacts/Nevermore-Keyword-Growth-Audit.html
pnpm test:e2e:keyword-audit
```

Expected: PASS; second generation has no diff.

**Step 6: Commit**

```bash
git add package.json scripts/serve-keyword-audit-artifact.mjs playwright.keyword-audit.config.ts e2e/keyword-audit-artifact.spec.ts
git commit -m "test(keyword): protect audit artifact interactions"
```

---

## Stage 1 — Canonical governance and execution transparency

### Task 4: Add stable Topic identity and Keyword Review decision storage

**Files:**

- Create: `packages/db/migrations/0024_keyword_governance_foundation.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/migrations/schema-smoke.sql`
- Create: `packages/db/src/__tests__/keyword-governance-foundation.integration.test.ts`

**Step 1: Write failing migration integration tests**

Test:

- one stable Topic Node identity per existing distinct reviewed `cluster_key`;
- an initial confirmed Topic Model revision per project with mapped keywords;
- legacy aliases resolve every pre-migration cluster label;
- one `migration_baseline` Keyword Review Decision per existing keyword;
- baseline preserves existing `mapping_revision` and current values;
- no historical intermediate decision is fabricated;
- workspace/project cross-scope references fail;
- confirmed revisions are immutable;
- duplicate current aliases fail;
- split/merge successor relationships cannot form cycles;
- removing an alias referenced by frozen data fails.

**Step 2: Run and verify failure**

Run with the disposable database:

```bash
DATABASE_URL=postgresql://wzb@127.0.0.1:5432/signalframe_codex_keyword_20260727 \
  pnpm vitest run --project integration \
  packages/db/src/__tests__/keyword-governance-foundation.integration.test.ts
```

Expected: FAIL because migration 0024 is missing.

**Step 3: Implement the migration**

Create:

- `topic_model_revisions`;
- `topic_node_identities`;
- `topic_node_revisions`;
- `topic_cluster_aliases`;
- `topic_node_successors`;
- `keyword_review_decisions`.

Core constraints:

```sql
unique (workspace_id, project_id, revision)
unique (workspace_id, project_id, topic_node_id, topic_model_revision)
unique (workspace_id, project_id, legacy_cluster_key, valid_from_revision)
unique (workspace_id, project_id, keyword_entity_id, governance_revision)
check (successor_kind in ('split_into', 'merged_into'))
check (decision_origin in ('migration_baseline', 'user', 'system_suggestion'))
```

Store actor, reason, decided_at, and the full reviewed projection. Use composite scope FKs wherever the schema already exposes them.

**Step 4: Backfill safely**

For each current non-null `cluster_key`:

- create a stable identity;
- create revision 1 node;
- create legacy alias;
- baseline the current keyword review state.

For null clusters, baseline the keyword review without a Topic Node.

**Step 5: Update Drizzle schema and smoke checks**

Add all tables, indexes, enums/checks, and export types. Update table count authority only after verification reports the new exact count.

**Step 6: Run migration tests**

Run:

```bash
pnpm db:migrate:check
DATABASE_URL=postgresql://wzb@127.0.0.1:5432/signalframe_codex_keyword_20260727 \
  pnpm vitest run --project integration \
  packages/db/src/__tests__/keyword-governance-foundation.integration.test.ts \
  packages/db/src/__tests__/keyword-library-foundation.integration.test.ts \
  packages/db/src/__tests__/content-shadow-foundation.integration.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add packages/db/migrations/0024_keyword_governance_foundation.sql packages/db/migrations/schema-smoke.sql packages/db/src/schema.ts packages/db/src/__tests__/keyword-governance-foundation.integration.test.ts
git commit -m "feat(db): add keyword governance foundation"
```

---

### Task 5: Implement Topic/Keyword governance repositories and historical resolution

**Files:**

- Create: `packages/db/src/repositories/topic-models.ts`
- Create: `packages/db/src/repositories/topic-models.test.ts`
- Create: `packages/db/src/repositories/keyword-review-decisions.ts`
- Create: `packages/db/src/repositories/keyword-review-decisions.test.ts`
- Create: `packages/db/src/repositories/topic-cluster-resolver.ts`
- Create: `packages/db/src/repositories/topic-cluster-resolver.test.ts`
- Modify: `packages/db/src/repositories/keywords.ts`
- Modify: `packages/db/src/repositories/keywords.test.ts`
- Modify: `packages/db/src/repositories/topic-clusters.ts`

**Step 1: Write failing repository tests**

Cover:

- draft model create/edit;
- confirmed model cannot mutate;
- confirm creates new immutable revision;
- rename preserves identity and writes alias;
- split/merge creates successor identities and marks affected keywords `unreviewed`;
- old aliases resolve historical Finding/Opportunity refs;
- old Content Shadow cluster keys resolve at their frozen revision;
- new keyword review appends a decision and updates current projection atomically;
- stale `governanceRevision` returns conflict/no write;
- no second topic-assignment ledger exists;
- cross-project keyword/topic assignment fails;
- page mapping remains `mapped_site_page_id`.

**Step 2: Run and verify failure**

Run:

```bash
pnpm vitest run --project unit \
  packages/db/src/repositories/topic-models.test.ts \
  packages/db/src/repositories/keyword-review-decisions.test.ts \
  packages/db/src/repositories/topic-cluster-resolver.test.ts \
  packages/db/src/repositories/keywords.test.ts
```

Expected: FAIL on missing repositories.

**Step 3: Implement atomic keyword review**

The transaction must:

1. lock/read the current entity revision;
2. verify expected revision;
3. resolve Topic Node in the requested confirmed model revision;
4. validate mapped page scope;
5. append `keyword_review_decisions`;
6. update `keyword_entities` compatibility projection;
7. return the new canonical current view.

**Step 4: Implement legacy resolver and dual-read assertion**

Expose:

```ts
resolveClusterAtRevision(scope, {
  clusterKeyAtObservation,
  topicModelRevision,
}): Promise<ResolvedTopicIdentity | null>
```

During migration mode, compare stable identity resolution and old `cluster_key` reads; fail closed on contradictory mapping.

**Step 5: Run unit and integration tests**

Run focused unit tests and the migration integration test.

**Step 6: Commit**

```bash
git add packages/db/src/repositories
git commit -m "feat(keyword): govern topic and review decisions"
```

---

### Task 6: Extend frozen Finding/Opportunity/Content Shadow topic references

**Files:**

- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `packages/contracts/src/zod/growth-map.test.ts`
- Modify: `packages/contracts/src/zod/content-shadow.ts`
- Modify: `packages/contracts/src/zod/content-shadow.test.ts`
- Modify: `apps/web/src/lib/services/opportunities-projection.ts`
- Modify: `apps/web/src/lib/services/__tests__/audit-opportunities.integration.test.ts`
- Modify: `apps/worker/src/content-shadow/run-content-shadow.ts`
- Modify: `apps/worker/src/content-shadow/__tests__/run-content-shadow.integration.test.ts`
- Modify: `packages/flow-shadow/src/research/manifest.ts`
- Modify: `packages/flow-shadow/src/research/manifest.test.ts`

**Step 1: Write failing historical replay tests**

Fixtures:

- old Finding target with label only;
- new target with `topicNodeId + clusterKeyAtObservation`;
- old Content Shadow pack with `clusterKey`;
- new pack with `topicNodeId + topicModelRevision + clusterKeyAtFreeze`;
- rename after pack freeze;
- split/merge after pack freeze.

Assert:

- old rows still replay;
- rename does not invalidate a frozen pack;
- split/merge does not reattribute historical evidence;
- current keyword execution requires a current confirmed review;
- historical pack reads do not silently migrate to successor topics.

**Step 2: Run and verify failure**

Run focused contract, Web integration, Worker integration, and Flow tests.

**Step 3: Add versioned topic references**

Keep old contract variants readable. Add a new discriminated/versioned variant rather than making old persisted JSON invalid.

**Step 4: Implement resolver use at all boundaries**

Replace direct current-label assumptions only where the new variant applies. Preserve old behavior for old packs.

**Step 5: Run regression tests**

Expected: old and new fixtures all pass.

**Step 6: Commit**

```bash
git add packages/contracts packages/flow-shadow apps/web/src/lib/services apps/worker/src/content-shadow
git commit -m "feat(keyword): preserve historical topic references"
```

---

### Task 7: Add OpenAPI governance contracts and routes

**Files:**

- Modify: `openapi/mvp.yaml`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `packages/contracts/src/zod/growth-map.test.ts`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/topic-model/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/topic-model/route.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/topic-model/confirm/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/topic-model/confirm/route.test.ts`
- Modify: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.ts`
- Modify: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/route.test.ts`
- Create: `apps/web/src/lib/services/keyword-governance.ts`
- Create: `apps/web/src/lib/services/__tests__/keyword-governance.test.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.test.ts`

**Step 1: Write failing contract tests**

Define:

- Topic Model response;
- draft patch request;
- confirm request with expected revision;
- Keyword Review request with `governanceRevision`;
- structured 409 revision conflict;
- current/legacy topic refs;
- `unreviewed` requirement when a topic split/merge affects an assignment.

**Step 2: Run and verify failure**

Run:

```bash
pnpm vitest run --project unit packages/contracts/src/zod/growth-map.test.ts
```

Expected: FAIL.

**Step 3: Add OpenAPI operations**

Add bounded operations:

- `GET/PATCH /projects/{projectId}/audit/topic-model`;
- `POST /projects/{projectId}/audit/topic-model/confirm`;
- `PATCH /projects/{projectId}/audit/keywords/{keywordId}`.

All mutations require revision and project scope. Do not expose free-text `clusterKey` as the new write API.

**Step 4: Generate contracts**

Run:

```bash
pnpm contracts:generate
pnpm openapi:lint
pnpm contracts:check
```

Expected: PASS.

**Step 5: Implement service, routes, and hooks**

Map domain conflicts to the canonical 409 problem response. Never turn missing topic data into an empty confirmed model.

**Step 6: Run route/service/hook tests**

Expected: PASS.

**Step 7: Commit**

```bash
git add openapi/mvp.yaml packages/contracts apps/web/src/app/api/mvp/projects/[projectId]/audit apps/web/src/lib/services/keyword-governance.ts apps/web/src/lib/services/__tests__/keyword-governance.test.ts apps/web/src/lib/api/hooks-growth-map.ts apps/web/src/lib/api/hooks-growth-map.test.ts
git commit -m "feat(keyword): expose governed topic decisions"
```

---

### Task 8: Add the Stage 1 keyword governance UI

**Files:**

- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/growth-map.module.css`
- Modify: `packages/i18n/src/messages/zh-CN.json`
- Modify: `packages/i18n/src/messages/en.json`
- Modify: `e2e/growth-map.mock.spec.ts`

**Step 1: Write failing view-model and E2E tests**

Cover:

- topic model status and revision;
- keyword review opens from selected keyword;
- cluster selection comes only from confirmed Topic Nodes;
- draft/unconfirmed Topic model blocks “进入执行” but does not block import/read;
- save survives detail close/reopen and page refresh;
- stale revision shows conflict and reload action;
- split/merge affected keyword shows “需要重新审核”;
- old topic alias remains visible as history, not an editable choice;
- repeated row switching always loads the selected keyword.

**Step 2: Run and verify failure**

Run focused unit and mock E2E.

**Step 3: Implement progressive review UI**

Do not add the full graph yet. Stage 1 presents:

- Topic Model status summary;
- confirmed node select/tree picker;
- keyword classification and page mapping editor;
- source/provenance;
- revision/conflict state;
- explicit execution gate.

**Step 4: Add Chinese-first copy and accessibility**

Keep English for Keyword, Intent, Topic, URL, SERP, GSC. Use 16px minimum body text and real dialog/drawer behavior.

**Step 5: Run tests**

Run view-model, i18n parity, and mock E2E.

**Step 6: Commit**

```bash
git add apps/web/src/app/p/[projectId]/growth-map packages/i18n e2e/growth-map.mock.spec.ts
git commit -m "feat(keyword): add governed review workflow"
```

---

### Task 9: Add duplicate/cannibalization candidates and decisions

**Files:**

- Create: `packages/db/migrations/0025_keyword_relation_governance.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/keyword-relations.ts`
- Create: `packages/db/src/repositories/keyword-relations.test.ts`
- Create: `packages/db/src/__tests__/keyword-relation-governance.integration.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `packages/contracts/src/zod/growth-map.test.ts`
- Modify: `openapi/mvp.yaml`
- Create: `apps/web/src/lib/services/keyword-relations.ts`
- Create: `apps/web/src/lib/services/__tests__/keyword-relations.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keyword-relations/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keyword-relations/[relationId]/route.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/growth-map.module.css`
- Modify: `e2e/growth-map.mock.spec.ts`

**Step 1: Write failing invariants**

Assert:

- unordered pair uniqueness;
- no self relation;
- same project/market/language;
- signals and rule version required;
- candidates never delete keywords;
- `primary_supporting`, `keep_separate`, `park_secondary`, `needs_research`;
- stale expected revision rejects;
- hide/collapse is view behavior only;
- supporting keywords remain in source/history/results.

**Step 2: Run and verify failure**

Run focused unit/integration/contract tests.

**Step 3: Implement migration/repository**

Candidate generation initially uses available signals:

- same confirmed Topic Node;
- same intent;
- same mapped page;
- normalized lexical similarity.

SERP overlap remains nullable/unavailable until a canonical writer exists.

**Step 4: Add routes/contracts/service**

List/detail/decision only. Candidate regeneration is an internal worker/service command and must preserve old evidence.

**Step 5: Add UI**

Show “可能重复” with signal explanation. Decisions open a real dialog. Default list may collapse Supporting Keywords but includes a “显示支持词” control.

**Step 6: Verify and commit**

```bash
git add packages/db packages/contracts openapi/mvp.yaml apps/web e2e/growth-map.mock.spec.ts
git commit -m "feat(keyword): govern duplicate candidates"
```

---

### Task 10: Generalize Artifact reference sources

**Files:**

- Modify: `packages/contracts/src/zod/artifacts.ts`
- Modify: `packages/contracts/src/zod/artifacts.test.ts`
- Modify: `openapi/mvp.yaml`
- Modify: `apps/web/src/lib/services/artifact-mappers.ts`
- Modify: `apps/web/src/lib/services/artifacts.ts`
- Modify: `apps/web/src/lib/services/__tests__/artifacts-service.test.ts`
- Modify: `apps/web/src/app/p/[projectId]/execution/_execution.tsx`
- Modify: `apps/web/src/app/p/[projectId]/execution/_content-shadow.tsx`
- Modify: `apps/web/src/app/p/[projectId]/execution/execution.module.css`
- Modify: `e2e/content-shadow-execution.mock.spec.ts`
- Create: `e2e/artifact-sources.mock.spec.ts`

**Step 1: Write failing contract/service tests**

Define `ArtifactSourceRef` with:

- kind/title/url;
- authority tier;
- captured/data-as-of;
- hash/method;
- excerpt/truncation;
- evidence pointer;
- availability/freshness/limitation;
- customer visibility.

Assert no source body or internal-only URL leaks.

**Step 2: Run and verify failure**

Run artifact contract/service tests.

**Step 3: Implement type adapters**

- content: Research Pack;
- technical/metadata: Finding/Evidence/PageSnapshot;
- publish/UTM: approved revision + plan/receipt.

Do not copy keyword-card URLs into a second store.

**Step 4: Add the shared source drawer**

Keep Content Shadow functionality, but render through the shared source component. Unsupported artifact types show a structured unavailable reason, not an empty list.

**Step 5: Verify and commit**

```bash
git add packages/contracts openapi/mvp.yaml apps/web e2e
git commit -m "feat(execution): expose governed artifact sources"
```

---

### Task 11: Add Action blockers and business progress

**Files:**

- Create: `packages/db/migrations/0026_action_execution_state.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/action-execution-state.ts`
- Create: `packages/db/src/repositories/action-execution-state.test.ts`
- Create: `packages/db/src/__tests__/action-execution-state.integration.test.ts`
- Modify: `packages/contracts/src/zod/diagnostics.ts`
- Create: `packages/contracts/src/zod/diagnostics.test.ts`
- Modify: `openapi/mvp.yaml`
- Modify: `apps/web/src/lib/services/actions-service.ts`
- Modify: `apps/web/src/lib/services/__tests__/actions-service.test.ts`
- Modify: `apps/web/src/app/p/[projectId]/execution/_execution.tsx`
- Modify: `apps/web/src/app/p/[projectId]/execution/execution.module.css`
- Modify: `apps/web/src/app/p/[projectId]/overview/_overview.tsx`
- Modify: `e2e/action-override.mock.spec.ts`

**Step 1: Write failing domain tests**

Assert:

- active/resolved blocker ledger;
- blocker summary, condition, owner, source, timestamp, freshness;
- blockers can derive from QA Claim, Provider readiness, approval, dependency, or run failure;
- progress phase exists for all active tasks;
- numeric steps only when `stepDefinitionVersion` and total exist;
- `async_runs.progress` alone never marks Action complete;
- resolving blocker updates current projection without deleting history.

**Step 2: Run and verify failure**

Run focused DB/contract/service tests.

**Step 3: Implement storage and projection**

Prefer append-only blocker events and current read projection. Store step definition/version separately from run progress.

**Step 4: Implement UI**

Queue card shows:

- blocker reason and unlock condition;
- phase and next step;
- `3/6` only when real;
- owner/freshness when relevant.

**Step 5: Verify and commit**

```bash
git add packages/db packages/contracts openapi/mvp.yaml apps/web e2e/action-override.mock.spec.ts
git commit -m "feat(execution): show blockers and business progress"
```

---

### Task 12: Add canonical keyword rank history

**Files:**

- Create: `packages/db/src/repositories/keyword-metric-history.ts`
- Create: `packages/db/src/repositories/keyword-metric-history.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `packages/contracts/src/zod/growth-map.test.ts`
- Modify: `openapi/mvp.yaml`
- Create: `apps/web/src/lib/services/growth-map-keyword-history.ts`
- Create: `apps/web/src/lib/services/__tests__/growth-map-keyword-history.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/history/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/keywords/[keywordId]/history/route.test.ts`
- Modify: `apps/web/src/lib/api/hooks-growth-map.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/growth-map.module.css`
- Modify: `e2e/growth-map.mock.spec.ts`

**Step 1: Write failing history tests**

Assert:

- stable Keyword Entity identity;
- bounded 7/30/90-day windows;
- provider/market/language/device/location dimensions do not merge incorrectly;
- `observedAt` versus `providerDataAsOf`;
- missing/partial/stale are explicit;
- duplicate observations are deduplicated by canonical pointer, not value;
- missing dates are gaps, not zero/rank 100;
- `sourceOccurrences` is never used as the returned series;
- no fake change point without a receipt.

**Step 2: Run and verify failure**

Run repository/contract/service tests.

**Step 3: Implement read model**

Aggregate existing immutable metric observations and their snapshot lineage. Add a materialized table only if query evidence proves necessary; do not duplicate metric truth by default.

**Step 4: Add endpoint and hooks**

Return a bounded series plus coverage/freshness/limitations and an empty receipt event track in Stage 1 when no verified receipt exists.

**Step 5: Add accessible chart**

Use SVG with:

- rank axis inverted correctly;
- visible data gaps;
- point/table alternate representation;
- keyboard-readable summary;
- no causal language.

**Step 6: Verify and commit**

```bash
git add packages/db packages/contracts openapi/mvp.yaml apps/web e2e/growth-map.mock.spec.ts
git commit -m "feat(keyword): add rank history"
```

---

### Task 13: Stage 1 full-chain stop gate

**Files:**

- Create: `docs/reviews/2026-07-27-keyword-governance-stage1-stop-gate.md`
- Modify: `docs/PROGRESS.md`
- Create: `scripts/verify-keyword-stage-gates.mjs`
- Create: `scripts/verify-keyword-stage-gates.test.mjs`
- Modify: `package.json`
- Modify: `scripts/verify-implementation.mjs`
- Modify: `scripts/verify-implementation-source.test.mjs`
- Modify: the active v0.4 spec/authority lock created by the prerequisite
- Modify: `e2e/growth-map.real.spec.ts`
- Modify: `e2e/real-vertical-chains.spec.ts`

**Step 1: Add failing completion assertions**

The verifier must refuse Stage 1 completion unless:

- prerequisite migrations 0022–0023 and Keyword migrations 0024–0026 exist and pass;
- Topic alias historical replay test exists;
- keyword PATCH route exists;
- relation decision route exists;
- artifact source contract exists;
- Action blocker/progress contract exists;
- history endpoint exists;
- production UI uses the generated clients/hooks;
- mock and real E2E cover mutation persistence;
- requirement 9 remains partial until receipt-backed results exist.

**Step 2: Run verifier and confirm failure**

Expected: FAIL until all Stage 1 evidence is present.

**Step 3: Update the global implementation authority**

Recalculate exact OpenAPI operation, app-table, async-route, migration, and version expectations from the implemented Stage 1 surface. Extend the isolated verifier fixture test so a missing Keyword operation/table still fails. Do not replace exact lists with loose minimum counts.

**Step 4: Add real vertical-chain fixtures**

Exercise:

1. import/read keyword;
2. confirm topic;
3. review/map keyword;
4. decide duplicate relation;
5. enter Action/Artifact;
6. inspect reference sources;
7. inspect blocker/progress;
8. read rank history;
9. reload and verify persistence.

**Step 5: Run complete Stage 1 verification**

Run:

```bash
pnpm db:migrate:check
pnpm openapi:lint
pnpm contracts:check
pnpm implementation:check
pnpm typecheck
pnpm lint
pnpm test
DATABASE_URL=postgresql://wzb@127.0.0.1:5432/signalframe_codex_keyword_20260727 pnpm test:integration
pnpm test:e2e:mock
pnpm test:e2e:real
pnpm artifact:verify
pnpm test:e2e:artifact
pnpm test:e2e:keyword-audit
pnpm secrets:scan
git diff --check
```

Expected: all PASS with fresh timestamps.

**Step 6: Record the stop gate**

List each audited requirement as complete/partial/not-started with direct evidence.

**Step 7: Commit**

```bash
git add docs/reviews/2026-07-27-keyword-governance-stage1-stop-gate.md docs/PROGRESS.md scripts/verify-keyword-stage-gates.mjs scripts/verify-keyword-stage-gates.test.mjs scripts/verify-implementation.mjs scripts/verify-implementation-source.test.mjs package.json e2e/growth-map.real.spec.ts e2e/real-vertical-chains.spec.ts
git commit -m "test(keyword): close stage 1 stop gate"
```

---

## Stage 2 — Structure, monitoring, and receipt-backed results

### Task 14: Add durable Opportunity decisions and configurable SLA

**Files:**

- Create: `packages/db/migrations/0027_opportunity_decision_ledger.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/opportunity-decisions.ts`
- Create: `packages/db/src/repositories/opportunity-decisions.test.ts`
- Create: `packages/db/src/__tests__/opportunity-decision-ledger.integration.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `openapi/mvp.yaml`
- Modify: `apps/web/src/lib/services/opportunities-projection.ts`
- Modify: `apps/web/src/lib/services/workspace-view.ts`
- Modify: `apps/web/src/app/p/[projectId]/overview/_overview.tsx`
- Modify: `e2e/overview-read-model.mock.spec.ts`

**Steps:**

1. Write failing tests for stable fingerprint, first/last seen, advance/decline/defer/snooze, owner, reason, snooze expiry, configurable default 14-day SLA, deduplication, and existing Action suppression.
2. Run tests and verify failure.
3. Implement append-only decisions and current projection.
4. Add bounded route/contracts and 409 revision protection.
5. Add Overview “待决策机会” with real decision dialog.
6. Verify reload, snooze expiry, and no duplicate reminders.
7. Commit: `feat(overview): add governed opportunity reminders`.

---

### Task 15: Deliver the versioned interactive Topic Map

**Files:**

- Create: `apps/web/src/app/p/[projectId]/growth-map/_topic-map.tsx`
- Create: `apps/web/src/app/p/[projectId]/growth-map/_topic-map-view-model.ts`
- Create: `apps/web/src/app/p/[projectId]/growth-map/_topic-map-view-model.test.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/growth-map.module.css`
- Modify: `e2e/growth-map.mock.spec.ts`
- Modify: `e2e/growth-map.real.spec.ts`

**Steps:**

1. Write failing view-model/E2E tests for tree layout, create/edit/delete in Draft, confirm, rename, split/merge re-review, keyword counts, gap/conflict badges, detail drawer, keyboard traversal, mobile fallback, and history.
2. Verify failure.
3. Build a reusable graph interaction primitive without coupling Topic and Link domain data.
4. Wire all changes to the real Topic Model commands.
5. Confirm no operation edits a confirmed revision in place.
6. Run mock/real E2E and accessibility checks.
7. Commit: `feat(growth-map): add versioned topic map`.

---

### Task 16: Add the canonical Internal Link Graph and Action creation

**Files:**

- Create: `packages/db/migrations/0028_internal_link_observations.sql` only if existing snapshots cannot preserve edges
- Modify: `packages/db/src/schema.ts` if migration is needed
- Create: `packages/db/src/repositories/internal-link-graph.ts`
- Create: `packages/db/src/repositories/internal-link-graph.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `openapi/mvp.yaml`
- Create: `apps/web/src/lib/services/internal-link-graph.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/link-graph/route.ts`
- Create: `apps/web/src/app/p/[projectId]/growth-map/_link-map.tsx`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `e2e/growth-map.mock.spec.ts`

**Steps:**

1. Audit whether Crawl/PageSnapshot already contains edge-complete facts; write the failing evidence test before deciding to add migration 0028.
2. Write tests for Hub/Spoke, bidirectional/single-direction/island state, source pages, suggested links, snapshot freshness, no Finding-derived fake edges.
3. Implement canonical graph read model.
4. Add idempotent “补充内链” Action command keyed by source page + target page + suggestion type.
5. UI opens existing unresolved Action instead of duplicating it.
6. Run graph, route, UI, and E2E tests.
7. Commit: `feat(growth-map): add internal link graph`.

---

### Task 17: Add content-decay policy, detector, and alerts

**Files:**

- Create: `packages/db/migrations/0029_content_decay_monitor.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/content-decay.ts`
- Create: `packages/db/src/repositories/content-decay.test.ts`
- Create: `packages/engine/src/rules/content-decay.ts`
- Create: `packages/engine/src/rules/content-decay.test.ts`
- Modify: `packages/engine/src/rules/index.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `openapi/mvp.yaml`
- Modify: `apps/web/src/lib/services/workspace-view.ts`
- Modify: `apps/web/src/app/p/[projectId]/overview/_overview.tsx`
- Modify: `e2e/overview-read-model.mock.spec.ts`

**Steps:**

1. Write failing policy tests for default `rank drop >5 over two months` or `MoM traffic drop >20%`, minimum samples, brand terms, seasonal suppression, missing data, stale data, deduplication, and recovery.
2. Verify failure.
3. Implement versioned project policy and deterministic detector.
4. Generate canonical Alert/Opportunity, not a UI-only warning.
5. Add Overview card and idempotent “内容复审” Action creation.
6. Verify false-positive boundaries and time windows.
7. Commit: `feat(monitoring): add content decay alerts`.

---

### Task 18: Add competitor monitor policy, snapshots, and deltas

**Files:**

- Create: `packages/db/migrations/0030_competitor_monitoring.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repositories/competitors.ts`
- Modify: `packages/db/src/repositories/competitors.test.ts`
- Create: `packages/db/src/repositories/competitor-monitoring.ts`
- Create: `packages/db/src/repositories/competitor-monitoring.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `openapi/mvp.yaml`
- Modify: `apps/web/src/lib/services/growth-map-competitors.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Modify: `e2e/growth-map.mock.spec.ts`

**Steps:**

1. Write failing tests for project default monthly, off/weekly/monthly/quarterly/custom, custom 7–90 days, per-approved-competitor override, provider unavailable, last success/next run/failure, immutable snapshots, and delta deduplication.
2. Verify failure.
3. Implement policy and snapshot/delta repositories.
4. Add service/contracts/routes and real unavailable states.
5. Add competitor detail controls and delta timeline.
6. Trigger Opportunity only for real overlapping new content or verified rank delta.
7. Commit: `feat(competitors): add governed monitoring`.

---

### Task 19: Add receipt-backed keyword Results

**Precondition:** The publication/change receipt and outcome-measurement tasks in `docs/plans/2026-07-27-nevermore-customer-artifact-and-production-convergence.md` are complete and verified. If not, stop this task without marking Requirement 9 complete.

**Files:**

- Create: `packages/contracts/src/zod/results.ts`
- Create: `packages/contracts/src/zod/results.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `openapi/mvp.yaml`
- Modify: `apps/web/src/app/api/mvp/projects/[projectId]/results/route.ts`
- Modify: `apps/web/src/app/api/mvp/projects/[projectId]/results/route.test.ts`
- Create: `apps/web/src/lib/services/results-service.ts`
- Modify: `apps/web/src/lib/services/recheck-results.ts`
- Modify: `apps/web/src/app/p/[projectId]/results/_results.tsx`
- Modify: `apps/web/src/app/p/[projectId]/results/results.module.css`
- Create: `e2e/results-measurement.mock.spec.ts`
- Modify: `e2e/real-vertical-chains.spec.ts`

**Steps:**

1. Write failing tests proving every change event has a verified Receipt and every before/after comparison has fixed windows.
2. Verify current Results correctly fails the new expectation.
3. Add Keyword Rank Series + Receipt Event Overlay + target-term before/after.
4. Preserve technical recheck, GSC/GA4, Campaign/UTM, and attribution boundary.
5. No receipt means raw series only and an explicit explanation.
6. Run contract/service/mock/real E2E.
7. Mark Requirement 9 fully complete only after this task.
8. Commit: `feat(results): add receipt-backed keyword measurement`.

---

### Task 20: Stage 2 stop gate

**Files:**

- Create: `docs/reviews/2026-07-27-keyword-governance-stage2-stop-gate.md`
- Modify: `docs/PROGRESS.md`
- Modify: `scripts/verify-keyword-stage-gates.mjs`
- Modify: `scripts/verify-keyword-stage-gates.test.mjs`
- Modify: `scripts/verify-implementation.mjs`
- Modify: `scripts/verify-implementation-source.test.mjs`
- Modify: the active v0.4 spec/authority lock

**Steps:**

1. Add failing verifier requirements for Topic Map, Link Graph, Opportunity decisions, Decay, Competitor policy/delta, and receipt-backed Results.
2. Update the global verifier and active authority lock with exact Stage 2 operations/tables; retain exact-match behavior.
3. Run full DB/contract/type/lint/unit/integration/mock/real E2E.
4. Run fixed-time detector tests to prove no locale/clock nondeterminism.
5. Audit each original request 1–13 again; mark current truth.
6. Commit: `test(keyword): close stage 2 stop gate`.

---

## Stage 3 — External evidence

### Task 21: Add governed Interview Summary and User Review sources

**Files:**

- Create: `packages/db/migrations/0031_keyword_voc_sources.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repositories/keyword-occurrences.ts`
- Modify: `packages/db/src/repositories/keyword-occurrences.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `openapi/mvp.yaml`
- Modify: `apps/web/src/lib/services/growth-map-keywords.ts`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`

**Steps:**

1. Write failing tests for `interview_summary` and `user_review`, provider, pointer, captured/data-as-of, license/visibility/retention, dedupe, and PII-safe excerpt.
2. Implement manual/CSV governed ingestion first.
3. Show distinct source badges and provenance in Keyword Detail.
4. Do not add customer connector cards.
5. Add external adapters only in separate provider-reviewed commits.
6. Commit: `feat(keyword): add governed voc sources`.

---

### Task 22: Add GEO Citation Observation

**Files:**

- Create: `packages/db/migrations/0032_geo_citation_observations.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/citation-observations.ts`
- Create: `packages/db/src/repositories/citation-observations.test.ts`
- Modify: `packages/contracts/src/zod/results.ts`
- Modify: `openapi/mvp.yaml`
- Modify: `apps/web/src/lib/services/results-service.ts`
- Modify: `apps/web/src/app/p/[projectId]/results/_results.tsx`

**Steps:**

1. Write failing tests for platform, query, answer snapshot/hash, citation URL, exact passage/excerpt, captured time, provider data-as-of, unavailable/partial/stale, and no causal reason.
2. Implement append-only observations and provider-neutral writer contract.
3. Add Results detail and structural comparison labelled “分析/推测”.
4. No writer/provider means unavailable, never zero.
5. Commit: `feat(results): add geo citation observations`.

---

### Task 23: Add Backlink snapshots and governed import

**Files:**

- Create: `packages/db/migrations/0033_backlink_observations.sql`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/backlinks.ts`
- Create: `packages/db/src/repositories/backlinks.test.ts`
- Create: `packages/sources/src/backlinks/manual-import.ts`
- Create: `packages/sources/src/backlinks/manual-import.test.ts`
- Modify: `packages/contracts/src/zod/growth-map.ts`
- Modify: `openapi/mvp.yaml`
- Modify: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`

**Steps:**

1. Write failing tests for provider-neutral site/referring-domain/page/competitor metrics, snapshot time, manual import provenance, domain normalization, missing values, and opportunity evidence.
2. Implement governed manual import first.
3. Add Growth Map evidence view only when data exists.
4. Add honest unavailable state otherwise.
5. Do not add Ahrefs/Moz customer cards.
6. Commit: `feat(growth-map): add backlink evidence`.

---

### Task 24: Add approved external provider adapters

**Files:** Determined by provider approval; expected under:

- `packages/sources/src/reviews/`
- `packages/sources/src/citations/`
- `packages/sources/src/backlinks/`
- `apps/worker/src/collection/`

**Steps:**

1. Record provider approval, terms, scopes, cost, quota, cadence, retention, and PII review.
2. Write adapter contract tests before network code.
3. Add replayable fixtures and no-network unit tests.
4. Add disposable integration tests guarded by explicit provider credentials.
5. Connect scheduler to existing policy without changing customer connector cards.
6. Prove snapshots/deltas/reminders survive retries idempotently.
7. Commit one provider per reviewed commit.

---

### Task 25: Final 13-requirement completion audit

**Files:**

- Create: `docs/reviews/2026-07-27-keyword-growth-final-acceptance.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/LAUNCH-CHECKLIST.md`
- Modify: `docs/artifacts/Nevermore-Keyword-Growth-Audit.html` through deterministic regeneration only

**Step 1: Build a requirement-by-requirement evidence matrix**

For each of 1–13 link:

- migration/schema;
- repository/domain tests;
- contract/route;
- production UI;
- mutation/audit trail;
- integration/E2E;
- provider/live or unavailable boundary.

**Step 2: Re-run all gates**

Run:

```bash
pnpm artifact:regen
pnpm artifact:keyword-audit
pnpm artifact:verify
pnpm test:e2e:artifact
pnpm test:e2e:keyword-audit
pnpm db:migrate:check
pnpm openapi:lint
pnpm contracts:check
pnpm implementation:check
pnpm typecheck
pnpm lint
pnpm test
DATABASE_URL=postgresql://wzb@127.0.0.1:5432/signalframe_codex_keyword_20260727 pnpm test:integration
pnpm test:e2e:mock
pnpm test:e2e:real
pnpm secrets:scan
git diff --check
```

**Step 3: Inspect actual rendered behavior**

Verify in browser:

- every Growth Map row/tab/detail selection;
- every audit Artifact filter/detail/history action;
- mobile layouts;
- no hidden mock/live confusion;
- no button with generic feedback in place of a real destination;
- Chinese-first UI;
- English Blog body remains English.

**Step 4: Do not mark incomplete integrations complete**

If Ahrefs/Moz, review platforms, or citation providers are not authorized, record them as `unavailable/planned` while keeping the product honest. The goal is complete only if the agreed launch scope, including any explicitly required provider, is truly satisfied.

**Step 5: Commit final evidence**

```bash
git add docs/PROGRESS.md docs/LAUNCH-CHECKLIST.md docs/reviews/2026-07-27-keyword-growth-final-acceptance.md docs/artifacts/Nevermore-Keyword-Growth-Audit.html
git commit -m "docs(keyword): record final acceptance evidence"
```

---

## Execution order

Execute strictly in this order:

1. Tasks 1–3: audit Artifact;
2. complete convergence Task 7, then implement and verify Tasks 8–9, including migrations 0022–0023 and active v0.4 authority promotion;
3. Tasks 4–13: Stage 1 production foundation and stop gate; convergence Task 10 may proceed in parallel after Tasks 8–9;
4. Tasks 14–18: Stage 2 structure and monitoring;
5. ensure convergence Task 10 is complete, then run Task 19 to extend the Receipt/Measurement foundation with keyword Results;
6. Task 20: close the Stage 2 stop gate;
7. Tasks 21–24: approved Stage 3 sources;
8. Task 25: final 13-requirement acceptance.

Never skip forward to a graph, chart, reminder, or provider UI if the canonical writer/read model beneath it is absent.
