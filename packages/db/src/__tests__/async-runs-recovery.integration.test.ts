import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import { asyncRuns, clientProjects, workspaces } from "../schema.ts";
import { AsyncRunsRepository } from "../repositories/async-runs.ts";
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
    expect(await repo.claim(runId)).toMatchObject({
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
      return prepared ? repo.claim(runId) : null;
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
});

async function seedRun(
  handle: DbHandle,
  scope: ProjectScope,
  input: { readonly status: "queued" | "running"; readonly attemptCount: number },
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
