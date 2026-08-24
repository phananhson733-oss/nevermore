# GSC Daily Briefing Artifact Sections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the supplied Artifact’s two primary Daily Briefing result sections, including honest pre-run previews, a responsive changes comparison panel, and a ranked vertical action list.

**Architecture:** Keep the existing `DailyBriefingEnvelope`, API, GSC reads, evidence gates, action matching, and private handoff unchanged. Make the correction entirely in the Marketing client presentation and localized messages: one preview component for the pre-run state, one compact noise summary, one responsive single-DOM change grid, and one vertical action list. Preserve the existing theme tokens and fail-closed evidence semantics.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, next-intl, Tailwind CSS, Vitest/jsdom, existing `@sf/public-tools` Daily Briefing types.

---

### Task 1: Add honest pre-run result previews

**Files:**
- Modify: `apps/marketing/src/components/tools/daily-briefing-tool.test.tsx`
- Modify: `apps/marketing/src/components/tools/daily-briefing-tool.tsx`
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Write the failing pre-run test**

Add a connected-state test before any fetch is triggered:

```tsx
it("shows both approved result previews before the first run without mock evidence", async () => {
  globalThis.fetch = vi.fn() as typeof fetch;
  const host = await renderTool();

  expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(2);
  expect(host.textContent).toContain("Changes above the noise threshold");
  expect(host.textContent).toContain("Today's recommended actions");
  expect(host.textContent).toContain("Run the briefing to generate");
  expect(host.querySelector("[data-change]")).toBeNull();
  expect(host.querySelector("[data-action-row]")).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
```

Extend the existing successful-run test to require that both preview panels are
gone after a real response mounts `DailyBriefingResults`:

```tsx
expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(0);
```

**Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-tool.test.tsx
```

Expected: FAIL because no pre-run preview component or preview messages exist.

**Step 3: Add the minimal localized preview contract**

Add matching EN/ZH keys under `tools.dailyBriefing`:

```json
{
  "preview": {
    "changes": "Run the briefing to generate evidence-backed changes from your latest complete comparison windows.",
    "actions": "Run the briefing to generate up to three actions tied to observed evidence."
  }
}
```

Chinese:

```json
{
  "preview": {
    "changes": "生成简报后，这里会显示最新完整对比窗口中有证据支持的变化。",
    "actions": "生成简报后，这里会显示最多三项与已观察证据绑定的动作。"
  }
}
```

Do not add example values, synthetic rows, or placeholder query/page strings.

**Step 4: Implement and render the preview**

Export one presentation-only component from
`daily-briefing-results.tsx`:

```tsx
export function DailyBriefingResultPreview() {
  const t = useTranslations("tools.dailyBriefing");
  return (
    <div className="mt-8 space-y-8">
      <ResultSectionHeading
        id="daily-briefing-preview-changes"
        title={t("changes.title")}
        intro={t("changes.intro")}
      />
      <PreviewPanel>{t("preview.changes")}</PreviewPanel>
      <ResultSectionHeading
        id="daily-briefing-preview-actions"
        title={t("actions.title")}
        intro={t("actions.intro")}
      />
      <PreviewPanel>{t("preview.actions")}</PreviewPanel>
    </div>
  );
}
```

Use semantic `<section>` elements with `data-result-preview`; the empty panel
must be a normal bordered panel rather than shimmer/skeleton content.

In `DailyBriefingTool`, render exactly one state:

```tsx
{payload ? (
  <DailyBriefingResults {...resultProps} />
) : (
  <DailyBriefingResultPreview />
)}
```

Keep connect/no-property states unchanged.

**Step 5: Run the focused test and verify GREEN**

Run the same Vitest command. Expected: PASS and no React warnings.

**Step 6: Commit**

```bash
git add \
  apps/marketing/src/components/tools/daily-briefing-tool.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-tool.tsx \
  apps/marketing/src/components/tools/daily-briefing-results.tsx \
  apps/marketing/src/i18n/messages/en.json \
  apps/marketing/src/i18n/messages/zh.json
