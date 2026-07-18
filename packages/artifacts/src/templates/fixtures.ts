/**
 * Shared deterministic fixture for template + validator tests. Not a test file.
 * Every field is populated so the templates exercise their populated (not just
 * fallback) branches.
 */

import type { ArtifactPromptInput, ArtifactType } from "../types.ts";

export function makePromptInput(
  artifactType: ArtifactType,
  overrides: Partial<ArtifactPromptInput> = {},
): ArtifactPromptInput {
  const base: ArtifactPromptInput = {
    artifactType,
    outputLocale: "en",
    operatorInstructions: null,
    icp: {
      productName: "Acme Analytics",
      oneLineDescription: "Self-serve product analytics for B2B SaaS teams",
      offers: ["Free trial", "Team plan"],
      useCases: ["product analytics", "funnel analysis"],
      differentiators: ["1-click SQL", "no PII leaves the browser"],
      primaryConversion: {
        label: "Start free trial",
        type: "signup",
        targetUrl: "https://acme.example/signup",
      },
      marketCodes: ["US", "GB"],
    },
    action: {
      templateId: "rewrite_search_metadata.v1",
      title: "Rewrite metadata for the pricing page",
      description: "Update the title and meta description to match the primary query intent.",
      expectedOutcome: "Higher SERP CTR on the pricing page within the next window.",
      effort: "small",
      risk: "low",
    },
    finding: {
      ruleId: "SEARCH-CTR-004",
      domain: "search",
      summary: "Pricing page CTR is far below its impression-weighted position.",
      severity: "medium",
      confidence: "high",
      subjectRefs: ["https://acme.example/pricing"],
    },
    evidence: [
      {
        evidenceId: "ev_ctr_001",
        claim: "Position 4.2 with a 1.1% CTR over 28 days.",
        grade: "A",
        subjectRefs: ["pricing", "acme pricing"],
        observedAt: "2026-07-17T00:00:00.000Z",
      },
    ],
    requiresValidationRollback: false,
  };

  return { ...base, ...overrides };
}
