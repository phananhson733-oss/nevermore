# GSC Daily Briefing Observation Watchlist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the existing strict Daily Briefing signal and action gates while adding an observation-only query watchlist and a separate site-wide trend card so low-yield real properties still show concrete, honest work items.

**Architecture:** Extend the pure `@sf/public-tools` result contract with one additive `queryWatchlist` field and keep `changes`, `actions`, and `propertyFallback` semantics intact. Reuse the existing query/query-page reads to derive bounded observation rows after strict selection, then update the Marketing result artifact to render site-wide trend, combined review rows, and strict-only actions without creating new persistence or downstream handoffs.

**Tech Stack:** TypeScript, `@sf/public-tools`, Next.js 16, React 19, next-intl, Vitest/jsdom, existing Marketing handoff storage, Vercel Git deployment.

---

## Baseline and authority checkpoint

Work only in `/Users/wzb/Code/nevermore/daily-briefing-observation-watchlist`
on `fix/daily-briefing-observation-watchlist-20260825`. Do not touch, clean, or
copy from the dirty legacy worktree at
`/Users/wzb/Code/nevermore/daily-search-briefing`.

1. Install the repository-pinned dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Record HEAD, `origin/main`, and status, then run the focused baseline before
   adding a RED test:

   ```bash
   git status --short --branch
   git rev-parse HEAD
   git rev-parse origin/main
   pnpm exec vitest run --project unit \
     packages/public-tools/src/daily-briefing/report.test.ts \
     packages/public-tools/src/daily-briefing/run.test.ts \
     apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
     apps/marketing/src/components/tools/daily-briefing-tool.test.tsx \
     apps/marketing/src/i18n/daily-briefing-messages.test.ts
   ```

3. If `origin/main` advanced, merge it before the first RED test and rerun the
   baseline. Preserve the Public Tools authority in
   `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md`: real GSC
   facts only, unavailable never becomes zero, and no canonical persistence.

### Task 1: Add the additive observation contract and pure selection logic

**Files:**
- Modify: `packages/public-tools/src/daily-briefing/types.ts`
- Modify: `packages/public-tools/src/daily-briefing/report.ts`
- Test: `packages/public-tools/src/daily-briefing/report.test.ts`

**Step 1: Write the failing report tests**

Add tests for:

- `evaluation_eligible` at exactly `100` impressions and `sample_building` at `50` and `99`;
- strict changes excluded from observations;
- combined `changes + observations <= 3`;
- ordering by tier, absolute click delta, impressions, then query;
- previous row missing stays `null` / not-observed, never zero;
- page attribution boundaries at `0.799` and `0.8`;
- page-floor boundaries at `49/50` and `99/100`;
- partial and unavailable evidence emit empty watchlists with the correct evidence state;
- property fallback remains unchanged and is not turned into a watchlist row.

**Step 2: Run the focused test and verify RED**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/daily-briefing/report.test.ts
```

Expected: FAIL because `queryWatchlist` and observation logic do not exist.

**Step 3: Add the new types**

Add:

```ts
export interface DailyBriefingQueryWatchlist {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly items: readonly DailyBriefingQueryObservation[];
}

export interface DailyBriefingQueryObservation {
  readonly kind: "evaluation_eligible" | "sample_building";
  readonly query: string;
  readonly page: string | null;
  readonly pageEvidence: "observed" | "unavailable";
  readonly current: GscQueryRow;
  readonly previous: GscQueryRow | null;
}
```

`DailyBriefingResult` adds:

```ts
readonly queryWatchlist: DailyBriefingQueryWatchlist;
```

Keep schema version `daily_search_briefing.v1`.

**Step 4: Implement minimal pure watchlist selection**

After strict `changes` are selected:

- exclude any query already used by a strict change;
- derive `evaluation_eligible` from current rows with `>= 100` impressions;
- derive `sample_building` from current rows with `50–99` impressions;
- sort by approved deterministic order;
- fill only the remaining slots under the total cap of three rows;
- attribute a page only when coverage is `>= 0.8` and the page-row impression floor matches the observation tier;
- otherwise return `page: null` and `pageEvidence: "unavailable"`;
- on `partial` or `unavailable` evidence, emit no ranked items and keep honest evidence state.

Do not change strict thresholds, strict ordering, property fallback rules, action destinations, or existing handoff payloads.

**Step 5: Run focused tests to GREEN**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/daily-briefing/report.test.ts
pnpm --filter @sf/public-tools typecheck
```

