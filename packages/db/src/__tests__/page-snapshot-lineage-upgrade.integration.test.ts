import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import {
  canonicalize,
  contentHash,
  type CanonicalValue,
} from "../hash.ts";
import { listMigrationFiles } from "../migrate.ts";
import { PageSnapshotsRepository } from "../repositories/page-snapshots.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const SOURCE_DATABASE_URL = requireSafeTestDatabaseUrl(
  process.env["DATABASE_URL"],
);
const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);
const TARGET_DATABASE_PATTERN =
  /^signalframe_codex_page_snapshot_0012_[a-f0-9]{12}$/u;

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000101",
  project: "00000000-0000-4000-8000-000000000102",
  site: "00000000-0000-4000-8000-000000000103",
  source: "00000000-0000-4000-8000-000000000104",
  asyncRun: "00000000-0000-4000-8000-000000000105",
  dataSnapshot: "00000000-0000-4000-8000-000000000106",
  replayPage: "00000000-0000-4000-8000-000000000107",
  replaySnapshot: "00000000-0000-4000-8000-000000000108",
  conflictPage: "00000000-0000-4000-8000-000000000109",
  conflictSnapshotA: "00000000-0000-4000-8000-000000000110",
  conflictSnapshotB: "00000000-0000-4000-8000-000000000111",
  verifiedPage: "00000000-0000-4000-8000-000000000112",
  verifiedSnapshot: "00000000-0000-4000-8000-000000000113",
  duplicatePage: "00000000-0000-4000-8000-000000000114",
} as const;

const CAPTURED_AT = "2026-07-22T03:04:05.678Z";
const CREATED_AT = "2026-07-22T03:04:06.000Z";
const REPLAY_URL = "https://upgrade.example/replay/";
const CONFLICT_URL = "https://upgrade.example/conflict/";
const VERIFIED_URL = "https://upgrade.example/verified/";
const REPLAY_EXTRACT = {
  a: { enabled: true, label: "海外增长" },
  z: [3, 2, 1],
} satisfies CanonicalValue;
const CONFLICT_EXTRACT_A = {
  status: 200,
  title: "Original title",
} satisfies CanonicalValue;
const CONFLICT_EXTRACT_B = {
  status: 200,
  title: "Changed legacy title",
} satisfies CanonicalValue;
const VERIFIED_EXTRACT = {
  schemaVersion: "crawl.page-extract.v1",
  subjectUrl: VERIFIED_URL,
  depth: 0,
  projection: { fetchUrl: VERIFIED_URL },
} satisfies CanonicalValue;

interface LegacySnapshotBytes {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_page_id: string;
  readonly data_snapshot_id: string;
  readonly content_hash: string;
  readonly extract_text: string;
  readonly captured_at: string;
  readonly created_at: string;
}

function databaseIdentifier(databaseName: string): string {
  if (!TARGET_DATABASE_PATTERN.test(databaseName)) {
    throw new Error("generated database name failed the disposable-name policy");
  }
  return `"${databaseName}"`;
}

function deriveDisposableDatabase(): {
  readonly databaseName: string;
  readonly connectionString: string;
} {
  const databaseName =
    `signalframe_codex_page_snapshot_0012_${randomBytes(6).toString("hex")}`;
  databaseIdentifier(databaseName);

  const url = new URL(SOURCE_DATABASE_URL);
  const sourceDatabaseName = decodeURIComponent(url.pathname.slice(1));
  if (sourceDatabaseName === databaseName) {
    throw new Error("generated database must differ from the source database");
  }
  url.pathname = `/${databaseName}`;
  const connectionString = requireSafeTestDatabaseUrl(
    url.toString(),
    "generated DATABASE_URL",
  );
  return { databaseName, connectionString };
}

async function applyMigration(
  client: pg.Client,
  migrationFile: string,
): Promise<void> {
  await client.query(
    readFileSync(`${MIGRATIONS_DIRECTORY}/${migrationFile}`, "utf8"),
  );
}

async function readLegacySnapshotBytes(
  client: pg.Client,
): Promise<readonly LegacySnapshotBytes[]> {
  const result = await client.query<LegacySnapshotBytes>(`
    SELECT
      id::text,
      workspace_id::text,
      project_id::text,
      site_page_id::text,
      data_snapshot_id::text,
      content_hash,
      extract::text AS extract_text,
      captured_at::text,
      created_at::text
    FROM app.page_snapshots
    WHERE id = ANY($1::uuid[])
    ORDER BY id
  `, [
    [
      IDS.replaySnapshot,
      IDS.conflictSnapshotA,
      IDS.conflictSnapshotB,
    ],
  ]);
  return result.rows;
}

