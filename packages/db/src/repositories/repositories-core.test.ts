import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { ActionsRepository } from "./actions.ts";
import { AnalysisInvocationsRepository } from "./analysis-invocations.ts";
import {
  AsyncRunsRepository,
  isTerminalStatus,
  toRunAttempt,
} from "./async-runs.ts";
import { CollectionRunsRepository } from "./collection-runs.ts";
import { DataSnapshotsRepository } from "./data-snapshots.ts";
import { DiagnosticRunsRepository } from "./diagnostic-runs.ts";
import { EvidenceRepository } from "./evidence.ts";
import { ExportBundlesRepository } from "./export-bundles.ts";
import { FindingsRepository } from "./findings.ts";
import { FindingReviewEventsRepository } from "./findings-review.ts";
import { IdempotencyRepository } from "./idempotency.ts";
import { ImportPreviewsRepository } from "./import-previews.ts";
import { ObservationsRepository, type ObservationInsert } from "./observations.ts";
import { TelemetryRepository } from "./telemetry.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

class FakeQuery {
  constructor(private readonly owner: FakeExecutor) {}

  private chain(method: string, args: readonly unknown[]): this {
    this.owner.calls.push({ method, args });
    return this;
  }

  from(...args: unknown[]): this {
    return this.chain("from", args);
  }

  where(...args: unknown[]): this {
    return this.chain("where", args);
  }

  limit(...args: unknown[]): this {
    return this.chain("limit", args);
  }

  orderBy(...args: unknown[]): this {
    return this.chain("orderBy", args);
  }

  values(...args: unknown[]): this {
    return this.chain("values", args);
  }

  set(...args: unknown[]): this {
    return this.chain("set", args);
  }

  returning(...args: unknown[]): this {
    return this.chain("returning", args);
  }

  for(...args: unknown[]): this {
    return this.chain("for", args);
  }

  onConflictDoNothing(...args: unknown[]): this {
    return this.chain("onConflictDoNothing", args);
  }

  onConflictDoUpdate(...args: unknown[]): this {
    return this.chain("onConflictDoUpdate", args);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.owner.take()).then(onFulfilled, onRejected);
  }
}

class FakeExecutor {
  readonly calls: RecordedCall[] = [];
  private readonly results: unknown[] = [];

  enqueue(...results: unknown[]): void {
    this.results.push(...results);
  }

  take(): unknown {
    return this.results.length > 0 ? this.results.shift() : [];
  }

  private query(method: string, args: readonly unknown[]): FakeQuery {
    this.calls.push({ method, args });
    return new FakeQuery(this);
  }

  select(...args: unknown[]): FakeQuery {
    return this.query("select", args);
  }

  insert(...args: unknown[]): FakeQuery {
    return this.query("insert", args);
  }

  update(...args: unknown[]): FakeQuery {
    return this.query("update", args);
  }

  delete(...args: unknown[]): FakeQuery {
    return this.query("delete", args);
  }

  execute(...args: unknown[]): Promise<unknown> {
    this.calls.push({ method: "execute", args });
    return Promise.resolve(this.take());
  }

  last(method: string): RecordedCall {
    const call = this.calls.findLast((candidate) => candidate.method === method);
    if (!call) throw new Error(`No ${method} call was recorded`);
    return call;
  }
}

const scope = { workspaceId: "workspace-1", projectId: "project-1" };

function repository<T>(
  Type: new (executor: never) => T,
): { readonly repo: T; readonly db: FakeExecutor } {
  const db = new FakeExecutor();
  return { repo: new Type(db as never), db };
}

