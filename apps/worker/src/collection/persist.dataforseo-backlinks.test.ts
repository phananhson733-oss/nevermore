import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectDataForSeoBacklinkSnapshot: vi.fn(),
}));

vi.mock("@sf/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sf/db")>()),
  projectDataForSeoBacklinkSnapshot:
    mocks.projectDataForSeoBacklinkSnapshot,
}));

import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  CompetitorMonitorRepository,
  DataSnapshotsRepository,
  KeywordOccurrencesRepository,
  ObservationsRepository,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  SitesRepository,
  SitePagesRepository,
  SourceConnectionsRepository,
  StorageObjectReferencesRepository,
  TelemetryRepository,
  type CollectionRunRow,
  type ObservationInsert,
  type RunAttempt,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";
import {
  persistCollectionResult,
  type CollectionOutcome,
} from "./persist.ts";

const ids = {
  workspace: "b1000000-0000-4000-8000-000000000001",
  project: "b1000000-0000-4000-8000-000000000002",
  run: "b1000000-0000-4000-8000-000000000003",
  site: "b1000000-0000-4000-8000-000000000004",
  source: "b1000000-0000-4000-8000-000000000005",
  actor: "b1000000-0000-4000-8000-000000000006",
  snapshot: "b1000000-0000-4000-8000-000000000007",
  sitePage: "b1000000-0000-4000-8000-000000000008",
} as const;
const capturedAt = "2026-08-06T01:00:00.000Z";
const uploadedKey = `snapshot-raw/${ids.project}/${ids.run}/fixture`;

const attempt = {
  workspaceId: ids.workspace,
  projectId: ids.project,
  runId: ids.run,
  attemptCount: 1,
} satisfies RunAttempt;

const collectionRun = {
  id: ids.run,
  workspace_id: ids.workspace,
  project_id: ids.project,
  site_id: ids.site,
  source_connection_id: ids.source,
  import_preview_id: null,
  crawl_seed_site_page_id: null,
  crawl_seed_url: null,
  provider: "dataforseo",
  operation: "backlinks",
  method_version: "dataforseo.backlinks.v1",
} as CollectionRunRow;

const observations = [
  {
    metricKey: "dataforseo.backlink_summary.v1",
    subjectType: "site",
    subjectRef: "example.com",
    observedAt: capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: {
      targetDomain: "example.com",
      rank: 74,
      backlinks: 12,
      referringDomains: 5,
    },
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "supports",
    limitation: "DataForSEO live backlink index fixture.",
  },
  {
    metricKey: "dataforseo.backlink.v1",
    subjectType: "url",
    subjectRef: "https://example.com/guide",
    observedAt: capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: {
      sourceRef: "dfs-backlink-fixture",
      referringDomain: "publisher.example",
      sourceUrl: "https://publisher.example/post",
      targetUrl: "https://example.com/guide",
      sourceRank: 63,
      linkKind: "dofollow",
      anchorText: "Example guide",
      firstSeenAt: capturedAt,
      lastSeenAt: capturedAt,
      isNew: false,
      isLost: false,
      verification: {
        status: "verified",
        checkedAt: capturedAt,
        finalUrl: "https://publisher.example/post",
        httpStatus: 200,
        anchorText: "Example guide",
        rel: null,
        limitation: null,
      },
    },
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "supports",
    limitation: "DataForSEO live backlink index fixture.",
  },
] satisfies readonly ObservationInsert[];

const outcome = {
  availability: "available",
  capturedAt,
  sourceWindow: { start: capturedAt, end: capturedAt },
  rowCount: observations.length,
  stopReason: null,
  providerUsage: { apiCalls: 4, rowsReturned: observations.length },
  limitation: "DataForSEO live backlink index fixture.",
  raw: { schemaVersion: "dataforseo.backlinks.v1" },
  summary: { collectionScope: { target: "example.com" } },
} satisfies CollectionOutcome;

const transaction = vi.fn();
const put = vi.fn();
const deleteObject = vi.fn();
const ctx = {
  db: { transaction },
  blobStore: { put, delete: deleteObject },
} as unknown as WorkerContext;

