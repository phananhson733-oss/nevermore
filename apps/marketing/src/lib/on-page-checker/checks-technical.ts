// @input  -- the crawl's HTTP journey, declared markup, and site resources
// @output -- the links, media, social and technical category checks
// @pos    -- the categories built from facts the crawl observed, not text
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  check,
  observation,
  type CheckInput,
  type OnPageCheck,
} from "./check-types.ts";

/** Below this a page is close to an island; above it, links are not the issue. */
export const INTERNAL_LINK_FLOOR = 3;
/** Reviewed working bounds for a static HTML document, in bytes. */
export const HTML_BYTES = { large: 200_000, huge: 500_000 } as const;
/** Server response time for the HTML itself, in milliseconds. */
export const RESPONSE_MS = { fast: 600, slow: 1_500 } as const;

export function linkChecks(input: CheckInput): readonly OnPageCheck[] {
  const { response, declared } = input.extract;
  const checks: OnPageCheck[] = [];

  const internal = response.internalOutlinks;
  checks.push(
    internal === 0
      ? check("internalLinks", "links", "fail", 0, 3, "internalLinks.none")
      : internal < INTERNAL_LINK_FLOOR
        ? check("internalLinks", "links", "warn", 1, 3, "internalLinks.few", {
            count: internal,
          })
        : check("internalLinks", "links", "pass", 3, 3, "internalLinks.ok", {
            count: internal,
          }),
  );

  if (internal === 0) {
    checks.push(
      observation("anchorText", "links", "anchorText.notApplicable"),
    );
  } else {
    const empty = response.internalOutlinksWithoutAnchorText;
    checks.push(
      empty === 0
        ? check("anchorText", "links", "pass", 3, 3, "anchorText.allDescribed", {
            count: internal,
          })
        : check("anchorText", "links", "warn", 1, 3, "anchorText.someEmpty", {
            empty,
            count: internal,
          }),
    );
  }

  if (declared === null) {
    checks.push(
      observation("externalLinks", "links", "declaredUnavailable"),
      observation("images", "media", "declaredUnavailable"),
      observation("openGraph", "social", "declaredUnavailable"),
      observation("twitterCard", "social", "declaredUnavailable"),
    );
    return checks;
  }

  const external = declared.externalLinks;
  checks.push(
    external.total === 0
      ? observation("externalLinks", "links", "externalLinks.none")
      : observation("externalLinks", "links", "externalLinks.present", {
          count: external.total,
          nofollow: external.nofollow,
        }),
    // `rel=noreferrer` implies noopener, and the crawler counts it as safe.
    external.blankWithoutNoopener === 0
      ? check("linkSafety", "links", "pass", 1, 1, "linkSafety.ok")
      : check("linkSafety", "links", "warn", 0, 1, "linkSafety.unsafe", {
          count: external.blankWithoutNoopener,
        }),
  );

  const images = declared.images;
  if (images.total === 0) {
    checks.push(observation("images", "media", "images.none"));
  } else if (images.withoutAlt === 0) {
    checks.push(
      check("images", "media", "pass", 5, 5, "images.allDescribed", {
        total: images.total,
        decorative: images.withEmptyAlt,
      }),
    );
  } else {
    const described = images.total - images.withoutAlt;
    checks.push(
      check("images", "media", "warn", 2, 5, "images.someMissingAlt", {
        total: images.total,
        missing: images.withoutAlt,
        described,
      }),
    );
  }

  const og = declared.openGraph;
  const ogComplete =
    og.title !== null && og.description !== null && og.image !== null;
  const ogPartial = og.title !== null || og.description !== null || og.image !== null;
  checks.push(
    ogComplete
      ? check("openGraph", "social", "pass", 4, 4, "openGraph.complete")
      : ogPartial
        ? check("openGraph", "social", "warn", 2, 4, "openGraph.partial", {
            missing: [
              og.title === null ? "og:title" : null,
              og.description === null ? "og:description" : null,
              og.image === null ? "og:image" : null,
            ]
              .filter((entry): entry is string => entry !== null)
              .join(", "),
          })
        : check("openGraph", "social", "fail", 0, 4, "openGraph.missing"),
    declared.twitterCard === null
      ? check("twitterCard", "social", "warn", 0, 2, "twitterCard.missing")
      : check("twitterCard", "social", "pass", 2, 2, "twitterCard.declared", {
          card: declared.twitterCard,
        }),
  );

  return checks;
}

