# Unified Growth Opportunity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the Slice 1 technical Growth Opportunity loop—URL and ICP input → honest Growth Audit → one-primary-Finding Opportunity review → one canonical Action and `technical_ticket` → immutable recheck → Results—inside Nevermore without creating a parallel SEO/GEO product or a second lifecycle truth.

**Architecture:** Keep `Project` as the container and project Growth Opportunities from the existing Evidence → Finding → Finding Review → Action → Artifact chain. Add only five narrowly owned runtime/projection tables, expose a versioned v0.3 audit/recheck contract, and reduce the client-visible shell to 概览 / Overview, 增长地图 / Growth Map, 执行中心 / Execution, and 效果追踪 / Results while retaining legacy route keys as compatibility details. Stop after the technical vertical and a product review; the integrated SEO/GEO frontstage, richer context contract, and content/publish lifecycle require the explicit Revision 2 companion scope below rather than being implied by this Slice 1 plan.

**Tech Stack:** TypeScript, Next.js App Router, React, Zod, OpenAPI 3.1, Drizzle ORM, PostgreSQL, pg-boss, Vitest, Playwright, pnpm, Node.js 24.

---

## Revision 4 implementation correction · Product profile synthesis

This correction supersedes Revision 3 wherever it treats product-profile creation as a four-step Audit intake. The production implementation must keep profile synthesis and Audit creation as separate commands and lifecycles.

### R4.1 Client flow

Implement two visible states:

1. `Product URL` input with an optional business hint;
2. review and confirm the synthesized product profile.

The background probe may reuse the existing URL-safety, fetch and extraction infrastructure, but the client must not expose a separate `AI 探索` navigation page. While the job runs, show one inline progress state. On success, route directly to the review result; on failure, keep the URL and show a retryable error.

Do not request or render site language, output locale, workbench language, growth goal, conversion event, Priority URLs or Audit scope in this product-profile command. Those values live in workspace preferences or later work-specific commands.

### R4.2 Profile draft contract

Introduce or review a versioned `ProductProfileDraft` contract before connecting the Artifact to production. It should cover:

- `productName`, `oneLiner`, `category`, `productType`, `businessModels[]`, `valueProposition`, `coreFeatures[]`;
- `targetMarkets[]` with explicit primary when the user confirms more than one;
- `targetAudiences[]` / ICP candidates with target company or audience, Buyer, User, use cases, triggers, pains and JTBD;
- `competitorCandidates[]` with `name`, `domain`, `relationship: direct | indirect`, `similarity`, `reason`, evidence references and review status;
- `confidence`, source Site ID, schema version and append-only draft / confirmed version identifiers.

The client initially renders one Primary ICP and 3–5 Direct plus 3 Indirect competitors. The server contract may retain richer candidates, but it must not require the client to expose every internal field before confirmation.

### R4.3 Commands and state boundaries

Use separate commands for:

- `requestProductProfileSynthesis(productUrl, optionalHint)`;
- `updateProductProfileDraft(profileId, patch)`;
- `reviewCompetitorCandidate(profileId, candidateId, status)`;
- `addDeclaredCompetitor(profileId, competitor)`;
- `confirmProductProfile(profileId)`.

Confirming the profile creates a versioned product-context input. It does not start a Growth Audit. Keyword discovery, competitor corpus enrichment, Audit creation and content planning consume the confirmed profile through their own input manifests.

### R4.4 Internal extensibility

Revision 3's composable business-model / vertical packs remain an internal synthesis and validation mechanism. Do not serialize Pack labels, governed custom attributes, provenance ledgers or Context hashes into the primary client review card. Only surface a source or confidence detail when it helps the customer correct a product, audience or competitor conclusion.

### R4.5 Test delta

Add tests for:

- URL-only happy path and optional hint;
- safe fetch failure, retry and duplicate synthesis suppression;
- generation success transitions directly into review without an intermediate exploration route;
- editing product category, product type, business model, markets and Primary ICP;
- deselecting an incorrect competitor and adding a declared competitor;
- enforcing Direct / Indirect relationship values and domain deduplication;
- confirming a product profile without implicitly creating an Audit;
- desktop and 390px mobile behavior, focus containment and no horizontal overflow.

---

## Revision 3 implementation correction · Progressive B2B context

This correction supersedes any task below that requires a customer to complete the entire ICP payload before the system may perform safe site exploration.

### R3.1 Required lifecycle

Implement the production flow as one lifecycle with explicit state boundaries:

1. create or update a Draft project context from Website URL, market(s), primary growth goal and primary conversion;
2. run the existing SSRF-guarded public Site Probe / Crawl collection and read already-authorized source snapshots;
3. synthesize a versioned Context / ICP Draft with field provenance, confidence, assumptions, contradictions and missing-data markers;
4. let the user review structured suggestions, including multi-URL Priority URL candidates and B2B ICP Cards;
5. validate and freeze `CompleteIcpProfileInputV2` as a new append-only profile version;
6. start the full Growth Audit with the frozen Site ID and ICP Profile ID.

The initial exploration job is not the full audit and must not fabricate provider data. It may only use public first-party sources under the existing URL-safety policy plus snapshots from connections the user has already authorized.

### R3.2 UI responsibility

The initial UI exposes only four required values. Site language, delivery locale, UI language, customer model and business type use detected / default values in a collapsed editable section. All enumerable values use controlled selections.

Do not render `priorityUrls` as a first-step textarea. Build Priority URL candidates from the URL inventory and keep their selection independent from the full-site Audit scope. A user can accept, exclude, search the inventory, or manually add a URL after discovery.

Represent market priority explicitly as `primaryMarket` plus ordered secondary markets; do not infer priority from checkbox insertion order. Define the discovery dependency set (`website`, market scope / primary market, source / output locale, customer and business model, primary goal, conversion and business hint). A change to any dependency cancels an in-flight synthesis, marks the current Context Draft stale, resets review eligibility and requires a new exploration version.

The review UI must support:

- ProductProfile edit and re-infer;
- 2–7 candidate B2B ICP Cards with Primary / Secondary / Excluded status;
- company profile, buyer / user roles, triggers, pains, JTBD, outcomes, barriers, qualification signals and disqualifiers;
- separate buying context for Sales Motion, Buying Committee, Decision Criteria, ACV, Sales Cycle, Procurement and Technographic Fit;
- field-level `declared / observed / computed / inferred / missing / contradicted` provenance;
- low-confidence and missing-data review without blocking unrelated audit modules;
- optional proof and execution constraints that become gates only for the work they affect.

### R3.3 Contract and persistence consequences

`gengrowth-agents` is not a contract dependency. Reuse only proven probe / review patterns; define the GenGrowth B2B schema in Nevermore OpenAPI and Zod.

Do not replace that dependency with a different fixed SaaS ontology. Model Context as:

- versioned Universal Core objects;
- discriminated business-model packs;
- optional versioned vertical packs selected by applicability rules;
- governed custom attribute definitions for evidence-discovered or customer-declared dimensions;
- work-specific requirements evaluated only by the affected Artifact gate.

Every extension definition needs a stable key, type, applicability, source authority, evidence refs, confidence, review status and schema version. Unknown and not-applicable states are first class. Persist the set of loaded pack versions in the Context hash and Audit input manifest.

Revision 2's V2 fields remain required. Before production implementation, extend the schema review to candidate ICP Cards, distinct buyer / user roles, success metrics, buying barriers, qualification signals, disqualifiers, Sales Motion and evidence / confidence metadata. Buying Committee remains structured. Technographic and Procurement objects require an explicit schema / evidence decision because the current accepted contract does not yet ground their complete shape.

Keep Draft and Complete validation separate. Draft synthesis may be incomplete and nullable; a Complete profile must pass pointer-level validation. Do not pack new structures into legacy segment, competitor or constraint strings. Include schema version and canonicalized provenance-bearing payload in the content hash and Audit input manifest.

### R3.4 Test delta

Add tests for:

- four-field initial intake and controlled selection options;
- Site Probe success, safe failure and retry without duplicate project creation;
- detected defaults and manual override precedence;
- Priority URL discovery, multi-selection and full-site scope independence;
- explicit Primary / Secondary market behavior and derived-draft invalidation after a dependency changes;
- URL Inventory search, no-result behavior, manual URL normalization, de-duplication and declared provenance;
- B2B candidate-card generation with evidence refs and missing-data honesty;
- Primary / Secondary / Excluded review decisions;
- low-confidence ACV / Procurement / Buying Committee handling;
- Draft-to-Complete immutable version transition;
- inline field provenance for declared / observed / computed / inferred / missing / contradicted;
- business-model / vertical-pack applicability, unknown / not-applicable behavior and governed custom attributes;
- mobile and desktop accessibility, focus containment / restoration, keyboard operation and no page-level horizontal overflow.

---

## Revision 2 scope correction

The product review on Tuesday, July 21, 2026 changed the frontstage target. This implementation plan remains useful as the Slice 1 technical foundation, but it is no longer sufficient as the sole visible product contract.

### R2.1 What changed

The approved client-facing artifact now requires:

- multi-URL portfolio-first presentation rather than a single-URL hero;
- Chinese-first UI copy with English brief / draft output;
- visible keyword and competitor libraries inside Growth Map;
- direct Execution previews for code fix, metadata rewrite, brief, draft, and publish receipt;
- Results organized around before/after page deltas and UTM windows, not only immutable-run semantics;
- richer context capture for Site / Market, Business / Offer, ICP / JTBD, Competitors / Constraints, followed by immutable-version review.

### R2.2 Implementation consequence

Treat the current plan as the backend truth and technical slice, but not as the complete frontstage definition.

