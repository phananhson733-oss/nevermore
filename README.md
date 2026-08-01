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

Contract inventory: **79 API operations / 10 async operations / 78 app tables / 11 frozen rules**

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
plan runs required Crawl, optional connected GSC, optional connected GA4,
optional DataForSEO Search Landscape (DFS), then required Growth Audit. Public
`createCollectionRun` remains limited to `crawl`, `gsc`, and `ga4`; customers
cannot submit DFS target, market, language, limits, credentials, or provider
queries.

Growth Map URL, Keyword, and Competitor list/detail reads accept an optional
canonical `diagnosticRunId` to pin one exact published generation. Only Keyword
and Competitor detail GETs accept `view=review` for current governance, and that
view is mutually exclusive with the generation pin. Keyword and Competitor
PATCH commands reject every query parameter.

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
