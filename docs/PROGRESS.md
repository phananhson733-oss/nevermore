# Nevermore / GenGrowth Progress

Updated: **2026-08-06**

This is the current authority and verification handoff for the Nevermore
repository and its customer-facing GenGrowth product. It replaces the retired
v0.2 progress narrative. It deliberately separates commands rerun on the current
convergence worktree from older evidence recorded in checked-in stop gates.

## 2026-09-14: workbench UI port PR-3 first five views (in review on the integration branch, not in production)

PR-3「首批五页」is on branch `feat/workbench-pr3-first-views`, opened for
review against the integration branch `feat/workbench-ui-port`; nothing
reaches production before PR-3b (integration branch → `main`). Plan and
rulings Q1-Q37: `docs/plans/2026-09-13-workbench-pr3-first-views.md`; design
doc rev8 carries them back. Final code for this entry: `27c7798a` (the copy
ruling list below was written against `60acf7a0`). The copy rulings of
2026-09-14 are in (`d6d3764c`, `23c0fe53`, `fae6e640`, `db074fd0`,
`ac74b802`, `a8c89b6e`, `60acf7a0`):
- the sample-data chip title now says module results are samples and imported
  GSC rows are not, and the imported-rows footnote adds "not a sample";
- the weekly-report notification description says "近 7 天";
- the week page's empty title and the disabled-report hint describe the current
  state without a date range, because emptiness is judged on the whole store;
- the borderline band is written ">10 且 ≤30" instead of "11-30";
- exported documents print `n/a` for unavailable values;
- two dead i18n keys are gone.

Done on the branch (each task: one implementation agent plus a Claude review
with mutations in a detached worktree, and gpt-6-astra surfaces per the plan's
review section):

- Views: overview with「载入示例站点」(`6ec05d23`), week covering today and the
  previous 6 local dates with a weekly-report artifact (`dd01a8cc`, window
  `0796e043`), site profile (`188d248b`), data sources — real GSC / GA4
  connection read-only plus a local GSC import (`98895420`), settings —
  notification preferences and a sources summary next to the unchanged real
  delete (`96057413`). The other ten segments still render the placeholder.
- Shell: the site card's GSC row reads the real connection state on the client,
  and unknown is never shown as "not connected" (`e048be6a`); topbar「清除示例」
  with a confirmation (`3f058f8c`).
- UI primitives and the artifact pipeline (`2ccb6c69`, `a5d686c7`,
  `4dbbeb96`): one stamping point (`useAddArtifact`); the provenance sentence
  follows the GSC source of each artifact's own body, in three versions (Q36:
  `b2c7a015`, `aa89896b`, `f4fb8ad2`, `d5909ada`); an artifact over the size cap
  or into a full basket is refused and explained, never truncated or evicting
  the oldest (Q37, `76f6aaa8`, `65462c15`).
- Store: `gscRowsSource` and `ProfileDoc.gscSource` (pre-ship exemptions 4 and
  5, `PERSISTED_VERSION` stays 1), `hasDemoOverwrite` by value, confirmations
  bound to the content they showed (`11c5abb8`, `0143d341`, `79268c3a`);
  `parseGsc` reports header recognition (`29c2b654`); GSC import dedupes by
  query and caps at 2 MB / 5000 rows (`fb2adde3`).
- PR-1 leftovers A-F: font and `workbench.css` mounted by the project layout
  with `@theme inline` (`0c278c60`); drawer and bare-link touch targets
  (`02a0ed03`); ⌘K hint by platform (`b0931ba4`); Tailwind `source(none)` plus
  a value-flow scan-scope guard (`407d291d` and follow-ups); dead `AppShell`
  project variant removed (`b40804e5`); `useGlobalShortcut` latest-ref
  (`51682fad`, `0a5e10ce`, `736f2b78`). The mutation evidence for each goes into
  the PR description at delivery.
- Client import-graph guard extended to the view entries (`08e96d53`,
  `9cb0e217`); `ui/` may not import `shell/`, and non-literal loads fail the
  gate (Q35, `37ae84c2`, `6d2e4e71`, split into three files `b7e852a7`).
- T17 mock e2e: specs `pr3-flow`, `pr3-views`, `pr3-a11y` plus additions to
  `shell` and `parity` (`5881ee7b`, `9467da01`, `2ebc37e6`, `de68031d`,
  `536cf97d`, `ac03bd88`, `e08ae173`, `3d41f46f`, `dcf60040`, `67a7d8ad`).
  Running them in a real browser found a production defect: below 1280px the
  sample chip covered the hamburger at 390px and the topbar overflowed at
  768-1024px. The topbar now splits into two rows below `xl` in unchanged DOM
  order (`4af1ef6c`, `b8915323`, `bb8eadbc`); the switcher focus ring, the 1px
  overhang and the 40px switcher height below 768 were fixed in the same pass.
