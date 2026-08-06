import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@sf/contracts";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  ActionsRepository,
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  ExportBundlesRepository,
  FindingsRepository,
  ObservationsRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  contentHash,
  type DataSnapshotRow,
  type ObservationInsert,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import {
  buildContextProjectionV1,
  FINDING_REGISTRY,
  GOVERNANCE_PROJECTION_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import {
  CRAWL_METHOD_VERSION,
  METRIC_CRAWL_PAGE,
  type CrawlPageProjection,
} from "@sf/sources";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import { runMigrations } from "../../../../../packages/db/src/migrate.ts";
import { runExport } from "../run-export.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const NOOP = (): void => undefined;
const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describeDb("export snapshot consistency", () => {
  let reader: DbHandle;
  let writer: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    reader = createDbHandle(DATABASE_URL!);
    writer = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await Promise.all([reader?.end(), writer?.end()]);
  });

  it("cannot combine an old ready artifact row with a newly committed draft revision", async () => {
    const fixture = await seedExport(reader);
    const listed = deferred();
    const writerCommitted = deferred();
    let uploaded: Buffer | null = null;
    const originalList = ExecutionArtifactsRepository.prototype.listByProject;
    const listSpy = vi
      .spyOn(ExecutionArtifactsRepository.prototype, "listByProject")
      .mockImplementation(async function (
        this: ExecutionArtifactsRepository,
        scope,
        options,
      ) {
        const page = await originalList.call(this, scope, options);
        if (
          options.cursor === null &&
          page.rows.some((row) => row.id === fixture.artifactId)
        ) {
          listed.resolve();
          await writerCommitted.promise;
        }
        return page;
      });

    const ctx = {
      db: reader.db,
      boss: {} as PgBoss,
      blobStore: {
        put: async (input: { readonly key: string; readonly body: Buffer }) => {
          uploaded = Buffer.from(input.body);
          return {
            key: input.key,
            sha256: createHash("sha256").update(input.body).digest("hex"),
            bytes: input.body.length,
          };
        },
        delete: async () => undefined,
      },
      logger,
    } as unknown as WorkerContext;

    const running = runExport(ctx, {
      runId: fixture.exportRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    try {
      await Promise.race([
        listed.promise,
        running.then(() => {
          throw new Error("export completed before the artifact-read barrier");
        }),
      ]);
      await writer.db.transaction(async (tx) => {
        const artifacts = new ExecutionArtifactsRepository(tx);
        await artifacts.insertRevision({
          workspaceId: fixture.scope.workspaceId,
          projectId: fixture.scope.projectId,
          artifactId: fixture.artifactId,
          revision: 2,
          outputLocale: "en",
          contentFormat: "markdown",
          contentText: "# Newly committed draft revision\n",
          contentJson: null,
          contentHash: contentHash("# Newly committed draft revision\n"),
          generatedBy: "operator",
          editorId: fixture.actorId,
          analysisInvocationId: null,
          note: null,
          validationErrors: ["fixture.invalid"],
        });
        await artifacts.setGenerated(fixture.artifactId, {
          status: "draft",
          currentRevision: 2,
          validationState: "invalid",
          contentHash: contentHash("# Newly committed draft revision\n"),
        });
      });
    } finally {
      writerCommitted.resolve();
    }

    try {
      await running;
    } finally {
      listSpy.mockRestore();
    }

    expect(
      await new ExecutionArtifactsRepository(writer.db).findById(
        fixture.scope,
        fixture.artifactId,
      ),
    ).toMatchObject({ status: "draft", current_revision: 2 });
    expect(uploaded).not.toBeNull();
    expect(uploaded!.includes("# Ready revision one")).toBe(true);
    expect(uploaded!.includes("# Newly committed draft revision")).toBe(false);
  });

  it("finishes an accepted client bundle after archive while keeping the project stage frozen", async () => {
    const fixture = await seedExport(reader);
    const projects = new ProjectsRepository(reader.db);
    await expect(
      projects.setStage(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        "executing",
      ),
    ).resolves.toBe(true);
    await reader.pool.query(
      `update app.client_projects
          set archived_at = now()
        where workspace_id = $1
          and id = $2`,
      [fixture.scope.workspaceId, fixture.scope.projectId],
    );
    let uploaded = false;
    let deleted = false;
    const ctx = {
      db: reader.db,
      boss: {} as PgBoss,
      blobStore: {
        put: async (input: { readonly key: string; readonly body: Buffer }) => {
          uploaded = true;
          return {
            key: input.key,
            sha256: createHash("sha256").update(input.body).digest("hex"),
            bytes: input.body.length,
          };
        },
        delete: async () => {
          deleted = true;
        },
      },
      logger,
    } as unknown as WorkerContext;

    await runExport(ctx, {
      runId: fixture.exportRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    expect(uploaded).toBe(true);
    expect(deleted).toBe(false);
    await expect(
      new AsyncRunsRepository(reader.db).findById(
        fixture.scope,
        fixture.exportRunId,
      ),
    ).resolves.toMatchObject({
      status: "completed",
      result_type: "export",
      completed_at: expect.any(String),
    });
    await expect(
      new ExportBundlesRepository(reader.db).findByRun(
        fixture.scope,
        fixture.exportRunId,
      ),
    ).resolves.toMatchObject({
      object_key: expect.any(String),
      checksum: expect.any(String),
    });
    await expect(
      projects.findById(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
      ),
    ).resolves.toMatchObject({
      stage: "executing",
      archived_at: expect.any(String),
    });
  });
});

async function seedExport(handle: DbHandle): Promise<{
  readonly scope: ProjectScope;
  readonly actorId: string;
  readonly artifactId: string;
  readonly exportRunId: string;
}> {
  const actorId = randomUUID();
  const [workspace] = await handle.db
    .insert(workspaces)
    .values({ name: `Export snapshot ${randomUUID()}` })
    .returning();
  const project = await new ProjectsRepository(handle.db).insert({
    workspaceId: workspace!.id,
    clientName: "Snapshot client",
    projectName: "Snapshot project",
    defaultDeliveryLocale: "en",
    createdBy: actorId,
  });
  const scope = { workspaceId: workspace!.id, projectId: project.id };
  const host = `export-${randomUUID().slice(0, 8)}.example`;
  const origin = `https://${host}`;
  const site = await new SitesRepository(handle.db).insertPrimary({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    origin,
    host,
    marketCodes: ["US"],
    languageCodes: ["en"],
  });
  await new SourceConnectionsRepository(handle.db).insertDefaultCrawl({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    createdBy: actorId,
  });
  const icpProfile = {
    productName: "Snapshot",
    oneLineDescription: "Export integration fixture.",
  };
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: icpProfile,
      content_hash: contentHash(icpProfile),
      created_by: actorId,
    })
    .returning();
  const snapshot = await seedExportCrawlSnapshot(
    handle,
    scope,
    site.id,
    actorId,
    origin,
  );
  const diagnosticRunId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: diagnosticRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "diagnostic",
    status: "completed",
    attempt_count: 1,
    initiated_by: actorId,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
  const diagnosticManifest = exportDiagnosticManifest(
    scope.projectId,
    site.id,
    icp!,
    snapshot,
    site.language_codes,
  );
  await new DiagnosticRunsRepository(handle.db).insert({
    runId: diagnosticRunId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    icpProfileId: icp!.id,
    icpProfileVersion: icp!.version,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: "en",
    inputManifest: diagnosticManifest,
    inputHash: contentHash(
      diagnosticManifest as unknown as Parameters<typeof contentHash>[0],
    ),
  });
  const findingMeta = FINDING_REGISTRY["TECH-HTTP-001"];
  const finding = await new FindingsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    findingKey: contentHash({ finding: diagnosticRunId }),
    ruleId: "TECH-HTTP-001",
    ruleVersion: 2,
    ruleFamily: findingMeta.ruleFamily,
    intent: findingMeta.intent,
    domain: findingMeta.domain,
    titleKey: findingMeta.titleKey,
    titleArgs: { status: 404, count: 1 },
    summary: "One crawled page returned HTTP 404.",
    summaryLocale: "en",
    subjectRefs: ["http_status:404"],
    severity: "medium",
    confidence: "high",
    reviewState: "confirmed",
    runId: diagnosticRunId,
    seenAt: new Date().toISOString(),
  });
  const [evidenceId] = await new EvidenceRepository(handle.db).insertMany(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId,
    },
    [
      {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: [`${origin}/missing`],
        claim: "One crawled page returned HTTP 404.",
        observedAt: snapshot.captured_at,
        limitation: "Disposable export integration fixture.",
        snapshotId: snapshot.id,
        collectionRunId: snapshot.collection_run_id,
      },
    ],
  );
  await new EvidenceRepository(handle.db).linkObservations(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId,
    },
    [{ findingId: finding.id, evidenceId: evidenceId!, role: "primary" }],
  );
  const action = await new ActionsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    sourceFindingId: finding.id,
    sourceDiagnosticRunId: diagnosticRunId,
    actionKey: contentHash({ action: finding.id }),
    templateId: "fix_http_status.v1",
    templateVersion: 1,
    title: "Fix broken or error HTTP responses",
    description: "Restore or redirect the missing fixture URL.",
    contentLocale: "en",
    priorityBand: "medium",
    roadmapLane: "next",
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: "The missing fixture URL returns 2xx or a correct redirect.",
    evidenceRefs: [],
    createdBy: actorId,
  });
  const generationRunId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: generationRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "artifact_generation",
    status: "completed",
    attempt_count: 1,
    initiated_by: actorId,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
  const artifacts = new ExecutionArtifactsRepository(handle.db);
  const artifact = await artifacts.insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    actionId: action.id,
    artifactType: "technical_ticket",
    generationMode: "template",
    outputLocale: "en",
    latestGenerationRunId: generationRunId,
    createdBy: actorId,
  });
  await artifacts.insertRevision({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    artifactId: artifact.id,
    revision: 1,
    outputLocale: "en",
    contentFormat: "markdown",
    contentText: "# Ready revision one\n",
    contentJson: null,
    contentHash: contentHash("# Ready revision one\n"),
    generatedBy: "operator",
    editorId: actorId,
    analysisInvocationId: null,
    note: null,
    validationErrors: [],
  });
  await artifacts.setGenerated(artifact.id, {
    status: "draft",
    currentRevision: 1,
    validationState: "valid",
    contentHash: contentHash("# Ready revision one\n"),
  });
  await artifacts.setStatus(scope, artifact.id, "ready");
  const exportRun = await new AsyncRunsRepository(handle.db).insertQueued({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind: "export",
    activeKey: `export:client_bundle:${randomUUID()}`,
    initiatedBy: actorId,
    contractVersion: CONTRACT_VERSION,
    requestPayload: { kind: "client_bundle", outputLocale: "en" },
  });
  await new ExportBundlesRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    asyncRunId: exportRun.id,
    kind: "client_bundle",
    outputLocale: "en",
    createdBy: actorId,
  });
  return {
    scope,
    actorId,
    artifactId: artifact.id,
    exportRunId: exportRun.id,
  };
}

