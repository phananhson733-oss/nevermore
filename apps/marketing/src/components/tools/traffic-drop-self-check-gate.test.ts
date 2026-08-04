// @input  -- a self-check draft and the property currently selected
// @output -- a failing test when answers can outlive the site they describe
// @pos    -- the guard on the pre-run gate's one real invariant
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  answersFor,
  emptyDraft,
  type SelfCheckDraft,
} from "./traffic-drop-self-check-gate.tsx";

const A = "sc-domain:a.example";
const B = "sc-domain:b.example";

function answered(property: string): SelfCheckDraft {
  return {
    property,
    manualAction: "reports_none",
    securityIssue: "reports_none",
  };
}

describe("answers belong to the property they were given for", () => {
  it("hands them back for that property", () => {
    expect(answersFor(answered(A), A)).toEqual({
      manualAction: "reports_none",
      securityIssue: "reports_none",
    });
  });

  it("refuses them for any other property", () => {
    // The bug this exists for. A visitor answers "no issues" for site A,
    // switches the dropdown to site B, and the run button stays enabled — B
    // gets an all-clear built on an inspection of A, with nothing on screen
    // saying so. Found in review; the earlier fix was "remember to reset in
    // selectProperty", which is the kind of thing that gets forgotten the next
    // time someone adds a field. Binding the property into the value makes the
    // stale combination unrepresentable instead.
    expect(answersFor(answered(A), B)).toBeNull();
  });

  it("refuses a half-answered draft", () => {
    expect(
      answersFor({ ...answered(A), securityIssue: null }, A),
    ).toBeNull();
    expect(answersFor({ ...answered(A), manualAction: null }, A)).toBeNull();
  });

  it("starts empty for the property it was created against", () => {
    const draft = emptyDraft(A);
    expect(draft.property).toBe(A);
    expect(answersFor(draft, A)).toBeNull();
  });

  it("guards the run and the payload with the same call", () => {
    // The run button's enabled state and the request body both read through
    // `answersFor`. Two separate checks could disagree — one saying it is safe
    // to run, the other sending something else.
    const draft = answered(A);
    for (const property of [A, B, ""]) {
      const guard = answersFor(draft, property);
      const payload = answersFor(draft, property);
      expect(payload).toEqual(guard);
    }
  });
});