- T18 docs sync: design doc rev8 (§4.3 two-row topbar and Dialog focus-return
  rules, §14 PR-3 review dispositions), the PR-2 plan residual table, the PR-3
  plan residual table.
- Pre-delivery acceptance (three gpt-6-astra surfaces: honesty, real vs sample
  partition, a11y and CSP, each with a re-review round): the week page says only
  what it can prove and its clock follows midnight (`3a64da98`, `d9522ed1`);
  visible GSC source footnotes next to imported rows (`9dc7c575`); Dialog focus
  return validates each target and falls back to `<main>` (`72c5792f`,
  `4f491a57`, `7caf8cd9`, `49b1f269`); Tabs no longer claims a selection for a
  value outside the list (`0f1c78b7`). Seven no-parameter honesty sentences are
  pinned as whole strings in en and zh (`8654235e`, `6b3f3df5`).

History is not rewritten (plan T19 Step 7b): 114 branch shas (as of `27c7798a`)
are cited in the plan, the design doc and this file. Two commits are red on
their own and should be skipped in `git bisect`: `b7cba98b` (2 tests, green at
`2f5b836b`) and `23c0fe53` (1 test, green at `fae6e640`).

Verification on `27c7798a` (T19; later commits are docs-only and re-ran
`pnpm verify:docs`):

- typecheck / lint / typecheck:e2e / lint:e2e: exit 0.
- `pnpm test`: 1401 files, 25034 tests, 25030 passed and 4 failed; all 4 are the
  pre-existing `apps/marketing/e2e/geo-kb-v2-fixtures.test.ts` failures
  (`store_unavailable`), none outside that baseline.
- Unit coverage: global lines 89.7%, statements 87.55%, branches 82.7%,
  functions 91.01%; `lib/workbench` 99.81%, `components/workbench` 99.31%, no
  file below 80% lines. Of the 130 non-test files under those two directories
  only `components/workbench/shell/WorkbenchShell.tsx` is absent from the report
  (an async server component with no branches, rendered by every workbench mock
  e2e). With baseline failures present vitest 4 writes no report unless
  `--coverage.reportOnFailure=true` is passed.
- `pnpm --filter @sf/web build`: exit 0 (Next 16.2.11, Turbopack). Purity greps
  and the Tailwind scan-scope check on the built CSS pass.
- Mock e2e, one lane, no reruns: 10 specs, 123 passed, 0 failed, 0 flaky.
- Production smoke on `/login` (`next start`, placeholder env): 200, no
  `unsafe-inline`, every script carries the nonce, no `<style>` and no style
  attributes in the server HTML, 0 console messages. One
  `securitypolicyviolation` event: `script-src` blocks zod v4's `Function("")`
  probe, which zod catches itself; no CSP report endpoint is configured, and the
  base `423ebfaf` already loads zod on `/login` through the same import chain.
- Build-artifact checks: `mock/demo.ts` is only in its own async chunk, not in
  the overview's initial JS; `workbench.css` does not reach `/login` or
  `/new-project`. **The workbench font does**: Turbopack merges the Plus Jakarta
  `@font-face` into a CSS chunk shared with eleven CSS modules, and
  `next-font-manifest.json` preloads its 27 KB woff2 on 28 of 30 entries,
  including `/login` and `/new-project` (the `/login` response carries the
  preload header). At the base the face sat in the root layout and every entry
  preloaded it, and `/login` loaded all of `workbench.css`, so this is better
  than the base but PR-1 leftover A is only partly closed in production. The
  mock e2e runs on `next dev --webpack` and cannot see this.

Still open:

- Owner decision pending: the artifact basket's「清空」and per-item「删除」have
  no confirmation and no undo. If a confirmation is chosen, `ui/Dialog.tsx`
  must first return focus to the lower dialog when the upper one closes (plan
  residual table).
- The workbench font preload on `/login` and `/new-project` (candidate
  `preload: false`, unverified under Turbopack), to decide before PR-3b.
- Known gaps, stated as such: authenticated workbench pages have no
  production-mode fixture, so the production smoke covers `/login` only and does
  not verify the workbench pages' CSP, fonts or dynamic chunks at runtime;
  headless Chromium does not paint native `title` tooltips or native `select`
  menus.
- Residuals for PR-4/PR-5 and PR-3b are in the PR-3 plan's「不在本 PR」table.

## 2026-09-13: workbench UI port PR-2 mock domain layer (integration branch, not in production)

