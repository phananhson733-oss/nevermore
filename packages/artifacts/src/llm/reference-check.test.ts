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
