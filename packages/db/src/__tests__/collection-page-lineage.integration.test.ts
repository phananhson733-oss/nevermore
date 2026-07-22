import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { canonicalize, sha256Hex, type CanonicalValue } from "../hash.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === code,
  );
}

interface Fixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly sourceConnectionId: string;
  readonly actorId: string;
}

const CAPTURED_AT = "2026-07-22T06:07:08.901Z";
const SOURCE_WINDOW = {
  start: "2026-06-01T00:00:00.000Z",
  end: "2026-06-28T23:59:59.999Z",
};

describeDb("collection and page lineage boundary", () => {
  let handle: DbHandle;
  let fixture: Fixture;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL!);
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const siteId = randomUUID();
    const sourceConnectionId = randomUUID();
    const actorId = randomUUID();

    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
      [workspaceId, `Lineage boundary ${workspaceId}`],
    );
    await handle.pool.query(
      `INSERT INTO app.client_projects (
         id, workspace_id, client_name, project_name,
         default_delivery_locale, created_by
       ) VALUES ($1, $2, $3, $4, 'en', $5)`,
      [projectId, workspaceId, "Lineage fixture", "DB hardening", actorId],
    );
    await handle.pool.query(
      `INSERT INTO app.sites (
         id, workspace_id, project_id, origin, host,
         market_codes, language_codes, is_primary
       ) VALUES ($1, $2, $3, $4, $5, ARRAY['US'], ARRAY['en'], true)`,
      [
        siteId,
        workspaceId,
        projectId,
        `https://${projectId}.example.test`,
        `${projectId}.example.test`,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.source_connections (
         id, workspace_id, project_id, site_id, provider,
         connection_type, state, limitation, connected_at, created_by
       ) VALUES ($1, $2, $3, $4, 'crawl', 'public', 'available', $5, $6, $7)`,
      [
        sourceConnectionId,
        workspaceId,
        projectId,
        siteId,
        "Disposable lineage source.",
        CAPTURED_AT,
        actorId,
      ],
    );
    fixture = {
      workspaceId,
      projectId,
      siteId,
      sourceConnectionId,
      actorId,
    };
  });

  afterAll(async () => {
    await handle?.end();
  });

  async function insertAsyncRun(runId: string): Promise<void> {
    await handle.pool.query(
      `INSERT INTO app.async_runs (
         id, workspace_id, project_id, kind, status,
         initiated_by, started_at
       ) VALUES ($1, $2, $3, 'collection', 'running', $4, $5)`,
      [
        runId,
        fixture.workspaceId,
        fixture.projectId,
        fixture.actorId,
        CAPTURED_AT,
      ],
    );
  }

  async function insertPlaceholder(runId: string): Promise<void> {
    await insertAsyncRun(runId);
    await handle.pool.query(
      `INSERT INTO app.collection_runs (
         id, workspace_id, project_id, site_id, source_connection_id,
         provider, operation, method_version, parameters_hash
       ) VALUES (
         $1, $2, $3, $4, $5,
         'crawl', 'site_graph', 'crawl.site_graph.v2', $6
       )`,
      [
        runId,
        fixture.workspaceId,
        fixture.projectId,
        fixture.siteId,
        fixture.sourceConnectionId,
        sha256Hex(`parameters:${runId}`),
      ],
    );
  }

  async function insertSnapshot(runId: string): Promise<string> {
    const snapshotId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.data_snapshots (
         id, workspace_id, project_id, site_id, collection_run_id,
         source_connection_id, provider, dataset_key, schema_version,
         method_version, captured_at, source_window, availability,
         limitation, row_count, checksum
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, 'crawl', 'crawl.site_graph.v1', '1',
         'crawl.site_graph.v2', $7, $8, 'available',
         $9, 1, $10
       )`,
      [
        snapshotId,
        fixture.workspaceId,
        fixture.projectId,
        fixture.siteId,
        runId,
        fixture.sourceConnectionId,
        CAPTURED_AT,
        SOURCE_WINDOW,
        "Disposable lineage snapshot.",
        sha256Hex(`snapshot:${snapshotId}`),
      ],
    );
    return snapshotId;
  }

  it("rejects a CollectionRun INSERT that bypasses the placeholder state", async () => {
    const runId = randomUUID();
    await insertAsyncRun(runId);

    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.collection_runs (
           id, workspace_id, project_id, site_id, source_connection_id,
           provider, operation, method_version, parameters_hash,
           source_window, provider_usage, row_count, stop_reason
         ) VALUES (
           $1, $2, $3, $4, $5,
           'crawl', 'site_graph', 'crawl.site_graph.v2', $6,
           $7, '{"pagesCollected":1}'::jsonb, 1, NULL
         )`,
        [
          runId,
          fixture.workspaceId,
          fixture.projectId,
          fixture.siteId,
          fixture.sourceConnectionId,
          sha256Hex(`parameters:${runId}`),
          SOURCE_WINDOW,
        ],
      ),
      "23514",
    );
  });

  it("finalizes only after a matching immutable snapshot", async () => {
    const runId = randomUUID();
    await insertPlaceholder(runId);

    await expectPgCode(
      handle.pool.query(
        `UPDATE app.collection_runs
         SET row_count = 1,
             source_window = $2,
             provider_usage = '{"pagesCollected":1}'::jsonb
         WHERE id = $1`,
        [runId, SOURCE_WINDOW],
      ),
      "23514",
    );

    await insertSnapshot(runId);
    await expect(
      handle.pool.query(
        `UPDATE app.collection_runs
         SET row_count = 1,
             source_window = $2,
             provider_usage = '{"pagesCollected":1}'::jsonb
         WHERE id = $1`,
        [runId, SOURCE_WINDOW],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expectPgCode(
      handle.pool.query(
        "UPDATE app.collection_runs SET row_count = 2 WHERE id = $1",
        [runId],
      ),
      "23514",
    );
  });

  it("binds observation metric keys to their snapshot provider and dataset", async () => {
    const runId = randomUUID();
    await insertPlaceholder(runId);
    const snapshotId = await insertSnapshot(runId);

    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.normalized_observations (
           workspace_id, project_id, snapshot_id, provider, metric_key,
           subject_type, subject_ref, observed_at, availability, value_json,
           origin, grade, limitation
         ) VALUES (
           $1, $2, $3, 'crawl', 'gsc.page.v1',
           'url', $4, $5, 'available', '{}'::jsonb,
           'direct_public', 'B', $6
         )`,
        [
          fixture.workspaceId,
          fixture.projectId,
          snapshotId,
          `https://${fixture.projectId}.example.test/metric`,
          CAPTURED_AT,
          "Deliberately mismatched metric fixture.",
        ],
      ),
      "23514",
    );
  });

  it("derives SitePage identity from the exact normalized URL and freezes it", async () => {
    const normalizedUrl =
      `https://${fixture.projectId}.example.test/page/${randomUUID()}/`;

    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.site_pages (
           workspace_id, project_id, site_id, normalized_url,
           normalized_url_hash
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          fixture.workspaceId,
          fixture.projectId,
          fixture.siteId,
          normalizedUrl,
          "f".repeat(64),
        ],
      ),
      "23514",
    );

    const pageId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.site_pages (
         id, workspace_id, project_id, site_id, normalized_url,
         normalized_url_hash
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        pageId,
        fixture.workspaceId,
        fixture.projectId,
        fixture.siteId,
        normalizedUrl,
        sha256Hex(normalizedUrl),
      ],
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.site_pages SET normalized_url = $2 WHERE id = $1",
        [pageId, `${normalizedUrl}changed`],
      ),
      "23514",
    );
  });

  it("binds PageSnapshot schema and fetch identity to its durable SitePage", async () => {
    const runId = randomUUID();
    await insertPlaceholder(runId);
    const snapshotId = await insertSnapshot(runId);
    const normalizedUrl =
      `https://${fixture.projectId}.example.test/snapshot/${randomUUID()}/`;
    const pageId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.site_pages (
         id, workspace_id, project_id, site_id, normalized_url,
         normalized_url_hash
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        pageId,
        fixture.workspaceId,
        fixture.projectId,
        fixture.siteId,
        normalizedUrl,
        sha256Hex(normalizedUrl),
      ],
    );

    const insertExtract = (extract: CanonicalValue) => {
      const canonicalExtract = canonicalize(extract);
      return handle.pool.query(
        `INSERT INTO app.page_snapshots (
           workspace_id, project_id, site_page_id, data_snapshot_id,
           content_hash, canonical_extract, extract, captured_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          fixture.workspaceId,
          fixture.projectId,
          pageId,
          snapshotId,
          sha256Hex(canonicalExtract),
          canonicalExtract,
          canonicalExtract,
          CAPTURED_AT,
        ],
      );
    };

    await expectPgCode(
      insertExtract({
        schemaVersion: "crawl.page-extract.v0",
        subjectUrl: normalizedUrl,
        depth: 0,
        projection: { fetchUrl: normalizedUrl },
      }),
      "23514",
    );
    await expectPgCode(
      insertExtract({
        schemaVersion: "crawl.page-extract.v1",
        subjectUrl: normalizedUrl,
        depth: 0,
        projection: { fetchUrl: `${normalizedUrl}other` },
      }),
      "23514",
    );
  });
});
