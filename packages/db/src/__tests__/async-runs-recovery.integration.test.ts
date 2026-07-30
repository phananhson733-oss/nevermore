import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import { asyncRuns, clientProjects, workspaces } from "../schema.ts";
import {
  AsyncRunsRepository,
  toRunAttempt,
} from "../repositories/async-runs.ts";
import type { ProjectScope } from "../repositories/base.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const ACTOR_ID = randomUUID();

describeDb("async run delivery recovery", () => {
  let handle: DbHandle;
  let scope: ProjectScope;
  let foreignScope: ProjectScope;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Recovery ${randomUUID()}` })
      .returning();
    const [project, foreignProject] = await handle.db
      .insert(clientProjects)
      .values([
        {
          workspace_id: workspace!.id,
          client_name: "Recovery",
          project_name: "Recovery",
          default_delivery_locale: "en",
          created_by: ACTOR_ID,
        },
        {
          workspace_id: workspace!.id,
          client_name: "Foreign",
          project_name: "Foreign",
          default_delivery_locale: "en",
          created_by: ACTOR_ID,
        },
      ])
      .returning();
    scope = { workspaceId: workspace!.id, projectId: project!.id };
    foreignScope = {
      workspaceId: workspace!.id,
      projectId: foreignProject!.id,
    };
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("allows an initial queued delivery but never steals its active first attempt", async () => {
    const runId = await seedRun(handle, scope, {
      status: "queued",
      attemptCount: 0,
    });
    const repo = new AsyncRunsRepository(handle.db);

    expect(await repo.prepareDelivery(scope, runId, 0)).toMatchObject({
      status: "queued",
      attempt_count: 0,
    });
    expect(await repo.claim(scope, runId)).toMatchObject({
      status: "running",
      attempt_count: 1,
    });
    await expect(repo.prepareDelivery(scope, runId, 0)).resolves.toBeNull();
    expect(await repo.findById(scope, runId)).toMatchObject({
      status: "running",
      attempt_count: 1,
    });
  });

  it("lets exactly one real retry reclaim a crashed attempt and rejects stale retry metadata", async () => {
    const runId = await seedRun(handle, scope, {
      status: "running",
      attemptCount: 1,
    });
    const repo = new AsyncRunsRepository(handle.db);
    const deliver = async () => {
      const prepared = await repo.prepareDelivery(scope, runId, 1);
      return prepared ? repo.claim(scope, runId) : null;
    };

    const deliveries = await Promise.all([deliver(), deliver()]);
    expect(deliveries.filter(Boolean)).toHaveLength(1);
    expect(await repo.findById(scope, runId)).toMatchObject({
      status: "running",
      attempt_count: 2,
    });

    // A delayed retryCount=1 delivery belongs to attempt 1 and cannot reset or
    // claim the already-running attempt 2.
    await expect(repo.prepareDelivery(scope, runId, 1)).resolves.toBeNull();
    expect(await repo.findById(scope, runId)).toMatchObject({
      status: "running",
      attempt_count: 2,
    });
  });

  it("enforces workspace/project scope in the same atomic preparation", async () => {
    const runId = await seedRun(handle, scope, {
      status: "running",
      attemptCount: 1,
    });
    const repo = new AsyncRunsRepository(handle.db);

    await expect(
      repo.prepareDelivery(foreignScope, runId, 1),
    ).resolves.toBeNull();
    expect(await repo.findById(scope, runId)).toMatchObject({
      status: "running",
      attempt_count: 1,
    });
  });

  it("fences a live stale attempt after a retry claims the next epoch", async () => {
    const runId = await seedRun(handle, scope, {
      status: "queued",
      attemptCount: 0,
    });
    const repo = new AsyncRunsRepository(handle.db);
    const claimed1 = await repo.claim(scope, runId);
    expect(claimed1).not.toBeNull();
    const attempt1 = toRunAttempt(claimed1!);

    expect(await repo.prepareDelivery(scope, runId, 1)).not.toBeNull();
    const claimed2 = await repo.claim(scope, runId);
    expect(claimed2).not.toBeNull();
    const attempt2 = toRunAttempt(claimed2!);
    expect(attempt2.attemptCount).toBe(2);

    await expect(
      repo.setProgress(attempt1, {
        phase: "stale",
        current: 99,
        total: 100,
      }),
    ).resolves.toBe(false);
    await expect(repo.resetToQueued(attempt1)).resolves.toBe(false);
    await expect(
      repo.setTerminal(attempt1, {
        status: "failed",
        lastErrorCode: "STALE_ATTEMPT",
        lastErrorSummary: "The expired attempt resumed.",
      }),
    ).resolves.toBe(false);

    await expect(
      repo.setProgress(attempt2, {
        phase: "persisting",
        current: 1,
        total: 1,
      }),
    ).resolves.toBe(true);
    await expect(
      repo.setTerminal(attempt2, {
        status: "completed",
        resultType: "diagnostic_run",
        resultId: runId,
      }),
    ).resolves.toBe(true);

    // A remains alive after B commits, but its epoch can no longer alter the
    // canonical result or move a terminal row back into an active state.
    await expect(repo.resetToQueued(attempt1)).resolves.toBe(false);
    await expect(
      repo.setTerminal(attempt1, {
        status: "cancelled",
        lastErrorCode: "STALE_ATTEMPT",
        lastErrorSummary: "The expired attempt resumed after completion.",
      }),
    ).resolves.toBe(false);
    expect(await repo.findById(scope, runId)).toMatchObject({
      status: "completed",
      attempt_count: 2,
      progress: { phase: "persisting", current: 1, total: 1 },
      result_type: "diagnostic_run",
      result_id: runId,
      last_error_code: null,
    });
  });

  it("projects bounded global queue metrics without payloads or identifiers", async () => {
    await seedRun(handle, scope, {
      status: "queued",
      attemptCount: 0,
    });

    const metrics = await new AsyncRunsRepository(handle.db).technicalMetrics();

    expect(metrics.map(({ kind }) => kind)).toEqual([
      "analysis_refresh",
      "artifact_generation",
      "collection",
      "content_shadow",
      "diagnostic",
      "export",
      "measurement",
      "product_profile_synthesis",
      "publication",
    ]);
    expect(metrics.find(({ kind }) => kind === "diagnostic")).toMatchObject({
      queuedDepth: expect.any(Number),
      runningDepth: expect.any(Number),
      oldestQueuedAgeMs: expect.any(Number),
      averageRunDurationMs24h: expect.any(Number),
      maxRunDurationMs24h: expect.any(Number),
      retryCount24h: expect.any(Number),
      failureCount24h: expect.any(Number),
    });
    expect(
      metrics.find(({ kind }) => kind === "diagnostic")!.queuedDepth,
    ).toBeGreaterThanOrEqual(1);
    for (const metric of metrics) {
      expect(Object.keys(metric).sort()).toEqual([
        "averageRunDurationMs24h",
        "failureCount24h",
        "kind",
        "maxRunDurationMs24h",
        "oldestQueuedAgeMs",
        "queuedDepth",
        "retryCount24h",
        "runningDepth",
      ]);
      for (const value of Object.values(metric).filter(
        (candidate): candidate is number => typeof candidate === "number",
      )) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("rejects a direct terminal-to-different-terminal database transition", async () => {
    const runId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: runId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "completed",
      active_key: `diagnostic:${runId}`,
      request_payload: {},
      attempt_count: 1,
      initiated_by: ACTOR_ID,
      started_at: "2026-07-18T00:00:00.000Z",
      completed_at: "2026-07-18T00:01:00.000Z",
    });

    await expect(
      handle.db
        .update(asyncRuns)
        .set({
          status: "failed",
          last_error_code: "LATE_FAILURE",
          last_error_summary: "A stale worker tried to replace completion.",
        })
        .where(eq(asyncRuns.id, runId)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    expect(
      await new AsyncRunsRepository(handle.db).findById(scope, runId),
    ).toMatchObject({
      status: "completed",
      last_error_code: null,
    });

    // The final DB invariant rejects only a status change. A same-terminal
    // idempotent acknowledgement remains legal for operational SQL tooling.
    await expect(
      handle.db
        .update(asyncRuns)
        .set({
          status: "completed",
          progress: {
            phase: "completed",
            current: 1,
            total: 1,
            messageKey: "run.completed",
          },
        })
        .where(eq(asyncRuns.id, runId)),
    ).resolves.toBeDefined();
  });
});

async function seedRun(
  handle: DbHandle,
  scope: ProjectScope,
  input: {
    readonly status: "queued" | "running";
    readonly attemptCount: number;
  },
): Promise<string> {
  const runId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "diagnostic",
    status: input.status,
    active_key: `diagnostic:${runId}`,
    request_payload: {},
    attempt_count: input.attemptCount,
    initiated_by: ACTOR_ID,
    ...(input.status === "running"
      ? { started_at: "2026-07-18T00:00:00.000Z" }
      : {}),
  });
  return runId;
}
