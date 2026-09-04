# GEO Knowledge Base Frozen View Pruning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make customer-irrelevant provenance and version identity completely absent from the V2 GEO Knowledge Base frozen view while retaining the frozen data and useful business content.

**Architecture:** Keep all wire, persistence, and server contracts unchanged. Add an explicit customer-facing render mode to the shared read-only version component, suppress Profile copy identity through a narrowly scoped presentation prop, and stop mounting the frozen summary in the V2 customer host.

**Tech Stack:** React 19, Next.js 16.2, TypeScript strict, next-intl, Vitest, jsdom.

---

### Task 1: Lock the frozen-view absence contract with a failing test

**Files:**
- Modify: `apps/marketing/src/components/tools/geo-knowledge-base-v2.test.tsx`

**Steps:**

1. Render an existing V2 frozen record through `GeoKnowledgeBaseV2` in English
   and Chinese.
2. Assert that the frozen summary, snapshot identity, Profile identity, five
   internal section headings, source catalog, and hash values are absent.
3. Assert that Profile business fields, competitors, and questions remain.
4. Run the focused test and confirm it fails for the expected visible content.

### Task 2: Implement the minimum presentation-only pruning

**Files:**
- Modify: `apps/marketing/src/components/tools/geo-knowledge-base-v2.tsx`
- Modify: `apps/marketing/src/components/tools/geo-kb-version-content.tsx`
- Modify: `apps/marketing/src/components/tools/geo-kb-profile.tsx`
- Delete: `apps/marketing/src/components/tools/geo-kb-frozen-summary.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Steps:**

1. Stop mounting the top frozen summary; do not replace it with a collapsed or
   visually hidden control.
2. Add a default-preserving customer-facing mode to `GeoKbVersionContent`.
3. In customer-facing mode, do not render identity, roles, facts, sources, or
   version panels; keep Profile fields, competitors, and questions.
4. Add a default-preserving Profile presentation prop and suppress only the
   archival revision/hash block in customer-facing mode.
5. Remove the orphan summary component and its now-unused locale keys.
6. Run the focused host test and confirm it passes.

### Task 3: Protect complete rendering and regressions

**Files:**
- Modify: `apps/marketing/src/components/tools/geo-kb-version-content.test.tsx`
- Modify: `apps/marketing/src/components/tools/geo-kb-profile.test.tsx`

**Steps:**

1. Assert customer-facing DOM absence at the shared component boundary.
2. Assert the default complete mode still renders internal archival content.
3. Run the three directly changed component/host test files.
4. Run the full GEO Knowledge Base unit-test family.

### Task 4: Verify without releasing

**Steps:**

1. Run targeted ESLint, the Marketing production build, `pnpm verify:docs`, and
   `git diff --check`.
2. Run the full unit suite and record the exact file/test counts.
3. Run the Marketing typecheck. If an untouched failure exists, reproduce it on
   clean `origin/main` and report it separately.
4. Review the final file list and confirm that no data, API, provider,
   persistence, database, or deployment code changed.
5. Leave the candidate uncommitted and unpushed because this request did not
   authorize commit, push, PR creation, or deployment.
