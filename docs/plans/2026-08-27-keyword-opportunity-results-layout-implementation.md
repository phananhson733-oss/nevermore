# Keyword Opportunity Results Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the low-competition keyword result's ten-column evidence dump with compact SEO/GEO decision tables and accessible per-row evidence expansion.

**Architecture:** Keep the existing `keyword_opportunity_map.v2` payload, deterministic display ordering, and CSV contract unchanged. Refactor only the Marketing result renderer: summarize run context, collapse the funnel, compose each compact row from existing evidence, and mount technical provenance in a controlled detail row.

**Tech Stack:** Next.js 16.2, React 19, TypeScript strict, next-intl, Tailwind CSS tokens, Vitest, react-dom test utilities, Playwright/browser verification.

**Authorization:** Local files and tests only. Do not commit, push, create a PR, deploy, run paid providers, or write production data.

---

### Task 1: Lock the compact table contract with failing static tests

**Files:**
- Modify: `apps/marketing/src/components/tools/keyword-map-results.test.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.tsx`

**Step 1: Add a helper that isolates one compact summary row**

Add a helper that finds a row by `data-keyword-row` rather than searching an
arbitrary ancestor. This lets assertions prove technical details are absent
from the always-visible row.

```ts
function summaryRowFor(markup: string, keyword: string): string {
  const marker = `data-keyword-row="${keyword}"`;
  const at = markup.indexOf(marker);
  expect(at, `no summary row for ${keyword}`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<tr", at);
  const end = markup.indexOf("</tr>", at);
  return markup.slice(start, end);
}
```

**Step 2: Write failing layout assertions**

Add tests proving:

- the SEO table carries `data-keyword-table="seo"` and exactly six headers;
- the GEO table carries `data-keyword-table="geo"` and exactly five headers;
- the table uses a compact minimum width below the former `1480px` value;
- the scroll container is focusable and labelled;
- keyword and numeric cells have explicit compact typography;
- the SEO summary row contains keyword, volume, KD, weakest domain/position,
  three signal states, AI availability/assessment, coverage, and remaining
  decisions;
- the summary row does not contain model id, prompt version, or a full community
  URL.

Use `v2SeoRow("intent evidence keyword")` so all evidence is present.

**Step 3: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/keyword-map-results.test.tsx
```

Expected: FAIL because the current renderer has ten SEO columns, no compact
table data attributes, and technical provenance in the main row.

**Step 4: Add only the data hooks needed by the new contract**

Add stable `data-keyword-table`, `data-keyword-row`, `data-keyword-summary`, and
`data-keyword-scroll` attributes while implementing the table in Tasks 2-4.
Do not add test-only branches.

**Step 5: Checkpoint without commit**

Run `git diff --check` and inspect the test diff. Do not commit.

### Task 2: Compact the run context and collapse the funnel

**Files:**
- Modify: `apps/marketing/src/components/tools/keyword-map-results.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Write failing reading-order and funnel tests**

Assert that:

- one summary section contains site/market/language plus included, incomplete,
  and withheld counts;
- the CSV button is inside that summary section;
- the funnel is inside a native `<details data-screening-process>`;
- the details summary precedes the nine funnel tiles;
- null stage counts still render the existing `notMeasured` copy.

**Step 2: Run the focused test and verify RED**

Run the Task 1 Vitest command. Expected: FAIL because `RunSummary`,
`EligibleSummary`, and `ExportRow` are currently separate and the funnel is
always open.

**Step 3: Implement `ResultSummary`**

Replace the separate run/eligible/export surfaces with one component accepting:

```ts
{
  result: KeywordOpportunityResult;
  locale: string;
  incompleteCount: number;
}
```

Render a scope strip, three compact outcome metrics, selection/stop facts, CSV
button, and a native collapsed funnel. Continue to call `stageRan` for every
funnel tile so unavailable stages never display zero.

**Step 4: Add concise EN/ZH labels**

Add only the keys needed for the summary, outcome metrics, screening-process
summary, source labels, row details, and compact column names. Keep existing
keys until all callers and tests prove they are unused.

**Step 5: Run the focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/keyword-map-results.test.tsx \
  apps/marketing/src/lib/tools/keyword-map-messages.test.ts \
  apps/marketing/src/i18n/messages.test.ts
