import { describe, expect, it, vi } from "vitest";

import {
  handleTrafficDropRequest,
  type TrafficDropHandlerDependencies,
} from "./traffic-drop-handler.ts";
import type { TrafficDailyPoint } from "@sf/public-tools";

const PROPERTY = "sc-domain:example.com";

function request(body: unknown): Request {
  return new Request("https://gengrowth.ai/api/tools/traffic-drop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function series(days: number): readonly TrafficDailyPoint[] {
  return Array.from({ length: days }, (_unused, index) => ({
    date: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
    clicks: index >= 100 ? 4 : 40,
    impressions: index >= 100 ? 400 : 3_000,
  }));
}

function deps(
  overrides: Partial<TrafficDropHandlerDependencies> = {},
): TrafficDropHandlerDependencies {
  return {
    readSession: () =>
      Promise.resolve({
        properties: [PROPERTY],
        connectEnabled: true,
        inviteOnly: false,
      }),
    readDailySeries: () => Promise.resolve(series(120)),
    now: () => new Date("2026-07-31T00:00:00.000Z"),
    ...overrides,
  };
}

describe("handleTrafficDropRequest", () => {
  it("returns a report and the series it was built from", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps(),
    );
    const body = (await response.json()) as {
      data: { run: { tool: string }; result: unknown; series: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(body.data.run.tool).toBe("traffic_drop_diagnosis");
    expect(body.data.series).toHaveLength(120);
  });

  it("never caches or shares a report about someone's own property", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps(),
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("refuses without a Search Console grant", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps({
        readSession: () =>
          Promise.resolve({
            properties: null,
            connectEnabled: true,
            inviteOnly: false,
          }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_unavailable" },
    });
  });

  it("does not confirm whether an ungranted property exists", async () => {
    const readDailySeries = vi.fn();
    const response = await handleTrafficDropRequest(
      request({ property: "sc-domain:someone-else.com" }),
      deps({ readDailySeries }),
    );

    // 404, not 403: a 403 would tell the caller the property is real.
    expect(response.status).toBe(404);
    expect(readDailySeries).not.toHaveBeenCalled();
  });

  it("reports unavailability instead of substituting an estimate", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps({ readDailySeries: () => Promise.reject(new Error("429")) }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("gsc_unavailable");
    expect(body).not.toHaveProperty("data");
  });

  it("distinguishes an empty property from a failed read", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps({ readDailySeries: () => Promise.resolve([]) }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(body.error.code).toBe("no_gsc_data");
  });

  it("rejects a body that does not name a property", async () => {
    const response = await handleTrafficDropRequest(
      request({ site: PROPERTY }),
      deps(),
    );

    expect(response.status).toBe(400);
  });

  it("asks for enough history to cover a year-over-year read", async () => {
    const readDailySeries = vi.fn(() => Promise.resolve(series(120)));
    await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps({ readDailySeries }),
    );

    expect(readDailySeries).toHaveBeenCalledWith({
      property: PROPERTY,
      lookbackDays: 480,
    });
  });
});
