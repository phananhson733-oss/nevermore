import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@sf/contracts";
import {
  AsyncRunsRepository,
  DiagnosticRunsRepository,
  ProjectsRepository,
  SourceConnectionsRepository,
  createBoss,
  createDbHandle,
  startBoss,
  toRunAttempt,
  type DbHandle,
  type JobWithMetadata,
  type PgBoss,
  type ProjectScope,
  type RunJobPayload,
} from "@sf/db";
import {
  asyncRuns,
  clientProjects,
  collectionRuns,
  dataSnapshots,
  diagnosticRuns,
  icpProfiles,
  sites,
  sourceConnections,
  workspaces,
} from "@sf/db/schema";
import type { Logger } from "@sf/observability";
import { runMigrations } from "../../../../packages/db/src/migrate.ts";
import type { WorkerContext } from "../context.ts";
import { prepareRunDelivery, reconcileActiveRuns } from "./recovery.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const ACTOR_ID = randomUUID();
const NOW = new Date("2026-07-19T12:00:00.000Z");
const OLD = "2026-07-19T08:00:00.000Z";
const HASH = "a".repeat(64);
const RECOVERY_LIMITATION =
  "Source synchronization did not complete; no new snapshot was saved.";

const NOOP = (): void => undefined;
const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

describeDb("worker canonical run recovery", () => {
  let handle: DbHandle;
  let boss: PgBoss;
  let scope: ProjectScope;
  let siteId: string;
  let icpProfileId: string;
  let ctx: WorkerContext;
  // Keep repeated runs against the same disposable database ahead of jobs
  // intentionally left live by earlier executions of this recovery fixture.
  let priority = Math.floor(Date.now() / 1_000);

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
    boss = createBoss(DATABASE_URL!);
    await startBoss(boss);

    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Worker recovery ${randomUUID()}` })
      .returning();
    const [project] = await handle.db
      .insert(clientProjects)
      .values({
        workspace_id: workspace!.id,
        client_name: "Worker recovery",
        project_name: "Worker recovery",
        default_delivery_locale: "en",
        created_by: ACTOR_ID,
      })
      .returning();
    scope = { workspaceId: workspace!.id, projectId: project!.id };
    const [site] = await handle.db
      .insert(sites)
      .values({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        origin: "https://worker-recovery.example",
        host: "worker-recovery.example",
        market_codes: ["US"],
        language_codes: ["en"],
      })
      .returning();
    siteId = site!.id;
    const [icpProfile] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        version: 1,
        status: "complete",
        profile: {},
        content_hash: HASH,
        created_by: ACTOR_ID,
      })
      .returning();
    icpProfileId = icpProfile!.id;
    ctx = {
      db: handle.db,
      boss,
      blobStore: {} as WorkerContext["blobStore"],
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "test", clientSecret: "test" },
      openai: { apiKey: "test", model: "test" },
      findingSummariesEnabled: true,
      logger,
    };
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await handle?.end();
  });

  it("keeps live jobs and reconciles terminal, legacy, missing, and invalid active runs", async () => {
    const created = await seedRun({ status: "running" });
    await send(created);

    const active = await seedRun({ status: "running" });
    await fetchOwn(await send(active));

    const retry = await seedRun({ status: "running" });
    const retryJob = await fetchOwn(
      await send(retry, { retryLimit: 1, retryDelay: 3_600 }),
    );
    await boss.fail("diagnose", retryJob.id);

    // This canonical row is deliberately queued: terminal reconciliation must
    // cover both active canonical states, including final transient resets.
    const failed = await seedRun({ status: "queued" });
    const failedJob = await fetchOwn(await send(failed, { retryLimit: 0 }));
    await boss.fail("diagnose", failedJob.id);

    const cancelled = await seedRun({ status: "running" });
    await send(cancelled);
    await boss.cancel("diagnose", cancelled);

    const completed = await seedRun({ status: "running" });
    const completedJob = await fetchOwn(await send(completed));
    await boss.complete("diagnose", completedJob.id);

    const legacyCompleted = await seedRun({
      status: "running",
      contractVersion: "0.2.0",
    });
    const legacyJobId = await boss.send(
      "diagnose",
      payload(legacyCompleted, "0.2.0"),
      { priority: ++priority },
    );
    expect(legacyJobId).not.toBeNull();
    const legacyJob = await fetchOwn(legacyJobId!);
    expect(legacyJob.id).not.toBe(legacyCompleted);
    await boss.complete("diagnose", legacyJob.id);

    const missingRunning = await seedRun({ status: "running" });
    const missingQueued = await seedRun({ status: "queued" });
    const missingFresh = await seedRun({
      status: "queued",
      queuedAt: NOW.toISOString(),
    });
    const invalidMapping = await seedRun({
      status: "queued",
      kind: "collection",
      requestPayload: { provider: "unsupported" },
    });

    await reconcileActiveRuns(ctx, {
      scope,
      now: NOW,
      missingAfterMs: 60 * 60 * 1_000,
    });

    await expectRun(created, "running", null);
    await expectRun(active, "running", null);
    await expectRun(retry, "running", null);
    await expectRun(failed, "failed", "QUEUE_JOB_FAILED");
    await expectRun(cancelled, "cancelled", "QUEUE_JOB_CANCELLED");
    await expectRun(
      completed,
      "failed",
      "QUEUE_JOB_COMPLETED_WITHOUT_CANONICAL_RESULT",
    );
    await expectRun(
      legacyCompleted,
      "failed",
      "QUEUE_JOB_COMPLETED_WITHOUT_CANONICAL_RESULT",
    );
    await expectRun(missingRunning, "failed", "QUEUE_JOB_MISSING");
    await expectRun(missingQueued, "failed", "QUEUE_JOB_MISSING");
    await expectRun(missingFresh, "queued", null);
    await expectRun(invalidMapping, "failed", "QUEUE_MAPPING_INVALID");

    expect((await boss.getJobById("diagnose", created))?.state).toBe(
      "created",
    );
    expect((await boss.getJobById("diagnose", active))?.state).toBe("active");
    expect((await boss.getJobById("diagnose", retry))?.state).toBe("retry");
    expect(await boss.getJobById("diagnose", legacyCompleted)).toBeNull();
    expect(
      await boss.findJobs<RunJobPayload>("diagnose", {
        data: { runId: legacyCompleted },
      }),
    ).toHaveLength(1);
  });

  it("terminalizes active legacy diagnostic executors before delivery or queue lookup and preserves completed history", async () => {
    const delivered = await seedRun({
      status: "queued",
      contractVersion: "0.2.0",
    });
    await seedFrozenDiagnostic(delivered, "mvp.rules.0.2.0");
    const deliveryJobId = await boss.send(
      "diagnose",
      payload(delivered, "0.2.0"),
      { id: delivered, priority: ++priority },
    );
    expect(deliveryJobId).toBe(delivered);
    const deliveryJob = await fetchOwn(deliveryJobId!);
    const execute = vi.fn(async () => undefined);

    await prepareRunDelivery(ctx, deliveryJob, execute);

    expect(execute).not.toHaveBeenCalled();
    await expectRun(
      delivered,
      "failed",
      "DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED",
    );
    await boss.complete("diagnose", deliveryJob.id);

    const swept = await seedRun({
      status: "running",
      contractVersion: "0.2.0",
    });
    await seedFrozenDiagnostic(swept, "mvp.rules.0.2.0");
    const sweepJobId = await boss.send(
      "diagnose",
      payload(swept, "0.2.0"),
      { id: swept, priority: ++priority },
    );
    expect(sweepJobId).toBe(swept);

    const historical = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: historical,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "completed",
      contract_version: "0.2.0",
      request_payload: {},
      initiated_by: ACTOR_ID,
      queued_at: OLD,
      started_at: OLD,
      completed_at: OLD,
      result_type: "diagnostic_run",
      result_id: historical,
    });
    await seedFrozenDiagnostic(historical, "mvp.rules.0.2.0");
    const historicalBefore = await new DiagnosticRunsRepository(
      handle.db,
    ).findById(scope, historical);

    await reconcileActiveRuns(ctx, {
      scope,
      now: NOW,
      missingAfterMs: 60 * 60 * 1_000,
    });

    await expectRun(
      swept,
      "failed",
      "DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED",
    );
    await expectRun(historical, "completed", null);
    await expect(
      new DiagnosticRunsRepository(handle.db).findById(scope, historical),
    ).resolves.toEqual(historicalBefore);
    await boss.cancel("diagnose", swept);
  });

  it("turns a final transient reset into failed without overwriting a runner terminal result", async () => {
    const transientRun = await seedRun({
      status: "queued",
      attemptCount: 2,
    });
    const finalRetry = await fetchAtRetry(transientRun, 2);
    const repo = new AsyncRunsRepository(handle.db);
    const transient = new Error("fixture transient");

    await expect(
      prepareRunDelivery(ctx, finalRetry, async () => {
        const claimed = await repo.claim(scope, transientRun);
        expect(claimed).toMatchObject({
          attempt_count: 3,
        });
        await repo.resetToQueued(toRunAttempt(claimed!));
        throw transient;
      }),
    ).rejects.toBe(transient);
    await expectRun(
      transientRun,
      "failed",
      "QUEUE_RETRY_EXHAUSTED",
    );
    await boss.fail("diagnose", finalRetry.id);

    const permanentRun = await seedRun({ status: "queued" });
    const permanentJob = await fetchOwn(
      await send(permanentRun, { retryLimit: 0 }),
    );
    await expect(
      prepareRunDelivery(ctx, permanentJob, async () => {
        const claimed = await repo.claim(scope, permanentRun);
        expect(claimed).not.toBeNull();
        await repo.setTerminal(toRunAttempt(claimed!), {
          status: "failed",
          lastErrorCode: "PERMANENT_FIXTURE",
          lastErrorSummary: "Safe fixture summary.",
        });
        throw new Error("runner already persisted a terminal state");
      }),
    ).rejects.toThrow("runner already persisted a terminal state");
    await expectRun(permanentRun, "failed", "PERMANENT_FIXTURE");
    await boss.fail("diagnose", permanentJob.id);
  });

  it("projects failed collection recovery without overwriting newer success or disconnect state", async () => {
    const [withSnapshot, withoutSnapshot, alreadyAvailable, disconnected] =
      await handle.db
        .insert(sourceConnections)
        .values([
          {
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            site_id: siteId,
            provider: "crawl",
            connection_type: "public",
            state: "syncing",
            limitation: "Crawl sync in progress.",
            connected_at: OLD,
            created_by: ACTOR_ID,
          },
          {
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            site_id: siteId,
            provider: "gsc",
            connection_type: "oauth",
            state: "syncing",
            limitation: "GSC sync in progress.",
            connected_at: OLD,
            created_by: ACTOR_ID,
          },
          {
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            site_id: siteId,
            provider: "ga4",
            connection_type: "oauth",
            state: "available",
            limitation: "Newer GA4 snapshot is available.",
            connected_at: OLD,
            created_by: ACTOR_ID,
          },
          {
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            site_id: siteId,
            provider: "csv",
            connection_type: "file_import",
            state: "disconnected",
            limitation: "CSV source was disconnected.",
            connected_at: OLD,
            disconnected_at: OLD,
            created_by: ACTOR_ID,
          },
        ])
        .returning();

    const historicalRunId = randomUUID();
    const historicalSnapshotId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: historicalRunId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "collection",
      status: "completed",
      request_payload: {
        provider: "crawl",
        sourceConnectionId: withSnapshot!.id,
      },
      initiated_by: ACTOR_ID,
      completed_at: OLD,
    });
    await handle.db.insert(collectionRuns).values({
      id: historicalRunId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: siteId,
      source_connection_id: withSnapshot!.id,
      provider: "crawl",
      operation: "site_graph",
      method_version: "recovery.integration.v1",
      parameters_hash: HASH,
    });
    await handle.db.insert(dataSnapshots).values({
      id: historicalSnapshotId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: siteId,
      collection_run_id: historicalRunId,
      source_connection_id: withSnapshot!.id,
      provider: "crawl",
      dataset_key: "crawl.site_graph.v1",
      schema_version: "recovery.integration.v1",
      method_version: "recovery.integration.v1",
      captured_at: OLD,
      source_window: { start: null, end: null },
      availability: "available",
      limitation: "Historical crawl snapshot.",
      row_count: 1,
      checksum: HASH,
    });
    await new SourceConnectionsRepository(handle.db).setLastSnapshot(
      withSnapshot!.id,
      historicalSnapshotId,
      "syncing",
      "Crawl sync in progress.",
    );

    const [foreignProject] = await handle.db
      .insert(clientProjects)
      .values({
        workspace_id: scope.workspaceId,
        client_name: "Foreign recovery scope",
        project_name: "Foreign recovery scope",
        default_delivery_locale: "en",
        created_by: ACTOR_ID,
      })
      .returning();
    const foreignScope: ProjectScope = {
      workspaceId: scope.workspaceId,
      projectId: foreignProject!.id,
    };
    const [foreignSite] = await handle.db
      .insert(sites)
      .values({
        workspace_id: foreignScope.workspaceId,
        project_id: foreignScope.projectId,
        origin: "https://foreign-worker-recovery.example",
        host: "foreign-worker-recovery.example",
        market_codes: ["US"],
        language_codes: ["en"],
      })
      .returning();
    const [foreignSource] = await handle.db
      .insert(sourceConnections)
      .values({
        workspace_id: foreignScope.workspaceId,
        project_id: foreignScope.projectId,
        site_id: foreignSite!.id,
        provider: "crawl",
        connection_type: "public",
        state: "syncing",
        limitation: "Foreign source must not be changed.",
        connected_at: OLD,
        created_by: ACTOR_ID,
      })
      .returning();

    const recovering = await Promise.all([
      seedRun({
        status: "running",
        kind: "collection",
        requestPayload: {
          provider: "crawl",
          sourceConnectionId: withSnapshot!.id,
        },
      }),
      seedRun({
        status: "running",
        kind: "collection",
        requestPayload: {
          provider: "gsc",
          sourceConnectionId: withoutSnapshot!.id,
        },
      }),
      seedRun({
        status: "running",
        kind: "collection",
        requestPayload: {
          provider: "ga4",
          sourceConnectionId: alreadyAvailable!.id,
        },
      }),
      seedRun({
        status: "running",
        kind: "collection",
        requestPayload: {
          provider: "csv",
          sourceConnectionId: disconnected!.id,
        },
      }),
      seedRun({
        status: "running",
        kind: "collection",
        requestPayload: {
          provider: "crawl",
          sourceConnectionId: foreignSource!.id,
        },
      }),
    ]);

    await reconcileActiveRuns(ctx, {
      scope,
      now: NOW,
      missingAfterMs: 60 * 60 * 1_000,
    });

    for (const runId of recovering) {
      await expectRun(runId, "failed", "QUEUE_JOB_MISSING");
    }
    const sourcesRepo = new SourceConnectionsRepository(handle.db);
    await expect(
      sourcesRepo.findById(scope, withSnapshot!.id),
    ).resolves.toMatchObject({
      state: "stale",
      limitation: RECOVERY_LIMITATION,
      last_successful_snapshot_id: historicalSnapshotId,
    });
    await expect(
      sourcesRepo.findById(scope, withoutSnapshot!.id),
    ).resolves.toMatchObject({
      state: "unavailable",
      limitation: RECOVERY_LIMITATION,
      last_successful_snapshot_id: null,
    });
    await expect(
      sourcesRepo.findById(scope, alreadyAvailable!.id),
    ).resolves.toMatchObject({
      state: "available",
      limitation: "Newer GA4 snapshot is available.",
    });
    await expect(
      sourcesRepo.findById(scope, disconnected!.id),
    ).resolves.toMatchObject({
      state: "disconnected",
      limitation: "CSV source was disconnected.",
    });
    await expect(
      sourcesRepo.findById(foreignScope, foreignSource!.id),
    ).resolves.toMatchObject({
      state: "syncing",
      limitation: "Foreign source must not be changed.",
    });
  });

  it("terminalizes an accepted collection after archive without recovering its source projection", async () => {
    const [archivedWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Archived recovery ${randomUUID()}` })
      .returning();
    const [archivedProject] = await handle.db
      .insert(clientProjects)
      .values({
        workspace_id: archivedWorkspace!.id,
        client_name: "Archived recovery",
        project_name: "Archived recovery",
        default_delivery_locale: "en",
        stage: "collecting",
        created_by: ACTOR_ID,
      })
      .returning();
    const archivedScope: ProjectScope = {
      workspaceId: archivedWorkspace!.id,
      projectId: archivedProject!.id,
    };
    const archivedHost = `archived-recovery-${randomUUID()}.example`;
    const [archivedSite] = await handle.db
      .insert(sites)
      .values({
        workspace_id: archivedScope.workspaceId,
        project_id: archivedScope.projectId,
        origin: `https://${archivedHost}`,
        host: archivedHost,
        market_codes: ["US"],
        language_codes: ["en"],
      })
      .returning();
    const [archivedSource] = await handle.db
      .insert(sourceConnections)
      .values({
        workspace_id: archivedScope.workspaceId,
        project_id: archivedScope.projectId,
        site_id: archivedSite!.id,
        provider: "crawl",
        connection_type: "public",
        state: "syncing",
        limitation: "Accepted crawl is still running.",
        connected_at: OLD,
        created_by: ACTOR_ID,
      })
      .returning();
    const archivedRunId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: archivedRunId,
      workspace_id: archivedScope.workspaceId,
      project_id: archivedScope.projectId,
      kind: "collection",
      status: "running",
      active_key: `collect:crawl:${randomUUID()}`,
      request_payload: {
        provider: "crawl",
        sourceConnectionId: archivedSource!.id,
      },
      attempt_count: 1,
      initiated_by: ACTOR_ID,
      queued_at: OLD,
      started_at: OLD,
    });
    await handle.pool.query(
      `update app.client_projects
          set archived_at = now()
        where workspace_id = $1
          and id = $2`,
      [archivedScope.workspaceId, archivedScope.projectId],
    );
    const sourcesRepo = new SourceConnectionsRepository(handle.db);
    const sourceBefore = await sourcesRepo.findById(
      archivedScope,
      archivedSource!.id,
    );

    await reconcileActiveRuns(ctx, {
      scope: archivedScope,
      now: NOW,
      missingAfterMs: 60 * 60 * 1_000,
    });

    await expect(
      new AsyncRunsRepository(handle.db).findById(
        archivedScope,
        archivedRunId,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      last_error_code: "QUEUE_JOB_MISSING",
      completed_at: expect.any(String),
    });
    await expect(
      sourcesRepo.findById(archivedScope, archivedSource!.id),
    ).resolves.toEqual(sourceBefore);
  });

  it("releases the active-key slot after recovery commits the terminal state", async () => {
    const [slotWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Recovery active-key slot ${randomUUID()}` })
      .returning();
    let slotProjectId: string | undefined;

    try {
      const [slotProject] = await handle.db
        .insert(clientProjects)
        .values({
          workspace_id: slotWorkspace!.id,
          client_name: "Recovery active-key slot",
          project_name: "Recovery active-key slot",
          default_delivery_locale: "en",
          created_by: ACTOR_ID,
        })
        .returning();
      slotProjectId = slotProject!.id;
      const slotScope: ProjectScope = {
        workspaceId: slotWorkspace!.id,
        projectId: slotProjectId,
      };
      const recoveredRunId = randomUUID();
      const replacementRunId = randomUUID();
      const activeKey = `diagnostic:recovery-slot:${randomUUID()}`;
      await handle.db.insert(asyncRuns).values({
        id: recoveredRunId,
        workspace_id: slotScope.workspaceId,
        project_id: slotScope.projectId,
        kind: "diagnostic",
        status: "running",
        active_key: activeKey,
        contract_version: CONTRACT_VERSION,
        request_payload: {},
        attempt_count: 1,
        initiated_by: ACTOR_ID,
        queued_at: OLD,
        started_at: OLD,
      });

      await reconcileActiveRuns(ctx, {
        scope: slotScope,
        now: NOW,
        missingAfterMs: 60 * 60 * 1_000,
      });

      const repo = new AsyncRunsRepository(handle.db);
      await expect(
        repo.findById(slotScope, recoveredRunId),
      ).resolves.toMatchObject({
        kind: "diagnostic",
        status: "failed",
        active_key: activeKey,
        last_error_code: "QUEUE_JOB_MISSING",
        completed_at: expect.any(String),
      });

      const [replacement] = await handle.db
        .insert(asyncRuns)
        .values({
          id: replacementRunId,
          workspace_id: slotScope.workspaceId,
          project_id: slotScope.projectId,
          kind: "diagnostic",
          status: "queued",
          active_key: activeKey,
          contract_version: CONTRACT_VERSION,
          request_payload: {},
          initiated_by: ACTOR_ID,
          queued_at: NOW.toISOString(),
        })
        .returning();

      expect(replacement).toMatchObject({
        id: replacementRunId,
        workspace_id: slotScope.workspaceId,
        project_id: slotScope.projectId,
        kind: "diagnostic",
        status: "queued",
        active_key: activeKey,
      });
      await expect(repo.findActive(slotScope, activeKey)).resolves.toMatchObject({
        id: replacementRunId,
        status: "queued",
      });
    } finally {
      if (slotProjectId) {
        await handle.pool.query(
          `delete from app.async_runs
            where workspace_id = $1
              and project_id = $2`,
          [slotWorkspace!.id, slotProjectId],
        );
        await handle.pool.query(
          `delete from app.client_projects
            where workspace_id = $1
              and id = $2`,
          [slotWorkspace!.id, slotProjectId],
        );
      }
      await handle.pool.query(
        "delete from app.workspaces where id = $1",
        [slotWorkspace!.id],
      );
    }
  });

  it("pure-locks the active run before project/source so a same-key enqueue fails without deadlock", async () => {
    const [raceWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Recovery lock order ${randomUUID()}` })
      .returning();
    const [raceProject] = await handle.db
      .insert(clientProjects)
      .values({
        workspace_id: raceWorkspace!.id,
        client_name: "Recovery lock order",
        project_name: "Recovery lock order",
        default_delivery_locale: "en",
        created_by: ACTOR_ID,
      })
      .returning();
    const raceScope: ProjectScope = {
      workspaceId: raceWorkspace!.id,
      projectId: raceProject!.id,
    };
    const raceHost = `recovery-lock-${randomUUID()}.example`;
    const [raceSite] = await handle.db
      .insert(sites)
      .values({
        workspace_id: raceScope.workspaceId,
        project_id: raceScope.projectId,
        origin: `https://${raceHost}`,
        host: raceHost,
        market_codes: ["US"],
        language_codes: ["en"],
      })
      .returning();
    const [raceSource] = await handle.db
      .insert(sourceConnections)
      .values({
        workspace_id: raceScope.workspaceId,
        project_id: raceScope.projectId,
        site_id: raceSite!.id,
        provider: "crawl",
        connection_type: "public",
        state: "syncing",
        limitation: "Recovery lock-order fixture.",
        connected_at: OLD,
        created_by: ACTOR_ID,
      })
      .returning();
    const raceRunId = randomUUID();
    const activeKey = `collect:crawl:${randomUUID()}`;
    await handle.db.insert(asyncRuns).values({
      id: raceRunId,
      workspace_id: raceScope.workspaceId,
      project_id: raceScope.projectId,
      kind: "collection",
      status: "running",
      active_key: activeKey,
      request_payload: {
        provider: "crawl",
        sourceConnectionId: raceSource!.id,
      },
      attempt_count: 1,
      initiated_by: ACTOR_ID,
      queued_at: OLD,
      started_at: OLD,
    });

    const originalProjectLock = ProjectsRepository.prototype.findByIdForUpdate;
    let projectLockAttemptResolve!: () => void;
    const projectLockAttempt = new Promise<void>((resolve) => {
      projectLockAttemptResolve = resolve;
    });
    let releaseProjectLockResolve!: () => void;
    const releaseProjectLock = new Promise<void>((resolve) => {
      releaseProjectLockResolve = resolve;
    });
    const projectLockSpy = vi
      .spyOn(ProjectsRepository.prototype, "findByIdForUpdate")
      .mockImplementation(async function (
        this: ProjectsRepository,
        lookupScope,
        projectId,
      ) {
        if (projectId === raceScope.projectId) {
          projectLockAttemptResolve();
          await releaseProjectLock;
        }
        return originalProjectLock.call(this, lookupScope, projectId);
      });

    const enqueueClient = await handle.pool.connect();
    let enqueueTransactionOpen = false;
    let enqueueErrorCode: string | undefined;
    const recovery = reconcileActiveRuns(ctx, {
      scope: raceScope,
      now: NOW,
      missingAfterMs: 60 * 60 * 1_000,
    });
    try {
      await projectLockAttempt;
      await enqueueClient.query("begin");
      enqueueTransactionOpen = true;
      await enqueueClient.query(
        `select id
           from app.client_projects
          where workspace_id = $1
            and id = $2
          for update`,
        [raceScope.workspaceId, raceScope.projectId],
      );
      await enqueueClient.query(
        `select id
           from app.source_connections
          where workspace_id = $1
            and project_id = $2
            and id = $3
          for update`,
        [raceScope.workspaceId, raceScope.projectId, raceSource!.id],
      );
      releaseProjectLockResolve();
      try {
        await enqueueClient.query(
          `insert into app.async_runs (
             id, workspace_id, project_id, kind, status, active_key, initiated_by
           ) values ($1, $2, $3, 'collection', 'queued', $4, $5)`,
          [
            randomUUID(),
            raceScope.workspaceId,
            raceScope.projectId,
            activeKey,
            ACTOR_ID,
          ],
        );
      } catch (error) {
        enqueueErrorCode = (error as { code?: string }).code;
      }
      await enqueueClient.query("rollback");
      enqueueTransactionOpen = false;
      await recovery;
    } finally {
      releaseProjectLockResolve();
      if (enqueueTransactionOpen) {
        await enqueueClient.query("rollback").catch(() => undefined);
      }
      enqueueClient.release();
      projectLockSpy.mockRestore();
      await recovery.catch(() => undefined);
    }

    expect(enqueueErrorCode).toBe("23505");
    await expect(
      new AsyncRunsRepository(handle.db).findById(raceScope, raceRunId),
    ).resolves.toMatchObject({
      status: "failed",
      last_error_code: "QUEUE_JOB_MISSING",
    });
    await expect(
      new SourceConnectionsRepository(handle.db).findById(
        raceScope,
        raceSource!.id,
      ),
    ).resolves.toMatchObject({ state: "unavailable" });
  });

  it("redelivers domain work after a process dies immediately after claim", async () => {
    const runId = await seedRun({ status: "queued" });
    const firstDelivery = await fetchOwn(
      await send(runId, {
        retryLimit: 1,
        retryDelay: 0,
        retryBackoff: false,
      }),
    );
    const repo = new AsyncRunsRepository(handle.db);
    let domainExecutions = 0;
    const crash = new Error("simulated process death after claim");

    await expect(
      prepareRunDelivery(ctx, firstDelivery, async () => {
        expect(await repo.claim(scope, runId)).toMatchObject({ attempt_count: 1 });
        domainExecutions += 1;
        throw crash;
      }),
    ).rejects.toBe(crash);
    await expectRun(runId, "running", null);

    // pg-boss performs the public state transition that a failed/crashed
    // handler would receive from supervision, then delivers retry metadata.
    await boss.fail("diagnose", firstDelivery.id);
    const retryDelivery = await fetchOwn(runId);
    expect(retryDelivery.retryCount).toBe(1);

    await prepareRunDelivery(ctx, retryDelivery, async () => {
      const claimed = await repo.claim(scope, runId);
      expect(claimed).toMatchObject({ attempt_count: 2 });
      domainExecutions += 1;
      await repo.setTerminal(toRunAttempt(claimed!), {
        status: "completed",
        resultType: "diagnostic_run",
        resultId: runId,
      });
    });

    expect(domainExecutions).toBe(2);
    await expectRun(runId, "completed", null);
    expect(await repo.findById(scope, runId)).toMatchObject({
      attempt_count: 2,
      result_type: "diagnostic_run",
      result_id: runId,
    });
    await boss.complete("diagnose", retryDelivery.id);
  });

  async function send(
    runId: string,
    options: {
      retryLimit?: number;
      retryDelay?: number;
      retryBackoff?: boolean;
    } = {},
  ): Promise<string> {
    const id = await boss.send("diagnose", payload(runId), {
      id: runId,
      priority: ++priority,
      ...options,
    });
    expect(id).toBe(runId);
    return id!;
  }

  async function fetchOwn(
    expectedId: string,
  ): Promise<JobWithMetadata<RunJobPayload>> {
    const [job] = await boss.fetch<RunJobPayload>("diagnose", {
      batchSize: 1,
      includeMetadata: true,
    });
    expect(job?.id).toBe(expectedId);
    return job!;
  }

  async function fetchAtRetry(
    runId: string,
    retryCount: number,
  ): Promise<JobWithMetadata<RunJobPayload>> {
    await send(runId, {
      retryLimit: retryCount,
      retryDelay: 0,
      retryBackoff: false,
    });
    for (let current = 0; current <= retryCount; current += 1) {
      const job = await fetchOwn(runId);
      expect(job.retryCount).toBe(current);
      if (current === retryCount) return job;
      await boss.fail("diagnose", job.id);
    }
    throw new Error("unreachable retry fixture");
  }

  async function seedRun(input: {
    status: "queued" | "running";
    kind?: string;
    requestPayload?: Record<string, unknown>;
    queuedAt?: string;
    attemptCount?: number;
    contractVersion?: string;
  }): Promise<string> {
    const runId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: runId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: input.kind ?? "diagnostic",
      status: input.status,
      active_key: `${input.kind ?? "diagnostic"}:${runId}`,
      contract_version: input.contractVersion ?? CONTRACT_VERSION,
      request_payload: input.requestPayload ?? {},
      attempt_count:
        input.attemptCount ?? (input.status === "running" ? 1 : 0),
      initiated_by: ACTOR_ID,
      queued_at: input.queuedAt ?? OLD,
      ...(input.status === "running" ? { started_at: OLD } : {}),
    });
    return runId;
  }

  async function seedFrozenDiagnostic(
    runId: string,
    ruleSetVersion: string,
  ): Promise<void> {
    await handle.db.insert(diagnosticRuns).values({
      id: runId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: siteId,
      icp_profile_id: icpProfileId,
      icp_profile_version: 1,
      rule_set_version: ruleSetVersion,
      prompt_set_version: "mvp.prompts.0.2.0",
      output_locale: "en",
      input_manifest: {
        projectId: scope.projectId,
        siteId,
        icp: { id: icpProfileId, version: 1, contentHash: HASH },
        snapshots: [],
        ruleSetVersion,
        promptSetVersion: "mvp.prompts.0.2.0",
        deliveryLocale: "en",
      },
      input_hash: HASH,
    });
  }

  async function expectRun(
    runId: string,
    status: string,
    errorCode: string | null,
  ): Promise<void> {
    await expect(
      new AsyncRunsRepository(handle.db).findById(scope, runId),
    ).resolves.toMatchObject({
      status,
      last_error_code: errorCode,
    });
  }

  function payload(
    runId: string,
    contractVersion: string = CONTRACT_VERSION,
  ): RunJobPayload {
    return {
      runId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      contractVersion,
    };
  }
});
