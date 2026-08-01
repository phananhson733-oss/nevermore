# Nevermore v0.4 deployment decision — GenGrowth on Vercel + Supabase + Railway

Nevermore is the internal repository and system of record; GenGrowth is the
customer-facing brand, and its approved production origin is
`https://app.gengrowth.ai`. The current active authority is product `0.3.0`,
contract `2026-07-21`, backed by
`authority/implementation-spec-v0.4/`.

Contract inventory: **79 API operations / 10 async operations / 78 app tables / 11 frozen rules**

Content Shadow state: **reviewed, not published**

Current v0.4 external-write boundary: **no external writes**

This is a versioned v0.4 fact, not a permanent product prohibition. The current
deployment must not write to GitHub, WordPress, another CMS, Vercel, Cloudflare,
or a customer production site, and it must not claim post-publication
attribution.

Current authority: **v0.4 complete four-module workbench**

v0.4 has atomically activated Keyword/Competitor governance, execution state,
durable approval, publication/rollback preview authority, receipt lineage and
immutable Measurement Windows. Its 79 operations still do not include a real
GitHub/WordPress external-write command. A GitHub pull request or WordPress
Draft produces a **delivery receipt**, not proof that a change is live. Only a
separate **change receipt** that confirms merge/publish and records the live
canonical URL may anchor attribution.

Migration range: `0001_init.sql` through `0035_uuidv8_product_profile_competitor_evidence.sql` (**35 ordered migrations**)

Historical production evidence through `0021` does not prove that the active
v0.4 migrations through `0035` are hosted; every release must back up,
restore-verify, apply, and replay-check the complete active chain before
traffic promotion.

## Approved production topology (Owner decision, 2026-07-20)

The Owner approved the following topology for the current production release:

| Responsibility | Production platform | Boundary |
|---|---|---|
| Next.js web and `/api/mvp` routes | **Vercel** | One web deployment at `https://app.gengrowth.ai` |
| Auth, PostgreSQL and private object storage | **Supabase** | One production project shared by web and worker |
| Persistent pg-boss consumer | **Railway Hobby** | One always-on worker service; no web service, domain or HTTP healthcheck |

Current production resources are the public GitHub repository
`https://github.com/phananhson733-oss/nevermore`, Vercel project `nevermore`,
Railway project/service `signalframe` / `worker`, and Supabase project
`nevermore-production` in the `gengrowth` organization, `us-east-1`. The
previous Supabase project is inactive and backed up rather than deleted.

This dated Owner decision supersedes frozen implementation-spec §3.2 for this
production release. The frozen spec's Railway `web` + `worker` shared-image
topology remains useful historical context, and the repository's Render
Background Worker configuration remains a prepared historical alternative.
Neither is the current launch target: **Railway does not host the web, and
Render does not host the production worker.**

The release identity is one clean immutable commit, written below as
`<release SHA>`. The Vercel web deployment, Railway worker deployment and
migration evidence must all resolve to that same SHA. Do not promote a dirty
worktree, a branch name, or `latest` as a release identifier.

## Production topology details

### Web — Vercel only

1. Connect the repository at `<release SHA>` and set the Vercel project Root
   Directory to `apps/web` with the Next.js framework preset.
2. Enable source files outside the Root Directory so the monorepo workspace
   packages are available during the build. Leave install, build and output
   overrides empty unless a separately reviewed release requires them.
3. Serve this release at the origin root: `https://app.gengrowth.ai`.
   Set `APP_ORIGIN=https://app.gengrowth.ai` and leave
   `NEXT_PUBLIC_BASE_PATH` unset. The production Google OAuth callback is
   `https://app.gengrowth.ai/api/mvp/oauth/google/callback`.
4. Enable Vercel system environment variables. The version resolver reads
   `VERCEL_GIT_COMMIT_SHA`; leave `APP_BUILD_SHA` unset unless deliberately
   pinning the exact same `<release SHA>`.
5. First deploy to a unique Vercel deployment URL. Smoke that immutable URL
   before assigning or promoting `app.gengrowth.ai`.

### State — Supabase only

Both compute services use the same Supabase project for Authentication,
PostgreSQL and Storage. They must receive identical database,
credential-encryption, OAuth, service-role and bucket settings where applicable.

pg-boss and the live-worker readiness lease require a **session-mode** database
connection. The web readiness probe also acquires and releases a session
advisory lock on one checked-out connection. Therefore both `DATABASE_URL`
values must use Supabase direct/session mode (or the session pooler), never the
transaction pooler. Keep `DB_POOL_MAX` conservative and monitor connection
saturation. The production connection budget is asymmetric by design:
`DB_POOL_MAX=1` on each horizontally scaled Vercel Web instance and
`DB_POOL_MAX=2` on the single persistent Railway Worker. The worker minimum is
two because its readiness session advisory lease checks out one Drizzle pool
connection for the worker lifetime, leaving the second for normal job queries.

Keep `raw-imports` and `exports` private. The worker service role must be able to
create, read, list and delete objects in both buckets. Listing and deletion are
required by application-owned retention and conservative orphan cleanup, not
only by upload/download flows. The application enforces 90-day raw-family byte
retention and dual-anchored 30-day export-byte retention from the database
clock. Supabase database backup evidence does not replace separate Storage-byte
recovery evidence.

The pilot cleanup sweep has a hard 100,000-object-per-kind capacity boundary
and no durable resume cursor. Before promotion, prove each of `raw`,
`raw-import`, `snapshot-raw` and `export` is at or below the boundary. Alert on
`ORPHAN_CLEANUP_CAPACITY_EXCEEDED` and
`STORAGE_RETENTION_CAPACITY_EXCEEDED`; these are operations failures, not
self-healing retry states.

