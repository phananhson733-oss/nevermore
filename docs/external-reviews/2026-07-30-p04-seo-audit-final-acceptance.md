# P04 Website Health Map (`seo-audit`) — final acceptance record

Date: 2026-07-30
Repository: `signalframe-mvp-app`
Branch: `codex/pre-v03-local-preservation-20260727`
Baseline commit: `9c60184ded41e099e998feedb3f76128affac89a`
Delivery state: source committed and pushed; production deployment verified on 2026-07-30. No PR, database migration, production configuration change, or real-user-data operation was performed.

## Acceptance decision

**Pass for the P04 Public Tools V0 scope.** The anonymous Website Health Map is implemented at `/{locale}/tools/seo-audit`, with `POST /api/tools/seo-audit`, a shared Public Tools DTO/scanning layer, and the required five-module evidence-led report. The product boundary remains a single raw public page plus same-origin standard `robots.txt` and `sitemap.xml`; it does not claim a full-site crawl, rendered-page audit, ranking result, or production verification.

## Scope and architecture checks

- Public UI, route and anonymous request handling live in `apps/marketing`.
- Deterministic DTO, scoring and audit rules live in `packages/public-tools`.
- Public network collection and the SSRF/redirect boundary live in `packages/sources`.
- The route is a Node runtime thin handler and has no dependency on `apps/web`, workers, databases, MVP OpenAPI, authentication, projects, queues, or persisted scan history.
- The result contract exposes language-neutral rule IDs, statuses, severities, scalar evidence, source labels and limitation codes. It does not return raw response bodies, DNS addresses, headers, cookies, internal paths, or stack traces.
- The page supports English and Chinese, is present in the Tools index and sitemap, and its only product CTA uses `siteConfig.appUrl`.

## Landing-page template reconciliation

The two supplied design references were reviewed against P04:

- `/Users/wzb/Downloads/2026-07-29-gengrowth-ai-网站架构与页面模版设计-v1.md`
- `/Users/wzb/Downloads/2026-07-30-落地页文案-p0-2-internal-link-audit-完整版.md`

P04 intentionally does not compete for a generic SEO-audit keyword or make full-site claims. Its page now nevertheless follows the shared tool-page information structure within that boundary:

1. Hero with an in-page run CTA and explicit no-login/single-page scope.
2. The live, accessible URL form and the evidence-led result UI.
3. Three-step method, five-module field interpretation and three bounded use cases.
4. Full-product CTA that accurately describes the additional multi-page/rendered/history scope.
5. Eight localized FAQs, including score/coverage, robots scope, unverified evidence and preview-vs-full-product limits.
6. A neutral free-tools catalog link and an existing programmatic-SEO article link.

The interactive result surface continues to use the required four-part rhythm: observed evidence, bounded diagnosis via the status/limitation, concrete recommendation, and a repeatable verification instruction. It presents only the top three priorities, weighted coverage, the final URL, all five expandable modules and an honest zero-priority/`unverified` state.

## Changes accepted in this final pass

- Added a keyboard-accessible Hero anchor to the URL form (`#seo-audit-tool`) and linked the field scope/error text with ARIA IDs.
- Added localized P04 landing-page explanations for the five measured modules and realistic first-pass use cases.
- Expanded the FAQ JSON-LD and visible FAQ from three to eight localized entries; localized the Chinese FAQ heading.
- Added only valid internal paths for the related tool/article cards.
- Extended the SEO Audit Playwright coverage for the template sections, in-page CTA, FAQ count and link targets, while retaining mocked-result, mobile overflow and API-rejection coverage.

## V1.1 scope correction — single-page technical health only

After reviewing the supplied `website-audit-tool-v2.xlsx` reference workbook's
`A-技术健康度` sheet, the Public Tool scope was made stricter rather than
broader. The workbook is a technical-health checklist reference only. This
anonymous tool does **not** connect to, require, or claim to read Google Search
Console, CrUX, GA4, browser-rendered performance data, or a full-site crawl.

- Removed `internal_links` from the P04 check catalog, payload, result copy and
  related-tool card. Link topology, orphan candidates, click depth and link
  distribution remain the separate P02 internal-link audit responsibility.
