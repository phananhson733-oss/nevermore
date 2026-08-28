# Keyword Opportunity Workflow verification

Date: 2026-08-28

Status: local implementation and post-merge verification complete; PR, merge,
and production evidence are still pending.

## Authority and release boundary

- Owner authorization: explicit `授权 Workflow`, following the earlier request
  to implement, submit, and deploy the audited Low-Competition Keywords fixes.
- Current upstream integrated for this snapshot:
  `origin/main@9c15f5ed96835dadaab661b96128747caf305ed0`.
- Verified post-merge branch snapshot before this document:
  `9c058d97f8dda0d0ce8559a4a532ba58bc65830b`.
- Production predecessor: PR #236 / `bea97d9cb1e92bacc8cb63c482f0b7deedec6410`.
- Authorized runtime surface: Marketing plus the existing public-tools and
  sources package contracts used by Marketing.
- Explicitly excluded: `apps/web`, Railway Worker, Product writes, a Product
  saved-history surface, production environment-variable changes, and any
  paid production keyword-map run.

Relative to the integrated upstream, the branch changes 60 paths: 47 under
`apps/marketing`, five under `packages/public-tools`, one package export file
under `packages/sources`, two design/plan documents, and five repository-level
CI/package/ignore/lint files. A forbidden-path scan found no `apps/web`, Worker,
Product source, database migration, environment file, Railway, or Vercel config
change introduced by this branch.

The account-website migration and Product-adjacent account changes visible in
the merge commit belong to upstream PRs #237-#240, not to this branch diff.
Their website-profile inputs overlap the Keyword Map UI, so the merge was
resolved additively and tested: the exact profile reference and the durable
Workflow request are both retained.

## Implemented contract

- `workflow@4.8.5` is a pinned Marketing production dependency;
  `@workflow/vitest@4.0.21` is a pinned Marketing development dependency.
- The production build registers one workflow and 18 compiled steps, including
  the Vercel-managed flow, step, and webhook routes.
- Stage one remains a synchronous, authenticated, bounded site-context read and
  proposition confirmation. No paid search-data work starts before confirmation.
- A versioned stage-two client starts a durable Workflow and polls only with a
  sealed, caller-bound run token. Legacy clients without the version header keep
  the synchronous `200` contract.
- Candidate generation, validation, compact GSC coverage, each individual SERP
  sample, SERP interpretation, enrichment, and final assembly have durable step
  boundaries. A SERP step handles one keyword, and waves contain at most ten
  concurrent samples.
- Provider/model facts are frozen as structured step outputs. The final report
  is assembled from those outputs; no later AI call is allowed to invent or
  overwrite provider observations.
- GSC step output contains only bounded per-candidate coverage projections. It
  never persists OAuth credentials or full GSC row collections in Workflow data.
- Known post-dispatch failures return typed unavailable evidence with automatic
  Workflow retries disabled. The system does not turn missing provider data into
  zero or a negative signal.
- Duplicate starts reuse a client request UUID and an active-run hook. A duplicate
  adopts the owner's sealed token instead of purchasing a second active run.
- Refresh recovery uses a tab-scoped pointer that expires after 24 hours. A
  restored exact website-profile reference is validated and shown as accepted
  evidence; malformed references fail closed.
- Continuous status failures are bounded: after five consecutive `503` or
  unreadable responses, the UI exits tracking, preserves the original request
  UUID, drops only the unreadable run token, and offers a deduplicated retry.
- Synchronous results retain `persistence: "none"`; durable results explicitly
  report `persistence: "workflow_managed"`.

## Local verification evidence

All provider seams in these tests were injected or intercepted. The browser
suite starts its standalone server under `env -i` and defaults external browser
egress to deny. No DataForSEO, OpenAI, GSC, RDAP, Vercel production Workflow, or
other paid production call was made.

