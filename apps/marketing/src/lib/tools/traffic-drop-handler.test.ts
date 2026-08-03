import { describe, expect, it, vi } from "vitest";

import {
  handleTrafficDropRequest,
  type TrafficDropHandlerDependencies,
} from "./traffic-drop-handler.ts";
import { acquireGscSlot } from "./gsc-inflight.ts";
import { createPublicToolError } from "@sf/public-tools";
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

/**
 * The in-flight half of the real gate, without the durable quota store.
 *
 * The shipped gate also consumes a per-IP counter in Supabase; exercising that
 * here would make every case in this file depend on a network service. The
 * refusal branches it owns are driven explicitly instead, by injecting a gate
 * that refuses.
 */
function inflightOnlyGate(clientIp: string) {
  const slot = acquireGscSlot(clientIp);
  return Promise.resolve(
    slot.acquired
      ? ({ ok: true, release: slot.release } as const)
      : ({
          ok: false,
          response: Response.json(createPublicToolError("scan_in_progress"), {
            status: 409,
            headers: { "Retry-After": "5" },
          }),
        } as const),
  );
}

function deps(
  overrides: Partial<TrafficDropHandlerDependencies> = {},
): TrafficDropHandlerDependencies {
  return {
    readSession: () =>
      Promise.resolve({
        properties: [PROPERTY],
        propertyTotal: 1,
        connectEnabled: true,
        consentNotice: "none" as const,
      }),
    readDailySeries: () => Promise.resolve(series(120)),
    now: () => new Date("2026-07-31T00:00:00.000Z"),
    // Each test gets its own client key so the per-client concurrency gate
    // does not carry a held slot from one test into the next.
    extractClientIp: () => `test-${(clientCounter += 1)}`,
    openGate: inflightOnlyGate,
    ...overrides,
  };
}

let clientCounter = 0;

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
            propertyTotal: 0,
            connectEnabled: true,
            consentNotice: "none" as const,
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

  it("refuses before spending any Search Console quota when the gate says no", async () => {
    // The gate now bounds volume across cold starts, not just concurrency
    // inside one isolate. A refusal has to happen BEFORE the read: the point
    // of the limit is the upstream call it prevents.
    const readDailySeries = vi.fn();
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps({
        readDailySeries,
        openGate: () =>
          Promise.resolve({
            ok: false,
            response: Response.json(createPublicToolError("rate_limited"), {
              status: 429,
            }),
          }),
      }),
    );

    expect(response.status).toBe(429);
    expect(readDailySeries).not.toHaveBeenCalled();
  });

  it("releases the gate even when the read throws", async () => {
    const release = vi.fn();
    await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps({
        readDailySeries: () => Promise.reject(new Error("429")),
        openGate: () => Promise.resolve({ ok: true, release }),
      }),
    );

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("still returns the report when the optional query read fails", async () => {
    // The degradation rule. The query dimension is an attachment to a report
    // that is already complete without it, so its failure costs two checks and
    // nothing else. Turning it into a 502 would deny someone their decline
    // analysis over an extra read they never asked for.
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps({ readQueryEvidence: () => Promise.reject(new Error("429")) }),
    );
    const body = (await response.json()) as {
      data: {
        result: {
          checks: readonly {
            id: string;
            status: string;
            unavailableReason: string | null;
          }[];
        };
      };
    };

    expect(response.status).toBe(200);
    const split = body.data.result.checks.find(
      (check) => check.id === "brand_non_brand_split",
    );
    expect(split).toEqual({
      id: "brand_non_brand_split",
      status: "not_available",
      unavailableReason: "query_read_not_performed",
    });
  });

  it("does not ask for query evidence when there is no event to anchor it on", async () => {
    // Flat series: no peak, so no before window. Spending two upstream calls
    // to compare a window that does not exist is quota taken from someone who
    // does have a decline.
    const readQueryEvidence = vi.fn(() => Promise.resolve(null));
    const flat = Array.from({ length: 120 }, (_unused, index) => ({
      date: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
      clicks: 30,
      impressions: 1_200,
    }));

    await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps({ readDailySeries: () => Promise.resolve(flat), readQueryEvidence }),
    );

    // The reader is still consulted — it owns the window arithmetic — but it
    // resolves null without calling upstream. What matters here is that the
    // handler does not treat a null as a failure.
    expect(readQueryEvidence).toHaveBeenCalledTimes(1);
  });

  it("rejects a manual-action answer it does not recognise", async () => {
    // Coercing an unknown value to `not_checked` would be tolerable; coercing
    // it to "no manual action" would hand out the one reassurance this tool
    // has no standing to give. Rejecting keeps that decision out of reach.
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, manualAction: "no" }),
      deps(),
    );

    expect(response.status).toBe(400);
  });

  it("treats an unanswered card as unanswered", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps(),
    );
    const body = (await response.json()) as {
      data: { result: { siteSignals: { manualAction: { path: string } } } };
    };

    expect(body.data.result.siteSignals.manualAction.path).toBe("unconfirmed");
  });

  it("does not accept a brand list the visitor never confirmed", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, brandTerms: ["acme"] }),
      deps(),
    );
    const body = (await response.json()) as {
      data: { result: { siteSignals: { brandSplit: { reason?: string } } } };
    };

    // No confirmation flag, so the terms are candidates. Without the query
    // read the reason is the earlier one, which is the point: the gates report
    // the failure closest to the root.
    expect(body.data.result.siteSignals.brandSplit.reason).toBe(
      "read_not_performed",
    );
  });

  it("serialises concurrent reads from one client", async () => {
    // This endpoint was the only public tool without a concurrency gate, and
    // it is the most expensive of the three: one request can hold a Search
    // Console connection for forty seconds across retries. Search Console
    // quota is counted per GCP PROJECT, so an unbounded caller does not just
    // slow themselves down, they spend the quota every other visitor needs.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    const shared = deps({
      extractClientIp: () => "198.51.100.7",
      readDailySeries: async () => {
        await held;
        return series(120);
      },
    });

    const first = handleTrafficDropRequest(
      request({ property: PROPERTY }),
      shared,
    );
    // The second arrives while the first still holds the slot.
    const second = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      shared,
    );

    expect(second.status).toBe(409);
    expect(second.headers.get("Retry-After")).toBe("5");
    await expect(second.json()).resolves.toEqual({
      error: { code: "scan_in_progress" },
    });

    release();
    expect((await first).status).toBe(200);

    // And the slot is released, so the same client can run again afterwards.
    const third = await handleTrafficDropRequest(
      request({ property: PROPERTY }),
      deps({ extractClientIp: () => "198.51.100.7" }),
    );
    expect(third.status).toBe(200);
  });
});
