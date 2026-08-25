# Competitor Keyword Gap Actionability v1.1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the verbose v1 gap table with a compact, evidence-driven result that prioritizes real GSC observations and hands trustworthy pages to the existing On-Page SEO Checker without adding provider calls.

**Architecture:** Upgrade the pure competitor-gap envelope to v2, deriving query/page evidence and four deterministic next checks from the existing DFS/GSC reads. Extend the tab-scoped tool handoff for trusted query/page intent. Rebuild the client result table around compact states, progressive rows, and evidence-qualified actions.

**Tech Stack:** TypeScript strict, React 19, Next.js 16, Vitest 4, next-intl, existing DataForSEO Domain Intersection, existing GSC query/query-page reader, sessionStorage tool handoff.

**Release boundary:** No new provider endpoint, environment variable, migration, Worker, Product/App write, credit debit, scheduled job, or real paid canary.

---

### Task 1: Upgrade the pure result contract to v2

**Files:**

- Modify: `packages/public-tools/src/competitor-keyword-gap/types.ts`
- Modify: `packages/public-tools/src/competitor-keyword-gap/report.ts`
- Modify: `packages/public-tools/src/competitor-keyword-gap/report.test.ts`

**Step 1: Write assertion-level RED tests**

Add focused tests for:

- schema version `competitor_keyword_gap.v2`;
- weak query + sufficient page coverage -> `optimize_existing`;
- weak query + no/partial page -> `review_existing_query`;
- strong query -> `review_existing_query`;
- complete query miss -> `review_content_gap`;
- no GSC / unavailable / truncated miss -> `verify_own_coverage`;
- query-page-only positive rows -> positive query observation with
  `query_page` basis;
- page coverage below 0.8 -> `observed_partial`;
- page coverage at least 0.8 -> `observed_sufficient`;
- a truncated page read preserves positive page facts as partial;
- no positive page -> explicit not-observed/not-read page state;
- null values remain null, never zero;
- four-lane order, observed impressions order, and existing DFS tie-breakers.

Run:

```bash
pnpm exec vitest run --project unit packages/public-tools/src/competitor-keyword-gap/report.test.ts
```

Expected: assertion failures against the v1 schema, binary next step, discarded
truncated page facts, and DFS-only sort.

**Step 2: Implement the minimum v2 state machine**

- Add query evidence basis.
- Add page status, page metrics, page coverage.
- Aggregate query-page rows by exact normalized keyword and page.
- Validate safe HTTP(S) pages.
- Preserve positive partial facts.
- Implement the four next-step decision table.
- Implement deterministic lane-first sorting.
- Freeze every new object/array at the contract boundary.

**Step 3: Run GREEN and validation regressions**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/competitor-keyword-gap/report.test.ts \
  packages/public-tools/src/competitor-keyword-gap/validation.test.ts
pnpm --filter @sf/public-tools typecheck
```

### Task 2: Extend the private On-Page Checker handoff

**Files:**

- Modify: `apps/marketing/src/lib/tools/tool-handoff.ts`
- Modify: `apps/marketing/src/lib/tools/tool-handoff.test.ts`
- Modify: `apps/marketing/src/components/tools/on-page-checker.tsx`
- Modify: `apps/marketing/src/components/tools/on-page-checker.test.tsx`

**Step 1: Write RED handoff tests**

Require:

- a `competitor-keyword-gap` source accepted only for
  `on-page-seo-check/query_page`;
- exact keys including property/query/page/evidenceId/market/language;
- invalid, oversized, extra, missing, expired, wrong-destination payloads fail;
- payload is stored in session only and consumed once;
- On-Page Checker imports URL, one query, supported market and language;
- unsupported market/language fall back to existing defaults;
- the storage key remains tab-scoped and private values never enter URL.

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/tools/tool-handoff.test.ts \
  apps/marketing/src/components/tools/on-page-checker.test.tsx
```

Expected: RED because only Daily Briefing payloads are allowed.

**Step 2: Implement the discriminated union and consumer**

Use source-specific exact-key sets. Do not loosen the Daily Briefing validator.
The On-Page Checker consumes both sources through the existing one-time path.

**Step 3: Run GREEN and connected-tool regressions**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/tools/tool-handoff.test.ts \
  apps/marketing/src/components/tools/on-page-checker.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/quick-wins-tool.test.tsx \
  apps/marketing/src/components/tools/traffic-drop-tool.test.tsx
