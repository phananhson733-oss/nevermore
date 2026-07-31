# Internal Link Audit Without Normal-Use Quotas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the customer-facing two-scans-per-ten-minutes quota and fixed 25-page allowance from the GenGrowth internal-link audit while preserving high-threshold abuse protection, one-scan-at-a-time behavior, SSRF defenses, and bounded synchronous execution.

**Architecture:** Keep the existing anonymous synchronous Next.js route and the shared, SSRF-safe public-tool crawl wrapper. Use the hardened shared synchronous profile already present on the final integration baseline, including canonical same-host/apex-`www` entry resolution; make request count, wall-clock time, decoded bytes, redirects, concurrency, and host pacing the effective stopping boundaries. Retain a high internal abuse fuse after the shared one-in-flight crawl gate, but remove quota headers and customer-facing quota language.

**Tech Stack:** TypeScript, Next.js Route Handlers, React 19, Vitest, Playwright, pnpm monorepo.

---

### Task 1: Lock the API behavior with failing tests

**Files:**
- Modify: `apps/marketing/src/lib/tools/internal-link-audit-handler.test.ts`
- Modify: `apps/marketing/e2e/internal-link-audit.spec.ts`

**Step 1: Write failing route tests**

- Assert the in-flight gate runs before the abuse fuse and a duplicate request does not call the abuse counter.
- Assert ordinary successful requests use a high internal abuse threshold rather than a normal-use quota.
- Assert successful responses do not expose `X-RateLimit-Remaining`.
- Keep a test for the exceptional `rate_limited` response and `Retry-After`.

**Step 2: Write failing browser tests**

- Change the normal partial fixture from `max_urls` to a request/time resource boundary.
- Assert the collected-page metric renders an actual count without `/25`.
- Assert the page no longer advertises `25 pages`, `depth 4`, or a public-preview quota.
- Assert an exceptional abuse response displays its retry time.

**Step 3: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/internal-link-audit-handler.test.ts apps/marketing/src/components/tools/internal-link-audit-tool.test.ts
```

Expected: FAIL because the handler still applies the two-request quota before the in-flight gate and the UI still renders `/25`.

### Task 2: Remove the internal-link product allowance without bypassing the guarded shared crawler

**Files:**
- Modify: `packages/public-tools/src/internal-link-audit/scan.ts`
- Modify: `packages/public-tools/src/internal-link-audit/scan.test.ts`
- Modify: `packages/public-tools/src/internal-link-audit/types.ts`

**Step 1: Write failing payload tests**

- Assert the internal-link payload no longer exposes `maxPages`.
- Assert the schema version is bumped to `internal_link_audit.v2`.
- Assert all pages returned by the trusted shared wrapper are modeled rather than sliced to a customer-visible allowance.

**Step 2: Run profile tests to verify they fail**

Run:

```bash
pnpm exec vitest run --project unit packages/public-tools/src/internal-link-audit/scan.test.ts
```

Expected: FAIL because the payload still exposes and applies the fixed page allowance.

**Step 3: Use the hardened shared synchronous profile**

- Keep `scanInternalLinkAuditSite` on `crawlPublicSitePreview`; do not normalize and enter the crawl engine through a second wrapper.
- Preserve canonical same-host/apex-`www` entry validation, HTTPS downgrade blocking, SSRF/private-network checks, user agent, redirects, byte limits, request limit, concurrency, pacing, and wall-clock controls.
- Treat the shared profile's URL/depth/request/time/byte values as server execution boundaries, not account, pricing, or normal-use quotas.

**Step 4: Remove the customer page allowance from the payload**

- Remove `maxPages` from `InternalLinkAuditReport`.
- Bump the internal-link schema to `internal_link_audit.v2`.
- Keep actual `pagesCrawled`, stop reason, and limitation facts.

**Step 5: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run --project unit packages/public-tools/src/internal-link-audit/scan.test.ts
```

Expected: PASS.

### Task 3: Remove the normal-use quota while retaining abuse protection

**Files:**
- Modify: `apps/marketing/src/lib/tools/internal-link-audit-handler.ts`
- Modify: `apps/marketing/src/lib/tools/internal-link-audit-handler.test.ts`

**Step 1: Implement gate ordering**

- Acquire the one-in-flight slot before touching the abuse counter.
- Return `scan_in_progress` with `Retry-After: 5` for duplicates.
- Apply a high internal abuse fuse only after acquiring the slot.
- Do not expose remaining-quota headers on successful or duplicate requests.
- Always release the slot, including when the abuse fuse rejects the request.

