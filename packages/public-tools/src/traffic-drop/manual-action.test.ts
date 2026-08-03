import { describe, expect, it } from "vitest";

import {
  brandTermCandidates,
  propertyLabel,
} from "./brand-candidates.ts";
import {
  DEFAULT_MANUAL_ACTION_STATUS,
  diagnosisPathFor,
  isManualActionStatus,
  MANUAL_ACTION_STATUSES,
  mayDiscussPenalty,
  observeManualAction,
} from "./manual-action.ts";

describe("manual action status", () => {
  it("defaults to not having been asked", () => {
    expect(DEFAULT_MANUAL_ACTION_STATUS).toBe("not_checked");
    expect(observeManualAction(DEFAULT_MANUAL_ACTION_STATUS)).toEqual({
      status: "not_checked",
      path: "unconfirmed",
      lineage: "not_reported",
    });
  });

  it("never claims the tool observed it", () => {
    // There is no `tool_observed` lineage and there cannot be one: Google
    // publishes no Manual Actions endpoint, so a report that spoke about this
    // in its own voice would be describing a lookup it never performed.
    for (const status of MANUAL_ACTION_STATUSES) {
      const lineage = observeManualAction(status).lineage;
      expect(["visitor_reported", "not_reported"]).toContain(lineage);
    }
  });

  it("routes uncertainty away from the reassuring path", () => {
    // "I could not find it" and "it said no problems detected" are different
    // answers. Collapsing the first into the second hands an all-clear to
    // someone who may have been looking at the Security Issues report, or at
    // a different property entirely.
    expect(diagnosisPathFor("uncertain")).toBe("unconfirmed");
    expect(diagnosisPathFor("user_reports_none")).toBe("no_manual_action");
    expect(diagnosisPathFor("user_reports_manual_action")).toBe(
      "manual_action",
    );
  });

  it("stays silent about penalties until the visitor has looked", () => {
    // Both directions are gated. "No evidence of a penalty" is a claim about a
    // question we cannot answer alone, and a reader who has not opened Search
    // Console will take it as an all-clear.
    expect(mayDiscussPenalty(observeManualAction("not_checked"))).toBe(false);
    expect(mayDiscussPenalty(observeManualAction("uncertain"))).toBe(false);
    expect(mayDiscussPenalty(observeManualAction("user_reports_none"))).toBe(
      true,
    );
    expect(
      mayDiscussPenalty(observeManualAction("user_reports_manual_action")),
    ).toBe(true);
  });

  it("rejects anything that is not one of the four", () => {
    expect(isManualActionStatus("user_reports_none")).toBe(true);
    expect(isManualActionStatus("none")).toBe(false);
    expect(isManualActionStatus(true)).toBe(false);
    expect(isManualActionStatus(undefined)).toBe(false);
  });
});

describe("brand term candidates", () => {
  it("reads both property forms", () => {
    expect(propertyLabel("sc-domain:example.com")).toBe("example");
    expect(propertyLabel("https://www.example.com/")).toBe("example");
    expect(propertyLabel("blog.example.co.uk")).toBe("example");
  });

  it("offers the concatenated label as-is rather than guessing a split", () => {
    // `astrologywiki` is the case this rule exists for. Splitting it into
    // `astrology` would classify every generic query in the niche as brand and
    // quietly empty the non-brand group of exactly what the comparison
    // measures; leaving it whole simply fails to match "astrology wiki". The
    // domain cannot tell those apart, so the visitor is asked.
    expect(brandTermCandidates("sc-domain:astrologywiki.com")).toEqual([
      "astrologywiki",
    ]);
  });

  it("splits on a hyphen, because the owner wrote that boundary down", () => {
    expect(brandTermCandidates("sc-domain:gen-growth.ai")).toEqual([
      "gen-growth",
      "gen growth",
      "gengrowth",
    ]);
  });

  it("returns nothing rather than a suffix", () => {
    expect(brandTermCandidates("sc-domain:com")).toEqual([]);
    expect(brandTermCandidates("   ")).toEqual([]);
  });
});
