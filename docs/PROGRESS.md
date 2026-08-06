# Nevermore / GenGrowth Progress

Updated: **2026-08-06**

This is the current authority and verification handoff for the Nevermore
repository and its customer-facing GenGrowth product. It replaces the retired
v0.2 progress narrative. It deliberately separates commands rerun on the current
convergence worktree from older evidence recorded in checked-in stop gates.

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
  `0045_dataforseo_backlink_target_lineage.sql` (**45 ordered migrations**)
- Contract inventory: **79 API operations / 10 async operations / 78 app tables / 12 frozen rules**
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
are implemented; the current 79 operations still do not execute an external
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

- New `createAnalysisRefreshRun` parents own the fixed six-step
  `analysis-refresh.plan.v2`: Crawl → connected GSC → connected GA4 →
  DataForSEO Search Landscape (DFS) → `dataforseo_backlinks` → Growth Audit.
  Historical five-step v1 parents remain exact and resumable. The public
  collection command remains exactly `crawl|gsc|ga4`; it cannot accept
  DFS/Backlinks target, market, language, limits, credentials, or provider
  queries.
- DFS v2 runs frozen ranked-keywords and competitors-domain requests at
  positions/max-rank 1–100. Only when retained domain overlap is empty, it uses
  frozen GSC/Crawl/Product Profile seeds for at most one paid SERP Competitors
  fallback, then atomically persists one `dataforseo.search_landscape.v2`
  Snapshot. Partial provider success is not a published Search Landscape.
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
   migrations through `0044`; historical proof through `0021` does not prove
   the active v0.4 migration head is hosted.
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