PR-2「mock 域层」is on branch `feat/workbench-pr2-mock-domain`, targeting the
integration branch `feat/workbench-ui-port` (not `main`; nothing reaches
production before PR-3b). It adds no views. Scope: the jsx prototype's pure
functions ported to `apps/web/src/lib/workbench/mock/` (deterministic rng,
text, local wall-clock stamps, market language; CSV, fenced data blocks and
the provenance stamp; GSC paste parsing; keyword matrix; audit; AI visibility;
competitors and backlinks; site profile and knowledge base; content outlines
and answer plans; the demo site generator `makeDemoSite`) plus the artifact
builders in `mock/builders/`;
enum id arrays in `lib/workbench/enums.ts` with `workbench.enums.*` labels; the
`keywordRows` / `gatedRows` selectors and their provider wiring; and a
read-only persistence mode. Rulings R1-R17 live in
`docs/plans/2026-09-13-workbench-pr2-mock-domain.md`; design doc rev7 carries
them back.

Changed from the PR-1 plan: the `deriveKeywordRowCount` prop is gone (R13).
The provider imports `buildRows` itself, memoizes on seeds / brand /
competitors / GSC rows, and exposes `keywordRows` and `keywordRowCount`. The
visibility badge rounds the exact share (R15). Storage written by a newer build
(only unknown keys) now makes the tab read-only instead of being overwritten
with the initial state (R14), and every write re-reads and classifies the
stored value first so an older tab cannot overwrite newer data before the
`storage` event arrives. Three pre-ship exemptions keep `PERSISTED_VERSION` at
1: `GscSignals` counts and `LinkTarget.dr` / `difficulty` became nullable, and
the crawl signal `indexed` was renamed `indexable` (the audit only knows
"indexable"). Sample content no longer borrows GenGrowth's own facts (R8),
invents competitor domains (R9), presents generated signals as observations
(R10), compares the brand or its own domain with itself, or stamps the demo in
the future. Prompt builders put user fields only in fenced data blocks (R6),
document values are escaped against block-level Markdown (`docText`, checked
with the `marked` lexer), JSON artifacts escape `<` / U+2028 / U+2029, and CSV
cells are formula-neutralized (R7). `mock/brand.ts` keeps the audit rule
library out of the client bundle, pinned by
`store/client-import-graph.test.ts`. Deferred to later PRs (R17 plus the
residual table at the end of the PR-2 plan): `llms.txt` downloading as
`llms.md` (PR-5); CSV BOM, keyword CSV row cap, audit report builder,
`visPartial` export timestamp, run leases and non-English/German GSC header
labels (PR-4); sample badges, dynamic import of `mock/demo.ts` and the
null-rank / null-DR renderings (PR-3 / PR-5).

Verification on code HEAD `04f8ae22`: `pnpm typecheck` / `lint` /
`typecheck:e2e` / `lint:e2e` exit 0; `pnpm test` 1331 files / 23642 tests with
only the 4 pre-existing `apps/marketing/e2e/geo-kb-v2-fixtures.test.ts`
failures; `lib/workbench/**` coverage 99.49% statements / 96.89% branches /
99.83% lines (only the unchanged PR-1 `store/hooks.ts` is below 80%);
`@sf/web` build exit 0; mock e2e (workbench-shell, legacy-style-parity,
critical-flows, frontend-error-states) 56 passed; production CSP smoke on
`next start` `/login`: no `unsafe-inline`, 0 inline scripts or style
attributes without a nonce, no CSP console errors; mock purity grep clean;
`verify:docs` / `verify:spec` pass after the lock refresh. Cross-model review
(gpt-6-astra, three surfaces): honesty 4, parsing 6, state 2 findings, all
fixed (dispositions in design doc §14).

## 2026-09-11: workbench UI port PR-1 foundation (integration branch, not in production)

PR-1「工作台地基」landed on integration branch `feat/workbench-ui-port` (PR
sourced from `feat/workbench-pr1-foundation`). It is **not merged to `main`
and not in production**. Scope: a new workbench chrome (dark rail with 15
sections across 6 groups; light topbar with project switcher, ⌘K command
palette, sample-data chip, and artifact drawer); 15 placeholder routes at
`/p/<id>/<segment>` (the 设置 route already carries the real delete action);
a per-project mock store at `apps/web/src/lib/workbench/store` persisted to
`localStorage` under `gg.workbench.v1.<id>`; Tailwind v4 scoped through
`.wb-reset` plus `workbench.css`; a new `workbench` i18n namespace; and a
legacy-style parity spec together with `e2e/workbench-shell.mock.spec.ts`.

