# Production launch checklist — app.gengrowth.ai

This checklist operationalizes the Owner-approved production topology recorded
on 2026-07-20:

- **Vercel** hosts the Next.js web and `/api/mvp` routes.
- **Supabase** hosts Auth, PostgreSQL and private Storage.
- **Railway Hobby** hosts the only persistent pg-boss worker.

Railway does not host a web service, and Render is not the production worker
target. Frozen-spec Railway `web` + `worker` and the prepared Vercel + Render +
`/app` path remain historical alternatives in `docs/DEPLOYMENT.md`; they do not
change this checklist.

- **Release SHA:** `<release SHA>` — replace only after the clean commit has
  passed the full verification suite and has been pushed.
- **Production origin:** `https://app.gengrowth.ai` (origin root; no `/app`
  base path).
- **Identity invariant:** Supabase migration evidence, Railway worker and Vercel
  web must all be tied to the same immutable `<release SHA>`.
- **Secrets:** never paste secret values into git, logs, screenshots or a shared
  channel. Set them only through approved local secret handling or platform
  dashboards.

Legend: **[Owner]** requires account/authority; **[me]** can prepare or verify.

---

## Phase 0 — Freeze the release

- [x] Owner approved Vercel + Supabase + Railway Hobby on 2026-07-20 **[Owner]**
- [ ] Review the complete diff, run the final verification matrix, commit and
  push a clean tree **[me]**
- [ ] Record `git rev-parse HEAD` as `<release SHA>` and ensure both Vercel and
  Railway deploy that exact commit, not merely the same branch **[me]**
- [ ] Confirm the intended production Supabase project and retain its project
  identifier without exposing credentials **[Owner]**
- [ ] Confirm the production Vercel project owns `app.gengrowth.ai` and Railway
  Hobby is active in the intended workspace **[Owner]**
- [ ] Have the shared secrets ready: `CREDENTIAL_ENCRYPTION_KEY`, Supabase
  service role, Google OAuth client, and the selected LLM credentials. Web and
  worker must share the same encryption/OAuth values **[Owner]**

## Phase 1 — Backup and migrate Supabase

This phase must finish before deploying the worker or web.

- [ ] Confirm `DATABASE_URL` is Supabase direct/session mode or the session
  pooler, never the transaction pooler **[Owner]**
- [ ] Capture a logical production database backup before the release migration;
  store it outside the repository with restricted permissions and record its
  checksum **[me]**
- [ ] Restore that backup into an exact disposable database and verify schema
  plus representative canonical row counts; remove the disposable database
  afterward **[me]**
- [ ] From the clean `<release SHA>`, apply and re-check additive migrations:

  ```bash
  DATABASE_URL='<target-session-mode-url>' pnpm db:migrate
  DATABASE_URL='<target-session-mode-url>' pnpm db:migrate
  DATABASE_URL='<target-session-mode-url>' pnpm db:migrate:check
  DATABASE_URL='<target-session-mode-url>' pnpm db:smoke
  ```

- [ ] Record the successful migration version/check output without exposing the
  connection string **[me]**
- [ ] Disable public Supabase Auth signup. Create approved Auth users and
  explicitly provision each into `app.operator_profiles`; the application must
  not auto-create production memberships **[Owner]**
- [ ] Confirm `raw-imports` and `exports` exist and are private **[Owner]**
- [ ] Confirm the service role can create/read/list/delete in both buckets;
  list/delete are required by retention and orphan cleanup **[Owner]**
- [ ] Record aggregate counts for `raw`, `raw-import`, `snapshot-raw` and
  `export`; every kind must be at or below the 100,000-object pilot boundary.
  Wire alerts for `ORPHAN_CLEANUP_CAPACITY_EXCEEDED` and
  `STORAGE_RETENTION_CAPACITY_EXCEEDED` **[Owner]**

## Phase 2 — Production OAuth origin

- [ ] In the approved Google OAuth client, add this exact callback without
  deleting required localhost callbacks **[Owner]**:

  ```text
  https://app.gengrowth.ai/api/mvp/oauth/google/callback
  ```

- [ ] Confirm the consent screen and approved client include the read-only
  `webmasters.readonly` and `analytics.readonly` scopes **[Owner]**

## Phase 3 — Railway Hobby worker

Deploy the worker before the web promotion gate.

- [ ] Create or select exactly one SignalFrame worker service in the approved
  Railway workspace. Do not create a Railway web service **[Owner]**
- [ ] Connect the repository at `<release SHA>`, use repository root and the
  committed `railway.json` (`Dockerfile.worker`) **[Owner]**
- [ ] Verify the config-as-code start command resolves exactly to **[Owner]**:

  ```text
  node --enable-source-maps --import tsx apps/worker/src/index.ts
  ```

- [ ] Do not attach a domain, public port or HTTP healthcheck to the worker
  **[Owner]**
- [ ] Set the variables from `deploy/worker.env.template`. In particular:
  `APP_ORIGIN=https://app.gengrowth.ai`, session-mode `DATABASE_URL`,
  `DB_POOL_MAX=2`, shared Supabase/OAuth/encryption values,
  `SF_BLOB_BACKEND=supabase`, the two bucket names, and the selected worker-only
  LLM configuration. Set `DATAFORSEO_ENABLED=true`, the reviewed row cap, and
  `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` only in Railway **[Owner]**
- [ ] Leave `APP_BUILD_SHA` unset so `RAILWAY_GIT_COMMIT_SHA` reports the actual
  source, or set it only to exact `<release SHA>` **[Owner]**
