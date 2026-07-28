import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  type AsyncRunRow,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";
import {
  MeasurementNotDueError,
  runMeasurement,
  type MeasurementExecutionEvidence,
  type MeasurementExecutionDependencies,
} from "./run-measurement.ts";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  run: "00000000-0000-4000-8000-000000000003",
  window: "00000000-0000-4000-8000-000000000004",
  change: "00000000-0000-4000-8000-000000000005",
  delivery: "00000000-0000-4000-8000-000000000006",
  attempt: "00000000-0000-4000-8000-000000000007",
  site: "00000000-0000-4000-8000-000000000008",
  page: "00000000-0000-4000-8000-000000000009",
  action: "00000000-0000-4000-8000-00000000000a",
  artifact: "00000000-0000-4000-8000-00000000000b",
  revision: "00000000-0000-4000-8000-00000000000c",
};

const artifactHash = "a".repeat(64);
const contentChecksum = "b".repeat(64);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("runMeasurement", () => {
  it("materializes an immutable unavailable result instead of inventing source rows or zero metrics", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      measurementRun(),
    );
    const dependencies = measurementDependencies();

    await runMeasurement(context(), job(), dependencies);

    expect(dependencies.loadEvidence).toHaveBeenCalledTimes(1);
    expect(dependencies.finalize).toHaveBeenCalledTimes(1);
    const completion = vi.mocked(dependencies.finalize).mock.calls[0]![0];
    expect(completion.window).toMatchObject({
      measurementWindowId: ids.window,
      projectId: ids.project,
      siteId: ids.site,
      state: "unavailable",
      interpretation: "observational_non_causal",
      technicalVerificationRef: null,
      beforeWindow: {
        startAt: "2026-01-01T00:00:00.000Z",
        endAt: "2026-01-29T00:00:00.000Z",
      },
      afterWindow: {
        startAt: "2026-01-29T00:00:00.000Z",
        endAt: "2026-02-26T00:00:00.000Z",
      },
      dimensions: {
        gsc: {
          baselineSource: null,
          outcomeSource: null,
          metrics: {
            clicks: { baseline: null, outcome: null },
          },
        },
        ga4: {
          directConversionDefinition: null,
          assistedConversionDefinition: null,
        },
        geo: {
          state: "unavailable",
          baselineSource: null,
          outcomeSource: null,
        },
      },
      recordedAt: "2026-03-02T00:00:00.000Z",
    });
    expect(completion.observationLineage).toEqual({
      gsc: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
      ga4: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
      geo: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
    });
  });

  it("does not materialize before the server-frozen provider settlement deadline", async () => {
    const run = measurementRun();
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
    const reset = vi
      .spyOn(AsyncRunsRepository.prototype, "resetToQueued")
      .mockResolvedValue(true);
    const dependencies = measurementDependencies({
      now: new Date("2026-03-01T23:59:59.999Z"),
    });

    await expect(
      runMeasurement(context(), job(), dependencies),
    ).rejects.toBeInstanceOf(MeasurementNotDueError);

    expect(dependencies.loadEvidence).not.toHaveBeenCalled();
    expect(dependencies.finalize).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: ids.run,
        attemptCount: 1,
      }),
      {
        code: "MEASUREMENT_NOT_DUE",
        summary:
          "The fixed outcome window is still waiting for provider settlement.",
      },
    );
  });

  it("fails closed on a malformed or cross-scope frozen payload without reading provider evidence", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      measurementRun({
        request_payload: {
          ...measurementRun().request_payload,
          frozenFacts: {
            ...(measurementRun().request_payload[
              "frozenFacts"
            ] as Record<string, unknown>),
            projectId: "00000000-0000-4000-8000-000000000099",
          },
        },
      }),
    );
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    const dependencies = measurementDependencies();

    await runMeasurement(context(), job(), dependencies);

    expect(dependencies.loadEvidence).not.toHaveBeenCalled();
    expect(dependencies.finalize).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(
      expect.objectContaining({ runId: ids.run, attemptCount: 1 }),
      {
        status: "failed",
        lastErrorCode: "MEASUREMENT_FROZEN_FACTS_INVALID",
        lastErrorSummary:
          "The immutable Measurement Window authority failed validation.",
      },
    );
  });

  it("returns a transient dependency failure to queued so pg-boss can retry the same fenced run", async () => {
    const failure = new Error("temporary database outage");
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      measurementRun(),
    );
    const reset = vi
      .spyOn(AsyncRunsRepository.prototype, "resetToQueued")
      .mockResolvedValue(true);
    const dependencies = measurementDependencies();
    vi.mocked(dependencies.loadEvidence).mockRejectedValue(failure);

    await expect(
      runMeasurement(context(), job(), dependencies),
    ).rejects.toBe(failure);

    expect(reset).toHaveBeenCalledWith(
      expect.objectContaining({ runId: ids.run, attemptCount: 1 }),
      {
        code: "MEASUREMENT_DEPENDENCY_UNAVAILABLE",
        summary:
          "Measurement evidence could not be read or committed.",
      },
    );
  });
});

