import { describe, expect, it } from "vitest";
import { ARTIFACT_FORMAT } from "../types.ts";
import { buildTemplateArtifact } from "../templates/index.ts";
import { makePromptInput } from "../templates/fixtures.ts";
import { validateArtifact } from "./index.ts";

const TICKET_WITHOUT_VALIDATION =
  "## Problem\n\nCTR low.\n\n" +
  "## Affected Scope\n\n- /pricing\n\n" +
  "## Evidence\n\n- [ev1] claim\n\n" +
  "## Implementation Steps\n\n1. do it\n\n" +
  "## Acceptance Tests\n\n- [ ] passes\n\n" +
  "## Risk\n\nlow\n";

describe("validateArtifact dispatch", () => {
  it("round-trips a template content_brief to valid", () => {
    const content = buildTemplateArtifact(makePromptInput("content_brief"));
    expect(validateArtifact("content_brief", content).valid).toBe(true);
  });

  it("round-trips a template metadata_rewrite to valid", () => {
    const content = buildTemplateArtifact(makePromptInput("metadata_rewrite"));
    expect(validateArtifact("metadata_rewrite", content).valid).toBe(true);
  });

  it("flags a contentFormat mismatch", () => {
    const result = validateArtifact("content_brief", {
      contentFormat: "json",
      content: "## Objective\n\nx\n",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("contentFormat must be"))).toBe(true);
  });

  it("accepts a core-only ticket when validation/rollback is not required", () => {
    const result = validateArtifact(
      "technical_ticket",
      { contentFormat: ARTIFACT_FORMAT.technical_ticket, content: TICKET_WITHOUT_VALIDATION },
      { requiresValidationRollback: false },
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a ticket missing validation/rollback when required", () => {
    const result = validateArtifact(
      "technical_ticket",
      { contentFormat: ARTIFACT_FORMAT.technical_ticket, content: TICKET_WITHOUT_VALIDATION },
      { requiresValidationRollback: true },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("## Validation"))).toBe(true);
    expect(result.errors.some((e) => e.includes("## Rollback"))).toBe(true);
  });

  it("rejects a ready-blocking empty validation section when required", () => {
    const ticket = `${TICKET_WITHOUT_VALIDATION}\n## Validation\n\n## Rollback\n\nrevert\n`;
    const result = validateArtifact(
      "technical_ticket",
      { contentFormat: ARTIFACT_FORMAT.technical_ticket, content: ticket },
      { requiresValidationRollback: true },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("empty required section: ## Validation"))).toBe(true);
  });
});