describe("core repositories", () => {
  it("excludes caller-selected finding review states in SQL", async () => {
    const { repo, db } = repository(FindingsRepository);
    db.enqueue([]);

    await repo.list(scope, {
      limit: 50,
      cursor: null,
      activeOnly: false,
      excludedReviewStates: ["ignored", "needs_more_data"],
    });

    const query = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(query.sql).toContain('"app"."findings"."review_state" not in');
    expect(query.params).toEqual(
      expect.arrayContaining(["ignored", "needs_more_data"]),
    );
  });

  it("maps action reads, writes, atomic overrides, and keyset pages", async () => {
    const { repo, db } = repository(ActionsRepository);
    const action = {
      id: "action-1",
      updated_at: "2026-07-18T01:02:03.000Z",
    };

    db.enqueue([action], [], [action], []);
    await expect(repo.findByKey(scope, "key-1")).resolves.toBe(action);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();
    await expect(repo.findByIdForUpdate(scope, "action-1")).resolves.toBe(
      action,
    );
    expect(db.last("for").args).toEqual(["update"]);
    await expect(
      repo.findByIdForUpdate(scope, "missing"),
    ).resolves.toBeNull();
    const actionLockScope = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(actionLockScope.sql).toContain('"workspace_id" = $1');
    expect(actionLockScope.sql).toContain('"project_id" = $2');
    expect(actionLockScope.sql).toContain('"id" = $3');

    db.enqueue([action], []);
    await expect(
      repo.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        sourceFindingId: "finding-1",
        actionKey: "key-1",
        templateId: "template-1",
        templateVersion: 2,
        title: "Fix title",
        description: "Fix description",
        contentLocale: "en",
        priorityBand: "p1",
        roadmapLane: "now",
        status: "proposed",
        effort: "m",
        risk: "low",
        expectedOutcome: "More qualified traffic",
        evidenceRefs: ["ev-1"],
        createdBy: "user-1",
      }),
    ).resolves.toBe(action);
    expect(db.last("values").args[0]).toMatchObject({
      workspace_id: scope.workspaceId,
      action_key: "key-1",
      evidence_refs: ["ev-1"],
    });
    await repo.mergeEvidenceRefs("action-1", ["ev-1", "ev-2"]);
    expect(db.last("set").args[0]).toMatchObject({
      evidence_refs: ["ev-1", "ev-2"],
    });

    db.enqueue([{ id: "action-1" }], []);
    await expect(
      repo.applyOverride(scope, "action-1", {
        status: "accepted",
        priorityBand: "p0",
        roadmapLane: "now",
        expectedRevision: 3,
        toRevision: 4,
      }),
    ).resolves.toBe(true);
    await expect(
      repo.applyOverride(scope, "action-1", {
        expectedRevision: 3,
        toRevision: 4,
      }),
    ).resolves.toBe(false);
    expect(db.last("set").args[0]).toEqual(
      expect.objectContaining({ revision: 4 }),
    );

    await repo.appendOverrideAudit({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actionId: "action-1",
      fromRevision: 3,
      toRevision: 4,
      oldValues: { status: "proposed" },
      newValues: { status: "accepted" },
      reason: "reviewed",
      note: null,
      actorId: "user-1",
    });
    expect(db.last("values").args[0]).toMatchObject({
      action_id: "action-1",
      reason: "reviewed",
    });

    const next = {
      id: "action-2",
      updated_at: "2026-07-17T01:02:03.000Z",
    };
    const overflow = {
      id: "action-3",
      updated_at: "2026-07-16T01:02:03.000Z",
    };
    db.enqueue([action, next, overflow]);
    const firstPage = await repo.list(scope, { limit: 2, cursor: null });
    expect(firstPage).toMatchObject({ rows: [action, next] });
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    db.enqueue([next]);
    const finalPage = await repo.list(scope, {
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(finalPage).toEqual({ rows: [next], nextCursor: null });

    db.enqueue([]);
    await expect(
      repo.list(scope, { limit: 2, cursor: "not-a-valid-keyset" }),
    ).resolves.toEqual({ rows: [], nextCursor: null });

    db.enqueue([action], []);
    await expect(
      repo.findActiveByFinding(scope, "finding-1"),
    ).resolves.toBe(action);
    await expect(
      repo.findActiveByFinding(scope, "finding-2"),
    ).resolves.toBeNull();
  });

  it("persists analysis invocation accounting without storing model content", async () => {
    const { repo, db } = repository(AnalysisInvocationsRepository);
    db.enqueue([{ id: "invocation-1" }], [{ id: "invocation-2" }]);

    await expect(
      repo.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        asyncRunId: "run-1",
        task: "finding_summary",
        provider: "openai",
        model: "gpt",
        promptSetVersion: "v2",
        inputHash: "input-hash",
        outputHash: "output-hash",
        status: "succeeded",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.123,
        latencyMs: 250,
        errorCode: null,
      }),
    ).resolves.toBe("invocation-1");
    expect(db.last("values").args[0]).toMatchObject({
      cost_usd: "0.123",
      input_hash: "input-hash",
      output_hash: "output-hash",
    });

    await repo.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      asyncRunId: null,
      task: "artifact_generation",
      provider: "openai",
      model: "gpt",
      promptSetVersion: "v2",
      inputHash: "input-hash",
      outputHash: null,
      status: "failed",
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: 5,
      errorCode: "PROVIDER_FAILURE",
    });
    expect(db.last("values").args[0]).toMatchObject({ cost_usd: null });
  });

  it("counts one project-scoped run/task aggregate and fails closed on unsafe counts", async () => {
    const { repo, db } = repository(AnalysisInvocationsRepository);
    db.enqueue([{ count: "7" }]);

    await expect(
      repo.countByAsyncRunTask(scope, "run-1", "finding_summary"),
    ).resolves.toBe(7);

    const aggregate = new PgDialect().sqlToQuery(
      (db.last("select").args[0] as { count: never }).count,
    );
    expect(aggregate.sql).toBe("count(*)::text");
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"async_run_id" = $3');
    expect(predicate.sql).toContain('"task" = $4');
    expect(predicate.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      "run-1",
      "finding_summary",
    ]);

    for (const invalid of [
      [],
      [{ count: "1" }, { count: "2" }],
      [{ count: 0 }],
      [{ count: "01" }],
      [{ count: "-1" }],
      [{ count: "1.5" }],
      [{ count: "9007199254740992" }],
    ]) {
      const fixture = repository(AnalysisInvocationsRepository);
      fixture.db.enqueue(invalid);
      await expect(
        fixture.repo.countByAsyncRunTask(
          scope,
          "run-1",
          "finding_summary",
        ),
      ).rejects.toThrow("invalid analysis invocation count");
    }
  });

  it("maintains the complete async-run lifecycle and optional terminal fields", async () => {
    const { repo, db } = repository(AsyncRunsRepository);
    const run = { id: "run-1", status: "queued" };
    const claimed = {
      ...run,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      attempt_count: 1,
    };
    const attempt = toRunAttempt(claimed as never);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);

    db.enqueue({
      rows: [
        {
          kind: "collection",
          queued_depth: "3",
          running_depth: "2",
          oldest_queued_age_ms: "1234.567",
          average_run_duration_ms_24h: "2000.555",
          max_run_duration_ms_24h: "9000",
          retry_count_24h: "4",
          failure_count_24h: "1",
        },
        {
          kind: "__proto__",
          queued_depth: "999",
        },
      ],
    });
    await expect(repo.technicalMetrics()).resolves.toEqual([
      {
        kind: "collection",
        queuedDepth: 3,
        runningDepth: 2,
        oldestQueuedAgeMs: 1234.57,
        averageRunDurationMs24h: 2000.56,
        maxRunDurationMs24h: 9000,
        retryCount24h: 4,
        failureCount24h: 1,
      },
    ]);
    const metricSql = new PgDialect().sqlToQuery(
      db.last("execute").args[0] as never,
    );
    expect(metricSql.sql).not.toContain("request_payload");
    expect(metricSql.sql).not.toContain("last_error_summary");

    db.enqueue([run], [{ id: "run-2" }]);
    await expect(
      repo.insertQueued({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        kind: "diagnostic",
        activeKey: "diagnostic",
        initiatedBy: "user-1",
        contractVersion: "2026-07-18",
        requestPayload: { locale: "en" },
      }),
    ).resolves.toBe(run);
    expect(db.last("values").args[0]).toMatchObject({
      contract_version: "2026-07-18",
      request_payload: { locale: "en" },
    });
    await repo.insertQueued({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      kind: "collection",
      activeKey: "crawl",
      initiatedBy: "user-1",
      contractVersion: "2026-07-18",
    });
    expect(db.last("values").args[0]).toMatchObject({
      contract_version: "2026-07-18",
    });

    db.enqueue([run], [], [run], [run], [], [claimed], []);
    await expect(repo.findActive(scope, "crawl")).resolves.toBe(run);
    await expect(repo.findActive(scope, "none")).resolves.toBeNull();
    await expect(repo.listActiveByProject(scope)).resolves.toEqual([run]);
    await expect(repo.findById(scope, "run-1")).resolves.toBe(run);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();
    await expect(repo.claim(scope, "run-1")).resolves.toBe(claimed);
    await expect(repo.claim(scope, "run-1")).resolves.toBeNull();

    db.enqueue([claimed]);
    await expect(repo.lockAttemptForUpdate(attempt)).resolves.toBe(claimed);
    expect(db.last("for").args).toEqual(["update"]);

    db.enqueue([claimed]);
    await expect(
      repo.lockActiveForRecovery(scope, "run-1"),
    ).resolves.toBe(claimed);
    expect(db.last("for").args).toEqual(["update"]);

    db.enqueue([{ id: "run-1" }], [{ id: "run-1" }], [{ id: "run-1" }]);
    await expect(repo.resetToQueued(attempt)).resolves.toBe(true);
    await expect(
      repo.setProgress(attempt, { completed: 3, total: 5 }),
    ).resolves.toBe(true);
    await expect(repo.setTerminal(attempt, {
      status: "partial",
      resultType: "diagnostic",
      resultId: "diagnostic-1",
      lastErrorCode: "PARTIAL_SOURCE",
      lastErrorSummary: "One source was stale",
    })).resolves.toBe(true);
    expect(db.last("set").args[0]).toMatchObject({
      status: "partial",
      result_type: "diagnostic",
      last_error_code: "PARTIAL_SOURCE",
    });
    db.enqueue([]);
    await expect(
      repo.setTerminal({ ...attempt, runId: "run-2" }, { status: "completed" }),
    ).resolves.toBe(false);
    expect(db.last("set").args[0]).not.toHaveProperty("result_type");

    await expect(
      repo.setProgress({ ...attempt, attemptCount: 0 }, { ignored: true }),
    ).resolves.toBe(false);

    db.enqueue([run]);
    await expect(repo.prepareDelivery(scope, "run-1", 1)).resolves.toBe(run);
    await expect(repo.prepareDelivery(scope, "run-1", -1)).resolves.toBeNull();
    await expect(repo.prepareDelivery(scope, "run-1", 0.5)).resolves.toBeNull();

    db.enqueue([run], [run]);
    await expect(repo.listActiveForRecovery(scope, 10)).resolves.toEqual([
      run,
    ]);
    await expect(repo.listActiveForRecovery(null, 20)).resolves.toEqual([run]);
    expect(db.last("limit").args[0]).toBe(20);

    db.enqueue([{ id: "run-1" }], []);
    await expect(
      repo.reconcileActiveToTerminal(scope, "run-1", {
        status: "failed",
        lastErrorCode: "QUEUE_JOB_FAILED",
        lastErrorSummary: "Queue job failed.",
      }),
    ).resolves.toBe(true);
    await expect(
      repo.reconcileActiveToTerminal(scope, "run-1", {
        status: "cancelled",
        lastErrorCode: "QUEUE_JOB_CANCELLED",
        lastErrorSummary: "Queue job cancelled.",
      }),
    ).resolves.toBe(false);
    expect(db.last("set").args[0]).toMatchObject({
      status: "cancelled",
      last_error_code: "QUEUE_JOB_CANCELLED",
    });
  });

  it("records collection placeholders and outcome metadata", async () => {
    const { repo, db } = repository(CollectionRunsRepository);
    const run = { id: "run-1" };
    db.enqueue([run], [], [run], [{ id: "run-2" }]);
    await expect(repo.findById("run-1")).resolves.toBe(run);
    await expect(repo.findById("missing")).resolves.toBeNull();

    await expect(
      repo.insertPlaceholder({
        runId: "run-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        sourceConnectionId: "source-1",
        provider: "csv",
        operation: "import",
        methodVersion: "v1",
        parametersHash: "hash",
        importPreviewId: "preview-1",
      }),
    ).resolves.toBe(run);
    expect(db.last("values").args[0]).toMatchObject({
      import_preview_id: "preview-1",
      provider: "csv",
    });
    await repo.insertPlaceholder({
      runId: "run-2",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId: "site-1",
      sourceConnectionId: null,
      provider: "crawl",
      operation: "crawl",
      methodVersion: "v1",
      parametersHash: "hash",
    });
    expect(db.last("values").args[0]).toMatchObject({ import_preview_id: null });

    await repo.finalize("run-1", {
      rowCount: 12,
      sourceWindow: { capturedAt: "2026-07-18" },
      providerUsage: { requests: 3 },
      stopReason: null,
    });
    expect(db.last("set").args[0]).toEqual({
      row_count: 12,
      source_window: { capturedAt: "2026-07-18" },
      provider_usage: { requests: 3 },
      stop_reason: null,
    });
  });

  it("persists immutable snapshots and paginates their history", async () => {
    const { repo, db } = repository(DataSnapshotsRepository);
    const snapshot = {
      id: "snapshot-1",
      created_at: "2026-07-18 01:02:03+08",
    };
    db.enqueue([snapshot], [{ id: "snapshot-2" }]);
    await expect(
      repo.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        collectionRunId: "run-1",
        sourceConnectionId: null,
        provider: "crawl",
        datasetKey: "pages",
        schemaVersion: "v1",
        methodVersion: "v2",
        capturedAt: "2026-07-18T00:00:00.000Z",
        sourceWindow: { from: "2026-07-17" },
        availability: "available",
        limitation: "Static HTML only",
        rawObjectKey: "snapshots/one.json",
        rowCount: 10,
        checksum: "sha256",
        summary: { pages: 10 },
      }),
    ).resolves.toBe(snapshot);
    expect(db.last("values").args[0]).toMatchObject({
      summary: { pages: 10 },
      raw_object_key: "snapshots/one.json",
    });
    await repo.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId: "site-1",
      collectionRunId: "run-2",
      sourceConnectionId: null,
      provider: "crawl",
      datasetKey: "pages",
      schemaVersion: "v1",
      methodVersion: "v2",
      capturedAt: "2026-07-18T00:00:00.000Z",
      sourceWindow: {},
      availability: "unavailable",
      limitation: "Blocked",
      rawObjectKey: null,
      rowCount: 0,
      checksum: "empty",
    });
    expect(db.last("values").args[0]).not.toHaveProperty("summary");

    db.enqueue([snapshot], [], [snapshot], [snapshot], []);
    await expect(repo.findById(scope, "snapshot-1")).resolves.toBe(snapshot);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();
    await expect(repo.findByIds(scope, [])).resolves.toEqual([]);
    await expect(
      repo.findByIds(scope, ["snapshot-1"]),
    ).resolves.toEqual([snapshot]);
    await expect(
      repo.findLatestByConnection(scope, "source-1"),
    ).resolves.toBe(snapshot);
    await expect(
      repo.findLatestByProvider(scope, "ga4"),
    ).resolves.toBeNull();

    const second = {
      id: "00000000-0000-4000-8000-000000000102",
      created_at: "2026-07-17 01:02:03+08",
    };
    const third = {
      id: "00000000-0000-4000-8000-000000000103",
      created_at: "2026-07-16 01:02:03+08",
    };
    db.enqueue([snapshot, second, third]);
    const page = await repo.listByProject(scope, { limit: 2, cursor: null });
    expect(page.rows).toEqual([snapshot, second]);
    expect(page.nextCursor).toEqual(expect.any(String));
    db.enqueue([second]);
    await expect(
      repo.listByProject(scope, { limit: 2, cursor: page.nextCursor }),
    ).resolves.toEqual({ rows: [second], nextCursor: null });
    const snapshotCursorQuery = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(snapshotCursorQuery.params).toEqual(
      expect.arrayContaining([second.created_at, second.id]),
    );
    db.enqueue([]);
    await expect(
      repo.listByProject(scope, { limit: 2, cursor: "invalid" }),
    ).resolves.toEqual({ rows: [], nextCursor: null });

    db.enqueue([]);
    await repo.listByProject(scope, {
      limit: 2,
      cursor: null,
      provider: "gsc",
    });
    const providerQuery = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(providerQuery.sql).toContain('"app"."data_snapshots"."provider" =');
    expect(providerQuery.params).toContain("gsc");
  });

  it("stores diagnostic manifests, coverage, and per-rule timings", async () => {
    const { repo, db } = repository(DiagnosticRunsRepository);
    const run = { id: "diagnostic-1" };
    db.enqueue([run], [run], [], [run]);
    await expect(
      repo.insert({
        runId: "diagnostic-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        icpProfileId: "icp-1",
        icpProfileVersion: 3,
        ruleSetVersion: "v2",
        promptSetVersion: "v2",
        outputLocale: "zh-CN",
        inputManifest: { snapshots: ["snapshot-1"] },
        inputHash: "hash",
      }),
    ).resolves.toBe(run);
    await expect(repo.findById(scope, "diagnostic-1")).resolves.toBe(run);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();
    await expect(repo.findLatest(scope)).resolves.toBe(run);
    await repo.setCoverage("diagnostic-1", { usable: 4, total: 5 });
    expect(db.last("set").args[0]).toEqual({
      coverage: { usable: 4, total: 5 },
    });

    const callCount = db.calls.length;
    await repo.insertRuleResults(
      {
        diagnosticRunId: "diagnostic-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
      },
      [],
    );
    expect(db.calls).toHaveLength(callCount);
    await repo.insertRuleResults(
      {
        diagnosticRunId: "diagnostic-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
      },
      [
        {
          ruleId: "technical.http_status",
          ruleVersion: 2,
          domain: "technical",
          status: "evaluated",
          reason: null,
          metrics: { affected: 2 },
          durationMs: 17,
        },
      ],
    );
    expect(db.last("values").args[0]).toEqual([
      expect.objectContaining({
        rule_id: "technical.http_status",
        duration_ms: 17,
      }),
    ]);

    const result = { rule_id: "technical.http_status", duration_ms: 17 };
    db.enqueue([result]);
    await expect(repo.listRuleResults("diagnostic-1")).resolves.toEqual([
      result,
    ]);
  });

  it("writes evidence lineage and short-circuits empty batches", async () => {
    const { repo, db } = repository(EvidenceRepository);
    const batch = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: "diagnostic-1",
    };

    await expect(repo.insertMany(batch, [])).resolves.toEqual([]);
    db.enqueue([{ id: "evidence-1" }, { id: "evidence-2" }]);
    await expect(
      repo.insertMany(batch, [
        {
          sourceProvider: "crawl",
          origin: "observed",
          method: "deterministic",
          grade: "a",
          availability: "available",
          support: "supports",
          subjectRefs: ["/pricing"],
          claim: "Pricing page returns 200",
          observedAt: "2026-07-18T00:00:00.000Z",
          limitation: "Static HTML",
          snapshotId: "snapshot-1",
        },
        {
          sourceProvider: "model",
          origin: "generated",
          method: "structured_llm",
          grade: "c",
          availability: "available",
          support: "context",
          subjectRefs: [],
          claim: "Suggested interpretation",
          observedAt: "2026-07-18T00:00:00.000Z",
          limitation: "Model-generated",
          analysisInvocationId: "invocation-1",
        },
      ]),
    ).resolves.toEqual(["evidence-1", "evidence-2"]);
    const inserted = db.last("values").args[0] as readonly Record<
      string,
      unknown
    >[];
    expect(inserted[0]).toMatchObject({
      snapshot_id: "snapshot-1",
      analysis_invocation_id: null,
    });
    expect(inserted[1]).toMatchObject({
      snapshot_id: null,
      analysis_invocation_id: "invocation-1",
    });

    const callCount = db.calls.length;
    await repo.linkObservations(batch, []);
    expect(db.calls).toHaveLength(callCount);
    await repo.linkObservations(batch, [
      { findingId: "finding-1", evidenceId: "evidence-1", role: "primary" },
    ]);
    expect(db.last("values").args[0]).toEqual([
      expect.objectContaining({
        finding_id: "finding-1",
        evidence_id: "evidence-1",
      }),
    ]);

    await expect(repo.listForFindings(scope, [])).resolves.toEqual([]);
    db.enqueue([{ finding_id: "finding-1", evidence_id: "evidence-1" }]);
    await expect(
      repo.listForFindings(scope, ["finding-1"]),
    ).resolves.toHaveLength(1);
    const linkOrder = db.last("orderBy").args.map((expression) =>
      new PgDialect().sqlToQuery(expression as never).sql,
    );
    expect(linkOrder).toEqual([
      '"app"."finding_observations"."finding_id" asc',
      '"app"."finding_observations"."evidence_id" asc',
      '"app"."finding_observations"."role" asc',
    ]);
    await expect(repo.findByIds(scope, [])).resolves.toEqual([]);
    db.enqueue([{ id: "evidence-1", snapshot_id: "snapshot-1" }]);
    await expect(
      repo.findByIds(scope, ["evidence-1"]),
    ).resolves.toHaveLength(1);
    expect(
      db.calls.filter(({ method }) => method === "orderBy").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("chunks evidence lookup predicates to a fixed maximum size", async () => {
    const { repo, db } = repository(EvidenceRepository);
    const ids = Array.from({ length: 1_001 }, (_, index) => `id-${index}`);

    db.enqueue([], [], []);
    await expect(repo.listForFindings(scope, ids)).resolves.toEqual([]);
    const listQueryCount = db.calls.filter(
      ({ method }) => method === "select",
    ).length;
    expect(listQueryCount).toBe(3);

    db.enqueue([], [], []);
    await expect(repo.findByIds(scope, ids)).resolves.toEqual([]);
    const totalQueryCount = db.calls.filter(
      ({ method }) => method === "select",
    ).length;
    expect(totalQueryCount - listQueryCount).toBe(3);

    db.enqueue([
      { finding_id: "finding-1", evidence_id: "evidence-1", role: "primary" },
      { finding_id: "finding-1", evidence_id: "evidence-2", role: "supporting" },
      { finding_id: "finding-1", evidence_id: "evidence-3", role: "context" },
    ]);
    await expect(
      repo.listForFindings(scope, ["finding-1"], { maxRows: 2 }),
    ).resolves.toHaveLength(2);
    expect(db.last("limit").args).toEqual([2]);
    await expect(
      repo.listForFindings(scope, ["finding-1"], { maxRows: -1 }),
    ).rejects.toThrow("maxRows must be a non-negative safe integer");
  });

  it("sorts finding ids before deterministic 500-id link-query chunks", async () => {
    const { repo, db } = repository(EvidenceRepository);
    const ids = Array.from(
      { length: 501 },
      (_, index) => `finding-${String(index).padStart(3, "0")}`,
    ).reverse();
    db.enqueue([], []);

    await expect(repo.listForFindings(scope, ids)).resolves.toEqual([]);

    const predicates = db.calls.filter(({ method }) => method === "where");
    expect(predicates).toHaveLength(2);
    const first = new PgDialect().sqlToQuery(predicates[0]!.args[0] as never);
    const second = new PgDialect().sqlToQuery(predicates[1]!.args[0] as never);
    expect(first.params).toContain("finding-000");
    expect(first.params).toContain("finding-499");
    expect(first.params).not.toContain("finding-500");
    expect(second.params).toContain("finding-500");
  });

  it("caps evidence link reads at a caller-supplied maxRows overflow sentinel", async () => {
    const { repo, db } = repository(EvidenceRepository);

    db.enqueue([]);
    await expect(
      repo.listForFindings(scope, ["finding-1"], { maxRows: 2 }),
    ).resolves.toEqual([]);
    expect(
      db.calls.some(
        ({ method, args }) => method === "limit" && args[0] === 2,
      ),
    ).toBe(true);

    await expect(
      repo.listForFindings(scope, ["finding-1"], { maxRows: -1 }),
    ).rejects.toThrow(RangeError);
  });

  it("restricts finding evidence links to the exact frozen diagnostic run", async () => {
    const { repo, db } = repository(EvidenceRepository);

    db.enqueue([]);
    await expect(
      repo.listForFindings(scope, ["finding-1"], {
        diagnosticRunId: "diagnostic-frozen",
        maxRows: 101,
      }),
    ).resolves.toEqual([]);

    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain(
      '"app"."finding_observations"."diagnostic_run_id" =',
    );
    expect(predicate.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "finding-1",
        "diagnostic-frozen",
      ]),
    );
    expect(db.last("limit").args).toEqual([101]);
  });

  it("pages export evidence byte estimates in stable id order", async () => {
    const { repo, db } = repository(EvidenceRepository);

    db.enqueue([
      { id: "evidence-001", estimated_bytes: 64 },
      { id: "evidence-002", estimated_bytes: 96 },
      { id: "evidence-003", estimated_bytes: 128 },
    ]);
    await expect(
      repo.listExportByteSizesByIdsPage(
        scope,
        ["evidence-003", "evidence-001", "evidence-002"],
        { limit: 2, cursor: null },
      ),
    ).resolves.toEqual({
      rows: [
        { id: "evidence-001", estimated_bytes: 64 },
        { id: "evidence-002", estimated_bytes: 96 },
      ],
      nextCursor: "evidence-002",
    });
    expect(
      db.calls.some(
        ({ method, args }) => method === "limit" && args[0] === 3,
      ),
    ).toBe(true);
    expect(
      db.calls.some(({ method }) => method === "orderBy"),
    ).toBe(true);
    const sizeSelection = db.last("select").args[0] as Record<string, unknown>;
    const sizeSql = new PgDialect().sqlToQuery(
      sizeSelection["estimated_bytes"] as never,
    ).sql;
    expect(sizeSql).toContain("octet_length");
    expect(sizeSql).toContain("json_build_object");
    expect(sizeSql).toContain("convert_to");

    db.enqueue([{ id: "evidence-003", estimated_bytes: 128 }]);
    await expect(
      repo.listExportByteSizesByIdsPage(
        scope,
        ["evidence-003", "evidence-001", "evidence-002"],
        { limit: 2, cursor: "evidence-002" },
      ),
    ).resolves.toEqual({
      rows: [{ id: "evidence-003", estimated_bytes: 128 }],
      nextCursor: null,
    });
    const sizeCursorSql = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(sizeCursorSql.sql).toContain('"app"."evidence"."id" >');
    expect(sizeCursorSql.params).toContain("evidence-002");

    const exportRow1 = {
      id: "evidence-001",
      source_provider: "crawl",
      grade: "A",
      subject_refs: [],
      claim: "claim one",
      observed_at: "2026-07-19T00:00:00.000Z",
    };
    const exportRow2 = { ...exportRow1, id: "evidence-002", claim: "claim two" };
    const exportRow3 = { ...exportRow1, id: "evidence-003", claim: "claim three" };
    db.enqueue([exportRow1, exportRow2, exportRow3]);
    await expect(
      repo.listExportByIdsPage(
        scope,
        ["evidence-003", "evidence-001", "evidence-002"],
        { limit: 2, cursor: null },
      ),
    ).resolves.toEqual({
      rows: [exportRow1, exportRow2],
      nextCursor: "evidence-002",
    });
    expect(db.last("limit").args).toEqual([3]);
    const exportSelection = db.last("select").args[0] as Record<string, unknown>;
    expect(Object.keys(exportSelection)).toEqual([
      "id",
      "source_provider",
      "grade",
      "subject_refs",
      "claim",
      "observed_at",
    ]);

    db.enqueue([exportRow3]);
    await expect(
      repo.listExportByIdsPage(
        scope,
        ["evidence-003", "evidence-001", "evidence-002"],
        { limit: 2, cursor: "evidence-002" },
      ),
    ).resolves.toEqual({ rows: [exportRow3], nextCursor: null });
    const bodyCursorSql = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(bodyCursorSql.sql).toContain('"app"."evidence"."id" >');
    expect(bodyCursorSql.params).toEqual(
      expect.arrayContaining(["evidence-001", "evidence-002", "evidence-003"]),
    );

    await expect(
      repo.listExportByteSizesByIdsPage(scope, ["evidence-1"], {
        limit: 0,
        cursor: null,
      }),
    ).rejects.toThrow("limit must be a positive safe integer");
    await expect(
      repo.listExportByIdsPage(scope, ["evidence-1"], {
        limit: 0,
        cursor: null,
      }),
    ).rejects.toThrow("limit must be a positive safe integer");
  });

  it("chunks normalized observations, uses the explicit provider, and preserves unavailable values as null", async () => {
    const { repo, db } = repository(ObservationsRepository);
    const observed: ObservationInsert = {
      metricKey: "crawl.page.v1",
      subjectType: "url",
      subjectRef: "https://example.com/pricing",
      observedAt: "2026-07-18T00:00:00.000Z",
      availability: "available",
      valueNumeric: 42.5,
      valueText: null,
      valueJson: { status: 200 },
      unit: null,
      origin: "direct_public",
      method: "computed",
      grade: "A",
      support: "supports",
      limitation: "Static HTML",
    };
    const unavailable: ObservationInsert = {
      metricKey: "provider_without_dot",
      subjectType: observed.subjectType,
      subjectRef: observed.subjectRef,
      observedAt: observed.observedAt,
      availability: "unavailable",
      valueNumeric: null,
      valueText: null,
      valueJson: null,
      unit: null,
      origin: observed.origin,
      grade: observed.grade,
      support: observed.support,
      limitation: "Provider unavailable",
    };

    await expect(
      repo.insertMany(scope, "snapshot-1", "dataforseo", []),
    ).resolves.toBe(0);
    await expect(
      repo.insertMany(scope, "snapshot-1", "dataforseo", [
        observed,
        unavailable,
        ...Array.from({ length: 499 }, () => observed),
      ]),
    ).resolves.toBe(501);
    const batches = db.calls.filter((call) => call.method === "values");
    expect(batches).toHaveLength(2);
    const first = batches[0]?.args[0] as readonly Record<string, unknown>[];
    expect(first[0]).toMatchObject({
      provider: "dataforseo",
      value_numeric: "42.5",
      value_json: { status: 200 },
      method: "computed",
    });
    expect(first[1]).toMatchObject({
      provider: "dataforseo",
      value_numeric: null,
      value_json: null,
      method: "observed",
    });

    await expect(repo.listBySnapshotIds(scope, [])).resolves.toEqual([]);
    db.enqueue([{ id: "observation-1" }], [
      { id: "one" },
      { id: "two" },
    ]);
    await expect(
      repo.listBySnapshotIds(scope, ["snapshot-1"]),
    ).resolves.toEqual([{ id: "observation-1" }]);
    await expect(
      repo.countBySnapshot(scope, "snapshot-1"),
    ).resolves.toBe(2);
  });

  it("targets one project-scoped observation by frozen snapshot, metric, and subject", async () => {
    const { repo, db } = repository(ObservationsRepository);
    const observation = {
      id: "observation-1",
      snapshot_id: "snapshot-frozen",
      provider: "crawl",
      metric_key: "crawl.page.v1",
      subject_type: "url",
      subject_ref: "https://example.com/pricing",
    };
    db.enqueue([observation], [], [observation, { ...observation, id: "observation-2" }]);

    await expect(
      repo.findBySnapshotMetricSubject(scope, {
        snapshotId: "snapshot-frozen",
        provider: "crawl",
        metricKey: "crawl.page.v1",
        subjectType: "url",
        subjectRef: "https://example.com/pricing",
      }),
    ).resolves.toBe(observation);
    expect(db.last("limit").args).toEqual([2]);
    const query = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(query.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "snapshot-frozen",
        "crawl",
        "crawl.page.v1",
        "url",
        "https://example.com/pricing",
      ]),
    );

    await expect(
      repo.findBySnapshotMetricSubject(scope, {
        snapshotId: "snapshot-frozen",
        provider: "crawl",
        metricKey: "crawl.page.v1",
        subjectType: "url",
        subjectRef: "https://example.com/missing",
      }),
    ).resolves.toBeNull();

    await expect(
      repo.findBySnapshotMetricSubject(scope, {
        snapshotId: "snapshot-frozen",
        provider: "crawl",
        metricKey: "crawl.page.v1",
        subjectType: "url",
        subjectRef: "https://example.com/pricing",
      }),
    ).resolves.toBeNull();
  });

  it("keyset-pages project-scoped observations by their stable unique id", async () => {
    const { repo, db } = repository(ObservationsRepository);
    const first = { id: "00000000-0000-4000-8000-000000000101" };
    const second = { id: "00000000-0000-4000-8000-000000000102" };
    const third = { id: "00000000-0000-4000-8000-000000000103" };

    await expect(
      repo.listBySnapshotIdsPage(scope, [], { limit: 2, cursor: null }),
    ).resolves.toEqual({ rows: [], nextCursor: null });
    db.enqueue([first, second, third]);
    await expect(
      repo.listBySnapshotIdsPage(scope, ["snapshot-1"], {
        limit: 2,
        cursor: null,
      }),
    ).resolves.toEqual({ rows: [first, second], nextCursor: second.id });
    expect(db.last("limit").args).toEqual([3]);

    db.enqueue([third]);
    await expect(
      repo.listBySnapshotIdsPage(scope, ["snapshot-1"], {
        limit: 2,
        cursor: second.id,
      }),
    ).resolves.toEqual({ rows: [third], nextCursor: null });
    const cursorQuery = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(cursorQuery.sql).toContain(
      '"app"."normalized_observations"."id" >',
    );
    expect(cursorQuery.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "snapshot-1",
        second.id,
      ]),
    );

    await expect(
      repo.listBySnapshotIdsPage(scope, ["snapshot-1"], {
        limit: 0,
        cursor: null,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("stores and finalizes export bundle metadata", async () => {
    const { repo, db } = repository(ExportBundlesRepository);
    const bundle = { id: "export-1", async_run_id: "run-1" };
    db.enqueue([bundle], [bundle], [], [bundle]);
    await expect(
      repo.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        asyncRunId: "run-1",
        kind: "client_bundle",
        outputLocale: "en",
        createdBy: "user-1",
      }),
    ).resolves.toBe(bundle);
    await expect(repo.findById(scope, "export-1")).resolves.toBe(bundle);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();
    await expect(repo.findByRun(scope, "run-1")).resolves.toBe(bundle);
    await repo.finalize("export-1", {
      objectKey: "exports/project-1/archive.zip",
      checksum: "sha256",
      byteSize: 100,
      itemCounts: { findings: 2 },
      manifest: { version: "0.2" },
    });
    expect(db.last("set").args[0]).toMatchObject({
      object_key: "exports/project-1/archive.zip",
      byte_size: 100,
    });
  });

  it("reserves and completes idempotency keys", async () => {
    const { repo, db } = repository(IdempotencyRepository);
    const key = { id: "idem-1" };
    db.enqueue([key], [], [key], []);
    await expect(
      repo.find("workspace-1", "createProject", "key-1"),
    ).resolves.toBe(key);
    await expect(
      repo.find("workspace-1", "createProject", "missing"),
    ).resolves.toBeNull();
    await expect(
      repo.begin({
        workspaceId: "workspace-1",
        scope: "createProject",
        key: "key-1",
        requestHash: "request-hash",
        expiresAt: "2026-07-19T00:00:00.000Z",
      }),
    ).resolves.toBe(key);
    await expect(
      repo.begin({
        workspaceId: "workspace-1",
        scope: "createProject",
        key: "key-2",
        requestHash: "request-hash",
        expiresAt: "2026-07-19T00:00:00.000Z",
      }),
    ).resolves.toBeNull();
    expect(db.last("onConflictDoUpdate").args[0]).toMatchObject({
      target: expect.any(Array),
      set: {
        request_hash: "request-hash",
        status: "in_progress",
        response_status: null,
        response_body: null,
        resource_type: null,
        resource_id: null,
        expires_at: "2026-07-19T00:00:00.000Z",
      },
      setWhere: expect.anything(),
    });
    await repo.complete("idem-1", {
      responseStatus: 202,
      responseBody: { accepted: true },
      resourceType: "project",
      resourceId: "project-1",
    });
    expect(db.last("set").args[0]).toMatchObject({
      status: "completed",
      response_status: 202,
      resource_id: "project-1",
    });
  });

  it("prunes expired idempotency rows in a bounded batch", async () => {
    const { repo, db } = repository(IdempotencyRepository);
    db.enqueue([{ id: "expired-1" }, { id: "expired-2" }], [
      { id: "expired-1" },
    ]);

    await expect(
      repo.pruneExpired(2),
    ).resolves.toBe(1);
    expect(db.last("limit").args).toEqual([2]);
    expect(db.last("returning").args[0]).toMatchObject({ id: expect.anything() });

    db.enqueue([]);
    await expect(
      repo.pruneExpired(2),
    ).resolves.toBe(0);
  });

  it("persists, finds, and consumes CSV import previews", async () => {
    const { repo, db } = repository(ImportPreviewsRepository);
    const preview = { id: "preview-1" };
    db.enqueue([preview], [preview], [], [preview], [{ id: "preview-1" }], []);
    await expect(
      repo.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        createdBy: "user-1",
        tokenHash: Buffer.from("token"),
        templateId: "keyword-gap.v1",
        rawObjectKey: "imports/raw.csv",
        fileChecksum: "sha256",
        rowCount: 10,
        detectedColumns: ["keyword"],
        suggestedMapping: { keyword: "keyword" },
        previewRows: [{ keyword: "seo" }],
        validationErrors: [],
        validationWarnings: ["Optional column missing"],
        expiresAt: "2026-07-18T12:30:00.000Z",
      }),
    ).resolves.toBe(preview);
    await expect(repo.findById(scope, "preview-1")).resolves.toBe(preview);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();
    await expect(
      repo.findByTokenHash(scope, Buffer.from("token")),
    ).resolves.toBe(preview);
    await expect(repo.consume(scope, "preview-1")).resolves.toBe(true);
    expect(db.last("set").args[0]).toMatchObject({ status: "consumed" });
    await expect(repo.consume(scope, "preview-1")).resolves.toBe(false);
  });

  it("filters telemetry properties and appends finding review audit events", async () => {
    const telemetry = repository(TelemetryRepository);
    await telemetry.repo.emit({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      eventName: "export_ready",
      actorId: "user-1",
      properties: {
        kind: "client_bundle",
        accessToken: "must-not-persist",
        nested: { apiKey: "also-secret" },
      },
    });
    expect(telemetry.db.last("values").args[0]).toMatchObject({
      event_name: "export_ready",
      properties: {
        kind: "client_bundle",
      },
    });

    const audit = repository(FindingReviewEventsRepository);
    await audit.repo.append({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      findingId: "finding-1",
      fromState: "unreviewed",
      toState: "confirmed",
      revision: 2,
      reason: "verified",
      note: null,
      actorId: "user-1",
    });
    expect(audit.db.last("values").args[0]).toMatchObject({
      finding_id: "finding-1",
      from_state: "unreviewed",
      to_state: "confirmed",
      revision: 2,
    });
  });
});
