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

Status: in progress. The continued user goal and re-supplied Artifact fix the intended outcome; the research design is now consolidated into the bounded implementation tasks below. This is not approval for a GEO-to-Draft bridge or a Product/CMS expansion.

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

### Task 2b: Main-content research extraction

**Files:** create `apps/marketing/src/lib/tools/content-brief-research-extract.ts` and its `.test.ts`. Shared types/constants/length measurement live in `packages/public-tools/src/content-brief/v2-contract.ts` (contract owner: primary agent).

1. Write fixed HTML oracle cases: nav/footer/script/hidden content excluded; related-articles section excluded; main/article preferred; heading-less Chinese prose retained; nested list/paragraph content not counted twice; empty content; 300-code-point excerpts; 12-segment cap with honest omitted counts.
2. Run the new test file and observe missing behavior before implementing.
3. Implement `extractContentBriefResearch(html, language): ExtractedPageResearch` with existing Cheerio. Keep heading/source text, normalize whitespace, preserve code points, and calculate descriptive observed length via the shared function. No fetch, network or language-based research refusal.
4. Run the extraction tests, Marketing typecheck and changed-file ESLint. Review before commit.

### Task 2c: Brief PAA adapter opt-in

**Files:** `apps/marketing/src/lib/tools/content-brief-serp.ts` and `.test.ts`.

1. Add failing tests for explicit PAA retention and empty-organic/PAA-present responses, unknown-vs-empty PAA, provider timeout/error, single unchanged billable request, and exact legacy output compatibility.
2. Add local `includePeopleAlsoAsk?: boolean` input. Only opted-in callers receive a typed PAA result; no opt-in means the old return shape and request remain unchanged. Forward provider PAA without rewriting its counts/text; timeout/provider error stay unavailable, never an empty list.
3. Run the whole adapter test file, relevant source tests, typecheck and lint. Do not enable the new output on the v1 route as a substitute for completing v2.

### Task 2d: Versioned source graph and model research validation

**Files:** `packages/public-tools/src/content-brief/v2-contract.ts`, `v2-research.ts`, related tests, and explicit package exports.

1. Write independent graph fixtures: English paraphrases over three actual pages, one-page-plus-PAA, PAA-only, duplicate final-page URLs, unrelated/zero-question output, and injected/duplicate/orphan refs.
2. Freeze at most 60 retained page units and 8 unique PAA items. Source-unit objects reference the frozen page segments/PAA ledger instead of duplicating their text. Round-robin page selection preserves source diversity, with omitted/duplicate counts recorded.
3. Strictly decode `{questions:[{anchor,q,sources}], outline:[{h2,h3,answers}]}`. Anchors must be existing included U ids, belong to their question sources, and be unique. Every question must map to exactly one outline section. Zero questions requires an empty outline; one real question is sufficient. No three-page gate.
4. Assign final Q/O IDs server-side. Derive competitor coverage using distinct normalized final URLs; owned pages and PAA do not increase it. Keep PAA refs separate from factual evidence.
5. Validate the frozen source graph and counters independently before accepting model output. Re-fingerprinting cannot legalize a forged source edge or coverage count.
6. Run v2 and legacy parser tests plus public-tools typecheck/lint; independently review this core before wiring the v2 route/model caller.

Research-foundation batch (2026-08-31): Tasks 2b/2c/2d passed local implementation and independent spec/quality review. Extractor: 31 HTML cases; v2 core/measurement: 30 cases; adapter: 27 cases with 54 source-client regressions. Fresh combined relevant regressions: 1000/1000 across 43 files; Marketing/public-tools typecheck, changed-file lint, secret scan and 75 redaction tests passed. Main was merged at `d4ebb110` (blog-only delta), preserving the earlier UI/source commits. This batch adds reusable research code, not an activated v2 generator.

Committed as `377e0e4a`; exact evidence scope and remaining work are recorded in `apps/marketing/docs/reviews/2026-08-31-content-brief-v2-research/acceptance.md`.

Review-driven fixes: nested same-level headings must not reopen an excluded template; both body/heading traversal must handle deep HTML without recursion; mixed or untagged CJK needs character measurement; source identity order must not depend on completion order; observed length cannot contradict retained text. Observation authenticity remains distinct from locally checkable graph consistency.

### Task 2e: Single assembly-model integration and full v2 envelope

- Define the final v2 response/confirmation envelope while preserving exact v1 import and already-open v1-client behavior.
- Materialize frozen unit text and provenance into an untrusted-DATA prompt; budget the full request in bytes and keep actual token accounting separate.
- Use the existing `CONTENT_BRIEF_*` provider configuration and one bounded call. Model-selected questions/outline must go through the new graph validator; real semantic output still needs oracle/canary review.
- Integrate page plan, gap angle and owned-page suggestions in that same call, with all source scope actually supplied. Do not add a second hidden generation pass or leave PAA outside Draft coverage.
- Wire a version-explicit route only when its producer, parser and consumer agree. Research-only modules are not the final delivery.

Local generation/confirmation batch is implemented and independently spec/quality reviewed: actual SERP/PAA + owned/competitor extraction + one complete model assembly + strict v2 Brief and confirmed revision. Fresh focused v2 checks passed 360 tests; broader relevant checks passed 1095 tests, both typechecks and secret/redaction checks. This does not activate the editing UI or Draft v2 consumer. A separately preserved handler negotiation candidate is being completed and reviewed next. See `apps/marketing/docs/reviews/2026-08-31-content-brief-v2-generation/acceptance.md` for exact scope and remaining gates.

## Task 3: Page ownership, owned-page research and rewrite plan

Status: implemented locally in the reviewed v2 generation/handler chain (4aca120a, 09b6e348); live semantic canary remains pending.

Required scope: primary/supporting evidence separation, honest uncertainty, bounded target-page read, actionable retain/add/rewrite plan, and failure path that never falls back silently to new-page writing. Cover supporting-only observations and low-position existing pages without asserting impossible competition.

## Task 4: Outline editing and Draft contract integration

Status: in progress. The actual Brief v2 editor/confirmation/export flow now passes local unit, build and 28-case browser verification. The Draft v2 intake/generation/coverage/rerun/handoff path is not yet implemented; do not declare this task complete. See `apps/marketing/docs/reviews/2026-08-31-content-brief-v2-editor/acceptance.md`.

Required scope: controlled heading/order edits, immutable questions/evidence, explicit revision confirmation and causal fingerprint, v1/v2 intake, exact handoff and rerun binding, and Draft generation driven by create/update plan. Recognize GEO Brief imports and explain the unsupported cross-tool route without coercion.

## Task 5: Product acceptance, review and Marketing release

Status: pending all implementation.

- Expand fixed-input test matrix to every requirement in the design.
- Run package/Marketing typecheck, lint, focused/full applicable tests, build and source-boundary/security checks.
- Run browser product flows with real layout and offline provider seams; separate them from actual production provider proof.
- Review the final diff, create/merge the authorized PR, verify immutable Marketing deployment and canonical aliases; independently prove Product identity retained.
- Confirm exact canary inputs and paid-call budget at execution time. Verify output relevance, actual outline edits, matching exported/imported revision, correct page action and Draft behavior. Keep sanitized evidence in the project report.
- Complete a requirement-by-requirement audit before marking the goal achieved.
