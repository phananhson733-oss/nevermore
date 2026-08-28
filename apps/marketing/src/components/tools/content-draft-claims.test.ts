// @input  -- hand-written sentences, including ones whose support_count disagrees with their refs
// @output -- proof the underline colour follows the references a sentence cites, nothing else
// @pos    -- pins the claim-to-layer rule of handoff §7 for the draft document

import { describe, expect, it } from "vitest";

import { claimTone } from "./content-draft-claims.ts";

describe("claimTone", () => {
  it("colours a bound sentence third-party when it cites a competitor page", () => {
    expect(claimTone({ claim: "bound", evidence_refs: ["C3"] })).toBe("third");
    expect(claimTone({ claim: "bound", evidence_refs: ["P1", "C10"] })).toBe("third");
  });

  it("colours a bound sentence first-party when it cites only profile facts", () => {
    expect(claimTone({ claim: "bound", evidence_refs: ["P2"] })).toBe("first");
  });

  it("reads the references, not the support count", () => {
    // A count that disagrees with the refs must not win: the colour says what
    // the sentence cites, and the refs are what it cites.
    expect(claimTone({ claim: "bound", evidence_refs: ["C1"], support_count: 0 } as never)).toBe("third");
    expect(claimTone({ claim: "bound", evidence_refs: ["P1"], support_count: 5 } as never)).toBe("first");
  });

  it("maps stance to first-party, gap to the error colour, and no_claim to nothing", () => {
    expect(claimTone({ claim: "stance", evidence_refs: ["P3"] })).toBe("first");
    expect(claimTone({ claim: "gap", evidence_refs: [] })).toBe("gap");
    expect(claimTone({ claim: "no_claim", evidence_refs: [] })).toBeNull();
  });

  it("does not mistake a lookalike id for a competitor page", () => {
    expect(claimTone({ claim: "bound", evidence_refs: ["CX", "c1", "P1"] })).toBe("first");
  });
});