git commit -m "fix(marketing): preview Daily Briefing result sections"
```

### Task 2: Restore the primary result order and noise summary

**Files:**
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Write failing result-order and noise tests**

Add a test that reads the stable section markers in DOM order:

```tsx
it("puts the noise summary, material changes, and today's actions directly after KPIs", async () => {
  const host = await renderResults(
    envelope({ filteredObservedRows: 17, countComplete: true }),
  );
  const order = [...host.querySelectorAll("[data-result-section]")].map(
    (node) => node.getAttribute("data-result-section"),
  );

  expect(order).toEqual([
    "facts",
    "kpis",
    "noise",
    "changes",
    "actions",
    "manual",
    "evidence",
    "limitations",
    "methodology",
  ]);
  expect(host.textContent).toContain("Noise filter on");
  expect(host.textContent).toContain("17 observed query rows");
  expect(host.textContent).toContain("0 changes cleared the threshold");
});
```

Add a second assertion to the existing partial-count test:

```tsx
expect(host.textContent).toContain("observed prefix");
expect(host.textContent).toContain("not property-wide");
```

**Step 2: Run the result test and verify RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx
```

Expected: FAIL because the evidence card still separates KPIs from changes and
there is no compact noise section.

**Step 3: Add exact section titles, intros, and noise messages**

Replace the weakened titles and add introductions:

```json
{
  "changes": {
    "title": "Changes above the noise threshold",
    "intro": "Latest complete 7 days versus the preceding 7 days. At most three evidence-backed rows are shown."
  },
  "actions": {
    "title": "Today's recommended actions",
    "intro": "At most three, in deterministic evidence order. Each action carries its evidence to the next tool."
  },
  "noise": {
    "label": "Noise filter on",
    "complete": "{filtered} observed query rows did not clear a signal threshold. {shown} changes cleared the threshold.",
    "partial": "{filtered} rows in the observed prefix did not clear a signal threshold; this is not property-wide. {shown} changes cleared the available evidence gates."
  }
}
```

Add exact Chinese equivalents using the approved titles:

```json
{
  "changes": {
    "title": "超出噪声阈值的变化",
    "intro": "对比最近完整 7 天与前 7 天，最多显示三条有证据支持的变化。"
  },
  "actions": {
    "title": "今日建议动作",
    "intro": "最多三项，按确定性的证据顺序排列；每项都把证据私密带到下一工具。"
  },
  "noise": {
    "label": "噪声过滤已开启",
    "complete": "有 {filtered} 条已观察查询记录没有通过信号门槛；本次有 {shown} 项变化通过门槛。",
    "partial": "已观察前缀中有 {filtered} 条记录没有通过门槛，这不是全站计数；本次有 {shown} 项变化通过当前可用证据门槛。"
  }
}
```

**Step 4: Implement the compact summary and reorder disclosure**

Add a `NoiseSummary` that receives only `filtered`, `shown`, and `complete`.
Place it directly after KPI cards. Move the existing detailed evidence section
after the manual-check section without changing any calculations.

Apply `data-result-section` to the nine accepted sections so the information
architecture remains regression-testable.

**Step 5: Run the result test and verify GREEN**

Run the same focused result test. Expected: PASS.

### Task 3: Replace change cards with one responsive comparison panel

**Files:**
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Write the failing comparison-panel tests**

Extend the existing four-change cap test:

```tsx
const table = host.querySelector('[role="table"]');
expect(table).not.toBeNull();
expect(
  [...host.querySelectorAll('[role="columnheader"]')].map((cell) =>
    cell.textContent?.trim(),
  ),
).toEqual(["Change", "Query / Page", "Clicks", "Position", "Interpretation"]);
expect(host.querySelectorAll("[data-change]")).toHaveLength(3);
expect(host.textContent).toContain("20 → 12");
expect(host.textContent).toContain("8.0 → 8.2");
```