Any implementation task derived from this document must now preserve these additional requirements:

- no frontstage assumption that one URL is the primary default for all client views;
- no hiding keyword or competitor datasets behind backstage-only surfaces;
- no client-facing screen that requires understanding internal governance terms before seeing the work output;
- no minimal ICP form that collapses structured context into a few short fields.

### R2.3 Immediate planning delta

Before production implementation starts, the execution backlog must add a companion frontstage scope that covers:

1. portfolio projection for multiple URLs;
2. keyword library projection with provenance fields;
3. competitor library projection with origin, scope, and status fields;
4. execution preview components for all required work item types;
5. result reporting components for before/after and UTM audit tables;
6. progressive context capture and review UI for the richer ICP model;
7. contract-first `CompleteIcpProfileInputV2` evolution before any richer field is submitted by the production UI.

This does not invalidate the technical foundation in this document. It does invalidate any assumption that Slice 1 may ship with a technically correct but client-incomprehensible frontstage.

### R2.4 Rich context contract landing

The artifact form is a **target-state V2 form**, not a claim that the current strict request schema accepts every visible field. The current `openapi/mvp.yaml` and `packages/contracts/src/zod/icp.ts` accept Persona Jobs and pains, but reject unknown keys such as objections, buying triggers, decision criteria, buying committee, Negative ICP, secondary conversions, approved proof, content voice, and field provenance.

Before building the production form:

1. introduce `CompleteIcpProfileInputV2` with `profileSchemaVersion: "2"` and the exact mappings in Design R2.6;
2. preserve legacy V1 reads and requests during transition, but never silently coerce V2 fields into V1 strings;
3. update OpenAPI, Zod, generated contracts, pointer-level validation tests, form/view-models, fixtures, canonical content-hash tests, and diagnostic input-manifest tests in one contract slice;
4. persist V2 in the existing append-only `icp_profiles.profile` JSONB and create a new immutable profile version on confirmation; never mutate or reinterpret a historical V1 row;
5. include the profile schema version in the canonical hashed payload and in the audit input manifest so rechecks remain reproducible;
6. keep UI language preference outside ICP, while market, site languages, and output locale remain explicit project/profile inputs;
7. store URL-extracted suggestions with field-level provenance and require confirmation before a Complete V2 profile can start an Audit.

No new ICP lifecycle table is planned. A database migration is required only if implementation evidence shows a need to query/index a V2 field outside the existing JSONB snapshot.

---

## Execution contract

This plan implements only the production requirements of **Slice 1** from:

- `docs/plans/2026-07-21-unified-growth-opportunity-design.md`
- `docs/plans/2026-07-21-unified-growth-opportunity-prd.md`

The following invariants are release blockers:

1. A Slice 1 reviewable Opportunity has exactly one `primaryFindingId`.
2. Opportunity confirmation calls the existing Finding Review transaction; the Opportunity projection never writes an Action.
3. One confirmed Finding creates at most one canonical Action, whose template fixes one Artifact type.
4. `capability_runs` never owns run status; `audit_runs` never owns frozen inputs or rule truth; `audit_module_results` never owns Finding truth.
5. Audit Evidence is read-only. Confirmation exists only in Opportunity Review.
6. A `no_data` or unavailable source is visible and never converted to zero, pass, or fabricated score.
7. Recheck creates a new immutable run and compares it with a prior immutable run. It does not mutate the prior run or introduce `performance_checkpoints`.
8. Search metrics and generative/AI observations remain separate measurements.
9. No content lifecycle, competitor snapshot history, CMS write path, membership model, scheduled checkpoint, or Opportunity table is added before the Slice 1 stop gate.

Use `@everything-claude-code:tdd-workflow` for each code task, `@frontend-design` for Task 6, and `@everything-claude-code:verification-loop` for Task 9. Work in a dedicated clean worktree. Do not edit dirty sibling repositories; port only reviewed, pinned capability code into Nevermore.

## Version and naming decisions

- Product version: `0.3.0`
- Runtime contract version: `2026-07-21`
- Authority package: `authority/implementation-spec-v0.3/`
- Rule set: remains `mvp.rules.0.2.0` in Slice 1 because this plan maps and reuses the eleven existing rules; any new rule requires its own parity review and same-commit authority update.
- Prompt set: remains `mvp.prompts.0.2.0` because this slice adds no model-authored Finding or Action.
- Export schema: `signalframe.service-bundle.0.3.0` when the product-version task updates exports.
- Client-visible terms: `概览`, `增长地图`, `页面与机会`, `关键词库`, `竞品库`, `执行中心`, `效果追踪`; `Audit Evidence` and `Opportunity Review` are selected-object detail states, not primary navigation.
- API JSON uses camelCase; SQL and persisted run manifests use snake_case where the repository already does so.

## Current rule projection freeze

Do not infer this mapping dynamically or from an LLM. Check it into the Opportunity projection and test every row.

| Rule | Audit module | Frontstage lens | Work-shape policy | Fixed Artifact type |
|---|---|---|---|---|
| `TECH-HTTP-001` | `technical_search` | `site_health` | `fix` | `technical_ticket` |
| `TECH-CANONICAL-002` | `technical_search` | `site_health` | `fix` | `technical_ticket` |
| `TECH-LINKGRAPH-005` | `links_architecture` | `site_health` | `fix` | `technical_ticket` |
| `SEARCH-CTR-004` | `technical_search` | `search_ai_visibility` | `improve` | `metadata_rewrite` |
| `SEARCH-DECAY-002` | `content_intent` | `search_ai_visibility` | `improve` | `content_brief` |
| `CONTENT-COVERAGE-001` | `content_intent` | `demand_competition` | existing owned page → `improve`; no suitable asset → `create` | `content_brief` |
| `CONTENT-GAP-011` | `content_intent` | `demand_competition` | existing owned page → `improve`; no suitable asset → `create` | `content_brief` |
| `CRO-PATH-001` | `links_architecture` | `site_health` | `fix` | `technical_ticket` |
| `CRO-LANDING-003` | `content_intent` | `demand_competition` | `improve` | `content_brief` |
| `GEO-ENTITY-001` | `ai_geo` | `search_ai_visibility` | `improve` | `technical_ticket` |
| `GEO-CRAWLER-002` | `ai_geo` | `search_ai_visibility` | `fix` | `technical_ticket` |

The eight audit modules are `performance`, `accessibility`, `best_practices_security`, `technical_search`, `content_intent`, `ai_geo`, `links_architecture`, and `compliance_measurement`. Empty modules remain present with `coverageState: "no_data"`; they do not receive a score of zero.

### Task 1: Version the v0.3 authority and make both verifiers migration-aware

**Files:**

- Create: `authority/implementation-spec-v0.3/README.md`
- Create: `authority/implementation-spec-v0.3/MVP-IMPLEMENTATION-SPEC.md`
- Create: `authority/implementation-spec-v0.3/openapi.yaml`
- Create: `authority/implementation-spec-v0.3/schema.sql`
- Create: `authority/implementation-spec-v0.3/scripts/verify-spec.mjs`
- Create: `scripts/verify-spec-lock.test.mjs`
- Modify: `scripts/verify-spec-lock.mjs`
- Modify: `scripts/verify-implementation.mjs`
- Modify: `package.json`

**Step 1: Write failing verifier tests**

Create a Node test that copies the minimum lock fixture into a temporary directory and proves that the verifier:

- can read a caller-supplied lock path while retaining `spec-v0.2-lock.json` as the active default in this task;
- discovers all ordered `NNNN_*.sql` migrations, not only `0001_init.sql`;
- fails if a reviewed table exists only in the lock but in no migration;
- fails if the same table is created by two migrations;
- fails if two migration files use the same numeric prefix;
- executes `authority/implementation-spec-v0.3/scripts/verify-spec.mjs`;
- rejects a lock whose declared authority hash does not match its file.

Use this fixture shape in `scripts/verify-spec-lock.test.mjs`:

```js
test("scans the complete ordered migration set", () => {
  const fixture = makeFixture({
    migrations: {
      "0001_init.sql": "CREATE TABLE IF NOT EXISTS app.workspaces (id uuid);",
      "0010_growth_audit_slice1.sql":
        "CREATE TABLE IF NOT EXISTS app.capability_runs (async_run_id uuid);",
    },
    expectedTables: ["workspaces", "capability_runs"],
  });

  assert.equal(runVerifier(fixture).status, 0);
});

test("rejects duplicate migration ordinals", () => {
  const fixture = makeFixture({
    migrations: {
      "0010_growth_audit.sql": "CREATE TABLE IF NOT EXISTS app.audit_runs (id uuid);",
      "0010_other.sql": "CREATE TABLE IF NOT EXISTS app.site_pages (id uuid);",
    },
  });

  assert.match(runVerifier(fixture).stderr, /duplicate migration ordinal 0010/i);
});
```

**Step 2: Run the tests and record the expected failure**

Run:

```bash
node --test scripts/verify-spec-lock.test.mjs
```

Expected: FAIL because the current verifier loads `spec-v0.2-lock.json`, scans only `0001_init.sql`, and defaults to a sibling v0.2 authority checkout.

**Step 3: Check in the v0.3 authority scaffold without claiming future operations exist**

Copy the current v0.2 authority documents into the repository-owned v0.3 directory. Change the authority version and add the approved product model, invariants, and explicit non-goals to the narrative, but keep the initial normative OpenAPI operation set and SQL table set equal to the currently implemented v0.2 surface. Mark the audit, Opportunity, and recheck additions as a reviewed Slice 1 change sequence, not as already implemented normative operations.

