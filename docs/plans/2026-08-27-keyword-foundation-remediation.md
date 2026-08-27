# Low-Competition Keyword Foundation Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a v3 Low-Competition Keywords contract whose decisions are monotonic, supporting pages retain honest provenance, every candidate reconciles through a privacy-safe ledger, threshold calibration is replayable, and the real Marketing flow has paid-call-free browser coverage.

**Architecture:** Keep the current two-stage Marketing request shape for this first release, but move all result semantics into a versioned v3 public-tools contract. The Marketing handler supplies raw counts, timings and threshold facts; `packages/public-tools` deterministically builds the ledger and enforces invariants; the browser renders and exports that public payload without server persistence. Vercel Workflow remains a separately authorized second release.

**Tech Stack:** TypeScript strict, Next.js 16.2, React 19, Vitest 4, Playwright 1.61, next-intl, existing sealed-token/auth/provider seams.

---

### Task 1: Freeze the v3 decision policy and schema version

**Files:**
- Modify: `packages/public-tools/src/keyword-opportunity/signals.test.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/signals.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/types.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.test.ts`

**Step 1: Write the failing positive-plus-unavailable tests**

Add one case for each positive signal combined with a different unavailable
signal. Assert `eligible`, preserve the positive-signal list, and keep the raw
unavailable sibling in the observation.

**Step 2: Run RED**

Run:

```bash
pnpm exec vitest run --project unit packages/public-tools/src/keyword-opportunity/signals.test.ts
```

Expected: FAIL because the current classifier checks unavailable before
positive.

**Step 3: Implement positive-first classification**

Order the classifier as:

```text
positiveSignals.length > 0
unavailable !== undefined
all negative
```

Do not alter the raw signal evidence.

**Step 4: Bump the schema literal**

Change the emitted schema to `keyword_opportunity_map.v3`. Add a test proving
new envelopes emit v3 and renderer-compatible result fields remain optional on
the broad `KeywordOpportunityResult` reader type.

**Step 5: Run GREEN**

Run the signals and report tests. Expected: PASS.

**Step 6: Commit**

```bash
git add packages/public-tools/src/keyword-opportunity/{signals.ts,signals.test.ts,types.ts,report.test.ts}
git commit -m "fix(public-tools): admit observed keyword signals monotonically"
```

### Task 2: Replace supporting-page implication with explicit provenance

**Files:**
- Modify: `packages/public-tools/src/keyword-opportunity/types.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/coverage.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/coverage.test.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`

**Step 1: Write failing provenance tests**

Assert the four URL sources independently:

```ts
type KeywordOpportunitySupportingPage =
  | {
      readonly availability: "available";
      readonly source:
        | "gsc_observed_query_page"
        | "lexical_page_match"
        | "inventory_url_match"
        | "llm_proposition_source";
      readonly url: string;
    }
  | {
      readonly availability: "unavailable";
      readonly source: null;
      readonly url: null;
    };
```

Specifically prove that LLM attribution is `available` data with source
`llm_proposition_source`; it is never called `observed`.

**Step 2: Run RED**

Run coverage tests. Expected: FAIL on missing provenance.

**Step 3: Implement the coverage projection**

Precedence:

```text
exact GSC query-page
lexical crawled-page match
sitemap inventory match
LLM proposition source
unavailable
```

Coverage state remains separate and keeps its existing honesty semantics.

**Step 4: Carry provenance end to end**

Add `supportingPage` to observations, eligible rows and incomplete rows. Retain
`supportingPageUrl?` only for the v2 skew window; all v3 producers and consumers
use the structured field.

**Step 5: Run GREEN**

Run coverage, report and handler tests. Expected: PASS.

**Step 6: Commit**

```bash
git add packages/public-tools/src/keyword-opportunity apps/marketing/src/lib/tools/keyword-opportunity-handler*
git commit -m "fix(public-tools): preserve keyword page provenance"
```

### Task 3: Define and reconcile the privacy-safe process ledger

**Files:**
- Modify: `packages/public-tools/src/keyword-opportunity/types.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/report.test.ts`

**Step 1: Write failing ledger tests**

Build one observation set containing all validation states, dispositions and
SERP failure reasons. Assert:

```text
validation.requested = available + explicitZero + providerNoData
decisions.total = eligible + withheld + incomplete
serp.planned = completed + sum(failureReasons)
serp.dispatched = planned - budget_exhausted
```

Assert `accounted: false` for a deliberately inconsistent injected summary.

**Step 2: Run RED**

Run report tests. Expected: FAIL because no complete ledger exists.

**Step 3: Implement the v3 ledger types**

Add validation, SERP, decision, supporting-page, signal-combination, threshold
and duration summaries. Use exact typed reason unions and readonly outputs.

**Step 4: Implement deterministic aggregation**

Build histograms from observations and injected transport facts. Do not accept
free-form reason keys. Do not include keywords, URLs or provider free text in
the summary.

