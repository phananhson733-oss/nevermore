import type { DataSnapshotRow, SourceConnectionRow } from "@sf/db";
import { describe, expect, it } from "vitest";
import {
  isStale,
  toDataSnapshotDto,
  toSourceConnectionDto,
} from "@/lib/services/source-mappers";

/**
 * AC-018 — freshness / staleness DTO (spec §5.2, §1.3). These are PURE mapper
 * functions, so this is a unit test (no database).
 *
 * Spec §5.2 freshness windows: Crawl 7d, GSC 3d, GA4 3d, CSV 30d — past the
 * window the effective source state downgrades to `stale`; `connected` never
 * implies `available`. Spec §1.3: unavailable data is `null`, NEVER `0` / "".
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-18T12:00:00.000Z");

/** Fixed windows asserted verbatim against the spec so a code drift is caught. */
const WINDOWS: ReadonlyArray<readonly [string, number]> = [
  ["crawl", 7],
  ["gsc", 3],
  ["ga4", 3],
  ["csv", 30],
] as const;

function capturedAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function snapshot(overrides: Partial<DataSnapshotRow> = {}): DataSnapshotRow {
  return {
    id: "snap-1",
    workspace_id: "ws-1",
    project_id: "proj-1",
    site_id: "site-1",
    collection_run_id: "run-1",
    source_connection_id: "conn-1",
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    schema_version: "0.2.0",
    method_version: "crawl.site_graph.v1",
    captured_at: capturedAgo(0),
    source_window: { start: null, end: null },
    availability: "available",
    limitation: "Static crawl of public pages.",
    raw_object_key: null,
    row_count: 12,
    checksum: "a".repeat(64),
    summary: {},
    created_at: capturedAgo(0),
    ...overrides,
  };
}

function connection(
  overrides: Partial<SourceConnectionRow> = {},
): SourceConnectionRow {
  return {
    id: "conn-1",
    workspace_id: "ws-1",
    project_id: "proj-1",
    site_id: "site-1",
    provider: "crawl",
    connection_type: "public",
    state: "available",
    external_ref: null,
    scopes: [],
    config: {},
    limitation: "Static crawl of public pages.",
    connected_at: capturedAgo(0),
    disconnected_at: null,
    last_successful_snapshot_id: "snap-1",
    created_by: "actor-1",
    created_at: capturedAgo(0),
    updated_at: capturedAgo(0),
    ...overrides,
  };
}

describe("isStale — freshness window boundary (spec §5.2, AC-018)", () => {
  for (const [provider, days] of WINDOWS) {
    const window = days * DAY_MS;

    it(`${provider}: just inside the ${days}d window is NOT stale`, () => {
      expect(isStale(provider, capturedAgo(window - 1), NOW)).toBe(false);
    });

    it(`${provider}: exactly at the ${days}d boundary is NOT stale (strict >)`, () => {
      expect(isStale(provider, capturedAgo(window), NOW)).toBe(false);
    });

    it(`${provider}: one millisecond past the ${days}d window IS stale`, () => {
      expect(isStale(provider, capturedAgo(window + 1), NOW)).toBe(true);
    });

    it(`${provider}: a brand-new snapshot is NOT stale`, () => {
      expect(isStale(provider, capturedAgo(0), NOW)).toBe(false);
    });
  }

  it("a provider with no configured window (dataforseo) is never stale", () => {
    expect(isStale("dataforseo", capturedAgo(365 * DAY_MS), NOW)).toBe(false);
  });

  it("an unparseable capturedAt is treated as NOT stale (never throws)", () => {
    expect(isStale("crawl", "not-a-date", NOW)).toBe(false);
  });

  it("windows are provider-specific: a 6d GSC snapshot is stale but a 6d Crawl snapshot is fresh", () => {
    const sixDays = capturedAgo(6 * DAY_MS);
    expect(isStale("gsc", sixDays, NOW)).toBe(true); // 6d > 3d window
    expect(isStale("crawl", sixDays, NOW)).toBe(false); // 6d <= 7d window
  });
});

