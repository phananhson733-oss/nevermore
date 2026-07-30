# GenGrowth internal-link tree deployment fix: final re-review

Date: 2026-07-31

## Baseline and scope

- Repository: `phananhson733-oss/nevermore`
- Current baseline: `d26c2a4ff10efd0fda1f380117847374cec2edb3`
- Product surface: `https://gengrowth.ai/{locale}/tools/internal-link-audit`
- Marketing root: `apps/marketing`
- Application root: `apps/web` (must not be modified)

The repository advanced from the first review baseline to `d26c2a4` while that
review was running. The initial baseline is an ancestor of this commit, and none
of the candidate files overlapped the intervening commit. Codex rebased the
candidate safely and reran the marketing gates on the combined source.

## First-review findings that must now be closed

Please verify that the supplied final candidate closes:

1. inert expand/collapse controls during forced-open search/filter results;
2. recursive indentation overflow at 24 URL-path levels on a 390-pixel
   viewport;
3. unsanitized thrown exceptions and malformed JSON/category shapes in the
   consent route;
4. misleading crawl-depth and outside-branch copy;
5. desktop metric header offset;
6. secondary inbound counts that depended on an aggregate edge omitted from
   the bounded projection;
7. missing regression coverage for those cases.

## Architectural and permission boundaries

- Do not add mock data or a production mock path.
- Do not modify the crawl engine, SSRF controls, resource budgets, API schema,
  database schema, production configuration, or `apps/web`.
- Do not add or run a database migration.
- Do not use production credentials or real user data.
- Server-side consent telemetry is optional. Missing configuration or a missing
  optional table returns an honest local-only `202`; successful persistence is
  never claimed unless an insert succeeded.
- Search and filters may temporarily reveal matching ancestors, but controls
  must not appear interactive when that temporary reveal overrides collapse
  state.
- Visual indentation may be capped, but nested semantics, the full accessible
  path, and a readable visual cue for deeper levels must remain.

## Required review

- Recheck every first-review P1 and P2 against the corrected source.
- Review validation and error sanitization for malformed input, thrown client
  creation, thrown queries, returned `PGRST205`, other returned database errors,
  and success.
- Review the 25-node/24-level mobile fixture and verify that it tests internal
  tree overflow, not only document overflow.
- Review English/Chinese copy, accessible names, disabled controls, focus
  behavior, column alignment, and mapped-inbound semantics.
- Report any new regression with exact file and line references.

## Required tests

```text
pnpm exec vitest run --project unit \
  apps/marketing/src/app/api/consent/route.test.ts \
  apps/marketing/src/app/api/consent/persistence.test.ts \
  apps/marketing/src/components/tools/internal-link-audit-tree.test.ts \
  apps/marketing/src/components/tools/internal-link-audit-tool.test.ts
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing build
pnpm --filter @sf/marketing exec playwright test \
  e2e/internal-link-audit.spec.ts --config=playwright.config.ts
```

## Deliverable and acceptance

Return a severity-ordered report, exact file/line evidence, tests actually
executed, residual risks, and one explicit verdict:

- `PASS`;
- `PASS WITH NON-BLOCKING ISSUES`; or
- `FAIL`.

Pass requires all original blockers to be closed without a new security,
truthfulness, accessibility, responsive-layout, or `apps/web` regression.
Do not claim production, database, Git push, or deployment verification.
