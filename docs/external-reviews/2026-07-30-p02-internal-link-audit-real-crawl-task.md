# GenGrowth P02 — Real Public Internal Link Audit: External Engineering Review

## Review target

- Repository baseline: `c9048a0bc890eb8d56a0e3fc120d457d171339ea`
- Worktree condition: dirty with unrelated `apps/web`, i18n, OpenAPI, and prior documentation changes. Do not rely on or modify those changes.
- Source package: `gengrowth-p02-real-crawl-source-20260730.zip`
- SHA-256: `eaf5d4d90fc4897f13981cdcbc563c91d47f5de402402670cfffb33357225339`
- Package contents: 35 reviewed source, test, and design files. It excludes `.git`, dependencies, build output, caches, databases, browser state, `.env` files, and credentials. A pre-upload secret scan produced no matches.

## Background and goal

`gengrowth.ai/tools/internal-link-audit` currently renders a polished but fixed-data demo. The product owner has explicitly rejected mock data. We must turn P02 into a publicly launchable, anonymous internal-link audit: a visitor enters a public website and receives a real, clearly bounded crawl result, internal-link graph, and explainable prioritized findings.

This is only for the public marketing site `gengrowth.ai`, not `app.gengrowth.ai`. The work must make no database migration, no production deployment/configuration change, no Resend work, no authentication, and no use of real user data beyond a transient request-time crawl.

## Architecture and non-negotiable boundaries

- Public UI and API routes live in `apps/marketing`.
- Tool contracts/orchestration live in `packages/public-tools`.
- Any URL fetching, DNS/SSRF defense, redirects, robots, sitemap, and crawl engine changes live in `packages/sources`.
- `apps/marketing` may depend on `@sf/public-tools`; `@sf/public-tools` may depend on `@sf/sources`. Do not import from `apps/web`, workers, database, queues, auth, paid entitlements, private APIs, or internal OpenAPI schemas.
- Existing `packages/sources/src/crawl/engine.ts` is the authoritative safe crawl foundation. Its crawler already uses per-hop canonical URL guarding, pinned HTTP connections, manual redirect handling, robots/sitemap support, bounded resource limits, and same-origin traversal. Do not replace it with ordinary `fetch`.
- Existing SEO Audit (`/api/tools/seo-audit`) demonstrates the thin route / handler / public-tool-contract / strict-body / rate-limit pattern. Reuse its patterns without weakening them.
- Keep user-submitted URLs transient; do not store them or raw HTML. Do not log sensitive request internals. Return only bounded, presentation-safe aggregates and URL/title/link metadata that the site exposed publicly.
- No claims that the tool has completed a full SEO crawl. It is a bounded, static-HTML, same-origin preview with robots and sitemap limitations disclosed.

## Proposed production shape for critique

1. Create a public-preview crawl wrapper in `packages/sources` that invokes the existing engine with an implementation-owned production preset, not a caller-tunable budget. Tentative envelope: 25 pages maximum, depth 4, 35–45 seconds wall time, 1 MB/page and about 12 MB total body cap, maximum five redirects, at most two concurrent requests, respectful per-host pacing, and a dedicated GenGrowth User-Agent.
2. Create `packages/public-tools/src/internal-link-audit` for strict URL normalization and a serializable result model. Input is a public `http(s)` hostname (path/query may be normalized to the site origin, with the UI declaring that the homepage/origin is used as the seed).
3. Derive results from crawl projections: node/edge graph, observed pages and links, potentially broken internal targets, low-inbound/deep-page candidates, and orphan candidates. Findings must use uncertainty-aware wording; a partial crawl must never call a page definitively orphaned.
4. Add a thin Node route `POST /api/tools/internal-link-audit` and a handler equivalent to SEO Audit: 4 KB strict JSON body, 2 audits / 10 min / IP, one request in flight / IP, `Cache-Control: no-store`, safe error envelope/status mapping, internal timeout beneath route max duration.
5. Replace the P02 fixed fixture UI with an actual request flow, accessible status/error handling, a graph generated from returned bounded data, actual counts/scope/limitations, and bilingual copy that never calls the result mock/demo data.
6. Replace mock-oriented tests with: pure scan/model tests; handler tests for malformed/oversize/unknown input, rate limit before crawl, per-IP in-flight gate, safe error mapping, and partial successful results; source wrapper/preset tests; Playwright UI tests routing the API with a realistic result fixture (test fixture only) and asserting rendering/error states. Existing crawler safety tests remain mandatory.

## Required response from external reviewer

Do **not** claim to run this private repository, attach a patch, or state that production deployment was verified. Analyze the attached code and provide a concise, evidence-based design review containing:

1. A prioritized list of security/correctness risks in the proposed approach, especially SSRF, redirect/DNS rebinding, robots compliance, crawl resource exhaustion, partial-data interpretation, UI trust, and serverless runtime behavior.
2. Exact minimal implementation recommendations (module ownership and API/model fields) that preserve the boundaries.
3. A test matrix with high-value negative and timeout/partial cases. Identify any testing seams required to test without network I/O.
4. A verdict: approve as-is, approve with named required changes, or reject. Explain each required change in a way that can be checked in source and tests.
5. State any product choice that cannot be safely inferred. Do not make external-network, Vercel, deployment, account, database, or repository mutations.

## Acceptance standard

The eventual implementation is acceptable only if it uses the existing guarded crawler for every outbound request/redirect; imposes hard budgets, concurrency and rate controls; has no mock data in the live user result; makes no unsafe certainty claims for partial coverage; keeps the public-tools dependency boundary intact; passes package/handler/UI safety tests and repository gates; and is not deployed in this task.
