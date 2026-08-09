import { randomUUID } from "node:crypto";
import { parseTopicModelGenerationInputManifest } from "@sf/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type Db, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import {
  analysisRefreshRuns,
  analysisRefreshSteps,
  asyncRuns,
  clientProjects,
  diagnosticRuns,
  icpProfiles,
  sites,
  workspaces,
} from "../schema.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";
import {
  analysisRefreshPlanHash,
  AnalysisRefreshRunsRepository,
  legacyAnalysisRefreshPlanManifest,
} from "./analysis-refresh-runs.ts";
import {
  AuditRunsRepository,
  GROWTH_AUDIT_PROJECTION_VERSION,
  LEGACY_GROWTH_AUDIT_PROJECTION_VERSION,
} from "./audit-runs.ts";
import { CapabilityRunsRepository } from "./capability-runs.ts";
import { CollectionRunsRepository } from "./collection-runs.ts";
import { DataSnapshotsRepository } from "./data-snapshots.ts";
import { GrowthMapReadRepository } from "./growth-map.ts";
import { SourceConnectionsRepository } from "./source-connections.ts";
import { TopicModelGenerationRunsRepository } from "./topic-model-generation-runs.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
if (DATABASE_URL) {
  requireSafeTestDatabaseUrl(DATABASE_URL, "DATABASE_URL");
}
const describeDb = DATABASE_URL ? describe : describe.skip;

interface ProjectFixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly icpProfileId: string;
}

type ParentStatus =
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
type CollectionStepKey =
  | "crawl"
  | "gsc"
  | "ga4"
  | "dataforseo"
  | "dataforseo_backlinks";
type PlannedStepState =
  | "pending"
  | "completed"
  | "fabricated_completed"
  | "skipped"
  | "failed";
type TopicStepState =
  | "pending"
  | "fabricated_completed"
  | "skipped"
  | "failed";

const COLLECTION_STEP_IDENTITY = {
  crawl: {
    provider: "crawl",
    operation: "site_graph",
    methodVersion: "crawl.site_graph.v2",
    datasetKey: "crawl.site_graph.v1",
  },
  gsc: {
    provider: "gsc",
    operation: "search_analytics",
    methodVersion: "gsc.page_query_daily.v1",
    datasetKey: "gsc.page_query_daily.v1",
  },
  ga4: {
    provider: "ga4",
    operation: "organic_landing",
    methodVersion: "ga4.organic_landing_daily.v1",
    datasetKey: "ga4.organic_landing_daily.v1",
  },
  dataforseo: {
    provider: "dataforseo",
    operation: "search_landscape",
    methodVersion: "dataforseo.search_landscape.v2",
    datasetKey: "dataforseo.search_landscape.v2",
  },
  dataforseo_backlinks: {
    provider: "dataforseo",
    operation: "backlinks",
    methodVersion: "dataforseo.backlinks.v1",
    datasetKey: "dataforseo.backlinks.v1",
  },
} as const;

function timestamp(minute: number): string {
  return new Date(Date.UTC(2026, 6, 29, 12, minute)).toISOString();
}

async function createProject(
  db: Db,
  workspaceId: string,
  actorId: string,
): Promise<ProjectFixture> {
  const projectId = randomUUID();
  const siteId = randomUUID();
  const icpProfileId = randomUUID();

  await db.insert(clientProjects).values({
    id: projectId,
    workspace_id: workspaceId,
    client_name: `Growth Map client ${projectId}`,
    project_name: `Growth Map project ${projectId}`,
    default_delivery_locale: "en",
    created_by: actorId,
  });
  await db.insert(sites).values({
    id: siteId,
    workspace_id: workspaceId,
    project_id: projectId,
    origin: `https://${projectId}.example.test`,
    host: `${projectId}.example.test`,
    market_codes: ["US"],
    language_codes: ["en"],
  });
  const profileHash = contentHash({ projectId, version: 1 });
  await db.insert(icpProfiles).values({
    id: icpProfileId,
    workspace_id: workspaceId,
    project_id: projectId,
    version: 1,
    status: "complete",
    profile: { projectId },
    content_hash: profileHash,
    created_by: actorId,
  });
  await db
    .update(clientProjects)
    .set({
      current_icp_profile_id: icpProfileId,
      confirmed_icp_profile_id: icpProfileId,
    })
    .where(eq(clientProjects.id, projectId));

  return {
    actorId,
    workspaceId,
    projectId,
    siteId,
    icpProfileId,
  };
}