Expected: PASS.

**Step 6: Commit the core change**

```bash
git add \
  packages/public-tools/src/daily-briefing/types.ts \
  packages/public-tools/src/daily-briefing/report.ts \
  packages/public-tools/src/daily-briefing/report.test.ts
git commit -m "feat(public-tools): add Daily Briefing query watchlist"
```

### Task 2: Rebuild the Marketing result artifact around separate site trend plus combined review rows

**Files:**
- Modify: `apps/marketing/src/components/tools/daily-briefing-results.tsx`
- Test: `apps/marketing/src/components/tools/daily-briefing-results.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Test: `apps/marketing/src/i18n/daily-briefing-messages.test.ts`

**Step 1: Write the failing UI tests**

Cover:

- site-wide trend renders outside the query/page table;
- strict rows render first, observations fill remaining rows;
- observation rows show status text, metrics, and interpretation but no CTA;
- page-unavailable observations render explicit copy rather than empty strings;
- action section remains strict-only and may stay shorter than three;
- observed-empty vs partial vs unavailable watchlist states differ;
- noise summary uses the approved labels and wording;
- the property card no longer appears as a pseudo query/page row;
- EN/ZH contain the same placeholders for `{observed}`, `{eligible}`,
  `{selected}`, `{observations}`, and `{trend}`;
- customer copy uses “evaluation sample floor”, “strict changes”,
  “observations”, and “site-wide trend”, not the internal terms “action sample
  floor” or “property fallback”.

**Step 2: Run the focused UI test and verify RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts
```

Expected: FAIL because the current UI still renders `propertyFallback` inside the change table and has no observation rows.

**Step 3: Implement the minimal artifact changes**

- Render a standalone site-wide trend card before the review table.
- Replace the change section body with `strict changes + watchlist observations`, capped at three total rows.
- Keep observation rows non-clickable and without handoff writes.
- Keep the action list canonical for CTAs and property actions.
- Update signal summary copy to use “evaluation sample floor”, “strict changes”, “observations”, and “site-wide trend”.
- Add explicit EN/ZH copy for observation states and the page-unavailable label.
- Add explicit, different observed-empty, partial, and unavailable watchlist
  copy; never render missing counts as measured zero.

Preserve existing layout tokens, dark/light behavior, and current action-card styling.

**Step 4: Run focused UI tests to GREEN**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-tool.test.tsx \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts
pnpm --filter @sf/marketing typecheck
```

Expected: PASS.

**Step 5: Commit the Marketing result change**

```bash
git add \
  apps/marketing/src/components/tools/daily-briefing-results.tsx \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/i18n/messages/en.json \
  apps/marketing/src/i18n/messages/zh.json \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts
git commit -m "feat(marketing): render Daily Briefing observations"
```

### Task 3: Cross-boundary verification and independent review

**Files:** Verify the branch diff. Modify only already-owned files when a real
review finding requires a fix.

**Step 1: Run the complete change-scoped regression set**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/daily-briefing/report.test.ts \
  packages/public-tools/src/daily-briefing/run.test.ts \
  apps/marketing/src/components/tools/daily-briefing-results.test.tsx \
  apps/marketing/src/components/tools/daily-briefing-tool.test.tsx \
  apps/marketing/src/i18n/daily-briefing-messages.test.ts \
  apps/marketing/src/lib/tools/tool-handoff.test.ts \
  apps/marketing/src/components/tools/quick-wins-tool.test.tsx \
  apps/marketing/src/components/tools/traffic-drop-tool.test.tsx \
  apps/marketing/src/components/tools/on-page-checker.test.tsx
pnpm --filter @sf/public-tools typecheck
pnpm --filter @sf/marketing typecheck
```

