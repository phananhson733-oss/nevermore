import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildRecentMeasurementWindowsQueryOptions,
  getRecentMeasurementWindows,
  recentMeasurementWindowsQueryKey,
} from "./hooks-results";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const GENERATED_AT = "2026-07-27T12:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recent Measurement Window query", () => {
  it("uses a project-scoped stable query key and disables blank projects", () => {
    expect(recentMeasurementWindowsQueryKey(PROJECT_ID, 25)).toEqual([
      "measurement-windows",
      "recent",
      PROJECT_ID,
      25,
    ]);
    expect(
      buildRecentMeasurementWindowsQueryOptions("", 25).enabled,
    ).toBe(false);
  });

  it("calls the bounded project feed and validates the runtime contract", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            projectId: PROJECT_ID,
            windows: [],
            generatedAt: GENERATED_AT,
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
      getRecentMeasurementWindows(PROJECT_ID, 25),
    ).resolves.toEqual({
      projectId: PROJECT_ID,
      windows: [],
      generatedAt: GENERATED_AT,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/measurement-windows/recent?limit=25`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      }),
    );
  });

  it("rejects a project-crossing payload rather than rendering it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              projectId: "not-a-uuid",
              windows: [],
              generatedAt: GENERATED_AT,
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
      getRecentMeasurementWindows(PROJECT_ID),
    ).rejects.toThrow();
  });
});
