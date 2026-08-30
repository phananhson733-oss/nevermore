# Content Brief Production QA Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the production crawl-excerpt 503 and close the Tools Hub accessible-name and mobile sign-in focus findings without changing public schemas, visual layout, or non-Marketing release surfaces.

**Architecture:** Align only crawl-derived string decoding with the producer's existing Unicode code-point unit, add an explicit localized name to the existing whole-card link, and let the shared sign-in dialog restore focus to an optional stable Header-owned target. Every change is driven by a failing regression and remains inside `apps/marketing` or `packages/public-tools`.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 16 App Router, Radix Dialog, Vitest 4, Playwright 1.61, pnpm 10.

---

### Task 1: Align crawl strings with code-point bounds

**Files:**
- Modify: `packages/public-tools/src/content-brief/parse-brief-shape.ts:102-110,400-415`
- Modify: `packages/public-tools/src/content-brief/parse-brief.test.ts`
- Modify: `apps/marketing/src/lib/tools/content-brief-crawl.test.ts`

**Step 1: Write the failing parser regression**

Add one shape-level test using a valid Brief fixture:

```ts
it("accepts crawl excerpt and heading caps measured in Unicode code points", () => {
  const brief = validContentBrief();
  const exact = "😀".repeat(CRAWL_EXCERPT_MAX_CHARS);
  brief.evidence.crawl.observed[0]!.excerpts[0]!.text = exact;
  const result = parseContentBriefShape(brief);
  expect(result.ok).toBe(true);
});
```

Add the fail-closed companion with `CRAWL_EXCERPT_MAX_CHARS + 1` code points and expect the exact excerpt path to be rejected. Cover an astral H2 or excerpt heading at its own cap if the fixture makes that a one-line mutation.

**Step 2: Run the parser test and verify RED**

Run:

```bash
corepack pnpm exec vitest run --project unit packages/public-tools/src/content-brief/parse-brief.test.ts
```

Expected: the exact-cap emoji test fails because current `text()` counts UTF-16 units and returns `invalid_request` at the crawl field.

**Step 3: Write the failing producer/consumer boundary regression**

Extend the crawl test with HTML containing a long astral excerpt. Assert the output contains exactly the configured number of code points, contains no lone surrogate, and is accepted by the crawl-specific shape decoder through a valid Brief mutation.

**Step 4: Verify the boundary test is RED for parser disagreement**

Run:

```bash
corepack pnpm exec vitest run --project unit apps/marketing/src/lib/tools/content-brief-crawl.test.ts packages/public-tools/src/content-brief/parse-brief.test.ts
```

Expected: producer assertions pass while exact shape acceptance fails.

**Step 5: Implement the minimal decoder**

Add a non-model decoder beside `text()`:

```ts
export function codePointText(max = FREE_TEXT_MAX_CHARS, min = 0): Decoder<string> {
  return (input, path) => {
    if (typeof input !== "string") return invalid(path);
    const length = [...input].length;
    return length >= min && length <= max ? ok(input) : invalid(path);
  };
}
```

Use it only for crawl strings produced by `boundChars`:

```ts
const crawlExcerpt = object({
  heading: codePointText(HEADING_MAX_CHARS),
  level: oneOf(HEADING_LEVELS),
  text: codePointText(CRAWL_EXCERPT_MAX_CHARS),
});

h2: array(codePointText(HEADING_MAX_CHARS), ...)
h3: array(codePointText(HEADING_MAX_CHARS), ...)
```

Do not change the shared `text()` decoder or any schema/fingerprint code.

**Step 6: Run GREEN verification**

Run the two focused test files, then the full Content Brief parser/crawl/assembly test set. Expected: all pass, with the over-cap companion still rejected.

**Step 7: Commit**

```bash
git add packages/public-tools/src/content-brief/parse-brief-shape.ts \
  packages/public-tools/src/content-brief/parse-brief.test.ts \
  apps/marketing/src/lib/tools/content-brief-crawl.test.ts
git commit -m "fix(marketing): align brief crawl character bounds"
```

### Task 2: Give every Tools Hub card a stable accessible name

**Files:**
- Modify: `apps/marketing/e2e/content-brief.spec.ts`
- Modify: `apps/marketing/src/components/tools/tool-card.tsx:38-40`

**Step 1: Write the failing browser regression**

In the existing Tools Hub test, keep the href/visible checks and add:

```ts
await expect(briefCard).toHaveAccessibleName("Content Brief Builder");
```

Add the localized ZH assertion if the same test already visits `/zh/tools`.

**Step 2: Run the exact E2E and verify RED**

From `apps/marketing`:

```bash
MARKETING_E2E_PORT=33160 corepack pnpm exec playwright test \
  e2e/content-brief.spec.ts --config=playwright.config.ts
```

Expected: accessible-name assertion fails while existing visual/href assertions pass.

**Step 3: Implement the minimum link label**

Change only the existing Link:

```tsx
<Link
  href={localePath(locale, `/tools/${slug}`)}
  aria-label={title}
  className="group block"
>
```

Do not alter the card layout or move the article.

**Step 4: Run GREEN verification**

Run the exact Content Brief E2E and the Tools Hub contract unit test. Expected: EN/ZH accessible-name, href, order, and visible content all pass.

**Step 5: Commit**

```bash
git add apps/marketing/e2e/content-brief.spec.ts \
  apps/marketing/src/components/tools/tool-card.tsx
git commit -m "fix(marketing): name public tool card links"
```

