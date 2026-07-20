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
#    Local QA uses the double-gated dev auth shim: set SF_DEV_AUTH=true only for
#    explicit loopback local development (NODE_ENV=development with loopback APP_ORIGIN).
#    Google OAuth / OpenAI keys are placeholders until those flows are exercised.
#    Next loads .env.local from each app dir, so symlink the root file into both apps:
ln -sf ../../.env.local apps/web/.env.local
ln -sf ../../.env.local apps/worker/.env.local   # (both are gitignored)

# 3. Web + worker (two terminals). Both load .env.local from their app dir:
#    web via Next, worker via `tsx --env-file-if-exists` (see apps/worker/package.json).
pnpm --filter @sf/web dev            # http://localhost:3000 (Next)
pnpm --filter @sf/worker dev         # explicit NODE_ENV=development; creates pgboss on first run
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

- **Authority / decision gate**: frozen spec §3.2 requires Railway web+worker
  from the same image/commit. Vercel web + Render worker + `/app` is a prepared
  candidate only. Do not mutate hosted state until the Owner records one choice
  and the exact release SHA; see `docs/DEPLOYMENT.md`.
- **Frozen Railway path**: create `web` and `worker` from the repository root,
  the same SHA and `/railway.json`; both build `Dockerfile.railway`. Web uses the
  image CMD. Worker must use the service-level override
  `node --enable-source-maps --import tsx apps/worker/src/index.ts` and must not
  have an HTTP healthcheck. Verify both hosted image/SHA identities before
  promotion; exact steps are in `docs/DEPLOYMENT.md`.
- **Candidate web — Vercel**: create the project with Root Directory `apps/web`, Framework
  Preset `Next.js`, Node `24.x`, and enable both “Include source files outside of
  the Root Directory in the Build Step” and System Environment Variables. Leave
  install/build/output overrides empty so Vercel/Next monorepo detection and the
  root `packageManager` pin select pnpm `10.32.1`; set
  `ENABLE_EXPERIMENTAL_COREPACK=1` if the project does not already use Corepack.
- **Candidate worker — Render**: use the repository root and committed
  `render.yaml` Background Worker. It builds `Dockerfile.worker`; Node (not pnpm)
  is PID 1 and receives SIGTERM for graceful pg-boss/readiness-lease shutdown.
  The worker has no HTTP port. This Blueprint prepares the direct OpenAI path;
  Azure is a runtime-supported manual variant, not an encoded Blueprint option.
- **State — Supabase**: run `pnpm db:migrate` as a one-off release job before
  promoting web/worker. Auth, Postgres, and both private Storage buckets live in
  the same Supabase project; web and worker must receive the same database,
  credential-encryption, OAuth, service-role, and bucket configuration.
- Vercel exposes `VERCEL_GIT_COMMIT_SHA` when System Environment Variables are
  enabled; Render exposes `RENDER_GIT_COMMIT`; Railway exposes
  `RAILWAY_GIT_COMMIT_SHA`.
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
  (no LLM). Regenerate later in `structured_llm` mode. Optional localized Finding
  summaries fall back to honestly labelled English; set
  `FINDING_SUMMARIES_ENABLED=false` to disable further summary calls without
  disabling structured Artifact generation.

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
- **Upgrade compatibility check:** releases created before the canonical CSV
  payload included `sourceConnectionId` may have an already-active CSV run that
  cannot safely project a failed recovery back to its SourceConnection. Before
  deploying this release, inspect for `kind='collection'`, active status,
  `request_payload->>'provider'='csv'`, and a missing
  `request_payload->>'sourceConnectionId'`. Drain/terminalize those old jobs or
  perform a separately reviewed, strictly project-scoped one-time migration.
  Recovery intentionally fails safe and does not guess the source from a side
  table. Newly enqueued CSV runs always include the canonical source ID.
- `/api/mvp/health/ready` checks DB + pg-boss schema + a live worker session
  advisory lease; a red readiness means the worker cannot claim jobs.

## Background maintenance and private-object orphans

