import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMeasurementTargetKeywordRanksQueryOptions,
  getMeasurementTargetKeywordRanks,
  measurementTargetKeywordRanksQueryKey,
} from "./hooks-results-keyword-ranks";

const IDS = {
  project: "d1000000-0000-4000-8000-000000000001",
  window: "d1000000-0000-4000-8000-000000000002",
  page: "d1000000-0000-4000-8000-000000000003",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Measurement target Keyword rank query", () => {
  it("keeps the selected URL window and UI locale in a stable key", () => {
    expect(
      measurementTargetKeywordRanksQueryKey(
        IDS.project,
        IDS.window,
        "zh-CN",
      ),
    ).toEqual([
      "measurement-window",
      "target-keyword-ranks",
      IDS.project,
      IDS.window,
      "zh-CN",
    ]);
    expect(
      buildMeasurementTargetKeywordRanksQueryOptions(
        IDS.project,
        "",
        "zh-CN",
      ).enabled,
    ).toBe(false);
  });

  it("reads the fixed-window endpoint and validates unavailable coverage", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            projectId: IDS.project,
            measurementWindowId: IDS.window,
            sitePageId: IDS.page,
            canonicalUrl:
              "https://example.com/customer-onboarding/",
            beforeWindow: {
              startAt: "2026-05-01T00:00:00.000Z",
              endAt: "2026-05-29T00:00:00.000Z",
            },
            afterWindow: {
              startAt: "2026-06-29T00:00:00.000Z",
              endAt: "2026-07-27T00:00:00.000Z",
            },
            interpretation:
              "dataforseo_absolute_rank_observational_non_causal",
            keywords: [],
            coverage: {
              availability: "unavailable",
              limitations: [
                "No confirmed target Keywords are mapped to this exact page.",
              ],
            },
            generatedAt: "2026-07-27T00:00:00.000Z",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getMeasurementTargetKeywordRanks(
        IDS.project,
        IDS.window,
      ),
    ).resolves.toMatchObject({
      measurementWindowId: IDS.window,
      keywords: [],
      coverage: { availability: "unavailable" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${IDS.project}/measurement-windows/${IDS.window}/keyword-ranks`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      }),
    );
  });

  it("rejects a payload that disguises GSC average position as absolute rank", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              projectId: IDS.project,
              measurementWindowId: IDS.window,
              sitePageId: IDS.page,
              canonicalUrl: "https://example.com/",
              beforeWindow: {
                startAt: "2026-05-01T00:00:00.000Z",
                endAt: "2026-05-29T00:00:00.000Z",
              },
              afterWindow: {
                startAt: "2026-06-29T00:00:00.000Z",
                endAt: "2026-07-27T00:00:00.000Z",
              },
              interpretation:
                "dataforseo_absolute_rank_observational_non_causal",
              keywords: [
                {
                  keywordId:
                    "d1000000-0000-4000-8000-000000000004",
                  displayKeyword: "customer onboarding",
                  normalizedKeyword: "customer onboarding",
                  marketCode: "US",
                  languageTag: "en-US",
                  topicNodeId:
                    "d1000000-0000-4000-8000-000000000005",
                  topicLabel: "Onboarding",
                  topicModelRevision: 1,
                  state: "observed",
                  baselineObservation: {
                    occurrenceId:
                      "d1000000-0000-4000-8000-000000000006",
                    snapshotId:
                      "d1000000-0000-4000-8000-000000000007",
                    observationId:
                      "d1000000-0000-4000-8000-000000000008",
                    provider: "gsc",
                    metric: "gsc_28d_average_position",
                    value: 12,
                    valuePointer:
                      "/valueJson/topQueries/0/position",
                    observedAt: "2026-05-20T00:00:00.000Z",
                    providerDataAsOf: null,
                    grade: "A",
                    limitation: null,
                  },
                  outcomeObservation: {
                    occurrenceId:
                      "d1000000-0000-4000-8000-000000000009",
                    snapshotId:
                      "d1000000-0000-4000-8000-00000000000a",
                    observationId:
                      "d1000000-0000-4000-8000-00000000000b",
                    provider: "gsc",
                    metric: "gsc_28d_average_position",
                    value: 7,
                    valuePointer:
                      "/valueJson/topQueries/0/position",
                    observedAt: "2026-07-20T00:00:00.000Z",
                    providerDataAsOf: null,
                    grade: "A",
                    limitation: null,
                  },
                  rankImprovement: 5,
                  trend: "improved",
                  limitation: null,
                },
              ],
              coverage: {
                availability: "available",
                limitations: [],
              },
              generatedAt: "2026-07-27T00:00:00.000Z",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      getMeasurementTargetKeywordRanks(
        IDS.project,
        IDS.window,
      ),
    ).rejects.toThrow();
  });
});
