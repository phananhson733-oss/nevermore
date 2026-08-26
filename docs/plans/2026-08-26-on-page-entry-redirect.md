# On-Page Checker Entry Redirect Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop an On-Page SEO Checker run before the full crawl when its submitted URL resolves to a different canonical page, then show the safe destination as an actionable error.

**Architecture:** Add an opt-in same-subject entry policy to the shared public-preview crawler, map its typed redirect outcome through the SEO-audit and Agent boundaries as HTTP 422 plus a validated `Location` header, and render that destination only in the On-Page client. The site-wide SEO Audit, SEO Agent, Internal Link Audit, success payload, cache schema, Product App, Worker, database, and environment remain unchanged.

**Tech Stack:** TypeScript, Vitest, React 19, Next.js 16 App Router, next-intl, pnpm workspace packages.

---

### Task 1: Classify a path-changing entry redirect before crawling

**Files:**
- Modify: `packages/sources/src/crawl/public-preview.ts`
- Test: `packages/sources/src/crawl/public-preview.test.ts`

**Step 1: Write the failing tests**

Add tests that call `crawlPublicSitePreview()` with a new strict entry option and
an offline `entryResolver`:

```ts
it("rejects a strict entry that resolves to a different page before crawling", async () => {
  const fetcher = { fetch: vi.fn() } satisfies CrawlFetcher;

  await expect(
    crawlPublicSitePreview("https://acme.test/old", undefined, {
      requireSameEntrySubject: true,
      fetcher,
      entryResolver: async () =>
        entryResult("https://acme.test/old", "https://acme.test/?utm_source=test"),
    }),
  ).rejects.toMatchObject({
    name: "PublicPreviewTargetRedirectError",
    targetUrl: "https://acme.test/",
  });
  expect(fetcher.fetch).not.toHaveBeenCalled();
});
```

Also cover strict redirects that remain the same canonical subject: HTTP to
HTTPS, apex to `www`, slash normalization, and tracking-only query removal.

**Step 2: Run the test to verify RED**

Run:

```bash
pnpm exec vitest run --project unit packages/sources/src/crawl/public-preview.test.ts
```

Expected: FAIL because `requireSameEntrySubject` and
`PublicPreviewTargetRedirectError` do not exist.

**Step 3: Implement the minimal source behavior**

In `public-preview.ts`:

- add an exported `PublicPreviewTargetRedirectError` with a readonly
  `targetUrl`;
- add `requireSameEntrySubject?: boolean` to `PublicPreviewCrawlOptions`;
- canonicalize the final entry URL;
- rebase the submitted pathname and search onto the allowed final origin;
- compare canonical subject identities;
- when strict mode finds a different subject, throw the typed error before the
  crawl transport is constructed;
- keep the default option false so other public tools do not change.

**Step 4: Run the test to verify GREEN**

Run the focused command from Step 2. Expected: all tests PASS.

**Step 5: Commit**

```bash
git add packages/sources/src/crawl/public-preview.ts packages/sources/src/crawl/public-preview.test.ts
git commit -m "fix(sources): classify replaced page entries"
```

### Task 2: Map the typed outcome to an On-Page-only 422 response

**Files:**
- Modify: `packages/public-tools/src/seo-audit/scan.ts`
- Test: `packages/public-tools/src/seo-audit/scan.test.ts`
- Modify: `apps/marketing/src/lib/tools/seo-audit-handler.ts`
- Test: `apps/marketing/src/lib/tools/seo-audit-handler.test.ts`
- Modify: `apps/marketing/src/lib/agents/audit-handler.ts`
- Test: `apps/marketing/src/app/api/tools/on-page-seo-check/route.test.ts`

**Step 1: Write the failing public-tools test**

Add a `scanSeoAuditSite()` test whose crawler throws
`PublicPreviewTargetRedirectError("https://www.acme.test/")` and assert:

```ts
await expect(scanSeoAuditSite("https://acme.test/old", undefined, {
  requireSameEntrySubject: true,
  crawl,
})).rejects.toMatchObject({
  code: "target_redirected",
  redirectTarget: "https://www.acme.test/",
});
```

