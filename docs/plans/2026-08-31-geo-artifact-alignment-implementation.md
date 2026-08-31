# GEO Artifact Input/Output Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the approved Artifact's complete input/output and content chain for the four existing GEO surfaces, with Settings → Website as canonical GEO asset entry and historical exact readability preserved.

**Architecture:** Add an account/site-bound GEO context to the existing immutable KB; collect and preserve actual provider/crawl evidence; version the shared Brief/Draft consumer for GEO rather than faking SEO inputs. Independent engine, rendering, and content-consumer modules can be developed in parallel with explicit file ownership; the primary agent owns KB context/database integration and all cross-module acceptance.

**Tech Stack:** pnpm monorepo, Next.js 16.2/React 19, TypeScript strict, Vitest/jsdom, Playwright for isolated local renderer/integration fixtures, existing Supabase and DataForSEO adapters.

---

## Execution rules

- Worktree: `/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/geo-artifact-alignment-20260831`; baseline 31 files / 759 tests passed.
- Complete scope: all 38 acceptance IDs; each task below has a concrete consumer or end-to-end proof. Do not close a requirement merely because a new type exists.
- All tasks: write behavioral tests → execute RED → smallest implementation → focused GREEN → spec review → quality review. Record commands and counts; do not alter assertions merely to obtain green.
- Local checkpoints only. The skill's usual commit step is intentionally deferred because this task is approved for local implementation, not Git/production writes.
- No hosted SQL, paid API calls, source upload, credential reads, forced Git cleanup, or unrelated worktree edits.
- Main owns shared integration, messages and migration changes; each worker is assigned disjoint module files. Workers must not revert others' work.

## Task 1 — Immutable asset/context evidence (SH-01, KB-02/04/06/07/08/09)

Files: create `apps/marketing/src/lib/geo-tools/asset-context.ts`, `asset-context.test.ts`, `asset-context-store.ts`, `asset-context-store.test.ts`; integrate `kb-handler.ts`, `kb-handler-deps.ts`, `kb-store.ts`. Add a CLI-generated local Marketing migration only after the context shape is frozen.

1. Test exact context: same account/site/Profile snapshot, role receipts, fact receipts, prompt-set hash; manual URL cannot yield crawl provenance. Include stale/mismatched user/site/hash and absent-context historical v1.
2. Run `pnpm vitest run --project unit apps/marketing/src/lib/geo-tools/asset-context.test.ts`; require RED.
3. Implement a versioned context envelope, deterministic validation and server receipt projection. Core discriminator: `source: {kind:'kb'|'crawl'|'gsc'|'profile'; evidenceId; observedAt; sourceUrl}`; crawl/gsc tags require trusted server read IDs, not client labels.
4. Add atomic owner-scoped freeze/context persistence; run local SQL tests twice against a disposable loopback DB. Never mutate historical payloads.
5. GREEN focused+KB suite, then two-stage review.

## Task 2 — Canonical website GEO entry (KB-01/02/03/04/09)

Files: create `apps/marketing/src/app/[locale]/account/websites/[websiteId]/geo/page.tsx`, `components/account/website-geo-editor.tsx` and tests; modify WebsiteProfileEditor navigation, existing GeoKnowledgeBaseTool props/load, scoped messages and route tests.

1. React/route RED: website owner reference loads inherited name/positioning/features read-only; shortcut reaches the same KB ID; no profile/owner mismatch leaks data.
2. Implement canonical route and common editor. Old URL stays functional, selecting a site uses the same linked asset. Saved drafts/history survive navigation.
3. Context header displays frozen KB/promptset identity; question table can reload and shows role+entities. Unsupported locale never silently displays en.
4. Run targeted React/handler tests, Marketing typecheck and locale-message checks. Review both stages.

## Task 3 — Actual KB enrichment (KB-05/06/07/08)

Files: create `geo-tools/kb-enrichment.ts`, `kb-enrichment.test.ts`, `kb-enrichment-deps.ts`, `kb-enrichment-handler.ts`, `kb-enrichment-handler.test.ts`, `app/api/tools/geo-knowledge-base/enrich/route.ts`; use existing public-fetch/Profile/GSC readers.

1. RED fixtures: 90-day query window and exact subject equality before private reads; failed grant skips roles/layers; HTML inference is not GSC; competitor name/aliases extracted with URL/time and manual confirmation; source failure never becomes zero.
2. Implement bounded competitor homepage parsing and deterministic query clustering, returning actual source records, not demo personas. No broad GSC caller-supplied property privilege.
3. Bind enrichment records to asset context/freezer; UI can review/edit with provenance downgraded for manual changes.
4. Run focused unit/handler+identity tests and no-provider integration fixture; review both stages.

## Task 4 — Multi-engine measurement and portable runs (V-01..V-06, V-09..V-11)

Files: own `geo-tools/visibility-*.ts`, `agents/geo-provider.ts` through a new provider adapter if possible, and `components/tools/ai-visibility-check.tsx/test.tsx`. New pure files: `visibility-engines.ts`, `visibility-export.ts`, `visibility-export.test.ts`. Do not modify migrations or central message JSON without main coordination.

1. RED: engine/question/sample unique slots, ChatGPT/Perplexity body differences, nullable actual search signals, mixed/engine denominators, confirmed-brand SOV excluding prompted questions, unavailable rank, failures cost/no retry.
2. Preserve V1 parse; new V2 report has engine manifests plus pooled metrics, question coverage, confirmed-competitor count and read-backed reference-page classifications. Default engine selection is explicit and output language follows frozen context.
3. Add run JSON import/export and two-file comparison with exact fingerprint/engine/market/language checks. Imported file never grants server run trust. Derive MD tasks from available gap/evidence fields, not generic model advice.
4. Wire engine UI/state/report to actual fields; output action stubs are forbidden. Integrate store changes through main owner.
5. Run focused provider/workflow/metrics/export/React fixtures, review both stages.

