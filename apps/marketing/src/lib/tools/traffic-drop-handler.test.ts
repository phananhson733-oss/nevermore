import { describe, expect, it, vi } from "vitest";

import {
  handleTrafficDropRequest,
  type TrafficDropHandlerDependencies,
} from "./traffic-drop-handler.ts";
import { acquireGscSlot } from "./gsc-inflight.ts";
import { createPublicToolError } from "@sf/public-tools";
import type { TrafficDailyPoint } from "@sf/public-tools";

const PROPERTY = "sc-domain:example.com";

/**
 * Both self-checks answered, which every well-formed request now carries.
 *
 * Spread into request bodies rather than defaulted in the handler: a default
 * would let a client omit them and still get a report, and that is exactly how
 * `brandTerms` shipped unreachable — the server accepted its absence, so
 * nothing failed when the client never sent it.
 */
const ANSWERED = {
  selfChecks: {
    property: PROPERTY,
    manualAction: "reports_none",
    securityIssue: "reports_none",
  },
} as const;

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

const ACCESS_TOKEN = "test-access-token";

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
    resolveGrant: () =>
      Promise.resolve({
        kind: "grant" as const,
        accessToken: ACCESS_TOKEN,
        properties: [PROPERTY],
        propertyTotal: 1,
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
      request({ property: PROPERTY, ...ANSWERED }),
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
      request({ property: PROPERTY, ...ANSWERED }),
      deps(),
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("refuses without a Search Console grant", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
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
      request({
        property: "sc-domain:someone-else.com",
        selfChecks: {
          property: "sc-domain:someone-else.com",
          manualAction: "reports_none",
          securityIssue: "reports_none",
        },
      }),
      deps({ readDailySeries }),
    );

    // 404, not 403: a 403 would tell the caller the property is real.
    expect(response.status).toBe(404);
    expect(readDailySeries).not.toHaveBeenCalled();
  });

  it("reports unavailability instead of substituting an estimate", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
      deps({ readDailySeries: () => Promise.reject(new Error("429")) }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("gsc_unavailable");
    expect(body).not.toHaveProperty("data");
  });

  it("distinguishes an empty property from a failed read", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
      deps({ readDailySeries: () => Promise.resolve([]) }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(body.error.code).toBe("no_gsc_data");
  });

  /**
   * The one place in this set where a successful-looking response is not a
   * successful run: an empty series answers 200 carrying an error envelope.
   * Anchoring the report on the status code instead of the return site would
   * pay a referral for a diagnosis that was never produced.
   */
  it("does not report a run for the no_gsc_data envelope", async () => {
    const reportFirstRun = vi.fn();
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
      deps({ readDailySeries: () => Promise.resolve([]), reportFirstRun }),
    );

    expect(response.status).toBe(200);
    expect(reportFirstRun).not.toHaveBeenCalled();
  });

  it("reports a run once the diagnosis is produced", async () => {
    const reportFirstRun = vi.fn();
    await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
      deps({ reportFirstRun }),
    );

    expect(reportFirstRun).toHaveBeenCalledExactlyOnceWith("traffic-drop");
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
      request({ property: PROPERTY, ...ANSWERED }),
      deps({ readDailySeries }),
    );

    expect(readDailySeries).toHaveBeenCalledWith({
      property: PROPERTY,
      lookbackDays: 480,
      accessToken: ACCESS_TOKEN,
    });
  });

  it("refuses before spending any Search Console quota when the gate says no", async () => {
    // The gate now bounds volume across cold starts, not just concurrency
    // inside one isolate. A refusal has to happen BEFORE the read: the point
    // of the limit is the upstream call it prevents.
    const readDailySeries = vi.fn();
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
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

  it("makes no Google call at all when the gate refuses", async () => {
    // Resolving the grant can spend a token-endpoint call and a site-list call
    // on the shared OAuth client, both against a per-PROJECT quota. Before the
    // gate, one legitimate grant is enough to drive both without any limiter.
    const resolveGrant = vi.fn(() =>
      Promise.resolve({ kind: "none" } as const),
    );
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
      deps({
        resolveGrant,
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
    expect(resolveGrant).not.toHaveBeenCalled();
  });

  it("resolves the grant only after the gate has opened", async () => {
    const order: string[] = [];
    await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
      deps({
        openGate: () => {
          order.push("gate");
          return Promise.resolve({
            ok: true,
            release: () => order.push("release"),
          });
        },
        resolveGrant: () => {
          order.push("resolve");
          return Promise.resolve({
            kind: "grant" as const,
            accessToken: ACCESS_TOKEN,
            properties: [PROPERTY],
            propertyTotal: 1,
          });
        },
      }),
    );

    expect(order).toEqual(["gate", "resolve", "release"]);
  });

  it("tells a revoked visitor to reconnect rather than that Google is down", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
      deps({ resolveGrant: () => Promise.resolve({ kind: "revoked" }) }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_revoked" },
    });
  });

  it("answers a momentary Google failure as temporary, with a retry hint", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
      deps({ resolveGrant: () => Promise.resolve({ kind: "unavailable" }) }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_temporarily_unavailable" },
    });
  });

  it("refuses a property the RESOLVED grant no longer covers", async () => {
    const readDailySeries = vi.fn();
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
      deps({
        readDailySeries,
        resolveGrant: () =>
          Promise.resolve({
            kind: "grant" as const,
            accessToken: ACCESS_TOKEN,
            properties: ["sc-domain:something-else.com"],
            propertyTotal: 1,
          }),
      }),
    );

    expect(response.status).toBe(404);
    expect(readDailySeries).not.toHaveBeenCalled();
  });

  it("releases the gate even when the read throws", async () => {
    const release = vi.fn();
    await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
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
      request({ property: PROPERTY, ...ANSWERED }),
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
      request({ property: PROPERTY, ...ANSWERED }),
      deps({ readDailySeries: () => Promise.resolve(flat), readQueryEvidence }),
    );

    // The reader is still consulted — it owns the window arithmetic — but it
    // resolves null without calling upstream. What matters here is that the
    // handler does not treat a null as a failure.
    expect(readQueryEvidence).toHaveBeenCalledTimes(1);
  });

  it("refuses to run at all without both self-check answers", async () => {
    // The gate, enforced server-side. The button is disabled without them, but
    // a disabled button is a UI convention — this is the invariant. Every one
    // of these used to produce a report.
    const readDailySeries = vi.fn();
    for (const body of [
      { property: PROPERTY },
      { property: PROPERTY, selfChecks: {} },
      {
        property: PROPERTY,
        selfChecks: { property: PROPERTY, manualAction: "reports_none" },
      },
      {
        property: PROPERTY,
        selfChecks: { property: PROPERTY, securityIssue: "reports_none" },
      },
      { property: PROPERTY, selfChecks: null },
    ]) {
      const response = await handleTrafficDropRequest(
        request(body),
        deps({ readDailySeries }),
      );
      expect(response.status).toBe(400);
    }

    // Rejected before the upstream read, so a malformed client cannot spend
    // the Search Console quota everyone else shares.
    expect(readDailySeries).not.toHaveBeenCalled();
  });

  it("refuses answers that name a different property than the one being read", async () => {
    // The bug this backstops shipped in this branch: the client reset the
    // brand list on a property change and did not reset these, so site A's
    // "no issues" could be attached to a report about site B. The browser now
    // binds them structurally; this turns the next such regression into a 400
    // rather than a false all-clear.
    //
    // It does NOT verify a human looked at that property — nothing can, which
    // is why these answers come from the visitor at all. It verifies the
    // client's two claims agree with each other.
    const readDailySeries = vi.fn();
    const response = await handleTrafficDropRequest(
      request({
        property: PROPERTY,
        selfChecks: {
          property: "sc-domain:someone-else.com",
          manualAction: "reports_none",
          securityIssue: "reports_none",
        },
      }),
      deps({ readDailySeries }),
    );

    expect(response.status).toBe(400);
    expect(readDailySeries).not.toHaveBeenCalled();
  });

  it("refuses answers that name no property at all", async () => {
    for (const selfChecks of [
      { manualAction: "reports_none", securityIssue: "reports_none" },
      {
        property: null,
        manualAction: "reports_none",
        securityIssue: "reports_none",
      },
    ]) {
      const response = await handleTrafficDropRequest(
        request({ property: PROPERTY, selfChecks }),
        deps(),
      );
      expect(response.status).toBe(400);
    }
  });

  it("rejects an answer it does not recognise rather than coercing it", async () => {
    // Coercing an unknown value to `uncertain` would be tolerable; coercing it
    // to "no issue" would hand out the one reassurance this tool has no
    // standing to give. Rejecting keeps that decision out of reach. The second
    // case is the previous design's vocabulary, which a stale client would
    // still be sending.
    for (const answers of [
      { manualAction: "no", securityIssue: "reports_none" },
      { manualAction: "user_reports_none", securityIssue: "reports_none" },
      { manualAction: "reports_none", securityIssue: "not_checked" },
    ]) {
      const selfChecks = { property: PROPERTY, ...answers };
      const response = await handleTrafficDropRequest(
        request({ property: PROPERTY, selfChecks }),
        deps(),
      );
      expect(response.status).toBe(400);
    }
  });

  it("carries both answers through to the report it builds", async () => {
    // The seam the brand-term field fell through: every layer tested green
    // while nothing checked that what the client sends arrives where it is
    // used. An answer that does not reach the engine is not an answer.
    const response = await handleTrafficDropRequest(
      request({
        property: PROPERTY,
        selfChecks: {
          property: PROPERTY,
          manualAction: "uncertain",
          securityIssue: "reports_issue",
        },
      }),
      deps(),
    );
    const body = (await response.json()) as {
      data: {
        result: {
          siteSignals: {
            selfChecks: {
              path: string;
              manualAction: { answer: string; lineage: string };
              securityIssue: { answer: string };
            };
          };
          actions: readonly { readonly id: string }[];
        };
      };
    };

    const { selfChecks } = body.data.result.siteSignals;
    expect(selfChecks.manualAction.answer).toBe("uncertain");
    expect(selfChecks.securityIssue.answer).toBe("reports_issue");
    expect(selfChecks.path).toBe("issue_reported");
    // Never presented as something we looked up.
    expect(selfChecks.manualAction.lineage).toBe("visitor_reported");
    expect(body.data.result.actions.map((action) => action.id)).toEqual([
      "resolve_security_issue",
    ]);
  });

  it("does not accept a brand list the visitor never confirmed", async () => {
    const response = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED, brandTerms: ["acme"] }),
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
      request({ property: PROPERTY, ...ANSWERED }),
      shared,
    );
    // The second arrives while the first still holds the slot.
    const second = await handleTrafficDropRequest(
      request({ property: PROPERTY, ...ANSWERED }),
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
      request({ property: PROPERTY, ...ANSWERED }),
      deps({ extractClientIp: () => "198.51.100.7" }),
    );
    expect(third.status).toBe(200);
  });
});
