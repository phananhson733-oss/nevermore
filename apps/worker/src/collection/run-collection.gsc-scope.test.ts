import { describe, expect, it } from "vitest";
import type { NormalizedObservation } from "@sf/sources";
import type { CollectionOutcome } from "./persist.ts";
import {
  GSC_SITE_ORIGIN_NO_DATA_LIMITATION,
  GSC_SITE_ORIGIN_SCOPE_LIMITATION,
  scopeGscCollectionToSite,
} from "./run-collection.ts";

const capturedAt = "2026-08-02T16:44:00.000Z";

function observation(subjectRef: string): NormalizedObservation {
  return {
    metricKey: "gsc.page.v1",
    subjectType: "url",
    subjectRef,
    observedAt: capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: {
      current28d: { clicks: 1, impressions: 10, position: 3 },
      previous28d: { clicks: 0, impressions: 5, position: 4 },
      topQueries: [],
    },
    unit: null,
    origin: "first_party",
    grade: "A",
    support: "supports",
    limitation: "GSC fixture.",
  };
}

function outcome(
  availability: CollectionOutcome["availability"] = "available",
): CollectionOutcome {
  return {
    availability,
    capturedAt,
    sourceWindow: { start: "2026-06-09", end: "2026-08-02" },
    rowCount: 63,
    stopReason: null,
    providerUsage: { rows: 63 },
    limitation: "GSC provider limitation.",
    raw: { rows: ["immutable-provider-payload"] },
  };
}

describe("scopeGscCollectionToSite", () => {
  it("keeps a same-origin observation without changing the provider outcome", () => {
    const originalOutcome = outcome();
    const sameOrigin = observation("https://www.example.com/pricing");

    expect(
      scopeGscCollectionToSite({
        siteOrigin: "https://www.example.com",
        outcome: originalOutcome,
        observations: [sameOrigin],
      }),
    ).toEqual({ outcome: originalOutcome, observations: [sameOrigin] });
  });

  it("excludes apex observations returned by a domain property for a www Site", () => {
    const sameOrigin = observation("https://www.example.com/pricing");
    const apex = observation("https://example.com/pricing");
    const originalOutcome = outcome();

    const scoped = scopeGscCollectionToSite({
      siteOrigin: "https://www.example.com",
      outcome: originalOutcome,
      observations: [apex, sameOrigin],
    });

    expect(scoped.observations).toEqual([sameOrigin]);
    expect(scoped.outcome).toMatchObject({
      availability: "available",
      rowCount: 63,
      raw: originalOutcome.raw,
    });
    expect(scoped.outcome.limitation).toContain(
      GSC_SITE_ORIGIN_SCOPE_LIMITATION,
    );
  });

  it("marks an all-foreign result unavailable without rewriting raw provenance", () => {
    const originalOutcome = outcome("partial");

    const scoped = scopeGscCollectionToSite({
      siteOrigin: "https://www.example.com",
      outcome: originalOutcome,
      observations: [
        observation("https://example.com/"),
        observation("https://shop.example.com/"),
      ],
    });

    expect(scoped.observations).toEqual([]);
    expect(scoped.outcome).toMatchObject({
      availability: "unavailable",
      stopReason: "no_data",
      rowCount: 63,
      limitation: GSC_SITE_ORIGIN_NO_DATA_LIMITATION,
      raw: originalOutcome.raw,
    });
  });

  it("preserves an adapter-level no-data result", () => {
    const noData = {
      ...outcome("unavailable"),
      rowCount: 0,
      stopReason: "no_data",
      limitation: "GSC_NO_DATA: provider returned no rows.",
    };

    expect(
      scopeGscCollectionToSite({
        siteOrigin: "https://www.example.com",
        outcome: noData,
        observations: [],
      }),
    ).toEqual({ outcome: noData, observations: [] });
  });
});
