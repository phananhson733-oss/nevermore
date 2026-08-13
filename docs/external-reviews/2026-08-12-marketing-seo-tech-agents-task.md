# ChatGPT Pro engineering review: marketing SEO / Tech Agents MVP

- Date: 2026-08-12
- Repository baseline: `e284f32efa34abc6da7a2e93342158db161fb8f6`
- Scope: `gengrowth.ai` marketing application (`apps/marketing`) only
- External reviewer: ChatGPT Pro, advisory code/security review only

## Context and customer goal

GenGrowth is replacing two anonymous URL-audit entry points with two separate,
registration-gated marketing Agents:

- `/agents/seo` reviews metadata, heading structure, and JSON-LD conditions;
- `/agents/tech` reviews crawl responses, static indexability, and internal-link
  conditions.

Each Agent owns its own URL, pending sign-in intent, result, opportunity
selection, and solution state. They share the existing bounded public-static-HTML
crawler, durable quota, and completed-crawl cache as infrastructure. This work
does not add an `app.gengrowth.ai` workspace, saved project/run, GSC access,
PSI/CrUX, JavaScript rendering, a global score, generated patch application, PR,
deployment, or production migration.

The executable contract is
`docs/plans/2026-08-12-marketing-seo-tech-agents-mvp.md`. If any older product
copy or Artifact implies a capability not present in code, the executable
contract and current code win.

## Mandatory boundaries

1. A verified Supabase user is required before an audit request is read, quota
   is consumed, cache is consulted, or a crawl begins. Client session state is
   not authorization.
2. Google sign-in is identity only. It must not request or imply Gmail mailbox,
   Search Console, or site-ownership access.
3. SEO and Tech must remain independent pages and runtime state machines. A
   pending intent or result from one must never resume or render in the other.
4. Agent APIs must return only their allowed record categories and must omit raw
   page inventory. Old audit APIs must not provide a bypass around this
   projection.
5. `observed`, `not_observed`, and `unverified` are distinct. Missing evidence
   must never become zero, pass, verified, severity, traffic impact, or an
   automatic priority.
6. Opportunity order is affected-observation reach, not severity or forecast.
7. A selected solution is an adaptable static preview. It must not claim to
   edit, apply, approve, save, publish, create a PR, deploy, or verify a result.
8. The audit run is `persistence: none`. Registration does not imply that a
   canonical app project/run was created.
9. The existing SSRF protection, bounded crawl budgets, per-IP/per-target quota,
   in-flight lock, and completed-cache provenance must remain intact.
10. Cache reuse must be exact for the normalized submitted URL; a cached result
    from another path on the same host must not be presented as this run.

## What to review

Please perform a read-only engineering review of the supplied source package.
Prioritize:

- auth-first ordering and every possible direct/legacy API bypass;
- pending-intent TTL, Strict Mode behavior, double-submit races, fallback sign-in
  return behavior, and exact-Agent isolation;
- cached-result identity, provenance, request-path correctness, and stale-result
  labeling;
- strict response validation, category projection, dynamic translation-key
  safety, raw data minimization, and error passthrough;
- evidence/truth semantics in the audit summary, Top 3 reach list, and selected
  solution;
- SSRF/resource-abuse regressions introduced by the wrapper;
- accessibility, localization, responsive behavior, and misleading marketing or
  structured-data claims on active surfaces;
- missing unit, integration, or browser tests that could conceal a P0/P1 defect.

## Required response

Return:

1. A verdict: `PASS`, `PASS WITH NON-BLOCKING ISSUES`, or `FAIL`.
2. Findings ordered by `P0`, `P1`, then `P2`, each with exact file and line,
   concrete failure scenario, violated boundary, and the smallest correct fix.
3. Tests that are missing or too weak.
4. Any claim you could not verify from the supplied files.
5. A short explicit checklist for auth-before-body/network, SEO/Tech isolation,
   exact-URL cache identity, legacy bypass closure, evidence semantics, no raw
   pages, no score, and no persistence claim.

Do not assume access to any local path, private repository, browser profile,
database, Supabase/Vercel project, credentials, production environment, or real
customer data beyond the uploaded ZIP. Do not claim that you ran commands you
could not run. Do not commit, push, deploy, migrate, change production settings,
or operate real user data. A patch is optional; the primary deliverable is a
precise review that Codex can independently reproduce and verify.

## Local evidence available before external review

- Focused backend, frontend, route, shell, pricing, content, legal, and contract
  suites passed: 27 files and 208 tests.
- Marketing and public-tools TypeScript checks, marketing ESLint, and
  `git diff --check` passed.
- The production Next build generated 150 static pages and both Agent APIs.
- The full marketing Playwright suite passed 9/9. Its four canonical Agent
  scenarios cover signed-out blocking, signed-in SEO result rendering,
  exact-Agent intent isolation, responsive overflow, homepage routing, and
  legacy redirects; the remaining five preserve default-English locale routing.
- The repository secret scan and its 75 focused redaction tests passed.

These are local and mock-browser results. They are not production deployment
evidence and do not prove a real authenticated Supabase session or live crawl.

No commit, push, pull request, deployment, database migration, production
configuration change, or real authenticated production crawl is authorized by
this task.
