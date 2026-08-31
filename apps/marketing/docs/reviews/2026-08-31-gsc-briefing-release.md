# GSC Daily Briefing Marketing release candidate

The owner explicitly authorized the current task's external Pro review exemption,
commit, push, PR and Marketing-only deployment after reviewing the local repair.
No external source upload occurred. Product, Worker, database and configuration
changes are excluded.

## Reconciliation

The reviewed repair was committed as `f9313147`. It was then reconciled with
`bb85c2be24977d4411d4b355d15cf0fc6492e172` (GSC property refresh, PR #260) in
`6cb2c819c80898878041924b3b417590d07d5701`. The form preserves automatic/manual
property refresh, refresh/report mutual exclusion, input confirmation, request
generation guards and submitted-property identity. The properties fixture remains
isolated in the local browser tests. Independent reconciliation review passed.

Release source fingerprint, excluding review documents:
`c47dafd095771e6b3e7e2de92ca02672e4760aba69866738536fbc14d4a27a46`.

## Candidate checks

- 15 relevant unit suites / 613 tests passed on the reconciled implementation.
- Marketing production build passed; Public Tools and Sources type checks and
  changed TypeScript/TSX ESLint passed.
- Six local standalone Chromium tests passed: three Daily Briefing tests and
  three incoming property-refresh tests, with denied external/provider traffic.
- Documentation, implementation inventory, deployment configuration, generated
  OpenAPI contracts and OpenAPI lint passed.
- Secret scan and 75 redaction tests passed.
- The last full pre-reconciliation unit run had 15,390 passes and one existing
  blog inventory assertion failure (80 expected, 85 actual). This was reproduced
  on clean baseline `8ce02d2f`; no blog-content implementation/test changed here.
- `verify:spec` fails on root `package.json` active-lock drift, with identical
  actual/expected hashes on clean `8ce02d2f`. The root package, authority and lock
  are unchanged. This is the same baseline exception recorded by PR #260.
- Automatic GitHub Actions are disabled by repository policy; the CI workflow is
  manual. Local checks and Vercel deployment checks are distinct evidence.

## Frozen production identities and release constraints

Before this release, Marketing resolved to `dpl_qfEnDkwBn9d2UD8MukdAsRityrrx`,
SHA `bb85c2be24977d4411d4b355d15cf0fc6492e172`, with both Marketing domains.
Product resolved independently to `dpl_DzMBdEeuhxshcsqSt8UVttk75cc7`, SHA
`de82f380bf2d531907bfad825dc4b755deced053`.

Shared-package edits can mark Product affected. A bounded release-time guard
only cancels Product candidates matching this task's explicitly recorded SHAs;
it does not change project settings or other releases. Verify the retained
Product alias after Marketing is ready. Railway's CLI authentication was expired;
no Worker operation was performed and no unchanged Worker identity is claimed.

Require the final merge SHA on a READY Marketing production deployment, both
domain aliases, live v10 behavior, authentication boundaries, and an actual GSC
briefing/browser comparison. Record any unavailable authenticated check explicitly.
This candidate document does not claim deployment has already happened.
