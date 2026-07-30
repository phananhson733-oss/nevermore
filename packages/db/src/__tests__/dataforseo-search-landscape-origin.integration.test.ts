import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import {
  CompetitorsRepository,
  type SerpOverlapCompetitorOriginInput,
} from "../repositories/competitors.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CAPTURED_AT = "2026-07-30T08:00:00.000Z";

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly sourceConnectionId: string;
  readonly actorId: string;
}

interface CompositeObservationFixture {
  readonly runId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly domain: string;
}

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
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

async function createProject(handle: DbHandle): Promise<ProjectFixture> {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const sourceConnectionId = randomUUID();
  const actorId = randomUUID();
  const host = `${projectId}.search-landscape.example`;

  await handle.pool.query(
    "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
    [workspaceId, `Search Landscape ${workspaceId}`],
  );
  await handle.pool.query(
    `INSERT INTO app.client_projects (
       id, workspace_id, client_name, project_name,
       default_delivery_locale, created_by
     ) VALUES ($1,$2,$3,$4,'zh-CN',$5)`,
    [
      projectId,
      workspaceId,
      `Client ${projectId}`,
      `Project ${projectId}`,
      actorId,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.sites (
       id, workspace_id, project_id, origin, host,
       market_codes, language_codes, is_primary
     ) VALUES ($1,$2,$3,$4,$5,ARRAY['US'],ARRAY['en-US'],true)`,
    [siteId, workspaceId, projectId, `https://${host}`, host],
  );
  await handle.pool.query(
    `INSERT INTO app.source_connections (
       id, workspace_id, project_id, site_id, provider,
       connection_type, state, external_ref, limitation,
       connected_at, created_by
     ) VALUES (
       $1,$2,$3,$4,'dataforseo','api_key_stub','available',$5,
       'Built-in DataForSEO fixture; no live provider call.',$6,$7
     )`,
    [
      sourceConnectionId,
      workspaceId,
      projectId,
      siteId,
      host,
      CAPTURED_AT,
      actorId,
    ],
  );

  return {
    workspaceId,
    projectId,
    siteId,
    sourceConnectionId,
    actorId,
  };
}

async function createCollectionRun(
  handle: DbHandle,
  project: ProjectFixture,
  operation: string,
  methodVersion: string,
): Promise<string> {
  const runId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.async_runs (
       id, workspace_id, project_id, kind, status,
       initiated_by, started_at
     ) VALUES ($1,$2,$3,'collection','running',$4,$5)`,
    [
      runId,
      project.workspaceId,
      project.projectId,
      project.actorId,
      CAPTURED_AT,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.collection_runs (
       id, workspace_id, project_id, site_id, source_connection_id,
       provider, operation, method_version, parameters_hash
     ) VALUES (
       $1,$2,$3,$4,$5,'dataforseo',$6,$7,$8
     )`,
    [
      runId,
      project.workspaceId,
      project.projectId,
      project.siteId,
      project.sourceConnectionId,
      operation,
      methodVersion,
      contentHash({ runId, operation, methodVersion }),
    ],
  );
  return runId;
}

async function createCompositeObservation(
  handle: DbHandle,
  project: ProjectFixture,
  domain: string,
): Promise<CompositeObservationFixture> {
  const runId = await createCollectionRun(
    handle,
    project,
    "search_landscape",
    "dataforseo.search_landscape.v1",
  );
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.data_snapshots (
       id, workspace_id, project_id, site_id, collection_run_id,
       source_connection_id, provider, dataset_key, schema_version,
       method_version, captured_at, source_window, availability,
       limitation, row_count, checksum, summary
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'dataforseo',
       'dataforseo.search_landscape.v1',
       'dataforseo.search_landscape.v1',
       'dataforseo.search_landscape.v1',
       $7,'{"start":null,"end":null}'::jsonb,'available',
       'Provider competitor-domain data is updated weekly.',1,$8,$9
     )`,
    [
      snapshotId,
      project.workspaceId,
      project.projectId,
      project.siteId,
      runId,
      project.sourceConnectionId,
      CAPTURED_AT,
      contentHash({ snapshotId }),
      {
        collectionScope: {
          target: `${project.projectId}.search-landscape.example`,
          marketCode: "US",
          languageTag: "en-US",
        },
      },
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.normalized_observations (
       id, workspace_id, project_id, snapshot_id, provider,
       metric_key, subject_type, subject_ref, observed_at,
       availability, value_json, origin, grade, support, limitation
     ) VALUES (
       $1,$2,$3,$4,'dataforseo','dataforseo.competitor_domain.v1',
       'site',$5,$6,'available',$7,'vendor_observation','B','supports',
       'Provider competitor-domain data is updated weekly.'
     )`,
    [
      observationId,
      project.workspaceId,
      project.projectId,
      snapshotId,
      domain,
      CAPTURED_AT,
      {
        targetDomain: `${project.projectId}.search-landscape.example`,
        competitorDomain: domain,
        intersections: 17,
        averagePosition: 8.5,
        summedPosition: 144,
        organicEstimatedTrafficVolume: 901.25,
        marketCode: "US",
        languageCode: "en",
      },
    ],
  );
  return { runId, snapshotId, observationId, domain };
}

function serpInput(
  fixture: CompositeObservationFixture,
): SerpOverlapCompetitorOriginInput {
  return {
    originKind: "serp_overlap",
    domain: fixture.domain,
    name: null,
    snapshotId: fixture.snapshotId,
    observationId: fixture.observationId,
    sourcePointer: "/valueJson/competitorDomain",
  };
}