describe("toSourceConnectionDto — effective state downgrade (spec §5.2, AC-018)", () => {
  it("available connection + a FRESH snapshot keeps state `available`", () => {
    const dto = toSourceConnectionDto({
      projectId: "proj-1",
      provider: "crawl",
      connection: connection({ state: "available" }),
      latestSnapshot: snapshot({ captured_at: capturedAgo(1 * DAY_MS) }),
      activeRun: null,
      featureEnabled: true,
      now: NOW,
    });
    expect(dto.state).toBe("available");
    expect(dto.latestSnapshot).not.toBeNull();
  });

  it("available connection + a STALE snapshot downgrades state to `stale`", () => {
    const dto = toSourceConnectionDto({
      projectId: "proj-1",
      provider: "crawl",
      connection: connection({ state: "available" }),
      latestSnapshot: snapshot({ captured_at: capturedAgo(8 * DAY_MS) }),
      activeRun: null,
      featureEnabled: true,
      now: NOW,
    });
    expect(dto.state).toBe("stale");
  });

  it("partial connection + a STALE snapshot also downgrades to `stale`", () => {
    const dto = toSourceConnectionDto({
      projectId: "proj-1",
      provider: "gsc",
      connection: connection({ provider: "gsc", state: "partial" }),
      latestSnapshot: snapshot({
        provider: "gsc",
        captured_at: capturedAgo(4 * DAY_MS),
      }),
      activeRun: null,
      featureEnabled: true,
      now: NOW,
    });
    expect(dto.state).toBe("stale");
  });

  it("connected but NO snapshot never shows `available` — it downgrades to `stale` (AC-018)", () => {
    const dto = toSourceConnectionDto({
      projectId: "proj-1",
      provider: "gsc",
      connection: connection({
        provider: "gsc",
        state: "available",
        last_successful_snapshot_id: null,
      }),
      latestSnapshot: null,
      activeRun: null,
      featureEnabled: true,
      now: NOW,
    });
    expect(dto.state).toBe("stale");
    expect(dto.state).not.toBe("available");
  });

  it("a non-available/partial state (connecting) is NOT downgraded by freshness", () => {
    const dto = toSourceConnectionDto({
      projectId: "proj-1",
      provider: "gsc",
      connection: connection({ provider: "gsc", state: "connecting" }),
      latestSnapshot: null,
      activeRun: null,
      featureEnabled: true,
      now: NOW,
    });
    expect(dto.state).toBe("connecting");
  });
});

describe("null-not-zero honesty in the snapshot DTO (spec §1.3, AC-018)", () => {
  it("preserves the snapshot Site and method identity needed by diagnosis selection", () => {
    const dto = toDataSnapshotDto(
      snapshot({
        site_id: "site-diagnostic",
        method_version: "crawl.site_graph.v2",
      }),
    );

    expect(dto.siteId).toBe("site-diagnostic");
    expect(dto.methodVersion).toBe("crawl.site_graph.v2");
  });

  it("keeps an enabled DataForSEO legacy slot disconnected until collection provisions it", () => {
    const dto = toSourceConnectionDto({
      projectId: "proj-1",
      provider: "dataforseo",
      connection: null,
      latestSnapshot: null,
      activeRun: null,
      featureEnabled: true,
      now: NOW,
    });

    expect(dto).toMatchObject({
      id: null,
      provider: "dataforseo",
      connectionType: "api_key_stub",
      state: "disconnected",
      featureEnabled: true,
      latestSnapshot: null,
    });
    expect(dto.limitation).toContain("collection is enabled");
  });

  it("an absent snapshot surfaces as `null`, NOT a zero-filled object", () => {
    const dto = toSourceConnectionDto({
      projectId: "proj-1",
      provider: "crawl",
      connection: null,
      latestSnapshot: null,
      activeRun: null,
      featureEnabled: true,
      now: NOW,
    });
    // Not-connected slot: null identity is preserved end to end.
    expect(dto.state).toBe("disconnected");
    expect(dto.id).toBeNull();
    expect(dto.latestSnapshot).toBeNull();
  });

  it("an empty source_window maps to null start/end, never 0 or empty string", () => {
    const dto = toDataSnapshotDto(snapshot({ source_window: {} }));
    expect(dto.sourceWindow.start).toBeNull();
    expect(dto.sourceWindow.end).toBeNull();
    // Explicitly assert the honesty invariant: unavailable window bounds are null,
    // never coerced to 0 / "" (spec §1.3).
    expect(dto.sourceWindow.start).not.toBe(0);
    expect(dto.sourceWindow.start).not.toBe("");
    expect(dto.sourceWindow.end).not.toBe(0);
    expect(dto.sourceWindow.end).not.toBe("");
  });

  it("a populated source_window passes its ISO bounds through unchanged", () => {
    const dto = toDataSnapshotDto(
      snapshot({
        source_window: {
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-07-15T00:00:00.000Z",
        },
      }),
    );
    expect(dto.sourceWindow.start).toBe("2026-07-01T00:00:00.000Z");
    expect(dto.sourceWindow.end).toBe("2026-07-15T00:00:00.000Z");
  });

  it("non-string (malformed) window bounds are dropped to null, not passed as raw values", () => {
    const dto = toDataSnapshotDto(
      snapshot({ source_window: { start: 0, end: 1720000000 } }),
    );
    expect(dto.sourceWindow.start).toBeNull();
    expect(dto.sourceWindow.end).toBeNull();
  });
});
