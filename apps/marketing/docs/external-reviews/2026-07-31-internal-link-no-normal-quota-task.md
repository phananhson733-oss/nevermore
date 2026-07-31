# ChatGPT Pro Engineering Task — Internal-Link Audit Without Normal-Use Quotas

> Historical review input: this is the exact task sent for the immutable
> `c89374c` baseline and pre-integration candidate. While the review was in
> progress, `origin/main` independently introduced a hardened shared public
> crawler in `7b315f6`. The final integration therefore preserves that newer
> shared security design instead of the dedicated-profile proposal below.
> Final behavior and verification are documented in the companion review and
> release record.

## Role and access boundary

Act as an external senior engineer reviewing a bounded source package. You do
not have access to the local repository, private Git history, Vercel, Supabase,
production logs, browser sessions, environment variables, or real user data.
Do not claim that you ran, deployed, migrated, or production-verified anything
outside the uploaded package.

Return a precise engineering review and, where useful, a minimal unified diff
or complete replacement files. Do not commit, push, create a PR, deploy, change
production configuration, migrate a database, or operate on real users.

## Background

GenGrowth exposes a free, anonymous internal-link audit at
`gengrowth.ai/{locale}/tools/internal-link-audit`. The first real implementation
hard-coded two customer-visible limits that the product owner did not request:

- two scans per ten minutes per IP;
- a fixed twenty-five-page crawl allowance and depth-four copy.

The owner has now explicitly approved removing normal-use quotas. This does not
authorize an unbounded or unsafe network crawler. The product must retain
SSRF/private-network protections, same-origin enforcement, robots handling,
manual redirect validation, response and aggregate decoded-byte limits,
wall-clock bounds, one in-flight scan per network identity, and a high internal
abuse fuse.

## Baseline and repository facts

- Repository: `phananhson733-oss/nevermore`
- Baseline commit: `c89374ce1ab0c6ba12eecd587ef5dd9b4784e6d4`
- Customer-facing scope: `gengrowth.ai` marketing site only
- Out of scope: `app.gengrowth.ai`, worker, database, migrations, Supabase
  configuration, Vercel configuration, real user data
- Runtime: Node 24, pnpm 10.32.1, Next.js 16.2, React 19, TypeScript strict
- Existing shared crawler: `packages/sources/src/crawl/engine.ts`
- The 25-page `PUBLIC_PREVIEW_CRAWL_BUDGET` is also used by the separate SEO
  audit. The internal-link change must not silently alter the SEO audit.
- The crawler already supports stop reasons for `max_requests`,
  `max_duration`, `max_total_bytes`, `max_depth`, and `max_urls`.

## Required product behavior

1. A normal user can run more than two sequential internal-link audits in ten
   minutes from one IP. Do not expose a remaining-quota header or advertise a
   normal-use scan allowance.
2. Keep one in-flight internal-link scan per IP/isolate. A duplicate in-flight
   request returns `scan_in_progress` and does not consume the abuse fuse.
3. Keep a high-threshold internal abuse fuse after the in-flight gate. It may
   return `rate_limited` with `Retry-After`, but must not act as a normal user
   quota.
4. Remove the fixed `/25` metric and the customer-visible claims “up to 25
   pages”, “depth 4”, and “public preview” from the internal-link tool and its
   current methodology content.
5. Preserve an honest synchronous boundary: request count, wall-clock time,
   decoded bytes, redirects, and concurrency stop the scan when needed.
6. A partial report must show the actual number of collected pages and a
   localized, truthful resource stop reason. It must not claim complete-site
   coverage.
7. Give the internal-link audit a dedicated trusted crawl profile so the
   existing SEO audit remains unchanged.
8. Consider removing `maxPages` from `InternalLinkAuditReport` and bumping the
   internal-link schema version because a fixed customer page allowance is no
   longer part of the result contract.
9. Keep static-HTML, same-origin, robots, transient/no-persistence, and
   JavaScript-rendering limitations visible and truthful.
10. Keep the submit button disabled while a scan is running. When the
    exceptional abuse fuse fires, use the `Retry-After` header to display a
    useful wait time.

