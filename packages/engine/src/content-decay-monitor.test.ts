import { describe, expect, it } from "vitest";
import {
  buildContentDecayMonitor,
  CONTENT_DECAY_LIMITATIONS,
  CONTENT_DECAY_MIN_PREVIOUS_CLICKS,
  resolveContentDecayTimeZone,
  type ContentDecayMonitor,
  type ContentDecayObservationCandidate,
  type ContentDecayPage,
  type ContentDecaySnapshotCandidate,
} from "./content-decay-monitor.ts";

const PAGE: ContentDecayPage = {
  sitePageId: "00000000-0000-4000-8000-000000000101",
  normalizedUrl: "https://example.com/blog/retention",
};

function snapshot(input: {
  readonly id: string;
  readonly capturedAt: string;
  readonly start: string;
  readonly end: string;
  readonly availability?: "available" | "partial" | "unavailable";
}): ContentDecaySnapshotCandidate {
  return {
    snapshotId: input.id,
    provider: "gsc",
    datasetKey: "gsc.page_query_daily.v1",
    methodVersion: "gsc.page_query_daily.v1",
    availability: input.availability ?? "available",
    capturedAt: input.capturedAt,
    sourceWindow: { start: input.start, end: input.end },
  };
}

const APRIL = snapshot({
  id: "00000000-0000-4000-8000-000000000201",
  capturedAt: "2026-04-29T08:00:00.000Z",
  start: "2026-03-02",
  end: "2026-04-26",
});
const MAY = snapshot({
  id: "00000000-0000-4000-8000-000000000202",
  capturedAt: "2026-05-29T08:00:00.000Z",
  start: "2026-04-01",
  end: "2026-05-26",
});
const JUNE = snapshot({
  id: "00000000-0000-4000-8000-000000000203",
  capturedAt: "2026-06-29T08:00:00.000Z",
  start: "2026-05-02",
  end: "2026-06-26",
});

function observation(input: {
  readonly snapshot: ContentDecaySnapshotCandidate;
  readonly id: string;
  readonly clicks: number | null;
  readonly impressions?: number | null;
  readonly position: number | null;
  readonly availability?: "available" | "partial" | "unavailable";
  readonly sitePageId?: string;
}): ContentDecayObservationCandidate {
  return {
    observationId: input.id,
    snapshotId: input.snapshot.snapshotId,
    sitePageId: input.sitePageId ?? PAGE.sitePageId,
    subjectRef: PAGE.normalizedUrl,
    provider: "gsc",
    metricKey: "gsc.page.v1",
    availability: input.availability ?? "available",
    observedAt: input.snapshot.capturedAt,
    current28d: {
      clicks: input.clicks,
      impressions: input.impressions ?? 1_000,
      position: input.position,
    },
  };
}

/**
 * Two consecutive exact checkpoints with a stable position, so only the click
 * sample and the click delta decide whether a traffic alert is produced.
 */
function trafficMonitor(input: {
  readonly seed: string;
  readonly previousClicks: number;
  readonly currentClicks: number;
}): ContentDecayMonitor {
  return buildContentDecayMonitor({
    asOf: "2026-06-30T00:00:00.000Z",
    timeZone: resolveContentDecayTimeZone({
      providerTimeZone: "UTC",
      projectTimeZone: null,
    }),
    pages: [PAGE],
    snapshots: [MAY, JUNE],
    observations: [
      observation({
        snapshot: MAY,
        id: `00000000-0000-4000-8000-0000000004${input.seed}`,
        clicks: input.previousClicks,
        position: 8,
      }),
      observation({
        snapshot: JUNE,
        id: `00000000-0000-4000-8000-0000000005${input.seed}`,
        clicks: input.currentClicks,
        position: 8,
      }),
    ],
  });
}

