# AI Visibility release preflight

Scope: Marketing `apps/marketing/**` only, based on main `977f0bc4f32bf8de453e059d3ddf444a7297bad0`. The user's current authorization is commit/push and production-readiness preparation. This record is not authorization to migrate production, merge into an automatically deployed main branch, or deploy Product.

## Changes and integration

- Artifact-aligned four-metric result hierarchy, input/result tabs, exact source disclosures, scoped gap counts, expandable answer/reference evidence and JSON/Markdown exports.
- All account websites and full confirmed Profile copies with explicit update/measurement review, immutable freezes and English-placeholder admission.
- Private stable report history/reopening, including honest summary-only V1 history, no provider/quota work on reads.
- Current main's Page Citability and GEO Brief changes retained. The shared browser harness keeps both the current real Brief load handler and new Visibility/KB readers.
- Release review found and fixed the remaining 31–32-feature downstream limit: Profile, frozen context, site evidence collection and report validation now share the existing source limit of32. Added actual enrichment→wire→export/import→record/read tests. Source33 remains rejected.
- Marketing gate repairs: the five already-main English blog additions are explicitly asserted alongside exact85/8 counts; removed three unused bindings/helpers; URL control-character rejection keeps the same behavior and adds NUL/unit-separator/DEL regressions.
- Source component tests use the shipped EN/ZH catalog, not local review files outside the deployable workspace.

## Production gate — migration before activation

Required migration: `supabase/migrations/20260831100603_geo_kb_profile_copy.sql`.

It extends only GEO payload capacity to384KiB and adds exact complete-Profile source/CAS checks. The authoritative Website Profile stays128KiB; old payloads, hashes, snapshots and question sets are not rewritten.

Do not merge/promote this release until an authorized operator completes:

1. Verify the actual project and run `ai-visibility-migration-preflight.sql` against the target. Do not assume local keys or a different connector account prove access.
2. Create a current backup of the affected Marketing tables and relevant function/ACL definitions in the approved secure backup location, outside the repository. Restore and validate it in a disposable environment.
3. Apply the migration atomically with bounded locks/timeouts. For an approved direct connection, use the existing migration runner's transaction support or `psql --single-transaction --set ON_ERROR_STOP=1`, with local lock_timeout5s and statement_timeout120s. Never execute an unwrapped multi-statement script in a way that can leave half the RPC replacement installed.
4. Repeat catalog, ACL, source-copy and immutable-history smoke checks. Validate that anon/authenticated cannot call privileged functions; only the service role has the intended RPC/read permissions.
5. Only then merge/promote the exact reviewed Marketing commit. Do not deploy apps/web or a worker.
6. Verify the real account website/old-history read paths. A paid sampling canary requires its own explicit budget; do not describe the local fixture run as a real provider canary.

The 0006 rollout note describes an older code-first incident. It is historical context, not the order for this migration.

## Rollback

Before any new-format copy is written, retaining the old application may be possible, but keep the additive database changes and verify reads; do not shrink payload constraints or delete snapshots.

After complete-copy snapshots exist, a blind rollback to an older parser can make those records unreadable. Prefer a forward fix or a compatibility rollback that retains the complete-copy parser, hash checks and updated source bounds. Never strip fields, recalculate historical hashes, mutate frozen questions, or run a destructive down-migration to make an old UI load.

## Current external-state evidence

Read-only Vercel inspection at release preparation:

- Marketing `gengrowth.ai`: `dpl_BqVgLUzWF7k9B6DNW1SGZKaLkH6m`, READY at `977f0bc4`.
- Product `app.gengrowth.ai`: `dpl_DzMBdEeuhxshcsqSt8UVttk75cc7`, READY at `de82f380bf2d531907bfad825dc4b755deced053`.
- These are pre-release identities, not proof that this change is deployed.
- Supabase connector project/catalog reads for the configured project were denied by its current permissions. Production migration/catalog/backup/restore remain unverified, and no production SQL was executed.

## Verification boundaries

Fresh release-candidate gates are recorded in `acceptance.md`. GitHub Actions is workflow_dispatch-only; do not claim automatic Actions checks. Vercel build/TypeScript does not replace local unit, SQL, lint or browser acceptance.

The977f0bc4 baseline has stale package.json/README lock entries and an audited nanoid3.3.17 dependency issue (GHSA-2v37-7h3g-55p8). A separate foundation PR patches the existing v3 override to3.3.18 and refreshes only the reviewed root lock entries. This feature PR depends on [foundation PR #270](https://github.com/phananhson733-oss/nevermore/pull/270) at59330b10; its own diff stays in apps/marketing. Root maintenance affects Vercel's Product build scheduling, so neither PR may be merged as an implicit Marketing-only production deployment. The combined candidate passed full/prod audit and verify:spec without exclusions; the exact code commit and fresh acceptance are in acceptance.md. Production access and activation prerequisites remain open.
