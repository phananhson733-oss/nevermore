import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMeasurementGeoCitationsQueryOptions,
  getMeasurementGeoCitations,
  measurementGeoCitationsQueryKey,
} from "./hooks-results-geo-citations";

const IDS = {
  project: "d9000000-0000-4000-8000-000000000001",
  window: "d9000000-0000-4000-8000-000000000002",
  site: "d9000000-0000-4000-8000-000000000003",
  page: "d9000000-0000-4000-8000-000000000004",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Measurement GEO citation evidence query", () => {
  it("keeps the selected URL window and UI locale in a stable key", () => {
    expect(
      measurementGeoCitationsQueryKey(
        IDS.project,
        IDS.window,
        "zh-CN",
      ),
    ).toEqual([
      "measurement-window",
      "geo-citations",
      IDS.project,
      IDS.window,
      "zh-CN",
    ]);
    expect(
      buildMeasurementGeoCitationsQueryOptions(
        IDS.project,
        "",
        "zh-CN",
      ).enabled,
    ).toBe(false);
  });

  it("reads the fixed-window reverse lookup without caller filters", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            projectId: IDS.project,
            siteId: IDS.site,
            measurementWindowId: IDS.window,
            sitePageId: IDS.page,
            canonicalUrl:
              "https://example.com/customer-onboarding/",
            interpretation: "observational_non_causal",
            phases: { baseline: null, outcome: null },
            limitation:
              "No real GEO citation observations exist yet.",
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
      getMeasurementGeoCitations(IDS.project, IDS.window),
    ).resolves.toMatchObject({
      measurementWindowId: IDS.window,
      phases: { baseline: null, outcome: null },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${IDS.project}/measurement-windows/${IDS.window}/geo-citations`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      }),
    );
  });

  it("rejects payloads that invent a causal reason for citation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              projectId: IDS.project,
              siteId: IDS.site,
              measurementWindowId: IDS.window,
              sitePageId: IDS.page,
              canonicalUrl: "https://example.com/",
              interpretation: "caused_by_content_change",
              phases: { baseline: null, outcome: null },
              limitation: null,
              whyItWasCited: "Because of the published artifact.",
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
      getMeasurementGeoCitations(IDS.project, IDS.window),
    ).rejects.toThrow();
  });
});
