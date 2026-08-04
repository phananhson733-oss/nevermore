import { describe, expect, it } from "vitest";

import {
  compareToRankingUpdates,
  eventWindowFor,
  RANKING_UPDATE_TABLE,
  type ComparisonWindowLike,
  type RankingUpdateTable,
} from "./core-updates.ts";

const WINDOWS: readonly ComparisonWindowLike[] = [
  { id: "peak", startDate: "2025-03-10", endDate: "2025-03-16" },
  { id: "mid", startDate: "2025-03-17", endDate: "2025-03-23" },
  { id: "recent", startDate: "2025-03-24", endDate: "2025-03-30" },
];

function table(
  overrides: Partial<RankingUpdateTable> = {},
): RankingUpdateTable {
  return {
    version: "test.v1",
    source: "test",
    verifiedThrough: "2025-12-31",
    updates: [
      {
        id: "core-2025-03",
        name: "March 2025 core update",
        kind: "core",
        startDate: "2025-03-13",
        endDate: "2025-03-27",
      },
    ],
    ...overrides,
  };
}

describe("eventWindowFor", () => {
  it("spans the turn, and reports its own width", () => {
    // The detector works on whole weeks, so the event is an interval. Anything
    // that renders this as a date is claiming a precision the detector does
    // not have.
    expect(eventWindowFor(WINDOWS)).toEqual({
      startDate: "2025-03-16",
      endDate: "2025-03-23",
      dayCount: 8,
    });
  });

  it("has nothing to place when no event was located", () => {
    expect(eventWindowFor([])).toBeNull();
  });
});

describe("compareToRankingUpdates", () => {
  it("reports the overlap with the days it covers", () => {
    const result = compareToRankingUpdates(WINDOWS, table());

    expect(result.kind).toBe("compared");
    if (result.kind !== "compared") return;
    expect(result.overlapping).toHaveLength(1);
    expect(result.overlapping[0]).toMatchObject({
      overlapStart: "2025-03-16",
      overlapEnd: "2025-03-23",
      overlapDays: 8,
      rolloutEndUnannounced: false,
    });
  });

  it("refuses to answer for an event newer than the table", () => {
    // The whole point. Without this, a table nobody has updated since last
    // year reports "no update around your decline" for every recent event —
    // our own staleness, rendered as a fact about the visitor's site.
    const stale = compareToRankingUpdates(
      WINDOWS,
      table({ verifiedThrough: "2025-03-20" }),
    );

    expect(stale).toMatchObject({
      kind: "not_available",
      reason: "table_not_verified_through_event",
      verifiedThrough: "2025-03-20",
    });
  });

  it("distinguishes no overlap from no answer", () => {
    const result = compareToRankingUpdates(
      [
        { id: "peak", startDate: "2025-06-02", endDate: "2025-06-08" },
        { id: "mid", startDate: "2025-06-09", endDate: "2025-06-15" },
      ],
      table(),
    );

    // An empty list is a real comparison that found nothing overlapping. It is
    // NOT evidence that the decline was not an algorithm change, and the copy
    // layer is what has to say so — but the engine has to keep the two states
    // apart for that copy to be possible at all.
    expect(result.kind).toBe("compared");
    if (result.kind !== "compared") return;
    expect(result.overlapping).toEqual([]);
  });

  it("does not widen an unannounced rollout end into an open interval", () => {
    // A 2023 entry whose completion was never published must not overlap every
    // decline that has happened since.
    const open = table({
      verifiedThrough: "2026-12-31",
      updates: [
        {
          id: "core-open",
          name: "Open-ended update",
          kind: "core",
          startDate: "2023-01-05",
          endDate: null,
        },
      ],
    });

    const far = compareToRankingUpdates(WINDOWS, open);
    expect(far.kind).toBe("compared");
    if (far.kind !== "compared") return;
    expect(far.overlapping).toEqual([]);

    const touching = compareToRankingUpdates(
      [
        { id: "peak", startDate: "2022-12-30", endDate: "2023-01-05" },
        { id: "mid", startDate: "2023-01-06", endDate: "2023-01-12" },
      ],
      open,
    );
    expect(touching.kind).toBe("compared");
    if (touching.kind !== "compared") return;
    expect(touching.overlapping[0]).toMatchObject({
      overlapDays: 1,
      rolloutEndUnannounced: true,
    });
  });

  it("says nothing rather than something when there is no event", () => {
    expect(compareToRankingUpdates([], table())).toMatchObject({
      kind: "not_available",
      reason: "no_event_window",
    });
  });
});

describe("the shipped table", () => {
  it("carries the day it was last checked, not the last entry's date", () => {
    // These are different facts and conflating them is how the staleness guard
    // gets quietly disabled: a table whose verifiedThrough tracks its newest
    // entry always claims to be current.
    expect(RANKING_UPDATE_TABLE.verifiedThrough).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(RANKING_UPDATE_TABLE.version).not.toBe("");
    expect(RANKING_UPDATE_TABLE.source).toContain("status.search.google.com");
  });

  it("keeps every entry inside the verified range and in order", () => {
    for (const update of RANKING_UPDATE_TABLE.updates) {
      expect(update.startDate <= RANKING_UPDATE_TABLE.verifiedThrough).toBe(
        true,
      );
      if (update.endDate !== null) {
        expect(update.endDate >= update.startDate).toBe(true);
      }
    }
  });
});