**Step 2: Run route tests**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/tools/internal-link-audit-handler.test.ts
```

Expected: PASS.

### Task 4: Update customer-visible behavior and copy

**Files:**
- Modify: `apps/marketing/src/components/tools/internal-link-audit-tool.tsx`
- Modify: `apps/marketing/src/components/tools/internal-link-audit-result-copy.ts`
- Modify: `apps/marketing/src/components/tools/internal-link-audit-tool.test.ts`
- Modify: `apps/marketing/src/components/tools/internal-link-audit-content.ts`
- Modify: `apps/marketing/e2e/internal-link-audit.spec.ts`
- Modify: `apps/marketing/content/blog/en/bounded-internal-link-crawl.md`
- Modify: `apps/marketing/content/blog/zh/bounded-internal-link-crawl.md`

**Step 1: Update the result model and metric**

- Render the actual collected page count only.
- Use generic, truthful partial-coverage wording for time/request/byte/depth boundaries.
- Do not describe a fixed page allowance.

**Step 2: Update the form and long-form content**

- Replace “public preview” and fixed `25 / 4 / 40` quota wording with “free online audit” and truthful dynamic processing-boundary wording.
- Keep static-HTML, same-origin, robots, transient processing, and partial-coverage disclosures.
- Update only the internal-link-specific methodology article in this commit.

**Step 3: Show exceptional retry timing**

- Parse a valid `Retry-After` response value.
- Tell the user how many seconds or minutes remain only when the high abuse fuse is reached.
- Keep the submit button disabled while a request is running.

**Step 4: Run component and E2E tests**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/internal-link-audit-tool.test.ts
pnpm --filter @sf/marketing test:e2e -- internal-link-audit.spec.ts
```

Expected: PASS.

### Task 5: External review and independent release gates

**Files:**
- Create: `apps/marketing/docs/external-reviews/2026-07-31-internal-link-no-normal-quota-task.md`
- Create: `apps/marketing/docs/external-reviews/2026-07-31-internal-link-no-normal-quota-review.md`
- Create: `apps/marketing/docs/external-reviews/2026-07-31-internal-link-no-normal-quota-package-record.md`
- Persist external archive outside the deployable repository at `/Users/wzb/Documents/gengrowth-tools/artifacts/external-review/2026-07-31-internal-link-no-normal-quota.zip`

**Step 1: Package the minimum sufficient source**

- Exclude credentials, environment files, runtime state, build output, caches, databases, browser state, historical packages, and unrelated product code.
- Run repository and package-level secret scans.
- Record baseline commit, dirty state, file count, byte size, and SHA-256.

**Step 2: Send the acceptance task to a dedicated ChatGPT Pro conversation**

- Require an architecture/security review, patch suggestions, and explicit verdict.
- Prohibit commit, push, deployment, migration, production access claims, or real-user operations.

**Step 3: Independently review and correct**

- Apply only changes independently supported by source and tests.
- Return concrete failures to the same conversation and repeat until no P0/P1 defects remain.

**Step 4: Run release gates**

Run at minimum:

```bash
pnpm secrets:scan
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @sf/marketing build
pnpm --filter @sf/marketing test:e2e -- internal-link-audit.spec.ts
pnpm deploy:check
git diff --check
```

Expected: all pass. Database and worker gates are not applicable because no database, worker, authority, or app contract is changed.

### Task 6: Commit, push, deploy, and verify production

**Files:**
- Review all changed files from Tasks 1–5.

**Step 1: Inspect the final diff and release scope**

- Confirm only `apps/marketing`, internal-link files in `packages/public-tools`, and approved review evidence changed.
- Confirm no `apps/web`, worker, database, migration, or production configuration changes.

**Step 2: Commit and push**

```bash
git add <reviewed files>
git commit -m "fix(marketing): remove internal link normal-use quotas"
git push origin HEAD:main
```

Expected: the immutable commit is present on `origin/main`.

**Step 3: Verify the marketing deployment**

- Wait for the Vercel marketing production deployment bound to the exact commit.
- Confirm `gengrowth.ai` aliases are attached and the app deployment is skipped/cancelled.
- Confirm no runtime errors or 5xx.

**Step 4: Production smoke**

- Submit more than two sequential normal scans from the same browser/network where practical and confirm no normal-use 429.
- Confirm concurrent duplicate protection remains.
- Confirm the page does not advertise `/25`, `2 per 10 minutes`, or public-preview quotas.
- Confirm a real partial result reports its actual resource stop reason and actual collected count.
