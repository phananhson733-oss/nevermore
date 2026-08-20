# SEO Agent Production Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the production SEO Agent fulfill its current catalog, context, GSC, navigation, and UI contracts without adding account cost limits.

**Architecture:** Keep the existing Marketing-owned Agent and bounded crawler. Repair stale consumer ledgers by deriving them from producer exports, pass the already-confirmed direct Agent context through the existing audit request, keep recommendation ordering deterministic, and make UI/readiness copy match the actual server and cache behavior.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, next-intl, Vitest, Playwright, `@sf/public-tools`, `@sf/sources`, Vercel Node functions.

---

Commit steps are intentionally omitted because the user authorized implementation but not commit, push, PR, or deploy.

### Task 1: Close the GSC producer-to-display ledger

**Files:**
- Modify: `packages/public-tools/src/seo-audit/search-performance.ts`
- Modify: `packages/public-tools/src/seo-audit/index-coverage.ts`
- Modify: `apps/marketing/src/lib/agents/audit-contract.ts`
- Modify: `apps/marketing/src/components/agents/agent-display-contract.ts`
- Test: `apps/marketing/src/lib/agents/audit-handler.test.ts`
- Test: `apps/marketing/src/lib/agents/audit-contract.test.ts`
- Test: `apps/marketing/src/components/agents/agent-display-contract.test.ts`

**Step 1: Write failing round-trip tests**

- Build the search region through `readAgentSearchPerformance`, not `buildSearchPerformanceRecords` alone.
- Assert seven IDs including `sitemap_url_not_indexed`.
- Assert `isAgentAuditSuccessEnvelope` and `supportsAgentDisplayVocabulary` both accept the result.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/agents/audit-contract.test.ts \
  apps/marketing/src/lib/agents/audit-handler.test.ts \
  apps/marketing/src/components/agents/agent-display-contract.test.ts
```

Expected: failure because the six-ID guard and display sets omit index coverage.

**Step 3: Implement one combined producer export**

- Export combined Search Console record IDs, evidence labels, and limitation codes.
- Use those exports in the wire guard and display seam.
- Preserve seven-record exactness and reject subsets/duplicates.

**Step 4: Run GREEN**

Run the same command; expected all passing.

### Task 2: Validate every supplemental region

**Files:**
- Modify: `apps/marketing/src/lib/agents/audit-contract.ts`
- Test: `apps/marketing/src/lib/agents/audit-contract.test.ts`

**Steps:**

1. Add a failing test with malformed `serpShape` version/records.
2. Confirm the current guard accepts it.
3. Wire `isAgentSerpShape` into `isAgentResult`.
4. Confirm malformed values fail and real producer values pass.

### Task 3: Make the direct SEO Agent request page-aware

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-workbench.tsx`
- Modify: `apps/marketing/src/lib/agents/audit-handler.ts`
- Test: `apps/marketing/src/components/agents/agent-workbench.test.tsx`
- Test: `apps/marketing/src/lib/agents/audit-handler.test.ts`

**Steps:**

1. Replace the existing ordinary-request assertion with failing expectations for `pageRole`, `market`, and `language`, plus one `targetQueries` item when confirmed.
2. Add a second failing test proving blank `targetQuery` omits `targetQueries`.
3. Make the client build the body from the captured confirmed Profile, while preserving the On-Page handoff's ordered one-to-five queries.
4. Attach the existing `readSerpLandscape` reader to the default SEO dependencies.
5. Add a test proving `query: null` returns `no_target_query` without invoking a provider transport.
6. Run the focused workbench/handler/SERP suites.

### Task 4: Make coverage and context copy truthful

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-page.tsx`
- Modify: `apps/marketing/src/components/agents/agent-result-helpers.ts`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Test: `apps/marketing/src/components/agents/agent-messages.test.ts`
- Test: `apps/marketing/src/components/agents/agent-result-helpers.test.ts`

**Steps:**

1. Add failing message assertions forbidding “all ready checks run here” and “Profile determines priority”.
2. Keep recommendation ordering unchanged and explicitly test its transparent order inputs.
3. Rewrite method copy to distinguish catalog readiness, request context, connected sources, per-run evaluated counts, and Profile solution framing.
4. Run message and recommendation tests in both locales.

### Task 5: Align the Profile readiness gate with real inputs

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-profile.ts`
- Modify: `apps/marketing/src/components/agents/agent-profile-panel.tsx`
- Test: `apps/marketing/src/components/agents/agent-profile.test.ts`
- Test: `apps/marketing/src/components/agents/agent-profile-panel.test.tsx`

**Steps:**

