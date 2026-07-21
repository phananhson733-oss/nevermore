import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@sf/contracts";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  ActionsRepository,
  AsyncRunsRepository,
  DiagnosticRunsRepository,
  ExecutionArtifactsRepository,
  ExportBundlesRepository,
  FindingsRepository,
  ProjectsRepository,
  SitesRepository,
  contentHash,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
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
  const site = await new SitesRepository(handle.db).insertPrimary({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    origin: `https://${randomUUID()}.example`,
    host: `${randomUUID()}.example`,
    marketCodes: ["US"],
    languageCodes: ["en"],
  });
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: { productName: "Snapshot" },
      content_hash: contentHash({ fixture: randomUUID() }),
      created_by: actorId,
    })
    .returning();
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
  await new DiagnosticRunsRepository(handle.db).insert({
    runId: diagnosticRunId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    icpProfileId: icp!.id,
    icpProfileVersion: 1,
    ruleSetVersion: "mvp.rules.0.2.0",
    promptSetVersion: "mvp.prompts.0.2.0",
    outputLocale: "en",
    inputManifest: {},
    inputHash: contentHash({ diagnosticRunId }),
  });
  const finding = await new FindingsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    findingKey: contentHash({ finding: diagnosticRunId }),
    ruleId: "TECH-CRAWL-001",
    ruleVersion: 1,
    ruleFamily: "technical",
    intent: "crawlability",
    domain: "technical_seo",
    titleKey: "finding.fixture",
    titleArgs: {},
    summary: "Snapshot fixture finding",
    summaryLocale: "en",
    subjectRefs: ["https://example.test/"],
    severity: "medium",
    confidence: "high",
    reviewState: "confirmed",
    runId: diagnosticRunId,
    seenAt: new Date().toISOString(),
  });
  const action = await new ActionsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    sourceFindingId: finding.id,
    actionKey: contentHash({ action: finding.id }),
    templateId: "technical-ticket",
    templateVersion: 1,
    title: "Fix crawlability",
    description: "Apply the fixture change.",
    contentLocale: "en",
    priorityBand: "medium",
    roadmapLane: "next",
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: "Crawlability improves.",
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
