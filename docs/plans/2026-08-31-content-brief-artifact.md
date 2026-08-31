# Content Brief Artifact Consistency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align Content Brief presentation, business decisions, editing, and its Draft consumer with the supplied Artifact and verify the complete product flow.

**Architecture:** Preserve strict evidence and legacy-v1 contracts. Implement the already-approved presentation corrections first; freeze the proposed v2 business rules before changing producer/parser/consumer semantics together. Keep paid calls bounded and report persistence absent.

**Tech Stack:** Next.js 16, React 19, TypeScript, next-intl, Vitest and Playwright in the existing pnpm monorepo.

**Requested skill:** Use frontend-design for the UI task, preserving the supplied Artifact's visual/interaction structure and the current Marketing themes.

---

## Task 1: Approved presentation repair

**Files:**
- Modify: `apps/marketing/src/components/tools/content-brief-tool.tsx`
- Modify: `apps/marketing/src/components/tools/content-brief-results.tsx`
- Modify: `apps/marketing/src/components/tools/content-brief-run-header.tsx`
- Modify: `apps/marketing/src/components/tools/content-brief-evidence-coverage.tsx`
- Modify only as needed: other `content-brief-*.tsx` result components and their direct tests.
- Modify only `tools.contentBrief`: `apps/marketing/src/i18n/messages/en.json`, `zh.json`.
- Test: `apps/marketing/src/components/tools/content-brief-tool.test.tsx`
- Create test if necessary: `apps/marketing/src/components/tools/content-brief-presentation.test.tsx`
- Modify browser tests: `apps/marketing/e2e/content-brief.spec.ts`.

**Step 1: Write failing behavior tests.**

Use real result components and contract-valid fixed fixtures, not mocked result cards. Assert:

```ts
expect(result.querySelector('[data-verdict-card]')).not.toBeNull();
expect(result.querySelector('details[data-evidence-details]')?.hasAttribute('open')).toBe(false);
expect(result.querySelector('details[data-run-details]')?.hasAttribute('open')).toBe(false);
expect(profileCell.textContent).toContain('Not used');
expect(profileCell.textContent).not.toContain('Attempts unknown');
```

Also assert generated-report settings collapse and can reopen, error states preserve their proper meaning, all ledger values remain inspectable, and partial summaries name only actual limitations. Use the project's existing translator fixtures/NextIntl provider to exercise EN and ZH.

**Step 2: Verify RED.**

Run `pnpm exec vitest run --project unit apps/marketing/src/components/tools/content-brief-presentation.test.tsx apps/marketing/src/components/tools/content-brief-tool.test.tsx` (adjust if the test is placed in an existing file). Expect assertion failures for missing disclosures, wrong not-requested display, and visible debug-first result layout; fix harness errors before implementation.

**Step 3: Implement only the presentation design.**

Make run header compact; place recommendation before expanded detail surfaces; use native disclosures. Present `not_requested` separately at the UI layer without changing the v1 wire contract. Apply small text classes directly to explanatory paragraphs in the affected surface. Keep source/availability distinctions and exact counts. Do not modify global CSS or business thresholds in this task.

**Step 4: Verify GREEN and real styling.**

- Run the focused tests above plus i18n/content-brief tests.
- Browser assertions must include computed explanatory paragraph size, closed-detail invisibility, keyboard expansion, and `document.documentElement.scrollWidth <= window.innerWidth` at 390px and desktop.
- Update existing E2E expectations to expand evidence explicitly when inspecting its details; do not remove the ledger assertions.

**Step 5: Independent reviews and commit.**

First spec review against the accepted design; then code-quality review. Commit only task-owned files after both reviews and fresh checks. No push/deploy for this partial milestone.

Completed locally as `1705aa31`. Fresh final evidence: 184 UI/i18n unit tests; broader 923 relevant regressions; 20 browser tests covering 8 viewport/locale/theme combinations plus real keyboard focus and deferred auth/API recovery; Marketing build; changed-file lint; secret scan and 75 redaction tests. Independent spec and quality review closed. See `apps/marketing/docs/reviews/2026-08-31-content-brief-artifact-ui/acceptance.md`. This does not complete Tasks 2–5.

