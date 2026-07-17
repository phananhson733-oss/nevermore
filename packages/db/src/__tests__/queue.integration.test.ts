import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import {
  createBoss,
  enqueueRunInTx,
  PGBOSS_SCHEMA,
  PgBoss,
  startBoss,
} from "../queue.ts";
import { asyncRuns, clientProjects, workspaces } from "../schema.ts";

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

  const countJobs = async (runId: string): Promise<number> => {
    const res = await handle.pool.query<{ c: string }>(
      `SELECT count(*)::int AS c FROM ${PGBOSS_SCHEMA}.job WHERE data->>'runId' = $1`,
      [runId],
    );
    return Number(res.rows[0]?.c ?? 0);
  };
  const countRuns = async (runId: string): Promise<number> => {
    const res = await handle.pool.query<{ c: string }>(
      `SELECT count(*)::int AS c FROM app.async_runs WHERE id = $1`,
      [runId],
    );
    return Number(res.rows[0]?.c ?? 0);
  };

  it("AC-004: pg-boss owns a separate schema; app still has exactly 28 tables", async () => {
    const pgbossSchema = await handle.pool.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [PGBOSS_SCHEMA],
    );
    expect(pgbossSchema.rowCount).toBe(1);

    const appTables = await handle.pool.query<{ c: string }>(
      `SELECT count(*)::int AS c FROM information_schema.tables
       WHERE table_schema = 'app' AND table_type = 'BASE TABLE'`,
    );
    expect(Number(appTables.rows[0]!.c)).toBe(28);

    // No pgboss table leaked into the app schema.
    const leaked = await handle.pool.query<{ c: string }>(
      `SELECT count(*)::int AS c FROM information_schema.tables
       WHERE table_schema = 'app' AND table_name LIKE '%job%'`,
    );
    expect(Number(leaked.rows[0]!.c)).toBe(0);
  });

  it("AC-006 (commit): run row and its job are both persisted", async () => {
    const runId = randomUUID();
    await handle.db.transaction(async (tx) => {
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
        contractVersion: "0.2.0",
      });
    });

    expect(await countRuns(runId)).toBe(1);
    expect(await countJobs(runId)).toBe(1);
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
          contractVersion: "0.2.0",
        });
        throw new Error("forced failure after enqueue");
      }),
    ).rejects.toThrow("forced failure after enqueue");

    // Neither a queued-without-run nor a run-without-job may exist.
    expect(await countRuns(runId)).toBe(0);
    expect(await countJobs(runId)).toBe(0);
  });
});
