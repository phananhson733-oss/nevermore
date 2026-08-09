import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import {
  CompetitorsRepository,
  type AiCitationCompetitorOriginInput,
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

interface V3SnapshotFixture {
  readonly runId: string;
  readonly snapshotId: string;
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

async function createV3Snapshot(
  handle: DbHandle,
  project: ProjectFixture,
): Promise<V3SnapshotFixture> {
  const runId = await createCollectionRun(
    handle,
    project,
    "search_landscape",
    "dataforseo.search_landscape.v3",
  );
  const snapshotId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.data_snapshots (
       id, workspace_id, project_id, site_id, collection_run_id,
       source_connection_id, provider, dataset_key, schema_version,
       method_version, captured_at, source_window, availability,
       limitation, row_count, checksum, summary
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'dataforseo',
       'dataforseo.search_landscape.v3',
       'dataforseo.search_landscape.v3',
       'dataforseo.search_landscape.v3',
       $7,'{"start":null,"end":null}'::jsonb,'available',
       'Provider data is bounded to one immutable collection scope.',2,$8,$9
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
  return { runId, snapshotId };
}

function aiAggregate(project: ProjectFixture, domain: string) {
  const queryOutcomes = Array.from({ length: 20 }, (_, index) => ({
    queryEntityId: randomUUID(),
    queryRevision: index + 1,
    queryHash: contentHash({ domain, query: index }),
    availability: "available",
    cited: index < 8,
  }));
  return {
    targetDomain: `${project.projectId}.search-landscape.example`,
    competitorDomain: domain,
    attemptedQueries: 20,
    observedQueries: 20,
    citedQueries: 8,
    unavailableQueries: 0,
    cohortCoverage: "complete",
    querySetHash: contentHash(queryOutcomes.map((outcome) => outcome.queryHash)),
    platform: "chat_gpt",
    model: "gpt-5",
    marketCode: "US",
    languageTag: "en-US",
    queryOutcomes,
  } as const;
}

async function insertV3Observation(
  handle: DbHandle,
  project: ProjectFixture,
  snapshotId: string,
  metricKey: string,
  domain: string,
  value: unknown,
  limitation: string | null,
): Promise<string> {
  const observationId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.normalized_observations (
       id, workspace_id, project_id, snapshot_id, provider,
       metric_key, subject_type, subject_ref, observed_at,
       availability, value_json, origin, grade, support, limitation
     ) VALUES (
       $1,$2,$3,$4,'dataforseo',$5,'site',$6,$7,'available',$8,
       'vendor_observation','B','supports',$9
     )`,
    [
      observationId,
      project.workspaceId,
      project.projectId,
      snapshotId,
      metricKey,
      domain,
      CAPTURED_AT,
      value,
      limitation,
    ],
  );
  return observationId;
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

function aiInput(
  domain: string,
  snapshotId: string,
  observationId: string,
): AiCitationCompetitorOriginInput {
  return {
    originKind: "ai_citation",
    domain,
    name: null,
    snapshotId,
    observationId,
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

  it("batches duplicate/retry-safe origins and rolls back one corrupted lineage atomically", async () => {
    const project = await createProject(handle);
    const observed = await createCompositeObservation(
      handle,
      project,
      "batch-serp-rival.example",
    );
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };
    let executeCount = 0;
    const executor = {
      execute(query: unknown) {
        executeCount += 1;
        return handle.db.execute(query as never);
      },
    };
    const repository = new CompetitorsRepository(executor as never) as unknown as {
      upsertOrigins(
        selectedScope: typeof scope,
        selectedInputs: readonly SerpOverlapCompetitorOriginInput[],
      ): Promise<readonly { occurrenceId: string; competitorId: string }[]>;
    };

    await expect(repository.upsertOrigins(scope, [])).resolves.toEqual([]);
    expect(executeCount).toBe(0);

    const canonical = serpInput(observed);
    await expect(
      repository.upsertOrigins(scope, [
        canonical,
        { ...canonical, domain: "lineage-drift.example" },
      ]),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
    expect(executeCount).toBe(1);
    const rolledBack = await handle.pool.query<{
      entities: string;
      origins: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.competitor_entities WHERE project_id = $1) AS entities,
         (SELECT count(*) FROM app.competitor_origin_occurrences WHERE project_id = $1) AS origins`,
      [project.projectId],
    );
    expect(rolledBack.rows[0]).toEqual({ entities: "0", origins: "0" });

    await expect(
      handle.pool.query(
        `SELECT *
           FROM app.upsert_competitor_origins_batch(
             $1::uuid,
             $2::uuid,
             $3::jsonb
           )`,
        [
          scope.workspaceId,
          scope.projectId,
          JSON.stringify([
            {
              domain: canonical.domain,
              name: null,
              originKind: "serp_overlap",
              productProfileId: null,
              profileVersion: null,
              candidateId: null,
              fieldProvenancePath: null,
              evidenceRefs: null,
              sourceReviewStatus: null,
              sourceRelationship: null,
              sourceAnalysisScope: null,
              snapshotId: canonical.snapshotId,
              observationId: canonical.observationId,
              importPreviewId: null,
              sourcePointer: canonical.sourcePointer,
              manualEntryId: randomUUID(),
            },
          ]),
        ],
      ),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
    await expect(
      handle.pool.query(
        `SELECT *
           FROM app.upsert_competitor_origins_batch(
             $1::uuid,
             $2::uuid,
             $3::jsonb
           )`,
        [
          scope.workspaceId,
          scope.projectId,
          JSON.stringify([
            {
              domain: "manual-batch-rival.example",
              name: null,
              originKind: "manual",
              productProfileId: null,
              profileVersion: null,
              candidateId: null,
              fieldProvenancePath: null,
              evidenceRefs: null,
              sourceReviewStatus: null,
              sourceRelationship: null,
              sourceAnalysisScope: "not-an-array",
              snapshotId: null,
              observationId: null,
              importPreviewId: null,
              sourcePointer: null,
              manualEntryId: randomUUID(),
            },
          ]),
        ],
      ),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
    const irrelevantLineage = await handle.pool.query<{
      entities: string;
      origins: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.competitor_entities WHERE project_id = $1) AS entities,
         (SELECT count(*) FROM app.competitor_origin_occurrences WHERE project_id = $1) AS origins`,
      [project.projectId],
    );
    expect(irrelevantLineage.rows[0]).toEqual({ entities: "0", origins: "0" });

    executeCount = 0;
    const first = await repository.upsertOrigins(scope, [canonical, canonical]);
    expect(executeCount).toBe(1);
    expect(first).toHaveLength(2);
    expect(first[0]).toEqual(first[1]);
    executeCount = 0;
    await expect(
      repository.upsertOrigins(scope, [canonical, canonical]),
    ).resolves.toEqual(first);
    expect(executeCount).toBe(1);

    await expect(
      repository.upsertOrigins(
        { ...scope, projectId: randomUUID() },
        [canonical],
      ),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
    const counts = await handle.pool.query<{
      entities: string;
      origins: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.competitor_entities WHERE project_id = $1) AS entities,
         (SELECT count(*) FROM app.competitor_origin_occurrences WHERE project_id = $1) AS origins`,
      [project.projectId],
    );
    expect(counts.rows[0]).toEqual({ entities: "1", origins: "1" });
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

  it("accepts rounded organic v2 facts and observed fixed-20 AI origins", async () => {
    const project = await createProject(handle);
    const snapshot = await createV3Snapshot(handle, project);
    const domain = "v3-rival.example";
    await insertV3Observation(
      handle,
      project,
      snapshot.snapshotId,
      "dataforseo.competitor_domain.v2",
      domain,
      {
        targetDomain: `${project.projectId}.search-landscape.example`,
        competitorDomain: domain,
        intersections: 2,
        targetOrganicKeywordCount: 3,
        serpOverlap: 0.666666666667,
        averagePosition: 8.5,
        summedPosition: 17,
        organicEstimatedTrafficVolume: 901.25,
        marketCode: "US",
        languageCode: "en",
      },
      "Provider competitor-domain data is updated weekly.",
    );
    const aiObservationId = await insertV3Observation(
      handle,
      project,
      snapshot.snapshotId,
      "dataforseo.competitor_ai_citation.v1",
      domain,
      aiAggregate(project, domain),
      "20 of 20 pinned ChatGPT queries returned observable answers.",
    );
    const repository = new CompetitorsRepository(handle.db);
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };

    const first = await repository.upsertOrigin(
      scope,
      aiInput(domain, snapshot.snapshotId, aiObservationId),
    );
    await expect(
      repository.upsertOrigin(
        scope,
        aiInput(domain, snapshot.snapshotId, aiObservationId),
      ),
    ).resolves.toEqual(first);
    await expect(repository.listOrigins(scope, first.competitorId, 10)).resolves
      .toEqual([
        expect.objectContaining({
          id: first.occurrenceId,
          origin_kind: "ai_citation",
          data_snapshot_id: snapshot.snapshotId,
          normalized_observation_id: aiObservationId,
          source_pointer: "/valueJson/competitorDomain",
          observed_at: CAPTURED_AT,
        }),
      ]);
  });

  it("rejects adjacent organic rounding, aggregate arithmetic drift, and mixed AI lineage", async () => {
    const project = await createProject(handle);
    const first = await createV3Snapshot(handle, project);
    const second = await createV3Snapshot(handle, project);
    const domain = "invalid-v3-rival.example";

    await expectPgCode(
      insertV3Observation(
        handle,
        project,
        first.snapshotId,
        "dataforseo.competitor_domain.v2",
        domain,
        {
          targetDomain: `${project.projectId}.search-landscape.example`,
          competitorDomain: domain,
          intersections: 2,
          targetOrganicKeywordCount: 3,
          serpOverlap: 0.666666666666,
          averagePosition: 1,
          summedPosition: 2,
          organicEstimatedTrafficVolume: 3,
          marketCode: "US",
          languageCode: "en",
        },
        "Invalid adjacent rounded value.",
      ),
      "23514",
    );

    const malformed = aiAggregate(project, domain);
    await expectPgCode(
      insertV3Observation(
        handle,
        project,
        first.snapshotId,
        "dataforseo.competitor_ai_citation.v1",
        domain,
        { ...malformed, citedQueries: 9 },
        "Invalid aggregate arithmetic fixture.",
      ),
      "23514",
    );

    const observationId = await insertV3Observation(
      handle,
      project,
      first.snapshotId,
      "dataforseo.competitor_ai_citation.v1",
      domain,
      malformed,
      "20 of 20 pinned ChatGPT queries returned observable answers.",
    );
    const repository = new CompetitorsRepository(handle.db);
    await expectPgCode(
      repository.upsertOrigin(
        {
          workspaceId: project.workspaceId,
          projectId: project.projectId,
        },
        aiInput(domain, second.snapshotId, observationId),
      ),
      "23514",
    );
  });
});
