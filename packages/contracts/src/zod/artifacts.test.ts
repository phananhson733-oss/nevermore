import { describe, expect, it } from "vitest";
import {
  CreateArtifactRequest,
  MAX_ARTIFACT_CONTENT_CHARS,
  UpdateArtifactRequest,
} from "./artifacts.ts";

describe("CreateArtifactRequest delivery locale", () => {
  it.each([
    ["en", "en"],
    ["EN", "en"],
    ["zh-CN", "zh-CN"],
    ["ZH-cn", "zh-CN"],
  ])("accepts and canonicalizes template locale %s", (locale, canonical) => {
    const parsed = CreateArtifactRequest.safeParse({
      artifactType: "technical_ticket",
      generationMode: "template",
      outputLocale: locale,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.outputLocale).toBe(canonical);
  });

  it.each(["fr-FR", "zh-TW", "zh-HK", "zh-Hant", "en-US"])(
    "rejects unsupported template locale %s with an actionable stable issue",
    (locale) => {
      const parsed = CreateArtifactRequest.safeParse({
        artifactType: "technical_ticket",
        generationMode: "template",
        outputLocale: locale,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues).toContainEqual(
          expect.objectContaining({
            path: ["outputLocale"],
            message: expect.stringContaining("structured_llm"),
          }),
        );
        expect(JSON.stringify(parsed.error.issues)).not.toContain(locale);
      }
    },
  );

  it.each(["fr-FR", "zh-TW", "zh-Hant", "en-US"])(
    "continues to accept arbitrary valid structured_llm locale %s",
    (locale) => {
      expect(
        CreateArtifactRequest.safeParse({
          artifactType: "technical_ticket",
          generationMode: "structured_llm",
          outputLocale: locale,
        }).success,
      ).toBe(true);
    },
  );
});

describe("UpdateArtifactRequest", () => {
  it("accepts exactly one complete content revision command", () => {
    expect(
      UpdateArtifactRequest.safeParse({
        baseRevision: 1,
        contentFormat: "markdown",
        content: "# Updated",
        editorNote: "Operator edit",
      }).success,
    ).toBe(true);
  });

  it("accepts exactly one status command", () => {
    expect(
      UpdateArtifactRequest.safeParse({
        baseRevision: 1,
        status: "ready",
      }).success,
    ).toBe(true);
  });

  it("bounds both text and serialized JSON revision content", () => {
    const base = {
      baseRevision: 1,
      contentFormat: "markdown" as const,
    };
    expect(
      UpdateArtifactRequest.safeParse({
        ...base,
        content: "x".repeat(MAX_ARTIFACT_CONTENT_CHARS),
      }).success,
    ).toBe(true);
    expect(
      UpdateArtifactRequest.safeParse({
        ...base,
        content: "x".repeat(MAX_ARTIFACT_CONTENT_CHARS + 1),
      }).success,
    ).toBe(false);

    const emptyObjectLength = JSON.stringify({ value: "" }).length;
    const exactObject = {
      value: "x".repeat(MAX_ARTIFACT_CONTENT_CHARS - emptyObjectLength),
    };
    const oversizedObject = {
      value: `${exactObject.value}x`,
    };
    expect(
      UpdateArtifactRequest.safeParse({
        ...base,
        contentFormat: "json",
        content: exactObject,
      }).success,
    ).toBe(true);
    expect(
      UpdateArtifactRequest.safeParse({
        ...base,
        contentFormat: "json",
        content: oversizedObject,
      }).success,
    ).toBe(false);
  });

  it.each([
    { baseRevision: 1 },
    { baseRevision: 1, contentFormat: "markdown" },
    { baseRevision: 1, content: "# Missing format" },
    { baseRevision: 1, contentFormat: "markdown", content: null },
    {
      baseRevision: 1,
      contentFormat: "markdown",
      content: "# Ambiguous",
      status: "ready",
    },
    { baseRevision: 1, status: "ready", editorNote: "Not a revision note" },
  ])("rejects incomplete or ambiguous command %#", (body) => {
    expect(UpdateArtifactRequest.safeParse(body).success).toBe(false);
  });
});
