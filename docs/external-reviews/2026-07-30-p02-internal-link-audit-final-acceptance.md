# P0-2 Internal Link Audit — final acceptance record

Date: 2026-07-30

Final validator: Codex

Surface: `gengrowth.ai/{locale}/tools/internal-link-audit`

Milestone: public, anonymous, non-persistent, fixed-data interactive demo

## Outcome

The P0-2 front-end milestone is implemented in `apps/marketing` as a localized
GenGrowth public tool. It accepts and validates a URL locally, simulates a
three-stage analysis, and then presents a fixed 42-page fictional sample as an
interactive internal-link graph and prioritized repair brief.

The page does not crawl the entered site, connect Search Console, persist the
URL, create an App project, or claim production crawler validation. The mock
boundary remains visible before and after submission.

## Source package baseline

- Repository commit at packaging:
  `9c60184ded41e099e998feedb3f76128affac89a`
- Branch at packaging:
  `codex/pre-v03-local-preservation-20260727`
- Package:
  `.gstack/p02-external-review/gengrowth-p02-source-20260730.zip`
- Files: 33 files, plus 22 ZIP directory entries
- Size: 224,685 bytes
- SHA-256:
  `731e332ec45aa272d7c4e2e914ac39992f727dd0a7ddf4cbfe2229fbb6d253f9`
- Secret scan before external delivery: bounded credential-pattern scan
  returned no matches.

The in-app browser rejected the ZIP upload. ChatGPT Pro therefore did not
receive or verify the archive. The engineering task and essential current
source excerpts were pasted into the external conversation instead.

## Implemented product surface

- Localized English and Chinese route at
  `/{locale}/tools/internal-link-audit`.
- Entry on the localized public `/tools` index and both locale URLs in the
  sitemap.
- Localized canonical, hreflang and x-default metadata.
- `BreadcrumbList`, `HowTo`, `FAQPage` and `SoftwareApplication` JSON-LD.
- Locally validated URL form and an intentionally simulated three-stage run.
- Persistent mock disclosure, entered-URL preview, fixed sample ID and evidence
  boundary.
- Summary metrics, filterable SVG relationship graph, keyboard-selectable
  labeled nodes, node evidence panel and prioritized finding controls.
- Four-part Observation / Diagnosis / Recommendation / Artifact explanation.
- Methodology, limitations, use cases, comparisons, ten FAQs, related resources
  and a final product CTA.
- Responsive desktop and 390 px layouts in the existing charcoal/terracotta
  GenGrowth visual language.

## Independent verification

The following local checks passed:

- `pnpm --filter @sf/marketing typecheck`
- `pnpm --filter @sf/marketing lint`
- `pnpm --filter @sf/marketing build`
- `pnpm --filter @sf/marketing exec playwright test e2e/internal-link-audit.spec.ts`
  — 2 tests passed
- Combined P0-2 and P0-4 marketing E2E — 5 tests passed
- Root `pnpm typecheck`
- Root `pnpm lint`
- Root `pnpm test` — 202 files and 2,312 tests passed
- Root `pnpm build`
- `pnpm verify:spec`
- `pnpm verify:public-tools-boundary` — 88 traced runtime files checked
- `pnpm secrets:scan` — scan and 74 redaction tests passed
- `git diff --check`

The formatter binary is not installed as a workspace command:
`pnpm exec prettier` returned `Command "prettier" not found`. ESLint and all
other applicable gates passed.

## Browser acceptance

- Desktop English page and result deck were visually inspected.
- Chinese page was inspected at a real 390 × 844 viewport.
- Both the initial state and the generated result/graph state had no horizontal
  document overflow.
- The Chinese form produced the fixed result and retained the mock disclosure.
- The graph, filters, labels, selected-node evidence and repair cards remained
  readable in the narrow layout.
- The P0-2 submit path made no external, API or non-GET fetch/XHR request in
  E2E. Next.js same-origin route-prefetch GETs were intentionally excluded from
  this assertion.

## External review

- Conversation:
  <https://chatgpt.com/c/6a6b3fe2-cae0-83e8-a056-b7e71300f620>
- Review basis: pasted task and source excerpts only.
- ChatGPT Pro did not access the ZIP, repository, private services or local test
  environment and did not independently run tests.

ChatGPT Pro initially proposed a candidate archive that it self-reported as
53,703 bytes with SHA-256
`edb0c310b5740af28ed597b4dff29b1df6a7a2d7ba5b898b701792716a625912`.
The in-app download did not produce a locally accessible file, so Codex did not
verify that archive, apply it or rely on its self-checks.

Codex disposition of the review:

- Adopted: preserve a no-API, no-storage implementation and interpret
  “persistent demo status” as persistent page visibility.
- Already satisfied: use the existing metadata/JSON-LD route pattern without
  reusing a homepage schema that would describe a trial or the authenticated
  product.
- Adopted and corrected: the dedicated `SoftwareApplication` data now states
  that this is a fixed-data demo with no live crawl, Search Console connection
  or saved data.
- Adopted and corrected: visible graph copy now says it shows 10
  representative nodes from the 42-page / 118-link fixed sample.
- Rejected as out of scope and inconsistent with the authority documents:
  replacing the frozen sample with 136 links, 6 orphans, 24 findings and a
  42-node graph.
- Rejected as premature: moving the presentational mock contract into
  `packages/public-tools`. That package boundary remains required for the later
  real deterministic audit contract, not for this page-local fixed demo.
- No fifth tool was invented from incomplete context. P0-2 was added without
  disturbing the entries that actually exist in the working tree.

After receiving the correction evidence and the independently run gate results,
ChatGPT Pro’s final re-review reported:

- Remaining P0: 0
- Remaining P1: 0
- Status: Accept

That acceptance is advisory and excerpt-based; final acceptance remains based
on Codex’s local source inspection, browser checks and test results.

## Intentionally deferred

- Real network crawl and redirect handling.
- SSRF-safe URL resolution, DNS/IP revalidation, robots policy and bounded
  crawling through `packages/sources`.
- A typed reusable result contract in `packages/public-tools`.
- Background jobs, database persistence, auth and App project integration.
- Search Console integration, which is not required by this crawler-shaped
  tool.
- Real CSV export and production free-crawl limits.
- Deployment, production configuration and database migration.

## Repository state

This acceptance record does not imply a commit, push or deployment. The
working tree contains pre-existing P0-4 and unrelated application changes that
must not be silently included in a P0-2 commit.