Expected: all focused tests pass; observation rows do not alter handoff
consumers or downstream auto-run behavior.

**Step 2: Run exact lint and patch hygiene**

```bash
git diff --name-only -z origin/main...HEAD -- '*.ts' '*.tsx' \
  | xargs -0 pnpm exec eslint
git diff --check origin/main...HEAD
git status --short --branch
```

**Step 3: Request two independent reviews**

Use `requesting-code-review` and assign separate read-only responsibilities:

- correctness/privacy: ordering, caps, evidence states, page attribution, and
  proof that observations cannot create actions, handoffs, persistence, or URL
  state;
- frontend: Artifact density, site-trend separation, table/a11y semantics,
  EN/ZH, dark/light, focus, and 390px no-overflow.

Reject suggestions that lower action thresholds, fabricate pages, or pad
actions. For each valid finding, add a failing regression first, apply the
smallest fix, and rerun Steps 1 and 2.

**Step 4: Run production-shaped repository gates**

```bash
pnpm --filter @sf/marketing build
pnpm secrets:scan
pnpm verify:docs
pnpm verify:authority
pnpm verify:spec:test
pnpm contracts:check
pnpm openapi:lint
pnpm deploy:check
pnpm test
```

Record exact totals. If `pnpm test` exposes an `origin/main` failure, prove the
failing file's HEAD/origin-main/working-tree blob identity and prove it is
outside `origin/main...HEAD`; never relabel a new failure as baseline.

**Step 5: Commit review-driven fixes only when needed**

```bash
git add <exact reviewed files>
git commit -m "fix(marketing): address Daily Briefing watchlist review"
```

Skip this commit when there is no valid finding.

### Task 4: PR, production deployment, and acceptance

**Files:** No planned source changes.

**Step 1: Freeze deployment identities before push**

Read `docs/INFRASTRUCTURE.md` and `docs/DEPLOYMENT.md`. Use the Vercel alias API,
not only project `targets.production`, to record:

- Marketing project, current `gengrowth.ai` alias deployment, immutable URL,
  READY/PROMOTED state, Git SHA, root directory, and production branch;
- Product project, current `app.gengrowth.ai` alias deployment and Git SHA.

**Step 2: Inspect and push the exact reviewed branch**

```bash
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git push -u origin fix/daily-briefing-observation-watchlist-20260825
```

Create a PR against `main` with exact gate totals and scope exclusions. State
that external ChatGPT Pro collaboration was not used because source-upload
authority was not granted; native read-only reviewers and Codex verification
were used instead.

**Step 3: Wait for required checks and merge normally**

- inspect every required GitHub check;
- merge only the reviewed head;
- do not force-push or bypass required checks;
- fetch `main` and record the merge SHA.

**Step 4: Verify Marketing production and Product isolation**

- identify the Marketing deployment built from the merge SHA;
- require READY before alias verification;
- confirm `gengrowth.ai` points to that immutable deployment;
- verify `/zh/tools/daily-search-briefing` and
  `/en/tools/daily-search-briefing` return 200;
- verify the unauthenticated API remains 401 with no-store behavior;
- prove `app.gengrowth.ai` still points to its pre-release Product deployment
  unless Product promotion was separately authorized.

**Step 5: Run browser acceptance without private GSC reads**

Verify both locales, pre-run previews, no console errors, keyboard focus,
table/section semantics, and 390px no horizontal overflow.

At action time, obtain explicit confirmation before spending shared quota or
making new private GSC reads. Once confirmed, run only the four named
properties once each, do not click downstream CTAs, and verify site-wide
trends, watchlist observations, strict changes/actions, exact quota decrement,
and console health.

**Step 6: Complete from current evidence only**

Report design/plan and implementation commits, PR and merge SHA, Marketing
immutable deployment and alias, preserved Product production identity, exact
gate totals, production browser result, private-run status, and remaining
limitations. Mark the goal complete only after the requested production state
is live and verified.