- Worker startup performs the blocking run-recovery sweep before it reports
  ready. It then repeats recovery every minute. The same sweep scrubs expired
  OAuth intent secrets and prunes at most one bounded page of expired product
  idempotency rows. Idempotency expiry correctness does not depend on the sweep:
  reads, reuse and contention use the PostgreSQL clock atomically; pruning is
  capacity maintenance only. Each recovery sweep has a 55-second observation
  deadline and an abort signal. A late driver operation remains observed and
  prevents an overlapping real sweep; after shutdown is requested, its late
  settlement cannot start the next DB or queue operation.
- Private-object cleanup starts asynchronously after recovery so a large Storage
  listing cannot hold readiness red. It performs one immediate sweep and then
  repeats every 24 hours. Graceful shutdown aborts an in-flight sweep and waits
  at most five seconds for each maintenance loop. Retention, orphan, and recovery
  stop concurrently, so a stuck Storage operation cannot prevent the other loops
  from stopping before pg-boss and the database are closed. If shutdown arrives
  during blocking startup recovery, the worker does not start either Storage
  loop afterward.
- The orphan sweep enumerates each fixed family independently: `raw`,
  `raw-import`, `snapshot-raw`, and `export`. A candidate must be at least 24
  hours old according to the database clock and absent from all canonical object
  references (`data_snapshots.raw_object_key`,
  `import_previews.raw_object_key`, and `export_bundles.object_key`) before it is
  deleted.
- `raw-import`, `snapshot-raw`, and `export` writers acquire a
  transaction-scoped advisory lock for the immutable object key before upload
  and hold it through canonical commit. Orphan deletion acquires that same lock,
  repeats the canonical reference check, and only then deletes while the lock is
  held. Keys are sorted
  and deduplicated before a maintenance chunk takes locks. Runtime database
  sessions enforce a 30-second lock timeout plus four-minute statement and
  idle-in-transaction timeouts; all are far below the 24-hour orphan floor.
  Export cleanup additionally retains the defense-in-depth canonical run fence
  encoded in the key and the exact bundle-reference check; active or
  inconsistent runs always retain the object.
- Every family is fail-closed: listing must finish with valid, advancing cursors
  before the first delete for that family. A malformed/repeated page, Storage
  outage, or DB lookup failure skips deletion for that family and retries on a
  later sweep. Reference lookups and list pages are bounded. Candidate keys are
  streamed through private `0600` temporary files rather than retained in an
  unbounded array; each kind is capped at 100,000 objects/candidates and 2,000
  pages, and deletion concurrency is fixed at four.
- The 100,000-object limit is a **pilot hard capacity boundary**, not a durable
  resume mechanism. A kind that exceeds it restarts from the first cursor on the
  next sweep and is not guaranteed to make progress. Production promotion must
  therefore prove every kind is at or below the limit, alert before it is
  reached using the successful sweep's aggregate `scannedCount`, and page an
  operator on `ORPHAN_CLEANUP_CAPACITY_EXCEEDED` or
  `STORAGE_RETENTION_CAPACITY_EXCEEDED`. Expansion beyond this boundary requires
  a reviewed durable-cursor/window design; repeatedly restarting a worker is not
  a remedy.
- Upload paths also attempt an immediate best-effort delete if the subsequent DB
  transaction fails. The delayed sweep covers a process crash between upload and
  commit. The 24-hour floor protects live uploads and short outages.
- A separate application-owned retention sweep starts asynchronously and repeats
  every 24 hours. It uses the PostgreSQL clock against immutable Storage
  `createdAt` metadata: `raw`, `raw-import`, and `snapshot-raw` bytes expire at
  exactly 90 days. Export bytes expire only when both immutable Storage
  `createdAt` and the canonical completed export run are at least 30 days old;
  an active, unknown, or inconsistent export run fails closed. Canonical rows,
  object keys, manifests, and checksums remain append-only and are not deleted.
