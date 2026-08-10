import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import {
  KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
  KEYWORD_GOVERNANCE_SCHEDULE_REQUEST_SOURCE_KINDS,
  KeywordGovernanceScheduleRequestsRepository,
  type ProjectScope,
} from "../index.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

interface Fixture {
  readonly scope: ProjectScope;
  readonly foreignScope: ProjectScope;
  readonly actorId: string;
}

function pgFailure(error: unknown): {
  readonly code?: string;
  readonly constraint?: string;
} | null {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const candidate = current as {
      readonly code?: unknown;
      readonly constraint?: unknown;
      readonly cause?: unknown;
    };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint === "string"
          ? { constraint: candidate.constraint }
          : {}),
      };
    }
    current = candidate.cause;
  }
  return null;
}

async function rejectedPg(
  promise: Promise<unknown>,
): Promise<{ readonly code?: string; readonly constraint?: string } | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return pgFailure(error);
  }
}

function terminalProgress(
  disposition: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion:
      "keyword-governance-suggestion-generation-outcome.v1",
    candidateCount: 1,
    suggestionCount: 0,
    limitations: [],
    terminalDisposition: disposition,
    ...overrides,
  };
}

describeDb("Keyword governance durable schedule requests", () => {
  let handle: DbHandle;
  let fixture: Fixture;

  beforeAll(async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    await runMigrations(databaseUrl);
    handle = createDbHandle(databaseUrl);
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const foreignProjectId = randomUUID();
    const actorId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.workspaces(id, name)
       VALUES ($1::uuid, 'Schedule request integration')`,
      [workspaceId],
    );
    await handle.pool.query(
      `INSERT INTO app.client_projects(
         id, workspace_id, client_name, project_name,
         default_delivery_locale, created_by
       ) VALUES
         ($1::uuid, $2::uuid, 'Schedule client', 'Schedule project',
          'en-US', $4::uuid),
         ($3::uuid, $2::uuid, 'Foreign client', 'Foreign project',
          'en-US', $4::uuid)`,
      [projectId, workspaceId, foreignProjectId, actorId],
    );
    fixture = {
      scope: { workspaceId, projectId },
      foreignScope: { workspaceId, projectId: foreignProjectId },
      actorId,
    };
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("installs the 0052 table, fixed-code schema, trigger, and atomic routines", async () => {
    const result = await handle.pool.query<{
      table_name: string | null;
      insert_routine: string | null;
      claim_routine: string | null;
      claim_source_routine: string | null;
      claim_due_routine: string | null;
      complete_routine: string | null;
      release_routine: string | null;
      stale_routine: string | null;
      continuation_trigger: string | null;
      raw_column_count: string;
      claim_due_definition: string;
    }>(
      `SELECT
         to_regclass('app.keyword_governance_schedule_requests')::text
           AS table_name,
         to_regprocedure(
           'app.insert_keyword_governance_schedule_request(uuid,uuid,text,text,uuid)'
         )::text AS insert_routine,
         to_regprocedure(
           'app.claim_keyword_governance_schedule_request(uuid,uuid,uuid,integer)'
         )::text AS claim_routine,
         to_regprocedure(
           'app.claim_keyword_governance_schedule_request_by_source(uuid,uuid,text,text,integer)'
         )::text AS claim_source_routine,
         to_regprocedure(
           'app.claim_due_keyword_governance_schedule_requests(integer,integer)'
         )::text AS claim_due_routine,
         to_regprocedure(
           'app.complete_keyword_governance_schedule_request(uuid,uuid,uuid,uuid)'
         )::text AS complete_routine,
         to_regprocedure(
           'app.release_keyword_governance_schedule_request(uuid,uuid,uuid,uuid,text)'
         )::text AS release_routine,
         to_regprocedure(
           'app.supersede_stale_pending_keyword_review_suggestions(uuid,uuid)'
         )::text AS stale_routine,
         (
           SELECT trigger_name
           FROM information_schema.triggers
           WHERE event_object_schema = 'app'
             AND event_object_table = 'async_runs'
             AND trigger_name =
               'keyword_governance_generation_continuation_schedule'
         ) AS continuation_trigger,
         (
           SELECT count(*)::text
           FROM information_schema.columns
           WHERE table_schema = 'app'
             AND table_name = 'keyword_governance_schedule_requests'
             AND column_name ~ '(raw|payload|summary|message)'
         ) AS raw_column_count,
         pg_get_functiondef(
           'app.claim_due_keyword_governance_schedule_requests(integer,integer)'::regprocedure
         ) AS claim_due_definition`,
    );

    expect(result.rows[0]).toMatchObject({
      table_name: "app.keyword_governance_schedule_requests",
      insert_routine:
        "app.insert_keyword_governance_schedule_request(uuid,uuid,text,text,uuid)",
      claim_routine:
        "app.claim_keyword_governance_schedule_request(uuid,uuid,uuid,integer)",
      claim_source_routine:
        "app.claim_keyword_governance_schedule_request_by_source(uuid,uuid,text,text,integer)",
      claim_due_routine:
        "app.claim_due_keyword_governance_schedule_requests(integer,integer)",
      complete_routine:
        "app.complete_keyword_governance_schedule_request(uuid,uuid,uuid,uuid)",
      release_routine:
        "app.release_keyword_governance_schedule_request(uuid,uuid,uuid,uuid,text)",
      stale_routine:
        "app.supersede_stale_pending_keyword_review_suggestions(uuid,uuid)",
      continuation_trigger:
        "keyword_governance_generation_continuation_schedule",
      raw_column_count: "0",
    });
    expect(result.rows[0]?.claim_due_definition).toMatch(
      /FOR UPDATE SKIP LOCKED/iu,
    );
  });

  it("appends every closed source kind once and rejects conflicting replays", async () => {
    const repo = new KeywordGovernanceScheduleRequestsRepository(handle.db);
    const inserted = [];
    for (const [ordinal, sourceKind] of
      KEYWORD_GOVERNANCE_SCHEDULE_REQUEST_SOURCE_KINDS.entries()) {
      const input = {
        sourceKind,
        sourceRef: `source-${ordinal + 1}`,
        initiatedBy: fixture.actorId,
      };
      const first = await repo.insertRequest(fixture.scope, input);
      const replay = await repo.insertRequest(fixture.scope, input);
      expect(first.kind).toBe("inserted");
      expect(replay).toEqual({ kind: "existing", request: first.request });
      expect(first.request.dispatchKey).toBe(
        `keyword-governance-schedule.v1:${fixture.scope.workspaceId}:` +
          `${fixture.scope.projectId}:${sourceKind}:${input.sourceRef}`,
      );
      inserted.push(first.request);
    }
    expect(new Set(inserted.map((request) => request.id))).toHaveLength(5);

    const concurrentInput = {
      sourceKind: "analysis_refresh" as const,
      sourceRef: "concurrent-source",
      initiatedBy: fixture.actorId,
    };
    const concurrent = await Promise.all([
      repo.insertRequest(fixture.scope, concurrentInput),
      repo.insertRequest(fixture.scope, concurrentInput),
    ]);
    expect(concurrent.map((result) => result.kind).sort()).toEqual([
      "existing",
      "inserted",
    ]);
    expect(concurrent[0]?.request.id).toBe(concurrent[1]?.request.id);

    const actorConflict = await rejectedPg(repo.insertRequest(fixture.scope, {
      ...concurrentInput,
      initiatedBy: randomUUID(),
    }));
    expect(actorConflict).toEqual({
      code: "23514",
      constraint:
        "keyword_governance_schedule_requests_dispatch_replay_ck",
    });
    const invalidKind = await rejectedPg(handle.pool.query(
      `SELECT app.insert_keyword_governance_schedule_request(
         $1::uuid, $2::uuid, 'other', 'source', $3::uuid
       )`,
      [
        fixture.scope.workspaceId,
        fixture.scope.projectId,
        fixture.actorId,
      ],
    ));
    expect(invalidKind?.code).toBe("23514");
  });

  it("claims bounded rows with SKIP LOCKED and enforces lease-token CAS", async () => {
    const repo = new KeywordGovernanceScheduleRequestsRepository(handle.db);
    const lockedClient = await handle.pool.connect();
    let locked: { readonly id: string; readonly claimToken: string }[] = [];
    try {
      await lockedClient.query("BEGIN");
      const firstClaim = await lockedClient.query<{
        result: { readonly id: string; readonly claim_token: string }[];
      }>(
        `SELECT app.claim_due_keyword_governance_schedule_requests(2, 60)
           AS result`,
      );
      locked = (firstClaim.rows[0]?.result ?? []).map((request) => ({
        id: request.id,
        claimToken: request.claim_token,
      }));
      expect(locked).toHaveLength(2);

      const remaining = await repo.claimDue({ limit: 100, leaseSeconds: 60 });
      expect(remaining).toHaveLength(4);
      expect(new Set([
        ...locked.map((request) => request.id),
        ...remaining.map((request) => request.id),
      ])).toHaveLength(6);
      expect(await repo.claimRequest(fixture.foreignScope, {
        requestId: remaining[0]!.id,
        leaseSeconds: 60,
      })).toEqual({ kind: "unavailable" });
      expect(await repo.claimRequest(fixture.scope, {
        requestId: remaining[0]!.id,
        leaseSeconds: 60,
      })).toEqual({ kind: "unavailable" });
      expect(await repo.complete(fixture.scope, {
        requestId: remaining[0]!.id,
        claimToken: randomUUID(),
      })).toEqual({ kind: "stale" });
      expect(await repo.release(fixture.scope, {
        requestId: remaining[0]!.id,
        claimToken: randomUUID(),
        errorCode: KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
      })).toEqual({ kind: "stale" });
      for (const request of remaining) {
        await expect(repo.complete(fixture.scope, {
          requestId: request.id,
          claimToken: request.claimToken,
        })).resolves.toMatchObject({ kind: "completed" });
      }
      await lockedClient.query("COMMIT");
    } catch (error) {
      await lockedClient.query("ROLLBACK");
      throw error;
    } finally {
      lockedClient.release();
    }

    for (const request of locked) {
      const completed = await repo.complete(fixture.scope, {
        requestId: request.id,
        claimToken: request.claimToken,
      });
      expect(completed.kind).toBe("completed");
      await expect(repo.complete(fixture.scope, {
        requestId: request.id,
        claimToken: request.claimToken,
      })).resolves.toEqual(completed);
    }

    const terminalId = locked[0]!.id;
    expect((await rejectedPg(handle.pool.query(
      `UPDATE app.keyword_governance_schedule_requests
       SET next_attempt_at = clock_timestamp() + interval '1 day'
       WHERE id = $1::uuid`,
      [terminalId],
    )))?.constraint).toBe(
      "keyword_governance_schedule_requests_terminal_ck",
    );
    expect((await rejectedPg(handle.pool.query(
      `DELETE FROM app.keyword_governance_schedule_requests
       WHERE id = $1::uuid`,
      [terminalId],
    )))?.constraint).toBe(
      "keyword_governance_schedule_requests_immutable_ck",
    );

    const releasedSource = `release-${randomUUID()}`;
    const releasedInsert = await repo.insertRequest(fixture.scope, {
      sourceKind: "analysis_refresh",
      sourceRef: releasedSource,
      initiatedBy: fixture.actorId,
    });
    const releasedClaim = await repo.claimBySource(fixture.scope, {
      sourceKind: "analysis_refresh",
      sourceRef: releasedSource,
      leaseSeconds: 60,
    });
    expect(releasedClaim.kind).toBe("claimed");
    if (releasedClaim.kind !== "claimed") throw new Error("claim missing");
    const released = await repo.release(fixture.scope, {
      requestId: releasedInsert.request.id,
      claimToken: releasedClaim.request.claimToken,
      errorCode: KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
    });
    expect(released).toMatchObject({
      kind: "released",
      request: {
        attemptCount: 1,
        claimToken: null,
        lastErrorCode: KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
      },
    });
    await expect(repo.claimBySource(fixture.scope, {
      sourceKind: "analysis_refresh",
      sourceRef: releasedSource,
      leaseSeconds: 60,
    })).resolves.toEqual({ kind: "unavailable" });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const releaseRetry = await repo.claimBySource(fixture.scope, {
      sourceKind: "analysis_refresh",
      sourceRef: releasedSource,
      leaseSeconds: 60,
    });
    expect(releaseRetry).toMatchObject({
      kind: "claimed",
      request: { attemptCount: 2 },
    });
    if (releaseRetry.kind !== "claimed") throw new Error("retry missing");
    expect(releaseRetry.request.claimToken).not.toBe(
      releasedClaim.request.claimToken,
    );
    await repo.complete(fixture.scope, {
      requestId: releaseRetry.request.id,
      claimToken: releaseRetry.request.claimToken,
    });

    const expiringSource = `expiry-${randomUUID()}`;
    const expiringInsert = await repo.insertRequest(fixture.scope, {
      sourceKind: "csv_keyword_gap_import",
      sourceRef: expiringSource,
      initiatedBy: fixture.actorId,
    });
    const expiringClaim = await repo.claimBySource(fixture.scope, {
      sourceKind: "csv_keyword_gap_import",
      sourceRef: expiringSource,
      leaseSeconds: 5,
    });
    if (expiringClaim.kind !== "claimed") throw new Error("claim missing");
    await new Promise((resolve) => setTimeout(resolve, 5_100));
    await expect(repo.complete(fixture.scope, {
      requestId: expiringInsert.request.id,
      claimToken: expiringClaim.request.claimToken,
    })).resolves.toEqual({ kind: "stale" });
    await expect(repo.release(fixture.scope, {
      requestId: expiringInsert.request.id,
      claimToken: expiringClaim.request.claimToken,
      errorCode: KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED,
    })).resolves.toEqual({ kind: "stale" });
    const reclaimed = await repo.claimBySource(fixture.scope, {
      sourceKind: "csv_keyword_gap_import",
      sourceRef: expiringSource,
      leaseSeconds: 60,
    });
    expect(reclaimed).toMatchObject({
      kind: "claimed",
      request: { attemptCount: 2 },
    });
    if (reclaimed.kind !== "claimed") throw new Error("reclaim missing");
    expect(reclaimed.request.claimToken).not.toBe(
      expiringClaim.request.claimToken,
    );
    await repo.complete(fixture.scope, {
      requestId: reclaimed.request.id,
      claimToken: reclaimed.request.claimToken,
    });
  }, 20_000);

  it("never claims more than 100 due rows and never duplicates a lease", async () => {
    const repo = new KeywordGovernanceScheduleRequestsRepository(handle.db);
    await Promise.all(Array.from({ length: 101 }, async (_, index) =>
      repo.insertRequest(fixture.scope, {
        sourceKind: "topic_model_confirmation_system",
        sourceRef: `bounded-${index.toString().padStart(3, "0")}-${randomUUID()}`,
        initiatedBy: fixture.actorId,
      })));
    const first = await repo.claimDue({ limit: 100, leaseSeconds: 60 });
    const second = await repo.claimDue({ limit: 100, leaseSeconds: 60 });
    const third = await repo.claimDue({ limit: 100, leaseSeconds: 60 });
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(1);
    expect(third).toEqual([]);
    expect(new Set([...first, ...second].map((request) => request.id)))
      .toHaveLength(101);
    await Promise.all([...first, ...second].map(async (request) =>
      repo.complete(fixture.scope, {
        requestId: request.id,
        claimToken: request.claimToken,
      })));
  });

  async function seedGenerationRun(
    initialStatus: "queued" | "running" = "running",
    withExtension = true,
  ): Promise<string> {
    const runId = randomUUID();
    const client = await handle.pool.connect();
    try {
      await client.query(
        `INSERT INTO app.async_runs(
           id, workspace_id, project_id, kind, status, result_type,
           result_id, attempt_count, initiated_by, started_at
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid,
           'keyword_governance_suggestion_generation', $4::text,
           'keyword_governance_suggestion_generation_run', $1::uuid,
           $5::integer, $6::uuid,
           CASE WHEN $4::text = 'running' THEN clock_timestamp() ELSE NULL END
         )`,
        [
          runId,
          fixture.scope.workspaceId,
          fixture.scope.projectId,
          initialStatus,
          initialStatus === "running" ? 1 : 0,
          fixture.actorId,
        ],
      );
      if (withExtension) {
        try {
          await client.query("SET session_replication_role = replica");
          await client.query(
            `INSERT INTO app.keyword_governance_suggestion_generation_runs(
               id, workspace_id, project_id, generation_version,
               prompt_set_version, input_manifest, input_hash
             ) VALUES (
               $1::uuid, $2::uuid, $3::uuid,
               'keyword-governance-suggestion-generation.v1',
               'keyword-governance-suggestion.prompt.v1',
               '{"schemaVersion":"keyword-governance-suggestion-input.v1"}'::jsonb,
               repeat('a', 64)
             )`,
            [runId, fixture.scope.workspaceId, fixture.scope.projectId],
          );
        } finally {
          await client.query("SET session_replication_role = origin");
        }
      }
    } finally {
      client.release();
    }
    return runId;
  }

  async function cancelGenerationRun(
    runId: string,
    progress: Record<string, unknown>,
    errorCode = "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
    summary = "Keyword governance suggestion generation was superseded.",
    status: "cancelled" | "failed" = "cancelled",
  ): Promise<void> {
    await handle.pool.query(
      `UPDATE app.async_runs
       SET status = $2::text,
           progress = $3::jsonb,
           last_error_code = $4::text,
           last_error_summary = $5::text,
           completed_at = clock_timestamp()
       WHERE id = $1::uuid`,
      [runId, status, JSON.stringify(progress), errorCode, summary],
    );
  }

  it("atomically appends only exact terminal generation continuations", async () => {
    const repo = new KeywordGovernanceScheduleRequestsRepository(handle.db);
    const reasons = [
      [
        "stale_authority",
        "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
      ],
      [
        "concurrent_human",
        "KEYWORD_GOVERNANCE_SUGGESTION_CONCURRENT_HUMAN",
      ],
      ["conflict", "KEYWORD_GOVERNANCE_SUGGESTION_BATCH_CONFLICT"],
    ] as const;
    for (const [reason, errorCode] of reasons) {
      const runId = await seedGenerationRun();
      await cancelGenerationRun(runId, terminalProgress({
        kind: "reschedule",
        reason,
        requestNextBatch: true,
      }), errorCode);
      const claimed = await repo.claimBySource(fixture.scope, {
        sourceKind: "generation_continuation",
        sourceRef: runId,
        leaseSeconds: 60,
      });
      expect(claimed).toMatchObject({
        kind: "claimed",
        request: {
          sourceRef: runId,
          initiatedBy: fixture.actorId,
        },
      });
      if (claimed.kind !== "claimed") throw new Error("continuation missing");
      await repo.complete(fixture.scope, {
        requestId: claimed.request.id,
        claimToken: claimed.request.claimToken,
      });
      await handle.pool.query(
        `UPDATE app.async_runs SET status = status WHERE id = $1::uuid`,
        [runId],
      );
      const count = await handle.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM app.keyword_governance_schedule_requests
         WHERE workspace_id = $1::uuid
           AND project_id = $2::uuid
           AND source_kind = 'generation_continuation'
           AND source_ref = $3::text`,
        [fixture.scope.workspaceId, fixture.scope.projectId, runId],
      );
      expect(count.rows[0]?.count).toBe("1");
    }

    const completedRunId = await seedGenerationRun();
    const client = await handle.pool.connect();
    try {
      await client.query(
        `ALTER TABLE app.async_runs DISABLE TRIGGER
           async_runs_keyword_suggestion_generation_result_guard`,
      );
      await client.query(
        `UPDATE app.async_runs
         SET status = 'completed',
             progress = $2::jsonb,
             completed_at = clock_timestamp(),
             last_error_code = NULL,
             last_error_summary = NULL
         WHERE id = $1::uuid`,
        [completedRunId, JSON.stringify(terminalProgress({
          kind: "completed",
          requestNextBatch: true,
        }))],
      );
    } finally {
      await client.query(
        `ALTER TABLE app.async_runs ENABLE TRIGGER
           async_runs_keyword_suggestion_generation_result_guard`,
      );
      client.release();
    }
    const completedClaim = await repo.claimBySource(fixture.scope, {
      sourceKind: "generation_continuation",
      sourceRef: completedRunId,
      leaseSeconds: 60,
    });
    expect(completedClaim.kind).toBe("claimed");
    if (completedClaim.kind === "claimed") {
      await repo.complete(fixture.scope, {
        requestId: completedClaim.request.id,
        claimToken: completedClaim.request.claimToken,
      });
    }

    const nearMisses = [
      {
        progress: terminalProgress({
          kind: "reschedule",
          reason: "stale_authority",
          requestNextBatch: false,
        }),
      },
      {
        progress: terminalProgress({
          kind: "reschedule",
          reason: "stale_authority",
          requestNextBatch: true,
        }, { extra: true }),
      },
      {
        progress: terminalProgress({
          kind: "reschedule",
          reason: "stale_authority",
          requestNextBatch: true,
        }, { schemaVersion: "other" }),
      },
      {
        progress: terminalProgress({
          kind: "reschedule",
          reason: "conflict",
          requestNextBatch: true,
        }),
        errorCode: "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
      },
      {
        progress: terminalProgress({
          kind: "reschedule",
          reason: "stale_authority",
          requestNextBatch: true,
        }),
        summary: "Keyword governance suggestion generation failed.",
      },
      {
        progress: terminalProgress({
          kind: "reschedule",
          reason: "stale_authority",
          requestNextBatch: true,
        }),
        status: "failed" as const,
      },
    ];
    for (const nearMiss of nearMisses) {
      const runId = await seedGenerationRun();
      await cancelGenerationRun(
        runId,
        nearMiss.progress,
        nearMiss.errorCode,
        nearMiss.summary,
        nearMiss.status,
      );
      const count = await handle.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM app.keyword_governance_schedule_requests
         WHERE workspace_id = $1::uuid
           AND project_id = $2::uuid
           AND source_kind = 'generation_continuation'
           AND source_ref = $3::text`,
        [fixture.scope.workspaceId, fixture.scope.projectId, runId],
      );
      expect(count.rows[0]?.count).toBe("0");
    }

    const queuedRunId = await seedGenerationRun("queued");
    await cancelGenerationRun(queuedRunId, terminalProgress({
      kind: "reschedule",
      reason: "stale_authority",
      requestNextBatch: true,
    }));
    const missingExtensionRunId = await seedGenerationRun("running", false);
    await cancelGenerationRun(missingExtensionRunId, terminalProgress({
      kind: "reschedule",
      reason: "stale_authority",
      requestNextBatch: true,
    }));
    const nearMissCount = await handle.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.keyword_governance_schedule_requests
       WHERE workspace_id = $1::uuid
         AND project_id = $2::uuid
         AND source_kind = 'generation_continuation'
         AND source_ref = ANY($3::text[])`,
      [
        fixture.scope.workspaceId,
        fixture.scope.projectId,
        [queuedRunId, missingExtensionRunId],
      ],
    );
    expect(nearMissCount.rows[0]?.count).toBe("0");
  });

  it("replays the ordered migration without applying a second file", async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    await expect(runMigrations(databaseUrl)).resolves.toEqual([]);
  });
});
