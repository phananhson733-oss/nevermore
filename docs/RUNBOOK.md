# SignalFrame MVP — Operations Runbook

> Operator playbook for the pilot (spec §15, DoD item 7). Covers local dev boot,
> provider outages, stuck jobs, OAuth revocation, credential rotation, export
> regeneration, and rollback. Contract version `0.2.0 / 2026-07-18`.

## Local development boot

```bash
# 1. Postgres (local dev uses bare Postgres 16 on :5432 while Docker/colima is down)
createdb signalframe_mvp_dev
DATABASE_URL=postgres://$USER@localhost:5432/signalframe_mvp_dev pnpm db:migrate

# 2. Env: copy .env.example → the repo-root .env.local and fill values.
#    CREDENTIAL_ENCRYPTION_KEY: openssl rand -base64 32
#    Local QA uses the double-gated dev auth shim: set SF_DEV_AUTH=true (NODE_ENV!=production only).
#    Google OAuth / OpenAI keys are placeholders until those flows are exercised.
#    Next loads .env.local from each app dir, so symlink the root file into both apps:
ln -sf ../../.env.local apps/web/.env.local
ln -sf ../../.env.local apps/worker/.env.local   # (both are gitignored)

# 3. Web + worker (two terminals). Both load .env.local from their app dir:
#    web via Next, worker via `tsx --env-file-if-exists` (see apps/worker/package.json).
pnpm --filter @sf/web dev            # http://localhost:3000 (Next)
pnpm --filter @sf/worker dev         # tsx watch; creates the pgboss schema on first run
# /api/mvp/health/ready is 503 until the worker has created the pgboss schema; start the worker.

# Local/test blob storage is enabled with SF_BLOB_BACKEND=local and REQUIRES an
# explicit absolute SF_BLOB_DIR. Web and worker must receive the same value (the
# shared .env.local symlink above does that); no path is inferred from either cwd.
# To test Supabase locally, set SF_BLOB_BACKEND=supabase instead.
```

