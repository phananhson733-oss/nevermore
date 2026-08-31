# Content Brief v2 generation — local evidence

## Status and boundary

Local implementation on `fix/content-brief-artifact-20260831`, based on `a2fdd4ec`. This is not production acceptance. No provider calls, push, PR, production deployment, database migration or CMS writes occurred in this batch.

The original Artifact consistency goal remains open. The current work connects the actual generation functions and strict exported/confirmed contract, but does not complete the editing UI, versioned Draft consumer, browser handoff, or real semantic canary.

## Implemented scope

- Primary/supporting GSC scope preserves original query spellings and source window; low impressions and distant positions remain evidence, not permission to create another page. The 30-row / three-candidate bounds expose omissions.
- Canonical owned-page aliases use one candidate without deleting distinct GSC observation rows. Context validation rechecks property membership, page role and same-page redirect identity; a new fingerprint cannot legalize cross-property ownership or relabeled first-party competitor evidence.
- One bounded public-HTTP crawl reads competitor and owned pages into the real v2 extractor. Unsafe targets fail independently in the orchestrator, owned-page-replacing redirects are blocked, late results are excluded, and an owned destination never inflates competitor coverage.
- One complete model call generates questions, outline, intent/format judgments, page recommendation, rewrite steps, gap angle, owned links and do-not-cover topics. PAA supplies questions, never factual support. One supported question may form an outline.
- The actual serialized `{system,user}` prompt is at most 48 KiB. Page-unit packing preserves observation totals and PAA counters and retains at least one unit per observed owned candidate. The model response is validated against the exact packed context returned by the runner.
- Generated Brief and confirmed revision are separate exact schemas. Edited heading text/order retain stable section IDs and immutable question mappings. Unknown page ownership requires an explicit new-page resolution. Hashes are consistency checks, not source authentication or persistent revision history.
- The admitted run composes real SERP parsing, GSC projection, crawl/extraction, prompt, model validation and whole-brief self-check. Provider execution is bounded; timeouts preserve known usage rather than guessing a successful result. SERP charge and LLM token/call receipts remain separate.

## Fresh verification

At 14:11 Asia/Shanghai on 2026-08-31:

```text
pnpm exec vitest run --project unit \
  packages/public-tools/src/content-brief \
  apps/marketing/src/lib/tools/content-brief \
  apps/marketing/src/components/tools/content-brief \
  packages/sources/src/dataforseo/keyword-metrics.test.ts
36 files / 1095 tests passed

pnpm --filter @sf/public-tools typecheck
pnpm --filter @sf/marketing typecheck
both exit 0
```

Focused v2 verification: 9 files / 360 tests passed. `pnpm secrets:scan` passed, including 75 redaction tests. These are local/offline checks: fixed provider completions exercise the real call boundary and graph validation, not actual model semantic quality.

Spec re-review independently reproduced and closed all three property/alias/role findings and inspected the final run orchestrator. It passed 186 focused tests. Final independent read-only code-quality audit found no actionable findings, passed 351 tests across its eight targeted files, and passed both package/Marketing typechecks. Handler integration and the editing UI remain excluded from those completed review gates.

Two earlier intended read-only reviewers wrote out-of-scope implementation instead. Their output was not counted as independent review. The writers were stopped, file ownership was restored, their candidate changes were preserved, and a fresh read-only auditor without inherited task history performed the accepted spec review.

## Separate unreviewed handler candidate

The working tree also contains `content-brief-handler.ts` / `.test.ts` changes introducing explicit `response_schema` negotiation, defaulting to unchanged v1 behavior. These originated in the excluded reviewer work and are not covered by the generation batch's spec/quality gates. The root agent fixed the observed profile-count self-check failure and missing offline fixture dependencies; the 35 handler tests pass, but that is not enough for release acceptance.

Before accepting that candidate, independently verify:

- v2 admission/identity/quota/refusal behavior before all paid calls;
- exact request normalization versus the v2 context parser;
- one frozen GSC window across a UTC date boundary (do not derive it again from a later deadline);
- profile fact limits and explicit omission accounting;
- complete/partial/unavailable telemetry semantics and full acquisition detail preservation;
- legacy already-open clients and new producer/parser/consumer agreement.

## Required continuation

1. Finish quality review and checkpoint only reviewed code.
2. Complete and independently verify version-negotiated handler integration, including the pending issues above.
3. Implement the Artifact's outline editor/confirmation/export and the matching Draft v2 consumer without fabricating v1 objects or coercing GEO Brief.
4. Run the full fixed-evidence product matrix and browser flows, then the authorized Marketing PR/release and bounded real production canary.

Do not mark the active goal complete based on this report.