The authority narrative must explicitly prohibit an Opportunity table, second Action creation path, checkpoint table, CMS publishing, and content lifecycle in v0.3. Tasks 3, 4, 5, and 8 will evolve the normative SQL/OpenAPI and their authority hashes in the same commits as the corresponding implementation. This keeps every commit truthful.

The authority verifier and app verifier must independently compute the complete table set from the ordered migration files and compare exact sets. Do not make either verifier trust the other verifier's output. The authority verifier should accept `--app-root <path>` for fixture testing and default to the enclosing Nevermore repository.

**Step 4: Make verification version-agnostic while leaving v0.2 active**

Refactor `verify-spec-lock.mjs` to accept an optional `--lock <path>` and derive version, authority root, migration glob, operations, tables, and hashes from that lock. Its default remains `scripts/spec-v0.2-lock.json` until Task 3 atomically creates and activates the v0.3 lock. In `verify-implementation.mjs`, replace only literal count messages such as “expected 28” with `EXPECTED_TABLES.length`; keep its separate checked-in operation, route, table, package, generated-contract, rule, and deployment expectations so it remains an independent implementation gate.

Add `verify:authority` to the root scripts:

```json
"verify:authority": "node authority/implementation-spec-v0.3/scripts/verify-spec.mjs"
```

Do not create or activate `spec-v0.3-lock.json` in this task. Task 3 creates it only when the v0.3 runtime constants and first v0.3 migration exist.

**Step 5: Run verification**

Run:

```bash
node --test scripts/verify-spec-lock.test.mjs
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
```

Expected: all PASS. `pnpm verify:spec` remains v0.2-active; the v0.3 authority scaffold verifier passes because its normative SQL/OpenAPI still match the implemented surface rather than future claims.

**Step 6: Commit**

```bash
git add authority/implementation-spec-v0.3 scripts/verify-spec-lock.mjs scripts/verify-spec-lock.test.mjs scripts/verify-implementation.mjs package.json
git commit -m "chore(spec): prepare reviewed v0.3 audit authority"
```

### Task 2: Add Growth Audit and Growth Opportunity contracts

**Files:**

- Create: `packages/contracts/src/zod/audit.ts`
- Create: `packages/contracts/src/zod/audit.test.ts`
- Create: `packages/contracts/src/zod/opportunities.ts`
- Create: `packages/contracts/src/zod/opportunities.test.ts`
- Create: `packages/contracts/src/zod/capabilities.ts`
- Create: `packages/contracts/src/zod/capabilities.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Step 1: Write failing contract tests**

Cover these exact behaviors:

```ts
expect(AuditModuleId.options).toEqual([
  "performance",
  "accessibility",
  "best_practices_security",
  "technical_search",
  "content_intent",
  "ai_geo",
  "links_architecture",
  "compliance_measurement",
]);

expect(() => ReviewableOpportunity.parse({
  ...baseOpportunity,
  readiness: "reviewable",
  primaryFindingId: undefined,
})).toThrow();

expect(() => CandidateOpportunity.parse({
  ...baseOpportunity,
  readiness: "candidate",
  primaryFindingId: findingId,
})).toThrow();

expect(GrowthOpportunity.parse({
  ...baseOpportunity,
  readiness: "reviewable",
  primaryFindingId: findingId,
  supportingFindingIds: [supportingFindingId],
  actionId: undefined,
})).toBeTruthy();
```

Also assert that:

- `workShape` accepts only `fix | improve | create`;
- `expand` is rejected;
- `primaryTarget` accepts only `site | template | url | topic | new_asset`;
- `coverageState` distinguishes `available | partial | stale | no_data`;
- SearchQuery evidence and GenerativeQuery evidence have separate discriminants and metric shapes;
- a confirmed Opportunity requires `actionId` and the Action's `findingId` equals `primaryFindingId`;
- exactly one fixed `artifactType` is present when an Action summary exists;
- an audit response always carries all eight module summaries and all three lens summaries;
- `CreateGrowthAuditRunRequest` rejects duplicate target refs and unknown keys.

**Step 2: Run the tests and verify failure**

Run:

```bash
pnpm vitest run --project unit packages/contracts/src/zod/audit.test.ts packages/contracts/src/zod/opportunities.test.ts packages/contracts/src/zod/capabilities.test.ts
```

Expected: FAIL because the new modules do not exist.

**Step 3: Implement discriminated, strict schemas**

Use discriminated unions so cardinality is structural rather than a UI convention:

```ts
const OpportunityBase = z.object({
  opportunityKey: z.string().min(1),
  title: z.string().min(1),
  workShape: z.enum(["fix", "improve", "create"]),
  primaryTarget: z.enum(["site", "template", "url", "topic", "new_asset"]),
  targetRef: z.string().min(1),
  supportingFindingIds: z.array(z.uuid()).default([]),
  lenses: z.array(z.enum([
    "site_health",
    "search_ai_visibility",
    "demand_competition",
  ])).min(1),
  coverageAndLimitations: z.array(z.string().min(1)),
}).strict();

export const CandidateOpportunity = OpportunityBase.extend({
  readiness: z.literal("candidate"),
  primaryFindingId: z.undefined().optional(),
  actionId: z.undefined().optional(),
}).strict();

export const ReviewableOpportunity = OpportunityBase.extend({
  readiness: z.literal("reviewable"),
  primaryFindingId: z.uuid(),
  actionId: z.undefined().optional(),
}).strict();

export const ConfirmedOpportunity = OpportunityBase.extend({
  readiness: z.literal("confirmed"),
  primaryFindingId: z.uuid(),
  actionId: z.uuid(),
  action: OpportunityActionSummary,
}).strict();

