import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";
import marketingConfig, { getMarketingRedirects } from "./next.config";
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
      destination: "/waitlist",
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
    ["/en/compare", "/blog#comparisons"],
    ["/en/tools/seo-audit", "/agents/seo"],
  ])(
    "sends the legacy hub %s straight to its final page",
    (source, destination) => {
      expect(redirects).toContainEqual({ source, destination, statusCode: 301 });
    },
  );

  it("leaves the legacy Internal Link Audit path to locale routing", () => {
    expect(
      redirects.some(
        (entry) => entry.source === "/en/tools/internal-link-audit",
      ),
    ).toBe(false);
  });

  it("implements every reviewed target override as an explicit one-hop redirect", () => {
    for (const entry of LEGACY_EN_MIGRATION_ENTRIES) {
      const strippedPath = entry.legacyPath.slice("/en".length) || "/";
      if (!entry.targetPath || entry.targetPath === strippedPath) continue;

      expect(redirects, entry.legacyPath).toContainEqual({
        source: entry.legacyPath,
        destination: entry.targetPath,
        statusCode: 301,
      });
    }
  });

  it.each([
    "/en/about",
    "/en/features",
    "/en/glossary",
    "/en/playbooks",
    "/en/templates",
    "/en/use-cases",
  ])("does not mask the proxy's 410 for %s with a redirect", (source) => {
    expect(redirects.some((entry) => entry.source === source)).toBe(false);
  });
});

describe("marketing config wrappers", () => {
  it("retains redirects, rewrites, and security headers after Workflow wrapping", async () => {
    const previousDirectory = process.cwd();
    process.chdir(fileURLToPath(new URL(".", import.meta.url)));
    let resolved: NextConfig;
    try {
      resolved =
        typeof marketingConfig === "function"
          ? await marketingConfig("phase-production-build", {
              defaultConfig: {},
            } as never)
          : marketingConfig;
    } finally {
      process.chdir(previousDirectory);
    }

    await expect(resolved.redirects?.()).resolves.toEqual(
      getMarketingRedirects(),
    );
    await expect(resolved.rewrites?.()).resolves.toEqual([
      { source: "/blog/rss.xml", destination: "/en/blog/rss.xml" },
    ]);
    const headers = await resolved.headers?.();
    expect(headers?.[0]?.source).toBe("/:path*");
    expect(headers?.[0]?.headers).toContainEqual({
      key: "X-Frame-Options",
      value: "DENY",
    });
  });
});