- [ ] Deploy `<release SHA>` and retain sanitized Railway evidence that startup
  reports the same SHA, the recovery sweep succeeds, pg-boss starts and the
  worker holds its readiness lease **[Owner/me]**
- [ ] Confirm logs contain no environment values, tokens, provider bodies,
  model output, object keys or customer content **[me]**

The worker intentionally has no URL. Supabase stores its live session advisory
lease; the Vercel web `/api/mvp/health/ready` endpoint is the external readiness
probe.

## Phase 4 — Unique Vercel web deployment

- [ ] Use the Vercel project with Root Directory `apps/web`, Next.js preset,
  Node `24.x`, source files outside Root Directory and System Environment
  Variables enabled **[Owner]**
- [ ] Set Production variables from the approved web template/dashboard:
  `APP_ORIGIN=https://app.gengrowth.ai`, session-mode `DATABASE_URL`,
  `DB_POOL_MAX=1`, the same Supabase/OAuth/encryption/bucket settings,
  `SUPABASE_ANON_KEY`, `SF_BLOB_BACKEND=supabase`, `DATAFORSEO_ENABLED=true`,
  and the same non-secret DataForSEO row cap **[Owner]**
- [ ] Leave `NEXT_PUBLIC_BASE_PATH` unset. Do not set `/app`; this release serves
  the root of `app.gengrowth.ai` **[Owner]**
- [ ] Do not set `SF_DEV_AUTH`, `SF_BLOB_DIR`, worker-only LLM values, or
  `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` in Vercel **[Owner]**
- [ ] Leave `APP_BUILD_SHA` unset so `VERCEL_GIT_COMMIT_SHA` reports the actual
  source, or set it only to exact `<release SHA>` **[Owner]**
- [ ] Deploy `<release SHA>` to a **unique Vercel URL without promoting the
  production domain** **[Owner/me]**
- [ ] Verify the unique deployment reports `<release SHA>` and liveness 200;
  liveness alone is not promotion evidence **[me]**
- [ ] Verify `/api/mvp/health/ready` returns 200 because the Supabase schema and
  Railway worker lease are present **[me]**
- [ ] Run the supported unauthenticated and authenticated smoke checks against
  the unique deployment. If Auth redirect allowlisting requires the production
  origin, retain the unique-URL checks and repeat the Auth portion immediately
  after promotion **[Owner/me]**

Example probes (replace `<unique-vercel-url>`):

```bash
curl -fsS https://<unique-vercel-url>/api/mvp/health/version
curl -fsS https://<unique-vercel-url>/api/mvp/health/live
curl -fsS https://<unique-vercel-url>/api/mvp/health/ready
```

## Phase 5 — Promote app.gengrowth.ai

Promote only after Phases 1–4 pass against the same `<release SHA>`.

- [ ] Confirm Railway worker logs and Vercel
  `/api/mvp/health/version` report the exact same `<release SHA>` **[me]**
- [ ] Promote or alias the already-verified unique Vercel deployment to
  `https://app.gengrowth.ai`; do not trigger an unverified rebuild **[Owner/me]**
- [ ] Repeat the production-origin health checks **[me]**:

  ```bash
  curl -fsS https://app.gengrowth.ai/api/mvp/health/version
  curl -fsS https://app.gengrowth.ai/api/mvp/health/live
  curl -fsS https://app.gengrowth.ai/api/mvp/health/ready
  ```

- [ ] Verify `buildSha=<release SHA>`, liveness 200 and readiness 200. A readiness
  503 means the worker lease is absent; fix Railway and do not waive the gate
  **[Owner/me]**
- [ ] Perform real Supabase Auth login with a pre-provisioned operator at
  `https://app.gengrowth.ai/login`; verify entry, session protection and logout
  **[Owner/me]**
- [ ] Prove a valid but deliberately unprovisioned Auth user remains denied and
  creates no workspace or `operator_profiles` row **[Owner]**
- [ ] Verify response CSP uses a per-request nonce and contains no
  `unsafe-inline`/`unsafe-eval` **[me]**

Until this phase passes, describe the release as “deployed; production-origin
verification in progress,” not as pilot-ready.

## Phase 6 — Provider, lifecycle and business acceptance

- [ ] Complete live Google OAuth → GSC property selection and a real collection
  using Owner-approved data; retain sanitized evidence **[Owner]**
- [ ] Complete live GA4 property/key-event synchronization **[Owner]**
- [ ] Run one cost-capped DataForSEO ranked-keywords collection from Sources;
  verify the terminal run, immutable snapshot and `vendor_observation / B`
  evidence, and retain sanitized Railway logs proving no Authorization,
  credentials or provider response body was emitted **[Owner/me]**
- [ ] Generate a production structured-LLM Artifact with the selected worker
  provider configuration **[Owner]**
- [ ] Verify a signed export download works, expires in 900 seconds and never
  exposes a public Storage URL **[Owner/me]**
- [ ] Verify sanitized retention/orphan sweep success, the 90-day raw and
  dual-anchored 30-day export lifecycle, and no capacity-exceeded event
  **[Owner/me]**
- [ ] Complete database/PITR and separate Storage-byte recovery evidence per
  `docs/RESTORE-DRILL.md` **[Owner]**
- [ ] Complete and sign off the EN/zh-CN and B2B/B2C walkthrough covering
  evidence, priority, Action, Artifact and both export bundle types **[Owner]**

Only after all applicable Phase 6 gates pass may the release be described as
pilot-ready.
