import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CompetitorsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  IcpProfilesRepository,
  IdempotencyRepository,
  KeywordsRepository,
  ProjectsRepository,
  SitesRepository,
  type CanonicalValue,
  type DataSnapshotRow,
  type IdempotencyRow,
} from "@sf/db";
import type { CreateDiagnosticRunRequest } from "@sf/contracts";
import {
  GOVERNANCE_PROJECTION_VERSION,
  parseGovernanceProjectionV1,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import { CRAWL_METHOD_VERSION } from "@sf/sources";

const mocks = vi.hoisted(() => ({
  contentHash: vi.fn(),
  tx: {},
  db: {
    transaction: vi.fn(),
  },
  enqueueRunInTx: vi.fn(async () => "job-1"),
  getBoss: vi.fn(async () => ({ name: "boss" })),
}));

vi.mock("@sf/db", async () => {
  const actual = await vi.importActual<typeof import("@sf/db")>("@sf/db");
  mocks.contentHash.mockImplementation(actual.contentHash);
  return {
    ...actual,
    contentHash: mocks.contentHash,
    enqueueRunInTx: mocks.enqueueRunInTx,
  };
});
vi.mock("@/lib/db", () => ({ getDb: () => ({ db: mocks.db }) }));
vi.mock("@/lib/boss", () => ({ getBoss: mocks.getBoss }));

const {
  buildDiagnosticFrozenInput,
  diagnosticSnapshotSiteId,
  assertDiagnosticSnapshotSelection,
  createDiagnosticRun,
} = await import("../diagnostics.ts");

const workspaceId = "00000000-0000-4000-8000-000000000011";
const projectId = "00000000-0000-4000-8000-000000000012";
const actorId = "00000000-0000-4000-8000-000000000013";
const runId = "00000000-0000-4000-8000-000000000014";
const firstSnapshotId = "00000000-0000-4000-8000-000000000015";
const secondSnapshotId = "00000000-0000-4000-8000-000000000016";
const idempotencyKey = "diagnostic-wire-body";

const run = {
  id: runId,
  projectId,
  kind: "diagnostic",
  status: "queued",
  progress: {
    phase: "queued",
    current: 0,
    total: null,
    messageKey: "run.queued",
  },
  lastError: null,
  resultRef: null,
  queuedAt: "2026-07-20T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
};

function completedKey(requestHash: string): IdempotencyRow {
  const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;
  return {
    id: "00000000-0000-4000-8000-000000000017",
    workspace_id: workspaceId,
    scope: "createDiagnosticRun",
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    status: "completed",
    response_status: 202,
    response_body: {
      run,
      statusUrl,
      resourceRef: { type: "diagnostic_run", id: runId },
    },
    resource_type: "diagnostic_run",
    resource_id: runId,
    expires_at: "2026-07-21T00:00:00.000Z",
  };
}

async function captureRequestHash(
  body: CreateDiagnosticRunRequest,
): Promise<string> {
  const stopBeforeMutableState = new Error("stop before mutable state");
  const findKey = vi
    .spyOn(IdempotencyRepository.prototype, "find")
    .mockResolvedValueOnce(null);
  const findProject = vi
    .spyOn(ProjectsRepository.prototype, "findById")
    .mockRejectedValueOnce(stopBeforeMutableState);
  mocks.contentHash.mockClear();

  await expect(
    createDiagnosticRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    ),
  ).rejects.toBe(stopBeforeMutableState);
  expect(mocks.contentHash).toHaveBeenCalledTimes(1);

  const requestHash = mocks.contentHash.mock.results[0]?.value;
  findKey.mockRestore();
  findProject.mockRestore();
  expect(requestHash).toEqual(expect.any(String));
  return requestHash as string;
}