function exportDiagnosticManifest(
  projectId: string,
  siteId: string,
  icp: {
    readonly id: string;
    readonly version: number;
    readonly content_hash: string;
    readonly profile: unknown;
  },
  snapshot: DataSnapshotRow,
  siteLanguageCodes: readonly string[],
): Record<string, unknown> {
  return {
    projectId,
    siteId,
    icp: {
      id: icp.id,
      version: icp.version,
      contentHash: icp.content_hash,
    },
    snapshots: [
      {
        snapshotId: snapshot.id,
        provider: snapshot.provider,
        datasetKey: snapshot.dataset_key,
        schemaVersion: snapshot.schema_version,
        methodVersion: snapshot.method_version,
        checksum: snapshot.checksum,
        capturedAt: snapshot.captured_at,
        sourceWindow: snapshot.source_window,
        availability: snapshot.availability,
      },
    ],
    governance: {
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [],
      competitors: [],
    },
    contextProjection: buildContextProjectionV1({
      profile: icp.profile,
      profileContentHash: icp.content_hash,
      siteLanguageCodes,
    }),
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en",
  };
}

async function seedExportCrawlSnapshot(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  actorId: string,
  origin: string,
): Promise<DataSnapshotRow> {
  const source = await new SourceConnectionsRepository(
    handle.db,
  ).findConnectedByProvider(scope, "crawl");
  if (!source || source.site_id !== siteId) {
    throw new Error("export fixture requires the Site's Crawl connection");
  }
  const capturedAt = new Date().toISOString();
  const collectionRunId = randomUUID();
  const pageUrl = `${origin}/missing`;
  const page: CrawlPageProjection = {
    fetchUrl: pageUrl,
    status: 404,
    finalStatus: 404,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: false,
    robotsDirectives: ["noindex"],
    title: null,
    metaDescription: null,
    h1: [],
    headings: [],
    wordCount: 0,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 1,
    contentType: "text/html",
  };
  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "collection",
    status: "completed",
    contract_version: CONTRACT_VERSION,
    initiated_by: actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const collections = new CollectionRunsRepository(handle.db);
  await collections.insertPlaceholder({
    runId: collectionRunId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: source.id,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ fixture: collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    collectionRunId,
    sourceConnectionId: source.id,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Deterministic public Crawl export fixture.",
    rawObjectKey: null,
    rowCount: 1,
    checksum: contentHash(
      { page } as unknown as Parameters<typeof contentHash>[0],
    ),
  });
  const sitePage = await new SitePagesRepository(handle.db).upsertNormalizedUrl(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: pageUrl,
      templateKey: null,
    },
  );
  const observations: ObservationInsert[] = [
    {
      metricKey: METRIC_CRAWL_PAGE,
      subjectType: "url",
      subjectRef: pageUrl,
      sitePageId: sitePage.id,
      observedAt: capturedAt,
      availability: "available",
      valueNumeric: null,
      valueText: null,
      valueJson: page,
      unit: null,
      origin: "direct_public",
      grade: "B",
      support: "supports",
      limitation: "Deterministic public Crawl export fixture.",
    },
  ];
  await new ObservationsRepository(handle.db).insertMany(
    scope,
    snapshot.id,
    "crawl",
    observations,
  );
  await collections.finalize(collectionRunId, {
    rowCount: snapshot.row_count,
    sourceWindow: snapshot.source_window,
    providerUsage: { urlsFetched: 1, pagesCollected: 1 },
    stopReason: null,
  });
  await new SourceConnectionsRepository(handle.db).setLastSnapshot(
    source.id,
    snapshot.id,
    snapshot.availability,
    snapshot.limitation,
  );
  return snapshot;
}
