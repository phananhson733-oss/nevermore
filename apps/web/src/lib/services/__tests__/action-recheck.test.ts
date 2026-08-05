import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  CompetitorsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  FindingsRepository,
  FindingTargetsRepository,
  IcpProfilesRepository,
  IdempotencyRepository,
  KeywordsRepository,
  ProjectsRepository,
  SitesRepository,
  type DataSnapshotRow,
} from "@sf/db";
import {
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
} from "@sf/sources";
import type { CreateActionRecheckRequest } from "@sf/contracts";

const mocks = vi.hoisted(() => {
  const tx = {};
  const db = {
    transaction: vi.fn(async (callback: (executor: object) => unknown) =>
      callback(tx),
    ),
  };
  return {
    db,
    tx,
    enqueueRunInTx: vi.fn(async () => "job-1"),
    getBoss: vi.fn(async () => ({ name: "boss" })),
  };
});

vi.mock("@sf/db", async () => {
  const actual = await vi.importActual<typeof import("@sf/db")>("@sf/db");
  return { ...actual, enqueueRunInTx: mocks.enqueueRunInTx };
});
vi.mock("@/lib/db", () => ({ getDb: () => ({ db: mocks.db }) }));
vi.mock("@/lib/boss", () => ({ getBoss: mocks.getBoss }));

const { createActionRecheck } = await import("../action-recheck.ts");

const workspaceId = "00000000-0000-4000-8000-000000000011";
const projectId = "00000000-0000-4000-8000-000000000012";
const actorId = "00000000-0000-4000-8000-000000000013";
const siteId = "00000000-0000-4000-8000-000000000014";
const icpProfileId = "00000000-0000-4000-8000-000000000015";
const snapshotId = "00000000-0000-4000-8000-000000000016";
const runId = "00000000-0000-4000-8000-000000000017";
const auditRunId = "00000000-0000-4000-8000-000000000018";
const priorRunId = "00000000-0000-4000-8000-000000000019";
const priorDiagnosticRunId = "00000000-0000-4000-8000-00000000001a";
const actionId = "00000000-0000-4000-8000-00000000001b";
const findingId = "00000000-0000-4000-8000-00000000001c";
const idempotencyKey = "recheck-key";
const legacyProfile = {
  productName: "Acme",
  oneLineDescription: "Ship faster",
  productType: "saas",
  businessModels: ["subscription"],
  marketCodes: ["US"],
  segments: ["Growth teams"],
  primaryConversion: {
    label: "Book a demo",
    type: "contact",
    targetUrl: "https://example.test/demo",
  },
  priorityUrls: ["https://example.test/pricing"],
  technicalConstraints: ["Legacy CMS"],
  resourceConstraints: ["One engineer"],
} as const;

const body: CreateActionRecheckRequest = {
  actionId,
  priorRunId,
  targetScope: { kind: "http_status", ref: "404" },
  capabilityContractVersion: "growth-audit.0.3.0",
};

const crawlSnapshot: DataSnapshotRow = {
  id: snapshotId,
  workspace_id: workspaceId,
  project_id: projectId,
  site_id: siteId,
  collection_run_id: "00000000-0000-4000-8000-000000000021",
  source_connection_id: "00000000-0000-4000-8000-000000000022",
  provider: "crawl",
  dataset_key: CRAWL_DATASET_KEY,
  schema_version: "crawl.site_graph.0.3.0",
  method_version: CRAWL_METHOD_VERSION,
  captured_at: "2026-07-23 09:02:03.000000+08",
  source_window: { end: null, start: null },
  availability: "available",
  limitation: "Static public crawl only.",
  raw_object_key: "raw/fixture.json",
  row_count: 3,
  checksum: "a".repeat(64),
  summary: {},
  created_at: "2026-07-23T01:02:04.000Z",
};

const queuedRun = {
  id: runId,
  workspace_id: workspaceId,
  project_id: projectId,
  kind: "diagnostic",
  status: "queued",
  active_key: `growth_audit_recheck:${actionId}`,
  contract_version: "2026-07-21",
  request_payload: {},
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: null,
  result_id: null,
  attempt_count: 0,
  initiated_by: actorId,
  queued_at: "2026-07-24T00:00:00.000Z",
  started_at: null,
  completed_at: null,
};

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: projectId,
    workspace_id: workspaceId,
    archived_at: null,
    confirmed_icp_profile_id: icpProfileId,
    ...overrides,
  } as never;
}

function priorAuditRun(overrides: Record<string, unknown> = {}) {
  return {
    id: priorRunId,
    workspace_id: workspaceId,
    project_id: projectId,
    diagnostic_run_id: priorDiagnosticRunId,
    capability_run_id: priorDiagnosticRunId,
    scope_kind: "site",
    scope_key: siteId,
    projection_version: "growth-audit.0.3.0",
    created_at: "2026-07-22T00:00:00.000Z",
    ...overrides,
  } as never;
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: actionId,
    source_finding_id: findingId,
    source_diagnostic_run_id: priorDiagnosticRunId,
    ...overrides,
  } as never;
}