## Files to inspect

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `package.json`
- `pnpm-lock.yaml`
- `apps/marketing/docs/plans/2026-07-31-internal-link-audit-no-normal-quota.md`
- `apps/marketing/src/lib/tools/internal-link-audit-handler.ts`
- `apps/marketing/src/lib/tools/internal-link-audit-handler.test.ts`
- `apps/marketing/src/lib/tools/public-tool-request.ts`
- `apps/marketing/src/lib/rate-limit.ts`
- `apps/marketing/src/components/tools/internal-link-audit-tool.tsx`
- `apps/marketing/src/components/tools/internal-link-audit-tool.test.ts`
- `apps/marketing/src/components/tools/internal-link-audit-result-copy.ts`
- `apps/marketing/src/components/tools/internal-link-audit-content.ts`
- `apps/marketing/e2e/internal-link-audit.spec.ts`
- `apps/marketing/src/app/api/tools/internal-link-audit/route.ts`
- `packages/sources/src/crawl/public-preview.ts`
- `packages/sources/src/crawl/public-preview.test.ts`
- `packages/sources/src/crawl/engine.ts`
- `packages/sources/src/crawl/types.ts`
- `packages/sources/src/index.ts`
- `packages/public-tools/src/internal-link-audit/*`
- `packages/public-tools/src/contract.ts`
- `apps/marketing/content/blog/en/bounded-internal-link-crawl.md`
- `apps/marketing/content/blog/zh/bounded-internal-link-crawl.md`

## Required deliverables

1. Architecture and security assessment of the proposed split profile,
   in-flight ordering, high abuse fuse, payload contract, and UI copy.
2. A concrete minimal patch or exact file-level changes.
3. Tests covering:
   - no two-per-ten-minute normal quota;
   - duplicate in-flight requests do not touch the abuse counter;
   - exceptional abuse rejection and `Retry-After`;
   - no `/25` metric or fixed-quota copy;
   - actual page count and partial resource reason;
   - the separate SEO/public preview profile remains unchanged;
   - schema/payload behavior;
   - mobile no-overflow behavior.
4. A severity-ranked issue list with file paths and evidence.
5. A final verdict: `PASS`, `PASS WITH NON-BLOCKING ISSUES`, or `FAIL`.
6. Exact commands you actually ran inside the uploaded package, with results.

## Must-run tests

At minimum, if the package runtime permits:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/tools/internal-link-audit-handler.test.ts \
  apps/marketing/src/components/tools/internal-link-audit-tool.test.ts \
  packages/sources/src/crawl/public-preview.test.ts \
  packages/public-tools/src/internal-link-audit/scan.test.ts

pnpm lint
pnpm typecheck
pnpm --filter @sf/marketing build
pnpm --filter @sf/marketing test:e2e -- internal-link-audit.spec.ts
```

If dependencies, browser binaries, or the package subset prevent a command,
state that explicitly. Do not report static inspection as an executed test.

## Acceptance criteria

- No normal-use two-scan quota remains.
- One in-flight scan remains and runs before abuse accounting.
- A high internal abuse fuse remains as defense in depth.
- No success response exposes remaining quota.
- Internal-link audit no longer advertises or renders a fixed 25-page
  allowance.
- SEO audit behavior remains unchanged.
- All partial coverage is explicitly limited and evidence-honest.
- No SSRF, redirect, byte, request, wall-clock, robots, or same-origin
  protection is weakened.
- No new dependency, lockfile drift, database change, app-site change, worker
  change, production configuration change, or secret.
- No P0/P1 defect remains in the candidate.

## Prohibited shortcuts and claims

- Do not remove SSRF/private-IP/metadata defenses.
- Do not make the crawler caller-tunable through untrusted request fields.
- Do not convert the endpoint into an unbounded crawl.
- Do not change the separate SEO audit merely because it shares a source
  wrapper.
- Do not delete tests, weaken assertions, or change expected values solely to
  make a suite green.
- Do not claim a mock E2E is production verification.
- Do not claim deployment, database migration, Vercel validation, or real
  internet crawling.
