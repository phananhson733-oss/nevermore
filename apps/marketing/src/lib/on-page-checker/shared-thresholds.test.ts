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
import type { CheckInput } from "./check-types.ts";
import { HTML_BYTES, SCRIPT_DOMINANCE } from "./checks-technical.ts";

function input(htmlBytes: number, visibleTextBytes: number): CheckInput {
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
      response: {} as never,
      declared: { htmlBytes, visibleTextBytes } as never,
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
