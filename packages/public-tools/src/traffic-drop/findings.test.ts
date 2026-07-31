import { describe, expect, it } from "vitest";

import { detectTrafficChangePoint } from "./changepoint.ts";
import { buildTrafficFindings } from "./findings.ts";
import { ASTROLOGYWIKI_DAILY } from "./__tests__/astrologywiki-fixture.ts";
import type { TrafficDailyPoint, TrafficFindingId } from "./types.ts";

function findingsFor(series: readonly TrafficDailyPoint[]) {
  return buildTrafficFindings(series, detectTrafficChangePoint(series));
}

function idsOf(
  series: readonly TrafficDailyPoint[],
): readonly TrafficFindingId[] {
  return findingsFor(series).map((finding) => finding.id);
}

describe("buildTrafficFindings", () => {
  it("reports the real site's decline as two stages, not one", () => {
    const finding = findingsFor(ASTROLOGYWIKI_DAILY).find(
      (entry) => entry.id === "two_stage_decline",
    );

    expect(finding).toBeDefined();
    expect(finding?.tier).toBe("observed");

    const measures = Object.fromEntries(
      (finding?.measures ?? []).map((measure) => [measure.key, measure.value]),
    );
    expect(measures.stage_one_clicks_change).toBeCloseTo(-0.59, 2);
    expect(measures.stage_one_impressions_change).toBeCloseTo(-0.04, 2);
    expect(measures.stage_two_impressions_change).toBeCloseTo(-0.73, 2);
    expect(measures.total_clicks_change).toBeCloseTo(-0.81, 2);
  });

  it("does not also emit the single-stage finding when the stages separated", () => {
    expect(idsOf(ASTROLOGYWIKI_DAILY)).not.toContain("sustained_decline");
  });

  it("flags the day that drew the most impressions and converted worst", () => {
    const finding = findingsFor(ASTROLOGYWIKI_DAILY).find(
      (entry) => entry.id === "high_impression_low_click_day",
    );
    const measures = Object.fromEntries(
      (finding?.measures ?? []).map((measure) => [measure.key, measure.value]),
    );

    expect(measures.date).toBe("2026-07-19");
    expect(measures.impressions).toBe(5_044);
    expect(measures.clicks).toBe(38);
    // Offered as a hypothesis: GSC cannot establish why those impressions
    // converted poorly.
    expect(finding?.hypothesis).toBe("low_intent_query_influx");
    expect(finding?.tier).toBe("observed");
  });

  it("reports the collapse-and-rebound run apart from the decline", () => {
    const finding = findingsFor(ASTROLOGYWIKI_DAILY).find(
      (entry) => entry.id === "transient_visibility_anomaly",
    );
    const measures = Object.fromEntries(
      (finding?.measures ?? []).map((measure) => [measure.key, measure.value]),
    );

    // The run starts on 07-26, not 07-27: 371 impressions against a ~2,328
    // trailing baseline is already inside the cliff by the same rule that
    // catches 07-27. Reading the chart by eye would have started it a day late.
    expect(measures.start_date).toBe("2026-07-26");
    expect(measures.end_date).toBe("2026-07-28");
    expect(measures.day_count).toBe(3);
    expect(measures.low_impressions).toBe(21);
    expect(measures.rebound_impressions).toBe(953);
    // This run sits inside the days Search Console has not finalised, so the
    // finding is shown with that caveat rather than as settled fact: the dip
    // may be the reporting lag rather than something that happened to the site.
    expect(finding?.limitation).toBe("event_within_unfinalized_window");
  });

  it("declares seasonality unassessable rather than estimating it", () => {
    const finding = findingsFor(ASTROLOGYWIKI_DAILY).find(
      (entry) => entry.id === "seasonality_unavailable",
    );

    expect(finding?.tier).toBe("data_boundary");
    expect(
      finding?.measures.find((measure) => measure.key === "history_days")
        ?.value,
    ).toBe(86);
  });

  it("stays quiet on a B2B site that loses most of its traffic every weekend", () => {
    // 2026-01-01 is a Thursday; index % 7 of 2 and 3 are Saturday and Sunday.
    const weekendCyclical = Array.from({ length: 120 }, (_unused, index) => {
      const date = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000);
      const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
      return {
        date: date.toISOString().slice(0, 10),
        clicks: weekend ? 2 : 40,
        impressions: weekend ? 40 : 900,
      };
    });

    // Every weekend is a >95% drop against the trailing week, which a
    // trailing-mean baseline would report as an outage 34 times over.
    expect(idsOf(weekendCyclical)).not.toContain(
      "transient_visibility_anomaly",
    );
  });

  it("still catches a single weekday that fell off a cliff and came back", () => {
    const outage = Array.from({ length: 120 }, (_unused, index) => ({
      date: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
      clicks: index === 100 ? 0 : 30,
      impressions: index === 100 ? 12 : 1_200,
    }));

    const finding = findingsFor(outage).find(
      (entry) => entry.id === "transient_visibility_anomaly",
    );
    expect(
      finding?.measures.find((measure) => measure.key === "day_count")?.value,
    ).toBe(1);
  });

  it("produces exactly the five findings the daily series supports", () => {
    expect(idsOf(ASTROLOGYWIKI_DAILY)).toEqual([
      "two_stage_decline",
      "high_impression_low_click_day",
      "transient_visibility_anomaly",
      "seasonality_unavailable",
    ]);
  });
});