## Task 5 — Bounded site evidence and gap actions (V-06/07/08, B-01/02/12)

Files: create `geo-tools/site-index.ts/test.ts`, `gap-contract.ts/test.ts`, `gap-classify.ts/test.ts`, `gap-handoff.ts/test.ts`; integrate Visibility report and Brief run resolver.

1. RED: no index/T2 or insufficient measurement => unattributed; A only for reliable missing content evidence; B for actual relevant page failures; C for independently observed third-party presence gap; D for measured competing list position. Include multiple eligible/no eligible cases and fixed reason precedence.
2. Implement bounded safe site index with actual fetched page records and source completeness. Gap cards reference real sample/page/rule IDs and calibrated thresholds; no action-completion attribution.
3. A/D handoff to Brief, B to T2, C export third-party todo and reject content generation. Server resolves run ownership/snapshot; client counts are never accepted as authoritative.
4. Run pure and full pipeline fixtures; review both stages.

## Task 6 — Actual T2 render evidence and deterministic root causes (C-01..C-05)

Files: create `geo-tools/citability-render.ts/test.ts`, `citability-causes.ts/test.ts`, `apps/marketing/scripts/citability-renderer.ts` plus fixture tests; modify `citability-contract.ts`, `citability-handler.ts`, `citability-rules.ts`, `components/tools/page-citability-check.tsx/test.tsx` as needed. Dependency/lock changes require main coordination.

1. RED: actual JS fixture increases body text, raw/render ratio matches both captures; missing renderer/timeout is explicit failed evidence; no cookie/auth/private-network/serviceworker/WebSocket egress; per-request/total byte/time limits; page failure is not scored pass.
2. Implement real isolated render service and adapter with public safe fetch for every request. T2 remains anonymous, two-stage deterministic/no LLM. Root causes group rule dependencies and explain which failures share rendering evidence.
3. Keep unknown/advisory/notApplicable independent. Correct Google-Extended training/grounding/Search language using current official docs.
4. Run renderer browser fixture and unit/React/security tests; review both stages. A configured adapter without a working renderer is not completion.

## Task 7 — Shared GEO ContentBrief v1.1 and Draft consumer (B-03..B-11)

Files: package owner may create `packages/public-tools/src/content-brief/geo-contract.ts`, `parse-geo-brief.ts`, `geo-draft.ts` and tests, update package public exports; integrate `apps/marketing/src/lib/tools/content-draft-handler.ts`, `content-draft-llm.ts`, `content-brief-handoff.ts` and consumer components/tests. Keep SEO V1 behavior exact.

1. RED: GEO source union cannot pass SEO parser; valid GEO 1.1 roundtrips its deterministic fingerprint; changing fact/origin/sample/outline invalidates it; unknown fields and unsupported origins fail closed.
2. Implement explicit GEO contract including geo_origin, KB lead/Q1, observed topic clusters+coverage+candidate/hidden counts, verified fact_table, model outline, format derivation, unavailable length/verdict and actual site-index links. No fabricated SEO ledgers.
3. Shared Draft adapter selects verified KB/crawl facts, not AI sampled answer claims. Extend sentence source/evidence validation; null/conflicting facts cannot support bound claims. Preserve coverage for all immutable requirements.
4. Shared fixed-key/TTL/single-use handoff parses correct version; GEO Draft goes to T2 and SEO stays On-Page. Existing SEO fixtures must pass unchanged.
5. Run package+Draft handler/validator/React/handoff tests; review both stages.

## Task 8 — GEO producer/output UI and end-to-end chain (all B + SH)

Files: main owns `geo-tools/brief-contract.ts`, `brief-assemble.ts`, `brief-handler.ts`, `brief-handler-deps.ts`, `brief-export.ts`, `components/tools/geo-brief.tsx` and new React tests; update only assigned message subtrees and tool links.

1. RED: complete frozen evidence handoff → shared V1.1 output; manual question has no run evidence; C rejected; KB Q1 stays source=kb; multi-sample coverage excludes failures; format D/A correct; no evidence regenerated by client.
2. Implement producer against Task7 shared contract, using Tasks1/4/5 trusted data. Render geo_origin, sources/times, KB lead, topic counts, fact table, outline links and honest unavailable fields in Artifact order.
3. Make JSON/MD/Copy/display/handoff derive from one result. Add draft handoff and return T2 route.
4. Run integration fixture through same real handlers and components; renderer fixture is actual JS execution, providers remain deterministic offline responses.
5. Review both stages; no claims from stale output after edits.

## Task 9 — Completion audit (all 38)

Create `apps/marketing/e2e/geo-chain.spec.ts` or repository-equivalent mock test, plus a requirements→test registry under the audit directory. For each requirement inspect actual implementation, negative cases and consumer use; evidence-only types do not count.

Run: all GEO/package/Draft/identity units; Marketing lint/typecheck/build sequentially; docs/implementation/spec gates when shared package paths are affected; secret scan; local SQL integration; anonymous T2 and authenticated Settings/Visibility/Brief/Draft browser fixture; JSON/MD/run import roundtrip. Preserve unrelated baseline failures explicitly. Final report names what is local, what requires services/env, and what was not authorized for production. Do not mark goal complete if any original requirement remains incomplete.

