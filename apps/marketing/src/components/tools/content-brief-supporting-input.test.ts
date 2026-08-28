// @input  -- raw supporting-keyword field text
// @output -- proof the count follows separated pieces and the parse enforces the cap
// @pos    -- unit contract for the content brief supporting field

import { describe, expect, it } from "vitest";
import { SUPPORTING_KEYWORDS_MAX } from "@sf/public-tools/content-brief/constants";

import {
  countSupportingInput,
  parseSupportingInput,
} from "./content-brief-supporting-input.ts";

describe("countSupportingInput", () => {
  it("counts separated pieces, not validated keywords", () => {
    expect(countSupportingInput("")).toBe(0);
    expect(countSupportingInput("approval workflow")).toBe(1);
    expect(countSupportingInput("approval workflow, approval")).toBe(2);
    // A trailing separator is someone mid-list, not an empty keyword.
    expect(countSupportingInput("a, b,")).toBe(2);
  });

  it("separates on the CJK comma and line breaks but not on spaces", () => {
    expect(countSupportingInput("审批流程，审批软件\n审批 工具")).toBe(3);
  });
});

describe("parseSupportingInput", () => {
  it("returns an empty list for a blank field", () => {
    expect(parseSupportingInput("  \n ")).toEqual({ ok: true, keywords: [] });
  });

  it("folds whitespace and collapses case-insensitive duplicates", () => {
    expect(
      parseSupportingInput("Approval  Workflow, approval workflow; Approval process"),
    ).toEqual({ ok: true, keywords: ["Approval Workflow", "Approval process"] });
  });

  it("refuses more than the engine's cap after collapsing", () => {
    const pieces = Array.from(
      { length: SUPPORTING_KEYWORDS_MAX + 1 },
      (_, index) => `keyword ${index}`,
    );
    expect(parseSupportingInput(pieces.join(", "))).toEqual({
      ok: false,
      validationKey: "validation.supportingLimit",
    });
    expect(parseSupportingInput(pieces.slice(0, SUPPORTING_KEYWORDS_MAX).join(", ")).ok).toBe(
      true,
    );
  });
});
