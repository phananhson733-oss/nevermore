import { describe, expect, it } from "vitest";
import { ApiError, ApiRequestTimeoutError } from "@/lib/api/client";
import type { DataSnapshot, SourceConnection, SourceState } from "@/lib/api/hooks-sources";
import { realConnectionsView, type RealConnectionsRead } from "./real-connections.ts";

/**
 * The data-sources page's read-only model of the real connections (T10 Step 1).
 *
 * Two rules carry the page's honesty, and both are pinned here with literal
 * expectations rather than a table imported from the implementation:
 *
 * - A failure is judged by the problem's `code`, never by its HTTP status (Q4).
 *   Only `CONTEXT_INCOMPLETE` has a remedy we can name; a 422 with another code
 *   is the neutral failure, and a `CONTEXT_INCOMPLETE` under another status is
 *   still the profile gate.
 * - Unknown is not "not connected": a slot that cannot be read, a state the
 *   client does not know, or a list that is not there all read as unknown.
 */

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";

function snapshot(overrides: Partial<DataSnapshot> = {}): DataSnapshot {
  return {
    id: "snap-1",
    siteId: "site-1",
    provider: "gsc",
    datasetKey: "gsc.search_analytics",
    schemaVersion: "1",
    methodVersion: "1",
    capturedAt: "2026-09-10T08:30:00.000Z",
    sourceWindow: { start: "2026-08-10", end: "2026-09-09" } as DataSnapshot["sourceWindow"],
    availability: "available",
    limitation: "Search Console reports sampled query data.",
    rowCount: 1234,
    checksum: "abc",
    ...overrides,
  };
}

function slot(
  provider: SourceConnection["provider"],
  state: SourceState,
  overrides: Partial<SourceConnection> = {},
): SourceConnection {
  return {
    id: `conn-${provider}`,
    projectId: PROJECT_ID,
    provider,
    connectionType: "oauth",
    state,
    externalRef: null,
    scopes: [],
    connectedAt: null,
    latestSnapshot: null,
    latestMetricSummary: null,
    activeRun: null,
    limitation: "",
    featureEnabled: true,
    updatedAt: "2026-09-13T00:00:00.000Z",
    ...overrides,
  };
}

function problem(status: number, code: string): ApiError {
  return new ApiError({
    type: "about:blank",
    title: "Request failed",
    status,
    code,
    detail: "Request failed.",
    requestId: "req-test",
  });
}

function read(overrides: Partial<RealConnectionsRead>): RealConnectionsRead {
  return { sources: undefined, isLoading: false, isError: false, error: null, ...overrides };
}

function ready(sources: unknown) {
  const view = realConnectionsView(read({ sources: sources as readonly SourceConnection[] }));
  if (view.kind !== "read") throw new Error(`expected a read view, got ${view.kind}`);
  return view;
}

describe("realConnectionsView: request states", () => {
  it("is loading while the first read is in flight", () => {
    expect(realConnectionsView(read({ isLoading: true }))).toEqual({ kind: "loading" });
  });

  it("names the product profile gate for CONTEXT_INCOMPLETE", () => {
    expect(realConnectionsView(read({ isError: true, error: problem(422, "CONTEXT_INCOMPLETE") }))).toEqual({
      kind: "needProfile",
    });
  });

  it("decides the gate by code: CONTEXT_INCOMPLETE under another status is still the gate", () => {
    expect(realConnectionsView(read({ isError: true, error: problem(409, "CONTEXT_INCOMPLETE") }))).toEqual({
      kind: "needProfile",
    });
  });

  it("does not decide the gate by status: a 422 with another code is the neutral failure", () => {
    expect(realConnectionsView(read({ isError: true, error: problem(422, "VALIDATION_FAILED") }))).toEqual({
      kind: "failed",
    });
  });

  it.each([
    ["a 500 problem", problem(500, "INTERNAL")],
    ["a 404 problem", problem(404, "NOT_FOUND")],
    ["a transport timeout", new ApiRequestTimeoutError(30_000)],
    ["a plain error", new Error("boom")],
    ["no error object", null],
  ])("reads %s as the neutral failure", (_label, error) => {
    expect(realConnectionsView(read({ isError: true, error }))).toEqual({ kind: "failed" });
  });

  it("puts a failed refetch ahead of the older list it still holds", () => {
    const stale = [slot("gsc", "available"), slot("ga4", "available")];
    expect(realConnectionsView(read({ sources: stale, isError: true, error: problem(500, "INTERNAL") }))).toEqual({
      kind: "failed",
    });
  });
});

