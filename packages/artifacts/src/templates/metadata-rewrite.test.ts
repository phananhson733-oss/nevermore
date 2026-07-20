import { describe, expect, it } from "vitest";
import { ARTIFACT_FORMAT } from "../types.ts";
import { validateArtifact } from "../validators/index.ts";
import { validateMetadata } from "../validators/metadata.ts";
import { build } from "./metadata-rewrite.ts";
import { makePromptInput } from "./fixtures.ts";

describe("metadata-rewrite template", () => {
  it("produces a JSON object that passes its own validator", () => {
    const content = build(makePromptInput("metadata_rewrite"));
    expect(validateMetadata(content)).toEqual([]);
    const result = validateArtifact("metadata_rewrite", {
      contentFormat: ARTIFACT_FORMAT.metadata_rewrite,
      content,
    });
    expect(result.valid).toBe(true);
  });

  it("emits real frozen current metadata from the allowlisted input", () => {
    const content = build(makePromptInput("metadata_rewrite"));
    expect(content).toMatchObject({
      url: "https://acme.example/pricing",
      currentTitle: "Acme Analytics Pricing",
      currentDescription: "Compare Acme Analytics plans and pricing.",
    });
    expect(content.proposedTitle).not.toBe("");
    expect(content.proposedDescription).not.toBe("");
  });

  it("leaves missing current metadata null (never fabricated)", () => {
    const content = build(
      makePromptInput("metadata_rewrite", {
        currentMetadata: {
          url: null,
          currentTitle: null,
          currentDescription: null,
        },
      }),
    );
    expect(content.url).toBeNull();
    expect(content.currentTitle).toBeNull();
    expect(content.currentDescription).toBeNull();
  });

  it("derives targetQueries from evidence subjectRefs and evidenceRefs from ids", () => {
    const content = build(makePromptInput("metadata_rewrite"));
    expect(content.targetQueries).toEqual(["pricing", "acme pricing"]);
    expect(content.evidenceRefs).toEqual(["ev_ctr_001"]);
  });

  it("does not re-derive the URL from a different finding subject", () => {
    const input = makePromptInput("metadata_rewrite", {
      finding: {
        ...makePromptInput("metadata_rewrite").finding,
        subjectRefs: ["https://other.example/not-the-frozen-target"],
      },
    });
    expect(build(input).url).toBe("https://acme.example/pricing");
  });

  it("is deterministic for identical input", () => {
    const input = makePromptInput("metadata_rewrite");
    expect(build(input)).toEqual(build(input));
  });
});