async function createDiagnostic(
  db: Db,
  fixture: ProjectFixture,
  input: {
    readonly createdAt: string;
    readonly publishAudit: boolean;
    readonly auditScopeKey?: string;
    readonly auditProjectionVersion?: string;
  },
): Promise<string> {
  const id = randomUUID();
  const manifest = { fixture: "growth-map-lineage", diagnosticRunId: id };

  await db.insert(asyncRuns).values({
    id,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "diagnostic",
    status: "completed",
    result_type: "diagnostic_run",
    result_id: id,
    initiated_by: fixture.actorId,
    queued_at: input.createdAt,
    started_at: input.createdAt,
    completed_at: input.createdAt,
    created_at: input.createdAt,
    updated_at: input.createdAt,
  });
  await db.insert(diagnosticRuns).values({
    id,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    site_id: fixture.siteId,
    icp_profile_id: fixture.icpProfileId,
    icp_profile_version: 1,
    rule_set_version: "mvp.rules.0.2.0",
    prompt_set_version: "mvp.prompts.0.2.0",
    output_locale: "en",
    input_manifest: manifest,
    input_hash: contentHash(manifest),
    created_at: input.createdAt,
  });

  if (input.publishAudit) {
    await new CapabilityRunsRepository(db).create({
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      asyncRunId: id,
      capabilityId: "growth-audit",
      capabilityVersion: "0.3.0",
      inputManifestHash: contentHash({ diagnosticRunId: id }),
      mode: "production",
      sideEffectClass: "read_only",
    });
    await new AuditRunsRepository(db).create({
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      diagnosticRunId: id,
      capabilityRunId: id,
      scopeKind: "site",
      scopeKey: input.auditScopeKey ?? fixture.siteId,
      projectionVersion:
        input.auditProjectionVersion ?? GROWTH_AUDIT_PROJECTION_VERSION,
    });
  }

  return id;
}

async function completeCollectionStep(
  db: Db,
  fixture: ProjectFixture,
  plans: AnalysisRefreshRunsRepository,
  analysisRefreshRunId: string,
  stepKey: CollectionStepKey,
  completedAt: string,
  canonicalChild = true,
): Promise<void> {
  const scope = {
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
  };
  const identity = COLLECTION_STEP_IDENTITY[stepKey];
  const sources = new SourceConnectionsRepository(db);
  const existing = await sources.findConnectedByProvider(
    scope,
    identity.provider,
  );
  const source =
    existing ??
    (stepKey === "crawl"
      ? await sources.insertDefaultCrawl({
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          siteId: fixture.siteId,
          createdBy: fixture.actorId,
        })
      : await sources.insertConnection({
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          siteId: fixture.siteId,
          provider: identity.provider,
          connectionType:
            identity.provider === "dataforseo" ? "api_key_stub" : "oauth",
          state: "connected",
          externalRef: `${stepKey}:${fixture.siteId}`,
          limitation: "Deterministic Growth Map publication fixture.",
          connectedAt: true,
          createdBy: fixture.actorId,
        }));
  const childRunId = randomUUID();
  await db.insert(asyncRuns).values({
    id: childRunId,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "collection",
    status: canonicalChild ? "completed" : "running",
    ...(canonicalChild
      ? {
          result_type: "collection_run",
          result_id: childRunId,
          completed_at: completedAt,
        }
      : {}),
    initiated_by: fixture.actorId,
    queued_at: completedAt,
    started_at: completedAt,
  });
  const collections = new CollectionRunsRepository(db);
  await collections.insertPlaceholder({
    runId: childRunId,
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    sourceConnectionId: source.id,
    provider: identity.provider,
    operation: identity.operation,
    methodVersion: identity.methodVersion,
    parametersHash: contentHash({
      analysisRefreshRunId,
      stepKey,
      childRunId,
    }),
  });
  const snapshot = await new DataSnapshotsRepository(db).insert({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    collectionRunId: childRunId,
    sourceConnectionId: source.id,
    provider: identity.provider,
    datasetKey: identity.datasetKey,
    schemaVersion: identity.methodVersion,
    methodVersion: identity.methodVersion,
    capturedAt: completedAt,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Deterministic Growth Map publication fixture.",
    rawObjectKey: null,
    rowCount: 0,
    checksum: contentHash({ childRunId, stepKey, rows: 0 }),
  });
  await collections.finalize(childRunId, {
    rowCount: 0,
    sourceWindow: snapshot.source_window,
    providerUsage: { requestCount: 0 },
    stopReason: null,
  });
  if (
    !(await plans.startStep(
      scope,
      analysisRefreshRunId,
      stepKey,
      childRunId,
    )) ||
    !(await plans.completeStep(scope, analysisRefreshRunId, stepKey, {
      childAsyncRunId: childRunId,
      resultSnapshotId: snapshot.id,
    }))
  ) {
    throw new Error(
      `Growth Map integration fixture could not complete ${stepKey} step`,
    );
  }
}