describe("realConnectionsView: connection status per provider", () => {
  it.each([
    ["connected", "connected"],
    ["syncing", "connected"],
    ["available", "connected"],
    ["partial", "connected"],
    ["stale", "connected"],
    ["permission_denied", "connected"],
    ["unavailable", "connected"],
    ["disconnected", "notConnected"],
    ["connecting", "unknown"],
  ] as const)("GSC and GA4 both read %s as %s", (state, expected) => {
    const view = ready([slot("gsc", state), slot("ga4", state)]);
    expect(view.gsc.status).toBe(expected);
    expect(view.ga4.status).toBe(expected);
    expect(view.gsc.slot?.state).toBe(state);
    expect(view.ga4.slot?.state).toBe(state);
  });

  it("reads each provider from its own slot", () => {
    const view = ready([slot("crawl", "available"), slot("ga4", "disconnected"), slot("gsc", "permission_denied")]);
    expect(view.gsc.status).toBe("connected");
    expect(view.gsc.slot?.state).toBe("permission_denied");
    expect(view.ga4.status).toBe("notConnected");
    expect(view.ga4.slot?.state).toBe("disconnected");
  });

  it("reads a connection state without an id as unknown, not connected", () => {
    const view = ready([slot("gsc", "available", { id: null }), slot("ga4", "connected", { id: " " })]);
    expect(view.gsc.status).toBe("unknown");
    expect(view.ga4.status).toBe("unknown");
  });

  it("reads a missing provider slot as unknown with nothing known below it", () => {
    const view = ready([slot("gsc", "available")]);
    expect(view.ga4).toEqual({ status: "unknown", slot: null });
    expect(view.gsc.status).toBe("connected");
  });

  it("reads two slots for one provider as unknown rather than letting order pick", () => {
    const view = ready([slot("gsc", "available"), slot("gsc", "disconnected"), slot("ga4", "available")]);
    expect(view.gsc).toEqual({ status: "unknown", slot: null });
    expect(view.ga4.status).toBe("connected");
  });

  it("reads a state the client does not know as unknown, with no state label", () => {
    const view = ready([slot("gsc", "archived" as SourceState), slot("ga4", "available")]);
    expect(view.gsc.status).toBe("unknown");
    expect(view.gsc.slot?.state).toBeNull();
  });

  it.each([
    ["no list", undefined],
    ["a list that is not an array", { data: [] }],
    ["a list with a non-object entry", [slot("gsc", "available"), null]],
  ])("reads %s as unknown for both providers", (_label, sources) => {
    const view = ready(sources);
    expect(view.gsc).toEqual({ status: "unknown", slot: null });
    expect(view.ga4).toEqual({ status: "unknown", slot: null });
  });
});

describe("realConnectionsView: latest snapshot facts", () => {
  it("carries availability, capture time, row count and limitation", () => {
    const view = ready([slot("gsc", "available", { latestSnapshot: snapshot() }), slot("ga4", "available")]);
    expect(view.gsc.slot?.snapshot).toEqual({
      availability: "available",
      capturedAt: "2026-09-10T08:30:00.000Z",
      rowCount: 1234,
      limitation: "Search Console reports sampled query data.",
    });
  });

  it("distinguishes an explicit absence of a snapshot from an unreadable one", () => {
    const view = ready([
      slot("gsc", "connected", { latestSnapshot: null }),
      slot("ga4", "connected", { latestSnapshot: "corrupt" as unknown as DataSnapshot }),
    ]);
    expect(view.gsc.slot?.snapshot).toBeNull();
    expect(view.ga4.slot?.snapshot).toEqual({
      availability: null,
      capturedAt: null,
      rowCount: null,
      limitation: null,
    });
  });

  it("keeps a row count of 0 and drops every value it cannot read", () => {
    const zero = ready([slot("gsc", "available", { latestSnapshot: snapshot({ rowCount: 0 }) })]);
    expect(zero.gsc.slot?.snapshot?.rowCount).toBe(0);

    const garbled = ready([
      slot("gsc", "available", {
        latestSnapshot: snapshot({
          availability: "mostly" as DataSnapshot["availability"],
          capturedAt: "yesterday-ish",
          rowCount: -1,
          limitation: "   ",
        }),
      }),
    ]);
    expect(garbled.gsc.slot?.snapshot).toEqual({
      availability: null,
      capturedAt: null,
      rowCount: null,
      limitation: null,
    });
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, "12"])("does not read %s as a row count", (rowCount) => {
    const view = ready([
      slot("gsc", "available", { latestSnapshot: snapshot({ rowCount: rowCount as number }) }),
    ]);
    expect(view.gsc.slot?.snapshot?.rowCount).toBeNull();
  });

  it("keeps the snapshot of a disconnected slot: retained history is still what was last collected", () => {
    const view = ready([slot("gsc", "disconnected", { latestSnapshot: snapshot({ rowCount: 7 }) })]);
    expect(view.gsc.status).toBe("notConnected");
    expect(view.gsc.slot?.snapshot?.rowCount).toBe(7);
  });
});

describe("realConnectionsView: a capture time is a real date and a real clock time (codex S10b)", () => {
  it.each([
    "2026-02-29T08:30:00Z",
    "2026-02-30T08:30:00Z",
    "2026-04-31T08:30:00Z",
    "2026-13-01T08:30:00Z",
    "2026-00-10T08:30:00Z",
    "2026-09-00T08:30:00Z",
    "2026-09-10T24:00:00Z",
    "2026-09-10T08:60:00Z",
    "2026-09-10T08:30:60Z",
    "2026-09-10T08:30:00+24:00",
    "2026-09-10T08:30:00+05:60",
  ])("does not read %s as a capture time", (capturedAt) => {
    const view = ready([slot("gsc", "available", { latestSnapshot: snapshot({ capturedAt }) })]);
    expect(view.gsc.slot?.snapshot?.capturedAt).toBeNull();
  });

  it.each(["2028-02-29T08:30:00Z", "2026-04-30T23:59:59.999+14:00", "2026-12-31T00:00-05:30", "2000-02-29T00:00Z"])(
    "reads %s as written",
    (capturedAt) => {
      const view = ready([slot("gsc", "available", { latestSnapshot: snapshot({ capturedAt }) })]);
      expect(view.gsc.slot?.snapshot?.capturedAt).toBe(capturedAt);
    },
  );
});