async function seedSchemaAt0011(client: pg.Client): Promise<void> {
  await client.query(
    "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
    [IDS.workspace, "Page snapshot migration fixture"],
  );
  await client.query(`
    INSERT INTO app.client_projects (
      id, workspace_id, client_name, project_name,
      default_delivery_locale, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    IDS.project,
    IDS.workspace,
    "Traceable customer",
    "Lineage upgrade",
    "en-US",
    IDS.workspace,
  ]);
  await client.query(`
    INSERT INTO app.sites (
      id, workspace_id, project_id, origin, host,
      market_codes, language_codes, is_primary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
  `, [
    IDS.site,
    IDS.workspace,
    IDS.project,
    "https://upgrade.example",
    "upgrade.example",
    ["US"],
    ["en"],
  ]);
  await client.query(`
    INSERT INTO app.source_connections (
      id, workspace_id, project_id, site_id, provider,
      connection_type, state, limitation, created_by, connected_at
    ) VALUES ($1, $2, $3, $4, 'crawl', 'public', 'available', $5, $6, $7)
  `, [
    IDS.source,
    IDS.workspace,
    IDS.project,
    IDS.site,
    "Disposable integration source.",
    IDS.workspace,
    CAPTURED_AT,
  ]);
  await client.query(`
    INSERT INTO app.async_runs (
      id, workspace_id, project_id, kind, status,
      initiated_by, completed_at
    ) VALUES ($1, $2, $3, 'collection', 'completed', $4, $5)
  `, [
    IDS.asyncRun,
    IDS.workspace,
    IDS.project,
    IDS.workspace,
    CAPTURED_AT,
  ]);
  await client.query(`
    INSERT INTO app.collection_runs (
      id, workspace_id, project_id, site_id, source_connection_id,
      provider, operation, method_version, parameters_hash, row_count
    ) VALUES (
      $1, $2, $3, $4, $5,
      'crawl', 'site_graph', 'integration.fixture.v1', $6, 3
    )
  `, [
    IDS.asyncRun,
    IDS.workspace,
    IDS.project,
    IDS.site,
    IDS.source,
    "a".repeat(64),
  ]);
  await client.query(`
    INSERT INTO app.data_snapshots (
      id, workspace_id, project_id, site_id, collection_run_id,
      source_connection_id, provider, dataset_key, schema_version,
      method_version, captured_at, source_window, availability,
      limitation, row_count, checksum
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, 'crawl', 'crawl.site_graph.v1', 'integration.fixture.v1',
      'integration.fixture.v1', $7, $8, 'available',
      $9, 3, $10
    )
  `, [
    IDS.dataSnapshot,
    IDS.workspace,
    IDS.project,
    IDS.site,
    IDS.asyncRun,
    IDS.source,
    CAPTURED_AT,
    { start: null, end: null },
    "Disposable integration snapshot.",
    "b".repeat(64),
  ]);
  await client.query(`
    INSERT INTO app.site_pages (
      id, workspace_id, project_id, site_id,
      normalized_url, normalized_url_hash
    ) VALUES
      ($1, $2, $3, $4, $5, $6),
      ($7, $2, $3, $4, $8, $9)
  `, [
    IDS.replayPage,
    IDS.workspace,
    IDS.project,
    IDS.site,
    REPLAY_URL,
    contentHash(REPLAY_URL),
    IDS.conflictPage,
    CONFLICT_URL,
    contentHash(CONFLICT_URL),
  ]);
  await client.query(`
    INSERT INTO app.page_snapshots (
      id, workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, extract, captured_at, created_at
    ) VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9),
      ($10, $2, $3, $11, $5, $12, $13, $8, $9)
  `, [
    IDS.replaySnapshot,
    IDS.workspace,
    IDS.project,
    IDS.replayPage,
    IDS.dataSnapshot,
    contentHash(REPLAY_EXTRACT),
    REPLAY_EXTRACT,
    CAPTURED_AT,
    CREATED_AT,
    IDS.conflictSnapshotA,
    IDS.conflictPage,
    contentHash(CONFLICT_EXTRACT_A),
    CONFLICT_EXTRACT_A,
  ]);

  // The real 0011 table already forbids an identical legacy duplicate. Keep
  // that invariant intact instead of weakening it to manufacture test data.
  await expect(client.query(`
    INSERT INTO app.page_snapshots (
      id, workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, extract, captured_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    IDS.conflictSnapshotB,
    IDS.workspace,
    IDS.project,
    IDS.conflictPage,
    IDS.dataSnapshot,
    contentHash(CONFLICT_EXTRACT_A),
    CONFLICT_EXTRACT_A,
    CAPTURED_AT,
    CREATED_AT,
  ])).rejects.toMatchObject({
    code: "23505",
    constraint:
      "page_snapshots_site_page_id_data_snapshot_id_content_hash_key",
  });

  // Duplicate page/source identities are possible only when their immutable
  // content hashes differ. Migration 0012 must preserve this real legacy state.
  await client.query(`
    INSERT INTO app.page_snapshots (
      id, workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, extract, captured_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    IDS.conflictSnapshotB,
    IDS.workspace,
    IDS.project,
    IDS.conflictPage,
    IDS.dataSnapshot,
    contentHash(CONFLICT_EXTRACT_B),
    CONFLICT_EXTRACT_B,
    CAPTURED_AT,
    CREATED_AT,
  ]);
}

describe("page snapshot lineage migration 0012", () => {
  it("upgrades populated 0011 history without rewriting or inventing lineage", async () => {
    const disposable = deriveDisposableDatabase();
    const databaseIdentifierSql = databaseIdentifier(disposable.databaseName);
    const admin = new pg.Client({ connectionString: SOURCE_DATABASE_URL });
    let databaseCreated = false;
    let target: pg.Client | null = null;
    let handle: DbHandle | null = null;

    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${databaseIdentifierSql} TEMPLATE template0`);
      databaseCreated = true;
      target = new pg.Client({ connectionString: disposable.connectionString });
      await target.connect();

      const migrations = listMigrationFiles();
      const migration0011 = migrations.indexOf(
        "0011_product_profile_foundation.sql",
      );
      expect(migration0011).toBeGreaterThanOrEqual(0);
      expect(migrations[migration0011 + 1]).toBe(
        "0012_page_snapshot_lineage_hardening.sql",
      );
      for (const migration of migrations.slice(0, migration0011 + 1)) {
        await applyMigration(target, migration);
      }
      await expect(target.query<{ migration_version: string }>(`
        SELECT migration_version FROM app.schema_migration_version
      `)).resolves.toMatchObject({
        rows: [{ migration_version: "0011_product_profile_foundation" }],
      });

      await seedSchemaAt0011(target);
      const beforeRows = await readLegacySnapshotBytes(target);
      expect(beforeRows).toHaveLength(3);
      const beforeBytes = Buffer.from(JSON.stringify(beforeRows), "utf8");

      await target.query(`
        INSERT INTO app.site_pages (
          id, workspace_id, project_id, site_id,
          normalized_url, normalized_url_hash
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        IDS.duplicatePage,
        IDS.workspace,
        IDS.project,
        IDS.site,
        REPLAY_URL,
        contentHash({ normalizedUrl: REPLAY_URL }),
      ]);
      await expect(
        applyMigration(target, "0012_page_snapshot_lineage_hardening.sql"),
      ).rejects.toMatchObject({
        code: "23514",
        message:
          "site page URL duplicates or SHA-256 collision prevent identity backfill",
      });
      await target.query("ROLLBACK");
      await target.query("DELETE FROM app.site_pages WHERE id = $1", [
        IDS.duplicatePage,
      ]);

      // Apply the checked-in migration as-is against the populated legacy DB.
      await applyMigration(target, "0012_page_snapshot_lineage_hardening.sql");
      await expect(target.query<{ migration_version: string }>(`
        SELECT migration_version FROM app.schema_migration_version
      `)).resolves.toMatchObject({
        rows: [{
          migration_version: "0012_page_snapshot_lineage_hardening",
        }],
      });

      const afterRows = await readLegacySnapshotBytes(target);
      const afterBytes = Buffer.from(JSON.stringify(afterRows), "utf8");
      expect(afterBytes.equals(beforeBytes)).toBe(true);
      expect(afterRows).toEqual(beforeRows);

      const pageIdentity = await target.query<{
        id: string;
        normalized_url: string;
        normalized_url_hash: string;
      }>(`
        SELECT id::text, normalized_url, normalized_url_hash
        FROM app.site_pages
        WHERE id = ANY($1::uuid[])
        ORDER BY id
      `, [[IDS.replayPage, IDS.conflictPage]]);
      expect(pageIdentity.rows).toEqual([
        {
          id: IDS.replayPage,
          normalized_url: REPLAY_URL,
          normalized_url_hash: normalizedUrlHash(REPLAY_URL),
        },
        {
          id: IDS.conflictPage,
          normalized_url: CONFLICT_URL,
          normalized_url_hash: normalizedUrlHash(CONFLICT_URL),
        },
      ]);
      await expect(target.query<{ site_page_id: string }>(`
        SELECT site_page_id::text
        FROM app.page_snapshots
        WHERE id = $1
      `, [IDS.replaySnapshot])).resolves.toMatchObject({
        rows: [{ site_page_id: IDS.replayPage }],
      });

      const legacyState = await target.query<{
        id: string;
        canonical_extract: string | null;
      }>(`
        SELECT id::text, canonical_extract
        FROM app.page_snapshots
        WHERE id = ANY($1::uuid[])
        ORDER BY id
      `, [[
        IDS.replaySnapshot,
        IDS.conflictSnapshotA,
        IDS.conflictSnapshotB,
      ]]);
      expect(legacyState.rows).toEqual([
        { id: IDS.replaySnapshot, canonical_extract: null },
        { id: IDS.conflictSnapshotA, canonical_extract: null },
        { id: IDS.conflictSnapshotB, canonical_extract: null },
      ]);

      const requiredConstraint = await target.query<{
        convalidated: boolean;
      }>(`
        SELECT convalidated
        FROM pg_constraint
        WHERE conname = 'page_snapshots_canonical_extract_required'
          AND conrelid = 'app.page_snapshots'::regclass
      `);
      expect(requiredConstraint.rows).toEqual([{ convalidated: false }]);

      const fullIdentityConstraint = await target.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM pg_constraint
        WHERE conname = 'page_snapshots_site_page_data_snapshot_key'
          AND conrelid = 'app.page_snapshots'::regclass
      `);
      expect(fullIdentityConstraint.rows).toEqual([{ count: "0" }]);

      await target.query(`
        INSERT INTO app.site_pages (
          id, workspace_id, project_id, site_id,
          normalized_url, normalized_url_hash
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        IDS.verifiedPage,
        IDS.workspace,
        IDS.project,
        IDS.site,
        VERIFIED_URL,
        normalizedUrlHash(VERIFIED_URL),
      ]);
      await expect(target.query(`
        INSERT INTO app.page_snapshots (
          id, workspace_id, project_id, site_page_id, data_snapshot_id,
          content_hash, extract, captured_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        IDS.verifiedSnapshot,
        IDS.workspace,
        IDS.project,
        IDS.verifiedPage,
        IDS.dataSnapshot,
        contentHash(VERIFIED_EXTRACT),
        VERIFIED_EXTRACT,
        CAPTURED_AT,
        CREATED_AT,
      ])).rejects.toMatchObject({ code: "23514" });

      const canonicalExtract = canonicalize(VERIFIED_EXTRACT);
      await expect(target.query(`
        INSERT INTO app.page_snapshots (
          id, workspace_id, project_id, site_page_id, data_snapshot_id,
          content_hash, canonical_extract, extract, captured_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        IDS.verifiedSnapshot,
        IDS.workspace,
        IDS.project,
        IDS.verifiedPage,
        IDS.dataSnapshot,
        contentHash(VERIFIED_EXTRACT),
        canonicalExtract,
        VERIFIED_EXTRACT,
        CAPTURED_AT,
        CREATED_AT,
      ])).resolves.toMatchObject({ rowCount: 1 });
      await expect(target.query<{
        canonical_extract: string;
        content_hash: string;
      }>(`
        SELECT canonical_extract, content_hash
        FROM app.page_snapshots
        WHERE id = $1
      `, [IDS.verifiedSnapshot])).resolves.toMatchObject({
        rows: [{
          canonical_extract: canonicalExtract,
          content_hash: contentHash(VERIFIED_EXTRACT),
        }],
      });

      await target.end();
      target = null;
      handle = createDbHandle(disposable.connectionString, 1);
      const repository = new PageSnapshotsRepository(handle.db);
      await expect(repository.create({
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        sitePageId: IDS.replayPage,
        dataSnapshotId: IDS.dataSnapshot,
        contentHash: contentHash(REPLAY_EXTRACT),
        extract: REPLAY_EXTRACT,
        capturedAt: CAPTURED_AT,
      })).resolves.toMatchObject({
        id: IDS.replaySnapshot,
        canonical_extract: null,
      });

      await expect(repository.create({
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        sitePageId: IDS.conflictPage,
        dataSnapshotId: IDS.dataSnapshot,
        contentHash: contentHash(CONFLICT_EXTRACT_A),
        extract: CONFLICT_EXTRACT_A,
        capturedAt: CAPTURED_AT,
      })).rejects.toThrow(
        "page snapshot replay conflicts with immutable values",
      );

      const replayRows = await handle.pool.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM app.page_snapshots
        WHERE site_page_id = $1 AND data_snapshot_id = $2
      `, [IDS.replayPage, IDS.dataSnapshot]);
      expect(replayRows.rows).toEqual([{ count: "1" }]);
    } finally {
      if (handle) await handle.end();
      if (target) await target.end();
      if (databaseCreated) {
        await admin.query(`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()
        `, [disposable.databaseName]);
        await admin.query(`DROP DATABASE ${databaseIdentifierSql}`);
      }
      await admin.end();
    }
  });
});
