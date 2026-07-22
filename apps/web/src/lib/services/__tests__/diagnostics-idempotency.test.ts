import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contentHash,
  IdempotencyRepository,
  ProjectsRepository,
  type DataSnapshotRow,
  type IdempotencyRow,
} from "@sf/db";
import type { CreateDiagnosticRunRequest } from "@sf/contracts";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import { CRAWL_METHOD_VERSION } from "@sf/sources";

const mocks = vi.hoisted(() => ({
  contentHash: vi.fn(),
}));

vi.mock("@sf/db", async () => {
  const actual = await vi.importActual<typeof import("@sf/db")>("@sf/db");
  mocks.contentHash.mockImplementation(actual.contentHash);
  return { ...actual, contentHash: mocks.contentHash };
});
vi.mock("@/lib/db", () => ({ getDb: () => ({ db: {} }) }));
vi.mock("@/lib/boss", () => ({ getBoss: vi.fn() }));

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
  mocks.contentHash.mockClear();
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
      captured_at: "2026-07-21T01:02:03.000Z",
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
    };
    expect(frozen.manifest).toEqual(expectedManifest);
    expect(frozen.inputHash).toBe(contentHash(expectedManifest));
  });
});