**Step 5: Run GREEN**

Run report tests. Expected: PASS.

**Step 6: Commit**

```bash
git add packages/public-tools/src/keyword-opportunity/{types.ts,report.ts,report.test.ts}
git commit -m "feat(public-tools): reconcile keyword run evidence"
```

### Task 4: Supply timings, transport counts and safe logs from the handler

**Files:**
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-signal-evidence.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-signal-evidence.test.ts`

**Step 1: Write failing handler tests**

Use the injected clock to prove exact duration boundaries for validation,
coverage, SERP sampling, interpretation, enrichment, report and total. Add
SERP failure histograms containing provider, no-data, outcome-unknown and
budget-exhausted cases.

Spy on `console.info` and assert the single ledger log contains only bounded
counts/version/timings. Assert it does not contain site URL, keyword, prompt,
provider title/URL/domain or credentials.

**Step 2: Run RED**

Expected: missing ledger fields/log.

**Step 3: Instrument stage boundaries**

Use the existing injected `now()` seam; do not add a global timer dependency.
Capture each stage around the real await and pass the facts into
`buildKeywordOpportunityPayload`.

**Step 4: Add threshold facts**

Expose the exact site rank, tier, 24-month policy and selected ETV threshold.
Keep the numeric policy in one versioned helper.

**Step 5: Emit one safe summary line**

Use one structured JSON log in the existing final reporting boundary. Preserve
the separate cost line. Never log raw candidate or evidence arrays.

**Step 6: Run GREEN and commit**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts apps/marketing/src/lib/tools/keyword-signal-evidence.test.ts
git add apps/marketing/src/lib/tools/keyword-opportunity-handler* apps/marketing/src/lib/tools/keyword-signal-evidence*
git commit -m "feat(marketing): report keyword run reasons safely"
```

### Task 5: Render the ledger and export an audit JSON

**Files:**
- Modify: `apps/marketing/src/components/tools/keyword-map-results.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.test.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results-interaction.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `packages/public-tools/src/keyword-opportunity/csv.ts`
- Modify: `packages/public-tools/src/keyword-opportunity/csv.test.ts`

**Step 1: Write failing component/export tests**

Assert the collapsed screening process shows reason totals and invariants,
missing v2 ledger values render as not measured, and each supporting-page
source has a different label. Assert no LLM attribution is described as an
observed answer.

Add an audit JSON button test that parses the generated Blob body and matches
the public result exactly.

**Step 2: Run RED**

Expected: missing ledger, button and labels.

**Step 3: Implement concise UI**

Keep the compact tables. Put ledger detail inside the existing screening
disclosure. Add one secondary `Export audit JSON` control next to CSV.

**Step 4: Add CSV provenance**

Append `supportingPageSource`; keep unavailable URLs blank and formula escaping
unchanged.

**Step 5: Run GREEN and commit**

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/keyword-map-results.test.tsx apps/marketing/src/components/tools/keyword-map-results-interaction.test.tsx packages/public-tools/src/keyword-opportunity/csv.test.ts
git add apps/marketing/src/components/tools/keyword-map-results* apps/marketing/src/i18n/messages/{en,zh}.json packages/public-tools/src/keyword-opportunity/csv*
git commit -m "feat(marketing): expose keyword audit ledger"
```

### Task 6: Correct every methodology and result label

**Files:**
- Modify: `apps/marketing/src/components/tools/connected-tool-content.ts`
- Modify: `apps/marketing/src/app/[locale]/tools/page.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.test.tsx`
- Modify: `apps/marketing/src/lib/tools/keyword-map-messages.test.ts`

**Step 1: Write failing static copy tests**

Reject:

```text
candidates are priced, not guessed
fixed waves / parallel waves
page that answers it
weak site on page one (as the v3 decision label)
```

Require model-proposes/provider-prices, replenishing pool up to ten, and
source-specific page language.

**Step 2: Run RED, update EN/ZH copy, run GREEN**

Run message parity and result tests.

**Step 3: Commit**

```bash
git add apps/marketing/src/components/tools/connected-tool-content.ts 'apps/marketing/src/app/[locale]/tools/page.tsx' apps/marketing/src/i18n/messages apps/marketing/src/lib/tools/keyword-map-messages.test.ts apps/marketing/src/components/tools/keyword-map-results.test.tsx
git commit -m "fix(marketing): describe keyword evidence truthfully"
```

### Task 7: Add the offline calibration replay harness

**Files:**
- Create: `packages/public-tools/src/keyword-opportunity/calibration.ts`
- Create: `packages/public-tools/src/keyword-opportunity/calibration.test.ts`
- Create: `packages/public-tools/src/keyword-opportunity/__fixtures__/calibration-synthetic.v1.json`
- Create: `scripts/keyword-opportunity-calibration.mjs`
- Create: `docs/external-reviews/2026-08-27-keyword-opportunity-calibration-baseline.md`
- Modify: `packages/public-tools/src/keyword-opportunity/index.ts`
- Modify: `package.json`

