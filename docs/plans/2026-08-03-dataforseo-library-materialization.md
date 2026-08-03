# DataForSEO Library Materialization — Implementation Plan

**Date:** 2026-08-03
**Status:** Implemented and verified locally — production backfill pending separate approval
**Authority:** `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md`

## Goal

Make Keyword Library and Competitor Library useful immediately after collection while preserving evidence honesty and historical reproducibility:

- show the mutable canonical library by default, including unreviewed GSC candidates;
- keep an explicitly pinned diagnostic run immutable and reproducible;
- expand DataForSEO discovery to ranking positions 1–100;
- fall back from empty domain overlap to seed-based SERP Competitors;
- materialize GSC, Crawler, Product Profile, and DataForSEO origins without relabelling inferred data as provider evidence;
- project successful collections into canonical libraries automatically.

## Non-goals and release boundary

- Do not execute paid production DataForSEO backfill during implementation or tests.
- Do not mutate historical v1 snapshots.
- Do not commit, push, deploy, or start production backfill without a separate explicit instruction.
- Do not make model-generated competitors look like DataForSEO observations.

## Read-model contract

| Request | Source of truth | Mutability |
| --- | --- | --- |
| Keyword/competitor list with no `diagnosticRunId` | Canonical current library | Editable/live |
| Review detail | Canonical current library | Editable/live |
| Keyword/competitor list or detail with explicit `diagnosticRunId` | Published generation frozen by that run | Immutable |
| Historical v1 collection snapshot | Existing v1 parser and metric contract | Immutable/read-compatible |

## Batch 1 — Current library visibility

1. Add RED service tests proving an unpinned list returns canonical candidates that are absent from the published generation.
2. Add current-list projections for keywords and competitors, including current governance, origins, metrics, pagination, and coverage.
3. Preserve explicit diagnostic-run pin behavior for published frozen lists and details.
4. Update Growth Map keyword and competitor tabs to request the current list/detail by default; retain pinned reads when a historical run is explicitly selected.
5. Run targeted service, route, hook, and component tests.

## Batch 2 — `search_landscape.v2`

1. Add versioned v2 scope and method identities while keeping v1 parsing unchanged.
2. Change live v2 policies to ranked positions 1–100 and competitor-domain maximum rank 100.
3. Add the DataForSEO SERP Competitors client seam, strict response parser, cost/usage accounting, and distinct metric identity.
4. Freeze at most 200 deterministic seeds in the child collection scope:
   - GSC top queries, ordered by impressions/clicks;
   - Crawler page title and H1 phrases;
   - confirmed Product Profile phrases.
5. Execute SERP Competitors only when competitor-domain overlap produces no usable rows and seeds are present.
6. Keep the collection atomic: failed required provider work must not expose a partial available snapshot.
7. Add RED/GREEN adapter and orchestration tests, including no-fallback, fallback, empty-seed, provider-error, cost, and legacy-v1 cases.

## Batch 3 — Projection, contracts, and compatibility

1. Teach keyword and competitor projection workers to accept both v1 and v2 identities.
2. Store DataForSEO domain-overlap and SERP-competitor observations as distinct real provider origins.
3. Preserve existing GSC/Crawler/Product Profile origin records and ensure canonical library upserts remain idempotent.
4. Add a forward migration for v2 method/dataset/metric guards while retaining v1 rows.
5. Update the active authority prose, generated schema/lock artifacts when required, source registry, runbooks, and user-facing limitation messages.
6. Add old-snapshot compatibility and automatic-materialization regressions.

## Verification and release handoff

Run, in order:

1. targeted RED/GREEN tests per batch;
2. package lint and typecheck;
3. full repository test suite;
4. production build;
5. migration/spec verification;
6. `git diff --check`, diff review, and security/PII review of frozen seed payloads.

After a separately authorized deployment, perform one paid production backfill and verify:

- the existing 185 GSC candidates appear without review/cluster prerequisites;
- DataForSEO provider usage records show the exact number and cost of calls;
- SERP Competitors runs only if domain overlap is empty;
- projected competitors retain their true origin kind;
- a pinned pre-release diagnostic run still renders from its frozen v1 generation.
