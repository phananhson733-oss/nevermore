import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  CompetitorMonitorRepository,
  CompetitorsRepository,
  DataSnapshotsRepository,
  ImportPreviewsRepository,
  KeywordOccurrencesRepository,
  ObservationsRepository,
  PageSnapshotsRepository,
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
import { persistCollectionResult, type CollectionOutcome } from "./persist.ts";

const attempt = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  runId: "run-1",
  attemptCount: 1,
} satisfies RunAttempt;

const collectionRun = {
  id: attempt.runId,
  workspace_id: attempt.workspaceId,
  project_id: attempt.projectId,
  site_id: "site-1",
  source_connection_id: null,
  import_preview_id: null,
  crawl_seed_site_page_id: null,
  crawl_seed_url: null,
  provider: "crawl",
  operation: "site_graph",
  method_version: "crawl.site_graph.v1",
} as CollectionRunRow;

const capturedAt = "2026-07-19T00:00:00.000Z";
const csvSourceConnectionId = "00000000-0000-4000-8000-000000000012";
const sourceWindow = {
  start: "2026-07-18T00:00:00.000Z",
  end: capturedAt,
} as const;
const providerUsage = {
  urlsFetched: 2,
  pagesCollected: 0,
  urlsSkipped: 0,
  urlsBlocked: 0,
  urlsDisallowed: 0,
  urlsErrored: 0,
  redirectsFollowed: 0,
  bytesFetched: 128,
  robotsFetched: 1,
  sitemapUrlCount: 0,
} as const;

const outcome = {
  availability: "available",
  capturedAt,
  sourceWindow,
  rowCount: 0,
  stopReason: null,
  providerUsage,
  limitation: "fixture",
  raw: {
    origin: "https://example.com",
    host: "example.com",
    pages: [],
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: { fetched: true, urlCount: 0, subjectUrls: [] },
    availability: "available",
    capturedAt,
    sourceWindow,
    stopReason: null,
    providerUsage,
    limitation: "fixture",
  },
} satisfies CollectionOutcome;

const uploadedKey = "snapshot-raw/project-1/run-1/attempt-object";
const transaction = vi.fn();
const put = vi.fn();
const deleteObject = vi.fn();
const ctx = {
  db: { transaction },
  blobStore: { put, delete: deleteObject },
} as unknown as WorkerContext;

function persist(
  overrides: {
    readonly collectionRun?: CollectionRunRow;
    readonly outcome?: CollectionOutcome;
    readonly datasetKey?: string;
    readonly observations?: readonly ObservationInsert[];
  } = {},
): Promise<string | null> {
  const selectedRun = overrides.collectionRun ?? collectionRun;
  return persistCollectionResult(ctx, {
    collectionRun: selectedRun,
    datasetKey: overrides.datasetKey ?? "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    actorId: "actor-1",
    startedAtMs: Date.now(),
    attempt,
    outcome: overrides.outcome ?? outcome,
    observations: overrides.observations ?? [],
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  transaction.mockReset();
  put.mockReset().mockResolvedValue({
    key: uploadedKey,
    sha256: "sha256",
    bytes: 17,
  });
  deleteObject.mockReset().mockResolvedValue(undefined);

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
    id: "snapshot-1",
  } as never);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "findActiveByIdForUpdate",
  ).mockResolvedValue({
    id: csvSourceConnectionId,
    workspace_id: attempt.workspaceId,
    project_id: attempt.projectId,
    site_id: collectionRun.site_id,
    provider: "csv",
  } as never);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "findById",
  ).mockResolvedValue({
    id: csvSourceConnectionId,
    workspace_id: attempt.workspaceId,
    project_id: attempt.projectId,
    site_id: collectionRun.site_id,
    provider: "csv",
  } as never);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "setLastSnapshot",
  ).mockResolvedValue();
  vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue(
    null,
  );
  vi.spyOn(
    SitePagesRepository.prototype,
    "upsertNormalizedUrl",
  ).mockResolvedValue({ id: "site-page-1" } as never);
  vi.spyOn(
    SitePagesRepository.prototype,
    "lockCanonicalSubjects",
  ).mockResolvedValue();
  vi.spyOn(
    SitePagesRepository.prototype,
    "resolveUnambiguousCanonicalSubjects",
  ).mockResolvedValue(new Map());
  vi.spyOn(PageSnapshotsRepository.prototype, "create").mockResolvedValue({
    id: "page-snapshot-1",
  } as never);
  vi.spyOn(ObservationsRepository.prototype, "insertMany").mockResolvedValue(0);
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
  vi.spyOn(CompetitorsRepository.prototype, "upsertOrigin").mockResolvedValue({
    occurrenceId: "competitor-occurrence-1",
    competitorId: "competitor-1",
  });
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue({
    id: attempt.projectId,
    workspace_id: attempt.workspaceId,
    archived_at: null,
  } as never);
  vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
    id: collectionRun.site_id,
    workspace_id: attempt.workspaceId,
    project_id: attempt.projectId,
    origin: "https://example.com",
    host: "example.com",
    language_codes: [],
    is_primary: true,
  } as never);
  vi.spyOn(
    SitesRepository.prototype,
    "projectPrimaryLanguageIfEmpty",
  ).mockResolvedValue(true);
  vi.spyOn(
    ProjectsRepository.prototype,
    "setReadyToDiagnoseIfEligible",
  ).mockResolvedValue(false);
  vi.spyOn(TelemetryRepository.prototype, "emit").mockResolvedValue();
});

