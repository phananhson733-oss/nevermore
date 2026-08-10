# Nevermore / GenGrowth

Nevermore is the internal repository, product boundary, authorization boundary,
and system of record. **GenGrowth** is the customer-facing product brand. Older
`signalframe-mvp-app`, `@sf/*`, `signalframe.*`, database, schema, export, and
problem-type identifiers remain compatibility implementation names; they are
not customer-visible branding.

Current product version: **0.3.0**

Current contract version: **2026-07-21**

The active repository-owned authority is
[`authority/implementation-spec-v0.4/`](authority/implementation-spec-v0.4/).
The machine lock is [`scripts/spec-v0.4-lock.json`](scripts/spec-v0.4-lock.json).

Contract inventory: **80 API operations / 11 async operations / 84 app tables / 12 frozen rules**

Current deterministic versions: **`mvp.rules.0.2.4` / `mvp.prompts.0.2.0`**.
The ordered migration head is
`0052_keyword_governance_schedule_requests.sql` (**52 migrations**). Migration 0048
adds bounded Topic Model generation, an invocation-attempt fence, and Analysis
Refresh v3 while preserving exact v1/v2 historical readability. Migration 0049
keeps the existing exact-lineage authorities while bounding Keyword,
Competitor, and provider-discrepancy collection projection round trips;
migration 0050 adds explicit confirmed Product Profile lineage for the fixed
GenerativeQuery Keyword cohort without inventing provider provenance; migration
0051 adds frozen, fenced Keyword governance suggestion generation and atomic
human resolution authority; migration 0052 adds payload-free durable source
schedule requests, lease-token dispatch CAS, and atomic generation continuation.

The v0.3 authority remains a historical snapshot. Any further route, migration,
or operation must be promoted atomically through the active v0.4 authority and
lock.

## Current customer product

The Chinese-first GenGrowth workspace exposes exactly four primary project
destinations. This table mirrors the shared navigation descriptor in
`apps/web/src/components/app-shell/nav-model.ts`; the project route helper
re-exports that descriptor for compatibility:

| Customer label | Canonical route |
| --- | --- |
| 概览 | `/p/:projectId/overview` |
| 增长地图 | `/p/:projectId/growth-map` |
| 执行中心 | `/p/:projectId/execution` |
| 效果追踪 | `/p/:projectId/results` |

`/context` and `/sources` are secondary project routes. `/diagnosis`,
`/plan`, `/studio`, and `/report` remain compatibility aliases for Growth Map,
Execution, Execution, and Results respectively; they are not additional primary
navigation entries.

The canonical product chain remains:

```text
Project
  → Snapshot / Observation
  → Evidence
  → Finding
  → Review
  → Action
  → Artifact Revision
  → Approval
  → Recheck / Outcome Observation
  → Results
```

Slice 1 status: **complete**

Slice 1 delivered the versioned Growth Audit and Capability contract, URL-first
Product Profile, the multi-URL Growth Map, bounded Keyword and Competitor
libraries with provenance, one primary Finding → one Action behavior, immutable
prior/new recheck comparison, and the four-route Overview → Growth Map →
Execution → Results customer baseline.

Slice 2 status: **complete**

Slice 2 delivered SEO/GEO Content Shadow as a bounded internal workflow:
confirmed content Finding → one Action → one `content_brief` → frozen research
pack → `english_blog_draft` revision → deterministic QA → revision-bound human
review. Its research, draft, QA, and review records are internal canonical
writes with frozen lineage.

Content Shadow state: **reviewed, not published**

Current v0.4 external-write boundary: **no external writes**

That boundary is a statement about the active v0.4 contract, not a permanent
product prohibition. GenGrowth currently does not write to GitHub, WordPress, a CMS,
Vercel, Cloudflare, or a customer production site; it has no published state or
post-publication attribution claim. Scenario-only customer collateral must say
so explicitly and cannot be used as evidence that a provider write occurred.

Current authority: **v0.4 complete four-module workbench**

The active v0.4 authority includes keyword and competitor governance, execution
state, durable approval, publication/rollback preview authority, receipt
lineage, and immutable measurement windows. It does not yet include an external
publication-attempt HTTP operation or a GitHub/WordPress provider write.

`createAnalysisRefreshRun` is the server-owned full refresh command. Its fixed
`analysis-refresh.plan.v3` runs required Crawl, optional connected GSC, optional
connected GA4, optional DataForSEO Search Landscape (DFS), optional
`dataforseo_backlinks`, optional internal Topic Model generation, then required
Growth Audit. Historical five-step `analysis-refresh.plan.v1` and six-step
`analysis-refresh.plan.v2` parents remain readable and resumable only under
their exact manifest/hash/ordinal; new parents use v3. Public
`createCollectionRun` remains limited to `crawl`, `gsc`, and `ga4`; customers
cannot submit DFS/Backlinks/Topic targets, market, language, limits, credentials,
provider queries, or model options. The internal Topic child freezes bounded
input/resource and invocation-attempt ledgers, calls the model outside database
transactions, and blocks silent retry after `reserved` or `outcome_unknown`.
DFS v3 queries organic positions 1–100, persists canonical organic-overlap
operands/ratio and immutable competitor-origin lineage, and, only when retained
domain overlap is empty, may use frozen GSC/Crawl/Product Profile seeds for one
paid SERP Competitors fallback while preserving each seed's real source. DFS
v1/v2 remain exact read-only history. The optional AI citation sub-capability
(`DATAFORSEO_AI_CITATIONS_ENABLED=false`) is independently default-off and only
runs against an exact frozen cohort of 20 approved, mapping-confirmed
GenerativeQuery rows under a server-pinned model; smaller or overflow cohorts
make no paid AI request.