- Retention deliberately deletes expired bytes even while a canonical row still
  references the key. Reference presence protects a live object from *orphan*
  cleanup; it does not override the fixed data lifecycle. Each kind must finish
  bounded, validated pagination before its first retention delete, so list or
  cursor failures fail that kind closed. Retention uses the same private spool,
  100,000-object/expired-key and 2,000-page caps, and four-delete concurrency.
  Deletes are idempotent and retry daily.
- Normal evidence is `orphan_cleanup_completed` with aggregate counts only.
  Failure logs use stable codes (`ORPHAN_CLEANUP_KIND_FAILED`,
  `ORPHAN_CLEANUP_CAPACITY_EXCEEDED`, `STORAGE_DELETE_FAILED`, or
  `ORPHAN_CLEANUP_SWEEP_FAILED`) and a fixed kind; they deliberately omit object
  keys, provider errors and customer identifiers.
- Retention evidence follows the same redaction rule:
  `retention_cleanup_completed` contains aggregate counts only, while failures
  use `STORAGE_RETENTION_KIND_FAILED`,
  `STORAGE_RETENTION_CAPACITY_EXCEEDED`,
  `STORAGE_RETENTION_DELETE_FAILED`, or `STORAGE_RETENTION_SWEEP_FAILED` plus a
  fixed kind where applicable. Object keys and raw Storage/DB error messages are
  never logged.
- If failures persist, verify the worker's DB session, private-bucket permissions
  and paginated list API. Do **not** bulk-delete a prefix or copy object keys into
  tickets/logs. Restore the dependency and let the next sweep run (or perform a
  controlled worker restart, which schedules an immediate sweep). A delete
  failure is safe to retry because object deletion is idempotent.

## Worker health and shutdown telemetry

- Once the worker owns its readiness lease, it starts a non-blocking health
  snapshot and repeats every minute. `worker_health_snapshot` contains only DB
  pool counters, the readiness boolean, and four fixed run-kind aggregates:
  queued/running depth, oldest queued age, 24-hour average/max duration, retries,
  and failures. It never includes SQL, bind values, run IDs, payloads, object
  keys, provider errors, or customer fields.
- The aggregate query has a five-second observation deadline. A driver query
  that settles late remains rejection-observed and prevents another query from
  being layered over it. Query failure emits only
  `worker_health_snapshot_failed` with `WORKER_HEALTH_QUERY_FAILED`; it neither
  blocks `worker_ready` nor stops maintenance.
- `db_slow_query` contains exactly `durationMs` and the fixed `thresholdMs`
  (1,000 ms). SQL text, values, connection details, and errors never reach the
  callback.
- Shutdown order is readiness lease, health loop, maintenance loops, pg-boss,
  then database. Each outer stage has a ten-second deadline and late rejections
  remain observed, so one dependency cannot skip later cleanup. SIGINT and
  SIGTERM share the same idempotent stop promise; only the separate 45-second
  force deadline uses explicit process exit.

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
- The worker enforces the 30-day object-byte retention through the application
  retention sweep; it does not depend on a provider-specific bucket lifecycle
  feature. After the database-clock boundary, the export detail API no longer
  calls the signer and returns stable `NOT_FOUND` metadata with
  `reason=retention_expired` and `regeneratable=true`.
- **Regenerate**: POST a new export of the same kind. The bundle checksum +
  manifest allow corruption detection; a fresh, non-overwritable object key is
  minted each time (`mintExportObjectKey`).

## Rollback

- Deploy order: migration job first, then web + worker on the same commit
  (§15.3). Known legacy pg-boss jobs with random IDs are recovered through their
  exact scoped payload. Do not infer general previous-payload compatibility;
  perform the active CSV audit above and review every payload change before an
  upgrade or rollback.
- **Rollback**: redeploy the previous commit's web + worker together. Schema
  changes are append-only / additive in the MVP; no destructive down-migration is
  required for a same-minor rollback. Verify web `/api/mvp/health/version` and
  worker startup/ready logs both report the exact expected rollback `buildSha`
  (not merely product version `0.2.0`) before declaring the rollback complete.
