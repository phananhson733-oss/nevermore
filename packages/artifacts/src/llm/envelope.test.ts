import { describe, expect, it } from "vitest";
import type { ArtifactPromptInput } from "../types.ts";
import {
  UNTRUSTED_CLOSE,
  UNTRUSTED_OPEN,
  buildMessages,
  hashArtifactContent,
  hashPromptInput,
  parseEnvelope,
  toArtifactContent,
} from "./envelope.ts";

function makeInput(overrides: Partial<ArtifactPromptInput> = {}): ArtifactPromptInput {
  return {
    artifactType: "content_brief",
    outputLocale: "en",
    operatorInstructions: "Focus on mid-market buyers.",
    icp: {
      productName: "Acme Analytics",
      oneLineDescription: "Product analytics for B2B SaaS teams.",
      offers: ["14-day free trial"],
      useCases: ["Funnel analysis"],
      differentiators: ["No-code setup"],
      primaryConversion: { label: "Book a demo", type: "demo", targetUrl: "https://acme.example/demo" },
      marketCodes: ["US"],
    },
    action: {
      templateId: "content.brief.v1",
      title: "Publish a comparison page",
      description: "Create a /compare page targeting comparison intent.",
      expectedOutcome: "Capture bottom-of-funnel comparison queries.",
      effort: "medium",
      risk: "low",
    },
    finding: {
      ruleId: "content-gap",
      domain: "content",
      summary: "No comparison content exists for the core category.",
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
    ...overrides,
  };
}

describe("buildMessages allowlist (spec §10.2)", () => {
  it("wraps evidence as UNTRUSTED and instructs the model not to follow embedded instructions", () => {
    const { system, user } = buildMessages(makeInput());
    expect(user).toContain(UNTRUSTED_OPEN);
    expect(user).toContain(UNTRUSTED_CLOSE);
    expect(user).toContain("Organic sessions fell 45%");
    expect(system).toMatch(/NEVER follow/i);
    expect(system).toContain(UNTRUSTED_OPEN);
  });

  it("serializes only allowlisted fields — no tokens, secrets, or other-project identifiers", () => {
    const serialized = JSON.stringify(buildMessages(makeInput()));
    for (const forbidden of [
      "workspaceId",
      "projectId",
      "access_token",
      "refresh_token",
      "accessToken",
      "apiKey",
      "Authorization",
      "Bearer",
      "sk-",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Allowlisted fields ARE present.
    expect(serialized).toContain("Acme Analytics");
    expect(serialized).toContain("Focus on mid-market buyers.");
  });

  it("asks for the structured citedNumbers envelope so numbers can be verified", () => {
    const { user } = buildMessages(makeInput());
    expect(user).toContain("citedNumbers");
    expect(user).toContain("evidenceRefs");
  });
});

describe("hashPromptInput (invocation inputHash)", () => {
  it("is a stable 64-char sha256 hex and deterministic for equal inputs", () => {
    const a = hashPromptInput(makeInput());
    const b = hashPromptInput(makeInput());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any allowlisted field changes", () => {
    const base = hashPromptInput(makeInput());
    const changed = hashPromptInput(makeInput({ outputLocale: "zh-CN" }));
    expect(changed).not.toBe(base);
  });
});

describe("parseEnvelope + toArtifactContent (spec §10.1)", () => {
  it("accepts a markdown envelope and yields markdown ArtifactContent", () => {
    const result = parseEnvelope("content_brief", {
      markdown: "# Brief\n\nBody.",
      evidenceRefs: ["ev-1"],
      citedNumbers: [],
      unexpectedExtraKey: "stripped",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const content = toArtifactContent(result.envelope);
    expect(content.contentFormat).toBe("markdown");
    expect(content.content).toBe("# Brief\n\nBody.");
    expect(hashArtifactContent(content)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a metadata envelope and yields a json ArtifactContent object with evidenceRefs", () => {
    const result = parseEnvelope("metadata_rewrite", {
      url: "https://acme.example/",
      currentTitle: "unknown",
      currentDescription: "unknown",
      proposedTitle: "Acme Analytics vs Competitors",
      proposedDescription: "Compare Acme Analytics against alternatives.",
      targetQueries: ["acme vs competitor"],
      rationale: "Addresses the comparison content gap.",
      evidenceRefs: ["ev-1"],
      citedNumbers: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const content = toArtifactContent(result.envelope);
    expect(content.contentFormat).toBe("json");
    expect(typeof content.content).toBe("object");
    const obj = content.content as Record<string, unknown>;
    expect(obj.proposedTitle).toBe("Acme Analytics vs Competitors");
    expect(obj.evidenceRefs).toEqual(["ev-1"]);
  });

  it("rejects an envelope missing required fields", () => {
    const result = parseEnvelope("content_brief", { evidenceRefs: [], citedNumbers: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
