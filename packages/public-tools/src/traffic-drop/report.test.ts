import { describe, expect, it } from "vitest";

import { buildTrafficDropReport } from "./report.ts";
import { ASTROLOGYWIKI_DAILY } from "./__tests__/astrologywiki-fixture.ts";
import { BOTH_CLEAR } from "./__tests__/self-check-fixtures.ts";

const COMPLETED_AT = "2026-07-31T09:00:00.000Z";

function report(daily = ASTROLOGYWIKI_DAILY) {
  return buildTrafficDropReport({
    daily,
    completedAt: COMPLETED_AT,
    selfChecks: BOTH_CLEAR,
  });
}

describe("buildTrafficDropReport", () => {
  it("stamps a public-tool envelope that stores nothing", () => {
    const { run } = report();

    expect(run).toEqual({
      tool: "traffic_drop_diagnosis",
      schemaVersion: "traffic_drop.daily.v2",
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
      "avoid_assuming_penalty",
      "avoid_disavow",
      "avoid_rank_recovery",
      "isolate_stage_one_ctr",
      "pull_deploy_logs",
    ]);
    expect(byId.avoid_rank_recovery?.kind).toBe("avoid");
    expect(byId.pull_deploy_logs?.kind).toBe("external_data");
  });

  it("asks about the page that is still open, and only that one", () => {
    // Half-answered: the security page is settled, the manual-action page is
    // not. The ask has to name the second and leave the first alone — sending
    // someone back to a report they just read is how a tool teaches people to
    // skip its instructions.
    const { result } = buildTrafficDropReport({
      daily: ASTROLOGYWIKI_DAILY,
      completedAt: COMPLETED_AT,
      selfChecks: { manualAction: "uncertain", securityIssue: "reports_none" },
    });

    expect(result.siteSignals.selfChecks.path).toBe("unconfirmed");
    expect(result.siteSignals.selfChecks.unresolved).toEqual(["manual_action"]);

    const ids = result.actions.map((action) => action.id);
    expect(ids).toContain("check_manual_actions");
    expect(ids).not.toContain("check_security_issues");
    // Withheld: disavow advice rests on there being no manual action, and the
    // visitor has not told us that.
    expect(ids).not.toContain("avoid_disavow");
  });

  it("keeps the disavow advice tied to the manual-action answer, not to the path", () => {
    // A reported security issue puts the report on `issue_reported` while the
    // manual-action page stays unsettled. Deriving "may we discuss penalties"
    // from the path alone would hand out the disavow reassurance here, on the
    // strength of an answer nobody gave.
    const { result } = buildTrafficDropReport({
      daily: ASTROLOGYWIKI_DAILY,
      completedAt: COMPLETED_AT,
      selfChecks: {
        manualAction: "uncertain",
        securityIssue: "reports_issue",
      },
    });

    expect(result.siteSignals.selfChecks.path).toBe("issue_reported");
    expect(result.actions.map((action) => action.id)).toEqual([
      "resolve_security_issue",
    ]);
  });

  it("never emits an action without evidence behind it", () => {
    const { result } = report();
    const foundIds = new Set(result.findings.map((finding) => finding.id));

    for (const action of result.actions) {
      // Either kind of basis satisfies this, but an action with neither is
      // the thing the tool exists not to do.
      expect(action.basis.length + action.signalBasis.length).toBeGreaterThan(
        0,
      );
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

    expect(checks).toHaveLength(11);
    expect(checks.filter((check) => check.status === "hit")).toHaveLength(3);
    // Seven, not five: the two query-dimension checks join the list and both
    // report that the read did not happen. They are `not_available`, never
    // `clear` — a run that could not look has not looked.
    expect(
      checks.filter((check) => check.status === "not_available"),
    ).toHaveLength(7);
    // Every unavailable check states a machine-readable reason.
    for (const check of checks) {
      expect(check.status === "not_available").toBe(
        check.unavailableReason !== null,
      );
    }
  });

  it("lights up the query-level checks once the evidence is actually supplied", () => {
    // The wiring test. Every other case in this file runs without query
    // evidence, which means they would all still pass if `queryEvidence` were
    // silently dropped on the floor between the input and the two modules
    // that consume it.
    const rows = (scale: number) => [
      ...Array.from({ length: 12 }, (_unused, index) => ({
        query: `acme ${index}`,
        clicks: 20,
        impressions: 400,
        position: 4,
      })),
      ...Array.from({ length: 12 }, (_unused, index) => ({
        query: `widget guide ${index}`,
        clicks: Math.round(50 * scale),
        impressions: Math.round(900 * scale),
        position: scale < 1 ? 60 : 5,
      })),
    ];
    const window = (startDate: string, endDate: string, scale: number) => {
      const data = rows(scale);
      return {
        startDate,
        endDate,
        rows: data,
        paging: { pagesFetched: 1, truncated: false },
        queryAggregation: "byProperty",
        totals: {
          clicks: data.reduce((sum, row) => sum + row.clicks, 0),
          impressions: data.reduce((sum, row) => sum + row.impressions, 0),
          responseAggregationType: "byProperty",
        },
      };
    };

    const { result } = buildTrafficDropReport({
      daily: ASTROLOGYWIKI_DAILY,
      completedAt: COMPLETED_AT,
      selfChecks: BOTH_CLEAR,
      brandTerms: ["acme"],
      brandTermsConfirmed: true,
      queryEvidence: {
        before: window("2026-06-01", "2026-06-28", 1),
        after: window("2026-07-02", "2026-07-29", 0.1),
      },
    });

    expect(result.siteSignals.brandSplit.kind).toBe("slice");
    expect(result.siteSignals.queryCohort.kind).toBe("migration");
    const byId = Object.fromEntries(
      result.checks.map((check) => [check.id, check.status]),
    );
    expect(byId.brand_non_brand_split).toBe("hit");
    expect(byId.query_cohort_migration).toBe("hit");

    // A lopsided split points at the cheap technical checks first, not at
    // content — a robots rule or a stray noindex on one template produces
    // exactly this shape and is fixable this afternoon.
    expect(result.actions.map((action) => action.id)).toContain(
      "check_landing_page_indexability",
    );
  });

  it("degrades to a limitation instead of a verdict on a site with too little history", () => {
    const { result } = report(ASTROLOGYWIKI_DAILY.slice(-40));

    expect(result.changePoint.state).toBe("insufficient_history");
    expect(result.changePoint.limitation).toBe("history_below_twelve_weeks");
    // Degrade, don't blank out: the day-level anomaly needs only four weeks of
    // same-weekday baseline, so it still reports — while every finding and
    // action that depends on the window-level verdict is withheld.
    expect(result.actions.map((action) => action.id)).toEqual([
      "avoid_assuming_penalty",
      "avoid_disavow",
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
