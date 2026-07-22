import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import {
  CompetitorsRepository,
  type CsvKeywordGapCompetitorOriginInput,
  type ProductProfileCompetitorOriginInput,
} from "../repositories/competitors.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const BASE_TIME = "2026-07-22T08:00:00.000Z";

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly actorId: string;
}

interface ProductProfileFixture {
  readonly profileId: string;
  readonly version: number;
  readonly candidateId: string;
  readonly fieldProvenancePath: string;
  readonly evidenceRefs: ProductProfileCompetitorOriginInput["evidenceRefs"];
  readonly domain: string;
  readonly name: string;
  readonly reviewStatus: "candidate" | "approved" | "excluded";
  readonly relationship: "direct" | "indirect" | null;
  readonly analysisScope: readonly (
    | "positioning"
    | "product_capability"
    | "keyword_gap"
    | "content"
    | "serp_visibility"
  )[];
}

interface CsvFixture {
  readonly snapshotId: string;
  readonly observationId: string;
  readonly importPreviewId: string;
  readonly sourceConnectionId: string;
  readonly observedAt: string;
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

async function createProject(
  handle: DbHandle,
  workspaceId?: string,
): Promise<ProjectFixture> {
  const ownWorkspace = workspaceId ?? randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const actorId = randomUUID();
  if (!workspaceId) {
    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
      [ownWorkspace, `Competitor library ${ownWorkspace}`],
    );
  }
  await handle.pool.query(
    `INSERT INTO app.client_projects (
       id, workspace_id, client_name, project_name,
       default_delivery_locale, created_by
     ) VALUES ($1,$2,$3,$4,'zh-CN',$5)`,
    [
      projectId,
      ownWorkspace,
      `Client ${projectId}`,
      `Project ${projectId}`,
      actorId,
    ],
  );
  const host = `${projectId}.competitor.example`;
  await handle.pool.query(
    `INSERT INTO app.sites (
       id, workspace_id, project_id, origin, host,
       market_codes, language_codes, is_primary
     ) VALUES ($1,$2,$3,$4,$5,ARRAY['US'],ARRAY['en-US'],true)`,
    [siteId, ownWorkspace, projectId, `https://${host}`, host],
  );
  return { workspaceId: ownWorkspace, projectId, siteId, actorId };
}

async function createProductProfile(
  handle: DbHandle,
  project: ProjectFixture,
  options: {
    readonly domain: string;
    readonly name?: string;
    readonly reviewStatus?: "candidate" | "approved" | "excluded";
    readonly relationship?: "direct" | "indirect" | null;
    readonly analysisScope?: ProductProfileFixture["analysisScope"];
    readonly confirm?: boolean;
    readonly usePoolProvenance?: boolean;
    readonly provenanceDerivation?: string;
    readonly version?: number;
  },
): Promise<ProductProfileFixture> {
  const profileId = randomUUID();
  const candidateId = randomUUID();
  const version = options.version ?? 1;
  const name = options.name ?? "Profile competitor";
  const reviewStatus = options.reviewStatus ?? "approved";
  const relationship = options.relationship ?? "direct";
  const analysisScope = options.analysisScope ?? ["keyword_gap"];
  const fieldProvenancePath = options.usePoolProvenance
    ? "/competitorCandidates"
    : "/competitorCandidates/0";
  const provenanceDerivation = options.provenanceDerivation ?? "declared";
  const evidenceRefs =
    provenanceDerivation === "contradicted"
      ? [
          { evidenceRefId: randomUUID(), kind: "userEdit" as const },
          { evidenceRefId: randomUUID(), kind: "userEdit" as const },
        ]
      : [{ evidenceRefId: randomUUID(), kind: "userEdit" as const }];
  const profile = {
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: project.siteId,
    sourcePageUrl: `https://${project.projectId}.competitor.example/`,
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    competitorCandidates: [
      {
        candidateId,
        name,
        domain: options.domain,
        reviewStatus,
        relationship,
        analysisScope,
        similarity: null,
        reason: "Confirmed customer review.",
        confidence: "high",
      },
    ],
    fieldProvenance: [
      {
        path: fieldProvenancePath,
        derivation: provenanceDerivation,
        confidence: "high",
        evidenceRefs,
        limitation: "Customer-reviewed Product Profile source.",
        observedAt: provenanceDerivation === "contradicted" ? BASE_TIME : null,
      },
    ],
  };
  await handle.pool.query(
    `INSERT INTO app.icp_profiles (
       id, workspace_id, project_id, version, status,
       profile, content_hash, created_by
     ) VALUES ($1,$2,$3,$4,'complete',$5,$6,$7)`,
    [
      profileId,
      project.workspaceId,
      project.projectId,
      version,
      profile,
      contentHash(profile),
      project.actorId,
    ],
  );
  if (options.confirm !== false) {
    await handle.pool.query(
      `UPDATE app.client_projects
       SET current_icp_profile_id = $1, confirmed_icp_profile_id = $1
       WHERE workspace_id = $2 AND id = $3`,
      [profileId, project.workspaceId, project.projectId],
    );
  }
  return {
    profileId,
    version,
    candidateId,
    fieldProvenancePath,
    evidenceRefs,
    domain: options.domain,
    name,
    reviewStatus,
    relationship,
    analysisScope,
  };
}

