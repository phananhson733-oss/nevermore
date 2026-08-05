import { describe, expect, it } from "vitest";
import { getMarketingRedirects } from "./next.config";

describe("marketing redirects", () => {
  const redirects = getMarketingRedirects();

  it("keeps the retired marketing app path from returning 404", () => {
    expect(redirects).toContainEqual({
      source: "/app",
      destination: "https://app.gengrowth.ai/",
      statusCode: 301,
    });
  });

  it.each([
    ["free-seo-consultation", "free-seo-company"],
    ["free-white-label-seo", "best-white-label-seo-tool"],
    ["marketing-attribution-for-saas", "marketing-attribution-models"],
    ["serankings", "serankings-alternative"],
  ])("redirects the retired %s slug in one hop", (source, destination) => {
    for (const prefix of ["", "/en"]) {
      expect(redirects).toContainEqual({
        source: `${prefix}/blog/${source}`,
        destination: `/blog/${destination}`,
        statusCode: 301,
      });
    }
  });
});
