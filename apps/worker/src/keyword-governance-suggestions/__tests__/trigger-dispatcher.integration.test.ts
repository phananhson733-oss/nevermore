import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  KeywordGovernanceScheduleRequestsRepository,
  ProjectsRepository,
  type ProjectScope,
} from "@sf/db";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import { runMigrations } from "../../../../../packages/db/src/migrate.ts";
import { requireSafeTestDatabaseUrl } from "../../../../../packages/db/src/test-database-safety.ts";
import {
  dispatchKeywordGovernanceScheduleRequest,
  runKeywordGovernanceSuggestionTriggerDispatcherSweep,
} from "../trigger-dispatcher.ts";

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

interface Fixture {
  readonly scope: ProjectScope;
  readonly actorId: string;
}

describeDb("Keyword governance durable trigger dispatcher", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    await runMigrations(databaseUrl);
    handle = createDbHandle(databaseUrl);
  });

  afterAll(async () => {
    await handle?.end();
  });

  function context(): WorkerContext {
    return {
      db: handle.db,
      boss: {} as never,
      logger,
    } as unknown as WorkerContext;
  }

  async function createFixture(label: string): Promise<Fixture> {
    const workspaceId = randomUUID();
    const actorId = randomUUID();
    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
      [workspaceId, `${label} ${workspaceId}`],
    );
    const project = await new ProjectsRepository(handle.db).insert({
      workspaceId,
      clientName: `${label} client`,
      projectName: `${label} project`,
      defaultDeliveryLocale: "en-US",
      createdBy: actorId,
    });
    return {
      scope: { workspaceId, projectId: project.id },
      actorId,
    };
  }

  async function drainPreexistingRequests(): Promise<void> {
    const ctx = context();
    for (;;) {
      const summary =
        await runKeywordGovernanceSuggestionTriggerDispatcherSweep(ctx, {
          limit: 100,
          schedule: async () => ({ kind: "no_candidates" }),
        });
      if (summary.claimedCount === 0) return;
    }
  }

  beforeEach(async () => {
    await drainPreexistingRequests();
  });

  it("completes an exact durable lease for a typed scheduler ACK", async () => {
    const fixture = await createFixture("dispatcher typed ACK");
    const recorded =
      await new KeywordGovernanceScheduleRequestsRepository(
        handle.db,
      ).insertRequest(fixture.scope, {
        sourceKind: "analysis_refresh",
        sourceRef: randomUUID(),
        initiatedBy: fixture.actorId,
      });
    const schedule = vi.fn(async () => ({
      kind: "authority_unavailable" as const,
    }));

    await expect(
      dispatchKeywordGovernanceScheduleRequest(
        context(),
        { scope: fixture.scope, requestId: recorded.request.id },
        { schedule },
      ),
    ).resolves.toEqual({ kind: "completed" });

    expect(schedule).toHaveBeenCalledOnce();
    await expect(
      new KeywordGovernanceScheduleRequestsRepository(handle.db).claimRequest(
        fixture.scope,
        { requestId: recorded.request.id, leaseSeconds: 30 },
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("lets two maintenance workers drain one bounded batch without duplicate scheduling", async () => {
    const fixture = await createFixture("dispatcher concurrent drain");
    const initiatedBy = Array.from({ length: 6 }, () => randomUUID());
    const requests = new KeywordGovernanceScheduleRequestsRepository(handle.db);
    for (const actorId of initiatedBy) {
      await requests.insertRequest(fixture.scope, {
        sourceKind: "csv_keyword_gap_import",
        sourceRef: randomUUID(),
        initiatedBy: actorId,
      });
    }
    const scheduledActors: string[] = [];
    const schedule = vi.fn(async (_context, input) => {
      scheduledActors.push(input.initiatedBy);
      await Promise.resolve();
      return { kind: "no_candidates" as const };
    });

    const summaries = await Promise.all([
      runKeywordGovernanceSuggestionTriggerDispatcherSweep(context(), {
        limit: 3,
        leaseSeconds: 30,
        schedule,
      }),
      runKeywordGovernanceSuggestionTriggerDispatcherSweep(context(), {
        limit: 3,
        leaseSeconds: 30,
        schedule,
      }),
    ]);

    expect(summaries.reduce((sum, item) => sum + item.claimedCount, 0)).toBe(6);
    expect(summaries.reduce((sum, item) => sum + item.completedCount, 0)).toBe(
      6,
    );
    expect(schedule).toHaveBeenCalledTimes(6);
    expect([...scheduledActors].sort()).toEqual([...initiatedBy].sort());
  });

  it("keeps a failed dispatch durable and lets maintenance retry after the DB-owned delay", async () => {
    const fixture = await createFixture("dispatcher retry");
    const recorded =
      await new KeywordGovernanceScheduleRequestsRepository(
        handle.db,
      ).insertRequest(fixture.scope, {
        sourceKind: "topic_model_confirmation_system",
        sourceRef: randomUUID(),
        initiatedBy: fixture.actorId,
      });
    const failure = new Error("queue unavailable");

    await expect(
      dispatchKeywordGovernanceScheduleRequest(
        context(),
        { scope: fixture.scope, requestId: recorded.request.id },
        {
          schedule: async () => {
            throw failure;
          },
        },
      ),
    ).rejects.toBe(failure);

    await vi.waitFor(
      async () => {
        const result = await handle.pool.query<{ due: boolean }>(
          `SELECT next_attempt_at <= clock_timestamp() AS due
             FROM app.keyword_governance_schedule_requests
            WHERE id = $1`,
          [recorded.request.id],
        );
        expect(result.rows[0]?.due).toBe(true);
      },
      { timeout: 5_000, interval: 50 },
    );

    const schedule = vi.fn(async () => ({ kind: "no_candidates" as const }));
    await expect(
      runKeywordGovernanceSuggestionTriggerDispatcherSweep(context(), {
        limit: 1,
        leaseSeconds: 30,
        schedule,
      }),
    ).resolves.toMatchObject({
      claimedCount: 1,
      completedCount: 1,
      releasedCount: 0,
    });
    expect(schedule).toHaveBeenCalledOnce();

    const stored = await handle.pool.query<{
      completed_at: Date | null;
      last_error_code: string | null;
      attempt_count: number;
    }>(
      `SELECT completed_at, last_error_code, attempt_count
         FROM app.keyword_governance_schedule_requests
        WHERE id = $1`,
      [recorded.request.id],
    );
    expect(stored.rows[0]).toMatchObject({
      completed_at: expect.any(Date),
      last_error_code: null,
      attempt_count: 2,
    });
  });
});
