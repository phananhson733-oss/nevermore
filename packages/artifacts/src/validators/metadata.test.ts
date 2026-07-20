import { describe, expect, it } from "vitest";
import { validateMetadata } from "./metadata.ts";

const LIMITS = {
  url: 2_048,
  title: 512,
  description: 2_048,
  rationale: 8_000,
  targetQueries: 100,
  targetQuery: 500,
  evidenceRefs: 100,
  evidenceRef: 256,
} as const;

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

  it("rejects unknown top-level fields instead of validating data Zod would strip", () => {
    const errors = validateMetadata({
      ...validMetadata(),
      extraNote: "This field is outside the exact metadata contract.",
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("allows http(s) localhost and URL fragments; they are content, not fetch targets", () => {
    expect(
      validateMetadata({
        ...validMetadata(),
        url: "http://localhost:3000/pricing#plans",
      }),
    ).toEqual([]);
  });

  it("allows null current values (never fabricated)", () => {
    const meta = {
      ...validMetadata(),
      currentTitle: null,
      currentDescription: null,
    };
    expect(validateMetadata(meta)).toEqual([]);
  });

  it("allows empty query/evidence lists and real placeholder-like literal values", () => {
    const meta = {
      ...validMetadata(),
      url: null,
      currentTitle: "Unknown",
      proposedTitle: "TBD",
      currentDescription: "N/A",
      targetQueries: [],
      evidenceRefs: [],
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

  it.each([
    ["url", 42],
    ["currentTitle", false],
    ["proposedTitle", null],
    ["currentDescription", {}],
    ["proposedDescription", []],
    ["rationale", 42],
    ["targetQueries", ["pricing", 42]],
    ["evidenceRefs", ["ev_ctr_001", null]],
  ])("rejects an invalid type at %s", (field, value) => {
    const errors = validateMetadata({ ...validMetadata(), [field]: value });
    expect(errors.some((error) => error.startsWith(field))).toBe(true);
  });

  it.each([
    ["url", ""],
    ["url", " https://acme.example/pricing"],
    ["currentTitle", ""],
    ["currentTitle", "   "],
    ["currentTitle", "Current title "],
    ["proposedTitle", "\t\n"],
    ["proposedTitle", " Proposed title"],
    ["currentDescription", ""],
    ["currentDescription", " \n "],
    ["proposedDescription", "   "],
    ["proposedDescription", "Proposed description "],
    ["rationale", "\t"],
    ["rationale", " Rationale"],
    ["targetQueries", [""]],
    ["targetQueries", ["   "]],
    ["targetQueries", [" pricing"]],
    ["evidenceRefs", [""]],
    ["evidenceRefs", ["  "]],
    ["evidenceRefs", ["ev_ctr_001 "]],
  ])("rejects empty, whitespace-only, or untrimmed %s content", (field, value) => {
    const errors = validateMetadata({ ...validMetadata(), [field]: value });
    expect(errors.some((error) => error.startsWith(field))).toBe(true);
  });

  it("accepts every bounded string and array exactly at its limit", () => {
    const prefix = "https://acme.example/";
    const meta = {
      ...validMetadata(),
      url: `${prefix}${"u".repeat(LIMITS.url - prefix.length)}`,
      currentTitle: "c".repeat(LIMITS.title),
      proposedTitle: "p".repeat(LIMITS.title),
      currentDescription: "c".repeat(LIMITS.description),
      proposedDescription: "p".repeat(LIMITS.description),
      rationale: "r".repeat(LIMITS.rationale),
      targetQueries: Array.from(
        { length: LIMITS.targetQueries },
        (_unused, index) =>
          `${String(index).padStart(3, "0")}-${"q".repeat(LIMITS.targetQuery - 4)}`,
      ),
      evidenceRefs: Array.from(
        { length: LIMITS.evidenceRefs },
        (_unused, index) =>
          `${String(index).padStart(3, "0")}-${"e".repeat(LIMITS.evidenceRef - 4)}`,
      ),
    };

    expect(validateMetadata(meta)).toEqual([]);
  });

  it.each([
    ["url", `https://acme.example/${"u".repeat(LIMITS.url)}`],
    ["currentTitle", "c".repeat(LIMITS.title + 1)],
    ["proposedTitle", "p".repeat(LIMITS.title + 1)],
    ["currentDescription", "c".repeat(LIMITS.description + 1)],
    ["proposedDescription", "p".repeat(LIMITS.description + 1)],
    ["rationale", "r".repeat(LIMITS.rationale + 1)],
    ["targetQueries", ["q".repeat(LIMITS.targetQuery + 1)]],
    ["evidenceRefs", ["e".repeat(LIMITS.evidenceRef + 1)]],
    [
      "targetQueries",
      Array.from({ length: LIMITS.targetQueries + 1 }, (_unused, index) =>
        String(index),
      ),
    ],
    [
      "evidenceRefs",
      Array.from({ length: LIMITS.evidenceRefs + 1 }, (_unused, index) =>
        `ev_${String(index)}`,
      ),
    ],
  ])("rejects %s content above its safety limit", (field, value) => {
    const errors = validateMetadata({ ...validMetadata(), [field]: value });
    expect(errors.some((error) => error.startsWith(field))).toBe(true);
  });

  it.each([
    "pricing",
    "/pricing",
    "ftp://acme.example/pricing",
    "https://operator@acme.example/pricing",
    "https://operator:secret@acme.example/pricing",
  ])("rejects a non-http(s), relative, or credential-bearing URL: %s", (url) => {
    const errors = validateMetadata({ ...validMetadata(), url });
    expect(errors.some((error) => error.startsWith("url"))).toBe(true);
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

  it.each([
    ["HTML comment", "<!-- hidden -->"],
    ["DOCTYPE declaration", "<!DOCTYPE html>"],
    ["processing instruction", "<?render target?>"],
    ["CDATA section", "<![CDATA[hidden]]>"],
    ["multiline event handler", "safe onload\n = steal()"],
    ["event handler with encoded equals", "safe onload&#x3d;steal()"],
    ["control whitespace in JS scheme", "click java\nscript:steal()"],
    ["numeric-entity JS colon", "click javascript&#x3a;steal()"],
    ["entity-obfuscated JS whitespace", "click java&#x09;script&colon;steal()"],
  ])("rejects obfuscated active content: %s", (_name, payload) => {
    expect(
      validateMetadata({ ...validMetadata(), rationale: payload }),
    ).toContain(
      "metadata contains disallowed raw HTML/script (spec §14.4)",
    );
  });

  it("keeps a plain non-tag `<` in prose valid (no false positive)", () => {
    const meta = { ...validMetadata(), proposedTitle: "Plans < Pro tier" };
    expect(validateMetadata(meta)).toEqual([]);
  });
});
