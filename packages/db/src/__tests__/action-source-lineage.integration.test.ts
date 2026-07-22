import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type Db, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import { ActionsRepository } from "../repositories/actions.ts";
import { CollectionRunsRepository } from "../repositories/collection-runs.ts";
import { DataSnapshotsRepository } from "../repositories/data-snapshots.ts";
import { DiagnosticRunsRepository } from "../repositories/diagnostic-runs.ts";
import { EvidenceRepository } from "../repositories/evidence.ts";
import { FindingsRepository } from "../repositories/findings.ts";
import { SourceConnectionsRepository } from "../repositories/source-connections.ts";
import {
  actions,
  asyncRuns,
  clientProjects,
  icpProfiles,
  sites,
  workspaces,
} from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CRAWL_METHOD_VERSION = "crawl.site_graph.v2";
const CRAWL_DATASET_KEY = "crawl.site_graph.v1";
const RULE_SET_VERSION = "mvp.rules.0.2.0";
const PROMPT_SET_VERSION = "mvp.prompts.0.2.0";

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

interface ProjectFixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly icpProfileId: string;
  readonly icpContentHash: string;
  readonly crawlSourceConnectionId: string;
}

interface DiagnosticFixture {
  readonly runId: string;
  readonly collectionRunId: string;
  readonly snapshotId: string;
  readonly capturedAt: string;
}

interface FindingFixture extends ProjectFixture {
  readonly findingId: string;
  readonly sourceDiagnosticRunId: string;
  readonly sourceDiagnostic: DiagnosticFixture;
}

