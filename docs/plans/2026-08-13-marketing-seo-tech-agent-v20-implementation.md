# Marketing SEO / Tech Agent v20 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the shared evidence-viewer experience on `gengrowth.ai` with two independent, production-honest SEO and Tech Agent workflows that implement the approved v19 four-stage UX, the v2 77-check information architecture, and an editable Product / ICP Profile seeded from the supplied AstrologyWiki documents.

**Architecture:** Keep authentication, URL safety, the bounded static-HTML crawler, and its neutral evidence records shared. Add a browser-safe 77-check catalog and deterministic projection that maps current evidence into explicit result/engine/truth axes while leaving unsupported checks excluded. Each Agent owns its own client-side URL, Profile, run context, scope, selected group/check, recommendation, and solution state; `/agents/seo` and `/agents/tech` keep their canonical paths and do not write to `app.gengrowth.ai`.

**Tech Stack:** Next.js 16 App Router, React 19, strict TypeScript, next-intl EN/ZH, Tailwind CSS, Vitest/jsdom, Playwright, `@sf/public-tools` browser-safe contracts.

---

### Task 1: Freeze the v2 audit catalog and deterministic evidence projection

**Files:**
- Create: `packages/public-tools/src/agent-audit/types.ts`
- Create: `packages/public-tools/src/agent-audit/catalog.ts`
- Create: `packages/public-tools/src/agent-audit/evaluate.ts`
- Create: `packages/public-tools/src/agent-audit/index.ts`
- Create: `packages/public-tools/src/agent-audit/catalog.test.ts`
- Create: `packages/public-tools/src/agent-audit/evaluate.test.ts`
- Modify: `packages/public-tools/src/index.ts`
- Modify: `packages/public-tools/package.json`

**Steps:**
1. Write failing catalog tests for exactly 5 site groups / 27 checks, 9 page groups / 50 checks, unique IDs, weights, defaults, source tiers, and four page-type heading presets.
2. Write failing evaluation tests for the three independent state axes, issue/pass polarity, blocker counting, excluded checks, health renormalization, and the 99 cap while non-ready engines remain.
3. Implement immutable browser-safe catalog/types and a pure evaluator that maps the current neutral crawl records without inventing provider facts.
4. Export the subpath and run focused tests, public-tools typecheck, and lint.

### Task 2: Add the Agent-local Product / ICP Profile contract

**Files:**
- Create: `apps/marketing/src/components/agents/agent-profile.ts`
- Create: `apps/marketing/src/components/agents/agent-profile.test.ts`
- Create: `apps/marketing/src/components/agents/agent-profile-panel.tsx`
- Create: `apps/marketing/src/components/agents/agent-profile-panel.test.tsx`
- Modify: `apps/marketing/src/components/agents/agent-intent.ts`
- Modify: `apps/marketing/src/components/agents/agent-intent.test.ts`
- Modify: `apps/marketing/src/components/home/hero-section.tsx`

**Steps:**
1. Write failing tests for the AstrologyWiki source-backed seed, generic-host draft, URL-change reset, Agent isolation, and editable country/locale/device/pageType/targetQuery/auditScope.
2. Version pending intents so homepage navigation means `prepare_profile`, while an authentication handoff means `run_confirmed_profile`.
3. Implement the compact Profile Gate: URL + three decision cards, default acceptance, `Review & adjust`, source/provenance chips, and `Confirm profile & run`.
4. Verify no direct sessionStorage access, no app persistence, and no cross-Agent state transfer.

### Task 3: Replace the flattened report with the v2 two-level diagnosis

**Files:**
- Create: `apps/marketing/src/components/agents/agent-audit-model.ts`
- Create: `apps/marketing/src/components/agents/agent-audit-model.test.ts`
- Create: `apps/marketing/src/components/agents/agent-diagnosis.tsx`
- Create: `apps/marketing/src/components/agents/agent-diagnosis.test.tsx`
- Rewrite: `apps/marketing/src/components/agents/agent-results.tsx`
- Modify: `apps/marketing/src/components/agents/agent-results.test.tsx`

**Steps:**
1. Write failing tests for site/page scope ownership, SEO defaults E/9, Tech defaults A/1, Blockers + Health semantics, all 77 checks, detail fields, and unavailable/null behavior.
2. Build the confirmed-context strip, scope selector, headline metrics, group rail, selected check ledger, focused explainability detail, and local policy display/reset controls.
3. Keep unsupported or source-gated checks visible as excluded; never display them as zero, pass, or verified.
4. Implement page-type heading presets as soft rules that never create blockers.

### Task 4: Make Recommendation and Selected Solution Agent-specific

**Files:**
- Replace: `apps/marketing/src/components/agents/agent-solution-templates.ts`
- Create: `apps/marketing/src/components/agents/agent-recommendations.tsx`
- Create: `apps/marketing/src/components/agents/agent-recommendations.test.tsx`
- Modify: `apps/marketing/src/components/agents/agent-result-helpers.ts`
- Modify: `apps/marketing/src/components/agents/agent-result-helpers.test.ts`

**Steps:**
1. Write failing tests proving recommendations use severity/relevance/evidence rather than affected-count alone and that SEO and Tech produce different solutions from the same shared evidence.
2. Implement SEO search/content/intent recommendations and Tech crawl/index/performance/code-remediation recommendations.
3. Render Stage 03 and Stage 04 side-by-side above 980px and in strict 03 → 04 order below it.
4. Ensure Stage 04 includes Issue, Evidence, Fix/preview, Applicable context, Validation, Impact, Risks, Limits, and no apply/deploy claim.

### Task 5: Integrate the four-stage Agent workbench and bilingual copy

**Files:**
- Rewrite: `apps/marketing/src/components/agents/agent-workbench.tsx`
- Modify: `apps/marketing/src/components/agents/agent-workbench.test.tsx`
- Modify: `apps/marketing/src/components/agents/agent-page.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/components/agents/agent-messages.test.ts`
- Modify: `apps/marketing/src/components/agents/agent-display-contract.ts`
- Modify: `apps/marketing/src/lib/agents/audit-contract.ts`
- Modify: `apps/marketing/src/lib/agents/audit-handler.ts`

**Steps:**
1. Update the workbench state machine to require a confirmed Profile before the audit POST while preserving safe sign-in resume and exact URL identity.
2. Return the complete neutral evidence ledger to each independently executed Agent; Agent-specific defaults and recommendations remain client-owned.
3. Add shape-identical EN/ZH copy for Profile, Diagnosis, states, details, Recommendations, and Solutions.
4. Update focused contract/workbench/message tests and retain fail-closed payload validation.

### Task 6: Browser acceptance, completion audit, commit, and push

**Files:**
- Modify: `apps/marketing/e2e/agents.spec.ts`
- Create or modify only focused Agent contract tests as required.

**Steps:**
1. Add browser acceptance for separate SEO/Tech paths, homepage prefill without auto-run, Profile confirmation, site/page scope, 77-check visibility, Agent-specific defaults, Recommendation → Solution interaction, EN/ZH, and responsive stacking.
2. Run focused Vitest, marketing/public-tools typecheck, focused ESLint, full marketing tests, production build, `git diff --check`, boundary checks, and secret scan.
3. Review the complete diff against every v19/v2 acceptance item and verify only marketing/public-tools/docs files changed.
4. Commit the verified branch and push it to `origin` without changing any URL path or deploying `app.gengrowth.ai`.
