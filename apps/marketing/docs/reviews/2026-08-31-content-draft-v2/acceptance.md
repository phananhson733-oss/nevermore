# Confirmed Content Brief → Draft v2 acceptance

Status: local candidate, not production acceptance. Parent baseline is `9c389600858688efbad90d8cedd59d203804c4cb`; this report belongs to the scoped Draft v2 integration changes in the same commit. The latest user-supplied React Artifact is the UX reference, with SHA-256 `8d2a145047bbd83765d2120644f17826df82ca0939cb505d6fa5187922227cfa`.

## Implemented product boundary

- New generation uses an explicit Brief v2 contract. Draft accepts its exact confirmed revision, preserving edited H2/H3 order and frozen Q/source mappings; raw unconfirmed v2 and GEO documents receive distinct local guidance. Historical v1 stays exact and version-specific.
- Actual section evidence consists of scoped observed U units and permitted P facts. PAA can define a question but cannot support a factual claim. Rewrite receives the observed target and applicable keep/add/rewrite steps. Reordering never transfers gap-angle permission.
- Approved intent, format, do-not-cover constraints and internal links reach the model without granting new factual references. Related links are rendered once from observed confirmed candidate URLs, not model-generated URL text.
- Whole-question coverage reads all successful text. Failed/skipped planned ownership is not automatically none; no generated text is deterministically all-none without a coverage call. Unknown usage and unavailable coverage are not zero.
- Full-previous reruns change only one section, preserve settings/other sections, recompute coverage and bind the previous fingerprint. Current-call receipts avoid double-billing old section receipts.
- Each section uses bounded retries only for invalid model content, at most three concurrent workers, explicit per-call/run deadlines and an exact 96 KiB prompt budget. Late or missing usage is never invented.
- Browser imports, hash checks, late uploads and exports are guarded against stale revisions and unmounts. Handoff stages only on the explicit confirmed CTA or successful sign-in callback, using the existing one-time slot with a version-2 envelope; ordinary refresh clears the loaded state.
- Successful results fold settings and focus a named result region; reopening never submits or clears the draft. Failures keep the verified result and expose the error. Markdown retains failed/skipped H2 placeholders and actual successful H3, while JSON contains the exact whole result. Export receipts cannot leak across fingerprints or race a newer action.
- On-Page requires a user-entered published URL. It never assumes an update target is published, never puts the document in the URL, and never automatically audits or publishes content.

## Independent review and local evidence

Native independent read-only core review passed 9 files / 268 tests; later approved-guidance review passed 3 files / 264 tests. Independent UI/bridge review passed 5 files / 129 tests. These reviews used `pnpm exec vitest run --project unit`, not Bun. A previous false standalone-history requirement and malformed alias reproduction were explicitly rejected rather than changing a sound contract.

Root verification before final integration:

- Related domain/model/handler/UI/copy/client-boundary tests: **37 files / 1,135 passed** after the settings-fold fix.
- Public-tools, sources and Marketing typechecks passed. Changed TS/TSX ESLint and `git diff --check` passed.
- Secret scan passed; four redaction suites / 75 tests passed.
- Marketing production build generated 297 pages. The earlier combined browser run passed **56/56** on its exact pre-fold build; final-fold browser verification is recorded below separately.
- Repository docs, authority, implementation, generated contracts, OpenAPI and deployment-configuration checks passed.
- Full unit run before the CSS scanner repair: **16,124 / 16,126 passed**. One task-caused failure was the client graph scanner treating CSS as TypeScript. Exact `.css` static-leaf classification now has a real RED → GREEN, preserves unknown/non-CSS parse failures, and passes 22/22 scanner tests. The other failure is the unchanged blog inventory assertion expecting 80 English posts while main has 85.
- `verify:spec` remains blocked by pre-existing root `package.json` lock drift: current/main SHA-256 `a74695ffc0e01f84abdb369177ef1e512a4a9540c20bd60ae4b91d80b517b064` vs locked `767220c889b6d323a09fad5dfdb3a9b5e89969d9154cabbc204521271e867ccc`. Neither root package nor that lock changed in this task; no authority rebaseline was performed.