```

Expected: PASS for the summary tests and all pre-existing honesty tests.

**Step 6: Checkpoint without commit**

Run `git diff --check` and inspect the source/message diff. Do not commit.

### Task 3: Replace the SEO ten-column row with six compact columns

**Files:**
- Modify: `apps/marketing/src/components/tools/keyword-map-results.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.test.tsx`

**Step 1: Keep the failing SEO assertions from Task 1 active**

Confirm the layout test still fails on the six-column and provenance-placement
assertions before changing production markup.

**Step 2: Implement explicit table typography and shapes**

Add local constants for:

```ts
const TABLE_TEXT = "text-[13px] leading-[1.45]";
const META_TEXT = "text-[12px] leading-[1.35]";
const KEYWORD_TEXT = "text-[15.5px] font-semibold leading-[1.25] text-text-dark-primary";
const DATA_CHIP = "inline-flex items-center gap-1 rounded-[6px] border px-2 py-[3px] font-mono text-[11.5px] leading-[1.35]";
const STATE_PILL = "inline-flex items-center rounded-full border px-2.5 py-1 text-[11.5px] leading-[1.3]";
```

Use existing brand tokens for tones. Do not import competitor-specific modules
or extract a cross-tool abstraction in this change.

**Step 3: Implement the six SEO cells**

Compose the existing fields into:

1. keyword plus separately labelled provider/SERP intent;
2. volume;
3. KD plus weakest domain rank/domain/position;
4. compact three-signal summary;
5. AI provider availability plus separate answer assessment;
6. coverage, row-specific checks, and detail toggle.

The summary signal renderer must never render full URLs, titles, model ids,
prompt versions, registration timestamps, or thresholds.

**Step 4: Preserve ordering and shared checks**

Continue using `keywordOpportunityDisplayRows` and `commonChecks`. Do not add a
new sort, score, or row action.

**Step 5: Run the focused test and verify GREEN**

Run the Task 1 command. Expected: the SEO layout and all existing semantic tests
pass.

**Step 6: Checkpoint without commit**

Run `git diff --check`; inspect every changed line for direct relation to the
result layout. Do not commit.

### Task 4: Add mounted per-row evidence expansion

**Files:**
- Modify: `apps/marketing/src/components/tools/keyword-map-results.tsx`
- Create: `apps/marketing/src/components/tools/keyword-map-results-interaction.test.tsx`

**Step 1: Write a failing jsdom interaction test**

Use `createRoot`, `act`, the real EN/ZH messages, and a complete v2 result.
Assert:

1. the detail row is absent before interaction;
2. the button has `aria-expanded="false"`;
3. clicking mounts a full-width detail row;
4. the button becomes `aria-expanded="true"`;
5. the detail row contains model id, prompt version, complete community URL,
   title, threshold, registration date, and AI reason;
6. clicking again unmounts the detail row.

**Step 2: Run the interaction test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/keyword-map-results-interaction.test.tsx
```

Expected: FAIL because no detail toggle or mounted detail row exists.

**Step 3: Implement `KeywordResultRow`**

Use local React state and a stable id:

```tsx
const [expanded, setExpanded] = useState(false);
const detailId = useId();
```

Return a fragment containing the compact main `<tr>` and, only when expanded,
a following `<tr id={detailId}>` with one `<td colSpan={columnCount}>`.

The toggle must use `aria-expanded`, `aria-controls`, an explicit type, visible
focus styles, and a 44px minimum height.

**Step 4: Implement the full evidence grid**

Reuse existing labels and formatting. Keep provider/inference and observed/
unavailable distinctions explicit. Render remote text as text; do not use
`dangerouslySetInnerHTML`.

**Step 5: Run the interaction and static tests and verify GREEN**

Run both keyword result test files. Expected: PASS and no React act warnings.

**Step 6: Checkpoint without commit**

Run `git diff --check` and inspect the interaction code. Do not commit.

### Task 5: Compact the GEO table without inventing SEO metrics

**Files:**
- Modify: `apps/marketing/src/components/tools/keyword-map-results.tsx`
- Modify: `apps/marketing/src/components/tools/keyword-map-results.test.tsx`

