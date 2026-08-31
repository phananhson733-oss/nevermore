# Page citability presentation — release acceptance

## Scope

The user approved the T2 Artifact's input/result interaction and information
hierarchy while explicitly requiring the existing Marketing website's style.
Report data, rules, quotas, API and renderer contracts remain unchanged.

This release adds native input/result switching, four truthful summary cards,
grouped problems, two check stages, and a lower evidence disclosure. It reuses
the site's Input/Button controls, reading typography, neutral selected tabs,
semantic states and theme tokens. Draft inputs cannot relabel an existing report;
new requests invalidate old reports, and unavailable values never become zero.

Only `apps/marketing/**` is released. No Product, Worker, SQL, environment,
provider or product-version changes. Shared Input/Button changes resolve `cn`
to the same Marketing utility with a relative path; their style definitions
are unchanged. Root-level local plans and screenshots are retained locally,
not included in the release commit.

## Current release verification

Base: `9082121b3f672a5ea801d2f4a4b49d50679af759` (fresh `origin/main`).
The upstream Content Draft request-proxy fix is retained without modification.

- Expanded unit regression: 18 files / 424 tests passed, including 56 component
  tests and shared-control/account, rule, route, handoff, locale and theme checks.
- Actual Marketing production build passed (299 static pages generated).
- Marketing TypeScript, changed-file ESLint, secret scan and diff whitespace
  checks passed. Deployment configuration verification passed.
- Isolated Playwright: 12/12 passed across EN/ZH, light/dark, desktop/mobile and
  unknown/partial/zero/failed-rerun cases. Includes actual Enter submission,
  root-cause anchor navigation and clipboard copying of the frozen report.
- Independent coverage/risk and plan/scope reviews found no blocking defect.
  Five additional cases close blank URL/ref, safe-integer and clipboard failure
  gaps. Coverage is reviewed behaviour coverage, not an instrumented percentage.

Browser fixtures are built with the actual deterministic rules/render projection.
They are explicitly offline UI evidence, not production collection or provider
evidence. Production SHA/alias, page/API and Product identity are verified after
the release, separately from this pre-release record.

## Baseline exceptions

Full Marketing lint has four errors in three unchanged files:

- `src/components/tools/competitor-keyword-gap-tool.test.tsx`: unused `pressEnter`.
- `src/components/tools/on-page-check-list.tsx`: unused `OnPageCheck`.
- `src/lib/agents/draft-handler.ts`: unused `PLACEHOLDER` and control characters
  in a regular expression.

`verify:spec` also fails on the root `package.json` hash: actual
`a74695ffc0e01f84abdb369177ef1e512a4a9540c20bd60ae4b91d80b517b064`, expected
`767220c889b6d323a09fad5dfdb3a9b5e89969d9154cabbc204521271e867ccc`.
The exact failure was reproduced by running the verifier in a separate clean
checkout of base `9082121b`. Neither the manifest nor the lock is changed here.
These are recorded as existing baseline failures, not presented as green gates
or repaired by expanding this presentation release into Product authority work.

No package/version bump is appropriate for this Marketing-only UI release:
root product metadata and authority locks are outside its scope. Native Codex
review was explicitly authorized in place of external ChatGPT Pro collaboration;
no external source bundle was uploaded.
