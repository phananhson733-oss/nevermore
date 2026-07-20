import { describe, expect, it } from "vitest";
import { makePromptInput } from "./fixtures.ts";
import {
  buildTemplateArtifact,
  UnsupportedTemplateLocaleError,
} from "./index.ts";

describe("template artifact locale contract", () => {
  it.each([
    ["en", "## Objective"],
    ["EN", "## Objective"],
    ["zh-CN", "## 目标"],
    ["ZH-cn", "## 目标"],
  ])("accepts semantic template locale %s", (locale, expectedHeading) => {
    const artifact = buildTemplateArtifact(
      makePromptInput("content_brief", { outputLocale: locale }),
    );
    expect(artifact.content).toEqual(expect.stringContaining(expectedHeading));
  });

  it.each(["fr-FR", "zh-TW", "zh-HK", "zh-Hant", "en-US"])(
    "fails closed for unsupported template locale %s",
    (locale) => {
      expect(() =>
        buildTemplateArtifact(
          makePromptInput("content_brief", { outputLocale: locale }),
        ),
      ).toThrow(UnsupportedTemplateLocaleError);
    },
  );

  it("uses an actionable error that never echoes the rejected locale", () => {
    const rejectedLocale = "zh-Hant-customer-secret";
    try {
      buildTemplateArtifact(
        makePromptInput("content_brief", { outputLocale: rejectedLocale }),
      );
      expect.unreachable("unsupported template locale should throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "UNSUPPORTED_TEMPLATE_LOCALE",
        message: expect.stringContaining("structured_llm"),
      });
      expect(String(error)).not.toContain(rejectedLocale);
    }
  });
});
