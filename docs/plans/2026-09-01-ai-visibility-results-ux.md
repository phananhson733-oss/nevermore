# AI Visibility Results UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix one gap-classification truth bug and make the AI Visibility results easier to scan without changing provider observations, metric denominators, persistence or database contracts.

**Architecture:** Preserve the V2 report schema and compute presentation-only missing intent rows and source types at render time. Keep domain aggregates separate from bounded page evidence. Use existing GenGrowth tokens and disclosures rather than new visual primitives or color values.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, next-intl, Tailwind tokens, Vitest, Playwright.

---

### Task 1: Close the demand-mode gap truth bug

**Files:**
- Modify: `apps/marketing/src/lib/geo-tools/gap-classify.ts:24-30`
- Test: `apps/marketing/src/lib/geo-tools/gap-classify.test.ts`

**Step 1: Write the failing regression**

Add a demand-mode question with `mentioned > 0`, `citationEvaluable = 0`, `cited = 0`, complete site evidence, one relevant page and one independently read third-party reference. Assert that citation zero alone produces `unattributed / no_actionable_gap`, not A or C. Keep a retrieval-mode companion with an evaluable zero citation and assert it remains eligible for the existing gap path.

**Step 2: Run the focused test and observe RED**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/geo-tools/gap-classify.test.ts
```

Expected: the demand regression receives A or C under the current `question.mentioned === 0 || question.cited === 0` condition.

**Step 3: Implement the minimal predicate**

Separate the two signals:

```ts
const mentionMiss = question.mentioned === 0;
const citationMiss = question.mode === "retrieval"
  && question.citationEvaluable > 0
  && question.cited === 0;
const missed = mentionMiss || citationMiss;
```

Do not alter precedence B→A→D→C, evidence completeness requirements or unattributed reasons.

**Step 4: Verify GREEN and related truth tests**

Run the focused file plus `visibility-metrics.test.ts` and `visibility-enrich.test.ts`. Expected: PASS.

**Step 5: Commit**

```bash
git add apps/marketing/src/lib/geo-tools/gap-classify.ts apps/marketing/src/lib/geo-tools/gap-classify.test.ts
git commit -m "fix(marketing): require citation evidence for Visibility gaps"
```

### Task 2: Render the full five-layer intent taxonomy honestly

**Files:**
- Modify: `apps/marketing/src/components/tools/ai-visibility-report/metrics.tsx:83-99`
- Modify: `apps/marketing/src/components/tools/ai-visibility-report/messages.ts`
- Test: `apps/marketing/src/components/tools/ai-visibility-report.test.tsx`

**Step 1: Add RED rendering assertions**

Render a sufficient V2 report whose `metrics.byLayer` contains only discovery, comparison and branded. Assert that the table still exposes problem and evaluation rows, each says “No questions in this run” / Chinese equivalent, contains no percentage and uses em dashes for non-applicable cells. Assert present rows keep exact values.

**Step 2: Run the report test and observe RED**

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/ai-visibility-report.test.tsx
```

Expected: only three row headers exist.

**Step 3: Implement a presentation-only five-row scaffold**

In `LayerTable`, iterate the canonical local order:

```ts
const LAYERS = ["problem", "discovery", "comparison", "evaluation", "branded"] as const;
```

Find the actual metrics/detail row for each layer. If absent, render the localized no-question state and dashes. Do not synthesize a `VisibilityProportion`, answer count, position or sample count.

**Step 4: Verify EN/ZH and V1/V2 compatibility**

Run report and locale message tests. Expected: PASS; V1 historical summaries also show explicit absent layers without invented rates.

**Step 5: Commit**

```bash
git add apps/marketing/src/components/tools/ai-visibility-report/metrics.tsx apps/marketing/src/components/tools/ai-visibility-report/messages.ts apps/marketing/src/components/tools/ai-visibility-report.test.tsx
git commit -m "feat(marketing): show complete Visibility intent taxonomy"
```

### Task 3: Differentiate headline cards and move repeated definitions into disclosure

**Files:**
- Modify: `apps/marketing/src/components/tools/ai-visibility-report/metrics.tsx:22-56`
- Modify: `apps/marketing/src/components/tools/ai-visibility-report/messages.ts`
- Test: `apps/marketing/src/components/tools/ai-visibility-report.test.tsx`

**Step 1: Add RED semantic/style assertions**

Assert fixed metric order, unique `data-metric-tone` values, neutral primary values and short customer-facing titles. Assert the long metric definitions appear inside the methodology disclosure rather than as four always-visible card paragraphs.

**Step 2: Run RED**

Run the focused report test. Expected: cards have identical styling and visible long descriptions.

**Step 3: Apply existing-token presentation**

Use a local metric configuration map. Give each card a restrained top rule/title token; keep values `text-text-dark-primary`. Do not use raw hex, status-only color or full-card colored backgrounds. Rename visible labels to Natural mentions / Own-site citations / Answer coverage / Brand-present answer share while retaining the technical terms in disclosure copy.

Move the four full definitions into the existing `methodsTitle` details block. Keep denominator and one short state in each card. Rewrite coverage success as a positive sentence when missing count is zero.

**Step 4: Verify light/dark and accessibility semantics**

Run report tests and ESLint. Expected: order, values, captions and scopes unchanged; colors supplement text.

**Step 5: Commit**

```bash
git add apps/marketing/src/components/tools/ai-visibility-report/metrics.tsx apps/marketing/src/components/tools/ai-visibility-report/messages.ts apps/marketing/src/components/tools/ai-visibility-report.test.tsx
git commit -m "style(marketing): clarify Visibility headline hierarchy"
```