1. Add failing tests for invalid URL, unassigned/unsupported market, and invalid locale.
2. Add failing tests showing product name, CTA, and ICP no longer block a bounded audit.
3. Export browser-safe pure validators for target URL, market, and locale without importing Node-only modules.
4. Require those validators in readiness and every Profile refresh/search button state.
5. Set `aria-invalid`, localized error text, and `aria-describedby` for each invalid field.
6. Confirm the server continues to enforce the stricter canonical URL and supported-market rules.

### Task 6: Repair mobile navigation and unified IA

**Files:**
- Modify: `apps/marketing/src/components/ui/sheet.tsx`
- Modify: `apps/marketing/src/components/layout/header.tsx`
- Modify: `apps/marketing/src/config/navigation.ts`
- Modify: `apps/marketing/src/components/home/capabilities-preview.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Test: `apps/marketing/src/config/navigation.test.ts`
- Test: `apps/marketing/src/components/home/agent-links.test.ts`
- Test: `apps/marketing/e2e/agents.spec.ts`

**Steps:**

1. Add failing source/DOM tests proving Tech is not a peer header/home card and GEO is the second peer card.
2. Add a failing 390 px E2E that opens the Sheet, scrolls to the final action, and focuses sign-in/audit CTA.
3. Give the Sheet a `max-h-dvh overflow-y-auto overscroll-contain` content boundary.
4. Remove Tech from the peer submenu and homepage grid; retain the `/agents` hub compatibility link.
5. Run the focused source and browser tests.

### Task 7: Make Profile Search cache semantics honest

**Files:**
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Test: `apps/marketing/src/components/agents/agent-profile-panel.test.tsx`
- Test: `apps/marketing/src/components/agents/agent-messages.test.ts`

**Steps:**

1. Add failing assertions that the action does not promise a live provider refresh.
2. Label it as a cache-aware reread and state that recent data up to one hour old may be reused.
3. Keep `observedAt` visible as the evidence timestamp.
4. Do not add `force`, quota, billing, or credit behavior.

### Task 8: Make authenticated POST and draft cache boundaries symmetric

**Files:**
- Modify: `apps/marketing/src/lib/agents/audit-handler.ts`
- Modify: `apps/marketing/src/lib/agents/profile-search-handler.ts`
- Modify: `apps/marketing/src/lib/agents/draft-handler.ts`
- Test: corresponding `*.test.ts` files

**Steps:**

1. Add failing tests for a present foreign `Origin`, asserting auth runs first and body/provider work does not run.
2. Reuse `isSameOriginPost`; return a stable `invalid_origin` 403 response.
3. Add failing tests for `Cache-Control: no-store, private` on every draft success and error.
4. Add the header centrally in `fail()` and success.
5. Run the three handler suites and security-oriented tests.

### Task 9: Clear the existing lint baseline

**Files:**
- Modify only the files currently reported by ESLint.

**Steps:**

1. Remove the unused duplicate placeholder and unused imports/types.
2. Replace the control-character regex with a lint-safe equivalent without weakening rejection.
3. Remove or use the orphaned image helper based on current model behavior.
4. Fix the empty array pattern in the test without changing its assertion.
5. Run:

```bash
pnpm --filter @sf/public-tools lint
pnpm --filter @sf/marketing lint
```

Expected: zero errors and warnings.

### Task 10: Synchronize the 80-check design bundle

**Files:**
- Modify: `/Users/wzb/Documents/gengrowth-tools/artifacts/designs/2026-08-17-unified-seo-agent-onpage/decisions-2026-08-17.md`
- Modify: same directory `design-spec.md`, `finalized.json`, `finalized.html`, `verify-artifact.mjs`
- Regenerate: declared review screenshots only if the verifier requires freshness.

**Steps:**

1. Add failing verifier expectations for stale 81/24-of-81 text.
2. Update the explicit owner correction: 9.2 removed because no current provider supplies registration date.
3. Replace fixed catalog counts with 31 site + 49 page = 80 and current derived coverage language.
4. Preserve all keyword, handoff, local history, and no-network Artifact behavior.
5. Run the artifact's complete verifier chain.

### Task 11: Full verification and completion audit

**Commands:**

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm --filter @sf/marketing build
pnpm test:e2e:mock -- --grep "Agent|SEO|mobile"
```

Also run:

- the exact GSC producer/guard/display round-trip;
- direct SEO request-shape tests;
- 390 px mobile menu test;
- artifact verifier commands;
- `git diff --check`;
- `git status --short` and a final diff review proving only intended files changed.

Expected outcome: all green, with deployment and paid-provider canary explicitly unverified until separately authorized.