## Browser evidence limits

Final pre-main-integration verification (17:05–17:06 local): fresh Marketing build passed; all **56/56** combined Brief/legacy Draft/v2 Draft browser cases passed, including real settings reopen/no-submit and result focus checks. Root inspected desktop/mobile result viewport screenshots after the final folding change. These are synthetic fixture prose, deliberately not an example of live model writing quality:

- `desktop-zh-result.png`: SHA-256 `5f5e8263c0e55cc4892a87d55ff49dbae20bdf7d777a1d52bc84c50882702d5e`.
- `mobile-zh-result.png`: SHA-256 `a9e1187561ffd87e20c997defe91d588ecdb3e6aef188c93d6cc013fe213ebe0`.

Full unit rerun after the scanner/folding fixes: **16,141 / 16,142 passed** across 1,017 files; the only failure is the unchanged blog inventory count described above. Final independent increment review (settings focus, bilingual v2 public copy, CSS guard) passed 3 files / 70 tests. No provider or production call is included in those figures.

The standalone server starts under `env -i` with no provider/Supabase credentials. Tests intercept the API at browser-context scope, so popups cannot accidentally call paid services. They exercise actual producer editing/confirmation, real popups, signed-out peek, explicitly named manual-paste fallback, exact request/response/exports, CJK/PAA/update cases, unavailable branches and On-Page navigation. Authenticated automatic handoff and Google reload recovery have unit coverage, **not** a real-login browser PASS from this harness. Native middle click with no opener/sessionStorage remains explicitly tested as a browser limitation, not claimed as working handoff.

Fixed completions establish structure, provenance and behavior. They do not prove model semantic relevance, writing quality or factual truth. The separately bounded production Brief → Draft → one-section canary, current signed-in UI and exact Marketing release identity are still required. No provider call, CMS write, database migration, source upload to ChatGPT Pro or production deployment is represented by this report.

## Integration with newly landed main

The merge target became `077355d83f4486463f52f2ba5c66acb8880e7ab2` (GEO shared-content PR #261), after the earlier GSC and profile fixes. Its shared GEO Brief v1.1 capability is preserved alongside legacy SEO v1 and confirmed SEO v2. The legacy `schemaVersion: marketing-geo-brief.v1` report remains a distinct rejected input, and public copy now names all three supported Brief contracts accurately.

The handler merge added a regression check for GEO's original raw-wire byte ceiling: the larger v2 envelope must not let an oversized GEO section request acquire a slot, read private evidence or consume quota before 413. Independent handler merge review passed 8 files / 163 tests; independent UI merge review passed 4 files / 105 tests. GEO harnesses have explicit throwing v2 seams, not optional dependencies or real-provider fallbacks.

Final integrated evidence:

- Marketing build: **PASS, 299 pages**; Marketing/public-tools/sources typechecks passed.
- Explicit E2E TypeScript check using Marketing's strict/ES2023 policy: **PASS**. An additional stricter optional/indexed-access experiment exposed existing shared-client/GEO-fixture diagnostics; it is not represented as a passing gate and no unrelated code was changed to satisfy that experiment.
- Changed-source ESLint, secret scan + 75 redaction tests and diff check relative to the exact incoming main: **PASS**. Existing extra EOF blanks in incoming GEO review documents are retained, not cleaned up.
- Related integrated Draft/domain tests: **40 files / 1,150 PASS**; adjacent Brief/source/SSR suites: **26 files / 693 PASS**.
- Fresh isolated browser run: **60/60 PASS**, covering Brief, legacy Draft, confirmed-v2 Draft and incoming GEO A/D/B/C flows. The runner and standalone server were both credential-free; GEO SSR login is explicitly fixture-injected, not a real authentication claim.
- Full integrated unit run: **16,777 / 16,778 PASS**, 1,080 files. Only the unchanged blog inventory test fails (80 expected, 85 observed). All task-caused failures have separate reproduced fixes.

No Product, Worker, database, migration, environment or CMS change is introduced by the diff relative to incoming main. Those incoming features are not claimed as this task's implementation.
