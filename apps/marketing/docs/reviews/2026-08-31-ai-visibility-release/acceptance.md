# AI Visibility release-candidate acceptance

This record applies to tested head `e17d8e5583b73e95eba4cb45dea79ba61ac9eea2`, integrated with main `ca9ad4ddf6b5d2a48ead302d51e187c8a308f264` after PRs #273-#277. Foundation #270 is already merged and deployed. A later evidence-only commit may update this record without changing source, E2E, migration or dependency bytes; the exact tested Git tree hashes are retained in `browser-evidence.json`.

## Final gates

| Gate | Result | Scope |
| --- | --- | --- |
| Marketing unit | 436 files / 7,529 tests PASS | Full `apps/marketing` unit collection, run without concurrent build contention |
| Marketing lint | PASS | Full package ESLint, no rule disabled |
| Marketing typecheck | PASS | Full package TypeScript |
| Marketing production build | PASS | Build `SxKb-3Jkpi2civFvx02Xo`; 302 routes/pages; provider credentials cleared |
| GEO SQL | 6 files / 67 tests PASS | Dedicated disposable loopback PostgreSQL17 database |
| Browser | 48 PASS / 2 intentional manual-evidence skips / 0 failures | Seven suites: AI Visibility, Profile update, GEO chain, GEO Brief artifact/quality/repair and Page Citability |
| Dependency audits | PASS, no known vulnerabilities | Full and production-only audit |
| Spec verification | PASS + 55/55 self-tests | No exclusions or weakened checks |
| Generated contracts / deploy config | PASS | OpenAPI types and deployment topology unchanged |
| Secret scan | PASS + 75/75 redaction tests | No credentials committed |

The two browser skips require explicitly selected real capture and paid-provider receipt files. The suite never starts those calls itself. All other browser tests use the actual production build with explicit offline account/store/provider seams; they do not prove a paid production provider result.

## Latest-main integration and review

The normal merge commit preserves current main's Page Citability, GEO Brief repair/quality and Content Brief/Draft changes while retaining AI Visibility history, exact inputs, Profile-copy review, measurement selection and exporters. Eleven content conflicts were resolved as an explicit union; automatic GEO handler/harness merges were retained. Independent release review then found and closed two proper-name category blockers at both freeze and Visibility input boundaries. Unicode brand names remain valid proper names; genuinely non-English category wording remains blocked before paid work.

The final PR diff is Marketing-only. The one migration remains byte-identical to its reviewed version (`245b0d282991c37f1a9fb9436672010988b8f07a82fb8ee07dce6ec5af6409b4`).

## Production database evidence

Chrome and CLI access were verified against `nevermore / pxgzmoypkyyutpcmqexa`, not an old project. Before migration, the live catalog and an isolated PostgreSQL17 baseline matched: 10 tables, 75 constraints, 35 indexes, 12 immutable triggers and 17 present routines plus the expected absent validator.

A restricted logical roles/public-schema/public-data backup was retained outside the repository. It restored successfully into an isolated PostgreSQL17 cluster. All 10 table row counts/digests and routine definitions matched the pre-migration baseline. Applying the exact migration to that restored production data produced the expected after-catalog while every table row digest stayed unchanged.

The production migration then ran in one explicit transaction with `lock_timeout=5s`, `statement_timeout=120s` and a final `COMMIT`. Post-migration checks matched the reviewed after-baseline:

- 10 tables, 75 constraints, 35 indexes and 12 immutable triggers.
- Constraints MD5 `63d64686bab72a6d67faa7d726ddc487`; indexes/triggers unchanged.
- Validator plus save/freeze/context-freeze definitions match exact expected MD5s.
- All four are single-overload, empty-search-path, service-only `SECURITY DEFINER` functions; anon/authenticated execute remains denied.
- All 10 production table counts and row digests still match the restored backup.

This proves schema and data preservation at the migration boundary. It does not claim a paid-provider production canary. Production application deployment and authenticated page verification remain separate release steps.

## Browser acceptance

The current build covers EN/ZH, light/dark, 390/1440 input/result layouts, all account websites, exact source/frozen question disclosure, four headline metrics, truthful partial/insufficient states, stable owned history URLs, V1 summary-only history, safe answer/reference expansion and real downloaded JSON/Markdown bytes.

It also covers explicit complete Profile review/copy/measurement/save/freeze, immutable old snapshots, current GEO Brief quality/repair behavior, A/B/C/D/unattributed gaps and Page Citability's measured-versus-AI separation. Four representative images are retained in `screenshots/`; their data is synthetic acceptance evidence, not a production customer or paid-provider run.
