import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AsyncRunsRepository,
  createBoss,
  createDbHandle,
  startBoss,
  type DbHandle,
  type JobWithMetadata,
  type PgBoss,
  type ProjectScope,
  type RunJobPayload,
} from "@sf/db";
import { asyncRuns, clientProjects, workspaces } from "@sf/db/schema";
import type { Logger } from "@sf/observability";
import { runMigrations } from "../../../../packages/db/src/migrate.ts";
import type { WorkerContext } from "../context.ts";
import { prepareRunDelivery, reconcileActiveRuns } from "./recovery.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const ACTOR_ID = randomUUID();
const NOW = new Date("2026-07-19T12:00:00.000Z");
const OLD = "2026-07-19T08:00:00.000Z";

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
  let ctx: WorkerContext;
  let priority = 10_000;

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
    ctx = {
      db: handle.db,
      boss,
      blobStore: {} as WorkerContext["blobStore"],
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "test", clientSecret: "test" },
      openai: { apiKey: "test", model: "test" },
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

    const legacyCompleted = await seedRun({ status: "running" });
    const legacyJobId = await boss.send(
      "diagnose",
      payload(legacyCompleted),
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
      requestPayload: { provider: "dataforseo" },
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
        expect(await repo.claim(transientRun)).toMatchObject({
          attempt_count: 3,
        });
        await repo.resetToQueued(transientRun);
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
        expect(await repo.claim(permanentRun)).not.toBeNull();
        await repo.setTerminal(permanentRun, {
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
        expect(await repo.claim(runId)).toMatchObject({ attempt_count: 1 });
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
      expect(await repo.claim(runId)).toMatchObject({ attempt_count: 2 });
      domainExecutions += 1;
      await repo.setTerminal(runId, {
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
  }): Promise<string> {
    const runId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: runId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: input.kind ?? "diagnostic",
      status: input.status,
      active_key: `${input.kind ?? "diagnostic"}:${runId}`,
      request_payload: input.requestPayload ?? {},
      attempt_count:
        input.attemptCount ?? (input.status === "running" ? 1 : 0),
      initiated_by: ACTOR_ID,
      queued_at: input.queuedAt ?? OLD,
      ...(input.status === "running" ? { started_at: OLD } : {}),
    });
    return runId;
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

  function payload(runId: string): RunJobPayload {
    return {
      runId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      contractVersion: "0.2.0",
    };
  }
});
