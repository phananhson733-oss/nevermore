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
6. A related internal-link-audit link and an existing programmatic-SEO article link.

The interactive result surface continues to use the required four-part rhythm: observed evidence, bounded diagnosis via the status/limitation, concrete recommendation, and a repeatable verification instruction. It presents only the top three priorities, weighted coverage, the final URL, all five expandable modules and an honest zero-priority/`unverified` state.

## Changes accepted in this final pass

- Added a keyboard-accessible Hero anchor to the URL form (`#seo-audit-tool`) and linked the field scope/error text with ARIA IDs.
- Added localized P04 landing-page explanations for the five measured modules and realistic first-pass use cases.
- Expanded the FAQ JSON-LD and visible FAQ from three to eight localized entries; localized the Chinese FAQ heading.
- Added only valid internal paths for the related tool/article cards.
- Extended the SEO Audit Playwright coverage for the template sections, in-page CTA, FAQ count and link targets, while retaining mocked-result, mobile overflow and API-rejection coverage.

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

## Related persisted materials

- `docs/external-reviews/2026-07-30-public-tools-seo-audit-evaluation.md`
- `docs/external-reviews/2026-07-30-public-tools-seo-audit-evaluation.html`
- `docs/external-reviews/2026-07-30-seo-audit-results-presentation-chatgpt-pro-review.md`