function rootTarget(overrides: Record<string, unknown> = {}) {
  return {
    relation: "affected_by_http_status",
    target_kind: "http_status",
    target_ref: "404",
    resolution_state: "resolved",
    ...overrides,
  } as never;
}

function mockContext(overrides: {
  prior?: unknown;
  actionRow?: unknown;
  targets?: unknown[];
} = {}) {
  vi.spyOn(AuditRunsRepository.prototype, "findById").mockResolvedValue(
    (overrides.prior ?? priorAuditRun()) as never,
  );
  vi.spyOn(ActionsRepository.prototype, "findById").mockResolvedValue(
    (overrides.actionRow ?? action()) as never,
  );
  vi.spyOn(FindingsRepository.prototype, "findById").mockResolvedValue({
    id: findingId,
    rule_id: "TECH-HTTP-001",
  } as never);
  vi.spyOn(
    FindingTargetsRepository.prototype,
    "listForFindings",
  ).mockResolvedValue((overrides.targets ?? [rootTarget()]) as never);
  vi.spyOn(DiagnosticRunsRepository.prototype, "findById").mockResolvedValue({
    id: priorDiagnosticRunId,
    site_id: siteId,
    output_locale: "en",
  } as never);
}

function mockHappyPathInputs() {
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
    id: icpProfileId,
    version: 4,
    content_hash: "b".repeat(64),
    status: "complete",
    profile: legacyProfile,
  } as never);
  vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
    id: siteId,
    language_codes: ["fr-CA"],
  } as never);
  vi.spyOn(
    DataSnapshotsRepository.prototype,
    "findLatestEligibleBySite",
  ).mockImplementation(async (_scope, _siteId, selectors) =>
    selectors[0]?.datasetKey ===
    DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY
      ? []
      : [crawlSnapshot],
  );
  vi.spyOn(
    KeywordsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue([]);
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue([]);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.db.transaction.mockImplementation(
    async (callback: (executor: object) => unknown) => callback(mocks.tx),
  );
});

