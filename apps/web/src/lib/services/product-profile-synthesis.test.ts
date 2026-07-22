import {
  canonicalize,
  contentHash,
  normalizedUrlHash,
  sha256Hex,
  type ProjectRow,
  type CanonicalValue,
} from "@sf/db";
import {
  AsyncRunsRepository,
  DataSnapshotsRepository,
  IcpProfilesRepository,
  IdempotencyRepository,
  PageSnapshotsRepository,
  ProductProfileRunsRepository,
  ProjectsRepository,
  SitesRepository,
} from "@sf/db";
import {
  createInitialProductProfileDraft,
  MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES,
  PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_VERSION,
  ProductProfileSynthesisInputManifest,
} from "@sf/contracts";
import { PRODUCT_PROFILE_PROMPT_SET_VERSION } from "@sf/artifacts";
import { CRAWL_DATASET_KEY, CRAWL_METHOD_VERSION } from "@sf/sources";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const {
  assertProductProfileSynthesisPageRows,
  buildProductProfileSynthesisFrozenInput,
  createProductProfileSynthesisRun,
  selectProductProfileSynthesisPages,
} = await import("./product-profile-synthesis.ts");

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000003";
const siteId = "00000000-0000-4000-8000-000000000004";
const profileId = "00000000-0000-4000-8000-000000000005";
const snapshotId = "00000000-0000-4000-8000-000000000006";
const collectionRunId = "00000000-0000-4000-8000-000000000007";
const runId = "00000000-0000-4000-8000-000000000008";
const idemRowId = "00000000-0000-4000-8000-000000000009";
const sourcePageUrl = "https://relayops.com/customer-onboarding/";

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function pageRow(
  index: number,
  normalizedUrl: string,
  overrides: Partial<{
    workspace_id: string;
    project_id: string;
    site_id: string;
    data_snapshot_id: string;
    canonical_extract: string | null;
    content_hash: string;
    normalized_url_hash: string;
  }> = {},
) {
  const extract = {
    fetchUrl: normalizedUrl,
    title: `Page ${index}`,
    bodyExcerpt: `private-extract-${index}`,
  };
  const canonicalExtract = canonicalize(extract);
  return {
    page_snapshot_id: uuid(100 + index),
    workspace_id: workspaceId,
    project_id: projectId,
    site_page_id: uuid(200 + index),
    data_snapshot_id: snapshotId,
    content_hash: sha256Hex(canonicalExtract),
    canonical_extract: canonicalExtract,
    extract,
    captured_at: "2026-07-22T01:02:03.000Z",
    created_at: "2026-07-22T01:02:04.000Z",
    normalized_url: normalizedUrl,
    normalized_url_hash: normalizedUrlHash(normalizedUrl),
    site_id: siteId,
    ...overrides,
  };
}

const sourcePage = pageRow(1, sourcePageUrl);
const snapshot = {
  id: snapshotId,
  workspace_id: workspaceId,
  project_id: projectId,
  site_id: siteId,
  collection_run_id: collectionRunId,
  source_connection_id: null,
  provider: "crawl",
  dataset_key: CRAWL_DATASET_KEY,
  schema_version: "crawl.site_graph.0.3.0",
  method_version: CRAWL_METHOD_VERSION,
  captured_at: "2026-07-22T01:02:03.000Z",
  availability: "available",
  limitation: "Static public HTML only.",
  row_count: 1,
  checksum: "a".repeat(64),
  created_at: "2026-07-22T01:02:04.000Z",
};
const profile = createInitialProductProfileDraft({
  sourceSiteId: siteId,
  sourcePageUrl,
  businessHint: "Customer onboarding software for B2B SaaS teams.",
});
const profileHash = contentHash({ status: "draft", profile });
const persistedProfile = {
  id: profileId,
  workspace_id: workspaceId,
  project_id: projectId,
  version: 1,
  status: "draft" as const,
  profile,
  content_hash: profileHash,
  created_by: actorId,
  created_at: "2026-07-22T00:00:00.000Z",
};
const project: ProjectRow = {
  id: projectId,
  workspace_id: workspaceId,
  client_name: "RelayOps",
  project_name: "RelayOps",
  stage: "setup" as const,
  default_delivery_locale: "zh-CN",
  current_icp_profile_id: profileId,
  confirmed_icp_profile_id: null,
  archived_at: null,
  created_by: actorId,
  created_at: "2026-07-22T00:00:00.000Z",
  updated_at: "2026-07-22T00:00:00.000Z",
};
const site = {
  id: siteId,
  workspace_id: workspaceId,
  project_id: projectId,
  origin: "https://relayops.com",
  host: "relayops.com",
  market_codes: [],
  language_codes: [],
  is_primary: true,
  created_at: "2026-07-22T00:00:00.000Z",
  updated_at: "2026-07-22T00:00:00.000Z",
};
const queuedRun = {
  id: runId,
  workspace_id: workspaceId,
  project_id: projectId,
  kind: "product_profile_synthesis",
  status: "queued",
  active_key: "product-profile:synthesis",
  contract_version: "0.3.0",
  request_payload: {},
  progress: {
    phase: "queued",
    current: 0,
    total: null,
    messageKey: "run.queued",
  },
  last_error_code: null,
  last_error_summary: null,
  result_type: null,
  result_id: null,
  attempt_count: 0,
  initiated_by: actorId,
  queued_at: "2026-07-22T01:03:00.000Z",
  started_at: null,
  completed_at: null,
};

