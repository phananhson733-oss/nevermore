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
    const meta = {
      ...validMetadata(),
      currentTitle: null,
      currentDescription: null,
    };
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
    expect(validateMetadata("not-json")).toEqual([
      "metadata content must be a JSON object",
    ]);
    expect(validateMetadata(["array"])).toEqual([
      "metadata content must be a JSON object",
    ]);
    expect(validateMetadata(null)).toEqual([
      "metadata content must be a JSON object",
    ]);
  });

  it("rejects injected HTML/script in any string field (spec §14.4, AC-033)", () => {
    const withScript = {
      ...validMetadata(),
      proposedTitle: "<script>alert(1)</script>Pricing",
    };
    expect(validateMetadata(withScript)).toContain(
      "metadata contains disallowed raw HTML/script (spec §14.4)",
    );
    const withIframe = {
      ...validMetadata(),
      proposedDescription: "buy <iframe src=x>",
    };
    expect(validateMetadata(withIframe).length).toBeGreaterThan(0);
    const withJsUri = {
      ...validMetadata(),
      rationale: "click javascript:steal()",
    };
    expect(validateMetadata(withJsUri).length).toBeGreaterThan(0);
    const inArray = {
      ...validMetadata(),
      targetQueries: ["ok", "<script>x</script>"],
    };
    expect(validateMetadata(inArray).length).toBeGreaterThan(0);
  });
});
