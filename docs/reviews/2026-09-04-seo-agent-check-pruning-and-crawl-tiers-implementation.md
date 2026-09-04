# SEO Agent check pruning and crawl tiers — local implementation evidence

Date: 2026-09-04
Base: `25cb7214`
Branch: `feat/seo-agent-pruning-crawl-tiers-20260904`
Worktree: isolated feature worktree; local path intentionally omitted
Implementation state: committed release candidate; push, merge, and deployment require separate live evidence bound to an immutable SHA.

## Owner decisions applied

- Credit behavior is unchanged. This implementation does not edit the credit configuration or introduce a second price.
- An SEO request without `tier` resolves to `key-pages`, covering old clients and old pending intents.
- Tech Agent and On-Page Checker remain on the existing full-site crawl budget and do not expose SEO-only tier or manual-page controls.

## Delivered behavior

### Check pruning

- Removed catalogue checks `2.3`, `3.2`, `2.10`, `4.2`, and `4.3` from the Agent scoring and actionable UI.
- Preserved the neutral producer ledger and keyword evidence records, including `title_without_target_query`.
- Reduced the page catalogue from 58 to 53 checks while leaving the 31 site checks unchanged.
- Added non-scoring group-tail guidance for groups 2 and 4 that opens On-Page SEO Checker with a safe normalized page/query handoff when available.

### Key-page selection

- Added homepage navigation projection from semantic `header`, `nav`, and `footer` containers.
- Replaced the old client-side 12-page truncation with deterministic server selection:
  home, submitted target, manual pages, navigation, 3–20 page first-path clusters, and content/oversized-cluster pages ranked by observed inbound links.
- Navigation and manual reasons override the path blacklist. Blacklist matching is segment based, so `/tools/about-page-checker` remains eligible.
- The 50-page safety valve reduces content rows from 15 to 10 to 5 without dropping navigation or eligible cluster rows. Displaced content URLs are returned separately.
- Manual pages are capped at ten, normalized, credential-free, fragment-free, depth-zero seeds that share the selected crawl budget and cache identity. Safe apex/`www` variants are accepted and rebased to the target origin; sibling subdomains and HTTPS downgrades remain rejected.

### Crawl tiers and truthfulness

- `key-pages`: fixed server ceiling of depth 2, 80 URL attempts, and 45 seconds.
- `full-site`: unchanged public full-site budget.
- Budget overrides are server owned and can only tighten the public profile; typed and runtime-cast attempts to smuggle budget/frontier/manual controls through the offline engine seam are ignored.
- Key-pages still reads and projects sitemap documents, but defers sitemap members until the seed-and-discovery frontier is exhausted. This prevents sitemap backlog from starving homepage navigation.
- Explicit SEO `full-site` results publish every unique collected 2xx HTML page for page-level evaluation. Tech and On-Page compatibility routes keep their existing structural shortlist.
- Agent results carry an optional `crawlTier`; older responses without it remain readable. Explicit SEO full-site copy reports evaluable collected pages rather than calling them key pages, while Tech keeps truthful structural-shortlist wording.
- Cache namespaces partition `key-pages` and `full-site`; a normalized manual-page set adds an opaque stable SHA-256-derived namespace suffix. Quota and in-flight gates remain shared.
- In key-pages results, C1, C2, and C5 stay visible as `unverified` with `full_site_only`; partial collection is never presented as a pass.

## Baseline reconciliation

The handoff described C2 `internal_target_http_error` as catalogue-only and proposed a new record plus a v19 bump. The implementation base already contained the detector and ledger record. This change therefore reuses the existing C2 record, adds no duplicate detector, and keeps `seo_audit.sitewide.v18` byte-compatible for legacy raw/cache rows.

## Real key-pages canary

Target: `https://gengrowth.ai`
Result after the frontier fix:

- elapsed: 24.759 seconds
- tier: `key-pages`
- pages inspected: 73 (ceiling: 80)
- requests observed: 75
- stop reason: `max_urls`
- homepage navigation subjects: 11; all 11 collected and included in the page-level set
- reasons: `home` 1, `navigation` 10, `cluster` 51, `content` 5
- omitted content URLs: 2
- C1/C2/C5: `unverified`, tested `0`, limitation `full_site_only`

The homepage itself retains the earlier `home` reason, so the 11 navigation subjects appear as one home row plus ten navigation rows. A live full-site crawl was intentionally not run because its unchanged ceiling permits up to 2,000 URL attempts; full-site behavior is covered by deterministic offline frontier and projection tests.

## Verification ledger

Passed:

- full unit suite after merging `origin/main`, with four workers: 1,177 files, 18,840 tests
- all 32 changed unit-test files: 1,078 tests
- full E2E TypeScript and workspace typecheck
- full production build for Marketing and Web
- Agent Playwright suite against the standalone production build: 7 tests
- scoped ESLint for all changed Marketing, Sources, and Public Tools TypeScript files except the separately identified baseline line in `model.ts`
- `git diff --check`
- `implementation:check`
- `contracts:check`
- `verify:docs`
- `verify:authority`
- `verify:spec`
- `verify:spec:test`
- `vendor:check`

Known pre-existing repository gates, independently reproduced on clean `HEAD`:

- full lint: `packages/public-tools/src/seo-audit/keyword-evidence/extract.test.ts:258` (`no-empty-pattern`)
- full lint: `packages/public-tools/src/seo-audit/model.ts:237` (`imageExtension` unused)
- secrets scan: `apps/marketing/src/components/agents/agent-issue-prompt.test.ts:495` (intentional JWT redaction fixture)

These three baseline findings are outside this handoff and were not changed.