function arrangeAccepted(
  overrides: {
    project?: typeof project;
    profile?: Omit<typeof persistedProfile, "status"> & {
      readonly status: "draft" | "complete";
    };
    site?: typeof site;
    snapshot?: typeof snapshot | null;
    pages?: ReturnType<typeof pageRow>[];
    active?: typeof queuedRun | null;
  } = {},
) {
  vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue({
    id: idemRowId,
  } as never);
  vi.spyOn(IdempotencyRepository.prototype, "complete").mockResolvedValue();
  vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(
    overrides.active ?? null,
  );
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue(
    overrides.project ?? project,
  );
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(
    overrides.profile ?? persistedProfile,
  );
  vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue(
    overrides.site ?? site,
  );
  vi.spyOn(
    DataSnapshotsRepository.prototype,
    "findLatestEligibleCrawlBySite",
  ).mockResolvedValue(
    overrides.snapshot === undefined ? snapshot : overrides.snapshot,
  );
  vi.spyOn(
    PageSnapshotsRepository.prototype,
    "listByDataSnapshotWithSitePageIdentity",
  ).mockResolvedValue(overrides.pages ?? [sourcePage]);
  vi.spyOn(AsyncRunsRepository.prototype, "insertQueued").mockResolvedValue(
    queuedRun,
  );
  vi.spyOn(
    ProductProfileRunsRepository.prototype,
    "insertPlaceholder",
  ).mockResolvedValue({ id: runId } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.db.transaction.mockImplementation(
    async (callback: (executor: object) => unknown) => callback(mocks.tx),
  );
});

describe("Product Profile synthesis page selection", () => {
  it("puts the exact source first and applies the stable max-12 path policy", () => {
    const candidates = [
      pageRow(14, "https://relayops.com/z-last/"),
      pageRow(13, "https://relayops.com/a-first/"),
      pageRow(12, "https://relayops.com/company/"),
      pageRow(11, "https://relayops.com/about/"),
      pageRow(10, "https://relayops.com/integrations/"),
      pageRow(9, "https://relayops.com/pricing/"),
      pageRow(8, "https://relayops.com/use-cases/"),
      pageRow(7, "https://relayops.com/solutions/"),
      pageRow(6, "https://relayops.com/features/"),
      pageRow(5, "https://relayops.com/products/"),
      pageRow(4, "https://relayops.com/product/"),
      pageRow(3, "https://relayops.com/"),
      pageRow(2, "https://relayops.com/blog/"),
      sourcePage,
    ];

    const selected = selectProductProfileSynthesisPages(
      candidates,
      sourcePageUrl,
    );

    expect(selected).toHaveLength(MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES);
    expect(selected.map((row) => row.normalized_url)).toEqual([
      sourcePageUrl,
      "https://relayops.com/",
      "https://relayops.com/product/",
      "https://relayops.com/products/",
      "https://relayops.com/features/",
      "https://relayops.com/solutions/",
      "https://relayops.com/use-cases/",
      "https://relayops.com/pricing/",
      "https://relayops.com/integrations/",
      "https://relayops.com/about/",
      "https://relayops.com/company/",
      "https://relayops.com/a-first/",
    ]);

    const repeated = selectProductProfileSynthesisPages(
      [...candidates].reverse(),
      sourcePageUrl,
    );
    expect(repeated.map((row) => row.page_snapshot_id)).toEqual(
      selected.map((row) => row.page_snapshot_id),
    );
  });

  it("uses PageSnapshot id as the final deterministic tie-break", () => {
    const larger = {
      ...pageRow(20, "https://relayops.com/features/"),
      page_snapshot_id: uuid(999),
    };
    const smaller = {
      ...larger,
      page_snapshot_id: uuid(998),
      site_page_id: uuid(998),
    };
    const selected = selectProductProfileSynthesisPages(
      [larger, sourcePage, smaller],
      sourcePageUrl,
    );
    expect(selected.slice(1).map((row) => row.page_snapshot_id)).toEqual([
      uuid(998),
      uuid(999),
    ]);
  });

  it("requires the exact product page rather than substituting root", () => {
    expect(() =>
      selectProductProfileSynthesisPages(
        [pageRow(2, "https://relayops.com/")],
        sourcePageUrl,
      ),
    ).toThrow(
      expect.objectContaining({ code: "CRAWL_SNAPSHOT_REQUIRED", status: 422 }),
    );
  });
});