async function createProjectFixture(db: Db): Promise<ProjectFixture> {
  const actorId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const icpProfileId = randomUUID();
  const icpProfile = { fixtureId: randomUUID() };
  const icpContentHash = contentHash(icpProfile);

  await db.insert(workspaces).values({
    id: workspaceId,
    name: `Action lineage ${workspaceId}`,
  });
  await db.insert(clientProjects).values({
    id: projectId,
    workspace_id: workspaceId,
    client_name: `Client ${projectId}`,
    project_name: `Project ${projectId}`,
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
  const crawlSource = await new SourceConnectionsRepository(
    db,
  ).insertDefaultCrawl({
    workspaceId,
    projectId,
    siteId,
    createdBy: actorId,
  });
  await db.insert(icpProfiles).values({
    id: icpProfileId,
    workspace_id: workspaceId,
    project_id: projectId,
    version: 1,
    status: "complete",
    profile: icpProfile,
    content_hash: icpContentHash,
    created_by: actorId,
  });

  return {
    actorId,
    workspaceId,
    projectId,
    siteId,
    icpProfileId,
    icpContentHash,
    crawlSourceConnectionId: crawlSource.id,
  };
}

async function createDiagnosticRun(
  db: Db,
  fixture: ProjectFixture,
): Promise<DiagnosticFixture> {
  const collectionRunId = randomUUID();
  const runId = randomUUID();
  const capturedAt = new Date().toISOString();
  const sourceWindow = { start: null, end: null };

  await db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "collection",
    status: "completed",
    active_key: null,
    initiated_by: fixture.actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const collectionRuns = new CollectionRunsRepository(db);
  await collectionRuns.insertPlaceholder({
    runId: collectionRunId,
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    sourceConnectionId: fixture.crawlSourceConnectionId,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(db).insert({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    collectionRunId,
    sourceConnectionId: fixture.crawlSourceConnectionId,
    provider: "crawl",
    datasetKey: CRAWL_DATASET_KEY,
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow,
    availability: "available",
    limitation: "Deterministic public Crawl integration fixture.",
    rawObjectKey: null,
    rowCount: 1,
    checksum: contentHash({ collectionRunId, capturedAt }),
  });
  await collectionRuns.finalize(collectionRunId, {
    rowCount: snapshot.row_count,
    sourceWindow,
    providerUsage: { urlsFetched: 1, pagesCollected: 1 },
    stopReason: null,
  });
  await new SourceConnectionsRepository(db).setLastSnapshot(
    fixture.crawlSourceConnectionId,
    snapshot.id,
    snapshot.availability,
    snapshot.limitation,
  );

  await db.insert(asyncRuns).values({
    id: runId,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "diagnostic",
    status: "completed",
    active_key: null,
    initiated_by: fixture.actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const inputManifest = {
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en",
    icp: {
      id: fixture.icpProfileId,
      version: 1,
      contentHash: fixture.icpContentHash,
    },
    snapshots: [
      {
        snapshotId: snapshot.id,
        provider: "crawl",
        datasetKey: snapshot.dataset_key,
        schemaVersion: snapshot.schema_version,
        methodVersion: snapshot.method_version,
        checksum: snapshot.checksum,
        availability: snapshot.availability,
        sourceWindow,
        capturedAt: snapshot.captured_at,
      },
    ],
  };
  await new DiagnosticRunsRepository(db).insert({
    runId,
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    icpProfileId: fixture.icpProfileId,
    icpProfileVersion: 1,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: "en",
    inputManifest,
    inputHash: contentHash(inputManifest),
  });
  return {
    runId,
    collectionRunId,
    snapshotId: snapshot.id,
    capturedAt: snapshot.captured_at,
  };
}

async function linkFindingObservation(
  db: Db,
  fixture: ProjectFixture,
  findingId: string,
  diagnostic: DiagnosticFixture,
): Promise<void> {
  const [evidenceId] = await new EvidenceRepository(db).insertMany(
    {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      diagnosticRunId: diagnostic.runId,
    },
    [
      {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: ["https://example.test/page"],
        claim: "Observed source lineage.",
        observedAt: diagnostic.capturedAt,
        limitation: "Disposable integration fixture.",
        snapshotId: diagnostic.snapshotId,
        collectionRunId: diagnostic.collectionRunId,
      },
    ],
  );
  await new EvidenceRepository(db).linkObservations(
    {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      diagnosticRunId: diagnostic.runId,
    },
    [{ findingId, evidenceId: evidenceId!, role: "primary" }],
  );
}

async function createFindingFixture(db: Db): Promise<FindingFixture> {
  const project = await createProjectFixture(db);
  const sourceDiagnostic = await createDiagnosticRun(db, project);
  const seenAt = new Date().toISOString();
  const finding = await new FindingsRepository(db).insert({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    findingKey: contentHash({ fixtureId: randomUUID() }),
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
    ruleFamily: "http-status",
    intent: "restore_or_redirect",
    domain: "technical_seo",
    titleKey: "finding.http_status",
    titleArgs: { status: 404 },
    summary: "A traced integration finding.",
    summaryLocale: "en",
    subjectRefs: ["http_status:404"],
    severity: "high",
    confidence: "high",
    reviewState: "confirmed",
    runId: sourceDiagnostic.runId,
    seenAt,
  });
  await linkFindingObservation(
    db,
    project,
    finding.id,
    sourceDiagnostic,
  );
  return {
    ...project,
    findingId: finding.id,
    sourceDiagnosticRunId: sourceDiagnostic.runId,
    sourceDiagnostic,
  };
}

function actionInsert(fixture: FindingFixture, sourceDiagnosticRunId: string) {
  return {
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    sourceFindingId: fixture.findingId,
    sourceDiagnosticRunId,
    actionKey: contentHash({ fixtureId: randomUUID() }),
    templateId: `template.${randomUUID()}`,
    templateVersion: 1,
    title: "Repair traced issue",
    description: "Repair the issue recorded by the frozen diagnostic run.",
    contentLocale: "en",
    priorityBand: "high",
    roadmapLane: "now",
    status: "candidate",
    effort: "small",
    risk: "low",
    expectedOutcome: "The traced issue is resolved.",
    evidenceRefs: [],
    createdBy: fixture.actorId,
  };
}

describeDb("Action source DiagnosticRun lineage", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("persists the exact DiagnosticRun that observed the source finding", async () => {
    const fixture = await createFindingFixture(handle.db);
    const action = await new ActionsRepository(handle.db).insert(
      actionInsert(fixture, fixture.sourceDiagnosticRunId),
    );

    expect(action.source_finding_id).toBe(fixture.findingId);
    expect(action.source_diagnostic_run_id).toBe(
      fixture.sourceDiagnosticRunId,
    );
  });

  it("rejects an unobserved run and a run from another project", async () => {
    const fixture = await createFindingFixture(handle.db);
    const unobservedRun = await createDiagnosticRun(handle.db, fixture);
    await expectPgCode(
      new ActionsRepository(handle.db).insert(
        actionInsert(fixture, unobservedRun.runId),
      ),
      "23514",
    );

    const otherProject = await createProjectFixture(handle.db);
    const otherRun = await createDiagnosticRun(handle.db, otherProject);
    await expectPgCode(
      new ActionsRepository(handle.db).insert(
        actionInsert(fixture, otherRun.runId),
      ),
      "23514",
    );
  });

  it("requires the run that is current when the Action is first inserted", async () => {
    const fixture = await createFindingFixture(handle.db);
    const laterRun = await createDiagnosticRun(handle.db, fixture);
    await linkFindingObservation(
      handle.db,
      fixture,
      fixture.findingId,
      laterRun,
    );
    await new FindingsRepository(handle.db).touchSeen(fixture.findingId, {
      ruleVersion: 1,
      severity: "medium",
      confidence: "high",
      titleArgs: { status: 404 },
      summary: "The finding was observed again.",
      summaryLocale: "en",
      subjectRefs: ["http_status:404"],
      runId: laterRun.runId,
      seenAt: new Date().toISOString(),
      regressed: false,
    });

    await expectPgCode(
      new ActionsRepository(handle.db).insert(
        actionInsert(fixture, fixture.sourceDiagnosticRunId),
      ),
      "23514",
    );
    const action = await new ActionsRepository(handle.db).insert(
      actionInsert(fixture, laterRun.runId),
    );
    expect(action.source_diagnostic_run_id).toBe(laterRun.runId);
  });

  it("does not treat a cross-run evidence link as a real observation", async () => {
    const fixture = await createFindingFixture(handle.db);
    const laterRun = await createDiagnosticRun(handle.db, fixture);
    const [earlierEvidenceId] = await new EvidenceRepository(
      handle.db,
    ).insertMany(
      {
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        diagnosticRunId: fixture.sourceDiagnosticRunId,
      },
      [
        {
          sourceProvider: "crawl",
          origin: "direct_public",
          method: "observed",
          grade: "B",
          availability: "available",
          support: "context",
          subjectRefs: ["https://example.test/corrupt"],
          claim: "Evidence belongs to the earlier run.",
          observedAt: fixture.sourceDiagnostic.capturedAt,
          limitation: "Deliberately corrupt relationship fixture.",
          snapshotId: fixture.sourceDiagnostic.snapshotId,
          collectionRunId: fixture.sourceDiagnostic.collectionRunId,
        },
      ],
    );
    await new EvidenceRepository(handle.db).linkObservations(
      {
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        diagnosticRunId: laterRun.runId,
      },
      [
        {
          findingId: fixture.findingId,
          evidenceId: earlierEvidenceId!,
          role: "primary",
        },
      ],
    );
    await new FindingsRepository(handle.db).touchSeen(fixture.findingId, {
      ruleVersion: 1,
      severity: "medium",
      confidence: "high",
      titleArgs: { status: 404 },
      summary: "The corrupt link claims a later observation.",
      summaryLocale: "en",
      subjectRefs: ["http_status:404"],
      runId: laterRun.runId,
      seenAt: new Date().toISOString(),
      regressed: false,
    });

    await expectPgCode(
      new ActionsRepository(handle.db).insert(
        actionInsert(fixture, laterRun.runId),
      ),
      "23514",
    );
  });

  it("keeps both source ids immutable while allowing overrides after finding drift", async () => {
    const fixture = await createFindingFixture(handle.db);
    const repo = new ActionsRepository(handle.db);
    const action = await repo.insert(
      actionInsert(fixture, fixture.sourceDiagnosticRunId),
    );
    const laterRun = await createDiagnosticRun(handle.db, fixture);
    await linkFindingObservation(
      handle.db,
      fixture,
      fixture.findingId,
      laterRun,
    );
    await new FindingsRepository(handle.db).touchSeen(fixture.findingId, {
      ruleVersion: 1,
      severity: "medium",
      confidence: "high",
      titleArgs: { status: 404 },
      summary: "The finding moved to a later run.",
      summaryLocale: "en",
      subjectRefs: ["http_status:404"],
      runId: laterRun.runId,
      seenAt: new Date().toISOString(),
      regressed: false,
    });

    await expect(
      repo.applyOverride(
        { workspaceId: fixture.workspaceId, projectId: fixture.projectId },
        action.id,
        {
          status: "planned",
          expectedRevision: 1,
          toRevision: 2,
        },
      ),
    ).resolves.toBe(true);
    const afterOverride = await handle.db.query.actions.findFirst({
      where: eq(actions.id, action.id),
    });
    expect(afterOverride).toMatchObject({
      revision: 2,
      status: "planned",
      source_finding_id: fixture.findingId,
      source_diagnostic_run_id: fixture.sourceDiagnosticRunId,
    });

    await expectPgCode(
      handle.db
        .update(actions)
        .set({ source_diagnostic_run_id: laterRun.runId })
        .where(eq(actions.id, action.id)),
      "23514",
    );
    await expectPgCode(
      handle.db
        .update(actions)
        .set({ source_finding_id: randomUUID() })
        .where(eq(actions.id, action.id)),
      "23514",
    );
  });
});
