import { describe, expect, it } from "vitest";
import type { ArtifactPromptInput } from "../types.ts";
import type { MarkdownEnvelope, MetadataEnvelope } from "./envelope.ts";
import { checkReferences } from "./reference-check.ts";

function makeInput(): ArtifactPromptInput {
  return {
    artifactType: "content_brief",
    outputLocale: "en",
    operatorInstructions: null,
    icp: {
      productName: "Acme Analytics",
      oneLineDescription: "Product analytics for B2B SaaS teams.",
      offers: [],
      useCases: [],
      differentiators: [],
      primaryConversion: null,
      marketCodes: ["US"],
    },
    action: {
      templateId: "content.brief.v1",
      title: "Publish a comparison page",
      description: "Create a /compare page.",
      expectedOutcome: "Capture comparison intent.",
      effort: "medium",
      risk: "low",
    },
    finding: {
      ruleId: "content-gap",
      domain: "content",
      summary: "No comparison content.",
      severity: "high",
      confidence: "b",
      subjectRefs: ["url:/"],
    },
    evidence: [
      {
        evidenceId: "ev-1",
        claim: "Organic sessions fell 45% quarter over quarter.",
        grade: "B",
        subjectRefs: ["url:/"],
        observedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    requiresValidationRollback: false,
  };
}

function markdownEnvelope(overrides: Partial<MarkdownEnvelope> = {}): MarkdownEnvelope {
  return {
    kind: "content_brief",
    markdown: "Organic sessions fell 45% last quarter, so we should publish a comparison page.",
    evidenceRefs: ["ev-1"],
    citedNumbers: [{ value: "45%", evidenceId: "ev-1" }],
    ...overrides,
  };
}

function inputWithEvidence(
  evidence: ArtifactPromptInput["evidence"],
): ArtifactPromptInput {
  return { ...makeInput(), evidence };
}

function inputWithNonEvidenceNumber(
  location: "operator" | "icp" | "action" | "finding",
): ArtifactPromptInput {
  const input = makeInput();
  switch (location) {
    case "operator":
      return { ...input, operatorInstructions: "Target 88% growth." };
    case "icp":
      return {
        ...input,
        icp: { ...input.icp, oneLineDescription: "Analytics for 88% of teams." },
      };
    case "action":
      return {
        ...input,
        action: { ...input.action, expectedOutcome: "Lift conversion by 88%." },
      };
    case "finding":
      return {
        ...input,
        finding: { ...input.finding, summary: "Conversion is down 88%." },
      };
  }
}

describe("checkReferences (spec §10.2 / §14.4 step 2)", () => {
  it("passes when every cited number appears in its referenced evidence", () => {
    expect(checkReferences(makeInput(), markdownEnvelope())).toEqual([]);
  });

  it("rejects a fabricated number not present in the referenced evidence", () => {
    const envelope = markdownEnvelope({
      markdown: "Organic sessions fell 80% last quarter.",
      citedNumbers: [{ value: "80%", evidenceId: "ev-1" }],
    });
    const errors = checkReferences(makeInput(), envelope);
    expect(errors.some((e) => e.includes("does not appear in evidence"))).toBe(true);
  });

  it("rejects a body statistic that traces to no provided evidence", () => {
    const envelope = markdownEnvelope({
      markdown: "Conversion jumped 3.2x after the change.",
      citedNumbers: [],
    });
    const errors = checkReferences(makeInput(), envelope);
    expect(errors.some((e) => e.includes("not supported by any provided evidence"))).toBe(true);
  });

  it("requires a citedNumbers entry even when the body number exists in evidence", () => {
    const envelope = markdownEnvelope({ citedNumbers: [] });
    const errors = checkReferences(makeInput(), envelope);
    expect(errors.some((e) => e.includes('factual number "45%"'))).toBe(true);
  });

  it("requires citedNumbers.value to contain only the exact numeric token", () => {
    const envelope = markdownEnvelope({
      citedNumbers: [{ value: "about 45%", evidenceId: "ev-1" }],
    });
    expect(checkReferences(makeInput(), envelope)).toContain(
      'cited number "about 45%" does not appear in evidence "ev-1"',
    );
  });

  it.each(["operator", "icp", "action", "finding"] as const)(
    "does not treat a number from non-evidence %s context as supported",
    (location) => {
      const envelope = markdownEnvelope({
        markdown: "The target is 88% growth.",
        citedNumbers: [],
      });
      const errors = checkReferences(
        inputWithNonEvidenceNumber(location),
        envelope,
      );
      expect(errors.some((e) => e.includes('factual number "88%"'))).toBe(
        true,
      );
    },
  );

  it("allows values written as unknown / 待确认 instead of fabricating", () => {
    const envelope = markdownEnvelope({
      markdown: "Organic traffic change: unknown. Baseline conversion rate: 待确认.",
      citedNumbers: [{ value: "unknown", evidenceId: "ev-1" }],
    });
    expect(checkReferences(makeInput(), envelope)).toEqual([]);
  });

  it("rejects an evidenceRef that was never provided", () => {
    const envelope = markdownEnvelope({ evidenceRefs: ["ev-1", "ev-missing"] });
    const errors = checkReferences(makeInput(), envelope);
    expect(errors.some((e) => e.includes("ev-missing"))).toBe(true);
  });

  it("rejects a cited number that references a non-existent evidenceId", () => {
    const envelope = markdownEnvelope({
      markdown: "Sessions changed by 45%.",
      citedNumbers: [{ value: "45%", evidenceId: "ev-999" }],
    });
    const errors = checkReferences(makeInput(), envelope);
    expect(errors.some((e) => e.includes("ev-999"))).toBe(true);
  });

  it.each([
    ["5%", "45%"],
    ["20", "120"],
    ["2x", "12x"],
  ])(
    "uses exact number tokens instead of accepting %s as a substring of %s",
    (citedValue, evidenceValue) => {
      const input = inputWithEvidence([
        {
          ...makeInput().evidence[0]!,
          claim: `The measured value was ${evidenceValue}.`,
        },
      ]);
      const envelope = markdownEnvelope({
        markdown: `The measured value was ${citedValue}.`,
        citedNumbers: [{ value: citedValue, evidenceId: "ev-1" }],
      });
      expect(checkReferences(input, envelope)).toContain(
        `cited number "${citedValue}" does not appear in evidence "ev-1"`,
      );
    },
  );

  it("keeps distinct integers above JavaScript's safe range exact", () => {
    const input = inputWithEvidence([
      {
        ...makeInput().evidence[0]!,
        claim: "The source identifier is 9007199254740992.",
      },
    ]);
    const envelope = markdownEnvelope({
      markdown: "The source identifier is 9007199254740993.",
      citedNumbers: [
        { value: "9007199254740993", evidenceId: "ev-1" },
      ],
    });
    expect(checkReferences(input, envelope)).toContain(
      'cited number "9007199254740993" does not appear in evidence "ev-1"',
    );
  });

  it("binds a shared number to the specifically cited evidence", () => {
    const input = inputWithEvidence([
      makeInput().evidence[0]!,
      {
        ...makeInput().evidence[0]!,
        evidenceId: "ev-2",
        claim: "The qualitative interview contained no measured percentage.",
      },
    ]);
    const wrongEvidence = markdownEnvelope({
      evidenceRefs: ["ev-2"],
      citedNumbers: [{ value: "45%", evidenceId: "ev-2" }],
    });
    expect(checkReferences(input, wrongEvidence)).toContain(
      'cited number "45%" does not appear in evidence "ev-2"',
    );

    const rightEvidence = markdownEnvelope({
      evidenceRefs: ["ev-1"],
      citedNumbers: [{ value: "45%", evidenceId: "ev-1" }],
    });
    expect(checkReferences(input, rightEvidence)).toEqual([]);
  });

  it("allows repeated body occurrences to share one valid citation", () => {
    const envelope = markdownEnvelope({
      markdown: "Sessions fell 45%; the 45% decline needs investigation.",
      citedNumbers: [{ value: "45%", evidenceId: "ev-1" }],
    });
    expect(checkReferences(makeInput(), envelope)).toEqual([]);
  });

  it("normalizes grouped integers and equivalent decimal formatting", () => {
    const input = inputWithEvidence([
      {
        ...makeInput().evidence[0]!,
        claim: "The sample included 1,204 sessions and conversion fell 45.0%.",
      },
    ]);
    const envelope = markdownEnvelope({
      markdown: "The sample included 1204 sessions and conversion fell 45%.",
      citedNumbers: [
        { value: "1,204", evidenceId: "ev-1" },
        { value: "45%", evidenceId: "ev-1" },
      ],
    });
    expect(checkReferences(input, envelope)).toEqual([]);
  });

  it("keeps a negative currency amount distinct from the positive amount", () => {
    const input = inputWithEvidence([
      {
        ...makeInput().evidence[0]!,
        claim: "The measured loss was -$500.",
      },
    ]);
    const envelope = markdownEnvelope({
      markdown: "The measured loss was $500.",
      citedNumbers: [{ value: "$500", evidenceId: "ev-1" }],
    });
    expect(checkReferences(input, envelope)).toContain(
      'cited number "$500" does not appear in evidence "ev-1"',
    );
  });

  it("does not let positive currency evidence support a negative amount", () => {
    const input = inputWithEvidence([
      {
        ...makeInput().evidence[0]!,
        claim: "The measured revenue was $500.",
      },
    ]);
    const envelope = markdownEnvelope({
      markdown: "The measured loss was -$500.",
      citedNumbers: [{ value: "-$500", evidenceId: "ev-1" }],
    });
    expect(checkReferences(input, envelope)).toContain(
      'cited number "-$500" does not appear in evidence "ev-1"',
    );
  });

  it("canonicalizes sign-before-currency and currency-before-sign equally", () => {
    const input = inputWithEvidence([
      {
        ...makeInput().evidence[0]!,
        claim: "The measured loss was -$500.",
      },
    ]);
    const envelope = markdownEnvelope({
      markdown: "The measured loss was $-500.",
      citedNumbers: [{ value: "$-500", evidenceId: "ev-1" }],
    });
    expect(checkReferences(input, envelope)).toEqual([]);
  });

  it("canonicalizes a leading-decimal percentage to its zero-prefixed form", () => {
    const input = inputWithEvidence([
      {
        ...makeInput().evidence[0]!,
        claim: "The measured rate was .5%.",
      },
    ]);
    const envelope = markdownEnvelope({
      markdown: "The measured rate was 0.5%.",
      citedNumbers: [{ value: "0.5%", evidenceId: "ev-1" }],
    });
    expect(checkReferences(input, envelope)).toEqual([]);
  });

  it("detects an uncited leading-decimal percentage as one exact token", () => {
    const envelope = markdownEnvelope({
      markdown: "The measured rate was .5%.",
      citedNumbers: [],
    });
    expect(checkReferences(makeInput(), envelope)).toContain(
      'factual number ".5%" in the artifact is not supported by any provided evidence citation',
    );
  });

  it.each([
    ["3 users", "3"],
    ["500 users", "500"],
    ["Revenue was $500", "$500"],
    ["Conversion changed -20%", "-20%"],
    ["The launch occurred in 2026", "2026"],
  ])(
    "rejects an uncited factual number in prose: %s",
    (body, expectedToken) => {
      const envelope = markdownEnvelope({
        markdown: body,
        citedNumbers: [],
      });
      const errors = checkReferences(makeInput(), envelope);
      expect(errors.some((e) => e.includes(`factual number "${expectedToken}"`))).toBe(
        true,
      );
    },
  );

  it("accepts a single-digit factual integer only with an exact Evidence citation", () => {
    const input = inputWithEvidence([
      {
        ...makeInput().evidence[0]!,
        claim: "The crawl found 3 affected pages.",
      },
    ]);
    const envelope = markdownEnvelope({
      markdown: "The crawl found 3 affected pages.",
      citedNumbers: [{ value: "3", evidenceId: "ev-1" }],
    });
    expect(checkReferences(input, envelope)).toEqual([]);
  });

  it("accepts bare integers, currency, negative percentages, and years when exactly cited", () => {
    const input = inputWithEvidence([
      {
        ...makeInput().evidence[0]!,
        claim:
          "There were 500 users, revenue was $500, conversion changed -20%, and launch occurred in 2026.",
      },
    ]);
    const envelope = markdownEnvelope({
      markdown:
        "There were 500 users; revenue was $500; conversion changed -20%; launch occurred in 2026.",
      citedNumbers: [
        { value: "500", evidenceId: "ev-1" },
        { value: "$500", evidenceId: "ev-1" },
        { value: "-20%", evidenceId: "ev-1" },
        { value: "2026", evidenceId: "ev-1" },
      ],
    });
    expect(checkReferences(input, envelope)).toEqual([]);
  });

  it("ignores Markdown ordered-list markers and other structural small integers", () => {
    const envelope = markdownEnvelope({
      markdown: [
        "## Steps",
        "",
        "1. Inspect the page.",
        "2) Draft the change.",
        "Step 3: validate the result.",
      ].join("\n"),
      citedNumbers: [],
    });
    expect(checkReferences(makeInput(), envelope)).toEqual([]);
  });

  it("rejects a number that exists only beyond the 500-character prompt excerpt", () => {
    const input = inputWithEvidence([
      {
        ...makeInput().evidence[0]!,
        claim: `${"a".repeat(500)} 77% appears only after the excerpt boundary.`,
      },
    ]);
    const envelope = markdownEnvelope({
      markdown: "The measured change was 77%.",
      citedNumbers: [{ value: "77%", evidenceId: "ev-1" }],
    });
    expect(checkReferences(input, envelope)).toContain(
      'cited number "77%" does not appear in evidence "ev-1"',
    );
  });

  it("scans metadata envelope text fields too", () => {
    const metadata: MetadataEnvelope = {
      kind: "metadata_rewrite",
      url: "https://acme.example/",
      currentTitle: "unknown",
      currentDescription: "unknown",
      proposedTitle: "Boost conversions 12.5% instantly",
      proposedDescription: "Compare Acme Analytics against alternatives.",
      targetQueries: ["acme vs competitor"],
      rationale: "Addresses the comparison content gap.",
      evidenceRefs: ["ev-1"],
      citedNumbers: [],
    };
    const errors = checkReferences(makeInput(), metadata);
    expect(errors.some((e) => e.includes("12.5%"))).toBe(true);
  });
});
