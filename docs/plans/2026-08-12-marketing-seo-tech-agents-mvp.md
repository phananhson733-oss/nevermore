# Marketing SEO / Tech Agents MVP

- Status: implementation contract
- Date: 2026-08-12
- Scope: `gengrowth.ai` (`apps/marketing`) only
- Out of scope: new `app.gengrowth.ai` routes, project/workspace persistence, GSC authorization, PSI/CrUX, DataForSEO, background jobs, and the 77-check roadmap

## Product decision

GenGrowth will launch two focused marketing-site acquisition tools:

- `/agents/seo` — SEO Agent
- `/agents/tech` — Tech Agent

They are separate pages and separate client runs. They share one existing bounded crawl implementation, abuse gate, and completed-crawl cache because those are infrastructure, not user state. A URL, result, selected opportunity, or UI state from one Agent must never be copied into the other.

The approved concept Artifact is a visual and interaction reference. This contract and the current executable code are authoritative when the Artifact claims capabilities that are not connected.

## Mandatory account gate

Submitting an Agent audit requires a verified Supabase user session.

1. The visitor may enter a URL before signing in.
2. On `Run`, the client checks `/api/auth/session`.
3. If signed out, the URL is kept only as a short-lived browser-session intent and the existing Google Identity sign-in dialog opens.
4. Google sign-in creates or resumes the existing Supabase account. It requests identity scopes only; it does not request Gmail mailbox access.
5. After the page reloads with a valid session, the matching Agent resumes the pending run.
6. The Agent API independently calls `supabase.auth.getUser()` before reading the request body, opening a quota gate, checking cache, or issuing any network request. Client state is never authorization.

The Agent run remains `persistence: none`: registration is an access gate, not a claim that this marketing run was saved into an app project.

## Real capability contract

Both Agents use the existing `seo_audit.sitewide.v3` bounded public-HTML crawl. The crawler owns the page, depth, request, duration, byte, redirect, pacing, and concurrency budgets. The existing SSRF guard, per-IP and per-target quotas, in-flight lock, and completed-result cache remain unchanged.

The response is projected by Agent before it reaches the browser:

- SEO Agent: `metadata`, `structure`, and `structured_data` records.
- Tech Agent: `crawl`, `indexability`, and `links` records.

The projection preserves `observed`, `not_observed`, and `unverified` exactly. It must not convert missing or unavailable evidence into `0`, `pass`, or a recommendation.

## Public result experience

The result page shows only facts supported by this run:

- submitted target and capture time;
- crawl availability and bounded coverage counters;
- evaluated versus unverified checks;
- the relevant check ledger for the selected Agent;
- up to three review opportunities derived only from relevant `observed` issue-condition records;
- a selected-solution panel containing issue, evidence, potential impact, implementation template, validation steps, and limitations.

Opportunity order is affected observation count descending. It is not severity, predicted traffic impact, or an automatic priority score. The UI must state this.

No fixed demo result may remain visible after a visitor enters a URL. No global Health score, 77-check coverage claim, Apply, Create PR, Deploy, Approve, or other non-functional action appears in this MVP.

## Information architecture

- Primary header entry is `Agents`, not `Free Tools`.
- `/agents` is a two-card directory and must be reserved from the root short-link rewrite.
- The homepage has one URL field with explicit SEO Agent and Tech Agent destinations.
- Existing non-audit `/tools/*` routes remain supporting utilities. The legacy `/tools/seo-audit` and `/tools/internal-link-audit` pages permanently redirect to the matching Agent, while both legacy audit APIs apply the same auth-first gate before delegating for signed-in compatibility. There is no anonymous URL-audit bypass.
- English remains the default unprefixed locale; Chinese uses `/zh`.
- `/agents`, `/agents/seo`, and `/agents/tech` are present in both locale variants and in the sitemap.

## Acceptance criteria

1. An unauthenticated `POST` to either Agent audit API returns `401 auth_required` before the audit handler is invoked.
2. A signed-in request runs the existing audit handler and receives only the Agent's allowed record categories.
3. Upstream validation, robots, timeout, quota, cache, and scan errors keep their existing status and error codes.
4. Cache provenance headers survive the authenticated Agent wrapper.
5. SEO and Tech pages have independent URL inputs, result state, opportunity selection, and browser-session intents.
6. A pending intent expires and cannot resume on the wrong Agent.
7. Results contain no score and keep unverified separate from not observed.
8. Opportunity ordering is tested as affected-count ordering and is labelled as reach, not severity.
9. English and Chinese message trees have identical shapes; both Agent routes build statically.
10. `/agents` is not rewritten to `/go/agents`; legacy `/en/agents*` canonicalizes consistently with the existing locale policy.
11. The two legacy audit pages redirect locale-preservingly and their old APIs return `401 auth_required` before body parsing for signed-out callers.
12. The marketing package passes focused unit tests, typecheck, lint, production build, and browser checks for signed-out gating, signed-in execution fixture, locale, responsive layout, and Agent-state isolation.

## Deferred work

- Product/ICP synthesis and confirmation
- target country, audit locale, device, page type, and target query
- GSC-backed prioritization and keyword opportunities
- full page/site metric inventory and weighted coverage
- PSI/CrUX and JavaScript-rendered diagnostics
- canonical project/run persistence in `app.gengrowth.ai`
- generated patches, repository connection, PR creation, deployment, and recheck history

These may be added only with their own executable contracts. Marketing copy must not imply they are present in this MVP.
