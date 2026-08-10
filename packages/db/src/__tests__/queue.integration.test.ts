import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import {
  createBoss,
  enqueueRunInTx,
  PGBOSS_SCHEMA,
  PgBoss,
  QUEUE_CONFIG,
  startBoss,
} from "../queue.ts";
import { asyncRuns, clientProjects, workspaces } from "../schema.ts";
import { APP_TABLES } from "../../../../scripts/backup-restore-drill.mjs";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("queue + atomic enqueue (AC-004, AC-006)", () => {
  let handle: DbHandle;
  let boss: PgBoss;
  let workspaceId: string;
  let projectId: string;
  const actor = randomUUID();

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
    boss = createBoss(DATABASE_URL!);
    await startBoss(boss);

    const [ws] = await handle.db
      .insert(workspaces)
      .values({ name: "Queue test ws" })
      .returning();
    workspaceId = ws!.id;
    const [proj] = await handle.db
      .insert(clientProjects)
      .values({
        workspace_id: workspaceId,
        client_name: "Queue test client",
        project_name: "Queue test project",
        default_delivery_locale: "en",
        created_by: actor,
      })
      .returning();
    projectId = proj!.id;
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false }).catch(() => {});
    await handle?.end();
  });

  const jobsForRun = (runId: string) =>
    boss.findJobs<{ runId: string }>("diagnose", { data: { runId } });
  const countRuns = async (runId: string): Promise<number> => {
    const res = await handle.pool.query<{ c: string }>(
      `SELECT count(*)::int AS c FROM app.async_runs WHERE id = $1`,
      [runId],
    );
    return Number(res.rows[0]?.c ?? 0);
  };

  it("AC-004: pg-boss owns a separate schema; app matches the authority inventory", async () => {
    const pgbossSchema = await handle.pool.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [PGBOSS_SCHEMA],
    );
    expect(pgbossSchema.rowCount).toBe(1);

    const appTables = await handle.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'app' AND table_type = 'BASE TABLE'`,
    );
    expect(APP_TABLES).toHaveLength(83);
    expect(appTables.rows.map((row) => row.table_name).sort()).toEqual(
      [...APP_TABLES].sort(),
    );

    // No pgboss table leaked into the app schema.
    const leaked = await handle.pool.query<{ c: string }>(
      `SELECT count(*)::int AS c FROM information_schema.tables
       WHERE table_schema = 'app' AND table_name LIKE '%job%'`,
    );
    expect(Number(leaked.rows[0]!.c)).toBe(0);

    const queue = await boss.getQueue("diagnose");
    expect(queue?.heartbeatSeconds).toBe(
      QUEUE_CONFIG.diagnose.heartbeatSeconds,
    );
  });

  it("registers the bounded Keyword governance suggestion queue in pg-boss", async () => {
    const keywordSuggestionQueue = await boss.getQueue(
      "keyword-governance-suggestion.generate",
    );
    expect(keywordSuggestionQueue?.expireInSeconds).toBe(
      QUEUE_CONFIG["keyword-governance-suggestion.generate"].expireInSeconds,
    );
    expect(keywordSuggestionQueue?.retryLimit).toBe(
      QUEUE_CONFIG["keyword-governance-suggestion.generate"].retryLimit,
    );
  });

  it("AC-006 (commit): run row and its job are both persisted", async () => {
    const runId = randomUUID();
    let jobId: string | null = null;
    await handle.db.transaction(async (tx) => {
      await tx.insert(asyncRuns).values({
        id: runId,
        workspace_id: workspaceId,
        project_id: projectId,
        kind: "diagnostic",
        active_key: `diagnostic:${runId}`,
        initiated_by: actor,
      });
      jobId = await enqueueRunInTx(boss, tx, "diagnose", {
        runId,
        workspaceId,
        projectId,
        contractVersion: "2026-07-18",
      });
    });

    expect(await countRuns(runId)).toBe(1);
    expect(jobId).toBe(runId);
    const direct = await boss.getJobById<{ runId: string }>("diagnose", runId);
    expect(direct?.data.runId).toBe(runId);
    expect(await jobsForRun(runId)).toHaveLength(1);
  });

  it("AC-006 (rollback): a failure after enqueue leaves neither run nor job", async () => {
    const runId = randomUUID();
    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(asyncRuns).values({
          id: runId,
          workspace_id: workspaceId,
          project_id: projectId,
          kind: "diagnostic",
          active_key: `diagnostic:${runId}`,
          initiated_by: actor,
        });
        await enqueueRunInTx(boss, tx, "diagnose", {
          runId,
          workspaceId,
          projectId,
          contractVersion: "2026-07-18",
        });
        throw new Error("forced failure after enqueue");
      }),
    ).rejects.toThrow("forced failure after enqueue");

    // Neither a queued-without-run nor a run-without-job may exist.
    expect(await countRuns(runId)).toBe(0);
    expect(await boss.getJobById("diagnose", runId)).toBeNull();
    expect(await jobsForRun(runId)).toHaveLength(0);
  });

  it("rolls the canonical transaction back when the explicit job id is rejected", async () => {
    const runId = randomUUID();
    await boss.send(
      "diagnose",
      { runId, workspaceId, projectId, contractVersion: "2026-07-18" },
      { id: runId },
    );

    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(asyncRuns).values({
          id: runId,
          workspace_id: workspaceId,
          project_id: projectId,
          kind: "diagnostic",
          active_key: `diagnostic:${runId}`,
          initiated_by: actor,
        });
        await enqueueRunInTx(boss, tx, "diagnose", {
          runId,
          workspaceId,
          projectId,
          contractVersion: "2026-07-18",
        });
      }),
    ).rejects.toThrow(/explicit run job id/i);

    expect(await countRuns(runId)).toBe(0);
    expect(await jobsForRun(runId)).toHaveLength(1);
  });
});
