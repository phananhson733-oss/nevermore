import { describe, expect, it } from "vitest";

import {
  isSelfCheckAnswer,
  manualActionRuledOutByVisitor,
  mayDiscussPenalty,
  observeSelfChecks,
  SELF_CHECK_ANSWERS,
  type SelfCheckAnswer,
} from "./self-checks.ts";

const ANSWERS = SELF_CHECK_ANSWERS;

function observe(manualAction: SelfCheckAnswer, securityIssue: SelfCheckAnswer) {
  return observeSelfChecks({ manualAction, securityIssue });
}

describe("self-check answers", () => {
  it("accepts exactly the three answers and nothing adjacent", () => {
    for (const answer of ANSWERS) expect(isSelfCheckAnswer(answer)).toBe(true);

    // `not_checked` was a state in the previous design, when the question was
    // asked inside the report. It is gone on purpose: answering now precedes
    // running. A client still sending it must be rejected, not mapped onto
    // something plausible.
    for (const value of [
      "not_checked",
      "user_reports_none",
      "none",
      "",
      null,
      undefined,
      true,
      0,
      ["reports_none"],
    ]) {
      expect(isSelfCheckAnswer(value)).toBe(false);
    }
  });
});

describe("the path the two answers select", () => {
  it("is `no_issue_reported` only when both pages came back empty", () => {
    const observed = observe("reports_none", "reports_none");
    expect(observed.path).toBe("no_issue_reported");
    expect(observed.issues).toEqual([]);
    expect(observed.unresolved).toEqual([]);
    expect(mayDiscussPenalty(observed)).toBe(true);
  });

  it("is `unconfirmed` whenever either page is unsettled", () => {
    for (const observed of [
      observe("uncertain", "uncertain"),
      observe("uncertain", "reports_none"),
      observe("reports_none", "uncertain"),
    ]) {
      expect(observed.path).toBe("unconfirmed");
      // The whole point of the path: while it holds, the report says nothing
      // about penalties in EITHER direction. "No evidence of a penalty" reads
      // as an all-clear to someone who never looked.
      expect(mayDiscussPenalty(observed)).toBe(false);
    }
  });

  it("names both issues when both were reported, in a fixed order", () => {
    const observed = observe("reports_issue", "reports_issue");
    expect(observed.path).toBe("issue_reported");
    // Fixed order, not input order: a manual action and a security issue have
    // different procedures and neither substitutes for the other, so the
    // report lists both rather than choosing one to lead with.
    expect(observed.issues).toEqual(["manual_action", "security_issue"]);
  });

  it("acts on a confirmed issue even while the other page is unsettled", () => {
    const observed = observe("uncertain", "reports_issue");
    // There is something concrete to fix. Withholding it because a different
    // question is open would be pedantry at the visitor's expense.
    expect(observed.path).toBe("issue_reported");
    expect(observed.issues).toEqual(["security_issue"]);
    expect(observed.unresolved).toEqual(["manual_action"]);
  });
});

describe("what each answer licenses on its own", () => {
  it("ties the manual-action clearance to that answer, never to the path", () => {
    // The failure this guards: a reported security issue puts the report on
    // `issue_reported`, and a `path !== "unconfirmed"` gate would then treat
    // the unsettled manual-action page as settled — handing out the disavow
    // reassurance on the strength of an answer nobody gave.
    expect(manualActionRuledOutByVisitor(observe("uncertain", "reports_issue")))
      .toBe(false);
    expect(
      manualActionRuledOutByVisitor(observe("reports_issue", "reports_none")),
    ).toBe(false);
    expect(
      manualActionRuledOutByVisitor(observe("reports_none", "reports_issue")),
    ).toBe(true);
  });
});

describe("lineage", () => {
  it("is always visitor-reported, on every answer", () => {
    // Google publishes no API for either page, so there is no answer we could
    // have looked up ourselves. If one ever appears, adding a second lineage
    // is a contract change every consumer has to acknowledge — which is why
    // the type has exactly one member and this test pins it.
    for (const manualAction of ANSWERS) {
      for (const securityIssue of ANSWERS) {
        const observed = observe(manualAction, securityIssue);
        expect(observed.manualAction.lineage).toBe("visitor_reported");
        expect(observed.securityIssue.lineage).toBe("visitor_reported");
      }
    }
  });

  it("keeps each observation tagged with the page it is about", () => {
    const observed = observe("reports_none", "reports_issue");
    expect(observed.manualAction.id).toBe("manual_action");
    expect(observed.securityIssue.id).toBe("security_issue");
  });
});