async function createRefreshParent(
  db: Db,
  fixture: ProjectFixture,
  input: {
    readonly status: ParentStatus;
    readonly createdAt: string;
    readonly completedAt?: string;
    readonly childDiagnosticRunId: string;
    readonly stepStates?: Partial<
      Readonly<Record<CollectionStepKey, PlannedStepState>>
    >;
    readonly topicStepState?: TopicStepState;
    readonly legacyPlan?: boolean;
  },
): Promise<string> {
  const id = randomUUID();
  const completedAt =
    input.status === "running"
      ? null
      : (input.completedAt ?? input.createdAt);

  await db.insert(asyncRuns).values({
    id,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "analysis_refresh",
    status: "running",
    result_type: "analysis_refresh_run",
    result_id: id,
    initiated_by: fixture.actorId,
    queued_at: input.createdAt,
    started_at: input.createdAt,
    completed_at: null,
    created_at: input.createdAt,
    updated_at: input.createdAt,
  });
  const plans = new AnalysisRefreshRunsRepository(db);
  if (input.legacyPlan) {
    const manifest = legacyAnalysisRefreshPlanManifest();
    await db.insert(analysisRefreshRuns).values({
      id,
      workspace_id: fixture.workspaceId,
      project_id: fixture.projectId,
      site_id: fixture.siteId,
      icp_profile_id: fixture.icpProfileId,
      plan_manifest: manifest as unknown as Record<string, unknown>,
      plan_hash: analysisRefreshPlanHash(manifest),
    });
    await db.insert(analysisRefreshSteps).values(
      manifest.steps.map((step) => ({
        analysis_refresh_run_id: id,
        workspace_id: fixture.workspaceId,
        project_id: fixture.projectId,
        ordinal: step.ordinal,
        step_key: step.stepKey,
        required: step.required,
      })),
    );
  } else {
    await plans.create({
      runId: id,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      siteId: fixture.siteId,
      icpProfileId: fixture.icpProfileId,
    });
  }
  const scope = {
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
  };
  const states: Readonly<Record<CollectionStepKey, PlannedStepState>> = {
    crawl: input.stepStates?.crawl ?? "completed",
    gsc: input.stepStates?.gsc ?? "skipped",
    ga4: input.stepStates?.ga4 ?? "skipped",
    dataforseo: input.stepStates?.dataforseo ?? "skipped",
    dataforseo_backlinks:
      input.stepStates?.dataforseo_backlinks ?? "skipped",
  };
  const collectionStepKeys: readonly CollectionStepKey[] = input.legacyPlan
    ? ["crawl", "gsc", "ga4", "dataforseo"]
    : ["crawl", "gsc", "ga4", "dataforseo", "dataforseo_backlinks"];
  for (const stepKey of collectionStepKeys) {
    const state = states[stepKey];
    if (state === "pending") continue;
    if (state === "completed" || state === "fabricated_completed") {
      await completeCollectionStep(
        db,
        fixture,
        plans,
        id,
        stepKey,
        input.createdAt,
        state === "completed",
      );
      continue;
    }
    if (state === "skipped") {
      if (stepKey === "crawl") {
        throw new Error("required Crawl step cannot be skipped");
      }
      if (
        !(await plans.skipStep(
          scope,
          id,
          stepKey,
          "Provider was not selected by this deterministic fixture.",
        ))
      ) {
        throw new Error(
          `Growth Map integration fixture could not skip ${stepKey} step`,
        );
      }
      continue;
    }
    if (
      !(await plans.failStep(scope, id, stepKey, {
        childAsyncRunId: null,
        error: {
          code: "FIXTURE_PROVIDER_FAILED",
          summary: "The deterministic provider fixture failed.",
        },
      }))
    ) {
      throw new Error(
        `Growth Map integration fixture could not fail ${stepKey} step`,
      );
    }
  }
  if (!input.legacyPlan) {
    const topicState = input.topicStepState ?? "skipped";
    if (topicState === "skipped") {
      if (
        !(await plans.skipStep(
          scope,
          id,
          "topic_model",
          "insufficient_keyword_evidence",
        ))
      ) {
        throw new Error(
          "Growth Map integration fixture could not skip Topic Model step",
        );
      }
    } else if (topicState === "failed") {
      if (
        !(await plans.failStep(scope, id, "topic_model", {
          childAsyncRunId: null,
          error: {
            code: "TOPIC_MODEL_GENERATION_FIXTURE_FAILED",
            summary: "The deterministic Topic Model fixture failed.",
          },
        }))
      ) {
        throw new Error(
          "Growth Map integration fixture could not fail Topic Model step",
        );
      }
    } else if (topicState === "fabricated_completed") {
      const topicModelGenerationRunId = randomUUID();
      const inputManifest = parseTopicModelGenerationInputManifest({
        schemaVersion: "topic-model-generation-input.v1",
        analysisRefreshRunId: id,
        projectId: fixture.projectId,
        market: "US",
        language: "en",
        groups: [
          {
            groupKey: "group-001",
            representativeKeywords: ["fixture keyword"],
            keywordCount: 1,
            aggregateSearchVolume: null,
            providerIntentDistribution: {
              informational: 0,
              navigational: 0,
              commercial: 0,
              transactional: 0,
            },
            urls: [],
          },
        ],
        productProfile: null,
        icp: null,
        keywords: [
          {
            keywordId: randomUUID(),
            expectedGovernanceRevision: 0,
            groupKey: "group-001",
            providerSearchIntent: null,
          },
        ],
      });
      await db.insert(asyncRuns).values({
        id: topicModelGenerationRunId,
        workspace_id: fixture.workspaceId,
        project_id: fixture.projectId,
        kind: "topic_model_generation",
        status: "running",
        result_type: "topic_model_generation_run",
        result_id: topicModelGenerationRunId,
        initiated_by: fixture.actorId,
        queued_at: input.createdAt,
        started_at: input.createdAt,
        completed_at: null,
        created_at: input.createdAt,
        updated_at: input.createdAt,
      });
      await new TopicModelGenerationRunsRepository(db).insertPlaceholder({
        runId: topicModelGenerationRunId,
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        analysisRefreshRunId: id,
        generationVersion: "topic-model-generation.v1",
        promptSetVersion: "topic-model.prompt.v1",
        inputManifest,
        inputHash: contentHash(inputManifest),
      });
      if (
        !(await plans.startStep(
          scope,
          id,
          "topic_model",
          topicModelGenerationRunId,
        )) ||
        !(await plans.completeStep(scope, id, "topic_model", {
          childAsyncRunId: topicModelGenerationRunId,
          resultSnapshotId: null,
        }))
      ) {
        throw new Error(
          "Growth Map integration fixture could not fabricate Topic Model completion",
        );
      }
    }
  }
  const started = await plans.startStep(
    scope,
    id,
    "growth_audit",
    input.childDiagnosticRunId,
  );
  if (!started) {
    throw new Error("Growth Map integration fixture could not start audit step");
  }
  if (
    !(await plans.completeStep(scope, id, "growth_audit", {
      childAsyncRunId: input.childDiagnosticRunId,
      resultSnapshotId: null,
    }))
  ) {
    throw new Error(
      "Growth Map integration fixture could not complete audit step",
    );
  }
  await db
    .update(asyncRuns)
    .set({
      status: input.status,
      completed_at: completedAt,
      updated_at: input.createdAt,
    })
    .where(eq(asyncRuns.id, id));
  return id;
}