```

### Task 3: Rebuild the result surface

**Files:**

- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-tool.tsx`
- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx`
- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-results.tsx`
- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/i18n/messages.test.ts`
- Modify: `apps/marketing/src/i18n/competitor-keyword-gap-messages.test.tsx`

**Step 1: Write RED result tests**

Drive:

- six compact columns matching the approved layout;
- explicit text-size/line-height classes on every data text element;
- tabular numeric volume;
- four next-step filter counts;
- observed/actionable rows before candidate/unread rows;
- top 10 default, exact remainder, show all/show less, reset on filter;
- not-observed/unread rows render no impression/position dash lines;
- DFS ownState appears once in legend, not per row;
- observed rows render compact status + real metrics + page path;
- sufficient and partial page attribution differ;
- only qualified rows get On-Page handoff CTA;
- handoff uses sessionStorage and locale path with no query string;
- failed handoff prevents navigation and renders an error;
- content-gap rows copy the keyword;
- evidence-needed rows focus the property selector;
- long keywords/domains remain bounded;
- semantic table, focusable horizontal region, and EN/ZH key parity remain.

Use a production-shaped 100-row fixture with 10 observed rows.

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx \
  apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx \
  apps/marketing/src/i18n/competitor-keyword-gap-messages.test.tsx \
  apps/marketing/src/i18n/messages.test.ts
```

Expected: RED on v1 types, verbose paragraph layout, missing filters/actions and
100-row eager render.

**Step 2: Implement the minimum compact result**

- Pass selected property into Results without adding it to the public envelope.
- Add lane/filter/expand state local to Results.
- Keep actions deterministic and evidence-qualified.
- Use `localePath` for the On-Page destination.
- Keep private fields in sessionStorage only.
- Replace paragraph-dependent table typography with explicit data text.
- Preserve null/zero/source/truncation boundaries.

**Step 3: Run GREEN and Marketing gates**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx \
  apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx \
  apps/marketing/src/i18n/competitor-keyword-gap-messages.test.tsx \
  apps/marketing/src/i18n/messages.test.ts
pnpm --filter @sf/marketing typecheck
pnpm exec eslint \
  apps/marketing/src/components/tools/competitor-keyword-gap-tool.tsx \
  apps/marketing/src/components/tools/competitor-keyword-gap-results.tsx
```

### Task 4: Integration and production-shaped browser acceptance

**Files:** no production files unless a regression is found.

**Step 1: Run the combined deterministic suite**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/competitor-keyword-gap/validation.test.ts \
  packages/public-tools/src/competitor-keyword-gap/report.test.ts \
  apps/marketing/src/lib/tools/tool-handoff.test.ts \
  apps/marketing/src/components/tools/on-page-checker.test.tsx \
  apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts \
  apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx \
  apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx \
  apps/marketing/src/i18n/competitor-keyword-gap-messages.test.tsx \
  apps/marketing/src/i18n/messages.test.ts
```

**Step 2: Run repository gates**

```bash
pnpm typecheck
pnpm --filter @sf/marketing build
pnpm secrets:scan
git diff --check
```

Keep known repository baseline failures separate from this patch.

**Step 3: Browser acceptance**

Use a production build with the captured 100-row/10-observed shape. Verify:

- keyword/GSC/recommendation computed font sizes no longer inherit 17.44px;
- row rhythm matches the Artifact;
- top 10 plus exact remainder;
- lane counts and filter reset;
- observed rows appear before 90 misses;
- GSC compact states and no dash-only lines;
- trusted page action writes a private handoff and On-Page consumes it;
- URL contains no private query/page/property;
- EN and ZH render with no literal key;
- desktop and 390px document width do not overflow;
- horizontal table region remains keyboard reachable;
- no console errors.

**Step 4: Independent spec and quality reviews**

Run spec compliance first, then code quality. Fix every Critical/Important and
re-run the relevant review.

### Task 5: Release

After all deterministic and browser gates pass:

- rebase latest `origin/main`;
- verify the frozen diff and no migration/config/Worker/App scope;
- commit, push, PR, merge and wait for Marketing READY;
- verify English, Chinese, canonical, Tools hub, sitemap and unauthenticated API;
- do not issue a paid DFS canary;
- independently record the Product candidate and live alias identity.