**Step 2: Verify RED**

```bash
pnpm exec vitest run --project unit packages/public-tools/src/seo-audit/scan.test.ts
```

Expected: FAIL because the scan error has no redirect code or destination.

**Step 3: Implement the public-tools mapping**

- extend `SeoAuditScanErrorCode` with `target_redirected`;
- carry `redirectTarget: string | null` on `SeoAuditScanError`;
- add `requireSameEntrySubject?: boolean` to `SeoAuditScanOptions`;
- pass it only to the production public-preview crawler;
- map `PublicPreviewTargetRedirectError` before the generic failure branch.

**Step 4: Write the failing Marketing handler tests**

Add buffered-handler tests proving:

- a `SeoAuditScanError("target_redirected", destination)` becomes HTTP 422,
  `{ error: { code: "target_redirected" } }`, and `Location: destination`;
- the normal SEO Audit handler does not enable strict entry matching;
- the On-Page dependency delegate does enable it.

**Step 5: Verify RED**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/seo-audit-handler.test.ts apps/marketing/src/app/api/tools/on-page-seo-check/route.test.ts
```

Expected: FAIL because the handler does not map or opt into the new outcome.

**Step 6: Implement the narrow handler path**

- add the new 422 status mapping;
- set `Location` only for the typed redirect outcome;
- add a strict scan option to the existing handler options/dependency call;
- override `ON_PAGE_CHECK_DEPENDENCIES.delegate` to enable that option;
- leave `DEFAULT_DEPENDENCIES.delegate` byte-for-byte equivalent for SEO Agent.

**Step 7: Verify GREEN and commit**

Run the focused commands from Steps 2 and 5. Expected: all PASS.

```bash
git add packages/public-tools/src/seo-audit/scan.ts packages/public-tools/src/seo-audit/scan.test.ts apps/marketing/src/lib/tools/seo-audit-handler.ts apps/marketing/src/lib/tools/seo-audit-handler.test.ts apps/marketing/src/lib/agents/audit-handler.ts apps/marketing/src/app/api/tools/on-page-seo-check/route.test.ts
git commit -m "fix(marketing): stop replaced on-page targets early"
```

### Task 3: Validate and forward the redirect destination across the Agent boundary

**Files:**
- Modify: `apps/marketing/src/lib/agents/audit-handler.ts`
- Test: `apps/marketing/src/lib/agents/audit-handler.test.ts`

**Step 1: Write failing boundary tests**

Cover all three cases:

1. `target_redirected` + allowed same-family `Location` returns 422 and forwards
   the destination;
2. `target_redirected` without `Location` becomes
   `audit_response_invalid`/502;
3. cross-domain, credential-bearing, malformed, or HTTPS-downgrade locations
   become `audit_response_invalid`/502.

Also assert ordinary upstream error responses never forward `Location`.

**Step 2: Verify RED**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/agents/audit-handler.test.ts
```

Expected: FAIL because `target_redirected` is not in the upstream allow-list and
`Location` is not validated or forwarded.

**Step 3: Implement the boundary guard**

- add `target_redirected: 422` to the stable upstream error map;
- normalize the submitted URL;
- require a bounded, absolute, credential-free HTTP(S) destination;
- require the existing allowed same-host/apex-`www` redirect relation;
- forward `Location` only for this code;
- fail closed to `audit_response_invalid` for every malformed combination.

**Step 4: Verify GREEN and commit**

Run the focused command from Step 2. Expected: all PASS.

```bash
git add apps/marketing/src/lib/agents/audit-handler.ts apps/marketing/src/lib/agents/audit-handler.test.ts
git commit -m "fix(marketing): guard on-page redirect destinations"
```

### Task 4: Render an actionable destination without auto-running it