旧页去向: the old overview now lives at `/p/<id>/legacy/overview`;
`growth-map`, `context`, `setup-sources`, `sources`, `studio`, `execution`,
and `results` keep their existing paths but now render inside the new
chrome, and 9 of the 15 new pages carry a 「旧版页面 →」 link back to the
one(s) they replace (`LEGACY_LINKS` in `apps/web/src/lib/workbench/routes.ts`;
week / visibility / links / kb / artifacts / settings have no legacy page);
`diagnosis`, `plan`, and `report` remain redirecting compatibility aliases,
unchanged.

Known deviations from `docs/plans/2026-09-11-workbench-ui-port-design.md`,
recorded here rather than silently absorbed: the `audit` legacy link targets
`growth-map` (since `diagnosis` is itself only a redirect); the style-parity
baseline screens are `growth-map` and `sources`; `globals.css` element rules
are guarded with `:where(:not(.wb-reset *))` so they do not leak into the new
chrome; and `postcss.config.mjs` restates Next's default plugin chain ahead
of `@tailwindcss/postcss` rather than relying on implicit ordering.

下一步 (design §9): PR-2 is the pure mock domain layer — `lib/workbench/mock/*`
(`makeDemoSite`, `buildRows`, … ported from the jsx as pure functions with unit
tests) plus the `keywordRows` / `gatedRows` selectors and their provider
wiring (PR-2 dropped the planned `deriveKeywordRowCount` prop, see above); no
views. PR-3 is the first five named
pages (overview with 「载入示例站点」, this week, site profile, data sources,
settings with its notification + data-source blocks); PR-3b merges the
integration branch to `main` (first production release). PR-4 / PR-5 then
carry the per-module flows (keywords / keyword library / competitors / audit /
AI visibility; content / knowledge base / answers / backlinks / artifacts) on
`main`. Per 决策 D3, this integration branch merges to `main` only after
PR-3 lands, not before.

## Active identity and authority

- Integration branch: `codex/content-research-quality-v04`
- Final v0.3 baseline already integrated into `main`:
  `1f3a2daebc8d426a58eb236d2ac3409d1d6bbbb2`
- Complete customer Artifact verification anchor before this progress-only
  update: `c404703796dda6d09d524e5ba26b57ccaa4c9c16`
- Nevermore program root: `/Users/wzb/Code/nevermore`
- Git repository common directory:
  `/Users/wzb/Code/nevermore/signalframe-mvp-app/.git`
- Application worktree:
  `/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/unified-growth-opportunity-v03`
- Product version: **0.3.0**
- Contract version: **2026-07-21**
- Active authority: `authority/implementation-spec-v0.4/`
- Machine lock: `scripts/spec-v0.4-lock.json`
- Migration range: `0001_init.sql` through
  `0053_keyword_governance_suggestion_locale_authority.sql` (**53 ordered migrations**), after
  `0048_topic_model_generation.sql`, `0049_projection_batch_writes.sql`,
  `0050_product_profile_keyword_lineage.sql`, `0051_keyword_review_suggestions.sql`,
  and `0052_keyword_governance_schedule_requests.sql`
- Contract inventory: **80 API operations / 11 async operations / 84 app tables / 12 frozen rules**
- Current deterministic versions: `mvp.rules.0.2.4` /
  `mvp.prompts.0.2.0`; current Growth Audit projection:
  `growth-audit.0.3.1` (capability version remains `0.3.0`; request/addressing
  contract remains `growth-audit.0.3.0`).

The Artifact verification anchor above is the exact commit inspected before
this progress-only change. A tracked file cannot contain the hash of the commit
that contains itself; therefore the final integrated SHA must always be read
with `git rev-parse HEAD` and then compared with deployed
`/api/mvp/health/version` and Railway startup logs.

## Naming, navigation, and current boundary

- Internal repository/product program: **Nevermore**.
- Customer-facing product brand: **GenGrowth**.
- Compatibility identifiers such as `signalframe-mvp-app`, `@sf/*`,
  `signalframe.*`, historical exports, database names, and problem-type URLs
  remain implementation details.
- Customer UI is Chinese-first.
- Primary project navigation is exactly:
  `概览 → 增长地图 → 执行中心 → 效果追踪`, implemented by canonical
  `/overview`, `/growth-map`, `/execution`, and `/results` project routes.
- `/context` and `/sources` are secondary routes. `/diagnosis`, `/plan`,
  `/studio`, and `/report` remain redirecting compatibility aliases, not
  primary navigation.

Slice 1 status: **complete**

Slice 1 established the four-route customer baseline, versioned Growth Audit,
URL-first Product Profile, multi-URL Growth Map, bounded Keyword and Competitor
libraries with source lineage, single primary Finding → single Action behavior,
and immutable prior/new recheck projection into Results.

Slice 2 status: **complete**

