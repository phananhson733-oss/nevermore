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
import {
  HTML_BYTES as SHARED_HTML_BYTES,
  readsAsClientRendered,
} from "@sf/public-tools/seo-audit/page-shape-thresholds";

/** Below this a page is close to an island; above it, links are not the issue. */
export const INTERNAL_LINK_FLOOR = 3;
/** Reviewed working bounds for a static HTML document, in bytes. */
/** Shared with the Agent catalogue so the two surfaces cannot disagree. */
export { HTML_BYTES, SCRIPT_DOMINANCE } from "@sf/public-tools/seo-audit/page-shape-thresholds";
/** Server response time for the HTML itself, in milliseconds. */
export const RESPONSE_MS = { fast: 600, slow: 1_500 } as const;
/** Reviewed URL shape. Neither is a ranking factor; both are legibility. */
export const URL_PATH = { maxChars: 100, maxSegments: 5 } as const;

/**
 * Smallest declared edge that could plausibly be the image a reader came for.
 *
 * Shared with the Agent catalogue's 5.4 so the two surfaces cannot give
 * different verdicts about the same image.
 */
const LEAD_IMAGE_MIN_EDGE = 200;

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
  if (images.total > 0) {
    const missing = images.total - images.withDimensions;
    checks.push(
      // Not a full fail: an aspect-ratio rule in CSS reserves the same box, and
      // this check cannot see stylesheets. What it can say is that the markup
      // alone does not reserve it.
      missing === 0
        ? check(
            "imageDimensions",
            "media",
            "pass",
            2,
            2,
            "imageDimensions.all",
            { total: images.total },
          )
        : check(
            "imageDimensions",
            "media",
            "warn",
            1,
            2,
            "imageDimensions.some",
            { total: images.total, missing },
          ),
      // The count alone still cannot be graded — a page with nine lazy images
      // below the fold is doing the right thing. What CAN be graded is the
      // first image when the markup declares a size large enough for it to be
      // the one the reader came for: lazy-loading that delays the very paint
      // the visitor is waiting for. A 32-pixel logo mark is the first image on
      // a large share of sites, so a size gate is what separates the two.
      images.first !== null &&
      images.first.lazyLoaded &&
      Math.max(images.first.width ?? 0, images.first.height ?? 0) >=
        LEAD_IMAGE_MIN_EDGE
        ? check("imageLoading", "media", "warn", 1, 3, "imageLoading.leadLazy", {
            width: images.first.width ?? 0,
            height: images.first.height ?? 0,
          })
        : images.lazyLoaded === 0
          ? observation("imageLoading", "media", "imageLoading.none", {
              total: images.total,
            })
          : observation("imageLoading", "media", "imageLoading.some", {
              total: images.total,
              lazy: images.lazyLoaded,
            }),
    );
  }

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

/**
 * URL shape, as a reader and a link-builder meet it.
 *
 * None of this ranks a page. A path someone can read aloud, type from memory
 * and recognise in a search result is worth a couple of points and nothing
 * more, which is why every finding here is a warn rather than a failure.
 */
function urlShapeCheck(url: string): OnPageCheck {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return observation("urlShape", "technical", "urlShape.unavailable");
  }
  const path = decodeURIComponent(parsed.pathname);
  const segments = path.split("/").filter(Boolean);
  const params = [...parsed.searchParams.keys()].length;
  // Ordered by how much each one costs a reader, because the message names the
  // first and counts the rest. Naming them all would mean interpolating a list
  // of English tokens into whichever language the report is written in. The
  // keys are written out rather than assembled, so one without wording shows
  // up in the source.
  const issues = [
    params > 2 ? "urlShape.parameters" : null,
    // Only the path: a host is case-insensitive, a path is not, and an
    // upper-case path segment is the one that produces two URLs for one page.
    path !== path.toLowerCase() ? "urlShape.uppercase" : null,
    segments.length > URL_PATH.maxSegments ? "urlShape.deep" : null,
    path.length > URL_PATH.maxChars ? "urlShape.long" : null,
    segments.some((segment) => segment.includes("_"))
      ? "urlShape.underscores"
      : null,
  ].filter((entry): entry is string => entry !== null);

  const shared = {
    segments: segments.length,
    characters: path.length,
    parameters: params,
  };
  const first = issues[0];
  return first === undefined
    ? check("urlShape", "technical", "pass", 3, 3, "urlShape.clean", shared)
    : check("urlShape", "technical", "warn", 1, 3, first, {
        ...shared,
        others: issues.length - 1,
      });
}

/**
 * Whether the copy is in the document or arrives with the JavaScript.
 *
 * Search engines do render JavaScript, so this is not a failure — it is a
 * dependency, and one that costs a crawl budget and a render queue that a
 * server-rendered page never pays. Both halves have to hold before it is
 * claimed: almost no text in the document, and a script payload several times
 * its size.
 */
function renderingCheck(
  declared: NonNullable<CheckInput["extract"]["declared"]>,
): OnPageCheck {
  const clientRendered = readsAsClientRendered(declared);
  const kb = (bytes: number): number => Math.round(bytes / 1024);
  return clientRendered
    ? check("rendering", "technical", "warn", 1, 3, "rendering.clientSide", {
        textBytes: declared.visibleTextBytes,
        scriptKb: kb(declared.scriptBytes),
      })
    : check("rendering", "technical", "pass", 3, 3, "rendering.serverSide", {
        textBytes: declared.visibleTextBytes,
        scriptKb: kb(declared.scriptBytes),
      });
}

/**
 * Whether the page can act on what a visitor came to do.
 *
 * An observation, never a verdict. A tool page whose calculator is mounted by
 * client JavaScript has no form in the transferred HTML, and calling that
 * "sends visitors elsewhere" would be a confident wrong answer about the very
 * pages this matters most for. What the static document shows is what it says.
 */
function demandCaptureCheck(
  declared: NonNullable<CheckInput["extract"]["declared"]>,
): OnPageCheck {
  const { interactive } = declared;
  const controls =
    interactive.forms +
    interactive.inputs +
    interactive.buttons +
    interactive.selects +
    interactive.textareas +
    interactive.canvases +
    interactive.media +
    interactive.iframes;
  return controls === 0
    ? observation("demandCapture", "content", "demandCapture.none")
    : observation("demandCapture", "content", "demandCapture.present", {
        controls,
        forms: interactive.forms,
        inputs: interactive.inputs + interactive.selects + interactive.textareas,
        buttons: interactive.buttons,
      });
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

  checks.push(urlShapeCheck(url));

  if (declared === null) {
    checks.push(
      observation("htmlSize", "technical", "declaredUnavailable"),
      observation("hreflang", "technical", "declaredUnavailable"),
      observation("rendering", "technical", "declaredUnavailable"),
      observation("demandCapture", "content", "declaredUnavailable"),
    );
    return checks;
  }

  checks.push(renderingCheck(declared), demandCaptureCheck(declared));

  const kb = Math.round(declared.htmlBytes / 1024);
  checks.push(
    declared.htmlBytes <= SHARED_HTML_BYTES.large
      ? check("htmlSize", "technical", "pass", 2, 2, "htmlSize.ok", { kb })
      : declared.htmlBytes <= SHARED_HTML_BYTES.huge
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