**Files:**
- Modify: `apps/marketing/src/lib/on-page-checker/response-reading.ts`
- Test: `apps/marketing/src/components/tools/on-page-checker.test.tsx`
- Modify: `apps/marketing/src/components/tools/on-page-checker.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Test: `apps/marketing/src/i18n/messages.test.ts` if the current catalogue test requires an explicit key update

**Step 1: Write the failing client tests**

Add component tests that return a 422 response with
`error.code = "target_redirected"` and `Location`:

- the specific localized error renders rather than `unknown`;
- the destination URL is visible and linked;
- pressing “Use destination URL” replaces the form URL and returns the run to
  idle;
- the button does not issue a second fetch;
- an unsafe destination is not rendered or used.

**Step 2: Verify RED**

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/on-page-checker.test.tsx
```

Expected: FAIL because the code is unknown and the failed state carries no
destination.

**Step 3: Implement the client behavior**

- add `target_redirected` to the known crawl-error set;
- parse and validate `Location` in the pure response-reading module without
  importing server-only crawler code into the client bundle;
- carry `redirectTarget` only on the failed run state;
- render the destination and an explicit form-replacement button;
- never submit automatically;
- add direct English and Chinese copy.

**Step 4: Verify GREEN and commit**

Run the focused test plus the locale-completeness test. Expected: all PASS.

```bash
git add apps/marketing/src/lib/on-page-checker/response-reading.ts apps/marketing/src/components/tools/on-page-checker.tsx apps/marketing/src/components/tools/on-page-checker.test.tsx apps/marketing/src/i18n/messages/en.json apps/marketing/src/i18n/messages/zh.json apps/marketing/src/i18n/messages.test.ts
git commit -m "fix(marketing): explain redirected page checks"
```

### Task 5: Verify, review, and release

**Files:**
- Review all files changed since `origin/main`
- Update release metadata only if repository release tooling requires it

**Step 1: Run focused regression tests**

```bash
pnpm exec vitest run --project unit \
  packages/sources/src/crawl/public-preview.test.ts \
  packages/public-tools/src/seo-audit/scan.test.ts \
  apps/marketing/src/lib/tools/seo-audit-handler.test.ts \
  apps/marketing/src/lib/agents/audit-handler.test.ts \
  apps/marketing/src/app/api/tools/on-page-seo-check/route.test.ts \
  apps/marketing/src/components/tools/on-page-checker.test.tsx
```

Expected: all PASS.

**Step 2: Run package and repository gates**

```bash
pnpm --filter @sf/sources lint
pnpm --filter @sf/sources typecheck
pnpm --filter @sf/public-tools lint
pnpm --filter @sf/public-tools typecheck
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing typecheck
pnpm verify:docs
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
pnpm secrets:scan
pnpm build
git diff --check
```

Record the pre-existing `origin/main` unit failures separately:

- `apps/marketing/src/lib/blog-content.test.ts` expects 80 English posts but
  current main has 81;
- two Daily Briefing request-count assertions expect the pre-current read plan.

The task must not modify those files to manufacture a green full suite.

**Step 3: Run independent review**

Dispatch a read-only reviewer over `git diff origin/main...HEAD`, resolve every
confirmed P0/P1/P2 issue in scope, then rerun affected tests.

**Step 4: Ship and deploy**

- inspect the final diff and exact remote;
- push the feature branch without force;
- create/update a PR and wait for checks;
- merge only the reviewed SHA;
- wait for Marketing project `gengrowth-agents` to reach READY on the merge SHA;
- verify `/tools/on-page-seo-check` and `/zh/tools/on-page-seo-check`, live bundle
  copy/code, and build/runtime error logs;
- use an authenticated browser canary for the exact redirect case without
  issuing a paid SERP lookup after the server rejects it;
- independently inspect the Product project `nevermore` candidate, production
  SHA, aliases, and `app.gengrowth.ai` health before calling it unchanged.

**Step 5: Report evidence**

Report Git commit, PR/merge SHA, Marketing deployment ID/SHA/aliases, live
behavior, Product candidate and retained/redeployed identity, every command run,
the three unrelated baseline failures, and any unverified production exception.