describe("resolveContentDecayTimeZone", () => {
  it("uses the persisted provider timezone before the confirmed project timezone", () => {
    expect(
      resolveContentDecayTimeZone({
        providerTimeZone: "Europe/London",
        projectTimeZone: "Asia/Shanghai",
      }),
    ).toEqual({
      timeZone: "Europe/London",
      source: "provider",
      limitations: [],
    });
  });

  it("uses the confirmed project timezone when provider authority is absent", () => {
    expect(
      resolveContentDecayTimeZone({
        providerTimeZone: null,
        projectTimeZone: "Asia/Shanghai",
      }),
    ).toEqual({
      timeZone: "Asia/Shanghai",
      source: "project",
      limitations: [],
    });
  });

  it("falls back to disclosed UTC instead of guessing an invalid or missing timezone", () => {
    const resolved = resolveContentDecayTimeZone({
      providerTimeZone: "GMT+08:00",
      projectTimeZone: null,
    });

    expect(resolved.timeZone).toBe("UTC");
    expect(resolved.source).toBe("fallback");
    expect(resolved.limitations.join(" ")).toContain("UTC");
    expect(resolved.limitations).toContain(
      CONTENT_DECAY_LIMITATIONS.timeZoneFallback,
    );
  });
});

describe("buildContentDecayMonitor", () => {
  it("flags two consecutive >5-position monthly declines from three exact checkpoints", () => {
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [JUNE, APRIL, MAY],
      observations: [
        observation({
          snapshot: APRIL,
          id: "00000000-0000-4000-8000-000000000301",
          clicks: 500,
          position: 8,
        }),
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000302",
          clicks: 490,
          position: 13.1,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000303",
          clicks: 480,
          position: 18.2,
        }),
      ],
    });

    expect(result.status).toBe("available");
    expect(result.latestCheckpointMonth).toBe("2026-06");
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({
      sitePageId: PAGE.sitePageId,
      normalizedUrl: PAGE.normalizedUrl,
      currentMonth: "2026-06",
      triggers: ["rank_decline"],
      rankTrend: {
        olderMonth: "2026-04",
        previousMonth: "2026-05",
        currentMonth: "2026-06",
        olderPosition: 8,
        previousPosition: 13.1,
        currentPosition: 18.2,
        firstDecline: 5.1,
        secondDecline: 5.1,
      },
      trafficTrend: null,
    });
  });

  it("requires each adjacent rank delta to be strictly greater than five", () => {
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [APRIL, MAY, JUNE],
      observations: [
        observation({
          snapshot: APRIL,
          id: "00000000-0000-4000-8000-000000000311",
          clicks: 500,
          position: 8,
        }),
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000312",
          clicks: 490,
          position: 13,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000313",
          clicks: 480,
          position: 20,
        }),
      ],
    });

    expect(result.alerts).toEqual([]);
  });

  it("flags a latest monthly click decline strictly greater than 20 percent and preserves true zero", () => {
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [MAY, JUNE],
      observations: [
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000321",
          clicks: 100,
          position: 8,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000322",
          clicks: 0,
          impressions: 0,
          position: null,
        }),
      ],
    });

    expect(result.status).toBe("partial");
    expect(result.alerts[0]).toMatchObject({
      triggers: ["traffic_decline"],
      rankTrend: null,
      trafficTrend: {
        previousMonth: "2026-05",
        currentMonth: "2026-06",
        previousClicks: 100,
        currentClicks: 0,
        changeRatio: -1,
      },
    });
  });

  it("accepts the persisted canonical subject for an exact trailing-slash SitePage identity", () => {
    const slashPage: ContentDecayPage = {
      ...PAGE,
      normalizedUrl: `${PAGE.normalizedUrl}/`,
    };
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [slashPage],
      snapshots: [MAY, JUNE],
      observations: [
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000323",
          clicks: 100,
          position: 8,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000324",
          clicks: 70,
          position: 8,
        }),
      ],
    });

    expect(result.alerts).toEqual([
      expect.objectContaining({
        sitePageId: slashPage.sitePageId,
        normalizedUrl: slashPage.normalizedUrl,
        triggers: ["traffic_decline"],
      }),
    ]);
  });

  it("does not trigger at exactly 20 percent or when the previous click denominator is zero", () => {
    const exactThreshold = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [MAY, JUNE],
      observations: [
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000331",
          clicks: 100,
          position: 8,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000332",
          clicks: 80,
          position: 8,
        }),
      ],
    });
    const zeroDenominator = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [MAY, JUNE],
      observations: [
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000333",
          clicks: 0,
          position: 8,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000334",
          clicks: 0,
          position: 8,
        }),
      ],
    });

    expect(exactThreshold.alerts).toEqual([]);
    expect(zeroDenominator.alerts).toEqual([]);
  });

  it("keeps the minimum previous-click sample aligned with SEARCH-DECAY-002", () => {
    expect(CONTENT_DECAY_MIN_PREVIOUS_CLICKS).toBe(100);
  });

  it("does not advise a review when the previous month never reached the minimum click sample", () => {
    const tinySample = trafficMonitor({
      seed: "37",
      previousClicks: 5,
      currentClicks: 3,
    });
    const justBelowFloor = trafficMonitor({
      seed: "38",
      previousClicks: CONTENT_DECAY_MIN_PREVIOUS_CLICKS - 1,
      currentClicks: 1,
    });

    expect(tinySample.alerts).toEqual([]);
    expect(justBelowFloor.alerts).toEqual([]);
  });

  it("still advises a review at the minimum click sample and reports both sample sizes", () => {
    const result = trafficMonitor({
      seed: "39",
      previousClicks: CONTENT_DECAY_MIN_PREVIOUS_CLICKS,
      currentClicks: 79,
    });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({
      triggers: ["traffic_decline"],
      trafficTrend: {
        previousMonth: "2026-05",
        currentMonth: "2026-06",
        previousClicks: 100,
        currentClicks: 79,
        changeRatio: -0.21,
      },
    });
  });

  it("discloses the minimum previous-click sample as a limitation", () => {
    const result = trafficMonitor({
      seed: "40",
      previousClicks: 5,
      currentClicks: 3,
    });

    expect(result.limitations.join(" ")).toContain(
      `${CONTENT_DECAY_MIN_PREVIOUS_CLICKS}`,
    );
  });

  it("fails the whole page fact closed when impressions exist but average position is missing", () => {
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [MAY, JUNE],
      observations: [
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000335",
          clicks: 100,
          impressions: 1_000,
          position: null,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000336",
          clicks: 70,
          impressions: 1_000,
          position: null,
        }),
      ],
    });

    expect(result.alerts).toEqual([]);
    expect(result.status).toBe("partial");
  });

  it("fails closed for partial snapshots, missing values, duplicate observations, and month gaps", () => {
    const partialMay = { ...MAY, availability: "partial" as const };
    const duplicateJune = observation({
      snapshot: JUNE,
      id: "00000000-0000-4000-8000-000000000342",
      clicks: 0,
      position: 20,
    });
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [APRIL, partialMay, JUNE],
      observations: [
        observation({
          snapshot: APRIL,
          id: "00000000-0000-4000-8000-000000000341",
          clicks: 100,
          position: 8,
        }),
        duplicateJune,
        {
          ...duplicateJune,
          observationId: "00000000-0000-4000-8000-000000000343",
        },
      ],
    });

    expect(result.alerts).toEqual([]);
    expect(result.status).toBe("partial");
    expect(result.limitations).toContain(
      CONTENT_DECAY_LIMITATIONS.neverBackfilled,
    );
  });

  it("does not fall back to an older available snapshot when the canonical snapshot for that month is partial", () => {
    const olderAvailableJune = snapshot({
      id: "00000000-0000-4000-8000-000000000344",
      capturedAt: "2026-06-28T08:00:00.000Z",
      start: "2026-05-01",
      end: "2026-06-25",
    });
    const canonicalPartialJune = {
      ...JUNE,
      availability: "partial" as const,
    };
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [MAY, olderAvailableJune, canonicalPartialJune],
      observations: [
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000345",
          clicks: 100,
          position: 8,
        }),
        observation({
          snapshot: olderAvailableJune,
          id: "00000000-0000-4000-8000-000000000346",
          clicks: 0,
          impressions: 0,
          position: null,
        }),
      ],
    });

    expect(result.alerts).toEqual([]);
    expect(result.status).toBe("partial");
    expect(result.latestCheckpointMonth).toBe("2026-06");
  });

  it("does not fall back to an older exact snapshot when the canonical snapshot has a malformed window", () => {
    const malformedCanonicalJune = snapshot({
      id: "00000000-0000-4000-8000-000000000346",
      capturedAt: "2026-06-29T09:00:00.000Z",
      start: "2026-05-03",
      end: "2026-06-26",
    });
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [MAY, JUNE, malformedCanonicalJune],
      observations: [
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000350",
          clicks: 100,
          position: 8,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000354",
          clicks: 70,
          position: 8,
        }),
      ],
    });

    expect(result.alerts).toEqual([]);
    expect(result.status).toBe("partial");
    expect(result.latestCheckpointMonth).toBe("2026-06");
  });

  it("does not surface a stale alert when the latest monthly authority is more than one month behind as-of", () => {
    const result = buildContentDecayMonitor({
      asOf: "2026-08-15T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [MAY, JUNE],
      observations: [
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000355",
          clicks: 100,
          position: 8,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000356",
          clicks: 70,
          position: 8,
        }),
      ],
    });

    expect(result.alerts).toEqual([]);
    expect(result.status).toBe("partial");
    expect(result.latestCheckpointMonth).toBe("2026-06");
  });

  it("treats conflicting subject identities for one snapshot/page as ambiguous instead of selecting the matching row", () => {
    const may = observation({
      snapshot: MAY,
      id: "00000000-0000-4000-8000-000000000347",
      clicks: 100,
      position: 8,
    });
    const june = observation({
      snapshot: JUNE,
      id: "00000000-0000-4000-8000-000000000348",
      clicks: 70,
      position: 8,
    });
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [MAY, JUNE],
      observations: [
        may,
        june,
        {
          ...june,
          observationId: "00000000-0000-4000-8000-000000000349",
          subjectRef: "https://example.com/blog/conflicting-identity",
        },
      ],
    });

    expect(result.alerts).toEqual([]);
    expect(result.status).toBe("partial");
  });

  it("selects one stable checkpoint per month by end, captured time, then lowest UUID", () => {
    const olderEnd = snapshot({
      id: "00000000-0000-4000-8000-000000000351",
      capturedAt: "2026-06-25T08:00:00.000Z",
      start: "2026-04-27",
      end: "2026-06-21",
    });
    const higherId = snapshot({
      id: "00000000-0000-4000-8000-000000000359",
      capturedAt: JUNE.capturedAt,
      start: JUNE.sourceWindow.start,
      end: JUNE.sourceWindow.end,
    });
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: "UTC",
        projectTimeZone: null,
      }),
      pages: [PAGE],
      snapshots: [higherId, olderEnd, JUNE, MAY],
      observations: [
        observation({
          snapshot: MAY,
          id: "00000000-0000-4000-8000-000000000361",
          clicks: 100,
          position: 8,
        }),
        observation({
          snapshot: JUNE,
          id: "00000000-0000-4000-8000-000000000362",
          clicks: 70,
          position: 8,
        }),
        observation({
          snapshot: higherId,
          id: "00000000-0000-4000-8000-000000000363",
          clicks: 100,
          position: 8,
        }),
        observation({
          snapshot: olderEnd,
          id: "00000000-0000-4000-8000-000000000364",
          clicks: 100,
          position: 8,
        }),
      ],
    });

    expect(result.alerts[0]?.sourceSnapshotIds).toEqual([
      MAY.snapshotId,
      JUNE.snapshotId,
    ]);
  });

  it("is an explicitly read-time projection and never claims monthly scheduling is connected", () => {
    const result = buildContentDecayMonitor({
      asOf: "2026-06-30T00:00:00.000Z",
      timeZone: resolveContentDecayTimeZone({
        providerTimeZone: null,
        projectTimeZone: null,
      }),
      pages: [],
      snapshots: [],
      observations: [],
    });

    expect(result.projectionMode).toBe("read_time");
    expect(result.scheduleState).toBe("not_configured");
    expect(result.status).toBe("unavailable");
    expect(result.alerts).toEqual([]);
    expect(result.limitations).toContain(
      CONTENT_DECAY_LIMITATIONS.readTimeOnly,
    );
  });
});