### Task 3: Restore focus after mobile Header sign-in

**Files:**
- Modify: `apps/marketing/src/components/auth/sign-in-dialog.tsx:37-76`
- Modify: `apps/marketing/src/components/layout/header.tsx`
- Modify: `apps/marketing/e2e/content-brief.spec.ts`
- Test if needed: `apps/marketing/src/components/auth/use-signed-in-listener.test.tsx`

**Step 1: Write the failing mobile focus regression**

Add a signed-out mobile E2E:

```ts
await page.setViewportSize({ width: 375, height: 812 });
await page.goto("/tools/content-brief");
const menu = page.getByRole("button", { name: "Open menu" });
await menu.click();
await page.getByRole("button", { name: "Sign in" }).click();
const dialog = page.getByRole("dialog", { name: "Sign in to GenGrowth" });
await expect(dialog).toBeVisible();
await dialog.getByRole("button", { name: "Close" }).click();
await expect(menu).toBeFocused();
```

Use the actual localized control names observed by the existing fixture. Add a characterization assertion that the real dialog has an accessible name and modal semantics; do not make cross-origin iframe Escape a required contract.

**Step 2: Run the exact E2E and verify RED**

Expected: close succeeds but focus is `BODY` or another non-menu element.

**Step 3: Add the optional focus target**

Extend `SignInDialog` with an optional `returnFocusRef`. Pass `onCloseAutoFocus` to `DialogContent`; when the target exists and remains connected, prevent default and call `focus()`.

In Header:

- Add a ref to the persistent mobile menu trigger.
- Record whether desktop or mobile sign-in opened the shared dialog.
- Supply the menu-trigger ref only for the mobile path.
- Preserve Radix default focus restoration for desktop and every other SignInDialog owner.

**Step 4: Run GREEN verification**

Run the exact E2E, Header/auth unit tests, and the Content Draft handoff tests. Expected: mobile close restores focus; desktop/tool behavior and signed-in reload handoff remain unchanged.

**Step 5: Commit**

```bash
git add apps/marketing/src/components/auth/sign-in-dialog.tsx \
  apps/marketing/src/components/layout/header.tsx \
  apps/marketing/e2e/content-brief.spec.ts \
  apps/marketing/src/components/auth/use-signed-in-listener.test.tsx
git commit -m "fix(marketing): restore mobile sign-in focus"
```

### Task 4: Run release gates and independent review

**Files:**
- Review: full branch diff against `origin/main`
- Update if evidence changes: `docs/plans/2026-08-30-content-brief-production-qa-remediation-design.md`

**Step 1: Run focused tests**

Run Brief parser/crawl/handler tests, Header/auth tests, Content Brief E2E, and Content Draft E2E.

**Step 2: Run package gates**

```bash
corepack pnpm --filter @sf/public-tools typecheck
corepack pnpm --filter @sf/marketing typecheck
corepack pnpm exec eslint -- <all changed TS/TSX files>
corepack pnpm --filter @sf/marketing build
corepack pnpm verify:public-tools-boundary
```

Report unrelated baseline failures separately and prove no changed file is involved.

**Step 3: Review the diff**

Run `git diff --check`, inspect every changed line, verify no generated output, secrets, environment changes, lockfile drift, Product code, Worker code, or migration files are present.

**Step 4: Request independent code review**

Provide the reviewer the base SHA, head SHA, design/plan, red-green evidence, and exact production findings. Fix every Critical/Important issue, rerun affected gates, and request follow-up review if the diff changes materially.

### Task 5: PR, merge, and Marketing-only release

**Step 1: Push and create PR**

Push `fix/content-brief-production-qa-20260830`, create a PR against `main`, and include test evidence, production issue paths, release boundary, and rollback note.

**Step 2: Verify PR and merge reviewed SHA**

Confirm PR files and checks match the reviewed head. Merge without force-push or history rewrite. Record merge commit and fresh `origin/main`.

**Step 3: Verify Marketing deployment**

Wait for `gengrowth-agents` production READY at the exact merge SHA. Verify aliases, EN/ZH routes, Hub AX names, anonymous 401 boundary, live runtime errors, and the Unicode crawl reproduction. Do not expose secret values.

**Step 4: Verify Product identity independently**

Record any `nevermore` Product candidate caused by the shared main push and prove whether `app.gengrowth.ai` retained its prior production identity or redeployed. Do not call it unchanged without evidence.

### Task 6: Production acceptance and QA baseline

**Step 1: Repeat production matrix**

Run keyword-only, GSC-only, Profile-only, and combined Briefs sequentially. Verify export, handoff, Draft generation, section rerun, EN/ZH/mobile, Hub accessibility, mobile focus, and no new error/fatal logs. Keep private rows/facts out of the report.

**Step 2: Prove the original failure is closed**

Use a safe input containing astral crawl text if reproducible without targeting a hostile site, or rely on the new exact boundary test plus zero self-check failures over the canary window. Never claim the production bug fixed from deployment identity alone.

**Step 3: Update QA artifacts**

Update the existing report and `baseline.json` with the new deployment/SHA, resolved issue states, health score, screenshots, and remaining low-severity caveats.

**Step 4: Final completion audit**

Check every requirement in this plan against current Git, PR, deployment, live route, browser, log, and QA artifact evidence. Mark the goal complete only when no required item remains.
