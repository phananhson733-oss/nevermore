import { describe, expect, it } from "vitest";

import { buildTrafficDropReport } from "./report.ts";
import type { ManualActionStatus } from "./manual-action.ts";
import { ASTROLOGYWIKI_DAILY } from "./__tests__/astrologywiki-fixture.ts";

/**
 * The acceptance sample, and an honest account of what it can prove.
 *
 * astrologywiki, late July 2026: three weeks from 301 clicks to 20. Traced by
 * hand to two time-sensitive content pools expiring together — a World Cup
 * final on 19 July and a monthly astrology page rolling over — with four
 * independent lines of evidence, none of which pointed at anything site-level.
 *
 * It is a NEGATIVE sample. It can demonstrate that the tool does not
 * over-claim on a real property with a known-benign cause, and that the gates
 * fire where they should. It CANNOT demonstrate that the tool detects a
 * site-level demotion, and no sample can: Google publishes no label for that,
 * so there is nothing to check a detection against. That asymmetry is why the
 * report does not offer such a verdict at all — see `report.ts`.
 */
function report(manualAction: ManualActionStatus) {
  return buildTrafficDropReport({
    daily: ASTROLOGYWIKI_DAILY,
    completedAt: "2026-07-31T09:00:00.000Z",
    manualAction,
  }).result;
}

describe("astrologywiki, on every manual-action answer", () => {
  it("carries no field that could hold a site-level verdict", () => {
    // The structural half of the guarantee. The copy test in apps/marketing is
    // the other half: prose is where a decision like this usually erodes.
    for (const status of [
      "not_checked",
      "user_reports_none",
      "uncertain",
      "user_reports_manual_action",
    ] as const) {
      expect(Object.keys(report(status).siteSignals).sort()).toEqual([
        "brandSplit",
        "coreUpdateTimeline",
        "manualAction",
        "queryCohort",
      ]);
    }
  });

  it("refuses the timeline comparison rather than reporting our own staleness", () => {
    // The event is in July 2026; the shipped table was last checked in 2025.
    // "No update around your decline" here would be a false negative
    // manufactured entirely by our maintenance schedule — and on this sample
    // it would have been a false negative that happened to be right, which is
    // the most dangerous kind.
    expect(
      report("user_reports_none").siteSignals.coreUpdateTimeline,
    ).toMatchObject({
      kind: "not_available",
      reason: "table_not_verified_through_event",
    });
  });

  it("reports the query-level checks as not run, never as clear", () => {
    const { checks } = report("user_reports_none");
    for (const id of ["brand_non_brand_split", "query_cohort_migration"]) {
      expect(checks.find((check) => check.id === id)).toEqual({
        id,
        status: "not_available",
        unavailableReason: "query_read_not_performed",
      });
    }
  });

  it("withholds the disavow advice until the visitor has actually looked", () => {
    const unchecked = report("not_checked").actions.map((a) => a.id);
    expect(unchecked).toContain("check_manual_actions");
    expect(unchecked).not.toContain("avoid_disavow");

    const confirmed = report("user_reports_none").actions.map((a) => a.id);
    expect(confirmed).toContain("avoid_disavow");
    expect(confirmed).not.toContain("check_manual_actions");
  });

  it("treats 'I could not tell' as unanswered, not as reassurance", () => {
    const uncertain = report("uncertain");
    expect(uncertain.siteSignals.manualAction.path).toBe("unconfirmed");
    expect(uncertain.actions.map((a) => a.id)).not.toContain("avoid_disavow");
  });

  it("leads with the manual action and drops everything else when there is one", () => {
    const ids = report("user_reports_manual_action").actions.map((a) => a.id);
    expect(ids).toEqual(["resolve_manual_action"]);
  });

  it("still fires the average-position warning it was written from", () => {
    // The W31 mistake this tool exists to prevent: average position ROSE while
    // the site was collapsing, because the high-ranking queries had gone. The
    // advice needs only the daily series, so it fires today and must keep
    // firing — this was the one acceptance item the requirement named.
    expect(report("user_reports_none").actions.map((a) => a.id)).toContain(
      "avoid_rank_recovery",
    );
  });

  it("finds the decline it is supposed to find", () => {
    // Guards the negative results above from becoming vacuous: a detector that
    // saw nothing at all would also pass every "does not over-claim" test.
    const result = report("user_reports_none");
    expect(result.changePoint.state).toBe("sustained_decline");
    // The finding is `two_stage_decline`: on this property impressions held
    // for a window while clicks fell, and only then did both go. The state and
    // the finding are different vocabularies and do not share a name.
    expect(result.findings.map((finding) => finding.id)).toContain(
      "two_stage_decline",
    );
  });
});
