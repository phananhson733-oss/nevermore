// @input  -- the checker's own checks beside the Agent catalogue they mirror
// @output -- proof the two surfaces read one definition and one verdict
// @pos    -- seam guard between the tool's score and the Agent's catalogue

import { describe, expect, it } from "vitest";
import {
  PAGE_AUDIT_GROUPS,
  SITE_AUDIT_GROUPS,
} from "@sf/public-tools/agent-audit";
import {
  readsAsClientRendered,
  BODY_UNITS as CATALOGUE_BODY_UNITS,
  HTML_BYTES as CATALOGUE_HTML_BYTES,
  SCRIPT_DOMINANCE as CATALOGUE_SCRIPT_DOMINANCE,
} from "@sf/public-tools/seo-audit/page-shape-thresholds";

import { BODY_UNITS, contentChecks, TEXT_RATIO_FLOOR } from "./checks-meta.ts";
import { technicalChecks } from "./checks-technical.ts";
import type { CheckInput } from "./check-types.ts";
import { HTML_BYTES, SCRIPT_DOMINANCE } from "./checks-technical.ts";

function input(
  bytes: number | { readonly visibleTextBytes: number; readonly scriptBytes: number },
  visibleTextBytes = 0,
): CheckInput {
  const declared =
    typeof bytes === "number"
      ? { htmlBytes: bytes, visibleTextBytes, scriptBytes: 0 }
      : { htmlBytes: 100_000, ...bytes };
  return build(declared);
}

function build(sizes: {
  readonly htmlBytes: number;
  readonly visibleTextBytes: number;
  readonly scriptBytes: number;
}): CheckInput {
  const declared = {
    ...sizes,
    lang: "en",
    openGraph: { title: null, description: null, image: null },
    twitterCard: null,
    viewport: "width=device-width",
    charset: "utf-8",
    faviconDeclared: true,
    hreflang: [],
    images: {
      total: 0,
      withAlt: 0,
      withEmptyAlt: 0,
      withoutAlt: 0,
      withDimensions: 0,
      lazyLoaded: 0,
      first: { lazyLoaded: false, width: null, height: null },
      sources: [],
    },
    externalLinks: { total: 0, nofollow: 0, blankWithoutNoopener: 0 },
    interactive: {
      forms: 1,
      inputs: 2,
      buttons: 1,
      selects: 0,
      textareas: 0,
      canvases: 0,
      media: 0,
      iframes: 0,
    },
  };
  return {
    targetUrl: "https://example.com/",
    evidence: null,
    siteResources: {} as CheckInput["siteResources"],
    siteRecords: [],
    extract: {
      url: "https://example.com/",
      title: "Title",
      metaDescription: "Description",
      h1: ["Heading"],
      subHeadings: ["Sub"],
      openingText: "Opening",
      staticBodyWords: 500,
      staticBodyUnits: { units: 500, basis: "words" },
      termFrequencies: null,
      truncatedLists: false,
      headingLevels: [1, 2],
      wordsUnderEachH3: [],
      response: {
        status: 200,
        finalStatus: 200,
        redirectHops: 0,
        responseMs: 100,
        contentType: "text/html; charset=utf-8",
        canonicalTarget: null,
        robotsIndexable: true,
        robotsDirectives: [],
        sitemapMember: true,
        jsonLdTypes: [],
        jsonLdErrorCount: 0,
        internalOutlinks: 5,
        internalOutlinksWithoutAnchorText: 0,
      } as never,
      declared: declared as never,
    } as unknown as CheckInput["extract"],
  };
}

describe("thresholds shared with the Agent catalogue", () => {
  it("reads one definition rather than a copy of each band", () => {
    // Identity, not equality: two objects that merely happen to match today
    // is exactly the state this replaced, and it drifts silently.
    expect(BODY_UNITS).toBe(CATALOGUE_BODY_UNITS);
    expect(HTML_BYTES).toBe(CATALOGUE_HTML_BYTES);
    expect(SCRIPT_DOMINANCE).toBe(CATALOGUE_SCRIPT_DOMINANCE);
  });

  it("gives the same verdict on both surfaces for the same page", () => {
    // The previous test only drove the shared function, so re-inlining the
    // rule in either caller would have left it green. This one drives the two
    // callers and compares them.
    const cases = [
      { visibleTextBytes: 100, scriptBytes: 30_000 },
      { visibleTextBytes: 5_000, scriptBytes: 30_000 },
      { visibleTextBytes: 100, scriptBytes: 200 },
    ];

    for (const facts of cases) {
      const checkerSaysClientRendered =
        technicalChecks(input(facts)).find((entry) => entry.id === "rendering")
          ?.detail.key === "rendering.clientSide";

      expect(checkerSaysClientRendered).toBe(readsAsClientRendered(facts));
    }
  });

  it("describes both halves of the client-rendering rule in the published threshold", () => {
    // The rule has two clauses and the catalogue used to publish only one, so
    // a reader was told a big bundle alone would draw the Tip. Pinned against
    // the behaviour rather than against the sentence: the fixture that must
    // NOT fire is exactly the case the missing clause covers.
    const check = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS]
      .flatMap((group) => group.checks)
      .find((entry) => entry.id === "8.7");

    expect(readsAsClientRendered({
      visibleTextBytes: 5_000,
      scriptBytes: 30_000,
    })).toBe(false);
    for (const locale of ["en", "zh"] as const) {
      // Whatever the wording, it has to mention the text-length half.
      expect(check?.threshold[locale]).toMatch(
        locale === "en" ? /visible text/i : /正文/,
      );
    }
    expect(check?.threshold.en).toMatch(/short on visible text/i);
    expect(check?.threshold.zh).toMatch(/可见正文偏少/);
  });

  it("applies one rule for client rendering, not one constant and two rules", () => {
    // Sharing SCRIPT_DOMINANCE was not enough: the checker required a short
    // page as well and the catalogue did not, so a page with plenty of visible
    // text and a big bundle passed on one surface and drew a Tip on the other.
    const long = { visibleTextBytes: 5_000, scriptBytes: 30_000 };
    const short = { visibleTextBytes: 100, scriptBytes: 30_000 };

    expect(readsAsClientRendered(long)).toBe(false);
    expect(readsAsClientRendered(short)).toBe(true);
  });

  it("shows the text ratio without grading it", () => {
    // 4.4 publishes "listed for review, not judged". Grading the same ratio
    // here made one measurement a defect on this surface and a neutral note
    // on the other, for the same page.
    const ratios = contentChecks(input(1_000, 20)).filter(
      (entry) => entry.id === "textRatio",
    );

    expect(ratios).toHaveLength(1);
    expect(ratios[0]?.state).toBe("info");
    expect(ratios[0]?.max).toBe(0);
    expect(ratios[0]?.score).toBe(0);
    // The measurement is still published, and still reads as low.
    expect(ratios[0]?.detail.key).toBe("textRatio.low");
    expect(TEXT_RATIO_FLOOR).toBeGreaterThan(0);
  });
});
