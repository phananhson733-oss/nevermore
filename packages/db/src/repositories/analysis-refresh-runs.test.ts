import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_REFRESH_PLAN_STEPS,
  ANALYSIS_REFRESH_PLAN_VERSION,
  analysisRefreshPlanHash,
  analysisRefreshPlanManifest,
  AnalysisRefreshRunsRepository,
} from "./analysis-refresh-runs.ts";

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

  last(method: string): RecordedCall {
    const call = this.calls.findLast(
      (candidate) => candidate.method === method,
    );
    if (!call) throw new Error(`No ${method} call was recorded`);
    return call;
  }
}

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
};
const runId = "00000000-0000-4000-8000-000000000003";

function fixture(): {
  readonly db: FakeExecutor;
  readonly repo: AnalysisRefreshRunsRepository;
} {
  const db = new FakeExecutor();
  return {
    db,
    repo: new AnalysisRefreshRunsRepository(db as never),
  };
}

describe("AnalysisRefreshRunsRepository", () => {
  it("freezes the exact server-owned five-step plan and stable hash", () => {
    const first = analysisRefreshPlanManifest();
    const second = analysisRefreshPlanManifest();

    expect(first).toEqual({
      version: ANALYSIS_REFRESH_PLAN_VERSION,
      steps: [
        { ordinal: 1, stepKey: "crawl", required: true },
        { ordinal: 2, stepKey: "gsc", required: false },
        { ordinal: 3, stepKey: "ga4", required: false },
        { ordinal: 4, stepKey: "dataforseo", required: false },
        { ordinal: 5, stepKey: "growth_audit", required: true },
      ],
    });
    expect(first.steps).toEqual(ANALYSIS_REFRESH_PLAN_STEPS);
    expect(analysisRefreshPlanHash(first)).toBe(
      "d725c90b76edf0bd7747a8d3dcf18754dfa9c5356f66ca765acbaa4145e405af",
    );
    expect(analysisRefreshPlanHash(first)).toBe(
      analysisRefreshPlanHash(second),
    );
    expect(first).not.toBe(second);
    expect(first.steps).not.toBe(second.steps);
  });

  it("inserts one immutable parent and all five pending steps", async () => {
    const { db, repo } = fixture();
    const manifest = analysisRefreshPlanManifest();
    const parent = {
      id: runId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      icp_profile_id: "icp-1",
      plan_manifest: manifest,
      plan_hash: analysisRefreshPlanHash(manifest),
    };
    const steps = ANALYSIS_REFRESH_PLAN_STEPS.map((step) => ({
      analysis_refresh_run_id: runId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      ordinal: step.ordinal,
      step_key: step.stepKey,
      required: step.required,
      state: "pending",
    }));
    db.enqueue([parent], steps);

    await expect(
      repo.create({
        runId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        icpProfileId: "icp-1",
      }),
    ).resolves.toEqual({ run: parent, steps });

    const values = db.calls
      .filter((call) => call.method === "values")
      .map((call) => call.args[0]);
    expect(values[0]).toMatchObject({
      id: runId,
      plan_manifest: manifest,
      plan_hash: analysisRefreshPlanHash(manifest),
    });
    expect(values[1]).toEqual(
      ANALYSIS_REFRESH_PLAN_STEPS.map((step) => ({
        analysis_refresh_run_id: runId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        ordinal: step.ordinal,
        step_key: step.stepKey,
        required: step.required,
      })),
    );
  });

  it("applies workspace/project/run/step CAS when starting a child", async () => {
    const { db, repo } = fixture();
    db.enqueue([{ state: "running" }]);

    await expect(
      repo.startStep(scope, runId, "crawl", "child-1"),
    ).resolves.toEqual({ state: "running" });
    expect(db.last("set").args[0]).toMatchObject({
      state: "running",
      child_async_run_id: "child-1",
    });
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain(
      '"analysis_refresh_run_id" = $3',
    );
    expect(predicate.sql).toContain('"step_key" = $4');
    expect(predicate.sql).toContain('"state" = $5');
    expect(predicate.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      runId,
      "crawl",
      "pending",
    ]);
  });

  it("advances completed/skipped/failed states with bounded facts", async () => {
    const { db, repo } = fixture();
    db.enqueue(
      [{ ordinal: 1 }],
      [{ ordinal: 2 }],
      [{ ordinal: 3 }],
    );

    await expect(
      repo.completeStep(scope, runId, "crawl", {
        childAsyncRunId: "child-1",
        resultSnapshotId: "snapshot-1",
      }),
    ).resolves.toBe(true);
    expect(db.calls.filter(({ method }) => method === "set")[0]?.args[0]).toMatchObject({
      state: "completed",
      result_snapshot_id: "snapshot-1",
    });

    await expect(
      repo.skipStep(scope, runId, "gsc", "source_not_connected"),
    ).resolves.toBe(true);
    expect(db.calls.filter(({ method }) => method === "set")[1]?.args[0]).toMatchObject({
      state: "skipped",
      skip_reason: "source_not_connected",
    });

    await expect(
      repo.failStep(scope, runId, "ga4", {
        childAsyncRunId: "child-2",
        error: {
          code: "PROVIDER_FAILED",
          summary: "The connected provider failed after bounded retries.",
        },
      }),
    ).resolves.toBe(true);
    expect(db.calls.filter(({ method }) => method === "set")[2]?.args[0]).toMatchObject({
      state: "failed",
      child_async_run_id: "child-2",
      error: { code: "PROVIDER_FAILED" },
    });
  });

  it("rejects unbounded worker-authored skip and error details before SQL", async () => {
    const { db, repo } = fixture();

    await expect(
      repo.skipStep(scope, runId, "gsc", ` ${"x".repeat(500)}`),
    ).rejects.toThrow(/skip reason/i);
    await expect(
      repo.failStep(scope, runId, "crawl", {
        childAsyncRunId: null,
        error: { code: "", summary: "failed" },
      }),
    ).rejects.toThrow(/errors require bounded/i);
    expect(db.calls).toEqual([]);
  });
});
