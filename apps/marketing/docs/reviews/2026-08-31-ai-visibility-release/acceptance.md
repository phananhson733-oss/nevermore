# AI Visibility release-candidate acceptance

This record applies to verified code commit `d872265f5c952552e1214587daaaf63e5afe6dfc` on foundation `59330b10e4fb5ca059a928cf002738e773032afe` ([PR #270](https://github.com/phananhson733-oss/nevermore/pull/270)), integrated with main `977f0bc4f32bf8de453e059d3ddf444a7297bad0`. Every gate below was rerun after the dependency patch except the local backup/restore drill, whose migration bytes are unchanged. This supersedes earlier local-only and pre-foundation evidence for release decisions. The final evidence-only commit changes no application, test, dependency or migration bytes; their Git tree hashes are retained in `browser-evidence.json`.

## Fresh gates

| Gate | Result | Scope |
| --- | --- | --- |
| Marketing unit | 417 files / 6964 tests PASS | Entire apps/marketing unit collection, no ignored blog failure |
| Marketing lint | PASS | Full package eslint, no rule disabled |
| Marketing typecheck | PASS | Full package tsc |
| Marketing production build | PASS | Build `3e-pG-1Nyo8Ul7b4Qx0sJ`;301 routes/pages; no provider credentials |
| Marketing Workflow | 2 tests PASS | Actual workflow integration harness |
| GEO SQL | 6 files /67 tests PASS | Fresh isolated loopback PostgreSQL17; not production |
| Local backup/restore | PASS |10 Marketing tables retained identical row digests, routine definitions identical |
| Browser | 35/35 PASS | Same candidate build; AI Visibility, Profile update, GEO chain, current GEO Brief and Page Citability |
| Dependency audits |PASS, no known vulnerabilities|Full and production-only audit; frozen install passes|
| Spec verification |PASS +55/55 self-tests|No weakened checks or baseline exclusions|
| Docs consistency |14/14 PASS|Repository gate |
| Implementation/authority inventory |PASS|80operations,84tables,53migrations,12rules unchanged |
| Generated contracts |PASS|OpenAPI-generated types match |
| Deploy configuration |PASS|Marketing/Product/Worker boundaries unchanged |
| Secrets and diff hygiene |PASS|No credentials/conflict markers/whitespace errors |

The browser layer uses real Next pages, handlers, statistics and exporters with explicit offline account/store/provider seams. It does not prove real production login, database catalogue state or paid provider behavior. The documented Visibility-only Flight-auth fixture hydration warning is test-only; no new app error is exempted.

## Release-review fixes beyond the earlier local candidate

The independent release review found a downstream defect after the earlier32-feature source fix: the site collector and persisted report validator still accepted only30. Both now use the canonical `WEBSITE_PROFILE_LIST_MAX_ITEMS`. Actual31/32 enrichment, wire, JSON import/export and store/read regressions first failed, then passed.33 remains invalid in the source contract.

Package-wide pre-existing failures were repaired without lowering guards:

- English blog count85 is tied to five published articles already in main; Chinese8, legacy URLs, draft exclusion and ordering remain checked.
- Three unused bindings/helpers were removed.
- The URL control-character check uses an equivalent code-point loop; NUL, unit separator and DEL must return400 without a provider invocation.
- Source UI tests import the deployed locale catalogue instead of local files outside the Marketing workspace.

The integration preserves all current main locale leaves and both shared-harness branches: current real BriefLoad plus Visibility context/history. It does not replace newer Page Citability or GEO Brief UI with an older checkout.

## Browser acceptance

Thirty-five cases cover:

- EN/ZH, light/dark,390/1440 input/result layouts, all websites, exact source and frozen question disclosure.
- Four headline metrics, question/answer denominators, partial/insufficient states, omitted excerpt honesty and safe reference links.
- Stable owned history URLs, refresh/reopen, V1 summary-only, unknown/foreign response paths and no implicit new run.
- Actual downloaded JSON/Markdown bytes and compatible local-file comparison.
- Complete Profilev2 review/copy, explicitly selected measurement updates, save, freezev2, exact selected run; oldv1 bytes and hashes remain unchanged.
- Existing A/B/C/D Brief/Draft/T2/third-party flows, gap counters and collapsed independently read-page table.
- Current main's GEO Brief and Page Citability visual/behavior regressions.

Four representative images are retained in `screenshots/` and hashed in `browser-evidence.json`. Their data is synthetic local evidence, not an AstrologyWiki production run.

## Known root baseline and production prerequisites

At977f0bc4, verify:spec reported reviewed package.json/README lock drift and audit reported GHSA-2v37-7h3g-55p8 in nanoid3.3.17. Both are handled by the separate foundation dependency, not hidden inside this feature diff. The feature remains Marketing-only relative to that foundation; foundation integration has its own Product build-scheduling boundary. Full/prod audit and verify:spec now pass on the combined code commit above without exclusions. Earlier baseline failures are retained as diagnosis, not presented as passes.

Production Supabase project/catalog reads were denied by the current connector permissions. No production backup, migration, restore or provider canary is claimed. See `preflight.md` and `ai-visibility-migration-preflight.sql`.

**The code-quality gates above are complete. Production activation is blocked until an authorized operator verifies access/backups, applies the required migration and approves the exact Marketing deployment. Keep the PR unmerged until that condition is satisfied.**