describe("persistCollectionResult transaction outcomes", () => {
  it("keeps competitor monitoring inside Growth Map evidence without polluting customer projections", async () => {
    const monitorRun = {
      ...collectionRun,
      source_connection_id: csvSourceConnectionId,
      provider: "dataforseo",
      operation: "keyword_gap_import",
      method_version: "dataforseo.ranked_keywords.v1",
    } as CollectionRunRow;
    const monitorOutcome = {
      ...outcome,
      raw: {},
      providerUsage: { rowsReceived: 1 },
      summary: {
        collectionScope: {
          target: "competitor.example",
          marketCode: "US",
          languageTag: "en-US",
        },
      },
    } satisfies CollectionOutcome;
    vi.mocked(DataSnapshotsRepository.prototype.insert).mockResolvedValueOnce({
      id: "snapshot-1",
      workspace_id: attempt.workspaceId,
      project_id: attempt.projectId,
      site_id: monitorRun.site_id,
      collection_run_id: monitorRun.id,
      source_connection_id: csvSourceConnectionId,
      provider: "dataforseo",
      dataset_key: "dataforseo.ranked_keywords.v1",
      schema_version: "0.2.0",
      method_version: "dataforseo.ranked_keywords.v1",
      captured_at: capturedAt,
      source_window: sourceWindow,
      availability: "available",
      limitation: "fixture",
      raw_object_key: uploadedKey,
      row_count: 1,
      checksum: "sha256",
      summary: monitorOutcome.summary,
      created_at: capturedAt,
    });
    vi.mocked(
      CompetitorMonitorRepository.prototype.findMonitorRun,
    ).mockResolvedValueOnce({
      id: monitorRun.id,
      workspace_id: attempt.workspaceId,
      project_id: attempt.projectId,
      competitor_id: "competitor-1",
      analysis_scopes: ["content", "serp_visibility"],
      topic_model_revision: 4,
      target_domain: "competitor.example",
      market: "US",
      language_tag: "en-US",
      previous_monitor_run_id: null,
      previous_snapshot_id: null,
    });
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "findSnapshotMetadata",
    ).mockResolvedValue({
      id: "snapshot-1",
      captured_at: capturedAt,
      availability: "available",
    });
    const evaluation = vi
      .spyOn(
        CompetitorMonitorRepository.prototype,
        "insertEvaluation",
      )
      .mockResolvedValue();
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(
      persist({
        collectionRun: monitorRun,
        datasetKey: "dataforseo.ranked_keywords.v1",
        outcome: monitorOutcome,
      }),
    ).resolves.toBe("snapshot-1");

    expect(evaluation).toHaveBeenCalledWith(
      expect.objectContaining({ state: "baseline", signals: [] }),
    );
    expect(
      KeywordOccurrencesRepository.prototype.upsertIntoLibrary,
    ).not.toHaveBeenCalled();
    expect(CompetitorsRepository.prototype.upsertOrigin).not.toHaveBeenCalled();
    expect(
      ProviderDiscrepanciesRepository.prototype.detectForSnapshot,
    ).not.toHaveBeenCalled();
    expect(
      SourceConnectionsRepository.prototype.setLastSnapshot,
    ).not.toHaveBeenCalled();
    expect(
      ProjectsRepository.prototype.setReadyToDiagnoseIfEligible,
    ).not.toHaveBeenCalled();
    expect(evaluation.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(AsyncRunsRepository.prototype.setTerminal).mock
        .invocationCallOrder[0]!,
    );
  });

  it("projects canonical persisted CSV Observations into the Keyword Library before terminalizing", async () => {
    const csvRun = {
      ...collectionRun,
      source_connection_id: csvSourceConnectionId,
      import_preview_id: "00000000-0000-4000-8000-000000000007",
      provider: "csv",
      operation: "keyword_gap_import",
      method_version: "csv.keyword_gap.v1",
    } as CollectionRunRow;
    vi.mocked(DataSnapshotsRepository.prototype.insert).mockResolvedValueOnce({
      id: "snapshot-1",
      workspace_id: attempt.workspaceId,
      project_id: attempt.projectId,
      site_id: csvRun.site_id,
      collection_run_id: csvRun.id,
      source_connection_id: csvSourceConnectionId,
      provider: "csv",
      dataset_key: "csv.keyword_gap.v1",
      schema_version: "0.2.0",
      method_version: "csv.keyword_gap.v1",
      captured_at: capturedAt,
      source_window: sourceWindow,
      availability: "available",
      limitation: "fixture",
      raw_object_key: uploadedKey,
      row_count: 1,
      checksum: "sha256",
      summary: {},
      created_at: capturedAt,
    });
    const canonicalObservation = {
      id: "00000000-0000-4000-8000-000000000004",
      workspace_id: attempt.workspaceId,
      project_id: attempt.projectId,
      snapshot_id: "snapshot-1",
      site_page_id: null,
      provider: "csv",
      metric_key: "csv.keyword_gap.v1",
      subject_type: "keyword_cluster",
      subject_ref: "running-shoes",
      observed_at: capturedAt,
      availability: "available",
      value_numeric: null,
      value_text: null,
      value_json: {
        keyword: "Running Shoes",
        marketCode: "US",
        languageCode: "en-US",
        competitorDomain: null,
      },
      unit: null,
      origin: "user_provided",
      method: "observed",
      grade: "C",
      support: "supports",
      limitation: "fixture",
    };
    vi.mocked(
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    )
      .mockResolvedValueOnce({
        rows: [canonicalObservation],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        rows: [canonicalObservation],
        nextCursor: null,
      });
    vi.mocked(
      CollectionRunsRepository.prototype.findById,
    ).mockResolvedValueOnce(csvRun);
    vi.spyOn(ImportPreviewsRepository.prototype, "findById").mockResolvedValueOnce({
      id: csvRun.import_preview_id!,
      workspace_id: attempt.workspaceId,
      project_id: attempt.projectId,
      site_id: csvRun.site_id,
      created_by: "actor-1",
      token_hash: Buffer.alloc(32),
      template_id: "keyword_gap_v1",
      raw_object_key: "raw-import/project/run/object",
      file_checksum: "checksum",
      row_count: 1,
      detected_columns: ["keyword"],
      suggested_mapping: {},
      preview_rows: [],
      validation_errors: [],
      validation_warnings: [],
      status: "consumed",
      expires_at: "2026-07-19T01:00:00.000Z",
      consumed_at: "2026-07-18T23:59:00.000Z",
      created_at: "2026-07-18T23:58:00.000Z",
      updated_at: "2026-07-18T23:59:00.000Z",
    });
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(
      persist({
        collectionRun: csvRun,
        datasetKey: "csv.keyword_gap.v1",
      }),
    ).resolves.toBe("snapshot-1");

    expect(
      KeywordOccurrencesRepository.prototype.upsertIntoLibrary,
    ).toHaveBeenCalledWith(
      {
        workspaceId: attempt.workspaceId,
        projectId: attempt.projectId,
      },
      expect.objectContaining({
        dataSnapshotId: "snapshot-1",
        normalizedObservationId:
          "00000000-0000-4000-8000-000000000004",
        displayKeyword: "Running Shoes",
        normalizedKeyword: "running shoes",
        sourceKind: "csv_import",
        scopeBasis: "user_provided",
        sourcePointer: "/valueJson/keyword",
      }),
    );
    expect(
      vi.mocked(
        KeywordOccurrencesRepository.prototype.upsertIntoLibrary,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(AsyncRunsRepository.prototype.setTerminal).mock
        .invocationCallOrder[0]!,
    );
    expect(CompetitorsRepository.prototype.upsertOrigin).not.toHaveBeenCalled();
  });

  it("projects a canonical CSV competitor origin in the completion transaction before terminalizing", async () => {
    const previewId = "00000000-0000-4000-8000-000000000007";
    const csvRun = {
      ...collectionRun,
      source_connection_id: csvSourceConnectionId,
      import_preview_id: previewId,
      provider: "csv",
      operation: "keyword_gap_import",
      method_version: "csv.keyword_gap.v1",
    } as CollectionRunRow;
    vi.mocked(DataSnapshotsRepository.prototype.insert).mockResolvedValueOnce({
      id: "snapshot-1",
      workspace_id: attempt.workspaceId,
      project_id: attempt.projectId,
      site_id: csvRun.site_id,
      collection_run_id: csvRun.id,
      source_connection_id: csvSourceConnectionId,
      provider: "csv",
      dataset_key: "csv.keyword_gap.v1",
      schema_version: "0.2.0",
      method_version: "csv.keyword_gap.v1",
      captured_at: capturedAt,
      source_window: sourceWindow,
      availability: "available",
      limitation: "fixture",
      raw_object_key: uploadedKey,
      row_count: 1,
      checksum: "sha256",
      summary: {},
      created_at: capturedAt,
    });
    vi.mocked(CollectionRunsRepository.prototype.findById).mockResolvedValueOnce(
      csvRun,
    );
    vi.spyOn(ImportPreviewsRepository.prototype, "findById").mockResolvedValueOnce({
      id: previewId,
      workspace_id: attempt.workspaceId,
      project_id: attempt.projectId,
      site_id: csvRun.site_id,
      created_by: "actor-1",
      token_hash: Buffer.alloc(32),
      template_id: "keyword_gap_v1",
      raw_object_key: "raw-import/project/run/object",
      file_checksum: "checksum",
      row_count: 1,
      detected_columns: ["keyword", "competitor_domain"],
      suggested_mapping: {},
      preview_rows: [],
      validation_errors: [],
      validation_warnings: [],
      status: "consumed",
      expires_at: "2026-07-19T01:00:00.000Z",
      consumed_at: "2026-07-18T23:59:00.000Z",
      created_at: "2026-07-18T23:58:00.000Z",
      updated_at: "2026-07-18T23:59:00.000Z",
    });
    vi.mocked(
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    ).mockResolvedValue({
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000004",
          workspace_id: attempt.workspaceId,
          project_id: attempt.projectId,
          snapshot_id: "snapshot-1",
          site_page_id: null,
          provider: "csv",
          metric_key: "csv.keyword_gap.v1",
          subject_type: "keyword_cluster",
          subject_ref: "running-shoes",
          observed_at: capturedAt,
          availability: "available",
          value_numeric: null,
          value_text: null,
          value_json: {
            keyword: "Running Shoes",
            marketCode: "US",
            languageCode: "en-US",
            competitorDomain: "example-competitor.com",
          },
          unit: null,
          origin: "user_provided",
          method: "observed",
          grade: "C",
          support: "supports",
          limitation: "fixture",
        },
      ],
      nextCursor: null,
    });
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(
      persist({ collectionRun: csvRun, datasetKey: "csv.keyword_gap.v1" }),
    ).resolves.toBe("snapshot-1");

    expect(CompetitorsRepository.prototype.upsertOrigin).toHaveBeenCalledWith(
      { workspaceId: attempt.workspaceId, projectId: attempt.projectId },
      {
        originKind: "csv_keyword_gap",
        domain: "example-competitor.com",
        name: null,
        snapshotId: "snapshot-1",
        observationId: "00000000-0000-4000-8000-000000000004",
        importPreviewId: previewId,
        sourcePointer: "/valueJson/competitorDomain",
      },
    );
    expect(
      SourceConnectionsRepository.prototype.findActiveByIdForUpdate,
    ).toHaveBeenCalledWith(
      { workspaceId: attempt.workspaceId, projectId: attempt.projectId },
      csvSourceConnectionId,
    );
    expect(SourceConnectionsRepository.prototype.findById).toHaveBeenCalledWith(
      { workspaceId: attempt.workspaceId, projectId: attempt.projectId },
      csvSourceConnectionId,
    );
    expect(
      vi.mocked(CompetitorsRepository.prototype.upsertOrigin).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(CollectionRunsRepository.prototype.finalize).mock
        .invocationCallOrder[0]!,
    );
    expect(
      vi.mocked(CompetitorsRepository.prototype.upsertOrigin).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(AsyncRunsRepository.prototype.setTerminal).mock
        .invocationCallOrder[0]!,
    );
  });

  it("freezes both mutable libraries when archival wins the project lock", async () => {
    const csvRun = {
      ...collectionRun,
      source_connection_id: csvSourceConnectionId,
      import_preview_id: "00000000-0000-4000-8000-000000000007",
      provider: "csv",
      operation: "keyword_gap_import",
      method_version: "csv.keyword_gap.v1",
    } as CollectionRunRow;
    vi.mocked(ProjectsRepository.prototype.findByIdForUpdate).mockResolvedValueOnce({
      id: attempt.projectId,
      workspace_id: attempt.workspaceId,
      archived_at: capturedAt,
    } as never);
    vi.mocked(DataSnapshotsRepository.prototype.insert).mockResolvedValueOnce({
      id: "snapshot-1",
      workspace_id: attempt.workspaceId,
      project_id: attempt.projectId,
      site_id: csvRun.site_id,
      collection_run_id: csvRun.id,
      source_connection_id: csvSourceConnectionId,
      provider: "csv",
      dataset_key: "csv.keyword_gap.v1",
      schema_version: "0.2.0",
      method_version: "csv.keyword_gap.v1",
      captured_at: capturedAt,
      source_window: sourceWindow,
      availability: "available",
      limitation: "fixture",
      raw_object_key: uploadedKey,
      row_count: 1,
      checksum: "sha256",
      summary: {},
      created_at: capturedAt,
    });
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(
      persist({ collectionRun: csvRun, datasetKey: "csv.keyword_gap.v1" }),
    ).resolves.toBe("snapshot-1");

    expect(
      KeywordOccurrencesRepository.prototype.upsertIntoLibrary,
    ).not.toHaveBeenCalled();
    expect(CompetitorsRepository.prototype.upsertOrigin).not.toHaveBeenCalled();
    expect(CollectionRunsRepository.prototype.findById).not.toHaveBeenCalled();
    expect(
      ProjectsRepository.prototype.setReadyToDiagnoseIfEligible,
    ).not.toHaveBeenCalled();
  });

  it("deletes its upload when the transaction callback explicitly fails", async () => {
    const callbackFailure = Object.assign(new Error("constraint violation"), {
      code: "23514",
    });
    vi.mocked(
      AsyncRunsRepository.prototype.lockAttemptForUpdate,
    ).mockRejectedValueOnce(callbackFailure);
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(persist()).rejects.toBe(callbackFailure);

    expect(deleteObject).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith(uploadedKey);
    expect(
      StorageObjectReferencesRepository.prototype.lockObjectKeysForTransaction,
    ).toHaveBeenCalledWith([expect.stringMatching(/^snapshot-raw\/project-1\/run-1\//)]);
    expect(
      vi.mocked(
        StorageObjectReferencesRepository.prototype
          .lockObjectKeysForTransaction,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(put.mock.invocationCallOrder[0]!);
  });

  it("keeps its upload when the callback finished before COMMIT became unknown", async () => {
    const unknownCommit = Object.assign(new Error("commit result unknown"), {
      code: "08006",
    });
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => {
        await callback({});
        throw unknownCommit;
      },
    );

    await expect(persist()).rejects.toBe(unknownCommit);

    expect(DataSnapshotsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({ rawObjectKey: uploadedKey }),
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalled();
    expect(ObservationsRepository.prototype.insertMany).toHaveBeenCalledWith(
      { workspaceId: attempt.workspaceId, projectId: attempt.projectId },
      "snapshot-1",
      collectionRun.provider,
      [],
    );
    expect(deleteObject).not.toHaveBeenCalled();
    expect(
      vi.mocked(
        StorageObjectReferencesRepository.prototype
          .lockObjectKeysForTransaction,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(put.mock.invocationCallOrder[0]!);
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(DataSnapshotsRepository.prototype.insert).mock
        .invocationCallOrder[0]!,
    );
  });

  it("does not upload when a transaction cannot start", async () => {
    const checkoutFailure = Object.assign(new Error("pool checkout timeout"), {
      code: "ETIMEDOUT",
    });
    transaction.mockRejectedValueOnce(checkoutFailure);

    await expect(persist()).rejects.toBe(checkoutFailure);

    expect(put).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe("persistCollectionResult crawl page materialization", () => {
  const pageProjection = {
    fetchUrl: "https://example.com/pricing/",
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: "https://example.com/pricing",
    robotsIndexable: true,
    robotsDirectives: ["index", "follow"],
    title: "Pricing",
    metaDescription: "Plans for growing teams.",
    h1: ["Pricing"],
    headings: ["Pricing", "Enterprise"],
    wordCount: 318,
    internalOutlinks: [
      {
        targetSubjectUrl: "https://example.com/contact",
        rel: null,
        anchorText: "Contact sales",
      },
    ],
    jsonLd: { types: ["Product"], errorCount: 0 },
    sitemapMember: true,
    bodyExcerpt: "Plans for growing teams.",
    paragraphs: ["Start with the plan that fits your team."],
    responseMs: 37,
    contentType: "text/html; charset=utf-8",
  } as const;

  function crawlOutcome(
    availability: "available" | "partial" = "available",
  ): CollectionOutcome {
    const limitation =
      availability === "partial" ? "fixture partial crawl" : "fixture crawl";
    const stopReason = availability === "partial" ? "max_urls" : null;
    const usage = { ...providerUsage, pagesCollected: 1 };
    return {
      availability,
      capturedAt,
      sourceWindow,
      rowCount: 1,
      stopReason,
      providerUsage: usage,
      limitation,
      raw: {
        origin: "https://example.com",
        host: "example.com",
        pages: [
          {
            subjectUrl: "https://example.com/pricing",
            depth: 1,
            projection: pageProjection,
          },
        ],
        robots: { fetched: true, groups: [], sitemaps: [] },
        sitemap: {
          fetched: true,
          urlCount: 1,
          subjectUrls: ["https://example.com/pricing"],
        },
        availability,
        capturedAt,
        sourceWindow,
        stopReason,
        providerUsage: usage,
        limitation,
      },
    };
  }

  function languageSummary(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      siteLanguage: {
        schemaVersion: "crawl.site-language-summary.v1",
        status: "resolved",
        languageTag: "en-US",
        pagesAnalyzed: 1,
        declaredPageCount: 1,
        missingPageCount: 0,
        invalidDeclarationCount: 0,
        canonicalTags: ["en-US"],
        evidence: [
          {
            fetchUrl: "https://example.com/pricing/",
            declaredTag: "en-us",
            canonicalTag: "en-US",
          },
        ],
        omittedEvidenceCount: 0,
        ...overrides,
      },
    };
  }

  function crawlPageObservation(): ObservationInsert {
    return {
      metricKey: "crawl.page.v1",
      subjectType: "url",
      subjectRef: "https://example.com/pricing",
      observedAt: capturedAt,
      availability: "available",
      valueNumeric: null,
      valueText: null,
      valueJson: pageProjection,
      unit: null,
      origin: "direct_public",
      method: "observed",
      grade: "B",
      support: "supports",
      limitation: "fixture crawl",
    };
  }

  it.each(["available", "partial"] as const)(
    "materializes every %s crawl page against the exact DataSnapshot inside the completion transaction",
    async (availability) => {
      transaction.mockImplementationOnce(
        async (callback: (tx: object) => Promise<unknown>) => callback({}),
      );

      await expect(
        persist({ outcome: crawlOutcome(availability) }),
      ).resolves.toBe("snapshot-1");

      expect(SitePagesRepository.prototype.upsertNormalizedUrl).toHaveBeenCalledWith(
        {
          workspaceId: attempt.workspaceId,
          projectId: attempt.projectId,
          siteId: collectionRun.site_id,
          normalizedUrl: "https://example.com/pricing/",
          templateKey: null,
        },
      );
      expect(PageSnapshotsRepository.prototype.create).toHaveBeenCalledWith({
        workspaceId: attempt.workspaceId,
        projectId: attempt.projectId,
        sitePageId: "site-page-1",
        dataSnapshotId: "snapshot-1",
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        extract: {
          schemaVersion: "crawl.page-extract.v1",
          subjectUrl: "https://example.com/pricing",
          depth: 1,
          projection: pageProjection,
        },
        capturedAt,
      });
      expect(
        vi.mocked(DataSnapshotsRepository.prototype.insert).mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        vi.mocked(PageSnapshotsRepository.prototype.create).mock
          .invocationCallOrder[0]!,
      );
      expect(
        vi.mocked(PageSnapshotsRepository.prototype.create).mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        vi.mocked(ObservationsRepository.prototype.insertMany).mock
          .invocationCallOrder[0]!,
      );
      expect(
        vi.mocked(SitesRepository.prototype.findById).mock
          .invocationCallOrder[0],
      ).toBeLessThan(put.mock.invocationCallOrder[0]!);
    },
  );

  it("binds each Crawl page observation to the SitePage with the exact value_json.fetchUrl", async () => {
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(
      persist({
        outcome: crawlOutcome(),
        observations: [crawlPageObservation()],
      }),
    ).resolves.toBe("snapshot-1");

    expect(ObservationsRepository.prototype.insertMany).toHaveBeenCalledWith(
      { workspaceId: attempt.workspaceId, projectId: attempt.projectId },
      "snapshot-1",
      "crawl",
      [expect.objectContaining({ sitePageId: "site-page-1" })],
    );
  });

  it("projects one resolved Crawl language inside the accepted completion transaction", async () => {
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(
      persist({
        outcome: {
          ...crawlOutcome(),
          summary: languageSummary(),
        },
      }),
    ).resolves.toBe("snapshot-1");

    expect(
      SitesRepository.prototype.projectPrimaryLanguageIfEmpty,
    ).toHaveBeenCalledWith(
      {
        workspaceId: attempt.workspaceId,
        projectId: attempt.projectId,
      },
      collectionRun.site_id,
      "en-US",
    );
    expect(
      vi.mocked(DataSnapshotsRepository.prototype.insert).mock.calls[0]?.[0],
    ).toMatchObject({ summary: languageSummary() });
  });

  it("does not freeze a Site language from a partial Crawl", async () => {
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(
      persist({
        outcome: {
          ...crawlOutcome("partial"),
          summary: languageSummary(),
        },
      }),
    ).resolves.toBe("snapshot-1");

    expect(
      SitesRepository.prototype.projectPrimaryLanguageIfEmpty,
    ).not.toHaveBeenCalled();
    expect(
      vi.mocked(DataSnapshotsRepository.prototype.insert).mock.calls[0]?.[0],
    ).toMatchObject({
      availability: "partial",
      summary: languageSummary(),
    });
  });

  it.each(["missing", "invalid", "conflicting"] as const)(
    "keeps the Site language empty for %s Crawl evidence",
    async (status) => {
      transaction.mockImplementationOnce(
        async (callback: (tx: object) => Promise<unknown>) => callback({}),
      );

      const statusEvidence =
        status === "missing"
          ? {
              status,
              languageTag: null,
              pagesAnalyzed: 1,
              declaredPageCount: 0,
              missingPageCount: 1,
              invalidDeclarationCount: 0,
              canonicalTags: [],
              evidence: [],
            }
          : status === "invalid"
            ? {
                status,
                languageTag: null,
                invalidDeclarationCount: 1,
                canonicalTags: [],
                evidence: [
                  {
                    fetchUrl: "https://example.com/pricing/",
                    declaredTag: "en_US",
                    canonicalTag: null,
                  },
                ],
              }
            : {
                status,
                languageTag: null,
                pagesAnalyzed: 2,
                declaredPageCount: 2,
                missingPageCount: 0,
                invalidDeclarationCount: 0,
                canonicalTags: ["en", "fr"],
                evidence: [
                  {
                    fetchUrl: "https://example.com/pricing/",
                    declaredTag: "en",
                    canonicalTag: "en",
                  },
                  {
                    fetchUrl: "https://example.com/fr",
                    declaredTag: "fr",
                    canonicalTag: "fr",
                  },
                ],
              };
      const selectedOutcome =
        status !== "conflicting"
          ? crawlOutcome()
          : (() => {
              const first = crawlOutcome();
              const raw = first.raw as {
                readonly pages: readonly {
                  readonly subjectUrl: string;
                  readonly depth: number;
                  readonly projection: typeof pageProjection;
                }[];
              } & Record<string, unknown>;
              const usage = {
                ...first.providerUsage,
                pagesCollected: 2,
              };
              return {
                ...first,
                rowCount: 2,
                providerUsage: usage,
                raw: {
                  ...raw,
                  pages: [
                    ...raw.pages,
                    {
                      subjectUrl: "https://example.com/fr",
                      depth: 1,
                      projection: {
                        ...pageProjection,
                        fetchUrl: "https://example.com/fr",
                        canonicalTarget: null,
                        internalOutlinks: [],
                      },
                    },
                  ],
                  providerUsage: usage,
                },
              };
            })();
      await expect(
        persist({
          outcome: {
            ...selectedOutcome,
            summary: languageSummary(statusEvidence),
          },
        }),
      ).resolves.toBe("snapshot-1");

      expect(
        SitesRepository.prototype.projectPrimaryLanguageIfEmpty,
      ).not.toHaveBeenCalled();
    },
  );

  it("rejects site-language evidence whose page count drifts from the validated Crawl raw", async () => {
    await expect(
      persist({
        outcome: {
          ...crawlOutcome(),
          summary: languageSummary({
            pagesAnalyzed: 2,
            missingPageCount: 1,
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Crawl site-language snapshot summary is invalid.",
    });

    expect(transaction).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a self-consistent foreign-origin crawl before Blob or canonical writes", async () => {
    const foreign = crawlOutcome();
    const raw = foreign.raw as Record<string, unknown> & {
      pages: readonly Record<string, unknown>[];
    };
    const foreignOrigin = "https://foreign.example";
    const foreignProjection = {
      ...(raw.pages[0]?.["projection"] as Record<string, unknown>),
      fetchUrl: `${foreignOrigin}/pricing/`,
      redirectChain: [],
      canonicalTarget: `${foreignOrigin}/pricing`,
      internalOutlinks: [],
    };
    const foreignRaw = {
      ...raw,
      origin: foreignOrigin,
      host: "foreign.example",
      pages: [
        {
          ...raw.pages[0],
          subjectUrl: `${foreignOrigin}/pricing`,
          projection: foreignProjection,
        },
      ],
      robots: { fetched: true, groups: [], sitemaps: [] },
      sitemap: {
        fetched: true,
        urlCount: 1,
        subjectUrls: [`${foreignOrigin}/pricing`],
      },
    };

    await expect(
      persist({ outcome: { ...foreign, raw: foreignRaw } }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Crawl raw payload does not match its collection outcome.",
    });

    expect(SitesRepository.prototype.findById).toHaveBeenCalledWith(
      {
        workspaceId: attempt.workspaceId,
        projectId: attempt.projectId,
      },
      collectionRun.site_id,
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(DataSnapshotsRepository.prototype.insert).not.toHaveBeenCalled();
    expect(
      SitePagesRepository.prototype.upsertNormalizedUrl,
    ).not.toHaveBeenCalled();
    expect(PageSnapshotsRepository.prototype.create).not.toHaveBeenCalled();
    expect(ObservationsRepository.prototype.insertMany).not.toHaveBeenCalled();
    expect(CollectionRunsRepository.prototype.finalize).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
  });

  it("does not materialize page identities for a non-crawl provider", async () => {
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );
    const gscRun = {
      ...collectionRun,
      provider: "gsc",
      operation: "search_analytics",
      method_version: "gsc.page_query_daily.v1",
    } as CollectionRunRow;
    const gscOutcome = {
      ...outcome,
      raw: { rows: [] },
    } satisfies CollectionOutcome;

    await expect(
      persist({
        collectionRun: gscRun,
        outcome: gscOutcome,
        datasetKey: "gsc.page_query_daily.v1",
      }),
    ).resolves.toBe("snapshot-1");

    expect(SitePagesRepository.prototype.upsertNormalizedUrl).not.toHaveBeenCalled();
    expect(PageSnapshotsRepository.prototype.create).not.toHaveBeenCalled();
  });

  it.each([
    ["one slash variant", { id: "site-page-slash" }],
    ["multiple ambiguous variants", null],
  ] as const)(
    "resolves a GSC canonical subject through %s without a PageSnapshot",
    async (_case, resolvedPage) => {
      transaction.mockImplementationOnce(
        async (callback: (tx: object) => Promise<unknown>) => callback({}),
      );
      const canonical = "https://example.com/pricing";
      const gscRun = {
        ...collectionRun,
        provider: "gsc",
        operation: "search_analytics",
        method_version: "gsc.search_analytics.v1",
      } as CollectionRunRow;
      const gscOutcome = {
        ...outcome,
        raw: { rows: [] },
      } satisfies CollectionOutcome;
      const gscObservation: ObservationInsert = {
        metricKey: "gsc.page.v1",
        subjectType: "url",
        subjectRef: canonical,
        observedAt: capturedAt,
        availability: "available",
        valueNumeric: null,
        valueText: null,
        valueJson: { current28d: { clicks: 12 } },
        unit: null,
        origin: "first_party",
        method: "observed",
        grade: "A",
        support: "supports",
        limitation: "GSC fixture.",
      };
      vi.mocked(
        SitePagesRepository.prototype.resolveUnambiguousCanonicalSubjects,
      ).mockResolvedValueOnce(
        new Map([[canonical, resolvedPage as never]]),
      );

      await expect(
        persist({
          collectionRun: gscRun,
          outcome: gscOutcome,
          datasetKey: "gsc.page_query_daily.v1",
          observations: [gscObservation],
        }),
      ).resolves.toBe("snapshot-1");

      expect(
        SitePagesRepository.prototype.resolveUnambiguousCanonicalSubjects,
      ).toHaveBeenCalledWith(
        { workspaceId: attempt.workspaceId, projectId: attempt.projectId },
        collectionRun.site_id,
        [
          {
            subjectRef: canonical,
            exactCandidates: [canonical, `${canonical}/`],
          },
        ],
      );
      expect(ObservationsRepository.prototype.insertMany).toHaveBeenCalledWith(
        { workspaceId: attempt.workspaceId, projectId: attempt.projectId },
        "snapshot-1",
        "gsc",
        [
          expect.objectContaining({
            sitePageId: resolvedPage?.id ?? null,
          }),
        ],
      );
      expect(PageSnapshotsRepository.prototype.create).not.toHaveBeenCalled();
    },
  );

  it("fails closed before upload when crawl raw does not match the collection outcome", async () => {
    const malformed = crawlOutcome();
    const raw = malformed.raw as Record<string, unknown>;

    await expect(
      persist({
        outcome: {
          ...malformed,
          raw: { ...raw, capturedAt: "2026-07-19T00:00:01.000Z" },
        },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Crawl raw payload does not match its collection outcome.",
    });

    expect(transaction).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(DataSnapshotsRepository.prototype.insert).not.toHaveBeenCalled();
    expect(PageSnapshotsRepository.prototype.create).not.toHaveBeenCalled();
  });

  it("rolls back the canonical completion and deletes the upload when page materialization fails", async () => {
    const pageFailure = new Error("page snapshot constraint failure");
    vi.mocked(PageSnapshotsRepository.prototype.create).mockRejectedValueOnce(
      pageFailure,
    );
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );

    await expect(persist({ outcome: crawlOutcome() })).rejects.toBe(
      pageFailure,
    );

    expect(DataSnapshotsRepository.prototype.insert).toHaveBeenCalledOnce();
    expect(ObservationsRepository.prototype.insertMany).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(deleteObject).toHaveBeenCalledWith(uploadedKey);
  });
});