export function technicalChecks(input: CheckInput): readonly OnPageCheck[] {
  const { response, declared, url } = input.extract;
  const checks: OnPageCheck[] = [];

  const isHttps = url.startsWith("https://");
  checks.push(
    isHttps
      ? check("https", "technical", "pass", 3, 3, "https.enabled")
      : check("https", "technical", "fail", 0, 3, "https.absent"),
  );

  if (response.finalStatus === null) {
    checks.push(observation("status", "technical", "status.unavailable"));
  } else if (response.finalStatus >= 400) {
    checks.push(
      check("status", "technical", "fail", 0, 3, "status.error", {
        status: response.finalStatus,
      }),
    );
  } else if (response.redirectHops > 0) {
    checks.push(
      check("status", "technical", "warn", 1, 3, "status.redirected", {
        status: response.finalStatus,
        hops: response.redirectHops,
      }),
    );
  } else {
    checks.push(
      check("status", "technical", "pass", 3, 3, "status.direct", {
        status: response.finalStatus,
      }),
    );
  }

  if (response.responseMs === null) {
    checks.push(observation("responseTime", "technical", "responseTime.unavailable"));
  } else if (response.responseMs <= RESPONSE_MS.fast) {
    checks.push(
      check("responseTime", "technical", "pass", 3, 3, "responseTime.fast", {
        ms: response.responseMs,
      }),
    );
  } else if (response.responseMs <= RESPONSE_MS.slow) {
    checks.push(
      check("responseTime", "technical", "warn", 2, 3, "responseTime.fair", {
        ms: response.responseMs,
      }),
    );
  } else {
    checks.push(
      check("responseTime", "technical", "warn", 0, 3, "responseTime.slow", {
        ms: response.responseMs,
      }),
    );
  }

  const jsonLdTypes = response.jsonLdTypes;
  // Errors first: a page whose only JSON-LD block fails to parse yields zero
  // types AND an error, and reporting "none" there hides a broken block behind
  // the same sentence as a page that never had one.
  if (response.jsonLdErrorCount > 0 && jsonLdTypes.length === 0) {
    checks.push(
      check("jsonLd", "social", "warn", 1, 4, "jsonLd.allMalformed", {
        errors: response.jsonLdErrorCount,
      }),
    );
  } else if (jsonLdTypes.length === 0) {
    checks.push(check("jsonLd", "social", "warn", 0, 4, "jsonLd.none"));
  } else if (response.jsonLdErrorCount > 0) {
    checks.push(
      check("jsonLd", "social", "warn", 2, 4, "jsonLd.malformed", {
        types: jsonLdTypes.join(", "),
        errors: response.jsonLdErrorCount,
      }),
    );
  } else {
    checks.push(
      check("jsonLd", "social", "pass", 4, 4, "jsonLd.valid", {
        types: jsonLdTypes.join(", "),
        count: jsonLdTypes.length,
      }),
    );
  }

  const { siteResources } = input;
  checks.push(
    siteResources.robotsFetched
      ? check("robotsTxt", "technical", "pass", 2, 2, "robotsTxt.reachable", {
          groups: siteResources.robotsGroupsObserved,
        })
      : check("robotsTxt", "technical", "warn", 0, 2, "robotsTxt.unreachable"),
    siteResources.sitemapFetched
      ? check("sitemap", "technical", "pass", 2, 2, "sitemap.reachable", {
          references: siteResources.sitemapReferencesObserved,
        })
      : check("sitemap", "technical", "warn", 0, 2, "sitemap.unreachable"),
    response.sitemapMember
      ? check("sitemapMember", "technical", "pass", 2, 2, "sitemapMember.listed")
      : check(
          "sitemapMember",
          "technical",
          "warn",
          0,
          2,
          siteResources.sitemapFetched
            ? "sitemapMember.absent"
            : "sitemapMember.noSitemap",
        ),
  );

  if (declared === null) {
    checks.push(
      observation("htmlSize", "technical", "declaredUnavailable"),
      observation("hreflang", "technical", "declaredUnavailable"),
    );
    return checks;
  }

  const kb = Math.round(declared.htmlBytes / 1024);
  checks.push(
    declared.htmlBytes <= HTML_BYTES.large
      ? check("htmlSize", "technical", "pass", 2, 2, "htmlSize.ok", { kb })
      : declared.htmlBytes <= HTML_BYTES.huge
        ? check("htmlSize", "technical", "warn", 1, 2, "htmlSize.large", { kb })
        : check("htmlSize", "technical", "warn", 0, 2, "htmlSize.huge", { kb }),
    // Not scored: a single-language site is complete without hreflang, and
    // marking one down would be judging a decision rather than an oversight.
    declared.hreflang.length === 0
      ? observation("hreflang", "technical", "hreflang.none")
      : observation("hreflang", "technical", "hreflang.declared", {
          tags: declared.hreflang.join(", "),
          count: declared.hreflang.length,
        }),
  );

  return checks;
}
