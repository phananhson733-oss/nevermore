# P02 Internal Link Audit — Real Crawl External Review Record

Date: 2026-07-30

## External review

- Reviewer: ChatGPT Pro (design/security review only; no claimed local execution or deployment)
- Conversation: `https://chatgpt.com/c/6a6b4faf-dfe8-83e8-852c-6747be965e1e`
- Reviewed source baseline: `c9048a0bc890eb8d56a0e3fc120d457d171339ea`
- Supplied archive: `gengrowth-p02-real-crawl-source-20260730.zip`
- Archive SHA-256: `eaf5d4d90fc4897f13981cdcbc563c91d47f5de402402670cfffb33357225339`
- Archive size: 189,172 bytes; 35 files; secret scan: no match.

## Review findings acted on independently

The reviewer confirmed that the existing engine has the appropriate guarded
foundation (per-hop URL/DNS revalidation, pinned transport, manual redirects,
same-origin traversal and shared byte/time budgets). It identified these risks
before accepting a public wrapper:

1. Robots, sitemap documents and redirect hops must not sit outside a request
   budget.
2. Sitemap coverage must be exposed rather than silently supporting orphan
   claims.
3. The engine's rich raw projection must never be returned directly from a
   public API.
4. Sitemap-seeded traversal depth must not be represented as a homepage click
   count.

The final implementation addresses those requirements as follows:

- `PUBLIC_PREVIEW_MAX_REQUESTS = 60` reserves every robots.txt, sitemap,
  page and redirect transport request inside the existing guarded engine.
- The public report carries `sitemapFetched`, bounded sitemap URL count,
  `availability`, `stopReason`, and a user-visible limitation. An unavailable
  sitemap cannot manufacture an orphan candidate.
- `packages/public-tools/internal-link-audit` maps the raw crawl to a bounded
  serializable report (25 nodes, 80 edges, 12 findings) and never returns raw
  HTML, headers, cookies, resolver addresses or transport errors.
- A deep finding now says "observed crawl depth" and explicitly disclaims both
  homepage-click and ranking interpretations. An uncollected target is
  "unresolved", never called broken.

## Review handoff status

At the time this record was finalized, the ChatGPT Pro conversation had
verified the supplied archive and produced the interim findings above, but its
structured final verdict was still generating after repeated bounded waits.
Those notes were therefore treated as review input, not as an approval. The
changes and all validation below are the repository maintainer's independent
acceptance evidence.

## Independent evidence

The implementation was independently checked after those changes in a clean
detached worktree based on `origin/main` plus the integration commits, using a
fresh `pnpm install --frozen-lockfile`, with:

- source/public-tools/marketing type checks;
- marketing lint and production build;
- 75 focused source/model/handler tests;
- P02 Playwright API-fixture tests, including localized failure and mobile
  overflow coverage;
- a static dependency-boundary check confirming no `@sf/db`, `@sf/worker`, or
  `@sf/web` import from `packages/public-tools`; and
- repository secret scan (74 redaction/scan tests).

These are local validation results only. No Vercel deployment, live user crawl,
database migration, configuration change, or production smoke test occurred.
