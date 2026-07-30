# Final acceptance: free bounded site-wide SEO audit, audit-only

Date: 2026-07-30 (Asia/Shanghai)

Status: **accepted as a local launch candidate; not committed, pushed, or
deployed**

## 1. Decision

The final local candidate meets the product boundary:

- it performs a real, same-origin, multi-page crawl;
- the anonymous free crawl has fixed code-owned limits;
- its result contract and result component contain only coverage, audit
  records, observed values, evidence URLs, affected counts, limitations, and
  inspected-page inventory;
- it does not return or render score, grade, health evaluation, severity,
  priority, diagnosis, recommendation, remediation, action plan, or repair
  guidance;
- it does not use demo audit data;
- it does not connect GSC, GA4, CrUX, PageSpeed, backlink, ranking, login,
  persistence, scheduling, database, or the authenticated app workflow;
- it explicitly represents partial coverage and static-HTML evidence limits.

This is an accepted **local candidate**, not a claim that the current
`gengrowth.ai/zh/tools/seo-audit` production deployment has changed.

## 2. Repository and source baselines

### Original user worktree

- Repository: `phananhson733-oss/nevermore`
- Original path: `/Users/wzb/Code/nevermore/signalframe-mvp-app`
- Original branch:
  `codex/pre-v03-local-preservation-20260727`
- Original user worktree was already dirty and was not modified, cleaned,
  reset, or overwritten.

### Final isolated candidate

- Branch: `codex/seo-audit-free-sitewide-v2`
- Final upstream baseline:
  `4860f3e4217255b7e72b0c0d4c2d1ad01edf3121`
- Baseline subject:
  `fix(marketing): clarify internal link hierarchy`
- Final candidate contains only task-related uncommitted changes on top of that
  baseline.

During implementation `origin/main` advanced twice. The candidate was migrated
to each newer baseline, and the latest upstream internal-link changes were
preserved.

## 3. ChatGPT Pro collaboration

- Conversation:
  <https://chatgpt.com/c/6a6b6136-848c-83e8-8292-55fef443d987>
- Source package baseline:
  `6e32a772454607c5ffed191cf001396b9c2db3bd`
- Existing P04 source included in the package:
  `91e68820a5fd3edd568670069fe26d83bdbcab8b`
- Uploaded ZIP:
  `nevermore-seo-audit-sitewide-pro-20260730.zip`
- ZIP size: 1,283,353 bytes
- ZIP SHA-256:
  `ccf4a6c224d62c74578bbdeee7dfe8e2c84f03d9a5a5ae1df90f6cb502e98cbb`
- ZIP central-directory entries: 504
- ZIP integrity: `unzip -t` passed.

The package excluded `.git`, `node_modules`, build output, caches, databases,
logs, runtime/browser state, `.env*`, credentials, cookies, sessions, keys, and
unrelated application source.

Secret scanning before upload:

- repository `scripts/secrets-scan.mjs`: passed;
- sensitive filename scan: no matches;
- bounded signature scan for private-key blocks, AWS, GitHub, OpenAI, and Slack
  token patterns: no matches;
- `gitleaks`, `trufflehog`, and `detect-secrets` were unavailable, so this was
  not a full entropy or Git-history scan.

## 4. Why the ChatGPT Pro patch was rejected

ChatGPT Pro's final rendered report was useful as a design and risk review, but
its code artifact was not acceptable:

1. Its patch was generated before its last source changes and was explicitly
   reported as stale.
2. Its candidate had unresolved type exports and did not pass typecheck or
   build.
3. It used `detected / not_detected` terminology that the reviewer itself
   considered too close to diagnosis.
4. It included an unrelated internal-link file.
5. It did not run the repository-native lint, typecheck, Vitest, build,
   Playwright, or secrets gates.
6. Its patch was sandbox-local and not downloadable, so its reported size and
   SHA-256 could not be independently verified.

The external patch was not downloaded, applied, or used as the final source.

## 5. How the final local candidate resolves those defects

- Record states are `observed`, `not_observed`, and `unverified`.
- There are no `SeoAuditRecordLimitation`,
  `SeoAuditRobotsLimitation`, or `SeoAuditSitemapLimitation` cross-package
  imports; the final type graph passes the repository TypeScript gate.
- No internal-link audit file is modified by the final SEO-audit diff.
- The engine's existing code-owned `maxRequests=60` contract remains
  authoritative. The public report exposes the fixed request cap but does not
  invent an actual request count when the accepted raw projection does not
  provide one.
- All final audit records are direct factual conditions measured from the
  bounded crawl. Uncollected link targets are never classified as broken.
