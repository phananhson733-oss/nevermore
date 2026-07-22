import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CollectionRunsRepository,
  CompetitorsRepository,
  ImportPreviewsRepository,
  ObservationsRepository,
  type CollectionRunRow,
  type DataSnapshotRow,
  type ImportPreviewRow,
  type ObservationRow,
} from "@sf/db";
import {
  deriveCsvCompetitorOriginInput,
  projectCollectionSnapshotCompetitors,
} from "./competitor-library-projection.ts";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const snapshotId = "00000000-0000-4000-8000-000000000003";
const observationId = "00000000-0000-4000-8000-000000000004";
const siteId = "00000000-0000-4000-8000-000000000005";
const runId = "00000000-0000-4000-8000-000000000006";
const previewId = "00000000-0000-4000-8000-000000000007";
const collectedAt = "2026-07-22T08:00:00.000Z";
const scope = { workspaceId, projectId } as const;

function snapshot(
  overrides: Partial<DataSnapshotRow> = {},
): DataSnapshotRow {
  return {
    id: snapshotId,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    collection_run_id: runId,
    source_connection_id: null,
    provider: "csv",
    dataset_key: "csv.keyword_gap.v1",
    schema_version: "0.2.0",
    method_version: "csv.keyword_gap.v1",
    captured_at: collectedAt,
    source_window: { start: null, end: null },
    availability: "available",
    limitation: "User-provided keyword gap CSV.",
    raw_object_key: "snapshot-raw/project/run/object",
    row_count: 1,
    checksum: "checksum",
    summary: {},
    created_at: collectedAt,
    ...overrides,
  };
}

function collectionRun(
  overrides: Partial<CollectionRunRow> = {},
): CollectionRunRow {
  return {
    id: runId,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    source_connection_id: null,
    import_preview_id: previewId,
    crawl_seed_site_page_id: null,
    crawl_seed_url: null,
    provider: "csv",
    operation: "keyword_gap_import",
    method_version: "csv.keyword_gap.v1",
    parameters_hash: "parameters-hash",
    row_count: null,
    stop_reason: null,
    created_at: collectedAt,
    ...overrides,
  };
}

function importPreview(
  overrides: Partial<ImportPreviewRow> = {},
): ImportPreviewRow {
  return {
    id: previewId,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    created_by: "00000000-0000-4000-8000-000000000008",
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
    expires_at: "2026-07-22T09:00:00.000Z",
    consumed_at: "2026-07-22T07:59:00.000Z",
    created_at: "2026-07-22T07:58:00.000Z",
    updated_at: "2026-07-22T07:59:00.000Z",
    ...overrides,
  };
}

function observation(
  overrides: Partial<ObservationRow> = {},
): ObservationRow {
  return {
    id: observationId,
    workspace_id: workspaceId,
    project_id: projectId,
    snapshot_id: snapshotId,
    site_page_id: null,
    provider: "csv",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    subject_ref: "customer-onboarding",
    observed_at: collectedAt,
    availability: "available",
    value_numeric: null,
    value_text: null,
    value_json: {
      keyword: "Customer Onboarding Software",
      clusterKey: "customer-onboarding",
      searchVolume: 2_400,
      currentUrl: null,
      currentRank: null,
      competitorDomain: "example-competitor.com",
      competitorRank: 4,
      marketCode: "US",
      languageCode: "en-US",
    },
    unit: null,
    origin: "user_provided",
    method: "observed",
    grade: "C",
    support: "supports",
    limitation: "User-provided keyword gap CSV.",
    ...overrides,
  };
}