function profileInput(
  profile: ProductProfileFixture,
): ProductProfileCompetitorOriginInput {
  return {
    originKind: "product_profile",
    domain: profile.domain,
    name: profile.name,
    productProfileId: profile.profileId,
    profileVersion: profile.version,
    candidateId: profile.candidateId,
    fieldProvenancePath: profile.fieldProvenancePath,
    evidenceRefs: profile.evidenceRefs,
    sourceReviewStatus: profile.reviewStatus,
    sourceRelationship: profile.relationship,
    sourceAnalysisScope: profile.analysisScope,
  };
}

async function createCsvObservation(
  handle: DbHandle,
  project: ProjectFixture,
  options: {
    readonly domain: string;
    readonly observedAt: string;
  },
): Promise<CsvFixture> {
  const importPreviewId = randomUUID();
  let sourceConnectionId: string;
  const runId = randomUUID();
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.import_previews (
       id, workspace_id, project_id, site_id, created_by,
       token_hash, template_id, raw_object_key, file_checksum,
       row_count, detected_columns, suggested_mapping, preview_rows,
       validation_errors, validation_warnings, status, expires_at, consumed_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'keyword_gap_v1',$7,$8,1,
       '[]'::jsonb,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
       'consumed',$9,$10
     )`,
    [
      importPreviewId,
      project.workspaceId,
      project.projectId,
      project.siteId,
      project.actorId,
      randomBytes(32),
      `raw/${importPreviewId}.csv`,
      contentHash({ importPreviewId }),
      "2026-07-23T08:00:00.000Z",
      options.observedAt,
    ],
  );
  const existingConnection = await handle.pool.query<{ id: string }>(
    `SELECT id
     FROM app.source_connections
     WHERE workspace_id = $1 AND project_id = $2
       AND provider = 'csv' AND disconnected_at IS NULL`,
    [project.workspaceId, project.projectId],
  );
  if (existingConnection.rows[0]) {
    sourceConnectionId = existingConnection.rows[0].id;
  } else {
    sourceConnectionId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.source_connections (
         id, workspace_id, project_id, site_id, provider,
         connection_type, state, external_ref, limitation,
         connected_at, created_by
       ) VALUES (
         $1,$2,$3,$4,'csv','file_import','available',$5,
         'Customer-provided keyword-gap CSV.',$6,$7
       )`,
      [
        sourceConnectionId,
        project.workspaceId,
        project.projectId,
        project.siteId,
        importPreviewId,
        options.observedAt,
        project.actorId,
      ],
    );
  }
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
      options.observedAt,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.collection_runs (
       id, workspace_id, project_id, site_id, source_connection_id,
       import_preview_id, provider, operation, method_version, parameters_hash
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'csv','keyword_gap_import',
       'csv.keyword_gap.v1',$7
     )`,
    [
      runId,
      project.workspaceId,
      project.projectId,
      project.siteId,
      sourceConnectionId,
      importPreviewId,
      contentHash({ runId }),
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.data_snapshots (
       id, workspace_id, project_id, site_id, collection_run_id,
       source_connection_id, provider, dataset_key, schema_version,
       method_version, captured_at, source_window, availability,
       limitation, row_count, checksum, summary
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'csv','csv.keyword_gap.v1','0.3.0',
       'csv.keyword_gap.v1',$7,'{"start":null,"end":null}'::jsonb,
       'available','Customer-provided keyword-gap CSV.',1,$8,'{}'::jsonb
     )`,
    [
      snapshotId,
      project.workspaceId,
      project.projectId,
      project.siteId,
      runId,
      sourceConnectionId,
      options.observedAt,
      contentHash({ snapshotId }),
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.normalized_observations (
       id, workspace_id, project_id, snapshot_id, provider,
       metric_key, subject_type, subject_ref, observed_at,
       availability, value_json, origin, grade, support, limitation
     ) VALUES (
       $1,$2,$3,$4,'csv','csv.keyword_gap.v1','keyword_cluster',
       'competitor-library',$5,'available',$6,'user_provided','C',
       'context','Customer-provided keyword-gap CSV.'
     )`,
    [
      observationId,
      project.workspaceId,
      project.projectId,
      snapshotId,
      options.observedAt,
      {
        keyword: "customer onboarding",
        clusterKey: "customer-onboarding",
        searchVolume: 100,
        currentUrl: null,
        currentRank: null,
        competitorDomain: options.domain,
        competitorRank: 4,
        marketCode: "US",
        languageCode: "en-US",
      },
    ],
  );
  return {
    snapshotId,
    observationId,
    importPreviewId,
    sourceConnectionId,
    observedAt: options.observedAt,
    domain: options.domain,
  };
}

function csvInput(csv: CsvFixture): CsvKeywordGapCompetitorOriginInput {
  return {
    originKind: "csv_keyword_gap",
    domain: csv.domain,
    name: null,
    snapshotId: csv.snapshotId,
    observationId: csv.observationId,
    importPreviewId: csv.importPreviewId,
    sourcePointer: "/valueJson/competitorDomain",
  };
}

describeDb("competitor library database foundation", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    requireSafeTestDatabaseUrl(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
    await handle.pool.query("SELECT 1 FROM app.competitor_entities LIMIT 0");
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("projects an exact confirmed Product Profile origin once and never overwrites later governance", async () => {
    const project = await createProject(handle);
    const profile = await createProductProfile(handle, project, {
      domain: "profile-rival.example",
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["keyword_gap", "positioning"],
      usePoolProvenance: true,
    });
    const repository = new CompetitorsRepository(handle.db);
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };

    const first = await repository.upsertOrigin(scope, profileInput(profile));
    const initial = await repository.findById(scope, first.competitorId);
    expect(initial).toMatchObject({
      domain: profile.domain,
      name: profile.name,
      review_status: "approved",
      relationship: "direct",
      analysis_scope: ["keyword_gap", "positioning"],
      revision: 0,
      last_observed_at: null,
      origin_count: 1,
    });
    const origins = await repository.listOrigins(scope, first.competitorId, 10);
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({
      id: first.occurrenceId,
      origin_kind: "product_profile",
      product_profile_id: profile.profileId,
      profile_version: profile.version,
      candidate_id: profile.candidateId,
      field_provenance_path: profile.fieldProvenancePath,
      evidence_refs: profile.evidenceRefs,
      observed_at: null,
    });

    const governed = await repository.review(scope, first.competitorId, {
      expectedRevision: 0,
      name: "Reviewed competitor name",
      reviewStatus: "approved",
      relationship: "benchmark",
      analysisScope: ["content"],
    });
    expect(governed).toMatchObject({
      name: "Reviewed competitor name",
      relationship: "benchmark",
      analysis_scope: ["content"],
      revision: 1,
    });
    await expect(
      repository.review(scope, first.competitorId, {
        expectedRevision: 0,
        name: null,
        reviewStatus: "excluded",
        relationship: null,
        analysisScope: [],
      }),
    ).resolves.toBeNull();

    const replay = await repository.upsertOrigin(scope, profileInput(profile));
    expect(replay).toEqual(first);
    expect(await repository.findById(scope, first.competitorId)).toMatchObject({
      name: "Reviewed competitor name",
      relationship: "benchmark",
      analysis_scope: ["content"],
      revision: 1,
      origin_count: 1,
    });
    expect(await repository.listOrigins(scope, first.competitorId, 10)).toEqual(
      origins,
    );

    await expectPgCode(
      handle.pool.query(
        "UPDATE app.competitor_origin_occurrences SET source_name = 'drift' WHERE id = $1",
        [first.occurrenceId],
      ),
      "23514",
    );
    await expectPgCode(
      handle.pool.query(
        "DELETE FROM app.competitor_origin_occurrences WHERE id = $1",
        [first.occurrenceId],
      ),
      "23514",
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.competitor_entities SET domain = 'drift.example' WHERE id = $1",
        [first.competitorId],
      ),
      "23514",
    );
  });

  it("rejects unconfirmed, foreign, or payload-drifted Product Profile lineage", async () => {
    const project = await createProject(handle);
    const foreignProject = await createProject(handle, project.workspaceId);
    const confirmed = await createProductProfile(handle, project, {
      domain: "confirmed-rival.example",
    });
    const unconfirmed = await createProductProfile(handle, project, {
      domain: "unconfirmed-rival.example",
      confirm: false,
      version: 2,
    });
    const foreign = await createProductProfile(handle, foreignProject, {
      domain: "foreign-rival.example",
    });
    const repository = new CompetitorsRepository(handle.db);
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };

    await expectPgCode(
      repository.upsertOrigin(scope, profileInput(unconfirmed)),
      "23514",
    );
    await expectPgCode(
      repository.upsertOrigin(scope, profileInput(foreign)),
      "23514",
    );
    await expectPgCode(
      repository.upsertOrigin(scope, {
        ...profileInput(confirmed),
        domain: "payload-drift.example",
      }),
      "23514",
    );
    await expectPgCode(
      repository.upsertOrigin(scope, {
        ...profileInput(confirmed),
        evidenceRefs: [
          { evidenceRefId: randomUUID(), kind: "userEdit" },
        ],
      }),
      "23514",
    );
  });

  it("rejects a Product Profile origin whose matched provenance derivation is not projectable", async () => {
    const project = await createProject(handle);
    const contradicted = await createProductProfile(handle, project, {
      domain: "contradicted-rival.example",
      provenanceDerivation: "contradicted",
    });
    const repository = new CompetitorsRepository(handle.db);

    await expectPgCode(
      repository.upsertOrigin(
        {
          workspaceId: project.workspaceId,
          projectId: project.projectId,
        },
        profileInput(contradicted),
      ),
      "23514",
    );
  });

  it("converges CSV origins by domain and derives lastObservedAt only from Observation-backed rows", async () => {
    const project = await createProject(handle);
    const older = await createCsvObservation(handle, project, {
      domain: "csv-rival.example",
      observedAt: BASE_TIME,
    });
    const newer = await createCsvObservation(handle, project, {
      domain: "csv-rival.example",
      observedAt: "2026-07-22T09:00:00.000Z",
    });
    const repository = new CompetitorsRepository(handle.db);
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };

    const first = await repository.upsertOrigin(scope, csvInput(older));
    const second = await repository.upsertOrigin(scope, csvInput(newer));
    expect(second.competitorId).toBe(first.competitorId);
    expect(second.occurrenceId).not.toBe(first.occurrenceId);
    expect(await repository.findById(scope, first.competitorId)).toMatchObject({
      review_status: "candidate",
      relationship: null,
      analysis_scope: [],
      last_observed_at: "2026-07-22T09:00:00.000Z",
      origin_count: 2,
    });

    const replay = await repository.upsertOrigin(scope, csvInput(older));
    expect(replay).toEqual(first);
    const origins = await repository.listOrigins(scope, first.competitorId, 10);
    expect(origins.map((origin) => origin.observed_at)).toEqual([
      "2026-07-22T09:00:00.000Z",
      BASE_TIME,
    ]);
    expect(origins.every((origin) => origin.origin_kind === "csv_keyword_gap"))
      .toBe(true);
  });

  it("rejects CSV scope, pointer, import, domain, and source-lineage mismatches", async () => {
    const project = await createProject(handle);
    const foreignProject = await createProject(handle, project.workspaceId);
    const csv = await createCsvObservation(handle, project, {
      domain: "guarded-rival.example",
      observedAt: BASE_TIME,
    });
    const foreignCsv = await createCsvObservation(handle, foreignProject, {
      domain: "foreign-csv-rival.example",
      observedAt: BASE_TIME,
    });
    const repository = new CompetitorsRepository(handle.db);
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };

    await expectPgCode(
      repository.upsertOrigin(scope, {
        ...csvInput(csv),
        domain: "wrong-domain.example",
      }),
      "23514",
    );
    await expectPgCode(
      repository.upsertOrigin(scope, {
        ...csvInput(csv),
        importPreviewId: foreignCsv.importPreviewId,
      }),
      "23514",
    );
    await expectPgCode(
      repository.upsertOrigin(scope, csvInput(foreignCsv)),
      "23514",
    );
    await expectPgCode(
      handle.pool.query(
        `SELECT * FROM app.upsert_competitor_origin(
          $1,$2,$3,NULL,'csv_keyword_gap',
          NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
          $4,$5,$6,'/valueJson/competitorRank',NULL
        )`,
        [
          project.workspaceId,
          project.projectId,
          csv.domain,
          csv.snapshotId,
          csv.observationId,
          csv.importPreviewId,
        ],
      ),
      "23514",
    );
    await expectPgCode(
      handle.pool.query(
        `SELECT * FROM app.upsert_competitor_origin(
          $1,$2,$3,NULL,'dataforseo',
          NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
          NULL,NULL,NULL,NULL,NULL
        )`,
        [project.workspaceId, project.projectId, csv.domain],
      ),
      "23514",
    );

    const sourceMismatch = await createCsvObservation(handle, project, {
      domain: "source-mismatch-rival.example",
      observedAt: "2026-07-22T10:00:00.000Z",
    });
    const client = await handle.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "ALTER TABLE app.data_snapshots DISABLE TRIGGER data_snapshots_append_only",
      );
      await client.query(
        "UPDATE app.data_snapshots SET source_connection_id = NULL WHERE id = $1",
        [sourceMismatch.snapshotId],
      );
      await client.query(
        "ALTER TABLE app.data_snapshots ENABLE TRIGGER data_snapshots_append_only",
      );
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    await expectPgCode(
      repository.upsertOrigin(scope, csvInput(sourceMismatch)),
      "23514",
    );

    await handle.pool.query(
      "UPDATE app.source_connections SET provider = 'gsc' WHERE id = $1",
      [csv.sourceConnectionId],
    );
    await expectPgCode(
      repository.upsertOrigin(scope, csvInput(csv)),
      "23514",
    );
  });

  it("keeps manual occurrences lineage-free, replay-safe, and governable through non-SERP relationships", async () => {
    const project = await createProject(handle);
    const repository = new CompetitorsRepository(handle.db);
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };
    const manualEntryId = randomUUID();
    const input = {
      originKind: "manual" as const,
      domain: "manual-rival.example",
      name: "Manual Rival",
      manualEntryId,
    };

    const first = await repository.upsertOrigin(scope, input);
    expect(first.occurrenceId).toBe(manualEntryId);
    expect(await repository.upsertOrigin(scope, input)).toEqual(first);
    const detail = await repository.findById(scope, first.competitorId);
    expect(detail).toMatchObject({
      last_observed_at: null,
      origin_count: 1,
      review_status: "candidate",
    });
    expect(await repository.listOrigins(scope, first.competitorId, 10)).toEqual([
      expect.objectContaining({
        id: manualEntryId,
        manual_entry_id: manualEntryId,
        origin_kind: "manual",
        data_snapshot_id: null,
        normalized_observation_id: null,
        observed_at: null,
      }),
    ]);

    await expectPgCode(
      repository.upsertOrigin(scope, {
        ...input,
        name: "Drifted manual source",
      }),
      "23514",
    );
    const reviewed = await repository.review(scope, first.competitorId, {
      expectedRevision: 0,
      name: "Manual Rival",
      reviewStatus: "approved",
      relationship: "status_quo",
      analysisScope: ["product_capability"],
    });
    expect(reviewed).toMatchObject({
      relationship: "status_quo",
      revision: 1,
    });
  });
});
