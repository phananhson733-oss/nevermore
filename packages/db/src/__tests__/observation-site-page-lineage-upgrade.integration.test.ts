import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { listMigrationFiles } from "../migrate.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const SOURCE_DATABASE_URL = requireSafeTestDatabaseUrl(
  process.env["DATABASE_URL"],
);
const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);
const TARGET_DATABASE_PATTERN =
  /^signalframe_codex_observation_0016_[a-f0-9]{12}$/u;
const CAPTURED_AT = "2026-07-22T06:07:08.901Z";
const ORIGIN = "https://lineage.example";

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000201",
  project: "00000000-0000-4000-8000-000000000202",
  site: "00000000-0000-4000-8000-000000000203",
  otherSite: "00000000-0000-4000-8000-000000000204",
  actor: "00000000-0000-4000-8000-000000000205",
  crawlSource: "00000000-0000-4000-8000-000000000211",
  gscSource: "00000000-0000-4000-8000-000000000212",
  ga4Source: "00000000-0000-4000-8000-000000000213",
  crawlRun: "00000000-0000-4000-8000-000000000221",
  gscRun: "00000000-0000-4000-8000-000000000222",
  ga4Run: "00000000-0000-4000-8000-000000000223",
  crawlSnapshot: "00000000-0000-4000-8000-000000000231",
  gscSnapshot: "00000000-0000-4000-8000-000000000232",
  ga4Snapshot: "00000000-0000-4000-8000-000000000233",
  crawlPage: "00000000-0000-4000-8000-000000000241",
  gscPage: "00000000-0000-4000-8000-000000000242",
  ga4Page: "00000000-0000-4000-8000-000000000243",
  ambiguousPage: "00000000-0000-4000-8000-000000000244",
  ambiguousSlashPage: "00000000-0000-4000-8000-000000000245",
  foreignSitePage: "00000000-0000-4000-8000-000000000246",
  crawlObservation: "00000000-0000-4000-8000-000000000251",
  unmatchedCrawlObservation: "00000000-0000-4000-8000-000000000252",
  gscObservation: "00000000-0000-4000-8000-000000000253",
  ga4Observation: "00000000-0000-4000-8000-000000000254",
  ambiguousObservation: "00000000-0000-4000-8000-000000000255",
  siteObservation: "00000000-0000-4000-8000-000000000256",
  ambiguousSlashObservation: "00000000-0000-4000-8000-000000000257",
  mismatchedCrawlObservation: "00000000-0000-4000-8000-000000000258",
} as const;

const URLS = {
  crawl: `${ORIGIN}/crawl/`,
  gsc: `${ORIGIN}/gsc/`,
  ga4: `${ORIGIN}/ga4/?a=1`,
  ambiguous: `${ORIGIN}/ambiguous`,
  ambiguousSlash: `${ORIGIN}/ambiguous/`,
  foreignSite: "https://other.lineage.example/foreign/",
} as const;

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
    `signalframe_codex_observation_0016_${randomBytes(6).toString("hex")}`;
  databaseIdentifier(databaseName);
  const url = new URL(SOURCE_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return {
    databaseName,
    connectionString: requireSafeTestDatabaseUrl(
      url.toString(),
      "generated DATABASE_URL",
    ),
  };
}

async function applyMigration(
  client: pg.Client,
  migrationFile: string,
): Promise<void> {
  await client.query(
    readFileSync(`${MIGRATIONS_DIRECTORY}/${migrationFile}`, "utf8"),
  );
}

