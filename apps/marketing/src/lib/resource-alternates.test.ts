// @input  -- resourceAlternates 与基础 metadata
// @output -- 回退页面 canonical / hreflang 归属规则的回归护栏
// @pos    -- 这条规则错了会把一个 UX 回退页变成与原页竞争的可索引重复页

import type { Metadata } from "next";
import { describe, expect, it } from "vitest";

import { resourceAlternates } from "./resource-alternates";

const BASE: Metadata = {
  title: "Example",
  openGraph: { title: "Example", url: "https://gengrowth.ai/zh/prompts/x" },
};

describe("resourceAlternates", () => {
  it("self-canonicalises when the route's own locale owns the file", () => {
    const result = resourceAlternates({
      metadata: BASE,
      locale: "en",
      owningLocale: "en",
      path: "/prompts/x",
      localesOwningFile: ["en"],
    });

    expect(result.alternates?.canonical).toBe(
      "https://gengrowth.ai/prompts/x",
    );
    expect(result.alternates?.languages).toEqual({
      en: "https://gengrowth.ai/prompts/x",
      "x-default": "https://gengrowth.ai/prompts/x",
    });
  });

  it("points a fallback route at the owning locale and drops its own hreflang", () => {
    // /zh/prompts/x serves English text. Claiming it as the Chinese version
    // would put two indexable URLs with the same body in front of Google.
    const result = resourceAlternates({
      metadata: BASE,
      locale: "zh",
      owningLocale: "en",
      path: "/prompts/x",
      localesOwningFile: ["en"],
    });

    expect(result.alternates?.canonical).toBe(
      "https://gengrowth.ai/prompts/x",
    );
    expect(result.alternates?.languages).not.toHaveProperty("zh");
    expect(result.openGraph?.url).toBe("https://gengrowth.ai/prompts/x");
  });

  it("claims both locales once both own a file", () => {
    const result = resourceAlternates({
      metadata: BASE,
      locale: "zh",
      owningLocale: "zh",
      path: "/prompts/x",
      localesOwningFile: ["en", "zh"],
    });

    expect(result.alternates?.canonical).toBe(
      "https://gengrowth.ai/zh/prompts/x",
    );
    expect(result.alternates?.languages).toEqual({
      en: "https://gengrowth.ai/prompts/x",
      zh: "https://gengrowth.ai/zh/prompts/x",
      "x-default": "https://gengrowth.ai/prompts/x",
    });
  });

  it("never points x-default at a locale with no file", () => {
    // A Chinese-only resource has no English URL to offer as the default.
    const result = resourceAlternates({
      metadata: BASE,
      locale: "zh",
      owningLocale: "zh",
      path: "/prompts/only-zh",
      localesOwningFile: ["zh"],
    });

    expect(result.alternates?.languages).toEqual({
      zh: "https://gengrowth.ai/zh/prompts/only-zh",
      "x-default": "https://gengrowth.ai/zh/prompts/only-zh",
    });
  });
});