Add a dedicated first-observed regression:

```tsx
it("renders a first-observed baseline as not observed rather than zero", async () => {
  const host = await renderResults(
    envelope({ changes: [change("first_observed", 1)] }),
  );
  const row = host.querySelector("[data-change]") as HTMLElement;

  expect(row.textContent).toContain("Not observed");
  expect(row.textContent).not.toContain("0 → 12");
  expect(row.textContent).not.toContain("0.0 → 8.2");
});
```

Add an empty-state test requiring the bordered panel to remain present:

```tsx
expect(host.querySelector("[data-change-empty]")).not.toBeNull();
expect(host.querySelector('[role="table"]')).toBeNull();
```

**Step 2: Run the focused result test and verify RED**

Expected: FAIL because changes are currently separate four-field cards.

**Step 3: Add comparison formatting helpers**

Keep these helpers presentation-only:

```tsx
function comparison(
  previous: number | null,
  current: number,
  format: (value: number) => string,
  unavailable: string,
): string {
  return `${previous === null ? unavailable : format(previous)} → ${format(current)}`;
}
```

Use `t("changes.notObserved")` for a missing previous observation. Use
`t("kpis.unavailable")` only for genuinely unavailable non-observation values.

**Step 4: Implement one responsive, single-DOM change grid**

Render one bordered panel with `role="table"`:

```tsx
<div role="table" className="overflow-hidden rounded-[12px] border ...">
  <div role="row" className="hidden md:grid md:grid-cols-[...]">
    {headers.map((header) => <div role="columnheader">{header}</div>)}
  </div>
  {changes.map((change) => (
    <article
      role="row"
      data-change
      className="grid gap-3 border-t ... md:grid-cols-[...]"
    >
      {/* one cell per accepted Artifact column */}
    </article>
  ))}
</div>
```

Each mobile cell includes a visually rendered `md:hidden` label while desktop
uses the shared header. Keep one DOM copy of every private query/page.

The interpretation cell uses the existing localized kind body. Do not invent a
causal diagnosis or a recoverable-click estimate.

**Step 5: Run the focused result test and verify GREEN**

Expected: PASS with exactly three `data-change` rows and no raw machine kind.

**Step 6: Commit Tasks 2–3**

```bash
git add \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-results.tsx \
  apps/marketing/src/i18n/messages/en.json \
  apps/marketing/src/i18n/messages/zh.json
git commit -m "fix(marketing): restore Daily Briefing change hierarchy"
```

### Task 4: Replace the action grid with Artifact-aligned ranked rows

**Files:**
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.tsx`

**Step 1: Write the failing ranked-action test**

Extend the existing matched-action test:

```tsx
const list = host.querySelector("[data-actions-list]");
const rows = [...host.querySelectorAll("[data-action-row]")];

expect(list).not.toBeNull();
expect(rows).toHaveLength(3);
expect(rows.map((row) => row.getAttribute("data-action-rank"))).toEqual([
  "1",
  "2",
  "3",
]);
for (const row of rows) {
  expect(row.querySelector("[data-action-evidence]")).not.toBeNull();
  expect(row.querySelector("[data-action-link]")).not.toBeNull();
}
```

Add the zero-action case:

```tsx
expect(host.querySelector("[data-action-empty]")).not.toBeNull();
expect(host.querySelector("[data-actions-list]")).toBeNull();
```

Keep the existing exact-match, cap, internal-link, bounded-ID, storage-failure,
and throwing-sessionStorage tests unchanged.

**Step 2: Run the focused result test and verify RED**

Expected: FAIL because actions are a three-column card grid without ranks.

**Step 3: Implement the vertical action list**

Use one full-width row per matched action:

```tsx
<div data-actions-list className="grid gap-3">
  {actions.map(({ action, change }, index) => (
    <article
      data-action-row
      data-action-rank={index + 1}
      className="flex flex-col gap-4 rounded-[12px] border ... lg:flex-row"
    >
      <span className="...">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <h4>{t(`actionKinds.${action.kind}.title`)}</h4>
        <p>{t(`actionKinds.${action.kind}.body`)}</p>
        <p data-action-evidence>{change.query} · {change.page}</p>
      </div>
      <Link data-action-link ...>{t(target.labelKey)}</Link>
    </article>
  ))}