## Task 2: Freeze and implement v2 evidence/question contract

Status: detailed implementation awaits business-rule confirmation; not complete.

Required scope: retain PAA from the existing advanced SERP response, bounded source ledger, semantic question selection with template exclusion, coverage denominators, language-appropriate length measurements, strict v2 parser/fingerprint, and unchanged legacy-v1 parser. Write independent fixtures and fail-before-fix tests for each invariant. PAA must feed outline/Draft coverage, not merely appear in a disconnected supplemental card.

### Task 2a: Initial PAA source retention

This source-preservation foundation does not decide the new question-selection rule. The Artifact already requires PAA as a source. Keep this additive for existing SERP consumers.

**Files:** `packages/sources/src/dataforseo/keyword-metrics.ts`, `keyword-metrics.test.ts`, `_DIR.md`.

1. Write tests for verbatim question/seed retention, duplicate order, CJK, one unchanged provider request, unavailable vs observed-empty vs missing block, malformed child/block counts, cross-block 100-entry inspection cap and invalid local-option rejection.
2. Run `pnpm exec vitest run --project unit packages/sources/src/dataforseo/keyword-metrics.test.ts -t 'People Also Ask evidence'`. Observed RED on 2026-08-31: 9 failed, 1 legacy-compatibility test passed, 42 unrelated tests skipped.
3. Add the local-only `includePeopleAlsoAsk` request option and optional typed response. Never pass that option or a click-depth parameter to DataForSEO; preserve other consumers' output shape. Explicitly count unusable blocks rather than guessing their child counts.
4. Run the whole metrics test file, `pnpm --filter @sf/sources typecheck`, and ESLint on both changed TS files. Initial GREEN: 52/52; typecheck/lint exit 0.
5. Independent spec then code review before commit. This is not evidence that Brief/Draft consumes PAA yet; that remains in Tasks 2–4.

Source milestone evidence: commit `5180b875` contains the adapter and tests. Spec review caught UTF-16 vs code-point counting; a 512/513 astral-character title/seed test failed first and then passed after matching the existing code-point boundary. Spec re-review and independent code-quality review found no remaining P1/P2 blockers. Final metrics tests: 54/54; source package typecheck and changed-file ESLint exit 0. A broader DataForSEO/consumer regression run passed 369 tests before the final test-only coverage addition. No live provider request or deployment occurred.

## Task 3: Page ownership, owned-page research and rewrite plan

Status: pending Task 2 design freeze.

Required scope: primary/supporting evidence separation, honest uncertainty, bounded target-page read, actionable retain/add/rewrite plan, and failure path that never falls back silently to new-page writing. Cover supporting-only observations and low-position existing pages without asserting impossible competition.

## Task 4: Outline editing and Draft contract integration

Status: pending Tasks 2–3.

Required scope: controlled heading/order edits, immutable questions/evidence, explicit revision confirmation and causal fingerprint, v1/v2 intake, exact handoff and rerun binding, and Draft generation driven by create/update plan. Recognize GEO Brief imports and explain the unsupported cross-tool route without coercion.

## Task 5: Product acceptance, review and Marketing release

Status: pending all implementation.

- Expand fixed-input test matrix to every requirement in the design.
- Run package/Marketing typecheck, lint, focused/full applicable tests, build and source-boundary/security checks.
- Run browser product flows with real layout and offline provider seams; separate them from actual production provider proof.
- Review the final diff, create/merge the authorized PR, verify immutable Marketing deployment and canonical aliases; independently prove Product identity retained.
- Confirm exact canary inputs and paid-call budget at execution time. Verify output relevance, actual outline edits, matching exported/imported revision, correct page action and Draft behavior. Keep sanitized evidence in the project report.
- Complete a requirement-by-requirement audit before marking the goal achieved.
