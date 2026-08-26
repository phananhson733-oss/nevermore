# GSC Daily Briefing SPEC-Aligned Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the Daily Briefing review table and GSC chart styling with the repository-owned Claude Design SPEC, while removing the duplicate visible site-trend card without changing evidence or actions.

**Architecture:** Keep the current Daily Briefing envelope and result data flow intact. Change only Marketing presentation: centralize the five-column layout, promote record populations with Artifact-native section headings, remove the duplicate property-trend rendering, and route GSC chart/card colors through new global visualization tokens.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, next-intl, Vitest/jsdom, repository Signal Console tokens.

---

### Task 1: Lock the Artifact table and group-heading contract

**Files:**
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Write the failing table-header test**

Add a result test that renders both query and page rows and asserts:

```tsx
const header = host.querySelector('[data-review-table-header]');
expect(header?.className).toContain('min-h-[50px]');
expect(header?.className).toContain('md:px-[14px]');
expect(header?.className).toContain('md:py-[13px]');
expect(header?.querySelector('[role="columnheader"]')?.className)
  .toContain('text-[12px]');
expect(header?.querySelector('[role="columnheader"]')?.className)
  .not.toContain('font-mono');
```

**Step 2: Write failing population-heading tests**

Cover three cases:

1. query records only -> query heading exists, page heading does not;
2. page records only -> page heading exists, query heading does not;
3. both -> both headings exist in query-then-page order.

Assert each heading contains the localized title and displayed count, for
example `3 records` / `3 条记录`, and uses a real heading element rather than
the shared eyebrow class.

**Step 3: Run the tests to verify RED**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  -t "review table|population heading"
```

Expected: FAIL because the current header is a 10px mono eyebrow and the query
group heading is conditional on the page population.

**Step 4: Add the count messages**

Add under `tools.dailyBriefing.review` in both locale files:

```json
"groupCount": "{count} records"
```

```json
"groupCount": "{count} 条记录"
```

**Step 5: Run i18n parity tests**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts \
  apps/marketing/src/i18n/messages.test.ts
```

Expected: PASS.

### Task 2: Implement the shared Artifact table layout

**Files:**
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.tsx`
- Test: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`

**Step 1: Define one desktop column template**

Replace repeated literal grid strings with one presentation constant. It must
keep the query/page primary-object column widest, compact the two metric
columns, preserve a readable status column and leave interpretation flexible.
Use the same constant for the header and every query, provisional, observation
and page row.

**Step 2: Apply the Artifact header role**

Add `data-review-table-header` and apply:

```text
min-h-[50px]
md:px-[14px]
md:py-[13px]
bg-brand-panel
border-brand-border-card
```

Replace `TABLE_HEADER` for this table with a Sans 12px semibold, 0.02em,
normal-case header role. Do not change the global eyebrow utility used by
evidence labels elsewhere.

**Step 3: Add the local desktop readability boundary**

Keep the outer rounded border. Add a local overflow wrapper whose table content
uses `md:min-w-[860px]`; do not apply that minimum width below the desktop
breakpoint, where rows remain stacked.

**Step 4: Render population headings independently**

Compute:

```ts
const shownQueryRecordCount =
  shownChanges.length + shownProvisional.length + shownObservations.length;
const shownPageRecordCount = shownPageChanges.length;
```

Render a query group row whenever the first value is positive, and a page group
row whenever the second is positive. Each row spans the visual table width and
contains:

```tsx
<h4>{t("review.queryGroup")}</h4>
<span>{t("review.groupCount", { count })}</span>
```

Use the existing Claude Design surface, text and border roles only.

**Step 5: Run the result tests to verify GREEN**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx
```

Expected: all tests pass.

### Task 3: Remove the visible duplicate site-trend module

**Files:**
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Write failing removal and preservation tests**

Build a report with a property trend and property action. Assert:

```tsx
expect(host.querySelector('[data-site-trend]')).toBeNull();
expect(host.querySelector('[data-property-action-row]')).not.toBeNull();
expect(host.querySelector('[data-evidence-fold-summary]')?.textContent)
  .not.toContain('site trend');
```

Add the equivalent Chinese-content assertion where the locale harness permits.

**Step 2: Run the focused test to verify RED**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  -t "duplicate site trend"
```

Expected: FAIL because the site-trend section and fold count still render.

**Step 3: Remove presentation only**

Delete the `data-site-trend` section and the fold-summary fragment that counts
the hidden site trend. Remove only imports, variables and locale keys orphaned
by that presentation deletion. Keep:

- `result.propertyTrend` contract use needed for property actions;
- property/action exact matching;
- property comparison values used inside the action row;
- signal-funnel evidence fields and backend calculations.

