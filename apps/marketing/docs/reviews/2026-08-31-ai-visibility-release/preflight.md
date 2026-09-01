# AI Visibility production preflight and execution record

Scope: Marketing `apps/marketing/**`, tested head `e17d8e5583b73e95eba4cb45dea79ba61ac9eea2`, integrated with main `ca9ad4ddf6b5d2a48ead302d51e187c8a308f264`. The owner explicitly authorized production entry. Foundation #270 is already merged/deployed; Product automatic custom-domain assignment remains disabled.

## Candidate boundary

- Artifact-aligned input/result hierarchy, exact source disclosures, history and exports.
- All account websites plus explicit current-to-frozen complete Profile review and immutable snapshots.
- Current main's GEO Brief repair/quality, Page Citability and Content tools remain intact.
- The final feature diff is Marketing-only; do not deploy `apps/web` or a worker.

## Database execution

Required migration: `supabase/migrations/20260831100603_geo_kb_profile_copy.sql`, SHA-256 `245b0d282991c37f1a9fb9436672010988b8f07a82fb8ee07dce6ec5af6409b4`.

Completed against production project `pxgzmoypkyyutpcmqexa`:

1. Correct account/project verified in Chrome and CLI; stale projects were not used.
2. Metadata-only preflight proved the existing GEO v2/context chain was already installed and matched the local before-baseline.
3. Restricted roles/public-schema/public-data dumps were stored outside Git at mode 0600 under a mode 0700 directory. Only paths, sizes and hashes are reported; backup contents are not printed or committed.
4. The backup restored into an isolated PostgreSQL17 cluster. The exact migration was rehearsed there; 10 table row digests remained unchanged and the after-catalog matched exactly.
5. Production execution used one explicit transaction, `lock_timeout=5s`, `statement_timeout=120s`, `ON_ERROR_STOP` semantics through the SQL Editor and final `COMMIT`; the UI returned success.
6. Postflight catalog/routine/ACL checks and all 10 production row digests matched the expected after-state and restored backup.

The migration enlarges only GEO payload limits from 128KiB to 384KiB and installs complete-Profile source/CAS validation. Authoritative Website Profile limits stay 128KiB. Existing payloads, snapshots, hashes, questions and visibility runs were not rewritten.

## Rollback boundary

Do not shrink payload constraints, delete complete-copy fields, recalculate historical hashes or mutate frozen questions. After complete-copy records are written, an older parser may not read them. Prefer a forward fix or a compatibility rollback that retains the new parser, hash checks and source bounds. The additive database state can remain while Marketing aliases are rolled back to the prior application deployment.

## Remaining activation checks

- Merge only the exact reviewed Marketing head after GitHub/Vercel checks pass.
- Wait for `gengrowth.ai` and `www.gengrowth.ai` to be READY on the merge SHA; inspect build/runtime error logs.
- Verify authenticated account website, current Profile-copy, old history and export reads without starting provider work.
- Independently prove `app.gengrowth.ai` retained its prior production alias/deployment.
- A real paid Visibility sample requires explicit budget; no fixture result may be described as a paid canary.

GitHub Actions is workflow-dispatch-only. Local gates, Vercel builds, production migration and canonical-domain checks remain separate evidence tiers.