**Step 1: Add a failing complete GEO fixture and five-column assertions**

Build a GEO row with a supporting page, signals, AI evidence, coverage, and
checks. Assert that its summary row contains a bounded host/path but not the
full URL, and that the expanded evidence contains the full URL.

**Step 2: Run the static test and verify RED**

Expected: FAIL because the current GEO table has separate provider/SERP intent
columns and exposes the full supporting URL.

**Step 3: Implement the five GEO cells**

Render question/intents, supporting-page display, signal summary, AI summary,
and coverage/review. Reuse `KeywordResultRow` and pass the correct column count.
Do not render volume, KD, or weakest-rank placeholders in GEO.

**Step 4: Run static and interaction tests and verify GREEN**

Expected: both lane contracts pass and the existing GEO hint remains visible.

**Step 5: Checkpoint without commit**

Run `git diff --check`; inspect the lane-specific branches. Do not commit.

### Task 6: Run focused semantic, type, lint, and build verification

**Files:**
- Verify only; modify source only if a fresh failure is caused by this change.

**Step 1: Run the complete focused unit set**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/keyword-map-results.test.tsx \
  apps/marketing/src/components/tools/keyword-map-results-interaction.test.tsx \
  apps/marketing/src/lib/tools/keyword-map-messages.test.ts \
  apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts \
  apps/marketing/src/i18n/messages.test.ts
```

Expected: all tests pass with zero failures and zero warnings caused by this
change.

**Step 2: Run Marketing typecheck and lint**

Inspect workspace scripts first, then run the narrowest package commands that
prove the changed TSX and messages. If the package has no narrow script, run
root `pnpm typecheck` and `pnpm lint` and report any accepted baseline failures
separately.

**Step 3: Run the Marketing build**

Use the package's existing build command. Expected: exit 0.

**Step 4: Run repository guards proportional to the change**

```bash
pnpm verify:docs
pnpm secrets:scan
git diff --check
```

Expected: exit 0. If `secrets:scan` includes unrelated historical failures,
record the exact baseline instead of weakening the guard.

### Task 7: Browser acceptance in light/dark and responsive widths

**Files:**
- Verify only; do not run a paid keyword opportunity request.

**Step 1: Start the Marketing app using a deterministic local result fixture**

Use an existing harness if one is available. If not, add the smallest local-only
component harness under the test surface; do not add a production route or
provider call.

**Step 2: Verify 1440px and 1024px**

For both EN and ZH, light and dark:

- six SEO/five GEO headers remain on one line;
- at least several compact rows fit in one desktop viewport;
- the page has no document-level horizontal overflow;
- the table container receives keyboard focus;
- expand/collapse mounts/unmounts the detail row;
- status text remains readable and not colour-only.

**Step 3: Verify 390px**

- document-level horizontal overflow remains zero;
- only the table container scrolls horizontally;
- the evidence button is at least 44px high and keyboard/touch reachable;
- opening evidence does not expose clipped or unreachable content.

**Step 4: Inspect browser console**

Expected: no React hydration error, key warning, accessibility exception, or
new console error.

### Task 8: Final diff and permission handoff

**Files:**
- Verify all changed files.

**Step 1: Review scope**

Run:

```bash
git status --short
git diff --stat
git diff -- apps/marketing/src/components/tools/keyword-map-results.tsx \
  apps/marketing/src/components/tools/keyword-map-results.test.tsx \
  apps/marketing/src/components/tools/keyword-map-results-interaction.test.tsx \
  apps/marketing/src/i18n/messages/en.json \
  apps/marketing/src/i18n/messages/zh.json \
  docs/plans/2026-08-27-keyword-opportunity-results-layout-design.md \
  docs/plans/2026-08-27-keyword-opportunity-results-layout-implementation.md
```

Confirm every changed line traces to the approved result layout.

**Step 2: Report exact evidence tier**

Report local file changes, test/lint/type/build/browser results, remaining
risks, worktree path, branch, and HEAD. State explicitly that the work is not
committed, pushed, reviewed in CI, or deployed.

**Step 3: Stop at the authorization boundary**

Do not commit, push, open a PR, or deploy until the user separately authorizes
those actions.
