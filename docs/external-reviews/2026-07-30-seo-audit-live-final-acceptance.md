# P04 SEO Audit live final acceptance

- **Accepted at:** 2026-07-30 22:08 CST
- **Source branch / code commit:** `codex/seo-audit-live-v11` / `91e68820a5fd3edd568670069fe26d83bdbcab8b`
- **Production deployment:** `dpl_8SRRf7s2LD1KRPKXfc3FyDALhYcn`
- **Public URL:** `https://gengrowth.ai/en/tools/seo-audit`

## Why this release was needed

The first browser acceptance found that the production aliases were serving
`dpl_ejygapFav7iuLsryKadUReTW5dc7`, which exposed the earlier `1.0.0`
SEO Audit response: 17 checks, the `Measured homepage health` presentation,
and an `internal_links` rule that belongs to the separate P02 tool.

The V1.1 P04 requirements were integrated onto the then-current production
baseline in an isolated worktree instead of promoting the older preview over
unrelated mainline work. The release also fixes the missing English and Chinese
translation for the `scan_complete` evidence label and adds a regression test
that checks every SEO Audit evidence label in both catalogs.

## Production browser acceptance

A new Chrome tab loaded the public URL, submitted `https://www.gengrowth.ai/`,
and completed a live public-response scan. The rendered result showed:

- `SINGLE-PAGE STATIC SIGNAL REPORT` and `1 PUBLIC PAGE · NO GSC · NO CRAWL`;
- a `SINGLE-PAGE STATIC SIGNAL SCORE` of **85 / 100**;
- **95% measurement coverage**, **18 / 19 checks**, and `site coverage: 1 URL`;
- the required **01 Observation → 02 Diagnosis → 03 Recommendation → 04 Artifact** sequence;
- three evidence-backed priorities: canonical alignment, redirect path, and
  security header presence;
- the five signal modules, 8 FAQ items, a related-tools transition, related
  article, and product CTA.

The fresh-tab browser console contained no errors or warnings after the scan.

## Real-data cross-check

The public tool API was called directly after deployment with the same target.
It returned HTTP 200 with:

```text
schemaVersion: 1.1.0
scope: single_raw_page_and_standard_support_files
persistence: none
score: 85
coveragePercent: 95
measuredChecks / totalChecks: 18 / 19
```

Its check IDs include `viewport`, `meta_refresh`, and `security_headers`; it
does not include `internal_links`.

Independent stateless reads of the submitted public URL found a 307 redirect
to `/en`, a final 200 response, canonical URL `https://gengrowth.ai/en`, and
three of the four deliberately projected security headers. Those facts match
the visible repair priorities. This is a bounded raw-response measurement, not
a claim about the entire site, rankings, Google Search Console, rendered DOM,
or real-user performance data.

## Local verification

Passed in the isolated worktree:

- focused P04 unit tests: 5 files / 81 tests;
- full unit suite: 493 files / 6,056 tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm --filter @sf/marketing build`;
- `pnpm --filter @sf/web build`;
- `pnpm --filter @sf/marketing exec playwright test --config=playwright.config.ts e2e/seo-audit.spec.ts` (3 passed);
- `pnpm secrets:scan` (including 75 redaction tests);
- `pnpm deploy:check` and `pnpm verify:authority`.

`pnpm verify:spec` remains failing on the pre-existing vendor-manifest hash for
`packages/sources/src/crawl/engine.ts`. That file is unchanged by commit
`91e6882`; the expected hash is `a5a7c6…` while the current production-baseline
file hashes to `826532…`. There is no `verify:public-tools-boundary` script on
this baseline.

## Remaining operational risk

The code is committed and pushed to `codex/seo-audit-live-v11`, then manually
deployed to the production alias. It is not merged into `main` and no pull
request was created. A future automatic production deployment from `main` can
therefore supersede this release unless this branch is integrated through the
normal repository workflow.