async function seedAt0015(client: pg.Client): Promise<void> {
  await client.query(
    "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
    [IDS.workspace, "Observation lineage migration fixture"],
  );
  await client.query(`
    INSERT INTO app.client_projects (
      id, workspace_id, client_name, project_name,
      default_delivery_locale, created_by
    ) VALUES ($1, $2, 'Traceable customer', 'Observation lineage', 'en-US', $3)
  `, [IDS.project, IDS.workspace, IDS.actor]);
  await client.query(`
    INSERT INTO app.sites (
      id, workspace_id, project_id, origin, host,
      market_codes, language_codes, is_primary
    ) VALUES
      ($1, $2, $3, $4, 'lineage.example', ARRAY['US'], ARRAY['en'], true),
      ($5, $2, $3, 'https://other.lineage.example', 'other.lineage.example',
       ARRAY['US'], ARRAY['en'], false)
  `, [IDS.site, IDS.workspace, IDS.project, ORIGIN, IDS.otherSite]);

  await client.query(`
    INSERT INTO app.source_connections (
      id, workspace_id, project_id, site_id, provider,
      connection_type, state, external_ref, limitation,
      connected_at, created_by
    ) VALUES
      ($1, $2, $3, $4, 'crawl', 'public', 'available', $5,
       'Crawl migration fixture.', $6, $7),
      ($8, $2, $3, $4, 'gsc', 'oauth', 'connected', $5,
       'GSC migration fixture.', $6, $7),
      ($9, $2, $3, $4, 'ga4', 'oauth', 'connected', $5,
       'GA4 migration fixture.', $6, $7)
  `, [
    IDS.crawlSource,
    IDS.workspace,
    IDS.project,
    IDS.site,
    ORIGIN,
    CAPTURED_AT,
    IDS.actor,
    IDS.gscSource,
    IDS.ga4Source,
  ]);

  await client.query(`
    INSERT INTO app.async_runs (
      id, workspace_id, project_id, kind, status, initiated_by, started_at
    ) VALUES
      ($1, $2, $3, 'collection', 'running', $4, $5),
      ($6, $2, $3, 'collection', 'running', $4, $5),
      ($7, $2, $3, 'collection', 'running', $4, $5)
  `, [
    IDS.crawlRun,
    IDS.workspace,
    IDS.project,
    IDS.actor,
    CAPTURED_AT,
    IDS.gscRun,
    IDS.ga4Run,
  ]);
  await client.query(`
    INSERT INTO app.collection_runs (
      id, workspace_id, project_id, site_id, source_connection_id,
      provider, operation, method_version, parameters_hash
    ) VALUES
      ($1, $2, $3, $4, $5, 'crawl', 'site_graph', 'fixture.crawl.v1', $6),
      ($7, $2, $3, $4, $8, 'gsc', 'search_analytics', 'fixture.gsc.v1', $6),
      ($9, $2, $3, $4, $10, 'ga4', 'organic_landing', 'fixture.ga4.v1', $6)
  `, [
    IDS.crawlRun,
    IDS.workspace,
    IDS.project,
    IDS.site,
    IDS.crawlSource,
    "a".repeat(64),
    IDS.gscRun,
    IDS.gscSource,
    IDS.ga4Run,
    IDS.ga4Source,
  ]);
  await client.query(`
    INSERT INTO app.data_snapshots (
      id, workspace_id, project_id, site_id, collection_run_id,
      source_connection_id, provider, dataset_key, schema_version,
      method_version, captured_at, source_window, availability,
      limitation, row_count, checksum
    ) VALUES
      ($1, $2, $3, $4, $5, $6, 'crawl', 'crawl.site_graph.v1', '1',
       'fixture.crawl.v1', $7, '{"start":null,"end":null}', 'available',
       'Crawl legacy snapshot.', 2, $8),
      ($9, $2, $3, $4, $10, $11, 'gsc', 'gsc.page_query_daily.v1', '1',
       'fixture.gsc.v1', $7, '{"start":null,"end":null}', 'available',
       'GSC legacy snapshot.', 2, $8),
      ($12, $2, $3, $4, $13, $14, 'ga4', 'ga4.organic_landing_daily.v1', '1',
       'fixture.ga4.v1', $7, '{"start":null,"end":null}', 'available',
       'GA4 legacy snapshot.', 1, $8)
  `, [
    IDS.crawlSnapshot,
    IDS.workspace,
    IDS.project,
    IDS.site,
    IDS.crawlRun,
    IDS.crawlSource,
    CAPTURED_AT,
    "b".repeat(64),
    IDS.gscSnapshot,
    IDS.gscRun,
    IDS.gscSource,
    IDS.ga4Snapshot,
    IDS.ga4Run,
    IDS.ga4Source,
  ]);

  const pages = [
    [IDS.crawlPage, IDS.site, URLS.crawl],
    [IDS.gscPage, IDS.site, URLS.gsc],
    [IDS.ga4Page, IDS.site, URLS.ga4],
    [IDS.ambiguousPage, IDS.site, URLS.ambiguous],
    [IDS.ambiguousSlashPage, IDS.site, URLS.ambiguousSlash],
    [IDS.foreignSitePage, IDS.otherSite, URLS.foreignSite],
  ] as const;
  for (const [id, siteId, normalizedUrl] of pages) {
    await client.query(`
      INSERT INTO app.site_pages (
        id, workspace_id, project_id, site_id,
        normalized_url, normalized_url_hash
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      id,
      IDS.workspace,
      IDS.project,
      siteId,
      normalizedUrl,
      normalizedUrlHash(normalizedUrl),
    ]);
  }

  await client.query(`
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, provider, metric_key,
      subject_type, subject_ref, observed_at, availability, value_json,
      origin, grade, support, limitation
    ) VALUES
      ($1, $2, $3, $4, 'crawl', 'crawl.page.v1', 'url', $5, $6,
       'available', $7, 'direct_public', 'B', 'supports', 'Exact Crawl legacy row.'),
      ($8, $2, $3, $4, 'crawl', 'crawl.page.v1', 'url', $9, $6,
       'available', $10, 'direct_public', 'B', 'supports', 'Unmatched Crawl legacy row.'),
      ($11, $2, $3, $12, 'gsc', 'gsc.page.v1', 'url', $13, $6,
       'available', '{}', 'first_party', 'A', 'supports', 'Unique GSC legacy row.'),
      ($14, $2, $3, $15, 'ga4', 'ga4.landing.v1', 'url', $16, $6,
       'available', '{}', 'first_party', 'A', 'supports', 'Unique GA4 legacy row.'),
      ($17, $2, $3, $12, 'gsc', 'gsc.page.v1', 'url', $18, $6,
       'available', '{}', 'first_party', 'A', 'supports', 'Ambiguous GSC legacy row.'),
      ($19, $2, $3, $4, 'crawl', 'crawl.robots.v1', 'site', $20, $6,
       'available', '{}', 'direct_public', 'B', 'context', 'Site legacy row.')
  `, [
    IDS.crawlObservation,
    IDS.workspace,
    IDS.project,
    IDS.crawlSnapshot,
    `${ORIGIN}/crawl`,
    CAPTURED_AT,
    { fetchUrl: URLS.crawl, status: 200 },
    IDS.unmatchedCrawlObservation,
    `${ORIGIN}/missing`,
    { fetchUrl: `${ORIGIN}/missing/`, status: 200 },
    IDS.gscObservation,
    IDS.gscSnapshot,
    `${ORIGIN}/gsc`,
    IDS.ga4Observation,
    IDS.ga4Snapshot,
    `${ORIGIN}/ga4?a=1`,
    IDS.ambiguousObservation,
    URLS.ambiguous,
    IDS.siteObservation,
    ORIGIN,
  ]);
  await client.query(`
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, provider, metric_key,
      subject_type, subject_ref, observed_at, availability, value_json,
      origin, grade, support, limitation
    ) VALUES (
      $1, $2, $3, $4, 'gsc', 'gsc.page.v1',
      'url', $5, $6, 'available', '{}',
      'first_party', 'A', 'supports',
      'Legacy slash subject must still count both exact variants.'
    )
  `, [
    IDS.ambiguousSlashObservation,
    IDS.workspace,
    IDS.project,
    IDS.gscSnapshot,
    URLS.ambiguousSlash,
    CAPTURED_AT,
  ]);
  await client.query(`
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, provider, metric_key,
      subject_type, subject_ref, observed_at, availability, value_json,
      origin, grade, support, limitation
    ) VALUES (
      $1, $2, $3, $4, 'crawl', 'crawl.page.v1',
      'url', $5, $6, 'available', $7,
      'direct_public', 'B', 'supports',
      'Legacy mismatched aggregation subject must remain unlinked.'
    )
  `, [
    IDS.mismatchedCrawlObservation,
    IDS.workspace,
    IDS.project,
    IDS.crawlSnapshot,
    `${ORIGIN}/not-the-crawl-subject`,
    CAPTURED_AT,
    { fetchUrl: URLS.crawl, status: 200 },
  ]);
}

async function readLineage(client: pg.Client): Promise<Record<string, string | null>> {
  const result = await client.query<{ id: string; site_page_id: string | null }>(`
    SELECT id::text, site_page_id::text
    FROM app.normalized_observations
    WHERE id = ANY($1::uuid[])
    ORDER BY id
  `, [[
    IDS.crawlObservation,
    IDS.unmatchedCrawlObservation,
    IDS.gscObservation,
    IDS.ga4Observation,
    IDS.ambiguousObservation,
    IDS.siteObservation,
    IDS.ambiguousSlashObservation,
    IDS.mismatchedCrawlObservation,
  ]]);
  return Object.fromEntries(
    result.rows.map((row) => [row.id, row.site_page_id]),
  );
}

describe("Observation SitePage lineage migration 0016", () => {
  it("backfills only provable history and enforces exact append-only lineage for new rows", async () => {
    const disposable = deriveDisposableDatabase();
    const databaseIdentifierSql = databaseIdentifier(disposable.databaseName);
    const admin = new pg.Client({ connectionString: SOURCE_DATABASE_URL });
    let target: pg.Client | null = null;
    let databaseCreated = false;

    await admin.connect();
    try {
      await admin.query(
        `CREATE DATABASE ${databaseIdentifierSql} TEMPLATE template0`,
      );
      databaseCreated = true;
      target = new pg.Client({ connectionString: disposable.connectionString });
      await target.connect();

      const migrations = listMigrationFiles();
      const migration0015 = migrations.indexOf("0015_frozen_crawl_seed.sql");
      expect(migration0015).toBeGreaterThanOrEqual(0);
      expect(migrations[migration0015 + 1]).toBe(
        "0016_observation_site_page_lineage.sql",
      );
      for (const migration of migrations.slice(0, migration0015 + 1)) {
        await applyMigration(target, migration);
      }
      await seedAt0015(target);
      const factualBefore = await target.query<{ id: string; facts: unknown }>(`
        SELECT id::text, jsonb_build_object(
          'subjectRef', subject_ref,
          'valueJson', value_json,
          'limitation', limitation
        ) AS facts
        FROM app.normalized_observations
        ORDER BY id
      `);
      expect(await readLineageBefore0016(target)).toBe(false);

      await applyMigration(target, "0016_observation_site_page_lineage.sql");
      expect(await readLineage(target)).toEqual({
        [IDS.crawlObservation]: IDS.crawlPage,
        [IDS.unmatchedCrawlObservation]: null,
        [IDS.gscObservation]: IDS.gscPage,
        [IDS.ga4Observation]: IDS.ga4Page,
        [IDS.ambiguousObservation]: null,
        [IDS.siteObservation]: null,
        [IDS.ambiguousSlashObservation]: null,
        [IDS.mismatchedCrawlObservation]: null,
      });
      const factualAfter = await target.query<{ id: string; facts: unknown }>(`
        SELECT id::text, jsonb_build_object(
          'subjectRef', subject_ref,
          'valueJson', value_json,
          'limitation', limitation
        ) AS facts
        FROM app.normalized_observations
        ORDER BY id
      `);
      expect(factualAfter.rows).toEqual(factualBefore.rows);
      await expect(target.query(`SELECT count(*)::text FROM app.page_snapshots`))
        .resolves.toMatchObject({ rows: [{ count: "0" }] });

      // Every SitePage writer shares the same canonical-subject lock. A direct
      // `/serialized` insert must therefore block its `/serialized/` variant,
      // proving non-collection upserts cannot race analytics resolution.
      const contender = new pg.Client({
        connectionString: disposable.connectionString,
      });
      await contender.connect();
      try {
        const serialized = `${ORIGIN}/serialized`;
        await target.query("BEGIN");
        await target.query(`
          INSERT INTO app.site_pages (
            workspace_id, project_id, site_id,
            normalized_url, normalized_url_hash
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          IDS.workspace,
          IDS.project,
          IDS.site,
          serialized,
          normalizedUrlHash(serialized),
        ]);
        await contender.query("SET lock_timeout = '100ms'");
        await expect(contender.query(`
          INSERT INTO app.site_pages (
            workspace_id, project_id, site_id,
            normalized_url, normalized_url_hash
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          IDS.workspace,
          IDS.project,
          IDS.site,
          `${serialized}/`,
          normalizedUrlHash(`${serialized}/`),
        ])).rejects.toMatchObject({ code: "55P03" });
        await target.query("ROLLBACK");
      } finally {
        await target.query("ROLLBACK").catch(() => undefined);
        await contender.end();
      }

      const insertObservation = (values: {
        readonly snapshotId: string;
        readonly provider: "crawl" | "gsc" | "ga4";
        readonly metricKey: string;
        readonly subjectType?: "url" | "site";
        readonly subjectRef: string;
        readonly sitePageId?: string | null;
        readonly valueJson: unknown;
      }) => target!.query<{ id: string }>(`
        INSERT INTO app.normalized_observations (
          workspace_id, project_id, snapshot_id, site_page_id,
          provider, metric_key, subject_type, subject_ref,
          observed_at, availability, value_json,
          origin, grade, support, limitation
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, 'available', $10,
          $11, $12, 'supports', 'New lineage guard fixture.'
        ) RETURNING id::text
      `, [
        IDS.workspace,
        IDS.project,
        values.snapshotId,
        values.sitePageId ?? null,
        values.provider,
        values.metricKey,
        values.subjectType ?? "url",
        values.subjectRef,
        CAPTURED_AT,
        values.valueJson,
        values.provider === "crawl" ? "direct_public" : "first_party",
        values.provider === "crawl" ? "B" : "A",
      ]);

      // A direct Observation writer must acquire the same canonical-subject
      // lock as every SitePage writer. While the unique GSC lineage is being
      // inserted, creating its other exact/slash variant must block instead
      // of racing the trigger's candidate-count proof.
      const observationLockContender = new pg.Client({
        connectionString: disposable.connectionString,
      });
      await observationLockContender.connect();
      try {
        await target.query("BEGIN");
        await insertObservation({
          snapshotId: IDS.gscSnapshot,
          provider: "gsc",
          metricKey: "gsc.page.v1",
          subjectRef: `${ORIGIN}/gsc`,
          sitePageId: IDS.gscPage,
          valueJson: {},
        });
        await observationLockContender.query("SET lock_timeout = '100ms'");
        await expect(observationLockContender.query(`
          INSERT INTO app.site_pages (
            workspace_id, project_id, site_id,
            normalized_url, normalized_url_hash
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          IDS.workspace,
          IDS.project,
          IDS.site,
          `${ORIGIN}/gsc`,
          normalizedUrlHash(`${ORIGIN}/gsc`),
        ])).rejects.toMatchObject({ code: "55P03" });
        await target.query("ROLLBACK");
      } finally {
        await target.query("ROLLBACK").catch(() => undefined);
        await observationLockContender.end();
      }

      await expect(insertObservation({
        snapshotId: IDS.crawlSnapshot,
        provider: "crawl",
        metricKey: "crawl.page.v1",
        subjectRef: `${ORIGIN}/crawl`,
        valueJson: { fetchUrl: URLS.crawl },
      })).rejects.toMatchObject({ code: "23514" });
      await expect(insertObservation({
        snapshotId: IDS.crawlSnapshot,
        provider: "crawl",
        metricKey: "crawl.page.v1",
        subjectRef: `${ORIGIN}/crawl`,
        sitePageId: IDS.gscPage,
        valueJson: { fetchUrl: URLS.crawl },
      })).rejects.toMatchObject({ code: "23514" });
      await expect(insertObservation({
        snapshotId: IDS.crawlSnapshot,
        provider: "crawl",
        metricKey: "crawl.page.v1",
        subjectRef: `${ORIGIN}/not-the-crawl-subject`,
        sitePageId: IDS.crawlPage,
        valueJson: { fetchUrl: URLS.crawl },
      })).rejects.toMatchObject({ code: "23514" });
      const validCrawl = await insertObservation({
        snapshotId: IDS.crawlSnapshot,
        provider: "crawl",
        metricKey: "crawl.page.v1",
        subjectRef: `${ORIGIN}/crawl`,
        sitePageId: IDS.crawlPage,
        valueJson: { fetchUrl: URLS.crawl },
      });
      await expect(insertObservation({
        snapshotId: IDS.gscSnapshot,
        provider: "gsc",
        metricKey: "gsc.page.v1",
        subjectRef: `${ORIGIN}/gsc`,
        sitePageId: IDS.foreignSitePage,
        valueJson: {},
      })).rejects.toMatchObject({ code: "23514" });
      await expect(insertObservation({
        snapshotId: IDS.crawlSnapshot,
        provider: "crawl",
        metricKey: "crawl.robots.v1",
        subjectType: "site",
        subjectRef: ORIGIN,
        sitePageId: IDS.crawlPage,
        valueJson: {},
      })).rejects.toMatchObject({ code: "23514" });
      await expect(insertObservation({
        snapshotId: IDS.gscSnapshot,
        provider: "gsc",
        metricKey: "gsc.page.v1",
        subjectRef: `${ORIGIN}/gsc`,
        sitePageId: null,
        valueJson: {},
      })).rejects.toMatchObject({ code: "23514" });
      await expect(insertObservation({
        snapshotId: IDS.gscSnapshot,
        provider: "gsc",
        metricKey: "gsc.page.v1",
        subjectRef: `${ORIGIN}/gsc`,
        sitePageId: IDS.crawlPage,
        valueJson: {},
      })).rejects.toMatchObject({ code: "23514" });
      await expect(insertObservation({
        snapshotId: IDS.gscSnapshot,
        provider: "gsc",
        metricKey: "gsc.page.v1",
        subjectRef: `${ORIGIN}/gsc`,
        sitePageId: IDS.gscPage,
        valueJson: {},
      })).resolves.toMatchObject({ rowCount: 1 });
      await expect(insertObservation({
        snapshotId: IDS.ga4Snapshot,
        provider: "ga4",
        metricKey: "ga4.landing.v1",
        subjectRef: `${ORIGIN}/ga4?a=1`,
        sitePageId: IDS.ga4Page,
        valueJson: {},
      })).resolves.toMatchObject({ rowCount: 1 });
      await expect(insertObservation({
        snapshotId: IDS.gscSnapshot,
        provider: "gsc",
        metricKey: "gsc.page.v1",
        subjectRef: URLS.ambiguous,
        sitePageId: IDS.ambiguousPage,
        valueJson: {},
      })).rejects.toMatchObject({ code: "23514" });
      await expect(insertObservation({
        snapshotId: IDS.gscSnapshot,
        provider: "gsc",
        metricKey: "gsc.page.v1",
        subjectRef: URLS.ambiguous,
        sitePageId: null,
        valueJson: {},
      })).resolves.toMatchObject({ rowCount: 1 });

      await expect(target.query(`
        UPDATE app.normalized_observations
        SET limitation = 'Mutation must remain forbidden.'
        WHERE id = $1
      `, [validCrawl.rows[0]!.id])).rejects.toMatchObject({ code: "55000" });

      const beforeReplay = await readLineage(target);
      await applyMigration(target, "0016_observation_site_page_lineage.sql");
      expect(await readLineage(target)).toEqual(beforeReplay);
      await expect(target.query(`
        UPDATE app.normalized_observations
        SET limitation = 'Replay must restore append-only too.'
        WHERE id = $1
      `, [validCrawl.rows[0]!.id])).rejects.toMatchObject({ code: "55000" });
    } finally {
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

async function readLineageBefore0016(client: pg.Client): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'app'
        AND table_name = 'normalized_observations'
        AND column_name = 'site_page_id'
    ) AS present
  `);
  return result.rows[0]?.present ?? false;
}