function observationValueJson(): Record<string, unknown> {
  return observation().value_json as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deriveCsvCompetitorOriginInput", () => {
  it("projects only the canonical competitorDomain pointer with exact CSV lineage", () => {
    expect(
      deriveCsvCompetitorOriginInput(
        snapshot(),
        collectionRun(),
        importPreview(),
        observation(),
      ),
    ).toEqual({
      originKind: "csv_keyword_gap",
      domain: "example-competitor.com",
      name: null,
      snapshotId,
      observationId,
      importPreviewId: previewId,
      sourcePointer: "/valueJson/competitorDomain",
    });
  });

  it.each([
    ["missing domain", { value_json: { ...observationValueJson(), competitorDomain: null } }],
    ["unavailable", { availability: "unavailable", value_json: null }],
    ["wrong metric", { metric_key: "csv.unrelated.v1" }],
    ["wrong origin", { origin: "vendor_observation" }],
    ["wrong grade", { grade: "B" }],
  ] as const)("does not invent a competitor for %s", (_label, overrides) => {
    expect(
      deriveCsvCompetitorOriginInput(
        snapshot(),
        collectionRun(),
        importPreview(),
        observation(overrides as Partial<ObservationRow>),
      ),
    ).toBeNull();
  });

  it("fails closed when Snapshot, CollectionRun, ImportPreview, or Observation lineage drifts", () => {
    const cases: ReadonlyArray<readonly [string, () => unknown]> = [
      [
        "snapshot dataset",
        () =>
          deriveCsvCompetitorOriginInput(
            snapshot({ dataset_key: "csv.other.v1" }),
            collectionRun(),
            importPreview(),
            observation(),
          ),
      ],
      [
        "collection run",
        () =>
          deriveCsvCompetitorOriginInput(
            snapshot(),
            collectionRun({ id: "00000000-0000-4000-8000-000000000099" }),
            importPreview(),
            observation(),
          ),
      ],
      [
        "consumed preview",
        () =>
          deriveCsvCompetitorOriginInput(
            snapshot(),
            collectionRun(),
            importPreview({ status: "previewed", consumed_at: null }),
            observation(),
          ),
      ],
      [
        "preview template",
        () =>
          deriveCsvCompetitorOriginInput(
            snapshot(),
            collectionRun(),
            importPreview({ template_id: "other_v1" }),
            observation(),
          ),
      ],
      [
        "observation snapshot",
        () =>
          deriveCsvCompetitorOriginInput(
            snapshot(),
            collectionRun(),
            importPreview(),
            observation({
              snapshot_id: "00000000-0000-4000-8000-000000000099",
            }),
          ),
      ],
      [
        "observation timestamp",
        () =>
          deriveCsvCompetitorOriginInput(
            snapshot(),
            collectionRun(),
            importPreview(),
            observation({ observed_at: "2026-07-22T08:00:01.000Z" }),
          ),
      ],
    ];
    for (const [label, derive] of cases) {
      expect(derive, label).toThrow(/canonical|lineage|consumed/i);
    }
  });

  it("rejects a noncanonical observed domain instead of repairing or naming it", () => {
    expect(() =>
      deriveCsvCompetitorOriginInput(
        snapshot(),
        collectionRun(),
        importPreview(),
        observation({
          value_json: {
            ...observationValueJson(),
            competitorDomain: "https://Example-Competitor.com/pricing",
          },
        }),
      ),
    ).toThrow(/domain/i);
  });

  it("rejects a malformed canonical valueJson instead of treating it as an empty row", () => {
    expect(() =>
      deriveCsvCompetitorOriginInput(
        snapshot(),
        collectionRun(),
        importPreview(),
        observation({ value_json: [] }),
      ),
    ).toThrow(/valueJson/i);
  });
});