Slice 2 established Content Shadow as an internal, traceable flow: a confirmed
content Finding creates one Action and one content brief; a run freezes its
research inputs, creates an `english_blog_draft`, records deterministic QA, and
binds human review to an exact revision.

Content Shadow state: **reviewed, not published**

Current v0.4 external-write boundary: **no external writes**

The active v0.4 contract has no GitHub, WordPress, CMS, Vercel, Cloudflare, or
customer-production-site write and no post-publication attribution. Internal
Content Shadow, approval, publication-preview and Measurement Window persistence
are implemented; the current 80 operations still do not execute an external
provider write. A preview or Delivery Receipt is not a live change. Only a
verified Change Receipt with a live canonical URL may anchor observation.

Historical customer Artifact checkpoint: **complete, not production data**

The complete Chinese-first customer Artifact is generated from repository-owned
source under `docs/artifact-src/`; it remains deterministic test and review
collateral, not a production data fallback. The historical visualization
directory is provenance-only and is not a build or verification input. The generated
interactive Artifact and product manual use one canonical scenario model:

- **12 URLs**, each selectable with URL-specific detail and result status;
- **12 Keywords / 6 Topic Clusters / 9 Competitors**, with ingestion and
  evidence provenance;
- **11 Artifacts / 18 immutable documents / 18 Revisions**, including
  Technical Ticket, Metadata Rewrite, Content Brief, English Blog Draft, QA,
  Revision Review, Publish / Change Receipt, UTM Plan, and Results;
- **12 page observations**, of which five have a fixed-window observed or
  insufficient-data state and seven are explicitly unavailable or not
  observed—never fabricated as zero;
- exactly **three customer-managed connections**: GSC, GA4, and a planned
  GitHub position.

All four modules are complete customer surfaces rather than implementation
narration. Primary routes, Growth Map modes/selections/pagination, Execution
selection, Results tabs/window, and overlays are encoded in hash-query history.
Cross-module jumps retain the exact target through reload, Back, and Forward.
The standalone files have no network dependencies and no Nevermore,
compatibility-name, workstation-path, or internal-audience exposure.

Current implementation surface: **complete four-module workbench（完整四模块工作台）**

The active surface includes frozen external research, first-party content,
content-quality gates, Keyword/Competitor governance, Topic/Internal
Link/Backlink/GEO growth paths, execution state, durable approval, publication
preview authority and immutable measurement windows.

Analysis Refresh and published-generation reads are part of this same
four-module surface:

- New `createAnalysisRefreshRun` parents own the fixed seven-step
  `analysis-refresh.plan.v3`: Crawl → connected GSC → connected GA4 →
  DataForSEO Search Landscape (DFS) → `dataforseo_backlinks` → optional internal
  Topic Model generation (`topic_model`) → Growth Audit. Historical five-step
  `analysis-refresh.plan.v1` and six-step `analysis-refresh.plan.v2` parents
  remain exact and resumable. The public collection command remains exactly
  `crawl|gsc|ga4`; it cannot accept DFS/Backlinks/Topic targets, market,
  language, limits, credentials, provider queries, or model options.
- The internal Topic child freezes bounded input/resource and invocation-attempt
  ledgers. Its model call occurs outside database transactions; a prior
  `reserved` or `outcome_unknown` attempt blocks silent retry, and no browser
  create/reservation/provider-options API is exposed.
- DFS v3 runs frozen ranked-keywords and competitors-domain requests at
  positions/max-rank 1–100. Only when retained domain overlap is empty, it uses
  frozen GSC/Crawl/Product Profile seeds for at most one paid SERP Competitors
  fallback, then atomically persists one `dataforseo.search_landscape.v3`
  Snapshot with canonical organic-overlap operands/ratio and immutable
  competitor-origin lineage. DFS v1/v2 remain exact read-only history. Its
  separately default-off `DATAFORSEO_AI_CITATIONS_ENABLED` AI citation
  sub-capability runs only for an exact frozen cohort of 20 approved,
  mapping-confirmed GenerativeQuery rows; 19 or fewer and the 21-row overflow
  sentinel both skip without provider calls. Partial provider success is not a
  published Search Landscape.
- Ranked-keyword observations retain DataForSEO KD only as an integer `0..100`
  or `null`, plus canonical provider search intent or `null`; malformed present
  values fail closed. The resolved `searchIntent` authority order is
  user-confirmed → exact provider-observed → invocation-backed LLM-generated →
  governed legacy → unavailable, and a published generation never reads newer
  observation, review, or invocation lineage.