function job() {
  return {
    runId: ids.run,
    workspaceId: ids.workspace,
    projectId: ids.project,
    contractVersion: "measurement.0.1.0",
  };
}

function measurementRun(
  overrides: Partial<AsyncRunRow> = {},
): AsyncRunRow {
  return {
    id: ids.run,
    workspace_id: ids.workspace,
    project_id: ids.project,
    kind: "measurement",
    status: "running",
    active_key: `measurement:${ids.change}`,
    contract_version: "measurement.0.1.0",
    request_payload: {
      operation: "measurement_window",
      idempotencyKey: "measurement-key",
      requestHash: "c".repeat(64),
      frozenFacts: {
        workspaceId: ids.workspace,
        projectId: ids.project,
        changeReceiptId: ids.change,
        publicationAttemptId: ids.attempt,
        siteId: ids.site,
        sitePageId: ids.page,
        target: {
          kind: "url",
          targetRef: `site-page://${ids.page}`,
          sitePageId: ids.page,
        },
        actionId: ids.action,
        artifactId: ids.artifact,
        artifactRevisionId: ids.revision,
        artifactRevision: 2,
        artifactContentHash: artifactHash,
        contentChecksum,
        timelineDeliveryReceiptId: ids.delivery,
        url: "https://example.com/page",
        canonicalUrl: "https://example.com/page",
        beforeWindow: {
          startAt: "2026-01-01T00:00:00.000Z",
          endAt: "2026-01-29T00:00:00.000Z",
        },
        afterWindow: {
          startAt: "2026-01-29T00:00:00.000Z",
          endAt: "2026-02-26T00:00:00.000Z",
        },
        timezone: "UTC",
        interpretation: "observational_non_causal",
        startAfter: "2026-03-02T00:00:00.000Z",
      },
    },
    progress: {},
    last_error_code: null,
    last_error_summary: null,
    result_type: "measurement_window",
    result_id: ids.window,
    attempt_count: 1,
    initiated_by: "00000000-0000-4000-8000-00000000000d",
    queued_at: "2026-01-29T00:00:00.000Z",
    started_at: "2026-03-02T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

function measurementDependencies(
  options: { readonly now?: Date } = {},
): MeasurementExecutionDependencies {
  return {
    now: () =>
      options.now ?? new Date("2026-03-02T00:00:00.000Z"),
    loadEvidence: vi.fn(async (): Promise<MeasurementExecutionEvidence> => ({
      verifiedChangeReceipt: {
        id: ids.change,
        providerKind: "github",
        providerRequestId: "request-1",
        remoteScopeRef: "owner/repo",
        remoteObjectId: "42",
        remoteRevision: "merge-sha",
        deliveryUrl: "https://github.com/owner/repo/pull/42",
        artifactContentHash: artifactHash,
        contentChecksum,
        remoteFacts: {},
        observedAt: "2026-01-29T00:00:00.000Z",
        receiptKind: "change_receipt",
        predecessorDeliveryReceiptId: ids.delivery,
        remoteObjectKind: "github_merge",
        liveCanonicalUrl: "https://example.com/page",
        verificationState: "verified_live",
        evidenceRefs: ["provider:github:merge-sha"],
        limitation: null,
      },
      timelineDeliveryReceipt: {
        id: ids.delivery,
        providerKind: "github",
        providerRequestId: "request-1",
        remoteScopeRef: "owner/repo",
        remoteObjectId: "42",
        remoteRevision: "head-sha",
        deliveryUrl: "https://github.com/owner/repo/pull/42",
        artifactContentHash: artifactHash,
        contentChecksum,
        remoteFacts: {},
        observedAt: "2026-01-28T00:00:00.000Z",
        receiptKind: "delivery_receipt",
        predecessorDeliveryReceiptId: null,
        remoteObjectKind: "github_pull_request",
        liveCanonicalUrl: null,
        verificationState: "provider_accepted",
        evidenceRefs: [],
        limitation: null,
      },
      providerEvidence: [],
    })),
    finalize: vi.fn(async () => true),
  };
}

function context(): WorkerContext {
  return {
    db: {} as never,
    boss: {} as never,
    blobStore: {} as never,
    credentialKey: Buffer.alloc(32),
    appOrigin: "https://app.example.com",
    googleOAuth: { clientId: "id", clientSecret: "secret" },
    openai: { apiKey: "key", model: "model" },
    findingSummariesEnabled: false,
    logger: {
      child: vi.fn(() => ({})),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as never,
  };
}