</div>
```

The CTA is right-aligned on wide screens and full-width below the text on small
screens. Reuse the existing `handoff` callback without changing payload fields
or URLs.

**Step 4: Run the focused result test and verify GREEN**

Expected: PASS, including every existing privacy/handoff test.

**Step 5: Commit**

```bash
git add \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-results.tsx
git commit -m "fix(marketing): rank Daily Briefing actions"
```

### Task 5: Close localization, regression, responsive, and release gates

**Files:**
- Modify if required by tests only: `apps/marketing/src/i18n/daily-briefing-messages.test.ts`
- Review: all files changed in Tasks 1–4

**Step 1: Run the complete Daily Briefing UI regression**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-tool.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts \
  apps/marketing/src/app/[locale]/tools/daily-search-briefing/page.test.ts
```

Expected: all tests PASS with no React warnings or unhandled errors.

**Step 2: Run the affected handoff regressions**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/tools/tool-handoff.test.ts \
  apps/marketing/src/components/tools/quick-wins-tool.test.tsx \
  apps/marketing/src/components/tools/traffic-drop-tool.test.tsx \
  apps/marketing/src/components/tools/on-page-checker.test.tsx
```

Expected: all tests PASS; no destination auto-runs and no private evidence enters
a URL.

**Step 3: Run static and production-build gates**

```bash
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/public-tools typecheck
git diff --name-only origin/main...HEAD | rg '\.(ts|tsx)$' | \
  xargs pnpm exec eslint --max-warnings=0
pnpm --filter @sf/marketing build
pnpm secrets:scan
git diff --check origin/main...HEAD
```

Expected: all patch-scoped checks PASS. Report any repository baseline failure
separately and prove its file is unchanged from `origin/main`.

**Step 4: Inspect the local responsive result contract**

Start Marketing locally:

```bash
pnpm --filter @sf/marketing dev
```

Verify in the browser:

- EN and ZH pre-run pages both show the two preview sections;
- no preview contains a query, page, metric, or mock count;
- dark and light themes preserve contrast;
- keyboard focus reaches the run button and manual checks;
- 390px has no horizontal page overflow;
- no site-origin console error;
- the real result layout is covered by deterministic component tests unless the
  user separately authorizes a live private GSC run.

**Step 5: Request independent review**

Use `requesting-code-review` against `origin/main...HEAD`. Require review of:

- Artifact information hierarchy;
- null/not-observed semantics;
- mobile single-DOM structure;
- handoff privacy;
- EN/ZH completeness;
- scope boundary (`apps/marketing` plus docs only).

Fix valid findings with a new RED test before production code.

**Step 6: Commit any final test-only corrections**

```bash
git add <only-the-reviewed-files>
git commit -m "test(marketing): lock Daily Briefing artifact sections"
```

Skip this commit when the worktree is already clean.

**Step 7: Release using the Marketing-only boundary**

After all gates and review pass:

1. push `fix/daily-briefing-artifact-sections`;
2. create a PR that lists the Artifact correction and baseline exceptions;
3. wait for Vercel previews;
4. merge the reviewed SHA;
5. verify the exact merge SHA is `READY` on the `gengrowth-agents` project and
   aliased to `gengrowth.ai`;
6. independently inspect `app.gengrowth.ai`; if the shared push promotes an
   unchanged Product candidate, restore the pre-release Product deployment;
7. verify EN/ZH pages, Tools entry, sitemap, unauthenticated API contract, build
   logs, runtime errors, 390px layout, and the two new pre-run preview sections.

Do not run a private connected GSC briefing in Production without the user’s
separate action-time confirmation.
