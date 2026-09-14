/**
 * `setProfileDoc` against the state its run was built from (T9 review #1).
 *
 * A profile run reads the GSC rows, their provenance, the last audit and the
 * stored document when it starts, and writes its document steps later. A sample
 * loaded or cleared in between, rows imported, or another run's document leaves
 * the new document describing data the project no longer holds, so the reducer
 * takes it only over the same content (`sameContent`, the comparison
 * `clearGscRows` and the demo snapshot use) and otherwise hands back the very
 * same state, which is how the run tells it was refused. The profile's editable
 * fields are not compared: the document does not print them.
 */
import { describe, expect, it } from "vitest";
import type { ProfileDoc, WorkbenchProjectState } from "../types.ts";
import { profileDocBasis, reduce } from "./reducer.ts";
import { clearDemoOver, otherThan, populatedProjectState } from "./test-fixtures.ts";

const START = populatedProjectState({ url: "https://example.test", brand: "Example", market: "US" });

function docFrom(state: WorkbenchProjectState): ProfileDoc {
  if (state.profileDoc === null) throw new Error("fixture has no profile document");
  return { ...state.profileDoc, at: "2026-09-13 10:30" };
}

const DOC = docFrom(START);

describe("setProfileDoc", () => {
  it("builds the basis from the four fields the guard compares, by reference", () => {
    const basis = profileDocBasis(START);
    expect(Object.keys(basis).sort()).toEqual(["gscRows", "gscRowsSource", "lastAudit", "profileDoc"]);
    expect(basis.gscRows).toBe(START.gscRows);
    expect(basis.gscRowsSource).toBe(START.gscRowsSource);
    expect(basis.lastAudit).toBe(START.lastAudit);
    expect(basis.profileDoc).toBe(START.profileDoc);
  });

  it("writes the document over the state its basis was read from", () => {
    const written = reduce(START, { type: "setProfileDoc", doc: DOC, basis: profileDocBasis(START) });
    expect(written.profileDoc).toBe(DOC);
  });

  it("writes over the same content re-parsed from storage", () => {
    const reparsed = JSON.parse(JSON.stringify(START)) as WorkbenchProjectState;
    expect(reparsed.gscRows).not.toBe(START.gscRows);
    const written = reduce(reparsed, { type: "setProfileDoc", doc: DOC, basis: profileDocBasis(START) });
    expect(written.profileDoc).toBe(DOC);
  });

  it.each(["gscRows", "gscRowsSource", "lastAudit", "profileDoc"] as const)(
    "refuses once %s changed after the run started, returning the very same state",
    (key) => {
      const moved = { ...START, [key]: otherThan(START[key]) } as WorkbenchProjectState;
      expect(reduce(moved, { type: "setProfileDoc", doc: DOC, basis: profileDocBasis(START) })).toBe(moved);
    },
  );

  it("refuses over a sample cleared mid-run", () => {
    const cleared = clearDemoOver(START);
    expect(cleared.gscRows).toEqual([]);
    expect(reduce(cleared, { type: "setProfileDoc", doc: DOC, basis: profileDocBasis(START) })).toBe(cleared);
  });

  it("still writes when only positioning, features or competitors changed", () => {
    const edited: WorkbenchProjectState = {
      ...START,
      profile: { ...START.profile, positioning: "later", features: "later", competitors: "later" },
    };
    const written = reduce(edited, { type: "setProfileDoc", doc: DOC, basis: profileDocBasis(START) });
    expect(written.profileDoc).toBe(DOC);
  });
});
