# Nevermore / GenGrowth Progress

Updated: **2026-07-27**

This is the current authority and verification handoff for the Nevermore
repository and its customer-facing GenGrowth product. It replaces the retired
v0.2 progress narrative. It deliberately separates commands rerun on the current
convergence worktree from older evidence recorded in checked-in stop gates.

## Candidate identity and authority

- Branch: `codex/unified-growth-opportunity-v03`
- Documentation reconciliation base HEAD:
  `306dbf866cb46d8d0c4f51f0e04646715a965ead`
- Nevermore program root: `/Users/wzb/Code/nevermore`
- Git repository common directory:
  `/Users/wzb/Code/nevermore/signalframe-mvp-app/.git`
- Application worktree:
  `/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/unified-growth-opportunity-v03`
- Product version: **0.3.0**
- Contract version: **2026-07-21**
- Active authority: `authority/implementation-spec-v0.3/`
- Machine lock: `scripts/spec-v0.3-lock.json`
- Migration range: `0001_init.sql` through
  `0021_content_shadow_invocation_task.sql` (**21 ordered migrations**)
- Contract inventory: **49 API operations / 9 async operations / 44 app tables / 11 frozen rules**

The base SHA above is the exact commit inspected before this documentation
change. A tracked file cannot contain the hash of the commit that contains
itself; therefore the final candidate SHA must always be read with
`git rev-parse HEAD` and then compared with deployed
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

Current v0.3 external-write boundary: **no external writes**

The active v0.3 contract has no GitHub, WordPress, CMS, Vercel, Cloudflare, or
customer-production-site write and no post-publication attribution. Internal
Content Shadow persistence is implemented; external publication is not. Any
publish/attribution interaction in customer collateral is scenario-only unless
and until a later machine contract and the correct provider receipts prove
otherwise.

Next reviewed slice: **v0.4 authorized publication and attribution**

v0.4 begins as a non-normative candidate and must not alter the shared OpenAPI
or migration chain before its routes, repositories, workers, and adapters are
ready for atomic promotion. A GitHub pull request or WordPress Draft yields a
delivery receipt; it does not prove publication. Only a separate change receipt
that confirms merge/publish and records the live canonical URL may anchor
GSC/GA4/UTM before/after attribution. Those capabilities are not part of the
current v0.3 operation, async, or table counts.

## Fresh verification on this convergence worktree

“Fresh” means the command was rerun against the base SHA above plus the current
Task 2 documentation diff. It does not mean a hosted provider, production
database, or deployed origin was exercised.

| Gate | Fresh result |
| --- | --- |
| Documentation consistency | `pnpm verify:docs` passed: **10/10** Node tests. |
| Authority verifier | `pnpm verify:authority` passed: **49 API / 9 async / 44 tables / 11 rules**. |
| Spec lock verifier | `pnpm verify:spec` passed with matching authority/implementation hashes and **49 / 9 / 44 / 11**. |
| Authority/verifier tests | `pnpm verify:spec:test` passed: **76/76** Node tests, including the docs gate. |
| Implementation consistency | `pnpm implementation:check` passed with **49 / 9 / 44 / 11** and the current safety/purity checks. |
| Deployment config | `pnpm deploy:check` passed for Vercel Web + Supabase state + Railway worker-only topology. |
| Lint | `pnpm lint` passed across the E2E and workspace packages. |
| Typecheck | `pnpm typecheck` passed across the E2E and workspace packages. |
| Unit tests | `pnpm test` passed: **315 files / 4,173 tests**. |
| Production build | `pnpm build` passed across all buildable workspace packages; `apps/web/next-env.d.ts` remained clean. |
| Targeted customer-surface mock E2E | **28 passed**: Critical **14** + Sources suites **7** + frontend affected **4** + cursor affected **3**. |
| Diff whitespace check | `git diff --check` passed for the final Task 2 worktree diff. |

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

## Remaining hosted, provider, recovery, and Owner gates

Local implementation evidence is not enough to call the product production- or
pilot-ready. The following remain external gates unless a release handoff binds
sanitized evidence to the exact candidate SHA:

1. Review the full convergence diff and freeze one immutable release SHA.
2. Back up and restore-verify the intended production database, then apply and
   replay-check all ordered migrations through `0021`; historical proof through
   `0009` does not prove the v0.3 Slice 1/2 migrations are hosted.
3. Deploy the exact same SHA to Vercel Web and the Railway Worker; verify
   `/api/mvp/health/version`, liveness, readiness, pg-boss schema, and the live
   worker lease.
4. Complete deployed-origin Supabase Auth/session/callback proof.
5. Exercise Owner-approved live GSC and GA4 accounts and retain sanitized,
   token-free evidence.
6. Exercise one cost-capped hosted DataForSEO collection and the selected
   production OpenAI endpoint without logging credentials, provider bodies, or
   customer/model content.
7. Confirm private Storage permissions, object-count alerting, bounded retention
   sweeps, and signed-download behavior.
8. Perform the production recovery exercise in `docs/RESTORE-DRILL.md`,
   including Supabase PITR and separate private-object byte evidence.
9. Complete the Owner walkthrough for Chinese/English and B2B/B2C outputs,
   limitations, evidence, priorities, Actions, Artifacts, and exports.
10. Treat GitHub/WordPress delivery and change-receipt-anchored attribution as
    v0.4 work. Keep its first authority draft non-normative and leave shared
    OpenAPI/migrations unchanged until routes, repositories, workers, adapters,
    contracts, migrations, rollback, and tests can be promoted atomically. A PR
    or WordPress Draft is only delivery evidence; attribution requires a later
    merge/publish-confirmed change receipt with a live canonical URL.

Until those gates are closed, the honest release statement is:

> v0.3 local implementation and repository acceptance evidence are available;
> hosted, provider, recovery, and Owner launch evidence remain release gates.

## Resume safely

- Read this file, `README.md`, `CLAUDE.md`, `docs/DEPLOYMENT.md`, and
  `authority/implementation-spec-v0.3/README.md`.
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
