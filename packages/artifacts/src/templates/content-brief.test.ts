import { describe, expect, it } from "vitest";
import { ARTIFACT_FORMAT } from "../types.ts";
import { validateArtifact } from "../validators/index.ts";
import { build } from "./content-brief.ts";
import { makePromptInput } from "./fixtures.ts";

describe("content-brief template", () => {
  it("produces markdown that passes its own validator (en)", () => {
    const input = makePromptInput("content_brief", { outputLocale: "en" });
    const markdown = build(input);
    const result = validateArtifact("content_brief", {
      contentFormat: ARTIFACT_FORMAT.content_brief,
      content: markdown,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("produces zh-CN markdown that passes its own validator", () => {
    const input = makePromptInput("content_brief", { outputLocale: "zh-CN" });
    const markdown = build(input);
    expect(markdown).toContain("## 目标");
    expect(markdown).toContain("## 验收清单");
    const result = validateArtifact("content_brief", {
      contentFormat: ARTIFACT_FORMAT.content_brief,
      content: markdown,
    });
    expect(result.valid).toBe(true);
  });

  it("emits English headings for a non-zh locale", () => {
    const markdown = build(makePromptInput("content_brief", { outputLocale: "en-US" }));
    expect(markdown).toContain("## Objective");
    expect(markdown).toContain("## Conversion Path");
    expect(markdown).not.toContain("## 目标");
  });

  it("is deterministic for identical input", () => {
    const input = makePromptInput("content_brief");
    expect(build(input)).toBe(build(input));
  });

  it("cites evidence ids and never emits raw HTML from injected input", () => {
    const input = makePromptInput("content_brief", {
      finding: {
        ruleId: "SEARCH-CTR-004",
        domain: "search",
        summary: "<script>alert(1)</script> CTR is low",
        severity: "medium",
        confidence: "high",
        subjectRefs: ["https://acme.example/pricing"],
      },
    });
    const markdown = build(input);
    expect(markdown).toContain("ev_ctr_001");
    expect(markdown).not.toContain("<script>");
    const result = validateArtifact("content_brief", {
      contentFormat: ARTIFACT_FORMAT.content_brief,
      content: markdown,
    });
    expect(result.valid).toBe(true);
  });
});