In hosted/production mode, both web and worker use the same `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `RAW_IMPORT_BUCKET`, and `EXPORT_BUCKET` values.
Create both buckets as **private**; raw imports/snapshots route only to
`RAW_IMPORT_BUCKET`, while export bundles and their signed downloads route only
to `EXPORT_BUCKET`. Production refuses a local filesystem backend so the two
processes cannot silently split storage by host or working directory.

For the exact local verification matrix and the separate hosted launch gates,
see `docs/PROGRESS.md`.

## Production topology and deploy

- **Web — Vercel**: create the project with Root Directory `apps/web`, Framework
  Preset `Next.js`, Node `24.x`, and enable both “Include source files outside of
  the Root Directory in the Build Step” and System Environment Variables. Leave
  install/build/output overrides empty so Vercel/Next monorepo detection and the
  root `packageManager` pin select pnpm `10.32.1`; set
  `ENABLE_EXPERIMENTAL_COREPACK=1` if the project does not already use Corepack.
- **Worker — Railway**: use the repository root and committed `railway.json`.
  It builds `Dockerfile.worker`; Node (not pnpm) is PID 1 and receives SIGTERM for
  graceful pg-boss/readiness-lease shutdown. The worker has no HTTP port, so do
  not configure a Railway HTTP `healthcheckPath`.
- **State — Supabase**: run `pnpm db:migrate` as a one-off release job before
  promoting web/worker. Auth, Postgres, and both private Storage buckets live in
  the same Supabase project; web and worker must receive the same database,
  credential-encryption, OAuth, service-role, and bucket configuration.
- Vercel exposes `VERCEL_GIT_COMMIT_SHA` when System Environment Variables are
  enabled; Railway exposes `RAILWAY_GIT_COMMIT_SHA`.
  `/api/mvp/health/version` and worker startup/ready logs report that immutable
  SHA (or explicit `APP_BUILD_SHA`).

Run `pnpm deploy:check` before release. Deploy migrations, worker, then web; only
promote traffic after `/api/mvp/health/ready` reports database, pg-boss schema,
and the live worker advisory lease as ready.

## Provider outage (Google GSC/GA4, OpenAI)

- **Symptom**: collection or artifact runs end `failed` with `lastErrorCode` in
  {`RATE_LIMITED`, `TIMEOUT`, `DEPENDENCY_UNAVAILABLE`, `AUTH_REQUIRED`}.
- **Transient** (rate limit / network / 5xx): pg-boss retries per queue policy
  (§13.1). No action needed unless retries exhaust.
- **Persistent**: the source stays connected; re-trigger the collection from the
  Sources screen once the provider recovers. Evidence honesty holds — an
  unavailable metric is `null`, never `0`; the snapshot records `availability` +
  a `limitation`.
- **OpenAI down**: artifact generation fails; template-mode generation still works
  (no LLM). Regenerate later in `structured_llm` mode.

## Stuck / lost job

- pg-boss jobs have a worker heartbeat. If a process dies after claiming a run,
  heartbeat expiry moves the job through its configured retry policy; delivery
  metadata lets the later retry reclaim only the matching stale canonical
  attempt. A delayed retry cannot steal a newer attempt or cross project scope.
- The worker scans both canonical `queued` and `running` rows at startup and once
  per minute. Public pg-boss states `created` / `retry` / `active` remain active;
  `failed`, `cancelled`, or a queue job that completed without a canonical result
  are converted to a matching stable terminal `async_runs` outcome. A missing
  job is failed only after a conservative one-hour grace period. Legacy jobs with
  random pg-boss IDs are found from their scoped payload.
- **Do not re-trigger while the canonical run is `queued` or `running`**: the
  active-key constraint correctly rejects it. Inspect `last_error_code` after
  automatic reconciliation (`QUEUE_RETRY_EXHAUSTED`, `QUEUE_JOB_FAILED`,
  `QUEUE_JOB_CANCELLED`, `QUEUE_JOB_COMPLETED_WITHOUT_CANONICAL_RESULT`,
  `QUEUE_JOB_MISSING`, or `QUEUE_MAPPING_INVALID`). Once the run is terminal,
  retry from the originating product action if the underlying dependency is
  healthy. Final artifact retry exhaustion also atomically moves the owned
  `execution_artifacts` projection from `generating` to `failed`. Never update
  pg-boss tables directly.
- `/api/mvp/health/ready` checks DB + pg-boss schema + a live worker session
  advisory lease; a red readiness means the worker cannot claim jobs.

## Background maintenance and private-object orphans

- Worker startup performs the blocking run-recovery sweep before it reports
  ready. It then repeats recovery every minute. The same sweep scrubs expired
  OAuth intent secrets and prunes at most one bounded page of expired product
  idempotency rows. Idempotency expiry correctness does not depend on the sweep:
  reads, reuse and contention use the PostgreSQL clock atomically; pruning is
  capacity maintenance only.
- Private-object cleanup starts asynchronously after recovery so a large Storage
  listing cannot hold readiness red. It performs one immediate sweep and then
  repeats every 24 hours. Graceful shutdown waits for an in-flight sweep.
- The orphan sweep enumerates each fixed family independently: `raw`,
  `raw-import`, `snapshot-raw`, and `export`. A candidate must be at least 24
  hours old according to the database clock and absent from all canonical object
  references (`data_snapshots.raw_object_key`,
  `import_previews.raw_object_key`, and `export_bundles.object_key`) before it is
  deleted.
- Every family is fail-closed: listing must finish with valid, advancing cursors
  before the first delete for that family. A malformed/repeated page, Storage
  outage, or DB lookup failure skips deletion for that family and retries on a
  later sweep. Reference lookups and list pages are bounded.
- Upload paths also attempt an immediate best-effort delete if the subsequent DB
  transaction fails. The delayed sweep covers a process crash between upload and
  commit. The 24-hour floor protects live uploads and short outages.
- Normal evidence is `orphan_cleanup_completed` with aggregate counts only.
  Failure logs use stable codes (`ORPHAN_CLEANUP_KIND_FAILED`,
  `STORAGE_DELETE_FAILED`, or `ORPHAN_CLEANUP_SWEEP_FAILED`) and a fixed kind;
  they deliberately omit object keys, provider errors and customer identifiers.
- If failures persist, verify the worker's DB session, private-bucket permissions
  and paginated list API. Do **not** bulk-delete a prefix or copy object keys into
  tickets/logs. Restore the dependency and let the next sweep run (or perform a
  controlled worker restart, which schedules an immediate sweep). A delete
  failure is safe to retry because object deletion is idempotent.

## OAuth revocation (customer revokes Google access)

- Expiring access tokens refresh automatically. A revoked refresh grant ends the
  collection as `AUTH_REQUIRED`; deployment credential errors remain a distinct
  `INVALID_CONFIGURATION` worker failure and are not blamed on the user.
- **Action**: from Sources, **Disconnect** the GSC/GA4 source (this erases the
  credential ciphertext immediately, §12.3; historical snapshots are retained),
  then **Connect** again through the 3-phase OAuth flow.

## Credential rotation (`CREDENTIAL_ENCRYPTION_KEY`)

- Google tokens are AES-256-GCM encrypted with `CREDENTIAL_ENCRYPTION_KEY`
  (`key_version` recorded per credential).
- **Rotation**: deploy the new key, then have operators disconnect + reconnect the
  affected GSC/GA4 sources (re-encrypts under the new key). Old ciphertext is
  unreadable after rotation by design — never store the key in the DB or logs.

## Export regeneration

- Export objects live 30 days; signed download URLs expire in 15 minutes (900s).
- The 15-minute URL TTL is enforced in code, per URL, by the export download signer
  (`createSupabaseDownloadSigner`, `@sf/sources`); `getProjectExport` requests it
  with `expiresInSeconds: 900`. Signed URLs are project-scoped: a key outside the
  caller's project is rejected before signing and surfaces as 404, never a URL.
  A missing committed object is distinguished from a Storage signing/network
  failure; neither path returns a fabricated or public URL.
- The 30-day object retention is a Supabase Storage bucket lifecycle policy on
  `EXPORT_BUCKET`, configured on the bucket itself (out of application-code scope) —
  local dev (filesystem store) cannot enforce it.
- **Regenerate**: POST a new export of the same kind. The bundle checksum +
  manifest allow corruption detection; a fresh, non-overwritable object key is
  minted each time (`mintExportObjectKey`).

## Rollback

- Deploy order: migration job first, then web + worker on the same commit
  (§15.3). The worker tolerates the current and previous job-payload contract
  version.
- **Rollback**: redeploy the previous commit's web + worker together. Schema
  changes are append-only / additive in the MVP; no destructive down-migration is
  required for a same-minor rollback. Verify `/api/mvp/health/version` reports the
  expected `0.2.0` after rollback.
