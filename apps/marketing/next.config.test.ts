import { describe, expect, it } from "vitest";
import { getMarketingRedirects } from "./next.config";
import { LEGACY_EN_MIGRATION_ENTRIES } from "./src/lib/legacy-en-migration";

describe("marketing redirects", () => {
  const redirects = getMarketingRedirects();

  it("never sends a visitor to a path that redirects again", () => {
    // Every test below asserts that an old→new pair is present, which is not
    // the same as the hop being the last one. A later rename that redirects
    // one of these destinations turns each of them into two hops, and nothing
    // else in this file would notice.
    const sources = new Set(redirects.map((entry) => entry.source));
    for (const entry of redirects) {
      expect(
        sources,
        `${entry.source} lands on ${entry.destination}, which redirects again`,
      ).not.toContain(entry.destination);
    }
  });

  it("keeps the retired marketing app path from returning 404", () => {
    expect(redirects).toContainEqual({
      source: "/app",
      destination: "https://app.gengrowth.ai/",
      statusCode: 301,
    });
  });

  // The tool page moved after it shipped, so the old slug is live in whatever
  // already links to it. zh is listed separately because /tools/* is a real zh
  // route: folding it onto the default-locale destination would drop the
  // visitor's language, which the blog redirects below never have to consider.
  it.each([
    ["", "/tools/low-competition-keywords"],
    ["/en", "/tools/low-competition-keywords"],
    ["/zh", "/zh/tools/low-competition-keywords"],
  ])(
    "sends %s/tools/hidden-keywords to its new slug in one hop",
    (prefix, destination) => {
      expect(redirects).toContainEqual({
        source: `${prefix}/tools/hidden-keywords`,
        destination,
        statusCode: 301,
      });
    },
  );

  it.each([
    ["free-seo-consultation", "free-seo-company"],
    ["free-white-label-seo", "best-white-label-seo-tool"],
    ["marketing-attribution-for-saas", "marketing-attribution-models"],
    ["serankings", "serankings-alternative"],
    ["astrologywiki-zero-to-5000-users", "astrologywiki-case-study"],
  ])("redirects the retired %s slug in one hop", (source, destination) => {
    for (const prefix of ["", "/en"]) {
      expect(redirects).toContainEqual({
        source: `${prefix}/blog/${source}`,
        destination: `/blog/${destination}`,
        statusCode: 301,
      });
    }
  });

  it.each([
    ["/en/features", "/pricing"],
    ["/en/about", "/pricing"],
    ["/en/templates", "/blog"],
    ["/en/compare", "/blog#comparisons"],
    ["/en/use-cases", "/blog"],
    ["/en/playbooks", "/blog"],
    ["/en/glossary", "/blog"],
    ["/en/tools/seo-audit", "/agents/seo"],
    ["/en/tools/internal-link-audit", "/agents/tech"],
  ])(
    "sends the legacy hub %s straight to its final page",
    (source, destination) => {
      expect(redirects).toContainEqual({ source, destination, statusCode: 301 });
    },
  );

  it("implements every reviewed target override as an explicit one-hop redirect", () => {
    for (const entry of LEGACY_EN_MIGRATION_ENTRIES) {
      const strippedPath = entry.legacyPath.slice("/en".length) || "/";
      if (entry.targetPath === strippedPath) continue;

      expect(redirects, entry.legacyPath).toContainEqual({
        source: entry.legacyPath,
        destination: entry.targetPath,
        statusCode: 301,
      });
    }
  });
});