describe("projectCollectionSnapshotCompetitors", () => {
  it("pages canonical Observations and upserts every exact CSV origin idempotently", async () => {
    vi.spyOn(
      CollectionRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(collectionRun());
    vi.spyOn(
      ImportPreviewsRepository.prototype,
      "findById",
    ).mockResolvedValue(importPreview());
    vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIdsPage",
    )
      .mockResolvedValueOnce({
        rows: [observation()],
        nextCursor: "next-observation-cursor",
      })
      .mockResolvedValueOnce({
        rows: [
          observation({
            id: "00000000-0000-4000-8000-000000000009",
            value_json: {
              ...observationValueJson(),
              competitorDomain: "second-competitor.com",
            },
          }),
        ],
        nextCursor: null,
      });
    const upsert = vi
      .spyOn(CompetitorsRepository.prototype, "upsertOrigin")
      .mockResolvedValue({
        occurrenceId: "00000000-0000-4000-8000-000000000010",
        competitorId: "00000000-0000-4000-8000-000000000011",
      });

    await expect(
      projectCollectionSnapshotCompetitors({} as never, scope, snapshot()),
    ).resolves.toBe(2);

    expect(CollectionRunsRepository.prototype.findById).toHaveBeenCalledWith(
      runId,
    );
    expect(ImportPreviewsRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      previewId,
    );
    expect(
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    ).toHaveBeenNthCalledWith(1, scope, [snapshotId], {
      limit: 500,
      cursor: null,
    });
    expect(
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    ).toHaveBeenNthCalledWith(2, scope, [snapshotId], {
      limit: 500,
      cursor: "next-observation-cursor",
    });
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      scope,
      expect.objectContaining({
        domain: "example-competitor.com",
        name: null,
        observationId,
      }),
    );
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      scope,
      expect.objectContaining({
        domain: "second-competitor.com",
        name: null,
        observationId: "00000000-0000-4000-8000-000000000009",
      }),
    );
  });

  it("never inspects or projects DataForSEO, SERP, AI, or other providers", async () => {
    const findRun = vi.spyOn(
      CollectionRunsRepository.prototype,
      "findById",
    );
    const list = vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIdsPage",
    );
    const upsert = vi.spyOn(
      CompetitorsRepository.prototype,
      "upsertOrigin",
    );

    for (const provider of ["dataforseo", "gsc", "ai_citation", "serp"]) {
      await expect(
        projectCollectionSnapshotCompetitors(
          {} as never,
          scope,
          snapshot({ provider }),
        ),
      ).resolves.toBe(0);
    }

    expect(findRun).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails closed when project, CollectionRun, or ImportPreview scope is absent", async () => {
    const findRun = vi
      .spyOn(CollectionRunsRepository.prototype, "findById")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(collectionRun());
    const findPreview = vi
      .spyOn(ImportPreviewsRepository.prototype, "findById")
      .mockResolvedValueOnce(null);

    await expect(
      projectCollectionSnapshotCompetitors({} as never, scope, snapshot()),
    ).rejects.toThrow(/CollectionRun.*ImportPreview/i);
    await expect(
      projectCollectionSnapshotCompetitors({} as never, scope, snapshot()),
    ).rejects.toThrow(/consumed ImportPreview/i);
    await expect(
      projectCollectionSnapshotCompetitors(
        {} as never,
        { ...scope, projectId: "00000000-0000-4000-8000-000000000099" },
        snapshot(),
      ),
    ).rejects.toThrow(/selected project/i);

    expect(findRun).toHaveBeenCalledTimes(2);
    expect(findPreview).toHaveBeenCalledOnce();
  });

  it("fails closed if canonical Observation pagination cannot advance", async () => {
    vi.spyOn(
      CollectionRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(collectionRun());
    vi.spyOn(
      ImportPreviewsRepository.prototype,
      "findById",
    ).mockResolvedValue(importPreview());
    vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIdsPage",
    ).mockResolvedValue({ rows: [], nextCursor: "stuck-cursor" });
    const upsert = vi.spyOn(
      CompetitorsRepository.prototype,
      "upsertOrigin",
    );

    await expect(
      projectCollectionSnapshotCompetitors({} as never, scope, snapshot()),
    ).rejects.toThrow(/cursor did not advance/i);
    expect(upsert).not.toHaveBeenCalled();
  });
});