describeDb("GrowthMapReadRepository publishable Analysis Refresh lineage", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("selects the latest parent publication across interleaved and non-publishable child generations", async () => {
    const actorId = randomUUID();
    const workspaceId = randomUUID();
    await handle.db.insert(workspaces).values({
      id: workspaceId,
      name: `Growth Map lineage ${workspaceId}`,
    });
    const fixture = await createProject(handle.db, workspaceId, actorId);
    const foreignProject = await createProject(
      handle.db,
      workspaceId,
      actorId,
    );

    const latestPublication = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(1),
      publishAudit: true,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "completed",
      createdAt: timestamp(0),
      completedAt: timestamp(55),
      childDiagnosticRunId: latestPublication,
      stepStates: { gsc: "completed" },
    });

    // Its child is newer, but this valid generation published earlier.
    const newerChildEarlierPublication = await createDiagnostic(
      handle.db,
      fixture,
      {
        createdAt: timestamp(5),
        publishAudit: true,
      },
    );
    await createRefreshParent(handle.db, fixture, {
      status: "completed",
      createdAt: timestamp(2),
      completedAt: timestamp(15),
      childDiagnosticRunId: newerChildEarlierPublication,
    });

    // A known 0.3.0 publication remains addressable by exact DiagnosticRun id,
    // but even a later parent publication must not enter the 0.3.1 latest read.
    const pinnedLegacyProjection = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(8),
      publishAudit: true,
      auditProjectionVersion: LEGACY_GROWTH_AUDIT_PROJECTION_VERSION,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "completed",
      createdAt: timestamp(7),
      completedAt: timestamp(60),
      childDiagnosticRunId: pinnedLegacyProjection,
    });

    // A projected legacy diagnosis has no Analysis Refresh parent or step.
    const legacy = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(10),
      publishAudit: true,
    });

    const running = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(20),
      publishAudit: true,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "running",
      createdAt: timestamp(19),
      childDiagnosticRunId: running,
    });

    const failed = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(30),
      publishAudit: true,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "failed",
      createdAt: timestamp(29),
      childDiagnosticRunId: failed,
    });

    const cancelled = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(35),
      publishAudit: true,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "cancelled",
      createdAt: timestamp(34),
      childDiagnosticRunId: cancelled,
    });

    const referencedWithoutAudit = await createDiagnostic(
      handle.db,
      fixture,
      {
        createdAt: timestamp(40),
        publishAudit: false,
      },
    );
    await createRefreshParent(handle.db, fixture, {
      status: "completed",
      createdAt: timestamp(39),
      childDiagnosticRunId: referencedWithoutAudit,
    });
    // This projected diagnostic is newer but is not the parent's exact child.
    const unreferencedProjected = await createDiagnostic(
      handle.db,
      fixture,
      {
        createdAt: timestamp(41),
        publishAudit: true,
      },
    );

    const wrongSiteProjection = await createDiagnostic(
      handle.db,
      fixture,
      {
        createdAt: timestamp(50),
        publishAudit: true,
        auditScopeKey: randomUUID(),
      },
    );
    await createRefreshParent(handle.db, fixture, {
      status: "partial",
      createdAt: timestamp(49),
      childDiagnosticRunId: wrongSiteProjection,
    });

    // A terminal parent with only Growth Audit completed was the exact
    // fabricated publication shape the old reader admitted.
    const incompletePlan = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(52),
      publishAudit: true,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "partial",
      createdAt: timestamp(51),
      completedAt: timestamp(57),
      childDiagnosticRunId: incompletePlan,
      stepStates: {
        crawl: "pending",
        gsc: "pending",
        ga4: "pending",
        dataforseo: "pending",
      },
    });

    const pendingOptional = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(54),
      publishAudit: true,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "partial",
      createdAt: timestamp(53),
      completedAt: timestamp(58),
      childDiagnosticRunId: pendingOptional,
      stepStates: { ga4: "pending" },
    });

    const failedOptional = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(56),
      publishAudit: true,
    });
    const failedOptionalParent = await createRefreshParent(handle.db, fixture, {
      status: "partial",
      createdAt: timestamp(55),
      completedAt: timestamp(14),
      childDiagnosticRunId: failedOptional,
      stepStates: { dataforseo: "failed" },
    });

    const failedTopic = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(57),
      publishAudit: true,
    });
    const failedTopicParent = await createRefreshParent(handle.db, fixture, {
      status: "partial",
      createdAt: timestamp(56),
      completedAt: timestamp(13),
      childDiagnosticRunId: failedTopic,
      topicStepState: "failed",
    });

    const fabricatedTopic = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(58),
      publishAudit: true,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "completed",
      createdAt: timestamp(57),
      completedAt: timestamp(62),
      childDiagnosticRunId: fabricatedTopic,
      topicStepState: "fabricated_completed",
    });

    const fabricatedCollection = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(59),
      publishAudit: true,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "completed",
      createdAt: timestamp(57),
      completedAt: timestamp(61),
      childDiagnosticRunId: fabricatedCollection,
      stepStates: { gsc: "fabricated_completed" },
    });

    const foreignPublished = await createDiagnostic(
      handle.db,
      foreignProject,
      {
        createdAt: timestamp(59),
        publishAudit: true,
      },
    );
    await createRefreshParent(handle.db, foreignProject, {
      status: "partial",
      createdAt: timestamp(58),
      childDiagnosticRunId: foreignPublished,
    });

    const repository = new GrowthMapReadRepository(handle.db);
    const projectScope = {
      workspaceId,
      projectId: fixture.projectId,
    };
    await expect(
      repository.findLatestReadableRun(projectScope),
    ).resolves.toMatchObject({
      id: latestPublication,
      workspace_id: workspaceId,
      project_id: fixture.projectId,
      site_id: fixture.siteId,
      run_status: "completed",
    });
    await expect(
      repository.findReadableRunById(
        projectScope,
        newerChildEarlierPublication,
      ),
    ).resolves.toMatchObject({
      id: newerChildEarlierPublication,
      project_id: fixture.projectId,
      site_id: fixture.siteId,
      run_status: "completed",
    });
    await expect(
      repository.findReadableRunById(projectScope, latestPublication),
    ).resolves.toMatchObject({
      id: latestPublication,
      project_id: fixture.projectId,
      site_id: fixture.siteId,
      run_status: "completed",
    });
    await expect(
      repository.findReadableRunById(projectScope, pinnedLegacyProjection),
    ).resolves.toMatchObject({
      id: pinnedLegacyProjection,
      project_id: fixture.projectId,
      site_id: fixture.siteId,
      run_status: "completed",
    });
    await expect(
      repository.findReadableRunById(projectScope, failedOptional),
    ).resolves.toMatchObject({
      id: failedOptional,
      project_id: fixture.projectId,
      site_id: fixture.siteId,
      run_status: "completed",
    });
    await expect(
      repository.findReadableRunById(projectScope, failedTopic),
    ).resolves.toMatchObject({
      id: failedTopic,
      project_id: fixture.projectId,
      site_id: fixture.siteId,
      run_status: "completed",
    });
    await expect(
      handle.db
        .select({ status: asyncRuns.status })
        .from(asyncRuns)
        .where(eq(asyncRuns.id, failedOptionalParent)),
    ).resolves.toEqual([{ status: "partial" }]);
    await expect(
      handle.db
        .select({ status: asyncRuns.status })
        .from(asyncRuns)
        .where(eq(asyncRuns.id, failedTopicParent)),
    ).resolves.toEqual([{ status: "partial" }]);
    for (const nonPublishableOrForeignId of [
      legacy,
      running,
      failed,
      cancelled,
      referencedWithoutAudit,
      unreferencedProjected,
      wrongSiteProjection,
      incompletePlan,
      pendingOptional,
      fabricatedTopic,
      fabricatedCollection,
      foreignPublished,
    ]) {
      await expect(
        repository.findReadableRunById(
          projectScope,
          nonPublishableOrForeignId,
        ),
      ).resolves.toBeNull();
    }
    await expect(
      repository.findLatestReadableRun({
        workspaceId,
        projectId: foreignProject.projectId,
      }),
    ).resolves.toMatchObject({
      id: foreignPublished,
      project_id: foreignProject.projectId,
      run_status: "completed",
    });
  });

  it("keeps an exact legacy five-step parent readable and rejects mixed DataForSEO lineage", async () => {
    const actorId = randomUUID();
    const workspaceId = randomUUID();
    await handle.db.insert(workspaces).values({
      id: workspaceId,
      name: `Growth Map legacy lineage ${workspaceId}`,
    });
    const fixture = await createProject(handle.db, workspaceId, actorId);
    const diagnosticRunId = await createDiagnostic(handle.db, fixture, {
      createdAt: timestamp(1),
      publishAudit: true,
    });
    await createRefreshParent(handle.db, fixture, {
      status: "completed",
      createdAt: timestamp(2),
      childDiagnosticRunId: diagnosticRunId,
      legacyPlan: true,
    });

    const scope = { workspaceId, projectId: fixture.projectId };
    await expect(
      new GrowthMapReadRepository(handle.db).findReadableRunById(
        scope,
        diagnosticRunId,
      ),
    ).resolves.toMatchObject({
      id: diagnosticRunId,
      project_id: fixture.projectId,
      site_id: fixture.siteId,
    });

    const source = await new SourceConnectionsRepository(
      handle.db,
    ).insertConnection({
      workspaceId,
      projectId: fixture.projectId,
      siteId: fixture.siteId,
      provider: "dataforseo",
      connectionType: "api_key_stub",
      state: "connected",
      externalRef: `${fixture.projectId}.example.test`,
      limitation: "Exact mixed-lineage rejection fixture.",
      connectedAt: true,
      createdBy: actorId,
    });
    const collectionRunId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: collectionRunId,
      workspace_id: workspaceId,
      project_id: fixture.projectId,
      kind: "collection",
      status: "completed",
      result_type: "collection_run",
      result_id: collectionRunId,
      initiated_by: actorId,
      queued_at: timestamp(3),
      started_at: timestamp(3),
      completed_at: timestamp(3),
    });
    await new CollectionRunsRepository(handle.db).insertPlaceholder({
      runId: collectionRunId,
      workspaceId,
      projectId: fixture.projectId,
      siteId: fixture.siteId,
      sourceConnectionId: source.id,
      provider: "dataforseo",
      operation: "search_landscape",
      methodVersion: "dataforseo.search_landscape.v2",
      parametersHash: contentHash({ collectionRunId, version: 2 }),
    });

    await expect(
      new DataSnapshotsRepository(handle.db).insert({
        workspaceId,
        projectId: fixture.projectId,
        siteId: fixture.siteId,
        collectionRunId,
        sourceConnectionId: source.id,
        provider: "dataforseo",
        datasetKey: "dataforseo.search_landscape.v1",
        schemaVersion: "dataforseo.search_landscape.v1",
        methodVersion: "dataforseo.search_landscape.v1",
        capturedAt: timestamp(3),
        sourceWindow: { start: null, end: null },
        availability: "available",
        limitation: "The mixed identity must be rejected.",
        rawObjectKey: null,
        rowCount: 0,
        checksum: contentHash({ collectionRunId, mixed: true }),
      }),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringMatching(/exact collection identity/u),
      },
    });
  });
});