describe("Product Profile PageSnapshot integrity", () => {
  it("accepts exact canonical extract, content, URL, snapshot, Site and scope identity", () => {
    expect(() =>
      assertProductProfileSynthesisPageRows(
        { workspaceId, projectId },
        siteId,
        snapshotId,
        [sourcePage],
      ),
    ).not.toThrow();
  });

  it.each([
    ["foreign workspace", { workspace_id: uuid(600) }],
    ["foreign project", { project_id: uuid(601) }],
    ["foreign Site", { site_id: uuid(602) }],
    ["foreign snapshot", { data_snapshot_id: uuid(603) }],
    ["missing canonical extract", { canonical_extract: null }],
    ["drifted canonical extract", { canonical_extract: "{}" }],
    ["drifted content hash", { content_hash: "b".repeat(64) }],
    ["drifted normalized URL hash", { normalized_url_hash: "c".repeat(64) }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      assertProductProfileSynthesisPageRows(
        { workspaceId, projectId },
        siteId,
        snapshotId,
        [pageRow(1, sourcePageUrl, override)],
      ),
    ).toThrow(
      expect.objectContaining({
        code: "SNAPSHOT_PROJECT_MISMATCH",
        status: 422,
      }),
    );
  });
});

describe("Product Profile frozen synthesis manifest", () => {
  it("contains only bounded identity metadata and has the exact JCS hash", () => {
    const built = buildProductProfileSynthesisFrozenInput({
      projectId,
      siteId,
      sourcePageUrl,
      baseProfile: persistedProfile,
      crawlSnapshot: { ...snapshot, availability: "partial" as const },
      pages: [sourcePage],
    });

    expect(built.manifest).toEqual({
      schemaVersion: PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
      selectionPolicyVersion: PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
      projectId,
      siteId,
      sourcePageUrl,
      baseProfile: {
        id: profileId,
        version: 1,
        contentHash: profileHash,
        status: "draft",
      },
      crawlSnapshot: {
        id: snapshotId,
        collectionRunId,
        sourceConnectionId: null,
        provider: "crawl",
        datasetKey: CRAWL_DATASET_KEY,
        schemaVersion: "crawl.site_graph.0.3.0",
        methodVersion: CRAWL_METHOD_VERSION,
        capturedAt: "2026-07-22T01:02:03.000Z",
        checksum: "a".repeat(64),
        availability: "partial",
        rowCount: 1,
        limitation: "Static public HTML only.",
      },
      pages: [
        {
          pageSnapshotId: sourcePage.page_snapshot_id,
          sitePageId: sourcePage.site_page_id,
          dataSnapshotId: snapshotId,
          normalizedUrl: sourcePageUrl,
          normalizedUrlHash: sourcePage.normalized_url_hash,
          contentHash: sourcePage.content_hash,
          capturedAt: sourcePage.captured_at,
        },
      ],
    });
    expect(ProductProfileSynthesisInputManifest.parse(built.manifest)).toEqual(
      built.manifest,
    );
    expect(built.inputHash).toBe(contentHash(built.manifest));
    expect(JSON.stringify(built.manifest)).not.toContain("private-extract");
    expect(built.manifest).not.toHaveProperty("extract");
  });

  it("normalizes PostgreSQL timestamptz text to one RFC3339 UTC identity", () => {
    const built = buildProductProfileSynthesisFrozenInput({
      projectId,
      siteId,
      sourcePageUrl,
      baseProfile: persistedProfile,
      crawlSnapshot: {
        ...snapshot,
        captured_at: "2026-07-22 01:02:03+00",
      },
      pages: [
        {
          ...sourcePage,
          captured_at: "2026-07-22 01:02:03+00",
        },
      ],
    });

    expect(built.manifest.crawlSnapshot.capturedAt).toBe(
      "2026-07-22T01:02:03.000Z",
    );
    expect(built.manifest.pages[0]?.capturedAt).toBe(
      "2026-07-22T01:02:03.000Z",
    );
  });
});