describe("createActionRecheck validation", () => {
  it("rejects an unknown prior run with NOT_FOUND", async () => {
    vi.spyOn(AuditRunsRepository.prototype, "findById").mockResolvedValue(null);
    await expect(
      createActionRecheck({ workspaceId }, projectId, actorId, idempotencyKey, body),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("rejects an unknown action with NOT_FOUND", async () => {
    vi.spyOn(AuditRunsRepository.prototype, "findById").mockResolvedValue(
      priorAuditRun(),
    );
    vi.spyOn(ActionsRepository.prototype, "findById").mockResolvedValue(null);
    await expect(
      createActionRecheck({ workspaceId }, projectId, actorId, idempotencyKey, body),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("rejects an action that does not belong to the prior run with VALIDATION_ERROR", async () => {
    mockContext({
      actionRow: action({
        source_diagnostic_run_id: "00000000-0000-4000-8000-0000000000ff",
      }),
    });
    await expect(
      createActionRecheck({ workspaceId }, projectId, actorId, idempotencyKey, body),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("rejects a target scope that does not match the root target with VALIDATION_ERROR", async () => {
    mockContext({ targets: [rootTarget({ target_ref: "500" })] });
    await expect(
      createActionRecheck({ workspaceId }, projectId, actorId, idempotencyKey, body),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });
});

describe("createActionRecheck transaction", () => {
  it("creates an isolated recheck audit run over fresh crawl data", async () => {
    mockContext();
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue({
      id: "00000000-0000-4000-8000-0000000000aa",
    } as never);
    const complete = vi
      .spyOn(IdempotencyRepository.prototype, "complete")
      .mockResolvedValue(undefined as never);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue(project());
    mockHappyPathInputs();
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(
      null,
    );
    const insertQueued = vi
      .spyOn(AsyncRunsRepository.prototype, "insertQueued")
      .mockResolvedValue(queuedRun as never);
    const diagnosticInsert = vi
      .spyOn(DiagnosticRunsRepository.prototype, "insert")
      .mockResolvedValue(undefined as never);
    const capabilityCreate = vi
      .spyOn(CapabilityRunsRepository.prototype, "create")
      .mockResolvedValue({
        async_run_id: runId,
      } as never);
    const auditCreate = vi
      .spyOn(AuditRunsRepository.prototype, "create")
      .mockResolvedValue({ id: auditRunId } as never);

    const result = await createActionRecheck(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    );

    expect(result).toMatchObject({
      status: 202,
      replayed: false,
      resourceRef: { type: "audit_run", id: auditRunId },
    });
    expect(mocks.db.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
    });
    expect(insertQueued).toHaveBeenCalledTimes(1);
    expect(insertQueued.mock.calls[0]?.[0]).toMatchObject({
      kind: "diagnostic",
      activeKey: `growth_audit_recheck:${actionId}`,
    });
    expect(insertQueued.mock.calls[0]?.[0].requestPayload).toMatchObject({
      operation: "growth_audit_recheck",
      priorRunId,
      actionId,
      targetScope: { kind: "http_status", ref: "404" },
      selectedSnapshotIds: [snapshotId],
    });
    const inputManifest = diagnosticInsert.mock.calls[0]?.[0]
      .inputManifest as Record<string, unknown>;
    expect(Object.keys(inputManifest).sort()).toEqual([
      "contextProjection",
      "deliveryLocale",
      "governance",
      "icp",
      "projectId",
      "promptSetVersion",
      "ruleSetVersion",
      "siteId",
      "snapshots",
    ]);
    expect(inputManifest).toMatchObject({
      governance: {
        projectionVersion: "growth-governance.1.0.0",
        keywordClusters: [],
        competitors: [],
      },
      contextProjection: {
        profileGeneration: "legacy-icp.v1",
        siteLanguage: {
          sourceKind: "site",
          state: "declared_non_empty",
          languageCodes: ["fr-CA"],
        },
      },
    });
    expect(capabilityCreate).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      asyncRunId: runId,
      capabilityId: "growth-audit",
      capabilityVersion: "0.3.0",
      inputManifestHash: contentHash({
        capabilityId: "growth-audit",
        capabilityVersion: "0.3.0",
        capabilityContractVersion: "growth-audit.0.3.0",
        operation: "growth_audit_recheck",
        projectId,
        siteId,
        icpProfileId,
        actionId,
        priorRunId,
        targetScope: { kind: "http_status", ref: "404" },
        selectedSnapshotIds: [snapshotId],
        outputLocale: "en",
      }),
      mode: "production",
      sideEffectClass: "read_only",
    });
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({
      diagnosticRunId: runId,
      capabilityRunId: runId,
      scopeKind: "site",
      scopeKey: siteId,
      projectionVersion: "growth-audit-recheck.0.3.0",
    });
    expect(mocks.enqueueRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      mocks.tx,
      "diagnose",
      expect.objectContaining({ runId }),
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("replays the accepted run without reading later mutable Profile or Site state", async () => {
    mockContext();
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue({
      request_hash: contentHash({
        projectId,
        actionId,
        priorRunId,
        targetScope: { kind: "http_status", ref: "404" },
        outputLocale: "en",
      }),
      status: "completed",
      resource_id: auditRunId,
      response_body: {
        run: { id: runId },
        statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
        resourceRef: { type: "audit_run", id: auditRunId },
      },
    } as never);
    const projectRead = vi.spyOn(ProjectsRepository.prototype, "findById");
    const profileRead = vi.spyOn(IcpProfilesRepository.prototype, "findById");
    const siteRead = vi.spyOn(SitesRepository.prototype, "findById");

    await expect(
      createActionRecheck(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({
      status: 202,
      replayed: true,
      resourceRef: { type: "audit_run", id: auditRunId },
    });

    expect(projectRead).not.toHaveBeenCalled();
    expect(profileRead).not.toHaveBeenCalled();
    expect(siteRead).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("returns RUN_ALREADY_ACTIVE when a recheck for the action is active", async () => {
    mockContext();
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue({
      id: runId,
    } as never);
    await expect(
      createActionRecheck({ workspaceId }, projectId, actorId, idempotencyKey, body),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      // Body and header locate the same winning run, so a client that reads
      // only the body is not left with an unfollowable conflict.
      current: {
        runId,
        statusUrl: expect.stringContaining(`/runs/${runId}`),
      },
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("does not claim an active recheck when the unique race leaves no winner", async () => {
    mockContext();
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    // Blind on both reads: the index aborts only when a run WAS active and
    // `findActive` sees only `queued`/`running`, so this is the real race in
    // which the winner left both states in between.
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(
      null,
    );
    mocks.db.transaction.mockRejectedValueOnce({
      code: "23505",
      constraint: "async_runs_one_active_key_idx",
    });

    const error = await createActionRecheck(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      // Explicitly null rather than absent, and no invented `Location`. The
      // key still names the contended Action, which is the one locatable fact
      // that survives the race.
      current: {
        runId: null,
        statusUrl: null,
        activeKey: expect.stringContaining(body.actionId),
      },
      extraHeaders: undefined,
    });
    expect((error as Error).message).not.toContain("is already active");
  });
});