- Added only three measurements that the existing bounded public request can
  actually establish: a correctly configured static mobile viewport, a
  non-empty HTML refresh directive, and presence count for HSTS, CSP,
  X-Content-Type-Options and X-Frame-Options. The API exposes only the count;
  it never returns header values and does not call presence a policy-quality or
  security verdict.
- Bumped the Public Tools result contract from `schemaVersion: "1.0.0"` to
  `"1.1.0"`. A fully measured pass now has 19 checks and total weight 43.
- Reframed the result as a **single-page static signal score**, visibly showing
  measurement coverage and `site coverage: 1 URL`; it no longer resembles a
  whole-website health score. The result now visibly follows Observation →
  Diagnosis → Recommendation → Artifact, with evidence/limitation/recheck text
  attached to every detailed rule.

Local read-only API verification against `https://www.gengrowth.ai/` through
the rebuilt local Marketing app returned the V1.1 contract, 18/19 measured
checks and 95% measurement coverage. It observed a configured viewport, no
HTML refresh directive, and three of the four selected security-header
presences. This is a real public-response measurement by local code, not a
production deployment check or a whole-site claim.

Revision-specific verification completed before release:

```text
pnpm test -- --reporter=dot                 # 206 files / 2,332 tests passed
pnpm typecheck                              # all 11 applicable workspaces passed
pnpm secrets:scan                           # scan + 74 redaction tests passed
pnpm --filter @sf/marketing build           # passed
pnpm --filter @sf/web build                 # passed
pnpm --filter @sf/marketing exec playwright test --config=playwright.config.ts e2e/seo-audit.spec.ts
                                                # 3 Chromium tests passed
pnpm exec eslint <P04 files>                # passed
```

The full Marketing lint command is not a P04 acceptance signal in this dirty
worktree: it currently fails on two unused symbols in the separate, uncommitted
P02 `internal-link-audit-tool.tsx` implementation. P04's own modified files
were linted directly and passed. `verify:public-tools-boundary` was also run in
an isolated worktree at `c9048a0`, with only the P04 patch applied: the rebuilt
Marketing output passed both policy tests and all 88 traced runtime files. No
P04 runtime dependency on `apps/web`, workers, database code or GSC was found.

After the separate P02 work was committed, the current branch was rechecked:
full `pnpm lint` passed, then a fresh Marketing build and
`pnpm verify:public-tools-boundary` passed with 89 traced runtime files. This
post-release recheck did not redeploy P02 or change the P04 production deployment
recorded below.

## Independent verification performed

All commands below completed successfully after the final source changes:

```text
pnpm verify:spec
pnpm typecheck
pnpm lint
pnpm test -- --reporter=dot
pnpm verify:public-tools-boundary
pnpm secrets:scan
pnpm --filter @sf/marketing build
pnpm --filter @sf/web build
pnpm --filter @sf/marketing exec playwright test --config=playwright.config.ts e2e/seo-audit.spec.ts
git diff --check
```

Observed results:

- Specification lock: 26 API operations, 5 async operations, 28 application tables and 11 frozen rules verified.
- Full TypeScript check: all applicable workspaces passed (11 of 12 scopes).
- Full lint: all applicable workspaces passed (11 of 12 scopes).
- Unit suite: 202 files / 2,312 tests passed.
- Public Tools boundary: 2 policy tests and 88 production NFT-traced runtime files passed.
- Secret scan: passed; associated redaction suite: 4 files / 74 tests passed.
- Marketing and Web optimized production builds passed.
- P04 browser suite: 3 Chromium tests passed against the rebuilt Marketing production output.
- `git diff --check`: passed.

## External review provenance

The P04 result-presentation review was independently requested from ChatGPT Pro, then checked against local source and tests. Its conversation and persisted record are below:

- Conversation: <https://chatgpt.com/c/6a6b33f4-e49c-83e8-bdcd-ad51231605a6>
- Local review record: `docs/external-reviews/2026-07-30-seo-audit-results-presentation-chatgpt-pro-review.md`
- Safe review package SHA-256: `a8d75104dc2c84df7bdd3c7b1a4ff3e6face141487a4a3cee76b8d6886bb922b` (184,147 bytes).

The external reviewer initially made an unsupported claim that local artifacts/tests were unavailable. It was given direct local evidence and corrected that claim. Its later patch/archive byte counts and SHA-256 values were self-reported only; no external binary was applied. Codex independently verified the local implementation and gates above.

