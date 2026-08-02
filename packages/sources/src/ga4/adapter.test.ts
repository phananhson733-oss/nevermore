import { describe, expect, it, vi } from "vitest";
import { SourceError, type CollectionContext } from "../adapter.ts";
import { createGa4Adapter, type Ga4Params } from "./adapter.ts";
import type {
  Ga4Client,
  Ga4ReportStopReason,
  Ga4ReportResponse,
  Ga4ReportRow,
} from "./client.ts";
import {
  GA4_PAGINATION_CAP_LIMITATION,
  GA4_PAGINATION_CAP_STOP_REASON,
  GA4_ROW_CAP_LIMITATION,
  GA4_ROW_CAP_STOP_REASON,
  HttpGa4Client,
} from "./client.ts";
import { GA4_KEY_EVENT_REPORT_TRUNCATED } from "./normalize.ts";

const context: CollectionContext = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  siteId: "site-1",
  runId: "run-1",
  signal: AbortSignal.timeout(10_000),
};

const params: Ga4Params = {
  propertyId: "properties/123",
  keyEventNames: [],
  siteOrigin: "https://example.com",
  propertyTimeZone: "UTC",
  now: new Date("2026-07-18T12:00:00.000Z"),
};

const sessionRow: Ga4ReportRow = {
  dimensionValues: [{ value: "20260717" }, { value: "/pricing" }],
  metricValues: [{ value: "10" }, { value: "7" }, { value: "0.7" }],
};
const keyEventRow: Ga4ReportRow = {
  dimensionValues: [{ value: "20260717" }, { value: "/pricing" }],
  metricValues: [{ value: "2" }],
};

function response(...rows: Ga4ReportRow[]): Ga4ReportResponse {
  return {
    rows,
    rowCount: rows.length,
    truncated: false,
    stopReason: null,
    limitation: "",
  };
}

function truncatedResponse(input: {
  readonly rows: readonly Ga4ReportRow[];
  readonly rowCount: number;
  readonly stopReason: Ga4ReportStopReason;
  readonly limitation: string;
}): Ga4ReportResponse {
  return { ...input, truncated: true };
}

async function collectAsync<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

function client(): {
  readonly value: Ga4Client;
  readonly runReport: ReturnType<typeof vi.fn>;
  readonly checkCompatibility: ReturnType<typeof vi.fn>;
} {
  const runReport = vi.fn();
  const checkCompatibility = vi.fn();
  return {
    value: { runReport, checkCompatibility },
    runReport,
    checkCompatibility,
  };
}

async function expectSourceError(
  promise: Promise<unknown>,
  message: RegExp,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(SourceError);
  await expect(promise).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
    message: expect.stringMatching(message),
  });
}

