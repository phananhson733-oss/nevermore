# Content tools Artifact completion — candidate verification

## Scope

This is the authorized Marketing-only implementation of the supplied Content Brief/Draft Artifact, including result quality, presentation, v3 source snapshots and exact cross-tool intake. It is not authority to publish generated articles, modify Product canonical origin, alter Railway or migrate data. External ChatGPT Pro review was explicitly waived; native independent code/content reviews were used. No customer source snapshots or credentials are included in this repository report.

The original worktree was preserved. Implementation began at `977f0bc4`, checkpointed as `78275b33`, and integrated upstream `82683994` in `6c38e20f`. The subsequent upstream Page Citability release `8e994e9c` must also be preserved before final release. Provider/browser evidence from earlier deployments is not proof of the final SHA.

## Contract and interaction decisions

- V3 Brief/confirmation carries the actual sampled SERP title/URL/read snapshot; v2 hashes/bytes and absence of that snapshot remain strict. Draft output stays v2 and freezes the real confirmed schema. The one-use handoff transport stays version 2.
- V3's private model response puts questions inside their section. The adapter derives public question/outline mappings, then invokes the existing strict validator. No partial invalid-output repair, invented references or protocol fallback is permitted.
- Keep all observed source units that fit the existing 48 KiB model-input cap. Above that cap, fair page quotas select relevant exact excerpts and rebuild the checked context, preserving original lengths/omission counts and every observed page. The experimental 24 KiB soft target was rejected because it discarded most evidence.
- The exact Luna caller uses low reasoning based on same-evidence real-provider comparison. Other callers/deployments keep defaults. Temperature/configuration, 30-second model ceiling, 4000 output tokens, 5-second envelope and one-call/no-retry policy are unchanged.
- Visible observations and source failures are independent of model success. Counts, units, unknown formats, quantiles and heuristic labels remain visible; long methodology is collapsed. Draft coverage leads prose, and source tiers remain separate from sentence claims.

## Verification performed before final release

- Independent contract/observation review: 699 tests at its frozen snapshot; nested-model helper additionally exercised exact keys, limits, duplicate/unknown references and inherited graph checks.
- Independent UI reviews closed the skipped-vs-failed copy bug and stale export receipt bug. Receipts now bind immutable result/confirmation/locale, not only a checksum that excludes elapsed time.
- Root focused final suites: **70 files / 2052 tests passed**, followed by Marketing and public-tools type checks.
- Full repository unit snapshot: **17146/17147 passed**, 1092/1093 files. The only failure is the unchanged blog inventory count in `apps/marketing/src/lib/blog-content.test.ts:167` (expected 80 English posts, actual 85). Later focused deltas are verified separately, not attributed to this older full run.
- Whole-repository typecheck passed. All changed TS/TSX paths passed ESLint. Whole-repository lint is not green: six pre-existing errors remain in five untouched paths: `packages/public-tools/src/seo-audit/keyword-evidence/extract.test.ts`, `packages/public-tools/src/seo-audit/model.ts`, `apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx`, `apps/marketing/src/components/tools/on-page-check-list.tsx`, and `apps/marketing/src/lib/agents/draft-handler.ts`. Diff against `82683994` for all five paths is empty; this change does not silently clean unrelated code.
- Secret scan and 75 redaction tests passed. Docs, authority, spec lock, implementation consistency, generated contracts, OpenAPI and deployment configuration passed. The previous spec-lock drift is resolved by the upstream security/lock update, not bypassed here.
- Two fresh Marketing builds passed. Credential-free standalone browser tests passed **77/77** twice, including real new tabs, exact exports, rerun lineage, legacy SEO/GEO, EN/ZH, desktop/mobile and light/dark. The second run verified compact fields at at most 380px for the desktop fixture and keyboard-accessible methodology. Later short-label/prompt deltas require a final build/browser pass.

## Real provider evidence and limits

The user's birth-chart production baseline had adequate observed sources but timed out. Local frozen-evidence probes exposed separate problems: a GSC query match was mistaken for a page-purpose match; gap sources were broader than the parser allowed; separate question/outline lists could diverge; semantic source associations could overstate coverage; and verbose rationale text could exceed the existing cap. The candidate addresses these without increasing source claims or changing parser limits.

The final saved low-reasoning birth-chart probe returned HTTP200 in **19.226 seconds**, one Luna call, 9466 input / 1217 output tokens, strict output acceptance, five questions and three sections. It selected a new general guide instead of rewriting a celebrity page, retained the relevant how-to PAA and direct excerpt references, and made inferred-profile differentiation tentative. This is local real-provider evidence against frozen sources, not a production-authenticated run or article factual approval.

An additional fresh real-source v3 pipeline for `content brief` completed in **18.760 seconds**, run `d0c40f60-cac2-4aba-bb28-85167eba9976`: SERP8/10, PAA4/4, competitor pages7/8, one Luna call (7454 input / 574 output tokens), four questions and two sections including H3, DFS cost USD0.002. GSC/profile were explicitly not requested and page action correctly remained undecidable. This exercised real collection/model/strict assembly locally after the admission boundary; it does not prove production authentication.

All model questions, plans and citation associations remain proposals for explicit user review. Programmatic reference checks do not prove semantic truth, exhaustive competitor coverage, publication readiness or site-wide absence of overlapping pages.

## Release status

Pending exact final commit/PR/Vercel production identity and post-deploy signed-in combined canary. Do not describe this candidate report as proof that the current Artifact-completion changes are already live.