## Production release verification

- Source repository and pushed delivery commit: `phananhson733-oss/nevermore` at `0d37d133680279d457f82035553079de6d0cf8f8` (`feat(marketing): add public seo audit tool`).
- The public site Vercel project is named `gengrowth-agents`, but it is the deployment target for this repository's `apps/marketing` root directory and `gengrowth.ai`; the similarly named Vercel project `nevermore` has `apps/web` as its root and serves the separate `app.gengrowth.ai` application.
- Release deployment: `dpl_BtnGxptcmCoBJLssbiAFCb4zHxEF`, built Ready from an isolated worktree checked out at the delivery commit, then promoted to `https://gengrowth.ai`.
- Public page check: `https://gengrowth.ai/en/tools/seo-audit` returned HTTP 200 and contained the P04 landing-page marker “See the SEO signals”. `https://www.gengrowth.ai/en/tools/seo-audit` also returned HTTP 200.
- Public API check: a production `POST /api/tools/seo-audit` scan of the public URL `https://www.gengrowth.ai/` returned HTTP 200. It reported `mode: public_preview`, `persistence: none`, score 86, 95% measured coverage (16 of 17 checks), and identified a canonical mismatch, one redirect hop, and static text depth as its top three priorities. This was a read-only scan of a public URL; it did not store a user scan, alter the target, or access authenticated data.
- The temporary deployment URL was subject to Vercel Deployment Protection (its API returned 401 without a browser-authenticated bypass). The formally promoted custom domain was used for the public page and API verification above.

## Remaining limits and risks

- Playwright report-result responses are mocked; they prove client rendering and error handling, not an internet-facing target’s live SEO state.
- The API E2E rejects malformed input with local-safe cases; the full scanner’s redirect, connection-IP pinning, decoding, truncation and robots semantics are covered by the Public Tools and Sources unit suite, not a production scan.
- The rate limiter is deliberately per-isolate best effort, not a global distributed rate limit.
- No fresh browser screenshot review was performed after this final landing-page copy extension. Production builds, DOM/mobile-overflow E2E and public-domain HTTP/API checks passed, but analytics, external crawl/indexing and UX conversion remain unverified.

## V1.1 production release verification

- Source commit: `1b053b57c786a4546d71db99ea9e4fb82f8043f3`
  (`feat(marketing): refine seo audit health scope`), pushed to
  `origin/codex/pre-v03-local-preservation-20260727`.
- Deployed from a clean, detached worktree at exactly that commit to Vercel
  project `gengrowth-agents` (Root Directory: `apps/marketing`). The similarly
  named `nevermore` Vercel project for `apps/web` was not deployed.
- Deployment: `dpl_C2HHir5f2H3JMH1dJeoieWdWvDuR`; inspect URL:
  <https://vercel.com/wzbs-projects-39a68c1d/gengrowth-agents/C2HHir5f2H3JMH1dJeoieWdWvDuR>.
  It reached `Ready` and was promoted to the live project aliases, including
  `https://gengrowth.ai`.
- Public page verification: `GET https://gengrowth.ai/en/tools/seo-audit`
  returned HTTP 200 and contained `Single-page static signal report`, the
  `no GSC` scope marker and the `04 Artifact` result stage. It did not contain
  the removed `Open Internal Link Audit` card label.
- Public API verification: a read-only `POST /api/tools/seo-audit` scan of
  public `https://www.gengrowth.ai/` returned HTTP 200,
  `schemaVersion: "1.1.0"`, `persistence: "none"`, 18/19 measured checks and
  95% measurement coverage. The actual response reported a configured viewport,
  no HTML refresh directive and three of the four selected security-header
  presences. This is a real production public-response check, not a claim about
  domain-wide health, Google index state or live user data.

No database migration, production configuration change, authentication change,
or real user-data operation was performed. Linking the temporary release
worktree briefly downloaded a Vercel development environment file; it was
deleted before deployment and was never committed, uploaded or printed.

## Related persisted materials

- `docs/external-reviews/2026-07-30-public-tools-seo-audit-evaluation.md`
- `docs/external-reviews/2026-07-30-public-tools-seo-audit-evaluation.html`
- `docs/external-reviews/2026-07-30-seo-audit-results-presentation-chatgpt-pro-review.md`
