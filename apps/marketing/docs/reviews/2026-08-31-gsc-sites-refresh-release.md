# GSC property refresh release candidate

## Scope and authorization

The owner authorized commit, push and production release on 2026-08-31 after
reviewing the local fix. The release is limited to `apps/marketing`: no Product
app, worker, migration, dependency, configuration or OAuth scope changes.

Source baseline: `8ce02d2fe31f89addef50f827abad41b8baad60f`.
Branch: `fix/gsc-sites-refresh-20260831`.

This document records candidate evidence, not a claim of completed deployment.
The immutable merge SHA, deployment and production checks must be verified
after merge. The initial root-level plan and review remain local so the commit
does not mark the unrelated Product application as affected.

## Defect and repair

Daily Briefing rendered the `gg_sites` snapshot saved by Google OAuth. The list
was updated only by another callback or access-token renewal, so adding a GSC
property while the token was still valid left the dropdown stale.

`POST /api/tools/gsc-properties` now lists properties independently of token
renewal and writes the current list to the existing sealed cookie. It returns
only cookie-bounded properties, their complete total count, and brand-term
candidates. The existing large-account cookie-size limit remains explicit.

Daily Briefing refreshes on mount and window focus with a 30-second cooldown;
the manual refresh button bypasses that cooldown. Empty connected lists can
acquire a first site. Existing site-owned input, confirmation and report are
preserved while the selected property remains accessible. Removed selections
are cleared and require a new choice. Temporary failures retain the prior list
with a retry notice rather than requiring logout/login.

The endpoint preserves grant/identity binding and token expiry, requires a
same-origin POST, performs admission before provider calls and never returns
credentials. Its separate 30-per-IP-hour quota does not consume report runs.
The missing-identity check explicitly refuses a malformed sealed null subject.

## Local acceptance

- Baseline: 3 suites / 63 tests passed before changes.
- Regression tests first reproduced 5 frontend failures and 8 backend failures.
- Final relevant unit suites: 23 files / 583 tests passed.
- Independent review: 4 files / 104 tests passed; no unresolved verified P1/P2.
- Marketing TypeScript, changed-file ESLint and production build passed.
- The production build contained 298 static paths and the new property route.
- Chromium: 3 scenarios passed against the final local build. Chinese and English
  cover automatic refresh, manual retry, unchanged input, empty-list recovery,
  focus cooldown and removal of the current selection.
- Browser tests contain fictional identities, no Google credentials, default-deny
  API/external guards and no report/login/logout calls. They are provider-free.
- Secret scan and 75 redaction tests passed; docs checks passed 14 tests.

## Existing baseline gate exceptions

Release preflight reconfirmed the same exceptions recorded by the preceding
Website Profile release on the current main baseline:

- Full Marketing lint reports four errors in unchanged
  `competitor-keyword-gap-tool.test.tsx`, `on-page-check-list.tsx` and
  `lib/agents/draft-handler.ts`. Changed-file lint passes.
- `verify:spec` reports that root `package.json` differs from the active v0.4
  lock hash. Neither root package configuration nor Product authority/lock is
  changed by this release; the check already fails on its source baseline.

These are failing baseline gates, not newly passing checks. This bounded
Marketing repair does not alter Product authority or unrelated code to hide
them. Docs, implementation inventory, deployment configuration, generated
OpenAPI contracts and OpenAPI lint passed; GitHub Actions remains intentionally
manual (`workflow_dispatch`), with local acceptance and Vercel deployment checks
used for this release.

## Production baseline and verification contract

Before release, Marketing `gengrowth.ai` resolved to
`dpl_C5cJ1XDcKXVHLsKK7BQpz7ZRdA6Z`, SHA
`8ce02d2fe31f89addef50f827abad41b8baad60f`.

Product `app.gengrowth.ai` independently resolved to
`dpl_DzMBdEeuhxshcsqSt8UVttk75cc7`, SHA
`de82f380bf2d531907bfad825dc4b755deced053`; its live version endpoint confirmed
that SHA. Preserve this Product identity throughout the Marketing release.

After merge, require the exact merge SHA on a READY Marketing deployment with
both Marketing domains; inspect relevant route/bundle/auth boundary behavior
and deployment logs. Verify Product remains on its prior identity. An actual
signed-in GSC refresh must be reported separately from local mocks and public
HTTP probes; do not report it as passed without a usable authenticated session.

No external ChatGPT Pro source upload was authorized or performed. Native
subagents assisted with bounded implementation, tests and independent review.