### Worker — Railway Hobby only

1. Create one Railway service named for the Nevermore worker from the same
   repository and `<release SHA>` used by Vercel.
2. Build from the repository root with committed `railway.json`, which selects
   `Dockerfile.worker`. Config-as-code also pins the worker start command, so a
   dashboard default cannot accidentally start a web process.
3. Verify the effective Railway start command is:

   ```text
   node --enable-source-maps --import tsx apps/worker/src/index.ts
   ```

4. Do not attach a domain, public port or HTTP healthcheck. The worker is a
   persistent queue consumer, not an HTTP service. Railway's restart policy may
   restart a failed process; application readiness remains fail-closed through
   the PostgreSQL worker lease.
5. Set `APP_ORIGIN=https://app.gengrowth.ai`. Use the production variable list
   in `deploy/worker.env.template`. Railway provides
   `RAILWAY_GIT_COMMIT_SHA`; leave `APP_BUILD_SHA` unset unless it is explicitly
   the exact same `<release SHA>`.
   Keep DataForSEO Basic Auth credentials on this worker only; Vercel receives
   the boolean feature flag and row cap, never the login/password.
   DataForSEO Search Landscape (DFS) is invoked only by the server-owned
   Analysis Refresh plan. The public collection API remains limited to Crawl,
   GSC, and GA4; no client request may supply DFS target, market, language,
   limits, credentials, or provider queries.
6. Confirm sanitized startup logs report `<release SHA>`, the recovery sweep
   completes, pg-boss starts and the worker holds its readiness lease. Logs must
   not expose environment values, provider bodies, model output or customer
   content.

The worker has no URL to probe. Its production health signal is the live
session advisory lease in Supabase. The Vercel web endpoint
`/api/mvp/health/ready` verifies the database, pg-boss schema and that lease.
A 503 while the worker is absent is correct fail-closed behavior.

## Required release order

Do not reorder these gates:

1. **Freeze and verify `<release SHA>`.** Review the diff, run the full release
   verification, commit and push the exact SHA that both platforms will deploy.
2. **Back up Supabase, then migrate.** Capture and restore-verify the logical
   database backup. Run the additive migrations against the intended production
   project, then run `pnpm db:migrate:check` and the production-safe smoke check.
3. **Deploy the Railway worker.** Deploy `<release SHA>`, then prove startup
   recovery, pg-boss operation and a held readiness lease in Supabase.
4. **Create the Vercel unique deployment.** Deploy the same `<release SHA>`
   without assigning the production domain. Verify its version and liveness,
   then run authenticated application smoke tests against the unique URL where
   the configured Auth redirect policy permits it.
5. **Verify readiness and promote.** Confirm the web reports `<release SHA>`,
   `/api/mvp/health/ready` returns 200 because the Railway worker lease is live,
   and the Railway logs report the same SHA. Only then promote or alias the
   verified deployment to `https://app.gengrowth.ai`.
6. **Run deployed-origin acceptance.** Repeat version, readiness, real Auth and
   the approved provider/business walkthroughs on the production origin.

Migrations are never run after traffic promotion. The worker is brought up
before the unique web deployment so readiness is a meaningful promotion gate.

## Promotion evidence

Bind every item to `<release SHA>` and retain sanitized output:

1. A restore-verified logical backup plus the successful production migration,
   idempotent migration rerun and schema check.
2. Railway build/source evidence and worker logs showing the exact SHA,
   successful recovery and a held readiness lease.
3. The unique Vercel deployment's
   `/api/mvp/health/version` response showing the same SHA; liveness 200 is only
   a process check.
4. `/api/mvp/health/ready` returning 200 with database, pg-boss schema and the
   worker lease all ready, both before and after promotion.
5. Public Supabase Auth signup disabled; approved users pre-provisioned in
   `app.operator_profiles`; an unprovisioned valid user remains denied without
   creating a workspace or profile.
6. Both Storage buckets private; signed downloads expire after 900 seconds;
   bounded retention/orphan sweeps succeed without capacity events; an expired
   export is not signed and is reported as regeneratable.
7. Deployed-origin Auth, GSC/GA4, selected LLM, EN/zh-CN and B2B/B2C walkthrough
   evidence, plus the database and Storage recovery evidence from
   `docs/RESTORE-DRILL.md`.

Do not describe the release as pilot-ready until all applicable launch gates in
`docs/LAUNCH-CHECKLIST.md` are satisfied.

## Historical alternatives, retained for traceability

- **Frozen-spec Railway web + worker:** §3.2 originally required two Railway
  services built from the same `Dockerfile.railway` image. The shared image and
  default web command remain in the repository, but the 2026-07-20 decision
  authorizes only the worker service on Railway for this production release.
- **Retired Vercel + Render + `/app` candidate:** the auto-discovered
  `render.yaml` Blueprint was removed so it cannot be imported accidentally.
  Generic `NEXT_PUBLIC_BASE_PATH` code support remains for non-production tests,
  but it is not read by the current production path. Do not create a Render worker, do not mount this release at
  `gengrowth.ai/app`, and do not set `NEXT_PUBLIC_BASE_PATH=/app` for the
  approved `app.gengrowth.ai` deployment.

Changing away from the approved topology requires a new explicit Owner decision
and a new release record; repository support for an alternative is not by
itself deployment authorization.
