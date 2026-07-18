import { describe, expect, it } from "vitest";
import { ARTIFACT_FORMAT } from "../types.ts";
import { validateArtifact } from "../validators/index.ts";
import { build } from "./technical-ticket.ts";
import { makePromptInput } from "./fixtures.ts";

function validate(markdown: string, requiresValidationRollback: boolean) {
  return validateArtifact(
    "technical_ticket",
    { contentFormat: ARTIFACT_FORMAT.technical_ticket, content: markdown },
    { requiresValidationRollback },
  );
}

describe("technical-ticket template", () => {
  it("produces markdown that passes its own validator (en)", () => {
    const markdown = build(makePromptInput("technical_ticket", { outputLocale: "en" }));
    expect(validate(markdown, false).valid).toBe(true);
  });

  it("produces zh-CN markdown that passes its own validator", () => {
    const markdown = build(makePromptInput("technical_ticket", { outputLocale: "zh-CN" }));
    expect(markdown).toContain("## 问题");
    expect(markdown).toContain("## 验证");
    expect(markdown).toContain("## 回滚");
    expect(validate(markdown, false).valid).toBe(true);
  });

  it("always emits Validation and Rollback sections, so passes when required", () => {
    const markdown = build(
      makePromptInput("technical_ticket", { requiresValidationRollback: true }),
    );
    expect(markdown).toContain("## Validation");
    expect(markdown).toContain("## Rollback");
    expect(validate(markdown, true).valid).toBe(true);
  });

  it("adds a high-risk note under Risk when validation/rollback is required", () => {
    const markdown = build(
      makePromptInput("technical_ticket", { requiresValidationRollback: true }),
    );
    expect(markdown).toContain("high-risk");
  });

  it("is deterministic for identical input", () => {
    const input = makePromptInput("technical_ticket");
    expect(build(input)).toBe(build(input));
  });
});