describe("GA4 source adapter", () => {
  it("accepts the proto3 empty-report shape when GA4 has zero key events", async () => {
    const ga4 = new HttpGa4Client({
      propertyId: "properties/123",
      accessToken: "test-token",
      fetch: async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(
      ga4.runReport({
        dateRanges: [{ startDate: "2026-07-01", endDate: "2026-07-17" }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "keyEvents" }],
      }),
    ).resolves.toMatchObject({
      rows: [],
      rowCount: 0,
      truncated: false,
    });
  });

  it("ignores unrelated addable fields in the compatibility response", async () => {
    const ga4 = new HttpGa4Client({
      propertyId: "properties/123",
      accessToken: "test-token",
      fetch: async () =>
        new Response(
          JSON.stringify({
            dimensionCompatibilities: [
              {
                dimensionMetadata: { apiName: "date" },
                compatibility: "COMPATIBLE",
              },
              {
                dimensionMetadata: { apiName: "itemBrand" },
                compatibility: "INCOMPATIBLE",
              },
            ],
            metricCompatibilities: [
              {
                metricMetadata: { apiName: "keyEvents" },
                compatibility: "COMPATIBLE",
              },
              {
                metricMetadata: { apiName: "advertiserAdCost" },
                compatibility: "INCOMPATIBLE",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(
      ga4.checkCompatibility({
        dimensions: [{ name: "date" }, { name: "landingPage" }],
        metrics: [{ name: "keyEvents" }],
      }),
    ).resolves.toEqual({ compatible: true, incompatibleFields: [] });
  });

  it("validates property identifiers and deduplicates mapped key events", async () => {
    const fake = client();
    const adapter = createGa4Adapter(fake.value);
    await expect(adapter.validateConfig(null)).rejects.toMatchObject({
      code: "INVALID_CONFIGURATION",
    });
    await expect(adapter.validateConfig({ propertyId: 123 })).rejects.toMatchObject(
      { code: "INVALID_CONFIGURATION" },
    );
    await expect(
      adapter.validateConfig({ propertyId: "not-a-property" }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      adapter.validateConfig({ propertyId: " 123 ", keyEventNames: null }),
    ).resolves.toEqual({ propertyId: "properties/123", keyEventNames: [] });
    await expect(
      adapter.validateConfig({ propertyId: "properties/456" }),
    ).resolves.toEqual({ propertyId: "properties/456", keyEventNames: [] });
    await expect(
      adapter.validateConfig({
        propertyId: "456",
        keyEventNames: [" sign_up ", "", "sign_up", "purchase"],
      }),
    ).resolves.toEqual({
      propertyId: "properties/456",
      keyEventNames: ["sign_up", "purchase"],
    });
    await expect(
      adapter.validateConfig({ propertyId: "456", keyEventNames: "sign_up" }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      adapter.validateConfig({ propertyId: "456", keyEventNames: [42] }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
  });

  it("advertises conversion limitations honestly", async () => {
    const adapter = createGa4Adapter(client().value);
    await expect(
      adapter.capabilities({ propertyId: "properties/123", keyEventNames: [] }),
    ).resolves.toEqual([
      expect.objectContaining({
        available: true,
        limitation: "",
      }),
    ]);
    await expect(
      adapter.capabilities({
        propertyId: "properties/123",
        keyEventNames: ["sign_up"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        available: true,
        limitation:
          "Collection is limited to an explicitly selected key-event subset.",
      }),
    ]);
  });

  it("collects every property key event by default and scopes both reports to the site hostname", async () => {
    const fake = client();
    fake.runReport
      .mockResolvedValueOnce(response(sessionRow))
      .mockResolvedValueOnce(response(keyEventRow));
    fake.checkCompatibility.mockResolvedValueOnce({
      compatible: true,
      incompatibleFields: [],
    });
    const adapter = createGa4Adapter(fake.value);

    const result = await adapter.collect(params, context);
    expect(result).toMatchObject({
      availability: "available",
      capturedAt: "2026-07-18T12:00:00.000Z",
      rowCount: 2,
      stopReason: null,
      providerUsage: { sessionRows: 1, keyEventRows: 1 },
      limitation:
        "GA4 organic landing metrics include only Organic Search traffic on example.com and all key events defined by the GA4 property.",
      raw: {
        propertyId: "properties/123",
        keyEventStatus: { state: "available" },
        sessionRows: [
          expect.objectContaining({
            date: "2026-07-17",
            sessions: 10,
            engagementRate: 0.7,
          }),
        ],
      },
    });
    expect(fake.checkCompatibility).toHaveBeenCalledTimes(1);
    expect(fake.runReport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dimensions: [{ name: "date" }, { name: "landingPage" }],
        metrics: [
          { name: "sessions" },
          { name: "engagedSessions" },
          { name: "engagementRate" },
        ],
        dimensionFilter: {
          andGroup: {
            expressions: expect.arrayContaining([
              {
                filter: {
                  fieldName: "hostName",
                  stringFilter: { matchType: "EXACT", value: "example.com" },
                },
              },
            ]),
          },
        },
      }),
      context.signal,
      { maxRows: 200_000 },
    );
    const compatibilityRequest = fake.checkCompatibility.mock.calls[0]?.[0];
    expect(JSON.stringify(compatibilityRequest?.dimensionFilter)).not.toContain(
      "eventName",
    );

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
      availability: "available",
      valueJson: {
        keyEvents: 2,
        keyEventUnavailableReason: null,
      },
    });
  });

  it("marks an empty organic landing report as unavailable data, not zero sessions", async () => {
    const fake = client();
    fake.runReport
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response());
    fake.checkCompatibility.mockResolvedValueOnce({
      compatible: true,
      incompatibleFields: [],
    });

    await expect(createGa4Adapter(fake.value).collect(params, context)).resolves.toMatchObject({
      availability: "unavailable",
      rowCount: 0,
      stopReason: "no_data",
      limitation: expect.stringContaining("GA4_NO_DATA"),
      raw: { availability: "unavailable", sessionRows: [] },
    });
  });

  it("skips an incompatible key-event report without fabricating zeroes", async () => {
    const fake = client();
    fake.runReport.mockResolvedValueOnce(response(sessionRow));
    fake.checkCompatibility.mockResolvedValueOnce({
      compatible: false,
      incompatibleFields: ["keyEvents"],
    });
    const result = await createGa4Adapter(fake.value).collect(
      { ...params, keyEventNames: ["sign_up"] },
      context,
    );
    expect(result).toMatchObject({
      availability: "partial",
      rowCount: 1,
      limitation: "GA4_KEY_EVENT_REPORT_INCOMPATIBLE",
      raw: { keyEventStatus: { state: "incompatible" }, keyEventRows: [] },
    });
    expect(fake.runReport).toHaveBeenCalledTimes(1);
  });

  it("collects compatible key events with the exact event-name filter", async () => {
    const fake = client();
    fake.runReport
      .mockResolvedValueOnce(response(sessionRow))
      .mockResolvedValueOnce(response(keyEventRow));
    fake.checkCompatibility.mockResolvedValueOnce({
      compatible: true,
      incompatibleFields: [],
    });
    const result = await createGa4Adapter(fake.value).collect(
      { ...params, keyEventNames: ["sign_up", "purchase"] },
      context,
    );
    expect(result).toMatchObject({
      availability: "available",
      rowCount: 2,
      limitation:
        "GA4 organic landing metrics include only Organic Search traffic on example.com and the selected key events: sign_up, purchase.",
      providerUsage: { sessionRows: 1, keyEventRows: 1 },
      raw: {
        keyEventStatus: { state: "available" },
        keyEventRows: [
          {
            date: "2026-07-17",
            landingPage: "/pricing",
            eventName: "sign_up,purchase",
            keyEvents: 2,
          },
        ],
      },
    });
    expect(fake.checkCompatibility).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensionFilter: {
          andGroup: {
            expressions: expect.arrayContaining([
              {
                filter: {
                  fieldName: "eventName",
                  inListFilter: { values: ["sign_up", "purchase"] },
                },
              },
            ]),
          },
        },
      }),
      context.signal,
    );
    expect(fake.runReport).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      context.signal,
      { maxRows: 199_999 },
    );
  });

  it("shares the row budget across both reports and projects key-event truncation honestly", async () => {
    const fake = client();
    fake.runReport
      .mockResolvedValueOnce(response(sessionRow))
      .mockResolvedValueOnce(
        truncatedResponse({
          rows: [keyEventRow],
          rowCount: 2,
          stopReason: GA4_ROW_CAP_STOP_REASON,
          limitation: GA4_ROW_CAP_LIMITATION,
        }),
      );
    fake.checkCompatibility.mockResolvedValueOnce({
      compatible: true,
      incompatibleFields: [],
    });

    const adapter = createGa4Adapter(fake.value, { maxRows: 2 });
    const result = await adapter.collect(
      { ...params, keyEventNames: ["sign_up"] },
      context,
    );

    expect(result).toMatchObject({
      availability: "partial",
      rowCount: 2,
      stopReason: GA4_ROW_CAP_STOP_REASON,
      limitation: expect.stringContaining(GA4_KEY_EVENT_REPORT_TRUNCATED),
      providerUsage: { sessionRows: 1, keyEventRows: 1 },
      raw: {
        availability: "partial",
        stopReason: GA4_ROW_CAP_STOP_REASON,
        keyEventStatus: { state: "truncated" },
        sessionReport: { collectedRowCount: 1, truncated: false },
        keyEventReport: { collectedRowCount: 1, reportedRowCount: 2, truncated: true },
      },
    });
    expect(result.limitation).toContain("200,000");
    expect(fake.runReport).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      context.signal,
      { maxRows: 2 },
    );
    expect(fake.runReport).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      context.signal,
      { maxRows: 1 },
    );

    const observations = await collectAsync(
      adapter.normalize(result.raw, {
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        siteId: context.siteId,
        capturedAt: result.capturedAt,
      }),
    );
    expect(observations[0]).toMatchObject({
      limitation: expect.stringContaining(GA4_KEY_EVENT_REPORT_TRUNCATED),
      valueJson: {
        keyEvents: null,
        keyEventUnavailableReason: GA4_KEY_EVENT_REPORT_TRUNCATED,
      },
    });
  });

  it("projects pagination exhaustion as partial with a stable stop reason", async () => {
    const fake = client();
    fake.runReport
      .mockResolvedValueOnce(
        truncatedResponse({
          rows: [sessionRow],
          rowCount: 2,
          stopReason: GA4_PAGINATION_CAP_STOP_REASON,
          limitation: GA4_PAGINATION_CAP_LIMITATION,
        }),
      )
      .mockResolvedValueOnce(response());
    fake.checkCompatibility.mockResolvedValueOnce({
      compatible: true,
      incompatibleFields: [],
    });

    const result = await createGa4Adapter(fake.value).collect(params, context);

    expect(result).toMatchObject({
      availability: "partial",
      rowCount: 1,
      stopReason: GA4_PAGINATION_CAP_STOP_REASON,
      limitation: expect.stringMatching(/pagination/i),
      raw: {
        availability: "partial",
        stopReason: GA4_PAGINATION_CAP_STOP_REASON,
        sessionReport: { reportedRowCount: 2, truncated: true },
      },
    });
  });

  it("does not start a mapped key-event report after sessions consume the exact run cap", async () => {
    const fake = client();
    fake.runReport.mockResolvedValueOnce(response(sessionRow));

    const result = await createGa4Adapter(fake.value, { maxRows: 1 }).collect(
      { ...params, keyEventNames: ["sign_up"] },
      context,
    );

    expect(result).toMatchObject({
      availability: "partial",
      rowCount: 1,
      stopReason: GA4_ROW_CAP_STOP_REASON,
      limitation: expect.stringContaining(GA4_KEY_EVENT_REPORT_TRUNCATED),
      raw: { keyEventStatus: { state: "truncated" }, keyEventReport: null },
    });
    expect(fake.checkCompatibility).not.toHaveBeenCalled();
    expect(fake.runReport).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      row: { dimensionValues: [], metricValues: sessionRow.metricValues },
      message: /missing dimension 0/,
    },
    {
      row: {
        dimensionValues: [{ value: "20260717" }],
        metricValues: sessionRow.metricValues,
      },
      message: /missing dimension 1/,
    },
    {
      row: { dimensionValues: sessionRow.dimensionValues, metricValues: [] },
      message: /missing metric 0/,
    },
    {
      row: {
        dimensionValues: sessionRow.dimensionValues,
        metricValues: [{ value: "NaN" }, { value: "7" }, { value: "0.7" }],
      },
      message: /non-integer metric/,
    },
    {
      row: {
        dimensionValues: sessionRow.dimensionValues,
        metricValues: [{ value: "10" }, { value: "seven" }, { value: "0.7" }],
      },
      message: /non-integer metric/,
    },
    {
      row: {
        dimensionValues: sessionRow.dimensionValues,
        metricValues: [{ value: "10" }, { value: "7" }, { value: "NaN" }],
      },
      message: /non-numeric metric/,
    },
    {
      row: {
        dimensionValues: [{ value: "2026-07-17" }, { value: "/pricing" }],
        metricValues: sessionRow.metricValues,
      },
      message: /malformed date/,
    },
  ])("rejects malformed provider rows: $message", async ({ row, message }) => {
    const fake = client();
    fake.runReport.mockResolvedValueOnce(response(row));
    await expectSourceError(
      createGa4Adapter(fake.value).collect(params, context),
      message,
    );
  });
});
