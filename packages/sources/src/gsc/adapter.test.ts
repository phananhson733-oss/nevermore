import { describe, expect, it, vi } from "vitest";
import { SourceError, type CollectionContext } from "../adapter.ts";
import { createGscAdapter, gscAdapter } from "./adapter.ts";
import { GSC_MAX_ROWS, type GscClient, type GscRow } from "./client.ts";

const context: CollectionContext = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  siteId: "site-1",
  runId: "run-1",
  signal: new AbortController().signal,
};
const row: GscRow = {
  date: "2026-07-15",
  page: "https://example.com/pricing",
  query: "pricing",
  clicks: 4,
  impressions: 100,
  position: 3.5,
};

async function collectAsync<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

function adapterWith(rows: readonly GscRow[]) {
  const querySearchAnalytics = vi.fn<GscClient["querySearchAnalytics"]>();
  querySearchAnalytics.mockResolvedValue(rows);
  return {
    adapter: createGscAdapter({ querySearchAnalytics }),
    querySearchAnalytics,
  };
}

describe("GSC source adapter", () => {
  it("validates and trims the selected property", async () => {
    const { adapter } = adapterWith([]);
    await expect(adapter.validateConfig(null)).rejects.toMatchObject({
      code: "INVALID_CONFIGURATION",
    });
    await expect(adapter.validateConfig({})).rejects.toMatchObject({
      code: "INVALID_CONFIGURATION",
    });
    await expect(
      adapter.validateConfig({ propertyUrl: "   " }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      adapter.validateConfig({ propertyUrl: " sc-domain:example.com " }),
    ).resolves.toEqual({ propertyUrl: "sc-domain:example.com" });
  });

  it("advertises the final Search Analytics dataset", async () => {
    const { adapter } = adapterWith([]);
    await expect(
      adapter.capabilities({ propertyUrl: "sc-domain:example.com" }),
    ).resolves.toEqual([
      expect.objectContaining({
        datasetKey: "gsc.page_query_daily.v1",
        operation: "search_analytics",
        available: true,
      }),
    ]);
  });

  it("collects an available snapshot with an injected clock and timezone", async () => {
    const { adapter, querySearchAnalytics } = adapterWith([row]);
    const result = await adapter.collect(
      {
        now: new Date("2026-07-18T12:00:00.000Z"),
        timeZone: "UTC",
        propertyUrl: "sc-domain:example.com",
      },
      context,
    );
    expect(querySearchAnalytics).toHaveBeenCalledWith(
      {
        startDate: "2026-05-21",
        endDate: "2026-07-15",
      },
      context.signal,
    );
    expect(result).toMatchObject({
      availability: "available",
      rowCount: 1,
      stopReason: null,
      providerUsage: { rows: 1 },
      raw: {
        propertyUrl: "sc-domain:example.com",
        rowCount: 1,
        truncated: false,
      },
    });
    const observations = await collectAsync(
      adapter.normalize(result.raw, {
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        siteId: context.siteId,
        capturedAt: result.capturedAt,
      }),
    );
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      subjectRef: "https://example.com/pricing",
      metricKey: "gsc.page.v1",
    });
  });

  it("marks a successful empty response as unavailable data rather than a measured zero", async () => {
    const { adapter } = adapterWith([]);

    await expect(adapter.collect({}, context)).resolves.toMatchObject({
      availability: "unavailable",
      rowCount: 0,
      stopReason: "no_data",
      limitation: expect.stringContaining("GSC_NO_DATA"),
      raw: { availability: "unavailable", rowCount: 0 },
    });
  });

  it("marks the provider row cap as partial and records a stop reason", async () => {
    const rows = new Array<GscRow>(GSC_MAX_ROWS).fill(row);
    const { adapter } = adapterWith(rows);
    const result = await adapter.collect({}, context);
    expect(result).toMatchObject({
      availability: "partial",
      rowCount: GSC_MAX_ROWS,
      stopReason: "row_cap_reached",
      raw: {
        propertyUrl: null,
        truncated: true,
        availability: "partial",
      },
    });
  });

  it("requires the worker to bind an OAuth client", async () => {
    const promise = gscAdapter.collect(
      { now: new Date("2026-07-18T12:00:00.000Z"), timeZone: "UTC" },
      context,
    );
    await expect(promise).rejects.toBeInstanceOf(SourceError);
    await expect(promise).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