export const GrowthOpportunity = z.discriminatedUnion("readiness", [
  CandidateOpportunity,
  ReviewableOpportunity,
  ConfirmedOpportunity,
]).superRefine((value, ctx) => {
  if (
    value.readiness === "confirmed" &&
    value.action.findingId !== value.primaryFindingId
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["action", "findingId"],
      message: "Action must belong to the primary Finding",
    });
  }
});
```

Add a checked-in `RULE_OPPORTUNITY_PROJECTION` constant matching the eleven-row freeze above. Model `CONTENT-COVERAGE-001` and `CONTENT-GAP-011` with an `existing_page_first` work-shape policy: resolve `improve` when a suitable owned asset is the target and `create` only when the evidence proves no suitable asset exists. In a test, compare the mapping keys with the executable registry's eleven IDs so a rule addition cannot silently disappear from Growth Map.

**Step 4: Keep the schemas internal until their operations exist**

Export the Zod schemas from `packages/contracts/src/index.ts`, but do not add future operations or response components to `openapi/mvp.yaml` yet. Each API task adds its own OpenAPI operation, generated contract, authority delta, lock delta, route, and tests atomically. This preserves the repository's exact-operation verifier after every commit. Do not add `confirmOpportunity`; confirmation remains `reviewProjectFinding`.

**Step 5: Run tests and commit**

```bash
pnpm vitest run --project unit packages/contracts/src/zod/audit.test.ts packages/contracts/src/zod/opportunities.test.ts packages/contracts/src/zod/capabilities.test.ts
git add packages/contracts/src/zod packages/contracts/src/index.ts
git commit -m "feat(contracts): define growth audit opportunity projections"
```

### Task 3: Add the five-table Slice 1 persistence boundary

**Files:**

- Create: `packages/db/migrations/0010_growth_audit_slice1.sql`
- Create: `packages/db/src/repositories/capability-runs.ts`
- Create: `packages/db/src/repositories/audit-runs.ts`
- Create: `packages/db/src/repositories/site-pages.ts`
- Create: `packages/db/src/repositories/page-snapshots.ts`
- Create: `packages/db/src/__tests__/growth-audit-persistence.integration.test.ts`
- Create: `scripts/spec-v0.3-lock.json`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/migrate-check.ts`
- Modify: `packages/db/src/migration-version.ts`
- Modify: `packages/db/src/migration-version.test.ts`
- Modify: `packages/db/migrations/schema-smoke.sql`
- Modify: `scripts/verify-spec-lock.mjs`
- Modify: `scripts/verify-implementation.mjs`
- Modify: `authority/implementation-spec-v0.3/schema.sql`
- Modify: `authority/implementation-spec-v0.3/openapi.yaml`
- Modify: `authority/implementation-spec-v0.3/MVP-IMPLEMENTATION-SPEC.md`
- Modify: `authority/implementation-spec-v0.3/scripts/verify-spec.mjs`
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/worker/package.json`
- Modify: `packages/artifacts/package.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/db/package.json`
- Modify: `packages/engine/package.json`
- Modify: `packages/i18n/package.json`
- Modify: `packages/observability/package.json`
- Modify: `packages/sources/package.json`
- Modify: `packages/contracts/src/zod/health.ts`
- Modify: `packages/contracts/src/zod/health.test.ts`
- Modify: `packages/artifacts/src/export/manifest.ts`
- Modify: `packages/artifacts/src/export/bundle.test.ts`
- Modify: `schemas/service-bundle-manifest.schema.json`
- Modify: `apps/web/src/lib/services/diagnostics.ts`
- Modify: `apps/web/src/lib/services/artifacts.ts`
- Modify: `apps/web/src/lib/services/collection.ts`
- Modify: `apps/web/src/lib/services/csv-import.ts`
- Modify: `apps/web/src/lib/services/export-service.ts`
- Modify: `apps/web/src/lib/services/__tests__/read-model-mappers.test.ts`
- Modify: `apps/web/src/lib/services/__tests__/export-service.test.ts`
- Modify: `apps/web/src/lib/services/__tests__/export-download-errors.test.ts`
- Modify: `apps/web/src/lib/services/__tests__/full-chain-b2b.integration.test.ts`
- Modify: `apps/worker/src/diagnostic/run-diagnostic.test.ts`
- Modify: `apps/worker/src/artifact/run-artifact.test.ts`
- Modify: `apps/worker/src/artifact/__tests__/run-artifact.integration.test.ts`
- Modify: `apps/worker/src/export/run-export.test.ts`
- Modify: `apps/worker/src/export/__tests__/run-export.integration.test.ts`
- Modify: `apps/worker/src/handlers/recovery.test.ts`
- Modify: `apps/worker/src/handlers/recovery.integration.test.ts`
- Modify: `packages/db/src/repositories/repositories-core.test.ts`
- Modify: `packages/db/src/__tests__/export-bundle-invariants.integration.test.ts`
- Modify: `openapi/mvp.yaml`
- Regenerate: `packages/contracts/src/generated/openapi.ts`

**Step 1: Write a failing integration test**

The test must prove ownership and tenant isolation, not merely that inserts work:

```ts
it("anchors an audit projection to canonical runs and snapshots", async () => {
  const asyncRun = await fixtures.asyncRun({ operation: "growth_audit" });
  const diagnosticRun = await fixtures.diagnosticRun({ asyncRunId: asyncRun.id });
  const sourceSnapshot = await fixtures.dataSnapshot({ provider: "crawl" });

  const capability = await capabilityRuns.create({
    asyncRunId: asyncRun.id,
    capabilityId: "growth-audit",
    capabilityVersion: "0.3.0",
    inputManifestHash: hash,
    mode: "production",
    sideEffectClass: "internal_write",
  });
  const audit = await auditRuns.create({
    diagnosticRunId: diagnosticRun.id,
    capabilityRunId: capability.asyncRunId,
    scopeKind: "site",
    scopeKey: site.id,
  });
  const page = await sitePages.upsertNormalizedUrl({ projectId, siteId: site.id, url });
  const snapshot = await pageSnapshots.create({
    sitePageId: page.id,
    dataSnapshotId: sourceSnapshot.id,
    contentHash: hash,
    extract: { canonical: url },
  });

  expect(audit.diagnosticRunId).toBe(diagnosticRun.id);
  expect(snapshot.dataSnapshotId).toBe(sourceSnapshot.id);
  expect(await crossWorkspaceRead(otherWorkspace, audit.id)).toBeNull();
});
```

Also test:

- one `capability_runs` row per `async_run_id`;
- one `audit_runs` row per `diagnostic_run_id`;
- module results are unique by `(audit_run_id, module_id)`;
- page URL identity is unique by `(project_id, normalized_url_hash)`;
- page snapshots are immutable and reference a canonical `data_snapshots` row;
- deleting a source snapshot is restricted while a page snapshot references it;
- no new status column exists in `capability_runs` or `audit_runs`.

**Step 2: Run the integration test and verify failure**

Run:

```bash
pnpm vitest run --project integration packages/db/src/__tests__/growth-audit-persistence.integration.test.ts
```

Expected: FAIL because migration `0010_growth_audit_slice1.sql` and repositories do not exist.

**Step 3: Implement the migration and Drizzle query model**

Use this ownership skeleton; add the repository-standard workspace/project FKs, timestamps, RLS/grants, and indexes found in `0001_init.sql`:

```sql
CREATE TABLE IF NOT EXISTS app.capability_runs (
  async_run_id uuid PRIMARY KEY REFERENCES app.async_runs(id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  input_manifest_hash text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('production', 'shadow', 'simulation')),
  side_effect_class text NOT NULL CHECK (side_effect_class IN ('read_only', 'internal_write', 'external_write')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  project_id uuid NOT NULL REFERENCES app.client_projects(id),
  diagnostic_run_id uuid NOT NULL UNIQUE REFERENCES app.diagnostic_runs(id),
  capability_run_id uuid NOT NULL UNIQUE REFERENCES app.capability_runs(async_run_id),
  scope_kind text NOT NULL CHECK (scope_kind IN ('site', 'template', 'url')),
  scope_key text NOT NULL,
  projection_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.audit_module_results (
  audit_run_id uuid NOT NULL REFERENCES app.audit_runs(id) ON DELETE CASCADE,
  module_id text NOT NULL,
  coverage_state text NOT NULL CHECK (coverage_state IN ('available', 'partial', 'stale', 'no_data')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_run_id, module_id)
);

CREATE TABLE IF NOT EXISTS app.site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  project_id uuid NOT NULL REFERENCES app.client_projects(id),
  site_id uuid NOT NULL REFERENCES app.sites(id),
  normalized_url text NOT NULL,
  normalized_url_hash text NOT NULL,
  template_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, normalized_url_hash)
);

CREATE TABLE IF NOT EXISTS app.page_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  project_id uuid NOT NULL REFERENCES app.client_projects(id),
  site_page_id uuid NOT NULL REFERENCES app.site_pages(id),
  data_snapshot_id uuid NOT NULL REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  content_hash text NOT NULL,
  extract jsonb NOT NULL,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_page_id, data_snapshot_id, content_hash)
);

ALTER TABLE app.async_runs
  ALTER COLUMN contract_version SET DEFAULT '2026-07-21';

ALTER TABLE app.export_bundles
  DROP CONSTRAINT IF EXISTS export_bundles_schema_version_check,
  ALTER COLUMN schema_version SET DEFAULT 'signalframe.service-bundle.0.3.0';

ALTER TABLE app.export_bundles
  ADD CONSTRAINT export_bundles_schema_version_check
  CHECK (schema_version IN (
    'signalframe.service-bundle.0.2.0',
    'signalframe.service-bundle.0.3.0'
  ));