- Non-2xx and non-HTML pages do not get a fabricated indexability state.
- Submitted deep paths remain the crawl seed and remain the displayed target
  URL.
- Duplicate title and description records are scoped to inspected HTML pages.
- Sitemap pages without an observed inlink are explicitly limited to the
  bounded static-HTML evidence set.

## 6. Final implementation

### Data contract and aggregation

`packages/public-tools/src/seo-audit` now defines
`seo_audit.sitewide.v2` with scope
`bounded_same_origin_static_html_audit`.

The old score/check model was removed. The report contains:

- scan target and timestamp;
- explicit coverage, free limits, stop reason, and counters;
- robots and sitemap resource observations;
- 17 neutral audit record types;
- page-level response, redirect, content type, static index directive,
  canonical, title, description, H1, heading count, word count, observed
  inlinks/outlinks, sitemap membership, and JSON-LD facts.

The audit records cover:

- robots and sitemap resource observation;
- non-2xx final response;
- redirect chain;
- final HTTP URL;
- static noindex directive;
- missing/different canonical;
- missing/duplicate title;
- missing/duplicate meta description;
- missing/multiple H1;
- sitemap-listed page with no observed static inlink;
- collected internal link target with 4xx/5xx response;
- JSON-LD parse error.

### Crawl integration and safety

The SEO audit calls the existing public preview crawler instead of the old
single-page scanner.

Fixed public limits:

- maximum pages: 25;
- maximum depth: 4;
- maximum requests: 60, including robots, sitemap, pages, and redirects;
- maximum wall time: 40 seconds;
- maximum redirects: 5;
- maximum decoded body: 1 MiB;
- maximum total decoded bytes: 12 MiB;
- per-host concurrency: 2;
- minimum host launch delay: 300 ms.

The submitted path is retained as the seed. URL normalization strips fragments,
rejects credentials/ports/private or reserved targets, and the shared crawl
transport retains SSRF, DNS rebinding, manual redirect, DNS/IP pinning, body,
byte, timeout, and robots boundaries.

The route remains Node runtime, `maxDuration=60`, no-store, five requests per
ten minutes per IP, and one in-flight SEO audit per IP.

### Result UI

The score/health-map component was deleted and replaced with:

1. explicit crawl coverage and fixed free limits;
2. expandable factual audit records with observed values and evidence URLs;
3. an inspectable page inventory.

The result component contains no score, health, severity, priority, diagnosis,
recommendation, remediation, action plan, or “what to fix” section. It follows
the existing GenGrowth dark marketing-tool visual language and has responsive
overflow containment for long URLs and the wide page table.

### Localization and documentation

- Chinese and English `tools.seoAudit` catalogs were rewritten for the V2
  audit-only contract.
- A catalog parity/evidence-key test was added.
- The product/contract boundary is documented in
  `docs/plans/2026-07-30-public-tools-seo-audit-sitewide-audit-only-spec.md`.

## 7. Final changed file set

Task implementation:

- `apps/marketing/e2e/seo-audit.spec.ts`
- `apps/marketing/src/app/[locale]/tools/seo-audit/page.tsx`
- `apps/marketing/src/app/api/tools/seo-audit/route.ts`
- `apps/marketing/src/components/tools/seo-audit-health-map.tsx` (deleted)
- `apps/marketing/src/components/tools/seo-audit-results.tsx` (added)
- `apps/marketing/src/components/tools/seo-audit-tool.tsx`
- `apps/marketing/src/i18n/messages.test.ts` (added)
- `apps/marketing/src/i18n/messages/en.json`
- `apps/marketing/src/i18n/messages/zh.json`
- `apps/marketing/src/lib/tools/seo-audit-handler.test.ts`
- `apps/marketing/src/lib/tools/seo-audit-handler.ts`
- `packages/public-tools/src/seo-audit/checks.ts` (deleted)
- `packages/public-tools/src/seo-audit/index.ts`
- `packages/public-tools/src/seo-audit/model.test.ts`
- `packages/public-tools/src/seo-audit/model.ts`
- `packages/public-tools/src/seo-audit/scan.test.ts`
- `packages/public-tools/src/seo-audit/scan.ts`
- `packages/public-tools/src/seo-audit/types.ts`
- `packages/sources/src/crawl/public-preview.test.ts`
- `packages/sources/src/crawl/public-preview.ts`
- `docs/plans/2026-07-30-public-tools-seo-audit-sitewide-audit-only-spec.md`

Persistent review evidence:

- `docs/external-reviews/2026-07-30-seo-audit-sitewide-chatgpt-pro-rendered-response.md`
- this acceptance report.

## 8. Independent verification

### Dependency install

```text
pnpm install --frozen-lockfile --offline
PASS
```