describeDb("DataForSEO Search Landscape competitor origin authority", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    requireSafeTestDatabaseUrl(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
    await handle.pool.query(
      "SELECT 1 FROM app.competitor_origin_occurrences LIMIT 0",
    );
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("creates one candidate origin, replays idempotently, and never overwrites later governance", async () => {
    const project = await createProject(handle);
    const observed = await createCompositeObservation(
      handle,
      project,
      "serp-rival.example",
    );
    const repository = new CompetitorsRepository(handle.db);
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };

    const first = await repository.upsertOrigin(scope, serpInput(observed));
    await expect(
      repository.upsertOrigin(scope, serpInput(observed)),
    ).resolves.toEqual(first);
    await expect(repository.findById(scope, first.competitorId)).resolves.toMatchObject(
      {
        domain: observed.domain,
        name: null,
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        revision: 0,
        last_observed_at: CAPTURED_AT,
        origin_count: 1,
      },
    );
    await expect(
      repository.listOrigins(scope, first.competitorId, 10),
    ).resolves.toEqual([
      expect.objectContaining({
        id: first.occurrenceId,
        origin_kind: "serp_overlap",
        source_name: null,
        data_snapshot_id: observed.snapshotId,
        normalized_observation_id: observed.observationId,
        import_preview_id: null,
        source_pointer: "/valueJson/competitorDomain",
        manual_entry_id: null,
        observed_at: CAPTURED_AT,
      }),
    ]);

    await expect(
      repository.review(scope, first.competitorId, {
        expectedRevision: 0,
        name: "Human-reviewed SERP rival",
        reviewStatus: "approved",
        relationship: "benchmark",
        analysisScope: ["content"],
      }),
    ).resolves.toMatchObject({
      name: "Human-reviewed SERP rival",
      review_status: "approved",
      relationship: "benchmark",
      analysis_scope: ["content"],
      revision: 1,
    });
    await expect(
      repository.upsertOrigin(scope, serpInput(observed)),
    ).resolves.toEqual(first);
    await expect(repository.findById(scope, first.competitorId)).resolves.toMatchObject(
      {
        name: "Human-reviewed SERP rival",
        review_status: "approved",
        relationship: "benchmark",
        analysis_scope: ["content"],
        revision: 1,
        origin_count: 1,
      },
    );
  });

  it("fails closed on mixed Snapshot/Observation identity and non-positive or negative provider facts", async () => {
    const project = await createProject(handle);
    const first = await createCompositeObservation(
      handle,
      project,
      "first-serp-rival.example",
    );
    const second = await createCompositeObservation(
      handle,
      project,
      "second-serp-rival.example",
    );
    const repository = new CompetitorsRepository(handle.db);
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };

    await expectPgCode(
      repository.upsertOrigin(scope, {
        ...serpInput(first),
        snapshotId: second.snapshotId,
      }),
      "23514",
    );
    await expectPgCode(
      repository.upsertOrigin(scope, {
        ...serpInput(first),
        domain: "payload-drift.example",
      }),
      "23514",
    );

    for (const value of [
      {
        targetDomain: `${project.projectId}.search-landscape.example`,
        competitorDomain: "zero-intersections.example",
        intersections: 0,
        averagePosition: 1,
        summedPosition: 1,
        organicEstimatedTrafficVolume: 1,
        marketCode: "US",
        languageCode: "en",
      },
      {
        targetDomain: `${project.projectId}.search-landscape.example`,
        competitorDomain: "negative-position.example",
        intersections: 1,
        averagePosition: -1,
        summedPosition: 1,
        organicEstimatedTrafficVolume: 1,
        marketCode: "US",
        languageCode: "en",
      },
    ]) {
      await expectPgCode(
        handle.pool.query(
          `INSERT INTO app.normalized_observations (
             id, workspace_id, project_id, snapshot_id, provider,
             metric_key, subject_type, subject_ref, observed_at,
             availability, value_json, origin, grade, support, limitation
           ) VALUES (
             $1,$2,$3,$4,'dataforseo',
             'dataforseo.competitor_domain.v1','site',$5,$6,'available',$7,
             'vendor_observation','B','supports','Invalid fixture.'
           )`,
          [
            randomUUID(),
            project.workspaceId,
            project.projectId,
            first.snapshotId,
            value.competitorDomain,
            CAPTURED_AT,
            value,
          ],
        ),
        "23514",
      );
    }
  });

  it("accepts only the exact composite operation/method pair", async () => {
    const project = await createProject(handle);
    const runId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.async_runs (
         id, workspace_id, project_id, kind, status,
         initiated_by, started_at
       ) VALUES ($1,$2,$3,'collection','running',$4,$5)`,
      [
        runId,
        project.workspaceId,
        project.projectId,
        project.actorId,
        CAPTURED_AT,
      ],
    );
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.collection_runs (
           id, workspace_id, project_id, site_id, source_connection_id,
           provider, operation, method_version, parameters_hash
         ) VALUES (
           $1,$2,$3,$4,$5,'dataforseo','search_landscape',
           'dataforseo.ranked_keywords.v1',$6
         )`,
        [
          runId,
          project.workspaceId,
          project.projectId,
          project.siteId,
          project.sourceConnectionId,
          contentHash({ runId }),
        ],
      ),
      "23514",
    );
  });
});
