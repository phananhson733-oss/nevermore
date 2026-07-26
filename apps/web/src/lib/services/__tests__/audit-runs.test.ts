import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitesRepository,
  type DataSnapshotRow,
} from "@sf/db";
import {
  CreateGrowthAuditRunRequest,
  GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
} from "@sf/contracts";
import { CRAWL_DATASET_KEY, CRAWL_METHOD_VERSION } from "@sf/sources";

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

const { createGrowthAuditRun } = await import("../audit-runs.ts");

const workspaceId = "00000000-0000-4000-8000-000000000011";
const projectId = "00000000-0000-4000-8000-000000000012";
const actorId = "00000000-0000-4000-8000-000000000013";
const siteId = "00000000-0000-4000-8000-000000000014";
const icpProfileId = "00000000-0000-4000-8000-000000000015";
const snapshotId = "00000000-0000-4000-8000-000000000016";
const runId = "00000000-0000-4000-8000-000000000017";
const auditRunId = "00000000-0000-4000-8000-000000000018";
const idempotencyKey = "growth-audit-key";

const body: CreateGrowthAuditRunRequest = {
  siteId,
  icpProfileId,
  scope: { kind: "site" },
  outputLocale: "en",
  capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
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
  captured_at: "2026-07-21 09:02:03.000000+08",
  source_window: { end: null, start: null },
  availability: "available",
  limitation: "Static public crawl only.",
  raw_object_key: "raw/fixture.json",
  row_count: 3,
  checksum: "a".repeat(64),
  summary: {},
  created_at: "2026-07-21T01:02:04.000Z",
};

const queuedRun = {
  id: runId,
  workspace_id: workspaceId,
  project_id: projectId,
  kind: "diagnostic",
  status: "queued",
  active_key: "growth_audit",
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

function requestHash(): string {
  return contentHash({
    projectId,
    siteId,
    icpProfileId,
    scope: { kind: "site" },
    outputLocale: "en",
  });
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: projectId,
    workspace_id: workspaceId,
    archived_at: null,
    confirmed_icp_profile_id: icpProfileId,
    ...overrides,
  } as never;
}

function mockHappyPathInputs() {
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
    id: icpProfileId,
    version: 4,
    content_hash: "b".repeat(64),
    status: "complete",
  } as never);
  vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
    id: siteId,
  } as never);
  vi.spyOn(
    DataSnapshotsRepository.prototype,
    "findLatestEligibleCrawlBySite",
  ).mockResolvedValue({ id: snapshotId } as never);
  vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
    crawlSnapshot,
  ]);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.db.transaction.mockImplementation(
    async (callback: (executor: object) => unknown) => callback(mocks.tx),
  );
});

describe("createGrowthAuditRun hard gates", () => {
  it("rejects a missing confirmed profile with CONTEXT_INCOMPLETE", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project({ confirmed_icp_profile_id: null }),
    );
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("rejects an audit that does not reference the confirmed profile", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project({
        confirmed_icp_profile_id: "00000000-0000-4000-8000-0000000000ff",
      }),
    );
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
  });

  it("rejects an archived project with PROJECT_ARCHIVED", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project({ archived_at: "2026-07-01T00:00:00.000Z" }),
    );
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED", status: 422 });
  });

  it("requires a usable crawl snapshot", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
      id: icpProfileId,
      version: 4,
      content_hash: "b".repeat(64),
      status: "complete",
    } as never);
    vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
      id: siteId,
    } as never);
    vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findLatestEligibleCrawlBySite",
    ).mockResolvedValue(null);
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "CRAWL_SNAPSHOT_REQUIRED", status: 422 });
  });
});

describe("createGrowthAuditRun contract", () => {
  it("rejects an illegal capabilityContractVersion at the boundary", () => {
    const result = CreateGrowthAuditRunRequest.safeParse({
      ...body,
      capabilityContractVersion: "growth-audit.0.2.0",
    });
    expect(result.success).toBe(false);
  });

  it("creates async_run, diagnostic_run, capability_run and audit_run in one transaction", async () => {
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
    vi.spyOn(ProjectsRepository.prototype, "setStage").mockResolvedValue(
      undefined as never,
    );
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
      .mockResolvedValue({ async_run_id: runId } as never);
    const auditCreate = vi
      .spyOn(AuditRunsRepository.prototype, "create")
      .mockResolvedValue({ id: auditRunId } as never);

    const result = await createGrowthAuditRun(
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
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(insertQueued).toHaveBeenCalledTimes(1);
    expect(insertQueued.mock.calls[0]?.[0]).toMatchObject({
      kind: "diagnostic",
      activeKey: "growth_audit",
    });
    expect(diagnosticInsert).toHaveBeenCalledTimes(1);
    expect(capabilityCreate).toHaveBeenCalledTimes(1);
    expect(capabilityCreate.mock.calls[0]?.[0]).toMatchObject({
      capabilityId: "growth-audit",
      capabilityVersion: "0.3.0",
      sideEffectClass: "read_only",
      mode: "production",
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({
      diagnosticRunId: runId,
      capabilityRunId: runId,
      scopeKind: "site",
      scopeKey: siteId,
      projectionVersion: "growth-audit.0.3.0",
    });
    expect(mocks.enqueueRunInTx).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      mocks.tx,
      "diagnose",
      expect.objectContaining({ runId }),
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("replays a completed command without re-enqueueing", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue({
      request_hash: requestHash(),
      status: "completed",
      resource_id: auditRunId,
      response_body: {
        run: { id: runId },
        statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
        resourceRef: { type: "audit_run", id: auditRunId },
      },
    } as never);
    const begin = vi.spyOn(IdempotencyRepository.prototype, "begin");

    const result = await createGrowthAuditRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    );
    expect(result).toMatchObject({
      status: 202,
      replayed: true,
      resourceRef: { type: "audit_run", id: auditRunId },
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("returns RUN_ALREADY_ACTIVE when another audit is active", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    mockHappyPathInputs();
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue({
      id: runId,
    } as never);
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      // The winner is observable, so the body locates it too. A client that
      // reads only the response body would otherwise get a conflict it has no
      // way to follow, because `Location` is a header.
      current: {
        runId,
        statusUrl: expect.stringContaining(`/runs/${runId}`),
      },
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("does not claim an active run when the unique race leaves no winner", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    mockHappyPathInputs();
    // Blind to the winner on both reads: the index aborts only when a run WAS
    // active, and `findActive` sees only `queued`/`running`, so this is the
    // real race where the winner left both states in between.
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(
      null,
    );
    mocks.db.transaction.mockRejectedValueOnce({
      code: "23505",
      constraint: "async_runs_one_active_key_idx",
    });

    const error = await createGrowthAuditRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      // Both pointers present and explicitly null, so a client distinguishes
      // "we have no pointer" from "the field is missing"; and no invented
      // `Location`, because there is no run to point a header at either.
      current: { runId: null, statusUrl: null, activeKey: "growth_audit" },
      extraHeaders: undefined,
    });
    // The detail must not assert an active run it cannot observe.
    expect((error as Error).message).not.toContain("is already active");
  });
});
