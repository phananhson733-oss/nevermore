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

  it("rejects an unlisted tag / event-handler payload, not just a fixed tag list (AC-033)", () => {
    // `<img>` is not in any allow/deny list — the tag-open rule must still catch it.
    const withImg = {
      ...validMetadata(),
      proposedTitle: "<img src=x onerror=alert(1)>Pricing",
    };
    expect(validateMetadata(withImg)).toContain(
      "metadata contains disallowed raw HTML/script (spec §14.4)",
    );
    // A bare inline event handler is also rejected.
    const withHandler = {
      ...validMetadata(),
      proposedDescription: "Best plans onload=steal()",
    };
    expect(validateMetadata(withHandler).length).toBeGreaterThan(0);
  });

  it("keeps a plain non-tag `<` in prose valid (no false positive)", () => {
    const meta = { ...validMetadata(), proposedTitle: "Plans < Pro tier" };
    expect(validateMetadata(meta)).toEqual([]);
  });
});
