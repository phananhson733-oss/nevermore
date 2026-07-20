# SignalFrame backup and restore drill

This runbook covers the AC-047 **local/CI PostgreSQL restore gate**. It proves
that a database dump can be restored into a new isolated database, that the
restored schema remains migration-compatible, and that application data and
object metadata match the source.

It is deliberately not a production Supabase restore procedure. The tool
rejects every non-loopback host, so a hosted database URL cannot be used by
mistake.

## What the gate verifies

The drill performs these steps in order:

1. Parse an explicit `DATABASE_URL` without loading `.env` files. The host must
   be `localhost`, `127.0.0.1`, or `::1`; the database must be a disposable
   `signalframe_ci...` or `signalframe_codex_...` database.
2. Confirm that a cryptographically random target name does not already exist.
   Generated targets match only
   `signalframe_restore_drill_YYYYMMDDtHHMMSS_<12 lowercase hex>`.
3. Read the source inventory and create a private custom-format `pg_dump`.
4. Create the generated target with `createdb` and restore it with
   `pg_restore --exit-on-error --single-transaction`.
5. Discover every regular `*.sql` migration under `packages/db/migrations/`,
   excluding `schema-smoke.sql`, and replay the complete set in lexical order.
   Discovery rejects symlinks/path traversal and the drill stops at the first
   failed migration. Then run `packages/db/migrations/schema-smoke.sql`; the
   smoke transaction rolls back its fixtures.
6. Compare source and restored inventories:
   - row counts for exactly all 28 `app` tables;
   - SHA-256 of every table's canonical JSON row stream, sorted by canonical
     row value;
   - separate SHA-256 probes for `raw_object_key`, `object_key`,
     `content_hash`, `file_checksum`, and `checksum` fields in ICP, import,
     snapshot, artifact, revision, and export records.
7. Drop only the generated target, then query `pg_database` again to prove it
   is absent.
8. Remove the private dump directory in `finally`. Only sanitized JSON and
   Markdown evidence remain.

Any failed verification, failed `dropdb`, unconfirmed target absence, or dump
cleanup failure makes the command exit non-zero. A cleanup command is never
reported as successful merely because it was attempted.

## Prerequisites

- Node.js 24 and the repository's pinned pnpm version.
- A local PostgreSQL server with the authoritative migration already applied to
  the disposable source database.
- `pg_dump`, `createdb`, `pg_restore`, `dropdb`, and `psql` from a PostgreSQL
  client version compatible with the server. Prefer the same major version.
- No writers during the short dump/inventory window. CI naturally satisfies
  this; for a manual local drill, stop the web and worker first.

On Homebrew, select a matching client explicitly when the default `libpq`
version differs from the server:

```sh
export RESTORE_DRILL_PG_BIN=/opt/homebrew/opt/postgresql@16/bin
```

`RESTORE_DRILL_PG_BIN` must be an absolute directory. On GitHub's Ubuntu runner,
leave it unset when the PostgreSQL client is already on `PATH`.

## Run locally

Set the source URL in the environment so credentials never appear as a command
line argument. Do not paste credentials into logs or shell history.

```sh
export DATABASE_URL="postgres://local-role@localhost:5432/signalframe_codex_local"
export RESTORE_DRILL_REPORT_DIR="$PWD/.data/restore-drills/ac047"
pnpm restore:drill:test
pnpm restore:drill
```

The command accepts no CLI arguments. A URL passed as an argument is rejected.
The default evidence directory is `.data/restore-drills`; `.data` is gitignored.

Expected success evidence includes:

```text
status: passed
verification.appTableCount: 28
verification.migrationReplay: passed
verification.schemaSmoke: passed
verification.rowCountsMatch: true
verification.canonicalChecksumsMatch: true
verification.integrityChecksumsMatch: true
verification.canonicalChecksumAlgorithm: sha256
differences: []
cleanup.targetDatabaseDropped: true
cleanup.targetDatabaseAbsentAfterCleanup: true
cleanup.dumpDirectoryRemoved: true
artifacts.backupRetained: false
```

The JSON and Markdown reports contain database names, row counts, and digests,
but never a PostgreSQL URL, password, or row contents. Report files are mode
`0600`.

## CI gate

The static job runs the offline safety tests:

```sh
pnpm restore:drill:test
```

The database job must create and migrate a `signalframe_ci` source database,
then run:

```sh
export RESTORE_DRILL_REPORT_DIR="$RUNNER_TEMP/restore-drill-evidence"
pnpm restore:drill
```

Upload only the JSON and Markdown files from
`$RUNNER_TEMP/restore-drill-evidence`. Never upload PostgreSQL dump files.

## Backup retention exception

The default is to remove the dump on both success and failure. For an explicit,
local forensic workflow only, `KEEP_BACKUP=1` retains the custom dump and
records its path:

```sh
KEEP_BACKUP=1 pnpm restore:drill
```

That file contains the complete database. Keep it on an encrypted local volume,
never upload it as CI evidence, and delete its reported private temporary
directory immediately after investigation. Values other than exactly `1` (or
the default unset/`0`) are rejected.

## Failure response

1. Treat a non-zero exit as a failed gate even if row checks passed; cleanup is
   part of AC-047.
2. Read the sanitized JSON report. Check `error`, `differences`, and every field
   under `cleanup`.
3. Query local `pg_database` for the exact reported generated target name.
   Never broaden a drop command to a wildcard or prefix.
4. If the target remains, verify that its full name matches the generated-name
   grammar before using `dropdb` against loopback PostgreSQL.
5. If dump cleanup failed, treat the temporary directory as sensitive data and
   remove only the exact path after validating its strict
   `signalframe-restore-drill-` basename.
6. Rerun the drill and retain the final passing JSON/Markdown evidence.

## Production Supabase owner drill

Passing this local gate does **not** prove production recovery. The Owner must
separately perform and retain evidence for a Supabase recovery exercise:

1. Confirm the production backup retention and PITR configuration in the
   Supabase dashboard and record the effective RPO/RTO.
2. Restore into a separate, isolated Supabase project. Never restore over the
   production project for a drill.
3. Run the 28-table counts, canonical checksums, and object-metadata probes
   against the isolated copy using an Owner-approved read-only verification
   method. This local tool will reject the hosted URL by design.
4. Validate authentication/roles and run the schema smoke in the isolated
   project without exposing service-role credentials in evidence.
5. PostgreSQL backups do not restore Supabase Storage object bytes. Separately
   verify the private buckets, object counts, sampled byte checksums, retention,
   and recovery procedure; database `object_key`/`checksum` parity proves only
   metadata continuity.
6. Record timestamps, Supabase project identifiers, RPO/RTO observations,
   database and Storage results, cleanup of the isolated project, and Owner
   sign-off.

Until that Owner exercise is complete, describe AC-047 as “local/CI restore
gate passed; production Supabase PITR and Storage recovery evidence pending.”
