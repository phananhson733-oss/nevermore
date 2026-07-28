import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGrowthMapBacklinksQueryOptions,
  getGrowthMapBacklinks,
  growthMapBacklinksQueryKey,
} from "./hooks-growth-map-backlinks";

const PROJECT_ID = "c2000000-0000-4000-8000-000000000001";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Growth Map backlink query", () => {
  it("keeps the project and UI locale in one stable Growth Map key", () => {
    expect(
      growthMapBacklinksQueryKey(PROJECT_ID, "zh-CN"),
    ).toEqual(["growth-map", PROJECT_ID, "zh-CN", "backlinks"]);
    expect(
      buildGrowthMapBacklinksQueryOptions("", "zh-CN").enabled,
    ).toBe(false);
  });

  it("reads and validates an unavailable response without inventing zeros", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            projectId: PROJECT_ID,
            generatedAt: "2026-07-28T12:00:00.000Z",
            coverage: {
              availability: "unavailable",
              indexScope: "unavailable",
              limitations: ["尚无可读取的外链数据快照。"],
            },
            sources: [],
            primarySite: null,
            approvedCompetitors: [],
            comparison: {
              state: "unavailable",
              provider: null,
              primarySiteSnapshotId: null,
              competitorSnapshotIds: [],
              limitation: "尚无可读取的外链数据快照。",
            },
            pages: [],
            referringDomains: [],
            opportunities: [],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapBacklinks(PROJECT_ID)).resolves.toMatchObject({
      primarySite: null,
      coverage: { availability: "unavailable" },
      pages: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/backlinks`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      }),
    );
  });

  it("rejects a search-derived payload that claims DR and complete totals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              projectId: PROJECT_ID,
              generatedAt: "2026-07-28T12:00:00.000Z",
              coverage: {
                availability: "partial",
                indexScope: "observed_subset",
                limitations: ["仅代表已发现记录。"],
              },
              sources: [
                {
                  snapshotId:
                    "c2000000-0000-4000-8000-000000000002",
                  subjectKind: "primary_site",
                  subjectId:
                    "c2000000-0000-4000-8000-000000000003",
                  subjectName: "RelayOps",
                  domain: "relayops.example",
                  sourceKind: "search_derived",
                  provider: "search_derived",
                  capturedAt: "2026-07-28T00:00:00.000Z",
                  coverage: {
                    availability: "partial",
                    indexScope: "observed_subset",
                    limitations: ["仅代表已发现记录。"],
                  },
                  backlinks: {
                    semantics: "provider_index_total",
                    value: 10,
                  },
                  referringDomains: {
                    semantics: "provider_index_total",
                    value: 8,
                  },
                  authorityMetric: {
                    kind: "domain_rating",
                    value: 50,
                  },
                  trace: {
                    sourceRef: "search-derived:2026-07",
                    checksum: "a".repeat(64),
                    rowCount: 10,
                    importPreviewId: null,
                  },
                },
              ],
              primarySite: null,
              approvedCompetitors: [],
              comparison: {
                state: "insufficient",
                provider: null,
                primarySiteSnapshotId: null,
                competitorSnapshotIds: [],
                limitation: "无可比竞品。",
              },
              pages: [],
              referringDomains: [],
              opportunities: [],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );
    await expect(getGrowthMapBacklinks(PROJECT_ID)).rejects.toThrow();
  });
});