async function replayAgainstCapturedHash(
  originalBody: CreateDiagnosticRunRequest,
  replayBody: CreateDiagnosticRunRequest,
) {
  const requestHash = await captureRequestHash(originalBody);
  vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(
    completedKey(requestHash),
  );
  return createDiagnosticRun(
    { workspaceId },
    projectId,
    actorId,
    idempotencyKey,
    replayBody,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.db.transaction.mockImplementation(
    async (callback: (executor: object) => unknown) => callback(mocks.tx),
  );
});

describe("createDiagnosticRun wire-body idempotency", () => {
  const body = {
    snapshotIds: [firstSnapshotId, secondSnapshotId],
    outputLocale: "en",
  };

  it("replays the original response for the exact same body", async () => {
    await expect(replayAgainstCapturedHash(body, body)).resolves.toMatchObject({
      status: 202,
      replayed: true,
      run: { id: runId },
    });
  });

  it("rejects the same key when snapshotIds are sent in a different order", async () => {
    await expect(
      replayAgainstCapturedHash(body, {
        snapshotIds: [secondSnapshotId, firstSnapshotId],
        outputLocale: "en",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
  });
});

describe("diagnostic snapshot selection", () => {
  it("allows CSV and DataForSEO to retain separate lineage in one keyword-gap slot", () => {
    expect(() =>
      assertDiagnosticSnapshotSelection([
        { provider: "crawl" },
        { provider: "csv" },
        { provider: "dataforseo" },
      ]),
    ).not.toThrow();
  });

  it("rejects more than one snapshot from the same provider", () => {
    expect(() =>
      assertDiagnosticSnapshotSelection([
        { provider: "crawl" },
        { provider: "dataforseo" },
        { provider: "dataforseo" },
      ]),
    ).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR", status: 422 }),
    );
  });

  it("rejects snapshots that do not identify one exact site", () => {
    expect(() =>
      diagnosticSnapshotSiteId([
        { site_id: "site-primary" },
        { site_id: "site-secondary" },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: "SNAPSHOT_PROJECT_MISMATCH",
        status: 422,
      }),
    );
  });

  it("derives the exact site from the selected immutable snapshots", () => {
    expect(
      diagnosticSnapshotSiteId([
        { site_id: "site-secondary" },
        { site_id: "site-secondary" },
      ]),
    ).toBe("site-secondary");
  });

  it("freezes the complete snapshot metadata and hashes the JCS manifest", () => {
    const snapshot = {
      id: firstSnapshotId,
      workspace_id: workspaceId,
      project_id: projectId,
      site_id: "site-secondary",
      collection_run_id: "00000000-0000-4000-8000-000000000021",
      source_connection_id: "00000000-0000-4000-8000-000000000022",
      provider: "crawl",
      dataset_key: "crawl.site_graph.v1",
      schema_version: "0.2.0",
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
    } satisfies DataSnapshotRow;

    const frozen = buildDiagnosticFrozenInput({
      projectId,
      siteId: snapshot.site_id,
      icp: {
        id: "00000000-0000-4000-8000-000000000023",
        version: 4,
        contentHash: "b".repeat(64),
      },
      snapshots: [snapshot],
      deliveryLocale: "en-US",
      governance: {
        projectionVersion: GOVERNANCE_PROJECTION_VERSION,
        keywordClusters: [],
        competitors: [],
      },
    });

    const expectedManifest = {
      projectId,
      siteId: snapshot.site_id,
      icp: {
        id: "00000000-0000-4000-8000-000000000023",
        version: 4,
        contentHash: "b".repeat(64),
      },
      snapshots: [
        {
          snapshotId: snapshot.id,
          provider: "crawl",
          datasetKey: "crawl.site_graph.v1",
          schemaVersion: "0.2.0",
          methodVersion: CRAWL_METHOD_VERSION,
          checksum: "a".repeat(64),
          capturedAt: "2026-07-21T01:02:03.000Z",
          sourceWindow: { end: null, start: null },
          availability: "available",
        },
      ],
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      deliveryLocale: "en-US",
      governance: {
        projectionVersion: GOVERNANCE_PROJECTION_VERSION,
        keywordClusters: [],
        competitors: [],
      },
    };
    expect(frozen.manifest).toEqual(expectedManifest);
    expect(frozen.inputHash).toBe(contentHash(expectedManifest));
  });

  it("includes a canonical governance projection for the current rule set", () => {
    const snapshot = {
      id: firstSnapshotId,
      workspace_id: workspaceId,
      project_id: projectId,
      site_id: "site-secondary",
      collection_run_id: "00000000-0000-4000-8000-000000000021",
      source_connection_id: null,
      provider: "crawl",
      dataset_key: "crawl.site_graph.v1",
      schema_version: "0.2.0",
      method_version: CRAWL_METHOD_VERSION,
      captured_at: "2026-07-21T01:02:03.000Z",
      source_window: { end: null, start: null },
      availability: "available",
      limitation: "Static public crawl only.",
      raw_object_key: null,
      row_count: 3,
      checksum: "a".repeat(64),
      summary: {},
      created_at: "2026-07-21T01:02:04.000Z",
    } satisfies DataSnapshotRow;
    const common = {
      projectId,
      siteId: snapshot.site_id,
      icp: {
        id: "00000000-0000-4000-8000-000000000023",
        version: 4,
        contentHash: "b".repeat(64),
      },
      snapshots: [snapshot],
      deliveryLocale: "en-US",
    };
    const governance = parseGovernanceProjectionV1({
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [],
      competitors: [],
    });

    const current = buildDiagnosticFrozenInput({ ...common, governance });
    expect(current.manifest).toHaveProperty("governance", governance);
    expect(current.inputHash).toBe(
      contentHash(current.manifest as unknown as CanonicalValue),
    );
  });

  it("canonicalizes governance order and changes the manifest hash on revision drift", () => {
    const snapshot = {
      id: firstSnapshotId,
      workspace_id: workspaceId,
      project_id: projectId,
      site_id: "site-secondary",
      collection_run_id: "00000000-0000-4000-8000-000000000021",
      source_connection_id: null,
      provider: "crawl",
      dataset_key: "crawl.site_graph.v1",
      schema_version: "0.2.0",
      method_version: CRAWL_METHOD_VERSION,
      captured_at: "2026-07-21T01:02:03.000Z",
      source_window: { end: null, start: null },
      availability: "available",
      limitation: "Static public crawl only.",
      raw_object_key: null,
      row_count: 3,
      checksum: "a".repeat(64),
      summary: {},
      created_at: "2026-07-21T01:02:04.000Z",
    } satisfies DataSnapshotRow;
    const common = {
      projectId,
      siteId: snapshot.site_id,
      icp: {
        id: "00000000-0000-4000-8000-000000000023",
        version: 4,
        contentHash: "b".repeat(64),
      },
      snapshots: [snapshot],
      deliveryLocale: "en-US",
    };
    const firstCompetitor = {
      competitorEntityId: "70000000-0000-4000-8000-000000000001",
      domain: "alpha.example",
      reviewStatus: "approved",
      revision: 3,
      relationship: "direct",
      analysisScopes: ["serp_visibility", "keyword_gap"],
      originRefs: [
        {
          occurrenceId: "70000000-0000-4000-8000-000000000003",
          originKind: "manual",
          snapshotId: null,
          observationId: null,
        },
      ],
    } as const;
    const secondCompetitor = {
      competitorEntityId: "70000000-0000-4000-8000-000000000002",
      domain: "beta.example",
      reviewStatus: "candidate",
      revision: 1,
      relationship: null,
      analysisScopes: [],
      originRefs: [
        {
          occurrenceId: "70000000-0000-4000-8000-000000000004",
          originKind: "product_profile",
          snapshotId: null,
          observationId: null,
        },
      ],
    } as const;
    const projection = (competitors: readonly unknown[]) =>
      parseGovernanceProjectionV1({
        projectionVersion: GOVERNANCE_PROJECTION_VERSION,
        keywordClusters: [],
        competitors,
      });

    const ordered = buildDiagnosticFrozenInput({
      ...common,
      governance: projection([firstCompetitor, secondCompetitor]),
    });
    const reversed = buildDiagnosticFrozenInput({
      ...common,
      governance: projection([secondCompetitor, firstCompetitor]),
    });
    const revised = buildDiagnosticFrozenInput({
      ...common,
      governance: projection([
        { ...firstCompetitor, revision: firstCompetitor.revision + 1 },
        secondCompetitor,
      ]),
    });

    expect(ordered.inputHash).toBe(reversed.inputHash);
    expect(ordered.manifest).toEqual(reversed.manifest);
    expect(revised.inputHash).not.toBe(ordered.inputHash);
  });
});

describe("createDiagnosticRun transaction", () => {
  it("freezes governance and enqueues from one repeatable-read transaction", async () => {
    const snapshot = {
      id: firstSnapshotId,
      workspace_id: workspaceId,
      project_id: projectId,
      site_id: "site-secondary",
      collection_run_id: "00000000-0000-4000-8000-000000000021",
      source_connection_id: null,
      provider: "crawl",
      dataset_key: "crawl.site_graph.v1",
      schema_version: "0.2.0",
      method_version: CRAWL_METHOD_VERSION,
      captured_at: "2026-07-21T01:02:03.000Z",
      source_window: { end: null, start: null },
      availability: "available",
      limitation: "Static public crawl only.",
      raw_object_key: null,
      row_count: 3,
      checksum: "a".repeat(64),
      summary: {},
      created_at: "2026-07-21T01:02:04.000Z",
    } satisfies DataSnapshotRow;
    const confirmedIcpProfileId =
      "00000000-0000-4000-8000-000000000023";
    const project = {
      id: projectId,
      workspace_id: workspaceId,
      archived_at: null,
      confirmed_icp_profile_id: confirmedIcpProfileId,
    } as never;
    const queuedRun = {
      id: runId,
      workspace_id: workspaceId,
      project_id: projectId,
      kind: "diagnostic",
      status: "queued",
      active_key: "diagnostic",
      contract_version: "2026-07-21",
      request_payload: {},
      progress: {},
      last_error_code: null,
      last_error_summary: null,
      result_type: null,
      result_id: null,
      attempt_count: 0,
      initiated_by: actorId,
      queued_at: "2026-07-21T01:02:04.000Z",
      started_at: null,
      completed_at: null,
    } as never;

    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000024",
    } as never);
    vi.spyOn(IdempotencyRepository.prototype, "complete").mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project,
    );
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue(project);
    vi.spyOn(ProjectsRepository.prototype, "setStage").mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
      id: confirmedIcpProfileId,
      version: 4,
      content_hash: "b".repeat(64),
      status: "complete",
    } as never);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      snapshot,
    ]);
    vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
      id: snapshot.site_id,
    } as never);
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "findActive",
    ).mockResolvedValue(null);
    vi.spyOn(AsyncRunsRepository.prototype, "insertQueued").mockResolvedValue(
      queuedRun,
    );
    vi.spyOn(DiagnosticRunsRepository.prototype, "insert").mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(
      KeywordsRepository.prototype,
      "listDiagnosticEligible",
    ).mockResolvedValue([]);
    vi.spyOn(
      CompetitorsRepository.prototype,
      "listDiagnosticEligible",
    ).mockResolvedValue([]);

    await createDiagnosticRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      { snapshotIds: [snapshot.id], outputLocale: "en" },
    );

    expect(mocks.db.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
    });
    expect(mocks.enqueueRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      mocks.tx,
      "diagnose",
      expect.objectContaining({ runId }),
    );
  });
});
