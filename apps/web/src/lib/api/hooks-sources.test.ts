import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import {
  activeProjectRunIdFromError,
  analysisRefreshRunIdFromError,
  collectionRunIdFromError,
  createAnalysisRefreshRun,
  createCollectionRun,
  invalidateAnalysisRefreshTerminalQueries,
  readAnalysisRefreshRunId,
  withAnalysisRefreshRunId,
  type AsyncAcceptedData,
  type AsyncRun,
  type CreateCollectionRunVariables,
} from "./hooks-sources";

const projectId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";

function ok(data: unknown, status = 202): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function problem(
  code: string,
  current?: Readonly<Record<string, unknown>>,
): ApiError {
  return new ApiError({
    type: "about:blank",
    title: code,
    status: 409,
    code,
    detail: code,
    requestId: "request-1",
    ...(current === undefined ? {} : { current }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Customer collection Sources API", () => {
  it("keeps the existing GSC request body and idempotency behavior", async () => {
    const accepted = {
      run: {
        id: runId,
        projectId,
        kind: "collection",
        status: "queued",
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "run.queued",
        },
        lastError: null,
        resultRef: { type: "collection_run", id: runId },
        queuedAt: "2026-07-29T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
      },
      statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
      resourceRef: { type: "collection_run", id: runId },
    } satisfies AsyncAcceptedData;
    const fetchMock = vi.fn().mockResolvedValue(ok(accepted));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createCollectionRun(projectId, "collection-idem-1", {
        provider: "gsc",
        sourceConnectionId: runId,
      }),
    ).resolves.toEqual(accepted);

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/mvp/projects/${projectId}/collection-runs`);
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "Idempotency-Key": "collection-idem-1",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      provider: "gsc",
      sourceConnectionId: runId,
    });
  });

  it("does not send a bypassed DataForSEO command", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const bypassedVariables = {
      provider: "dataforseo",
      apiKey: "must-never-cross-the-customer-boundary",
    } as unknown as CreateCollectionRunVariables;

    await expect(
      createCollectionRun(
        projectId,
        "collection-idem-internal-provider",
        bypassedVariables,
      ),
    ).rejects.toThrow(
      "Direct collection supports only crawl, gsc, and ga4 providers.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adopts only the active Crawl run pointer for the current project", () => {
    expect(
      collectionRunIdFromError(
        problem("RUN_ALREADY_ACTIVE", {
          runId,
          statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
        }),
        projectId,
      ),
    ).toBe(runId);

    expect(
      collectionRunIdFromError(
        problem("RUN_ALREADY_ACTIVE", {
          runId,
          statusUrl: `/api/mvp/projects/00000000-0000-4000-8000-000000000099/runs/${runId}`,
        }),
        projectId,
      ),
    ).toBeNull();
    expect(
      collectionRunIdFromError(
        problem("DEPENDENCY_UNAVAILABLE", {
          runId,
          statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
        }),
        projectId,
      ),
    ).toBeNull();
  });

  it("uses the same strict project-run boundary for synthesis adoption", () => {
    expect(
      activeProjectRunIdFromError(
        problem("RUN_ALREADY_ACTIVE", {
          runId,
          statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
        }),
        projectId,
      ),
    ).toBe(runId);
    expect(
      activeProjectRunIdFromError(
        problem("RUN_ALREADY_ACTIVE", {
          runId,
          statusUrl: `/api/mvp/projects/${projectId}/product-profile/runs/${runId}`,
        }),
        projectId,
      ),
    ).toBeNull();
  });
});

describe("Analysis Refresh Sources API", () => {
  it("POSTs the strict empty object with the caller's idempotency key", async () => {
    const accepted: AsyncAcceptedData = {
      run: {
        id: runId,
        projectId,
        kind: "analysis_refresh",
        status: "queued",
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "run.queued",
        },
        lastError: null,
        resultRef: { type: "analysis_refresh_run", id: runId },
        queuedAt: "2026-07-29T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
      },
      statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
      resourceRef: { type: "analysis_refresh_run", id: runId },
    };
    const fetchMock = vi.fn().mockResolvedValue(ok(accepted));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createAnalysisRefreshRun(projectId, "analysis-refresh-idem-1"),
    ).resolves.toEqual(accepted);

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(
      `/api/mvp/projects/${projectId}/analysis-refresh-runs`,
    );
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "Idempotency-Key": "analysis-refresh-idem-1",
    });
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("keeps the unified run DTO open to every current run/resource discriminator", () => {
    const run: AsyncRun = {
      id: runId,
      projectId,
      kind: "analysis_refresh",
      status: "partial",
      progress: {
        phase: "growth_audit",
        current: 4,
        total: 5,
        messageKey: "run.partial",
      },
      lastError: { code: "OPTIONAL_STEP_FAILED", summary: "GSC failed." },
      resultRef: { type: "analysis_refresh_run", id: runId },
      queuedAt: "2026-07-29T00:00:00.000Z",
      startedAt: "2026-07-29T00:00:01.000Z",
      completedAt: "2026-07-29T00:01:00.000Z",
    };
    expect(run.kind).toBe("analysis_refresh");
    expect(run.resultRef?.type).toBe("analysis_refresh_run");
  });

  it("mints a fresh idempotency key in the mutation hook", () => {
    const source = readFileSync(
      new URL("./hooks-sources.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "createAnalysisRefreshRun(projectId, crypto.randomUUID())",
    );
  });
});

describe("Analysis Refresh URL/conflict recovery", () => {
  it("recovers only a valid UUID from analysisRefreshRunId", () => {
    expect(
      readAnalysisRefreshRunId(
        `?provider=gsc&analysisRefreshRunId=${runId}`,
      ),
    ).toBe(runId);
    expect(readAnalysisRefreshRunId("?analysisRefreshRunId=../../secret")).toBe(
      null,
    );
  });

  it("sets and deletes only its own query parameter", () => {
    const started = withAnalysisRefreshRunId(
      "/p/project/sources?provider=gsc&oauthIntentId=keep#status",
      runId,
    );
    expect(started).toBe(
      `/p/project/sources?provider=gsc&oauthIntentId=keep&analysisRefreshRunId=${runId}#status`,
    );
    expect(withAnalysisRefreshRunId(started, null)).toBe(
      "/p/project/sources?provider=gsc&oauthIntentId=keep#status",
    );
  });

  it("adopts only a valid RUN_ALREADY_ACTIVE current.runId", () => {
    expect(
      analysisRefreshRunIdFromError(
        problem("RUN_ALREADY_ACTIVE", {
          runId,
          statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
        }),
      ),
    ).toBe(runId);
    expect(
      analysisRefreshRunIdFromError(
        problem("RUN_ALREADY_ACTIVE", { runId: "../foreign" }),
      ),
    ).toBeNull();
    expect(
      analysisRefreshRunIdFromError(
        problem("DEPENDENCY_UNAVAILABLE", { runId }),
      ),
    ).toBeNull();
  });
});

describe("Analysis Refresh terminal invalidation", () => {
  it("refreshes sources, snapshots, audit, and downstream growth projections", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    await invalidateAnalysisRefreshTerminalQueries(queryClient, projectId);

    expect(
      invalidate.mock.calls.map(([filters]) => filters?.queryKey),
    ).toEqual([
      ["sources", projectId],
      ["snapshots", projectId],
      ["growth-audit", projectId],
      ["growth-map", projectId],
      ["findings", projectId],
      ["opportunities", projectId],
      ["workspace", projectId],
      ["project", projectId],
    ]);
    expect(
      invalidate.mock.calls.every(
        ([filters]) => filters?.refetchType === "active",
      ),
    ).toBe(true);
  });
});