| Verification | Result |
| --- | --- |
| Focused unit and merge-interaction suite | PASS: 13 files, 272 tests |
| Profile plus Workflow component/client suite | PASS: 3 files, 24 tests |
| Workflow Vitest integration | PASS: 1 file, 2 tests; typed failure and active-hook redirect execute through the real local Workflow harness |
| Browser interaction suite | PASS: 10 tests; 3 website-profile scenarios plus 7 durable/legacy/evidence scenarios |
| Marketing TypeScript | PASS |
| Full workspace TypeScript | PASS: root E2E plus every workspace with a typecheck script, including Marketing, public-tools, sources, Product, and Worker |
| Changed-file ESLint | PASS on every changed TypeScript, TSX, and MJS file |
| Marketing production build | PASS: 270 static/dynamic pages, 18 Workflow steps, 1 Workflow, and the three managed internal routes |
| Secrets scan | PASS: 4 files, 75 tests, no OAuth token, API key, private key, JWT, or secret value found |
| `verify:docs` | PASS: 14 tests |
| `verify:authority` | PASS: 80 operations, 10 shared async operations, 84 tables, 12 rules, 53 migrations |
| `verify:spec:test` | PASS: 55 tests |
| Contracts / OpenAPI / deploy config / diff check | PASS |

## Known repository baseline exceptions

These failures were not edited or weakened to make the branch appear green:

1. Full unit suite: 928 files passed and one existing blog-content assertion
   failed; 13,733 tests passed and one failed. The assertion expects 80 English
   posts while the integrated content set contains 83. This branch does not
   change that test or blog content.
2. Full root lint first stops on two existing public-tools errors in untouched
   `seo-audit/keyword-evidence/extract.test.ts` and `seo-audit/model.ts` files.
   A separate full Marketing lint reports four existing errors in untouched files:
   `competitor-keyword-gap-tool.test.tsx`, `on-page-check-list.tsx`, and two in
   `draft-handler.ts`. Changed Workflow files pass scoped lint.
3. `verify:spec`: the active v0.4 lock already expects an older root
   `package.json` hash on `origin/main`; the Workflow script and dependency
   override necessarily produce a different actual hash.
4. `implementation:check`: the vendor manifest's `parse-page.ts` hash differs
   from the same source on `origin/main`; this branch changes neither file.
5. `pnpm audit --prod`: the new Workflow chain originally resolved
   `@workflow/core@4.8.5 -> nanoid@5.1.6`, which is covered by
   GHSA-28wg-ghj8-5hjv. A parent-scoped override now resolves only that chain to
   `nanoid@5.1.16`. The remaining High finding is the pre-existing
   `postcss -> nanoid@3.3.17` chain also present on upstream; it is not broadened
   into a Product-wide override in this Marketing-only release.

## Honest limitations

- This is durable checkpointing, not a claim of exactly-once provider billing.
  If a provider succeeds and the function dies before Vercel records that single
  step output, that one request can repeat. The design reduces the exposure to
  one keyword rather than replaying the full run.
- The browser's 24-hour pointer lifetime is not the same as Workflow storage
  retention. The UI describes them separately and does not promise App history.
- No database-backed customer run history, cross-tab project, Product activation,
  or publishing capability is introduced.
- A static build proving internal routes exist is not production registration
  evidence. Production completion still requires the exact merged SHA, READY
  Marketing deployment, custom-domain aliases, signed-out API boundaries,
  protected internal Workflow-route probes, and runtime-log review.

## Release evidence still required

1. Rerun the final frozen-SHA repository/type/lint/test/build gates after this
   document is committed.
2. Push the reviewed branch, create the focused PR, and inspect the exact PR
   changed paths and checks.
3. Merge only the reviewed head SHA and independently verify `origin/main`.
4. Verify the exact Marketing merge SHA is READY and aliased to `gengrowth.ai`
   and `www.gengrowth.ai`.
5. Run signed-out/no-provider production canaries for the page, start/status API,
   and Vercel-managed internal Workflow endpoints; inspect runtime errors without
   starting a paid keyword map.
6. Record the Product candidate separately from the actual `app.gengrowth.ai`
   production identity. A same-SHA Product candidate is not proof of a Product
   production release.
