# SignalFrame MVP — Operations Runbook

> Operator playbook for the pilot (spec §15, DoD item 7). Covers local dev boot,
> provider outages, stuck jobs, OAuth revocation, credential rotation, export
> regeneration, and rollback. Contract version `0.2.0 / 2026-07-18`.

## Local development boot

```bash
# 1. Postgres (local dev uses bare Postgres 16 on :5432 while Docker/colima is down)
createdb signalframe_mvp_dev
DATABASE_URL=postgres://$USER@localhost:5432/signalframe_mvp_dev pnpm db:migrate

# 2. Env: copy .env.example → .env.local and fill values.
#    CREDENTIAL_ENCRYPTION_KEY: openssl rand -base64 32
#    Local QA uses the double-gated dev auth shim: set SF_DEV_AUTH=true (NODE_ENV!=production only).
#    Google OAuth / OpenAI keys are placeholders until those flows are exercised.

# 3. Web + worker (two terminals)
pnpm --filter @sf/web dev            # http://localhost:3000
DATABASE_URL=... pnpm --filter @sf/worker dev

# Blob storage is filesystem-backed locally at .data/blob (SF_BLOB_DIR to override);
# Supabase Storage swaps in at deploy time behind the same BlobStore interface.
```

Full green gate: see `docs/PROGRESS.md` "Full green gate command".

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

- A worker crash mid-run can leave an `async_runs` row in `running`. The run is
  claimed once (queued→running winner only), so a retry cannot double-write a
  snapshot/finding/artifact (unique keys, §13.3).
- **Recovery**: inspect `async_runs` for `running` rows with an old `started_at`.
  Re-enqueue is not automatic in the MVP; re-trigger the originating action
  (collect / diagnose / generate / export) — idempotency + active-key uniqueness
  prevent duplicates while one is genuinely active.
- `/api/mvp/health/ready` checks DB + pg-boss schema; a red readiness means the
  worker cannot claim jobs.

## OAuth revocation (customer revokes Google access)

- Collection runs begin failing `AUTH_REQUIRED`. The stored token is now invalid.
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

- Export objects live 30 days; signed download URLs expire in 15 minutes.
- **Regenerate**: POST a new export of the same kind. The bundle checksum +
  manifest allow corruption detection; a fresh object key is minted each time.

## Rollback

- Deploy order: migration job first, then web + worker on the same commit
  (§15.3). The worker tolerates the current and previous job-payload contract
  version.
- **Rollback**: redeploy the previous commit's web + worker together. Schema
  changes are append-only / additive in the MVP; no destructive down-migration is
  required for a same-minor rollback. Verify `/health/version` reports the
  expected `0.2.0` after rollback.