**Step 4: Run the full Daily Briefing result tests**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-tool.test.tsx
```

Expected: PASS, including the property-action preservation assertion.

### Task 4: Add the formal GSC visualization token family

**Files:**
- Modify: `apps/marketing/src/app/globals.css`
- Modify: `apps/marketing/src/app/theme-tokens.test.ts`
- Modify: `apps/marketing/src/components/tools/daily-briefing-trend.tsx`
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`

**Step 1: Write failing token-authority tests**

Extend `theme-tokens.test.ts` to assert `globals.css` owns exactly one literal
definition of each GSC token and that the trend component contains no Google
hex literal.

Extend the trend rendering assertions to require:

```tsx
expect(clickLine?.getAttribute("stroke")).toBe("var(--gsc-clicks)");
expect(impressionLine?.getAttribute("stroke")).toBe("var(--gsc-impressions)");
expect(ctrLine?.getAttribute("stroke")).toBe("var(--gsc-ctr)");
expect(positionLine?.getAttribute("stroke")).toBe("var(--gsc-position)");
```

Also assert the matching metric button style contains the same token.

**Step 2: Run tests to verify RED**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/app/theme-tokens.test.ts \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx
```

Expected: FAIL because the component still uses `--chart-*`.

**Step 3: Add tokens to the Claude Design system**

Add this isolated data-series family in `globals.css`, alongside chart series
roles and outside the GenGrowth brand/status assignments:

```css
--gsc-clicks: #4285f4;
--gsc-impressions: #5e35b1;
--gsc-ctr: #00897b;
--gsc-position: #ef6c00;
```

Document that these values are GSC visualization semantics only. Do not change
`--chart-*`, `--sc-accent*`, status colors or the brand gradient.

**Step 4: Route the component through GSC tokens**

Update `METRIC_STYLE` so each line and KPI tile uses its matching
`var(--gsc-*)`. Keep the existing dash patterns, `color-mix` surface treatment,
focus ring and text roles.

**Step 5: Run tests to verify GREEN**

Run the same two test files. Expected: PASS.

### Task 5: Full local acceptance

**Files:**
- Verify only; modify files only if a failing gate identifies a defect.

**Step 1: Run focused unit coverage**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-tool.test.tsx \
  apps/marketing/src/app/theme-tokens.test.ts \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts \
  packages/public-tools/src/daily-briefing/report.test.ts \
  packages/public-tools/src/daily-briefing/run.test.ts
```

Expected: PASS.

**Step 2: Run type and touched-file lint gates**

```bash
pnpm --filter @sf/marketing typecheck
pnpm exec eslint \
  apps/marketing/src/components/tools/daily-briefing-results.tsx \
  apps/marketing/src/components/tools/daily-briefing-trend.tsx
git diff --check
```

Expected: PASS.

**Step 3: Run the production build**

```bash
pnpm --filter @sf/marketing build
```

Expected: Next.js build succeeds and all Marketing routes generate.

**Step 4: Browser acceptance**

In a connected local or preview GSC result state, verify:

- EN and ZH headings/counts;
- desktop table header and five-column alignment;
- query-only, page-only and combined group boundaries;
- absence of the duplicate site-trend card;
- property action still present when supported;
- dark/light chart and card colors;
- keyboard focus and expanded trend table;
- no page-level overflow at 390px.

If the available browser has no GSC grant, record result-state browser
verification as unverified rather than substituting a mock production claim.

### Task 6: Release, only after explicit authorization

**Files:** None unless release review identifies a concrete correction.

**Step 1: Stop for authority**

Do not commit, push, create a PR, merge or deploy unless the Owner explicitly
authorizes those actions for this layout change.

**Step 2: On authorization, create one surgical commit**

```bash
git add \
  docs/plans/2026-08-26-gsc-daily-briefing-spec-layout-design.md \
  docs/plans/2026-08-26-gsc-daily-briefing-spec-layout.md \
  apps/marketing/src/app/globals.css \
  apps/marketing/src/app/theme-tokens.test.ts \
  apps/marketing/src/components/tools/daily-briefing-results.tsx \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-trend.tsx \
  apps/marketing/src/i18n/messages/en.json \
  apps/marketing/src/i18n/messages/zh.json
git commit -m "fix(daily-briefing): align results with design spec"
```

**Step 3: Push, open PR and wait for preview checks**

Use a normal push; never force-push. Merge only after required checks pass.

**Step 4: Verify production identity**

Accept production only when the Vercel deployment is `READY`, targets
`production`, and its immutable `githubCommitSha` equals the merged `main` SHA.
Then verify both locale routes return 200 and the browser has no framework error
overlay.

---

Plan complete. Execute from the isolated worktree
`/Users/wzb/Code/nevermore/daily-briefing-layout-spec-20260826` using
`superpowers:executing-plans`.