describe("createProductProfileSynthesisRun", () => {
  it("reserves for 24h, freezes partial lineage, inserts one run and enqueues once in one transaction", async () => {
    arrangeAccepted({
      snapshot: { ...snapshot, availability: "partial" },
    });

    const accepted = await createProductProfileSynthesisRun(
      { workspaceId },
      projectId,
      actorId,
      "profile-synthesis-key",
      { baseVersion: 1 },
    );

    expect(accepted).toMatchObject({
      status: 202,
      replayed: false,
      run: { id: runId, kind: "product_profile_synthesis" },
      resourceRef: { type: "product_profile_run", id: runId },
      location: `/api/mvp/projects/${projectId}/runs/${runId}`,
    });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(IdempotencyRepository.prototype.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        scope: "createProductProfileSynthesisRun",
        key: "profile-synthesis-key",
        requestHash: contentHash({ projectId, baseVersion: 1 }),
        expiresAt: expect.any(String),
      }),
    );
    const expiresAt = Date.parse(
      vi.mocked(IdempotencyRepository.prototype.begin).mock.calls[0]![0]
        .expiresAt,
    );
    expect(expiresAt - Date.now()).toBeGreaterThan(23.9 * 60 * 60 * 1000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(
      DataSnapshotsRepository.prototype.findLatestEligibleCrawlBySite,
    ).toHaveBeenCalledWith(
      { workspaceId, projectId },
      siteId,
      CRAWL_DATASET_KEY,
      CRAWL_METHOD_VERSION,
    );
    expect(AsyncRunsRepository.prototype.insertQueued).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      kind: "product_profile_synthesis",
      activeKey: "product-profile:synthesis",
      initiatedBy: actorId,
      contractVersion: expect.any(String),
      requestPayload: {
        baseVersion: 1,
        sourceSnapshotId: snapshotId,
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(
      ProductProfileRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        baseIcpProfileId: profileId,
        baseIcpProfileVersion: 1,
        baseIcpProfileContentHash: profileHash,
        sourceSnapshotId: snapshotId,
        synthesisVersion: PRODUCT_PROFILE_SYNTHESIS_VERSION,
        promptSetVersion: PRODUCT_PROFILE_PROMPT_SET_VERSION,
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        inputManifest: expect.objectContaining({
          crawlSnapshot: expect.objectContaining({
            availability: "partial",
            limitation: "Static public HTML only.",
          }),
        }),
      }),
    );
    const inserted = vi.mocked(
      ProductProfileRunsRepository.prototype.insertPlaceholder,
    ).mock.calls[0]![0];
    expect(inserted.inputHash).toBe(
      contentHash(inserted.inputManifest as CanonicalValue),
    );
    expect(JSON.stringify(inserted.inputManifest)).not.toContain(
      "private-extract",
    );
    expect(mocks.enqueueRunInTx).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      mocks.tx,
      "profile.synthesize",
      {
        runId,
        workspaceId,
        projectId,
        contractVersion: expect.any(String),
      },
    );
  });

  it("replays a completed command before reading mutable project state", async () => {
    const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue({
      id: idemRowId,
      workspace_id: workspaceId,
      scope: "createProductProfileSynthesisRun",
      idempotency_key: "replay-key",
      request_hash: contentHash({ projectId, baseVersion: 1 }),
      status: "completed",
      response_status: 202,
      response_body: {
        run: {
          id: runId,
          projectId,
          kind: "product_profile_synthesis",
          status: "queued",
          progress: {
            phase: "queued",
            current: 0,
            total: null,
            messageKey: "run.queued",
          },
          lastError: null,
          resultRef: null,
          queuedAt: queuedRun.queued_at,
          startedAt: null,
          completedAt: null,
        },
        statusUrl,
        resourceRef: { type: "product_profile_run", id: runId },
      },
      resource_type: "product_profile_run",
      resource_id: runId,
      expires_at: "2026-07-23T00:00:00.000Z",
    });
    const projectLock = vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    );
    const active = vi.spyOn(AsyncRunsRepository.prototype, "findActive");

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "replay-key",
        { baseVersion: 1 },
      ),
    ).resolves.toMatchObject({
      status: 202,
      replayed: true,
      run: { id: runId },
      resourceRef: { type: "product_profile_run", id: runId },
    });
    expect(projectLock).not.toHaveBeenCalled();
    expect(active).not.toHaveBeenCalled();
    expect(mocks.getBoss).not.toHaveBeenCalled();
  });

  it("rejects a stale baseVersion before reading Crawl state or enqueueing", async () => {
    arrangeAccepted({
      profile: { ...persistedProfile, version: 2 },
    });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "stale-key",
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect(
      DataSnapshotsRepository.prototype.findLatestEligibleCrawlBySite,
    ).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("requires a current Product Profile pointer", async () => {
    arrangeAccepted({
      project: { ...project, current_icp_profile_id: null },
    });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "missing-current-profile",
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
    expect(IcpProfilesRepository.prototype.findById).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("rejects a confirmed current Product Profile before run or queue work", async () => {
    arrangeAccepted({
      profile: {
        ...persistedProfile,
        status: "complete",
        content_hash: contentHash({ status: "complete", profile }),
      },
    });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "confirmed-current-profile",
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({
      code: "CONTEXT_INCOMPLETE",
      status: 422,
      message: "A current Product Profile draft is required for synthesis.",
    });
    expect(
      DataSnapshotsRepository.prototype.findLatestEligibleCrawlBySite,
    ).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
    expect(
      ProductProfileRunsRepository.prototype.insertPlaceholder,
    ).not.toHaveBeenCalled();
    expect(mocks.getBoss).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("recomputes the exact persisted profile payload hash before selecting Crawl data", async () => {
    arrangeAccepted({
      profile: { ...persistedProfile, content_hash: "d".repeat(64) },
    });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "profile-hash-drift",
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
    expect(
      DataSnapshotsRepository.prototype.findLatestEligibleCrawlBySite,
    ).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it.each([
    ["primary Site id", { ...site, id: uuid(710) }],
    [
      "source page origin",
      { ...site, origin: "https://different.example.com" },
    ],
  ])("rejects drift in the %s identity fence", async (_label, primarySite) => {
    arrangeAccepted({ site: primarySite });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        `site-identity-${String(_label)}`,
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({
      code: "SNAPSHOT_PROJECT_MISMATCH",
      status: 422,
    });
    expect(
      DataSnapshotsRepository.prototype.findLatestEligibleCrawlBySite,
    ).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it.each([
    ["no eligible current-method Crawl snapshot", null],
    [
      "obsolete Crawl method returned by a corrupt selector",
      { ...snapshot, method_version: "crawl.site_graph.v1" },
    ],
    [
      "unavailable Crawl snapshot returned by a corrupt selector",
      { ...snapshot, availability: "unavailable" },
    ],
  ])("rejects %s", async (_label, selectedSnapshot) => {
    arrangeAccepted({ snapshot: selectedSnapshot as typeof snapshot | null });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        `snapshot-key-${String(_label)}`,
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({
      code: "CRAWL_SNAPSHOT_REQUIRED",
      status: 422,
    });
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("rejects a foreign snapshot identity", async () => {
    arrangeAccepted({
      snapshot: { ...snapshot, site_id: uuid(700) },
    });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "foreign-snapshot",
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({
      code: "SNAPSHOT_PROJECT_MISMATCH",
      status: 422,
    });
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("rejects a Crawl snapshot without the exact product page", async () => {
    arrangeAccepted({
      pages: [pageRow(2, "https://relayops.com/")],
    });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "missing-source-page",
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({
      code: "CRAWL_SNAPSHOT_REQUIRED",
      status: 422,
    });
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("returns the winning active run with a stable Location", async () => {
    arrangeAccepted({ active: queuedRun });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "active-key",
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      extraHeaders: {
        Location: `/api/mvp/projects/${projectId}/runs/${runId}`,
      },
      current: {
        runId,
        statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
      },
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("maps a 23505 active-key race to the winning run", async () => {
    arrangeAccepted();
    mocks.db.transaction.mockRejectedValueOnce({
      code: "23505",
      constraint: "async_runs_one_active_key_idx",
    });
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockResolvedValueOnce(
      null,
    );
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockResolvedValueOnce(
      queuedRun,
    );

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "race-key",
        { baseVersion: 1 },
      ),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      current: { runId },
    });
  });

  it("rejects reuse of a completed key with a different baseVersion", async () => {
    const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue({
      id: idemRowId,
      workspace_id: workspaceId,
      scope: "createProductProfileSynthesisRun",
      idempotency_key: "reused-key",
      request_hash: contentHash({ projectId, baseVersion: 1 }),
      status: "completed",
      response_status: 202,
      response_body: {
        run: { id: runId },
        statusUrl,
        resourceRef: { type: "product_profile_run", id: runId },
      },
      resource_type: "product_profile_run",
      resource_id: runId,
      expires_at: "2026-07-23T00:00:00.000Z",
    });

    await expect(
      createProductProfileSynthesisRun(
        { workspaceId },
        projectId,
        actorId,
        "reused-key",
        { baseVersion: 2 },
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });
});
