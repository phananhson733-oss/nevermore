import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  DiagnosticRunsRepository,
  IcpProfilesRepository,
  type AsyncRunRow,
  type DiagnosticRunRow,
} from "@sf/db";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import { runDiagnostic, warnOnSlowRules } from "./run-diagnostic.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diagnostic slow-rule warnings (spec §8.3)", () => {
  it("warns above 250ms without imposing a per-rule timeout", () => {
    const warn = vi.fn();
    const logger: Logger = {
      context: { service: "worker", environment: "test" },
      child: () => logger,
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    };

    warnOnSlowRules(logger, "run-fixture", [
      { ruleId: "TECH-HTTP-001", durationMs: 250 },
      { ruleId: "TECH-CANONICAL-002", durationMs: 251 },
    ]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("diagnostic_rule_slow", {
      runId: "run-fixture",
      ruleId: "TECH-CANONICAL-002",
      durationMs: 251,
    });
  });
});

describe("diagnostic retry classification", () => {
  it("resets and rethrows a transient PostgreSQL transaction failure", async () => {
    const scope = { workspaceId: "workspace-1", projectId: "project-1" };
    const run = {
      id: "run-1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "running",
      active_key: "diagnostic",
      contract_version: "0.2.0",
      request_payload: {},
      progress: {},
      last_error_code: null,
      last_error_summary: null,
      result_type: null,
      result_id: null,
      attempt_count: 1,
      initiated_by: "actor-1",
      queued_at: "2026-07-19T00:00:00.000Z",
      started_at: "2026-07-19T00:00:01.000Z",
      completed_at: null,
    } satisfies AsyncRunRow;
    const diagnostic = {
      id: run.id,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      icp_profile_id: "icp-1",
      icp_profile_version: 1,
      rule_set_version: "rules-v1",
      prompt_set_version: "prompts-v1",
      output_locale: "en",
      input_manifest: { snapshots: [] },
      input_hash: "hash",
      coverage: {},
      created_at: "2026-07-19T00:00:00.000Z",
    } satisfies DiagnosticRunRow;
    const databaseFailure = Object.assign(new Error("serialization failure"), {
      code: "40001",
    });
    const warn = vi.fn();
    const error = vi.fn();
    const logger: Logger = {
      context: { service: "worker", environment: "test" },
      child: () => logger,
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error,
    };
    const ctx = {
      db: {} as WorkerContext["db"],
      logger,
    } as WorkerContext;

    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
    const reset = vi
      .spyOn(AsyncRunsRepository.prototype, "resetToQueued")
      .mockResolvedValue();
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue();
    vi.spyOn(
      DiagnosticRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(diagnostic);
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockRejectedValue(
      databaseFailure,
    );

    await expect(
      runDiagnostic(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(databaseFailure);
    expect(reset).toHaveBeenCalledWith(run.id);
    expect(terminal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("diagnostic_transient_error", {
      runId: run.id,
      code: "40001",
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("terminalizes a permanent failure without logging arbitrary error content", async () => {
    const scope = { workspaceId: "workspace-1", projectId: "project-1" };
    const run = {
      id: "run-1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "running",
      active_key: "diagnostic",
      contract_version: "0.2.0",
      request_payload: {},
      progress: {},
      last_error_code: null,
      last_error_summary: null,
      result_type: null,
      result_id: null,
      attempt_count: 1,
      initiated_by: "actor-1",
      queued_at: "2026-07-19T00:00:00.000Z",
      started_at: "2026-07-19T00:00:01.000Z",
      completed_at: null,
    } satisfies AsyncRunRow;
    const diagnostic = {
      id: run.id,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      icp_profile_id: "icp-1",
      icp_profile_version: 1,
      rule_set_version: "rules-v1",
      prompt_set_version: "prompts-v1",
      output_locale: "en",
      input_manifest: { snapshots: [] },
      input_hash: "hash",
      coverage: {},
      created_at: "2026-07-19T00:00:00.000Z",
    } satisfies DiagnosticRunRow;
    const error = vi.fn();
    const logger: Logger = {
      context: { service: "worker", environment: "test" },
      child: () => logger,
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error,
    };
    const ctx = {
      db: {} as WorkerContext["db"],
      logger,
    } as WorkerContext;

    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue();
    vi.spyOn(
      DiagnosticRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(diagnostic);
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockRejectedValue(
      new Error("parser rejected customer-content-secret"),
    );

    await runDiagnostic(ctx, { runId: run.id, ...scope });

    expect(error).toHaveBeenCalledWith("diagnostic_failed", {
      runId: run.id,
      code: "UNAVAILABLE",
      type: "internal",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      "customer-content-secret",
    );
    expect(terminal).toHaveBeenCalledWith(run.id, {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
  });
});