### Task 4: Add truthful source type without domain-level presence inference

**Files:**
- Modify: `apps/marketing/src/components/tools/ai-visibility-report/index.tsx:78-105`
- Modify: `apps/marketing/src/components/tools/ai-visibility-report/evidence.tsx:11-31`
- Modify: `apps/marketing/src/components/tools/ai-visibility-report/primitives.tsx:42-54`
- Modify: `apps/marketing/src/components/tools/ai-visibility-report/messages.ts`
- Test: `apps/marketing/src/components/tools/ai-visibility-report.test.tsx`

**Step 1: Add RED source assertions**

Cover four cases:

1. one retained reference page for a domain → localized page type;
2. two retained page types → Multiple;
3. no independently read page → Not independently read;
4. a retained unsafe URL is omitted → visible count-only safety notice while domain answer count remains unchanged.

Assert the aggregate table does not render domain-level own presence.

**Step 2: Run RED**

Run the focused report test. Expected: only domain/answers/identity columns exist and unsafe URL omission is silent.

**Step 3: Implement the render-time join**

Pass `v2?.siteEvidence?.references ?? []` to `SourceTable`. Join retained pages by `normalizeGeoHost(page.url) === domain.domain`; use only page-level `pageType`. Render Domain / Cited answers / Source type / Identity. Preserve sample URL disclosure and the separate page-level presence table.

Export a small pure URL partition helper from `primitives.tsx` so `EvidenceLinks` and `SourceTable` use one safe-URL decision and can report the omitted count without exposing rejected text.

**Step 4: Verify truncation and historical behavior**

Assert `citationEvidenceTruncated` still says the table is a retained lower bound. V1 summaries render source type as not independently read because no site evidence exists.

**Step 5: Commit**

```bash
git add apps/marketing/src/components/tools/ai-visibility-report/{index,evidence,primitives,messages}.tsx apps/marketing/src/components/tools/ai-visibility-report.test.tsx
git commit -m "feat(marketing): add evidenced Visibility source types"
```

### Task 5: Fix gap-card color semantics and reduce zero-card weight

**Files:**
- Modify: `apps/marketing/src/components/tools/ai-visibility-gaps.tsx:12-29`
- Modify: `apps/marketing/src/components/tools/ai-visibility-gaps.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Add RED tests**

Render four zero actionable kinds and eight unattributed gaps. Assert zero cards are neutral, the non-zero unattributed card uses info styling and customer copy says Cause not yet known. Add a case with non-zero A/B/C/D and assert warning styling, not success/error styling. Keep five semantic entries in the DOM.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/ai-visibility-gaps.test.tsx
```

Expected: current four A-D cards all use accent left borders regardless of count.

**Step 3: Implement state-aware token mapping**

Remove fixed accent left-border treatment. Zero counts use neutral border/text. Non-zero actionable counts use warning; non-zero unattributed uses info. Preserve text labels and `data-gap-kind`; never rely on color alone.

**Step 4: Verify locale parity and gap truth suites**

Run gap component, classifier, Markdown and i18n message tests. Expected: PASS.

**Step 5: Commit**

```bash
git add apps/marketing/src/components/tools/ai-visibility-gaps.tsx apps/marketing/src/components/tools/ai-visibility-gaps.test.tsx apps/marketing/src/i18n/messages/{en,zh}.json
git commit -m "style(marketing): prioritize non-zero Visibility gaps"
```

### Task 6: Final product and visual verification

**Files:**
- Modify only if evidence metadata needs the exact final SHA: `apps/marketing/docs/reviews/2026-08-31-ai-visibility-release/*`
- Create task-local screenshots/report under `.gstack/design-reports/` or the existing review artifact directory; do not commit tool caches.

**Step 1: Run focused tests**

Run report, gap, classifier, export, history and message suites. Expected: PASS.

**Step 2: Run package/repository gates**

```bash
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing typecheck
pnpm exec vitest run --project unit apps/marketing
pnpm exec vitest run --project marketing-sql apps/marketing/src/lib/geo-tools
pnpm verify:spec
pnpm contracts:check
pnpm secrets:scan
pnpm audit --audit-level moderate
pnpm audit --prod --audit-level moderate
```

Expected: all PASS; no baseline exclusion is relabeled as a pass.

**Step 3: Build with provider credentials cleared**

```bash
env -i PATH="$PATH" HOME="$HOME" CI=1 NEXT_TELEMETRY_DISABLED=1 pnpm --filter @sf/marketing build
```

Expected: production build PASS and a new BUILD_ID.

**Step 4: Run browser acceptance**

Run AI Visibility Artifact/Profile update/history, GEO chain/current GEO Brief and Page Citability suites against the exact build, without provider credentials. Expected: no external/provider call, no failure, intended manual real-provider tests skipped.

**Step 5: Capture before/after views**

Capture desktop/mobile, light/dark result screenshots for:

- four metrics;
- five intent rows with absent layers;
- five gap kinds with zero/non-zero distinction;
- four-column source inventory and page-level disclosure.

Verify no horizontal overflow on mobile, visible focus states, body contrast and no console errors.

**Step 6: Independent review and release**

Review the net diff against latest main, confirm only `apps/marketing/**` plus approved plan/evidence files, then commit/push/create PR. Use the existing Marketing release boundary: exact SHA → Vercel READY → canonical-domain/authenticated read-only canary → independently retained Product identity. Do not start a new paid provider run without a separate explicit budget.
