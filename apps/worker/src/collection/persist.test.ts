import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  SitesRepository,
  SitePagesRepository,
  StorageObjectReferencesRepository,
  TelemetryRepository,
  type CollectionRunRow,
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
  provider: "crawl",
  operation: "site_graph",
  method_version: "crawl.site_graph.v1",
} as CollectionRunRow;

const capturedAt = "2026-07-19T00:00:00.000Z";
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
    observations: [],
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
  vi.spyOn(DataSnapshotsRepository.prototype, "insert").mockResolvedValue({
    id: "snapshot-1",
  } as never);
  vi.spyOn(
    SitePagesRepository.prototype,
    "upsertNormalizedUrl",
  ).mockResolvedValue({ id: "site-page-1" } as never);
  vi.spyOn(PageSnapshotsRepository.prototype, "create").mockResolvedValue({
    id: "page-snapshot-1",
  } as never);
  vi.spyOn(ObservationsRepository.prototype, "insertMany").mockResolvedValue(0);
  vi.spyOn(CollectionRunsRepository.prototype, "finalize").mockResolvedValue();
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
    is_primary: true,
  } as never);
  vi.spyOn(
    ProjectsRepository.prototype,
    "setReadyToDiagnoseIfEligible",
  ).mockResolvedValue(false);
  vi.spyOn(TelemetryRepository.prototype, "emit").mockResolvedValue();
});

describe("persistCollectionResult transaction outcomes", () => {
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