DataForSEO Backlinks is a separate default-off rollout
(`DATAFORSEO_BACKLINKS_ENABLED=false`) on top of the global DataForSEO gate. Its
server-frozen defaults/hard limits are 500/1000 backlink rows, 100/1000
referring domains, 500/1000 target pages, and 20/20 selective SSRF-safe source
page verifications. The provider authority metric is `dataforseo_rank`, never
Ahrefs DR or Moz DA; crawler verification remains evidence separate from the
provider index fact.

New-product onboarding offers an explicit optional GSC/GA4 step after the
durable Product Profile draft is created and before the profile screen starts
automatic synthesis. Customers may connect either source, both, or neither.
Only the exact same-project `setup-sources` OAuth return path bypasses the
confirmed-profile connection gate; the full Sources read model remains gated,
and collection is deferred until confirmed context can scope it honestly.

Growth Map URL, Keyword, and Competitor list/detail reads accept an optional
canonical `diagnosticRunId` to pin one exact published generation. Without a
pin, Keyword and Competitor lists show the current automatically materialized
candidate libraries; URL reads remain latest-generation. Only Keyword and
Competitor detail GETs accept `view=review` for current governance, and that view
is mutually exclusive with the generation pin. Keyword and Competitor PATCH
commands reject every query parameter.

Ranked-keyword observations retain DataForSEO keyword difficulty as an integer
from 0 through 100 or `null`, plus canonical provider search intent or `null`;
malformed present values fail closed, and missing KD is never presented as zero.
The provenance-bearing `searchIntent` projection resolves user-confirmed,
exact provider-observed, invocation-backed LLM-generated, governed legacy, then
unavailable authority, without allowing a published pin to read newer lineage.

Keyword content delivery is a read-only Growth Map projection over complete
inventories: the exact mapped SitePage in the published run, content
Opportunities that own that page, and current content Artifacts for their
Actions. Topic peers, Finding-only previews, and technical outputs do not count
as Keyword delivery; a current Artifact status is not external publication or
live-change authority.

Current authenticated diagnostics freeze an exact-key, hash-covered
`contextProjection.v1` from the immutable confirmed Product Profile/legacy ICP
generation and the exact Site language declaration. Profile generations do not
borrow fields from one another. Site language values are RFC 5646 validated and
frozen in their declared order and spelling; an empty list means unknown and
never falls back to the Project delivery locale. Provider availability,
permissions/modes, workflow state, mutable prioritization, and inferred/model
facts remain outside this projection.

`TECH-INDEXABILITY-006@1` is the twelfth deterministic rule. It reports only an
exact Crawl fetch with a 2xx `page.status`, sitemap membership, a page-level
non-indexable signal, and unambiguous exact lineage. Redirect sources and
non-2xx fetches are excluded. The nullable `executionPreview` shown with
reviewable/confirmed Opportunities and URL Findings is current-view, read-only
copy from the ActionTemplate registry and Project delivery locale; it is not
replay, identity, Action, workflow, publication, or measurement authority.

The current Growth Audit read-model projection is `growth-audit.0.3.1`; latest
reads select only that generation. An exact pin may still read known
`growth-audit.0.3.0` history under its own validator. The Growth Audit capability
version remains `0.3.0`; its request/addressing contract and
`capabilityContractVersion` literal remain `growth-audit.0.3.0`.
Anonymous Public Tools retain their existing facts-only, quota, no-Profile, and
no-canonical-persistence boundary.

A GitHub pull request or WordPress Draft produces a **delivery receipt** only;
neither proves that a customer-visible change is live. A separate **change
receipt** requires verified merge/publish completion and the live canonical URL.
Only that change receipt may anchor GSC/GA4/UTM before/after attribution. None of
these receipt facts may be synthesized from a preview or an Artifact status.

## Development

Requirements:

- Node.js `>=24.12 <25`
- pnpm `>=10 <11` (repository package manager: pnpm `10.32.1`)
- PostgreSQL 15+ for database-backed tests and local operation

Common commands:

```bash
pnpm install --frozen-lockfile
pnpm verify:docs
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Database-backed integration and real-browser tests must use an explicit,
disposable loopback database whose name passes
`packages/db/src/test-database-safety.ts`. Never point those commands at a
hosted or shared database.

The canonical real-browser command also requires the PostgreSQL `createdb` and
`dropdb` clients:

```bash
E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/signalframe_e2e_local \
  pnpm test:e2e:real
```

The supplied URL is a guarded template, not the database the tests mutate. The
runner derives separate invocation-scoped databases, ports, Next build
directories, blob directories, and Playwright output directories for the light
suite, AC-044, and AC-045. Each segment receives one non-retried attempt in a
fresh Next process, and the runner only force-drops a database it created
successfully.

## Evidence and release status

[`docs/PROGRESS.md`](docs/PROGRESS.md) distinguishes checks freshly rerun on the
current convergence worktree from evidence recorded by the Slice 1 and Slice 2
stop gates. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) defines the approved
Vercel Web + Supabase + Railway Worker topology and the remaining hosted,
provider, recovery, and Owner gates.

Local or repository-recorded green tests do not by themselves make a release
production-ready or pilot-ready. The exact immutable release SHA must be
verified on the deployed web and worker, and all external launch gates must be
closed with sanitized evidence.