**Step 1: Write failing pure replay tests**

Assert deterministic replay, no source mutation, current-vs-v3 policy flips,
threshold grid flips, label-aware metrics and label-free metrics.

**Step 2: Run RED**

Expected: missing calibration module.

**Step 3: Implement the pure module**

Accept data objects, not file paths. Keep Node file I/O in the script. Validate
the versioned fixture at the script boundary.

**Step 4: Add the CLI and synthetic fixture**

The artifact must state `synthetic: true` and `calibrated: false`. Add a package
script such as `calibrate:keyword-opportunity`.

**Step 5: Generate and review the baseline**

The report must say no production threshold change is supported until real
owner labels are added. Do not commit fabricated precision.

**Step 6: Run GREEN and commit**

```bash
pnpm exec vitest run --project unit packages/public-tools/src/keyword-opportunity/calibration.test.ts
pnpm calibrate:keyword-opportunity
git add packages/public-tools/src/keyword-opportunity scripts/keyword-opportunity-calibration.mjs docs/external-reviews/2026-08-27-keyword-opportunity-calibration-baseline.md package.json
git commit -m "test(public-tools): add keyword calibration replay"
```

### Task 8: Add the dedicated paid-call-free Playwright flow

**Files:**
- Create: `apps/marketing/e2e/low-competition-keywords.spec.ts`
- Create or modify: the narrowest existing Marketing E2E cookie helper
- Modify: `apps/marketing/playwright.config.ts` only if the existing env cannot express the connected fixture

**Step 1: Write the E2E with strict network guards**

Cover signed-out, connected happy/partial, partial-empty, retry-to-confirm and
audit export. Fulfill only the two keyword endpoints plus the known shell
requests. Abort every unexpected `/api/` call.

**Step 2: Run RED**

Expected: missing v3 UI/copy or fixture wiring.

**Step 3: Add the minimum cookie/test helper**

Use test-only environment and existing sealed cookie code. Do not add a
production harness route or provider bypass.

**Step 4: Run GREEN and commit**

```bash
pnpm --filter @sf/marketing test:e2e -- low-competition-keywords.spec.ts
git add apps/marketing/e2e/low-competition-keywords.spec.ts apps/marketing/playwright.config.ts
git commit -m "test(marketing): cover keyword opportunity flow"
```

### Task 9: Run the complete first-release verification matrix

**Files:**
- Verify only; modify only fresh patch-caused failures.

**Step 1: Focused suite**

Run all keyword opportunity, provider, prompt, crawl, handler, UI, i18n and E2E
tests.

**Step 2: Package gates**

```bash
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing build
```

**Step 3: Repository gates**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e:mock
pnpm verify:spec
pnpm verify:public-tools-boundary
pnpm verify:docs
pnpm secrets:scan
git diff --check
```

Prove any baseline failure against unchanged `origin/main`; do not weaken a
gate.

**Step 4: Independent reviews**

Run specification, correctness, privacy/security and UI/accessibility reviews.
Resolve every P0/P1/P2 caused by the branch and rerun affected gates.

### Task 10: Ship and verify the first release

**Files:**
- Git/GitHub/Vercel state only.

**Step 1: Freeze and review the exact diff**

Confirm no migration, apps/web, Worker, Product or new production configuration.

**Step 2: Push and open the PR**

Push the reviewed branch, create a focused PR, and wait for all checks and both
Vercel previews.

**Step 3: Merge only the reviewed SHA**

After server-side merge, query PR state before retrying any failed local cleanup.

**Step 4: Verify Marketing production**

Require exact merge SHA, READY, expected aliases, canonical/default/locale/www
routes, live v3/copy/bundle markers, safe unauthenticated boundary and clean
runtime error/fatal logs. Do not trigger a paid keyword run.

**Step 5: Verify Product independently**

Record Product candidate state/SHA and `app.gengrowth.ai` health. A same-SHA
READY redeploy is a deployment change, even with no Product source diff.

### Task 11: Implement the durable Vercel Workflow release after approval

**Precondition:** explicit owner approval for the `workflow` dependency,
`withWorkflow()` Next config and billed Workflow Steps/Storage.

**Files (planned, not authorized in the first release):**
- Modify: `apps/marketing/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/marketing/next.config.ts`
- Create: `apps/marketing/src/lib/tools/keyword-opportunity-workflow.ts`
- Create: `apps/marketing/src/lib/tools/keyword-opportunity-workflow.test.ts`
- Modify/Create: start/status/result API routes and `KeywordMapTool` progress UI

Use step functions for all Node/provider/LLM work, a workflow function only for
orchestration, identity-bound start/status/result routes, typed progress, and
idempotent cost boundaries. Preserve the v3 report contract unchanged. This
task requires its own design review, RED/GREEN workflow tests, preview canary,
usage review and production release evidence.
