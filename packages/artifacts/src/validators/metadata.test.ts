import { describe, expect, it } from "vitest";
import { validateMetadata } from "./metadata.ts";

function validMetadata(): Record<string, unknown> {
  return {
    url: "https://acme.example/pricing",
    currentTitle: null,
    proposedTitle: "Pricing | Acme Analytics",
    currentDescription: null,
    proposedDescription: "Compare Acme Analytics plans and start a free trial.",
    targetQueries: ["pricing", "acme pricing"],
    rationale: "Rewrite to match the primary query intent.",
    evidenceRefs: ["ev_ctr_001"],
  };
}

describe("validateMetadata", () => {
  it("passes for a valid metadata object", () => {
    expect(validateMetadata(validMetadata())).toEqual([]);
  });

  it("allows null current values (never fabricated)", () => {
    const meta = { ...validMetadata(), currentTitle: null, currentDescription: null };
    expect(validateMetadata(meta)).toEqual([]);
  });

  it("reports a missing proposedTitle", () => {
    const { proposedTitle: _proposedTitle, ...rest } = validMetadata();
    const errors = validateMetadata(rest);
    expect(errors.some((e) => e.startsWith("proposedTitle"))).toBe(true);
  });

  it("rejects an empty proposedDescription", () => {
    const meta = { ...validMetadata(), proposedDescription: "" };
    const errors = validateMetadata(meta);
    expect(errors.some((e) => e.startsWith("proposedDescription"))).toBe(true);
  });

  it("rejects a non-array targetQueries", () => {
    const meta = { ...validMetadata(), targetQueries: "pricing" };
    const errors = validateMetadata(meta);
    expect(errors.some((e) => e.startsWith("targetQueries"))).toBe(true);
  });

  it("rejects a non-object payload", () => {
    expect(validateMetadata("not-json")).toEqual(["metadata content must be a JSON object"]);
    expect(validateMetadata(["array"])).toEqual(["metadata content must be a JSON object"]);
    expect(validateMetadata(null)).toEqual(["metadata content must be a JSON object"]);
  });
});
