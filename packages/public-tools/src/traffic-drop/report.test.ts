import { describe, expect, it } from "vitest";

import { buildTrafficDropReport } from "./report.ts";
import { ASTROLOGYWIKI_DAILY } from "./__tests__/astrologywiki-fixture.ts";

const COMPLETED_AT = "2026-07-31T09:00:00.000Z";

function report(daily = ASTROLOGYWIKI_DAILY) {
  return buildTrafficDropReport({ daily, completedAt: COMPLETED_AT });
}

describe("buildTrafficDropReport", () => {
  it("stamps a public-tool envelope that stores nothing", () => {
    const { run } = report();

    expect(run).toEqual({
      tool: "traffic_drop_diagnosis",
      schemaVersion: "traffic_drop.daily.v1",
      scope: "property",
      mode: "public_preview",
      persistence: "none",
      completedAt: COMPLETED_AT,
    });
  });

  it("reports the real series' bounds from the data, not from the clock", () => {
    const { result } = report();

    expect(result.dataStartDate).toBe("2026-05-05");
    expect(result.dataEndDate).toBe("2026-07-29");
    expect(result.dayCount).toBe(86);
  });

  it("carries every action the findings support, including the one that says not to act", () => {
    const { result } = report();
    const byId = Object.fromEntries(
      result.actions.map((action) => [action.id, action]),
    );

    expect(Object.keys(byId).sort()).toEqual([
      "avoid_rank_recovery",
      "isolate_stage_one_ctr",
      "pull_deploy_logs",
    ]);
    expect(byId.avoid_rank_recovery?.kind).toBe("avoid");
    expect(byId.pull_deploy_logs?.kind).toBe("external_data");
  });

  it("never emits an action without evidence behind it", () => {
    const { result } = report();
    const foundIds = new Set(result.findings.map((finding) => finding.id));

    for (const action of result.actions) {
      expect(action.basis.length).toBeGreaterThan(0);
      for (const basis of action.basis) {
        expect(foundIds).toContain(basis);
      }
    }
  });

  it("withholds the cohort action while query data is absent, and says the check could not run", () => {
    const { result } = report();

    expect(result.actions.map((action) => action.id)).not.toContain(
      "split_cohorts",
    );
    const concentration = result.checks.find(
      (check) => check.id === "decline_concentration",
    );
    expect(concentration).toEqual({
      id: "decline_concentration",
      status: "not_available",
      unavailableReason: "query_data_not_supplied",
    });
  });

  it("publishes the full check list, hits and misses alike", () => {
    const { checks } = report().result;

    expect(checks).toHaveLength(9);
    expect(checks.filter((check) => check.status === "hit")).toHaveLength(3);
    expect(
      checks.filter((check) => check.status === "not_available"),
    ).toHaveLength(5);
    // Every unavailable check states a machine-readable reason.
    for (const check of checks) {
      expect(check.status === "not_available").toBe(
        check.unavailableReason !== null,
      );
    }
  });

  it("degrades to a limitation instead of a verdict on a site with too little history", () => {
    const { result } = report(ASTROLOGYWIKI_DAILY.slice(-40));

    expect(result.changePoint.state).toBe("insufficient_history");
    expect(result.changePoint.limitation).toBe("history_below_twelve_weeks");
    // Degrade, don't blank out: the day-level anomaly needs only four weeks of
    // same-weekday baseline, so it still reports — while every finding and
    // action that depends on the window-level verdict is withheld.
    expect(result.actions.map((action) => action.id)).toEqual([
      "pull_deploy_logs",
    ]);
    expect(result.findings.map((finding) => finding.id)).not.toContain(
      "two_stage_decline",
    );
    expect(
      result.checks.find((check) => check.id === "sustained_decline"),
    ).toEqual({
      id: "sustained_decline",
      status: "not_available",
      unavailableReason: "history_below_twelve_weeks",
    });
  });
});
