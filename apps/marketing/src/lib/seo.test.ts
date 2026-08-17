// @input  -- page metadata inputs, including a cross-canonical override
// @output -- assertions that a consolidated page points every URL at its canonical
// @pos    -- covers the metadata half of the Tech Agent consolidation

import { describe, expect, it } from "vitest";

import { generatePageMetadata } from "./seo.ts";

const base = {
  title: "Technical SEO Agent",
  description: "Crawl, indexability and internal links.",
};

describe("generatePageMetadata", () => {
  it("is self-canonical by default", () => {
    const metadata = generatePageMetadata({
      ...base,
      locale: "en",
      path: "/agents/seo",
    });

    expect(metadata.alternates?.canonical).toBe(
      "https://gengrowth.ai/agents/seo",
    );
  });

  it("points a consolidated page at its canonical target", () => {
    const metadata = generatePageMetadata({
      ...base,
      locale: "en",
      path: "/agents/tech",
      canonicalPath: "/agents/seo",
    });

    expect(metadata.alternates?.canonical).toBe(
      "https://gengrowth.ai/agents/seo",
    );
  });

  it("keeps the canonical target inside the visitor's locale", () => {
    const metadata = generatePageMetadata({
      ...base,
      locale: "zh",
      path: "/agents/tech",
      canonicalPath: "/agents/seo",
    });

    expect(metadata.alternates?.canonical).toBe(
      "https://gengrowth.ai/zh/agents/seo",
    );
  });

  it("moves the alternates and the social URL with the canonical", () => {
    // A cluster that advertises the consolidated URL in hreflang or og:url
    // while pointing rel=canonical elsewhere gives two different answers to
    // the same question.
    const metadata = generatePageMetadata({
      ...base,
      locale: "en",
      path: "/agents/tech",
      canonicalPath: "/agents/seo",
    });

    expect(metadata.alternates?.languages).toEqual({
      en: "https://gengrowth.ai/agents/seo",
      zh: "https://gengrowth.ai/zh/agents/seo",
      "x-default": "https://gengrowth.ai/agents/seo",
    });
    expect(metadata.openGraph?.url).toBe("https://gengrowth.ai/agents/seo");
  });
});