- DataForSEO Backlinks remains separately default-off and cost-capped. When
  explicitly enabled on both Web and Worker, it writes one
  `dataforseo.backlinks.v1` Snapshot, exposes only `dataforseo_rank` on its own
  authority scale, and selectively verifies at most the frozen cap of
  provider-discovered source pages through the SSRF-safe crawler transport.
  Verification evidence never rewrites the provider fact or unavailable state.
- URL/Keyword/Competitor list and detail GETs accept an optional canonical
  `diagnosticRunId` pin for one exact published generation. Keyword/Competitor
  lists without a pin show the current automatically projected candidate
  libraries. `view=review` exists only on Keyword/Competitor detail GETs, is
  mutually exclusive with the pin, and PATCH rejects every query parameter.
- Keyword content delivery reads only complete inventories and joins the exact
  mapped SitePage in the published run to content Opportunities that own that
  page and current content Artifacts for their Actions. Topic peers,
  Finding-only previews, and technical outputs cannot appear as Keyword
  delivery; Artifact status remains distinct from external publication.

The contextual URL-opportunity slice is part of the authenticated workbench:

- Current diagnostics freeze exact-key, hash-covered `contextProjection.v1`
  from the selected immutable confirmed Profile and exact Site language.
  Product Profile 0.3.0 and legacy ICP fields are parsed generation-by-generation
  without borrowing. Provider/mode/permission, workflow, mutable priority/risk/
  ROI/cadence, and model inference remain outside the projection. Site language
  is RFC 5646 validated and frozen with its original values/order; `[]` means
  unknown and never falls back to the Project delivery locale.
- `TECH-INDEXABILITY-006@1` is the twelfth rule. It requires unambiguous exact
  Crawl lineage, exact `page.status` 2xx, `sitemapMember=true`, and
  `robotsIndexable=false`; redirect sources and non-2xx fetches are excluded.
- Latest Growth Map/Growth Audit reads select only `growth-audit.0.3.1`.
  Explicit pins may read known `growth-audit.0.3.0` through its own validator,
  without backfill or reinterpretation. Capability version remains `0.3.0`;
  request/addressing and `capabilityContractVersion` remain
  `growth-audit.0.3.0`.
- Nullable `executionPreview` is current-view, read-only copy from the existing
  ActionTemplate registry plus Project delivery locale. It is not replay,
  identity, Action/workflow, publication, or measurement authority.
- Public Tools remain facts-only, anonymous/quota-bounded, Profile-independent,
  and outside canonical workbench persistence.

Next reviewed slice: **authorized provider external writes**

v0.4 is now active/normative. Its pre-promotion publication candidate is
quarantined under `authority/implementation-spec-v0.4/historical-publication-candidate/`
as non-normative, non-executable audit input. A later external-write slice must
atomically add provider adapter, worker, remote precondition, reconciliation,
rollback, route/OpenAPI, migration and tests before a customer control becomes
active.

## Current production facts

- Public source repository:
  `https://github.com/phananhson733-oss/nevermore`
- Customer origin: `https://app.gengrowth.ai`
- Vercel project: `nevermore`
- Railway project/service: `signalframe` / production `worker`
- Supabase project: `nevermore-production`, `gengrowth` organization,
  `us-east-1`
- Production data paths: GSC, GA4, Crawl and DataForSEO; new or unconnected
  projects remain honestly empty and never fall back to the historical
  Artifact scenario.
- New-product onboarding now exposes GSC and GA4 as explicit optional read-only
  choices before automatic Product Profile generation. Either connector or the
  entire step can be skipped; the narrow pre-confirmation OAuth exception is
  restricted to the exact same-project setup route, while collection waits for
  confirmed context.

The deployed baseline before the current CI convergence was
`2b74511c6c3a67e33c8174f455607b37e76ed63d`. A tracked file cannot embed the
hash of the commit containing its own final edits; the release SHA must still
be read from `git rev-parse HEAD`, GitHub Actions, Vercel
`/api/mvp/health/version` and Railway startup logs and must agree.

The previous Supabase project is inactive rather than deleted and has a
restore backup. Production operator creation remains an Owner-controlled
provisioning step: a Supabase Auth user also needs the intended
`app.operator_profiles` membership before authenticated four-module smoke can
be completed.

## Fresh local verification for contextual URL opportunities

The contextual URL-opportunity implementation was freshly verified on
2026-08-05 in the uncommitted
`codex/seo-audit-opportunity-logic-v1` worktree based on
`1bc2a5c6de76a5dfcce1bdd675dedcd77bbb2da9`. This is local implementation
evidence only: no Supabase, shared, staging, or production database was
connected or migrated, and no commit, push, PR, deploy, or provider write was
performed.

