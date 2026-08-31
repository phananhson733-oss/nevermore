# Website profile UX release — 2026-08-31

## Scope

Publish the approved account website-profile UX changes to Marketing only. The release branch starts at `d4ebb11093092ed005217d44d033009742688d13`; only `apps/marketing/**` is included. Root version/authority files, Product, Worker, dependencies, database schemas and environment configuration are unchanged. The previous local design worktree and its notes are preserved separately.

## User-visible behavior

- Product and ICP fields read vertically with clear section boundaries and 44px icon-only add/remove controls.
- Successful profile confirmation collapses the editor to a versioned summary; Edit profile restores the form without more provider calls.
- Failed, invalid or conflicting confirmation remains open. Pending local edits and a newer server draft from another tab are preserved for explicit resolution.
- Competitors are separate from Market and language. The existing SEO suggestion/display helpers and search UI present direct, indirect and excluded relationships with explicit system, unsaved and saved labels.
- System candidates never enter durable profile arrays automatically. Only confirmed snapshots are reused by other tools.
- First outcome is omitted from account ICP editing; its schema, historical values and Agent-local behavior remain compatible.

## Evidence boundary

Local browser flows intercept APIs with in-memory fixtures; they do not prove real account persistence or provider relationship accuracy. Production verification must bind the merged SHA to Marketing READY and the canonical aliases. The Product production deployment must retain its independent identity.

Before release, Marketing was `dpl_9QBiZQPtjJn1y7QLRDvoK8QUPmNp` on `d4ebb11093092ed005217d44d033009742688d13`. Product was `dpl_DzMBdEeuhxshcsqSt8UVttk75cc7` on `de82f380bf2d531907bfad825dc4b755deced053`; its public version endpoint returned that same SHA.

## Baseline exceptions reproduced on clean main

The following failures reproduce without this patch on detached `d4ebb110`:

- `verify:spec`: existing root `package.json` SHA differs from the active lock (actual `a74695ff…`, expected `767220c8…`). Neither file changes in this release.
- `blog-content.test.ts`: the authored English post count is 85 while the assertion expects 80. This release does not change content or that test.
- Full Marketing lint: four existing errors in `competitor-keyword-gap-tool.test.tsx`, `on-page-check-list.tsx`, and `lib/agents/draft-handler.ts`. None is modified here.

These are recorded baseline failures, not green gates. They are not repaired by changing the frozen Product authority or unrelated Marketing code in this UI release.

## Validation

- Full Marketing unit run (no exclusions): 5,657 passed / 1 pre-existing blog-count failure, across 326 files. All 64 editor tests passed. The initial two editor timing failures were reproduced as pending native SHA-256 parsing and fixed by waiting for the real confirmation state, with assertions preserved.
- Marketing production build passed: 297 static pages generated. Marketing typecheck and changed-file ESLint passed.
- Account Playwright suite passed 3/3 against this local production build, including Chinese desktop/mobile competitor separation, explicit classification, confirmation collapse/reopen, overflow and accessibility checks.
- Repository docs, authority self-check, specification-verifier tests, implementation inventory, generated contracts, OpenAPI lint, secret/redaction scanning and deployment-configuration checks passed. The active spec-lock exception remains explicitly recorded above.
- No prompt, provider, API request, schema, migration, dependency or Product version change is part of the release.

No GitHub Actions run is implied: this repository intentionally uses workflow_dispatch only; release verification is local plus Vercel checks/builds.