No dependency or lockfile changes were introduced.

### Repository gates on final `4860f3e` baseline

```text
pnpm lint
PASS

pnpm typecheck
PASS

pnpm test
PASS — 495 test files, 6,024 tests

pnpm secrets:scan
PASS — repository scan plus 4 test files / 75 redaction tests

pnpm build
PASS — marketing and web production builds
```

The marketing build generated all 27 static pages and included both
`/[locale]/tools/seo-audit` and `/api/tools/seo-audit`.

### Relevant browser E2E

```text
pnpm --filter @sf/marketing test:e2e -- e2e/seo-audit.spec.ts
PASS — 6 tests
```

The test covers:

- input to API response rendering;
- bilingual site-wide audit-only shell;
- multi-page result rendering;
- partial coverage;
- evidence and page inventory;
- absence of recommendation, health score, and “what to fix” result content;
- long-URL containment at mobile width;
- malformed/private input rejection.

### Documentation and specification checks

```text
pnpm verify:docs
PASS — 10 tests

pnpm verify:spec
FAIL — pre-existing origin/main vendor-manifest drift
```

The specification verifier reports:

```text
vendor entry 10 hash drift for packages/sources/src/crawl/engine.ts:
expected a5a7c6c204dffa4625a7574346ced3e177a245e319bb75a5a944d3527f5270da
found    826532f7d88e4894eeaeeea5dbf0b477275e74576027511306acae9b6842863b
```

This is not caused by the SEO-audit candidate:

- `git diff --exit-code origin/main -- packages/sources/src/crawl/engine.ts`
  returns 0;
- the candidate file and the `origin/main` blob both have SHA-256
  `826532f7d88e4894eeaeeea5dbf0b477275e74576027511306acae9b6842863b`;
- a clean `git archive origin/main` reproduces the same vendor-manifest
  mismatch.

The unrelated vendor manifest was not changed as part of this task.

### Real live-network scan from the local production build

A locally built marketing API scanned the public URL
`https://gengrowth.ai/zh`.

This was a live network crawl from a local production build, **not** a request
to an updated production deployment.

Observed result:

- HTTP 200;
- elapsed time: 35.014887 seconds;
- response schema: `seo_audit.sitewide.v2`;
- scope: `bounded_same_origin_static_html_audit`;
- submitted target preserved: `https://gengrowth.ai/zh`;
- availability: `partial`;
- pages inspected: 25 / 25;
- maximum depth: 4;
- maximum requests: 60;
- observed internal links: 449;
- observed sitemap URLs: 171;
- stop reason: `max_urls`;
- skipped / blocked / disallowed / errored URLs: 0 / 0 / 0 / 0;
- audit records: 17;
- page inventory rows: 25;
- forbidden score/advice contract keys: none.

Evidence files:

- response body:
  - size: 25,387 bytes;
  - SHA-256:
    `b99603d32d1c19e8031c8bcc20b007dcdfc69a0669dafdf660568a3eb6aa420d`;
- response headers:
  - size: 553 bytes;
  - SHA-256:
    `fcdfd91d3225d4b2ce8d16f009f00be90662876873bf49fa7bb8b5c0c0dadee1`.

The live-network scan was executed before the final upstream-only
internal-link commit was rebased. The SEO-audit diff was unchanged across that
migration, and the full repository gates plus relevant E2E were rerun on the
final baseline.

## 9. Not executed or not claimed

- No production deployment was performed or validated.
- No commit, push, PR, or release was created.
- No database integration or migration test was run because this change does
  not access or modify a database.
- The full repository Playwright suite was not run; the task-specific marketing
  SEO-audit suite was run.
- No authenticated `apps/web` workflow was exercised for this public tool.
- No GSC, GA4, CrUX, PageSpeed, backlink, traffic, ranking, rendering, or
  mobile-performance provider was called.
- The crawler inspects static HTTP responses. It does not claim
  JavaScript-rendered completeness.
- A 25-page free scan is bounded and may be partial; it is not an exhaustive
  inventory of a large site.
- The source package scan was bounded signature/filename scanning, not full
  entropy or Git-history secret analysis.
- `pnpm verify:spec` remains red because the latest upstream baseline's vendor
  manifest does not match its own unmodified crawl engine. This task does not
  repair that unrelated baseline inconsistency.

## 10. External-state and permission record

- Original user changes were preserved.
- No database was accessed or migrated.
- No production configuration was changed.
- No production feature was enabled.
- No real user data was read or modified.
- No email, message, or external notification was sent.
- Git state is local uncommitted changes on the isolated candidate branch.
- Nothing was committed, pushed, deployed, or released.