```

Do not add mutable `status`, Finding IDs, Action IDs, raw response blobs, or a second input manifest to these tables.

**Step 4: Activate product/contract v0.3 and the schema lock atomically**

In the same commit:

- update all workspace package versions and runtime/export constants to product `0.3.0`, contract `2026-07-21`, and export schema `signalframe.service-bundle.0.3.0` while leaving rule/prompt set versions unchanged;
- bump OpenAPI `info.version`, the checked-in service-bundle JSON Schema, generated contracts, `LATEST_APP_MIGRATION`, the migration-version view, health tests, export bundle tests, and Drizzle defaults;
- replace the five duplicated web-service `CONTRACT_VERSION` literals with the exported `@sf/contracts` constant, then update tests that assert the current contract; preserve `LEGACY_CONTRACT_VERSION = "0.2.0"` and its explicit recovery tests;
- change the export-bundle database default to v0.3 but allow existing v0.2 rows through the named check constraint so an upgrade does not invalidate historical immutable exports;
- create `scripts/spec-v0.3-lock.json` with `lockFormat: 2`, the repository-owned authority root, complete ordered-migration glob, exact operation/table/rule sets, and hashes for every normative authority file;
- switch the default app lock from v0.2 to v0.3;
- add exactly the five new table names to both verifier expectations;
- update authority file hashes;
- make both verifiers scan all ordered migrations;
- update schema smoke tests and migration counts;
- update repository lifecycle tests for the four new repository modules.

At this point the normative v0.3 OpenAPI still contains the existing v0.2 operations under product version `0.3.0`; later tasks add each new operation only with its route and tests. This is intentional incremental authority evolution, not a claim that the final v0.3 API is already present.

Run:

```bash
pnpm db:migrate:check
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
pnpm openapi:lint
pnpm contracts:generate
pnpm contracts:check
pnpm vitest run --project integration packages/db/src/__tests__/growth-audit-persistence.integration.test.ts
pnpm vitest run --project integration packages/db/src/__tests__/export-bundle-invariants.integration.test.ts apps/worker/src/artifact/__tests__/run-artifact.integration.test.ts apps/worker/src/export/__tests__/run-export.integration.test.ts apps/worker/src/handlers/recovery.integration.test.ts apps/web/src/lib/services/__tests__/full-chain-b2b.integration.test.ts
pnpm vitest run --project unit packages/db/src/repositories/repositories-lifecycle.test.ts packages/db/src/repositories/repositories-core.test.ts packages/db/src/migration-version.test.ts packages/contracts/src/zod/health.test.ts packages/artifacts/src/export/bundle.test.ts apps/web/src/lib/services/__tests__/read-model-mappers.test.ts apps/web/src/lib/services/__tests__/export-service.test.ts apps/web/src/lib/services/__tests__/export-download-errors.test.ts apps/worker/src/diagnostic/run-diagnostic.test.ts apps/worker/src/artifact/run-artifact.test.ts apps/worker/src/export/run-export.test.ts apps/worker/src/handlers/recovery.test.ts
```

Expected: all PASS; spec output reports 33 application tables and eleven rules.

**Step 5: Commit**

```bash
git add packages/db/migrations/0010_growth_audit_slice1.sql packages/db/migrations/schema-smoke.sql packages/db/src/schema.ts packages/db/src/index.ts packages/db/src/migrate-check.ts packages/db/src/migration-version.ts packages/db/src/migration-version.test.ts packages/db/src/repositories/capability-runs.ts packages/db/src/repositories/audit-runs.ts packages/db/src/repositories/site-pages.ts packages/db/src/repositories/page-snapshots.ts packages/db/src/repositories/repositories-lifecycle.test.ts packages/db/src/repositories/repositories-core.test.ts packages/db/src/__tests__/growth-audit-persistence.integration.test.ts packages/db/src/__tests__/export-bundle-invariants.integration.test.ts
git add authority/implementation-spec-v0.3 scripts/spec-v0.3-lock.json scripts/verify-spec-lock.mjs scripts/verify-implementation.mjs package.json apps/web/package.json apps/worker/package.json packages/*/package.json schemas/service-bundle-manifest.schema.json openapi/mvp.yaml packages/contracts/src/generated/openapi.ts packages/contracts/src/zod/health.ts packages/contracts/src/zod/health.test.ts packages/artifacts/src/export/manifest.ts packages/artifacts/src/export/bundle.test.ts
git add apps/web/src/lib/services/diagnostics.ts apps/web/src/lib/services/artifacts.ts apps/web/src/lib/services/collection.ts apps/web/src/lib/services/csv-import.ts apps/web/src/lib/services/export-service.ts apps/web/src/lib/services/__tests__/read-model-mappers.test.ts apps/web/src/lib/services/__tests__/export-service.test.ts apps/web/src/lib/services/__tests__/export-download-errors.test.ts apps/web/src/lib/services/__tests__/full-chain-b2b.integration.test.ts
git add apps/worker/src/diagnostic/run-diagnostic.test.ts apps/worker/src/artifact/run-artifact.test.ts apps/worker/src/artifact/__tests__/run-artifact.integration.test.ts apps/worker/src/export/run-export.test.ts apps/worker/src/export/__tests__/run-export.integration.test.ts apps/worker/src/handlers/recovery.test.ts apps/worker/src/handlers/recovery.integration.test.ts
git commit -m "feat(db): add growth audit projection persistence"
```

### Task 4: Create URL + ICP intake and the versioned full-audit run path

**Files:**

- Create: `apps/web/src/lib/services/audit-runs.ts`
- Create: `apps/web/src/lib/services/__tests__/audit-runs.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit-runs/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit-runs/route.test.ts`
- Create: `apps/worker/src/audit/run-full-audit.ts`
- Create: `apps/worker/src/audit/run-full-audit.test.ts`
- Create: `apps/worker/src/handlers/audit.ts`
- Create: `apps/web/src/app/new-project/_audit-intake-view-model.ts`
- Create: `apps/web/src/app/new-project/_audit-intake-view-model.test.ts`
- Modify: `apps/web/src/app/new-project/_form.tsx`
- Modify: `apps/web/src/app/new-project/_form-errors.ts`
- Modify: `apps/web/src/app/new-project/new-project.module.css`
- Modify: `apps/web/src/app/api/mvp/projects/route.test.ts`
- Modify: `apps/web/src/lib/services/projects.ts`
- Modify: `apps/web/src/lib/services/mappers.ts`
- Modify: `apps/web/src/lib/services/__tests__/projects.test.ts`
- Modify: `apps/web/src/lib/services/__tests__/projects.integration.test.ts`
- Modify: `apps/web/src/lib/services/__tests__/read-model-mappers.test.ts`
- Modify: `apps/web/src/lib/api/types.ts`
- Modify: `packages/contracts/src/zod/projects.ts`
- Modify: `packages/contracts/src/zod/projects.test.ts`
- Modify: `packages/i18n/src/en.ts`
- Modify: `packages/i18n/src/zh-CN.ts`
- Modify: `packages/db/src/queue.ts`
- Modify: `packages/db/src/queue.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/handlers/handlers-registration.test.ts`
- Modify: `openapi/mvp.yaml`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Modify: `scripts/verify-implementation.mjs`
- Modify: `authority/implementation-spec-v0.3/openapi.yaml`
- Modify: `authority/implementation-spec-v0.3/scripts/verify-spec.mjs`
- Modify: `scripts/spec-v0.3-lock.json`

**Step 1: Write failing service, route, and worker tests**

The service tests must cover:

- `CreateProjectRequest.initialIcpProfile` accepts a qualified `CompleteIcpProfileInput` and rejects URL/site market or locale values that contradict it;
- project, primary Site, default Crawl Source, immutable ICP v1, current ICP pointer, and ready stage are created in one idempotent transaction;
- the returned Project DTO exposes nullable `currentIcpProfileId` as well as its version, and the ID equals the immutable ICP row created inside the transaction;
- the create-project request hash includes the complete initial ICP and replay returns the same aggregate;
- legacy callers may omit `initialIcpProfile`, but the new audit-intake UI may not start an audit until a complete ICP exists;
- the intake accepts either an origin or a public page URL, derives the origin for `CreateProjectRequest.siteUrl`, and preserves the normalized submitted page as the initial audit target rather than silently discarding its path;
- project, site, and ICP all belong to the current workspace/project;
- archived projects are rejected;
- `capabilityContractVersion` must equal `growth-audit.0.3.0`;
- idempotency replay returns the same AsyncRun and does not enqueue twice;
- AsyncRun, CapabilityRun, DiagnosticRun, and AuditRun creation occur in one transaction;
- queue failure leaves a recoverable queued run, following the existing diagnostic pattern;
- worker reads only the frozen input manifest referenced by the run;
- eight module rows are written even when some are `no_data`;
- current eleven diagnostic rules remain canonical rule truth.

Route test shape:

```ts
const response = await POST(request({
  siteId,
  icpProfileId,
  scope: { kind: "url", targetRefs: ["/customer-onboarding/"] },
  outputLocale: "zh-CN",
  capabilityContractVersion: "growth-audit.0.3.0",
}), context(projectId));

expect(response.status).toBe(202);
expect(await response.json()).toMatchObject({ data: { operation: "growth_audit" } });
```

**Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run --project unit packages/contracts/src/zod/projects.test.ts apps/web/src/app/new-project/_audit-intake-view-model.test.ts apps/web/src/lib/services/__tests__/projects.test.ts apps/web/src/lib/services/__tests__/read-model-mappers.test.ts apps/web/src/lib/services/__tests__/audit-runs.test.ts apps/web/src/app/api/mvp/projects/route.test.ts 'apps/web/src/app/api/mvp/projects/[projectId]/audit-runs/route.test.ts' apps/worker/src/audit/run-full-audit.test.ts packages/db/src/queue.test.ts
```

Expected: FAIL because the intake view-model and the audit service, route, handler, and queue operation do not exist.

**Step 3: Implement the URL + complete ICP intake transaction**

Extend `CreateProjectRequest` with an optional `initialIcpProfile: CompleteIcpProfileInput`. Keep it optional for API compatibility, but make it required in the new audit-intake view-model. Add a schema refinement requiring the duplicate site projections (`marketCodes`, `siteLanguageCodes`, `defaultDeliveryLocale`) to equal the initial ICP values after normalization; do not let two contradictory contexts enter the transaction.

Inside `createProject`, include the initial profile in the idempotency hash. When present, use the existing `IcpProfilesRepository` and `contentHash` conventions to insert immutable complete version 1, set `client_projects.current_icp_profile_id`, update the ready stage, and return a freshly loaded aggregate. Add `currentIcpProfileId: string | null` to `ProjectDto`, the client `Project` type, the app/authority OpenAPI `Project` schema, and mapper tests; keep `currentIcpProfileVersion` for optimistic-context UX. Do not call `updateContext()` inside an existing transaction or duplicate its versioning semantics outside the repository layer.

The new-project UI becomes a progressive audit intake:

1. URL and company/product identity;
2. target customer, persona/job, use case, offer/differentiator, conversion;
3. markets/languages, competitors, constraints, growth questions, and 90-day goals;
4. review and “Create project & run audit”.

The user-facing URL field may contain `https://example.com` or a deeper page such as `https://example.com/customer-onboarding/`. The intake view-model passes only the normalized origin to the existing project boundary, then supplies the normalized submitted page/path as `scope: { kind: "url", targetRefs: [...] }` to the audit request; an origin-only input uses `scope: { kind: "site" }`. Reuse the repository's URL safety/normalization rules, and never fetch the submitted URL in the browser.

On submit, create the project with complete ICP, then call `createGrowthAuditRun` using `project.site.id` and the non-null `project.currentIcpProfileId`. If audit enqueue fails after project creation, route to the client-visible Overview (`today` compatibility route key) with a recoverable “Audit not started” state and a Retry control; Overview reloads the project DTO and reuses its Site/ICP IDs, never creates a second project, and refuses retry if context is no longer complete.

Add the optional field and its schemas to both app and authority OpenAPI in the same commit. This changes an existing operation rather than adding a second project-intake endpoint.

**Step 4: Implement the minimal create-run transaction**

Follow `apps/web/src/lib/services/diagnostics.ts`; do not call it as a black box because the new authority requires a larger request and the five-table transaction.

In the same edit, add `createGrowthAuditRun` to both app and authority OpenAPI, use the existing `AsyncAccepted` response, regenerate contracts, and update the v0.3 lock/implementation verifier. The strict request body is:

```yaml
type: object
additionalProperties: false
required: [siteId, icpProfileId, scope, outputLocale, capabilityContractVersion]
properties:
  siteId: { type: string, format: uuid }
  icpProfileId: { type: string, format: uuid }
  scope:
    type: object
    additionalProperties: false
    required: [kind]
    properties:
      kind: { type: string, enum: [site, template, url] }
      targetRefs:
        type: array
        maxItems: 1000
        uniqueItems: true
        items: { type: string, minLength: 1 }
  outputLocale: { type: string }
  capabilityContractVersion: { const: growth-audit.0.3.0 }
```

Persist this immutable capability manifest before enqueueing:

```ts
const manifest = {
  capabilityId: "growth-audit",
  capabilityVersion: "0.3.0",
  capabilityContractVersion: request.capabilityContractVersion,
  projectId,
  siteId: request.siteId,
  icpProfileId: request.icpProfileId,
  scope: request.scope,
  selectedSnapshotIds,
  outputLocale: request.outputLocale,
} as const;
```

Hash the canonical serialized manifest. Store the hash in `capability_runs` and the frozen snapshot list in the existing canonical DiagnosticRun input manifest. Never reconstruct the manifest from current project state in the worker.

**Step 5: Implement the worker as orchestration over existing engines**

The worker should:

1. claim the AsyncRun using existing queue semantics;
2. load the frozen manifest;
3. normalize URL identities into `site_pages`;
4. create derived `page_snapshots` that reference canonical `data_snapshots`;
5. invoke the existing deterministic diagnostic rule pipeline;
6. persist canonical rule results, Evidence, and Findings through existing paths;
7. materialize eight nullable `audit_module_results` summaries;
8. complete the existing AsyncRun status.

Do not import or execute code directly from `gengrowth-agents`; any ported rule must first pass parity tests and authority review.

**Step 6: Run tests, verification, and commit**

```bash
pnpm vitest run --project unit packages/contracts/src/zod/projects.test.ts apps/web/src/app/new-project/_audit-intake-view-model.test.ts apps/web/src/lib/services/__tests__/projects.test.ts apps/web/src/lib/services/__tests__/read-model-mappers.test.ts apps/web/src/lib/services/__tests__/audit-runs.test.ts apps/web/src/app/api/mvp/projects/route.test.ts 'apps/web/src/app/api/mvp/projects/[projectId]/audit-runs/route.test.ts' apps/worker/src/audit/run-full-audit.test.ts packages/db/src/queue.test.ts apps/worker/src/handlers/handlers-registration.test.ts
pnpm vitest run --project integration apps/web/src/lib/services/__tests__/projects.integration.test.ts
pnpm openapi:lint
pnpm contracts:generate
pnpm contracts:check
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
git add apps/web/src/lib/services/audit-runs.ts apps/web/src/lib/services/__tests__/audit-runs.test.ts apps/web/src/lib/services/projects.ts apps/web/src/lib/services/mappers.ts apps/web/src/lib/services/__tests__/projects.test.ts apps/web/src/lib/services/__tests__/projects.integration.test.ts apps/web/src/lib/services/__tests__/read-model-mappers.test.ts apps/web/src/lib/api/types.ts apps/web/src/app/new-project apps/web/src/app/api/mvp/projects/route.test.ts 'apps/web/src/app/api/mvp/projects/[projectId]/audit-runs' apps/worker/src/audit apps/worker/src/handlers/audit.ts apps/worker/src/index.ts apps/worker/src/handlers/handlers-registration.test.ts packages/db/src/queue.ts packages/db/src/queue.test.ts packages/contracts/src/zod/projects.ts packages/contracts/src/zod/projects.test.ts packages/i18n/src/en.ts packages/i18n/src/zh-CN.ts openapi/mvp.yaml packages/contracts/src/generated/openapi.ts authority/implementation-spec-v0.3 scripts
git commit -m "feat(audit): run versioned full growth audits"
```

### Task 5: Project Growth Audit and Opportunity read models through one evidence chain

**Files:**

- Create: `apps/web/src/lib/services/audit-projection.ts`
- Create: `apps/web/src/lib/services/__tests__/audit-projection.test.ts`
- Create: `apps/web/src/lib/services/opportunities.ts`
- Create: `apps/web/src/lib/services/__tests__/opportunities.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/route.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/modules/[moduleId]/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/urls/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/audit/urls/[urlId]/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/opportunities/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/opportunities/route.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/opportunities/[opportunityId]/route.ts`
- Create: `apps/web/src/lib/api/hooks-audit.ts`
- Create: `apps/web/src/lib/api/hooks-opportunities.ts`
- Modify: `openapi/mvp.yaml`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Modify: `authority/implementation-spec-v0.3/openapi.yaml`
- Modify: `authority/implementation-spec-v0.3/scripts/verify-spec.mjs`
- Modify: `scripts/spec-v0.3-lock.json`
- Modify: `scripts/verify-spec-lock.mjs`
- Modify: `scripts/verify-implementation.mjs`

**Step 1: Write failing projection tests**

Build fixtures for the `/customer-onboarding/` target and assert three separate Opportunity responses:

```ts
expect(opportunities.map((item) => ({
  key: item.opportunityKey,
  finding: item.primaryFindingId,
  workShape: item.workShape,
  artifact: item.action?.artifactType,
}))).toEqual([
  { key: "url:/customer-onboarding/:TECH-CANONICAL-002", finding: canonicalFindingId, workShape: "fix", artifact: "technical_ticket" },
  { key: "url:/customer-onboarding/:SEARCH-CTR-004", finding: ctrFindingId, workShape: "improve", artifact: "metadata_rewrite" },
  { key: "url:/customer-onboarding/:CONTENT-COVERAGE-001", finding: coverageFindingId, workShape: "improve", artifact: "content_brief" },
]);
```

The coverage fixture must include `/customer-onboarding/` as a suitable existing owned asset, so the checked-in existing-page-first resolver deterministically emits `improve`. Add a separate no-owned-asset fixture that emits `create`; never derive the difference from an LLM title.

Also prove:

- the three cards may share `targetRef` but never share a Confirm mutation;
- supporting findings do not become Action inputs;
- a candidate without a Finding has no review URL or Confirm capability;
- `pass` and `no_data` rule results do not create Opportunities;
- a Rule Catalog entry without measured evidence creates nothing;
- ordering uses deterministic impact/confidence/effort factors with stable ID tie-breakers;
- an LLM summary field cannot affect IDs, cardinality, work shape, artifact type, or score factors;
- Audit responses expose coverage/freshness/limitations and never remediation controls;
- URL detail traces Page Snapshot → Data Snapshot → Observation → Evidence → Finding.

**Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run --project unit apps/web/src/lib/services/__tests__/audit-projection.test.ts apps/web/src/lib/services/__tests__/opportunities.test.ts 'apps/web/src/app/api/mvp/projects/[projectId]/audit/route.test.ts' 'apps/web/src/app/api/mvp/projects/[projectId]/opportunities/route.test.ts'
```

Expected: FAIL because the projections and routes do not exist.

**Step 3: Implement deterministic projection functions**

Use stable keys:

```ts
function opportunityKey(target: OpportunityTarget, ruleId: RuleId): string {
  return `${target.kind}:${target.ref}:${ruleId}`;
}
```

For every active Finding:

1. resolve the rule freeze row;
2. resolve one normalized primary target from generated Evidence;
3. attach only target-relevant supporting evidence/findings;
4. read the canonical review state;
5. join the Action whose `finding_id` equals the primary Finding;
6. join only that Action's current Artifact summary;
7. attach coverage and limitation strings from source snapshots/module summaries.

Return related target stories as a read-only UI grouping field such as `relatedTargetKey`; do not persist it and do not expose a group mutation.

**Step 4: Implement project-scoped GET routes and hooks**

Follow the repository's authentication, workspace scope, problem response, cursor, and pagination helpers. All list routes must enforce bounded page size. The URL list and Opportunity list should default to the latest completed audit run unless `auditRunId` is supplied and belongs to the project.

Add `getProjectGrowthAudit`, `getProjectAuditModule`, `listProjectAuditUrls`, `getProjectAuditUrl`, `listProjectOpportunities`, and `getProjectOpportunity` to the app and authority OpenAPI in the same edit as their routes. Regenerate contracts, update the lock hashes/exact operation set, and add each route to the implementation verifier. Do not add an operation before its route exists.

Do not add a POST/PATCH under `/opportunities`. The existing route below remains the only confirmation mutation:

```text
PATCH /api/mvp/projects/{projectId}/findings/{primaryFindingId}
```

**Step 5: Run tests and commit**

```bash
pnpm vitest run --project unit apps/web/src/lib/services/__tests__/audit-projection.test.ts apps/web/src/lib/services/__tests__/opportunities.test.ts 'apps/web/src/app/api/mvp/projects/[projectId]/audit/route.test.ts' 'apps/web/src/app/api/mvp/projects/[projectId]/opportunities/route.test.ts'
pnpm openapi:lint
pnpm contracts:generate
pnpm contracts:check
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
pnpm typecheck
git add apps/web/src/lib/services/audit-projection.ts apps/web/src/lib/services/opportunities.ts apps/web/src/lib/services/__tests__/audit-projection.test.ts apps/web/src/lib/services/__tests__/opportunities.test.ts 'apps/web/src/app/api/mvp/projects/[projectId]/audit' 'apps/web/src/app/api/mvp/projects/[projectId]/opportunities' apps/web/src/lib/api/hooks-audit.ts apps/web/src/lib/api/hooks-opportunities.ts openapi/mvp.yaml packages/contracts/src/generated/openapi.ts authority/implementation-spec-v0.3 scripts
git commit -m "feat(web): project growth audit opportunities"
```

### Task 6: Replace the seven-page mental model with the four-entry Growth Map shell

**Files:**

- Create: `apps/web/src/app/p/[projectId]/today/page.tsx`
- Create: `apps/web/src/app/p/[projectId]/today/_today.tsx`
- Create: `apps/web/src/app/p/[projectId]/growth-map/page.tsx`
- Create: `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx`
- Create: `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.ts`
- Create: `apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts`
- Create: `apps/web/src/app/p/[projectId]/growth-map/growth-map.module.css`
- Create: `apps/web/src/app/p/[projectId]/execution/page.tsx`
- Create: `apps/web/src/app/p/[projectId]/execution/_execution.tsx`
- Create: `apps/web/src/app/p/[projectId]/results/page.tsx`
- Create: `apps/web/src/app/p/[projectId]/results/_results.tsx`
- Create: `e2e/growth-map.mock.spec.ts`
- Modify: `apps/web/src/app/p/[projectId]/_nav.tsx`
- Modify: `apps/web/src/app/p/[projectId]/layout.tsx`
- Modify: `apps/web/src/app/p/[projectId]/nav.module.css`
- Modify: `apps/web/src/app/p/[projectId]/overview/page.tsx`
- Modify: `apps/web/src/app/p/[projectId]/diagnosis/page.tsx`
- Modify: `apps/web/src/app/p/[projectId]/plan/page.tsx`
- Modify: `apps/web/src/app/p/[projectId]/studio/page.tsx`
- Modify: `apps/web/src/app/p/[projectId]/report/page.tsx`
- Modify: `packages/i18n/src/en.ts`
- Modify: `packages/i18n/src/zh-CN.ts`
- Modify: `e2e/mock-api.ts`

**Step 1: Write the failing view-model and navigation tests**

Assert exactly four primary entries in this order:

```ts
expect(primaryNavigation(projectId).map((item) => item.key)).toEqual([
  "today",
  "growth-map",
  "execution",
  "results",
]);
```

These are compatibility route keys, not visible labels. The same test must assert the Chinese-first labels `概览`, `增长地图`, `执行中心`, and `效果追踪`; `today` must never render as “Today” or “今日” in the client shell.

The Growth Map view-model tests must prove:

- three visible object modes inside Growth Map: `pages`, `keywords`, and `competitors`;
- `pages` is the default and exposes a project-level multi-URL portfolio rather than one URL hero;
- Audit Evidence and Opportunity Review remain states/details of the same URL/Opportunity object, not competing top-level tabs;
- observed Evidence has no Confirm command, while a reviewable Opportunity exposes Confirm only for `readiness: "reviewable"`;
- each command contains one `primaryFindingId`, never `supportingFindingIds`;
- the `/customer-onboarding/` target can be selected from a multi-URL list and shows three separately reviewable cards;
- the missing supporting guide candidate is visible but disabled with a clear “Needs a measured Finding” explanation;
- `no_data` is rendered as “No data / 数据不足”, never as `0` or `0%`.
- Keyword rows expose market, language, cluster, intent, mapped URL, source, observed-at/freshness, and status.
- Competitor rows expose relation, analysis scope, origin/evidence, and candidate/approved/excluded status.

**Step 2: Run the unit test and verify failure**

```bash
pnpm vitest run --project unit 'apps/web/src/app/p/[projectId]/growth-map/_growth-map-view-model.test.ts'
```

Expected: FAIL because the four-entry shell and Growth Map do not exist.

**Step 3: Build the frontstage projection**

Use `@frontend-design`. Preserve the existing authenticated Project shell and ProjectSwitcher, but replace primary navigation with:

- 概览 / Overview: next decision, latest audit freshness, work awaiting review, verification alerts; the internal `today` key may remain during route migration;
- Growth Map: multi-URL portfolio plus visible Keyword Library and Competitor Library subviews over one evidence system;
- Execution: canonical Actions and Artifacts with direct previews of article, brief, metadata, bug/code fix, and publish/UTM work;
- Results: immutable recheck comparisons, fixed before/after windows, page deltas, UTM audit, and honest outcome states.

Inside Growth Map:

- default to a searchable, filterable multi-URL table and selected URL detail;
- expose `页面与机会`, `关键词库`, and `竞品库` as second-level object modes;
- show Site Health, Search & AI Visibility, and Demand & Competition as filters over one map;
- show eight audit modules only as deep-detail filters, not eight primary pages;
- make source, observed-at time, affected target, limitation, and Finding ID inspectable;
- use one focused card/drawer for each Opportunity;
- make keyword and competitor provenance visible and support manual/CSV ingestion alongside automated discovery;
- call the existing Finding Review hook with `primaryFindingId` on Confirm.

Do not add role toggles, “operator mode vs customer mode”, or separate primary navigation for Market, Keyword, Competitor, Blog, or Publishing. Keyword and Competitor are required second-level subviews inside Growth Map; content and technical work are required previews inside Execution.

**Step 4: Keep legacy URLs as compatibility routes**

Use server redirects where state is not needed:

```ts
// overview/page.tsx
redirect(`/p/${projectId}/today`);

// diagnosis/page.tsx
redirect(`/p/${projectId}/growth-map`);

// plan/page.tsx and studio/page.tsx
redirect(`/p/${projectId}/execution`);

// report/page.tsx
redirect(`/p/${projectId}/results`);
```

Keep `context` and `sources` as secondary routes linked from the audit setup/freshness drawer, not primary nav. Preserve deep links and browser history.

**Step 5: Write and run the mock E2E**

The E2E must:

1. land on client-visible 概览 / Overview through the `today` compatibility route;
2. open Growth Map;
3. inspect `TECH-CANONICAL-002` evidence;
4. prove no Confirm button exists in Audit Evidence;
5. switch to Opportunity Review;
6. confirm only the canonical Opportunity's `primaryFindingId`;
7. verify one Action appears in Execution with Artifact type `technical_ticket`;
8. verify the related CTR and content Opportunities remain independently unconfirmed.

Run:

```bash
pnpm playwright test --config=playwright.mock.config.ts e2e/growth-map.mock.spec.ts
pnpm lint
pnpm typecheck
```

Expected: PASS at desktop and the existing configured mobile project, with no horizontal page overflow and no automated accessibility violations.

**Step 6: Commit**

```bash
git add 'apps/web/src/app/p/[projectId]' packages/i18n/src e2e/growth-map.mock.spec.ts e2e/mock-api.ts
git commit -m "feat(web): introduce unified growth map shell"
```

### Task 7: Prove the technical Opportunity reuses one Action and one technical ticket

**Files:**

- Create: `apps/web/src/lib/services/__tests__/technical-opportunity-vertical.integration.test.ts`
- Modify: `apps/web/src/app/p/[projectId]/execution/_execution.tsx`
- Modify: `apps/web/src/lib/services/workspace-view.ts`
- Modify: `apps/web/src/lib/services/__tests__/workspace-view-reader-executor.test.ts`
- Verify unchanged: `packages/engine/src/action-templates.ts`
- Verify unchanged: `packages/artifacts/src/templates/technical-ticket.ts`
- Verify unchanged: `apps/web/src/lib/services/finding-review.ts`
- Verify unchanged: `apps/web/src/lib/services/artifacts.ts`
- Verify unchanged: `apps/worker/src/artifact/run-artifact.ts`

**Step 1: Write a failing vertical integration test**

Use the existing full-chain harness to prove:

```ts
const opportunity = await getOpportunity(canonicalFinding);
expect(opportunity.readiness).toBe("reviewable");

const firstReview = await reviewProjectFinding({
  findingId: opportunity.primaryFindingId,
  reviewState: "confirmed",
  baseRevision: 0,
});
const replay = await reviewProjectFinding({
  findingId: opportunity.primaryFindingId,
  reviewState: "confirmed",
  baseRevision: firstReview.revision,
});

expect(replay.action.id).toBe(firstReview.action.id);
expect(replay.action.artifactType).toBe("technical_ticket");
expect(await countActionsForFinding(opportunity.primaryFindingId)).toBe(1);
```

Then create and run the Artifact and assert that exactly one current technical-ticket revision is surfaced in Execution. Supporting findings must have zero Actions.

**Step 2: Run the test and verify the expected UI-projection failure**

```bash
pnpm vitest run --project integration apps/web/src/lib/services/__tests__/technical-opportunity-vertical.integration.test.ts
```

Expected: the canonical chain passes until the new Execution projection assertion, which fails because the four-entry view does not yet join the Opportunity summary.

**Step 3: Add only the read-model join needed by Execution**

Extend the existing workspace read model to expose:

- primary Finding identity;
- target ref;
- canonical Action identity/status;
- fixed Artifact type;
- current Artifact revision/status;
- audit/recheck state.

Do not add an `opportunity_id` column to Actions or Artifacts. The join remains `Opportunity.primaryFindingId → Action.finding_id → execution_artifacts.action_id`.

**Step 4: Run the existing and new chain tests**

```bash
pnpm vitest run --project integration apps/web/src/lib/services/__tests__/technical-opportunity-vertical.integration.test.ts apps/worker/src/artifact/__tests__/run-artifact.integration.test.ts
pnpm vitest run --project unit packages/artifacts/src/templates/technical-ticket.test.ts apps/web/src/lib/services/__tests__/workspace-view-reader-executor.test.ts
```

Expected: all PASS, and the pre-existing artifact path is unchanged except for projection data.

**Step 5: Commit**

```bash
git add apps/web/src/lib/services/__tests__/technical-opportunity-vertical.integration.test.ts 'apps/web/src/app/p/[projectId]/execution/_execution.tsx' apps/web/src/lib/services/workspace-view.ts apps/web/src/lib/services/__tests__/workspace-view-reader-executor.test.ts
git commit -m "test(growth): prove one-finding technical delivery chain"
```

### Task 8: Add the reviewed recheck operation and Results comparison

**Files:**

- Create: `packages/contracts/src/zod/recheck.ts`
- Create: `packages/contracts/src/zod/recheck.test.ts`
- Create: `apps/web/src/lib/services/recheck.ts`
- Create: `apps/web/src/lib/services/__tests__/recheck.test.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/recheck/route.ts`
- Create: `apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/recheck/route.test.ts`
- Create: `apps/worker/src/audit/run-recheck.ts`
- Create: `apps/worker/src/audit/run-recheck.test.ts`
- Create: `apps/web/src/lib/services/results.ts`
- Create: `apps/web/src/lib/services/__tests__/results.test.ts`
- Create: `apps/web/src/lib/api/hooks-results.ts`
- Modify: `apps/web/src/app/p/[projectId]/results/_results.tsx`
- Modify: `apps/worker/src/handlers/audit.ts`
- Modify: `packages/db/src/queue.ts`
- Modify: `openapi/mvp.yaml`
- Regenerate: `packages/contracts/src/generated/openapi.ts`
- Modify: `authority/implementation-spec-v0.3/openapi.yaml`
- Modify: `authority/implementation-spec-v0.3/scripts/verify-spec.mjs`
- Modify: `scripts/spec-v0.3-lock.json`
- Modify: `scripts/verify-spec-lock.mjs`
- Modify: `scripts/verify-implementation.mjs`

**Step 1: Write failing contract, service, worker, and Results tests**

Contract tests must reject:

- missing `priorRunId`;
- a prior run outside the project;
- an Action outside the project;
- a target scope different from the Action's primary Finding target;
- a version other than `growth-audit.0.3.0`;
- reuse of the prior run ID as the new run ID.

Results classification must be rule-level and honest:

```ts
expect(compareRule(priorFail, currentPass)).toEqual({ state: "verified", direction: "resolved" });
expect(compareRule(priorFail, currentFail)).toEqual({ state: "observed", direction: "unchanged" });
expect(compareRule(priorFail, currentNoData)).toEqual({ state: "insufficient_data", direction: "unknown" });
```

Also assert no query or migration references `performance_checkpoints`.

**Step 2: Run focused tests and verify failure**

```bash
pnpm vitest run --project unit packages/contracts/src/zod/recheck.test.ts apps/web/src/lib/services/__tests__/recheck.test.ts 'apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/recheck/route.test.ts' apps/worker/src/audit/run-recheck.test.ts apps/web/src/lib/services/__tests__/results.test.ts
```

Expected: FAIL because recheck and Results services do not exist.

**Step 3: Implement create-recheck as a distinct v0.3 transaction**

Persist this immutable relationship in the canonical run payload/manifest, not a checkpoint table:

```ts
{
  operation: "growth_audit_recheck",
  priorRunId,
  actionId,
  targetScope,
  capabilityContractVersion: "growth-audit.0.3.0",
  selectedSnapshotIds,
}
```

Add `createActionRecheck` and `getProjectResults` to the app and authority OpenAPI only in this task, regenerate contracts, and update the v0.3 lock/route verifier in the same commit. `CreateActionRecheckRequest` must be strict and require `priorRunId`, `actionId`, `targetScope`, and `capabilityContractVersion`; `targetScope.targetRefs` must be unique and non-empty.

Create a new AsyncRun, CapabilityRun, DiagnosticRun, and AuditRun with its own immutable selected snapshots. Enqueue once using the repository's idempotency key convention. Do not call `createDiagnosticRun` with a disguised payload.

**Step 4: Implement worker comparison and Results projection**

The recheck worker invokes the same audit pipeline with the new frozen inputs. Results joins the prior and new `diagnostic_run_rules` for the reviewed Action's primary rule and target, then returns:

- prior/new run IDs and observed timestamps;
- rule version and target scope;
- prior/new status and inspected values;
- `verified | observed | insufficient_data`;
- limitations;
- explicitly separate search and generative evidence summaries, if present.

The Results UI must never say “impact” or “lift” when it has only verified a technical condition. Use “Technical condition verified” and leave Search/GEO outcome as pending or insufficient until trustworthy outcome data exists.

**Step 5: Run verification and commit**

```bash
pnpm vitest run --project unit packages/contracts/src/zod/recheck.test.ts apps/web/src/lib/services/__tests__/recheck.test.ts 'apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/recheck/route.test.ts' apps/worker/src/audit/run-recheck.test.ts apps/web/src/lib/services/__tests__/results.test.ts
pnpm openapi:lint
pnpm contracts:generate
pnpm contracts:check
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
git add packages/contracts/src/zod/recheck.ts packages/contracts/src/zod/recheck.test.ts packages/contracts/src/generated/openapi.ts apps/web/src/lib/services/recheck.ts apps/web/src/lib/services/results.ts apps/web/src/lib/services/__tests__/recheck.test.ts apps/web/src/lib/services/__tests__/results.test.ts 'apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/recheck' apps/worker/src/audit apps/worker/src/handlers/audit.ts packages/db/src/queue.ts apps/web/src/lib/api/hooks-results.ts 'apps/web/src/app/p/[projectId]/results/_results.tsx' openapi/mvp.yaml authority/implementation-spec-v0.3 scripts
git commit -m "feat(results): recheck immutable growth audit runs"
```

### Task 9: Prove the technical vertical, run the stop gate, and stop

**Files:**

- Create: `e2e/audit-technical-vertical.mock.spec.ts`
- Create: `docs/reviews/2026-07-21-growth-opportunity-slice1-stop-gate.md`
- Modify: `e2e/mock-api.ts`
- Modify: `README.md`

**Step 1: Write the failing vertical E2E**

The mock must use stable IDs but mimic real response contracts. The test walks exactly this path:

```text
URL + ICP
→ createGrowthAuditRun
→ Overview freshness/status (`today` compatibility route)
→ Growth Map / Audit Evidence
→ inspect canonical conflict and No Data limitation
→ Growth Map / Opportunity Review
→ confirm primary Finding only
→ Execution / one technical_ticket
→ mark work done in existing Action lifecycle
→ createActionRecheck
→ Results / prior-vs-new comparison
```

Assertions must prove:

- exactly four primary nav entries;
- audit evidence and Opportunity review share the same target and Evidence IDs;
- Audit Evidence has no remediation mutation;
- three related Opportunities are separate cards;
- only the canonical card is confirmed;
- one Finding produced one Action and one fixed Artifact type;
- the recheck used a new run ID and preserved the old run;
- technical verification does not claim traffic, rank, revenue, or AI-citation lift;
- no Content Shadow control performs a production write.

**Step 2: Run the E2E and fix only Slice 1 regressions**

```bash
pnpm playwright test --config=playwright.mock.config.ts e2e/audit-technical-vertical.mock.spec.ts
```

Expected: FAIL first on the first missing contract/selector, then PASS after minimal fixes. Do not fix it by widening the scope into Content Shadow.

**Step 3: Run the full repository gate**

```bash
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
pnpm openapi:lint
pnpm contracts:generate
pnpm contracts:check
pnpm db:migrate:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e:mock
pnpm build
git diff --check
git status --short
```

Expected: all commands PASS. `git status --short` contains only intentional review documentation before the final commit.

If a real test environment with provider credentials is available, additionally run the existing safe real E2E and one concierge audit against an owned site. Never place provider credentials or raw customer payloads in the stop-gate document.

**Step 4: Conduct the product stop-gate review**

Record evidence for each decision in `docs/reviews/2026-07-21-growth-opportunity-slice1-stop-gate.md`:

```markdown
## Required decisions

- [ ] Operators and a client can explain Growth Map without being taught the old seven-page model.
- [ ] No Data is understood as missing coverage, not a zero score.
- [ ] The default Growth Map is clearly a multi-URL portfolio, and Audit Evidence / Opportunity Review remain understandable states of one selected object.
- [ ] Keyword and Competitor libraries show provenance and analysis scope without introducing separate primary navigation.
- [ ] One measured Finding creates exactly one Action and one technical ticket.
- [ ] Recheck compares two immutable runs and makes no outcome claim beyond its evidence.
- [ ] No parallel Opportunity, content, Action, Artifact, or checkpoint lifecycle was introduced.

## Decision

`accepted | revise_slice_1 | stop`
```

Do not begin Slice 2 while any checkbox is unproven or the decision is not `accepted`.

**Step 5: Document the Slice 2 re-entry brief—without implementing it**

Append a short non-normative section to the stop-gate review. It may name the future target story and acceptance questions, but must not add migrations or tasks. The re-entry proposal is:

```text
one test project
+ one explicit competitor set
+ one SearchQuery cluster
+ one independent GenerativeQuery set
+ existing-page-first decision
→ one canonical content-related Finding
→ one Action
→ one content_brief
→ pinned Flow Shadow research/draft/QA
→ human side-by-side review
→ no CMS write
```

Only after the product owner accepts the Slice 1 stop gate should a new `2026-XX-XX-seo-geo-content-shadow-implementation.md` be written.

**Step 6: Commit**

```bash
git add e2e/audit-technical-vertical.mock.spec.ts e2e/mock-api.ts README.md docs/reviews/2026-07-21-growth-opportunity-slice1-stop-gate.md
git commit -m "test(growth): verify technical opportunity stop gate"
```

## Definition of done

Slice 1 is complete only when all of the following are true:

- the authority package, lock, OpenAPI, migrations, runtime constants, generated contracts, and both verifiers agree on v0.3;
- a full audit run freezes URL/ICP/snapshot inputs and surfaces all eight module coverage states under three frontstage lenses;
- Growth Map defaults to a multi-URL portfolio, exposes Keyword and Competitor subviews with provenance, and displays the same Evidence once across selected-object Evidence and Opportunity Review;
- a reviewable Opportunity has exactly one primary Finding and no direct mutation route;
- the existing Finding Review transaction creates one canonical Action with one template-fixed Artifact type;
- Execution shows that canonical Action/Artifact chain;
- recheck creates a new immutable run linked to prior run, Action, target scope, and capability version;
- Results labels technical condition, observed outcome, and insufficient data honestly;
- only 概览 / Overview, 增长地图 / Growth Map, 执行中心 / Execution, and 效果追踪 / Results are primary entries;
- legacy deep links remain safe;
- full verification is green;
- the documented Slice 1 product stop gate is accepted.

The artifact demo may visualize the proposed Content Shadow for design validation. That visualization is not evidence that Slice 2 is implemented, and none of its content, fact-gate, review, or publish behavior belongs in this plan.