beforeEach(() => {
  vi.restoreAllMocks();
  transaction.mockReset();
  put.mockReset().mockResolvedValue({
    key: uploadedKey,
    sha256: "d".repeat(64),
    bytes: 17,
  });
  deleteObject.mockReset().mockResolvedValue(undefined);
  mocks.projectDataForSeoBacklinkSnapshot.mockReset().mockResolvedValue({
    snapshotId: "backlink-authority-snapshot-1",
    replayed: false,
    factCount: 1,
    pageMetricCount: 0,
  });

  vi.spyOn(
    StorageObjectReferencesRepository.prototype,
    "lockObjectKeysForTransaction",
  ).mockResolvedValue();
  vi.spyOn(
    AsyncRunsRepository.prototype,
    "lockAttemptForUpdate",
  ).mockResolvedValue({} as never);
  vi.spyOn(AsyncRunsRepository.prototype, "setTerminal").mockResolvedValue(true);
  vi.spyOn(
    ProjectsRepository.prototype,
    "findByIdForUpdate",
  ).mockResolvedValue({
    id: ids.project,
    workspace_id: ids.workspace,
    archived_at: null,
  } as never);
  vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
    id: ids.site,
    workspace_id: ids.workspace,
    project_id: ids.project,
    origin: "https://example.com",
    host: "example.com",
    language_codes: [],
    is_primary: true,
  } as never);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "findActiveByIdForUpdate",
  ).mockResolvedValue({
    id: ids.source,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    provider: "dataforseo",
  } as never);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "setLastSnapshot",
  ).mockResolvedValue();
  vi.spyOn(
    ProviderDiscrepanciesRepository.prototype,
    "lockCollectionWindow",
  ).mockResolvedValue();
  vi.spyOn(
    ProviderDiscrepanciesRepository.prototype,
    "detectForSnapshot",
  ).mockResolvedValue([]);
  vi.spyOn(
    CompetitorMonitorRepository.prototype,
    "findMonitorRun",
  ).mockResolvedValue(null);
  vi.spyOn(DataSnapshotsRepository.prototype, "insert").mockResolvedValue({
    id: ids.snapshot,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    collection_run_id: ids.run,
    source_connection_id: ids.source,
    provider: "dataforseo",
    dataset_key: "dataforseo.backlinks.v1",
    schema_version: "dataforseo.backlinks.v1",
    method_version: "dataforseo.backlinks.v1",
    captured_at: capturedAt,
    source_window: outcome.sourceWindow,
    availability: "available",
    limitation: outcome.limitation,
    raw_object_key: uploadedKey,
    row_count: observations.length,
    checksum: "d".repeat(64),
    summary: outcome.summary,
    created_at: capturedAt,
  });
  vi.spyOn(
    SitePagesRepository.prototype,
    "resolveUnambiguousCanonicalSubjects",
  ).mockResolvedValue(
    new Map([
      [
        "https://example.com/guide",
        { id: ids.sitePage } as never,
      ],
    ]),
  );
  vi.spyOn(ObservationsRepository.prototype, "insertMany").mockResolvedValue(
    observations.length,
  );
  vi.spyOn(
    ObservationsRepository.prototype,
    "listBySnapshotIdsPage",
  ).mockResolvedValue({ rows: [], nextCursor: null });
  vi.spyOn(
    KeywordOccurrencesRepository.prototype,
    "upsertIntoLibrary",
  ).mockResolvedValue({
    occurrenceId: "keyword-occurrence-1",
    entityId: "keyword-entity-1",
  });
  vi.spyOn(CollectionRunsRepository.prototype, "finalize").mockResolvedValue();
  vi.spyOn(
    ProjectsRepository.prototype,
    "setReadyToDiagnoseIfEligible",
  ).mockResolvedValue(false);
  vi.spyOn(TelemetryRepository.prototype, "emit").mockResolvedValue();
});

describe("persistCollectionResult DataForSEO backlink projection", () => {
  it("projects the immutable snapshot and lineage observations in the completion transaction before finalize", async () => {
    const transactionTx = { identity: "completion-transaction" };
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) =>
        callback(transactionTx),
    );

    await expect(
      persistCollectionResult(ctx, {
        collectionRun,
        datasetKey: "dataforseo.backlinks.v1",
        schemaVersion: "dataforseo.backlinks.v1",
        actorId: ids.actor,
        startedAtMs: Date.now(),
        attempt,
        outcome,
        observations,
      }),
    ).resolves.toBe(ids.snapshot);

    expect(mocks.projectDataForSeoBacklinkSnapshot).toHaveBeenCalledWith(
      transactionTx,
      {
        scope: { workspaceId: ids.workspace, projectId: ids.project },
        siteId: ids.site,
        dataSnapshot: {
          id: ids.snapshot,
          provider: "dataforseo",
          datasetKey: "dataforseo.backlinks.v1",
          methodVersion: "dataforseo.backlinks.v1",
          capturedAt,
          availability: "available",
          checksum: "d".repeat(64),
          rowCount: observations.length,
        },
        observations: [
          { ...observations[0], sitePageId: null },
          { ...observations[1], sitePageId: ids.sitePage },
        ],
      },
    );
    expect(
      vi.mocked(ObservationsRepository.prototype.insertMany).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      mocks.projectDataForSeoBacklinkSnapshot.mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.projectDataForSeoBacklinkSnapshot.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(CollectionRunsRepository.prototype.finalize).mock
        .invocationCallOrder[0]!,
    );
    expect(
      mocks.projectDataForSeoBacklinkSnapshot.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(AsyncRunsRepository.prototype.setTerminal).mock
        .invocationCallOrder[0]!,
    );
  });
});