| Gate | Fresh local result |
| --- | --- |
| Unit tests | `pnpm test` passed: **589 files / 7,161 tests**. |
| PostgreSQL integration | `pnpm test:integration` passed from a fresh PostgreSQL 16.12 loopback disposable database: **84 files / 598 tests**. The safety gate accepted only the exact `127.0.0.1` disposable URL. |
| Migration structure | `pnpm db:migrate:check` passed at migration head `0043`: **78 app tables / 17 authority hash columns / 105 indexes / 148 triggers / 67 routines**. |
| Constraint smoke | `pnpm db:smoke` completed all fixtures and ended with `ROLLBACK`. |
| Disposable cleanup | All three task-owned diagnostic/final disposable databases were deleted; the final exact-name and test-derived-prefix residual counts were both **0**. |
| Typecheck / lint / build | `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed across the workspace. |
| Contracts / OpenAPI / secrets | `pnpm contracts:check` and `pnpm openapi:lint` passed; `pnpm secrets:scan` found no secret values and its **4 files / 75 tests** passed. |
| Authority / lock | `pnpm verify:docs`, `pnpm verify:authority`, `pnpm verify:spec`, `pnpm verify:spec:test`, and `pnpm implementation:check` passed at **79 operations / 10 async operations / 78 tables / 12 rules / 43 migrations**; verifier tests passed **51/51**. |

Database execution during implementation exposed two real PostgreSQL
parser/precedence defects in migration `0042`; the controlled authorized run
also exposed one incomplete legacy ICP fixture and one stale
`growth-audit.0.3.0` test expectation. The migration, fixtures, generated
schema, and lock were corrected before the clean final run above. The task did
not rerun browser E2E or any deployed-origin/provider gate; those remain
separate release evidence and do not change the local integration result.

## Historical verification on the final v0.3 candidate

“Fresh” means the command was rerun against the verification anchor above. It
does not mean a hosted provider, production database, or deployed origin was
exercised. The table below is retained historical evidence, not a claim that
the expanded active v0.4 surface has the same counts or currently green CI.

| Gate | Fresh result |
| --- | --- |
| Documentation consistency | `pnpm verify:docs` passed: **10/10** Node tests. |
| Authority verifier | `pnpm verify:authority` passed: **49 API / 9 async / 44 tables / 11 rules**. |
| Spec lock verifier | `pnpm verify:spec` passed with matching authority/implementation hashes and **49 / 9 / 44 / 11**. |
| Authority/verifier tests | `pnpm verify:spec:test` passed: **76/76** Node tests, including the docs gate. |
| Implementation consistency | `pnpm implementation:check` passed with **49 / 9 / 44 / 11** and the current safety/purity checks. |
| Deployment config | `pnpm deploy:check` passed for Vercel Web + Supabase state + Railway worker-only topology. |
| Disposable database | All **21** migrations were present; `pnpm db:migrate:check` passed with **44 tables / 56 indexes / 69 triggers / 18 routines**. |
| Lint | `pnpm lint` passed across the E2E and workspace packages. |
| Typecheck | `pnpm typecheck` passed across the E2E and workspace packages. |
| Unit tests | `pnpm test` passed: **315 files / 4,176 tests**. |
| Integration tests | `pnpm test:integration` passed on the disposable loopback database: **67 files / 495 tests**. |
| Production build | `pnpm build` passed across all buildable workspace packages; `apps/web/next-env.d.ts` remained clean. |
| Complete mock browser E2E | `pnpm test:e2e:mock` passed: **155/155** Chromium scenarios, including Overview, Growth Map, Content Shadow, Sources, Execution, Results, responsive and accessibility coverage. |
| Customer deliverable generation | `pnpm artifact:regen` generated both committed files twice with stable SHA-256: Interactive Artifact `51d66a6c88fe23c0174da3859cc4dc0738e83a79dce8ae929d3f0c847cb36fbe`; Product Manual `e1cc2606119b86aac209e132bd57c59e4b0f3a9054cbe355cb45b8076a9d7dbc`. |
| Customer deliverable verification | `pnpm artifact:verify` passed with **4 routes / 56 declared actions / 14 forms / 0 unexercised actions or forms**. Product Manual verification passed with **4 routes / 3 customer-visible connections / 0 internal audience, implementation-dictionary, or workstation-path exposures**. Physical-path tests reject lexical and symbolic-link escapes. |
| Complete customer Artifact browser E2E | `pnpm test:e2e:artifact` passed: **20/20**, covering repo ownership, offline/no-leak behavior, all four modules, 12 URL selection/pagination, Keyword/Competitor provenance, required readable deliverables, honest Results/UTM attribution, URL/history deep links, keyboard focus, axe, and 1440/1024/768/390 viewports with at least 16px primary reading text. |
| Independent review | Complete-diff and deep-link follow-up reviews found no remaining blocker after repository-path hardening and cross-module target persistence were added. |
| Diff whitespace check | `git diff --check` passed on the final candidate. |

The first documentation-consistency run was intentionally red before these docs
were changed: **1 passed / 6 failed**. It exposed the missing root README,
retired product-version and v0.2 authority references, the stale
`26 / 5 / 28 / 11`
inventory, absent four-route documentation, and permanent no-CMS/GitHub
wording. That run is TDD evidence, not a current failure waiver.

## Repository-recorded evidence (not rerun by Task 2)

The following is historical evidence committed to the repository. It remains
useful context, but it must not be presented as a fresh run on the final Task 2
commit.

| Evidence source | Recorded result |
| --- | --- |
| `docs/reviews/2026-07-21-growth-opportunity-slice1-stop-gate.md` | Slice 1 decision `accepted`; four canonical routes, no-data honesty, one Finding → one Action, and immutable recheck were evidenced. |
| `docs/reviews/2026-07-25-seo-geo-content-shadow-stop-gate.md` §21.6 | `pnpm lint` and `pnpm typecheck` passed; unit recorded **315 files / 4,170 tests**; integration recorded **67 files / 495 tests** on a disposable database. |
| Same Slice 2 stop gate §21.6 | Mock browser suite recorded **148 passed / 0 failed**; full real browser suite recorded **42 passed / 0 failed** on a fresh disposable database. |
| Same Slice 2 stop gate §21.5–21.6 | AC-044 visual verification was recorded on Darwin and an Ubuntu arm64 container; the document explicitly retains the Linux/amd64 CI rasterization caveat. |

These stop-gate numbers describe their recorded commits and environments. They
do not replace a final CI run, deployed-origin smoke, or provider evidence for a
new release SHA.

## Remaining release, provider, recovery, and Owner gates

Local implementation evidence is not enough to call the product production- or
pilot-ready. The following remain external gates unless a release handoff binds
sanitized evidence to the exact candidate SHA:

1. Review the full convergence diff and freeze one immutable release SHA.
2. Preserve and restore-verify the production backup, then re-check all ordered
   migrations through `0053`; existing evidence through `0052` does not prove
   that the local 0053 authority head is hosted.
3. Deploy the exact same SHA to Vercel Web and the Railway Worker; verify
   `/api/mvp/health/version`, liveness, readiness, pg-boss schema, and the live
   worker lease.
4. Complete deployed-origin Supabase Auth/session/callback proof.
5. Exercise Owner-approved live GSC and GA4 accounts and retain sanitized,
   token-free evidence.
6. Exercise one cost-capped hosted DataForSEO Search Landscape collection. Keep
   Backlinks disabled until its separate entitlement/rollout is approved; then
   exercise one bounded Backlinks collection and selective source verification.
   Exercise the selected production OpenAI endpoint without logging credentials,
   provider bodies, customer/model content, or fetched source-page bodies.
7. Confirm private Storage permissions, object-count alerting, bounded retention
   sweeps, and signed-download behavior.
8. Perform the production recovery exercise in `docs/RESTORE-DRILL.md`,
   including Supabase PITR and separate private-object byte evidence.
9. Complete the Owner walkthrough for Chinese/English and B2B/B2C outputs,
   limitations, evidence, priorities, Actions, Artifacts, and exports.
10. Treat real GitHub/WordPress provider writes as a later atomic authority
    expansion. v0.4 already freezes approval, preview, receipt lineage and
    Measurement Window contracts, but a PR or WordPress Draft remains delivery
    evidence; attribution requires a later merge/publish-confirmed Change
    Receipt with a live canonical URL.

Until those gates are closed, the honest release statement is:

> v0.4 is the active complete four-module authority and the production topology
> is deployed; the final green CI SHA, intended operator walkthrough and any
> provider-specific evidence remain explicit release gates.

## Resume safely

- Read this file, `README.md`, `CLAUDE.md`, `docs/DEPLOYMENT.md`, and
  `authority/implementation-spec-v0.4/README.md`.
- Run `pnpm verify:docs`, `pnpm verify:authority`, `pnpm verify:spec`, and
  `pnpm implementation:check` before changing the normative surface.
- Never run database-backed tests against a hosted database. Use an explicit,
  disposable loopback name accepted by
  `packages/db/src/test-database-safety.ts`.
- Do not infer what an uninspected `.env.local` points to.
- Keep `/Users/wzb/Code/signalframe` read-only; vendor-copy only with recorded
  commit/path/SHA-256 provenance.
- Do not replace `apps/web/src/proxy.ts` with the removed `middleware.ts`.
- Never add provider bodies, model output, object keys, customer text, raw
  errors, or secrets to logs or telemetry.
