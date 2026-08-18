import { describe, expect, it } from "vitest";
import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import type {
  SeoAuditRecord,
  SeoAuditTargetPageExtract,
} from "@sf/public-tools/seo-audit/types";
import {
  buildOnPageScore,
  SCORE_CAP_REASONS,
  type ScoreCap,
} from "./scoring.ts";

function extract(
  overrides: Partial<SeoAuditTargetPageExtract> = {},
): SeoAuditTargetPageExtract {
  return {
    url: "https://acme.test/pricing",
    title: "Acme pricing plans and what each one includes",
    metaDescription:
      "Compare Acme pricing plans, what each tier includes, and which one fits a team of your size.",
    h1: ["Acme pricing"],
    subHeadings: ["What each plan includes", "Which plan fits"],
    openingText: "Acme pricing starts with a free tier.",
    staticBodyWords: 1_400,
    staticBodyUnits: { units: 1_400, basis: "words" },
    termFrequencies: null,
    truncatedLists: false,
    response: {
      status: 200,
      finalStatus: 200,
      redirectHops: 0,
      responseMs: 120,
      contentType: "text/html; charset=utf-8",
      canonicalTarget: "https://acme.test/pricing",
      robotsIndexable: true,
      robotsDirectives: [],
      sitemapMember: true,
      jsonLdTypes: ["WebPage"],
      jsonLdErrorCount: 0,
      internalOutlinks: 12,
      internalOutlinksWithoutAnchorText: 0,
    },
    declared: {
      lang: "en",
      openGraph: {
        title: "Acme pricing",
        description: "Compare plans.",
        image: "https://acme.test/card.png",
      },
      twitterCard: "summary_large_image",
      viewport: "width=device-width, initial-scale=1",
      charset: "utf-8",
      faviconDeclared: true,
      hreflang: [],
      images: {
      total: 3,
      withAlt: 3,
      withEmptyAlt: 0,
      withoutAlt: 0,
      withDimensions: 0,
      lazyLoaded: 0,
    },
      externalLinks: { total: 2, nofollow: 1, blankWithoutNoopener: 0 },
      htmlBytes: 40_000,
      visibleTextBytes: 12_000,
      scriptBytes: 0,
      interactive: {
        forms: 0,
        inputs: 0,
        buttons: 0,
        selects: 0,
        textareas: 0,
        canvases: 0,
        media: 0,
        iframes: 0,
      },
    },
    ...overrides,
  };
}

function evidence(
  overrides: {
    readonly covered?: number;
    readonly applicable?: number;
    readonly densityValue?: number | null;
  } = {},
): KeywordEvidence {
  const covered = overrides.covered ?? 6;
  const applicable = overrides.applicable ?? 6;
  const state = (index: number) => (index < covered ? "covered" : "not_covered");
  return {
    availability: "available",
    version: "keyword_evidence.v1",
    textUnitsVersion: "text_units.v1",
    pageRole: "product",
    focus: { covered, applicable },
    limitations: [],
    queries: [
      {
        displayQuery: "acme pricing",
        isPrimary: true,
        primaryReason: "most_fields_covered",
        brandCandidate: "not_matched",
        tokenization: { kind: "whitespace", tokens: ["acme", "pricing"] },
        capturedOccurrences: 8,
        density:
          overrides.densityValue === null
            ? null
            : {
                value: overrides.densityValue ?? 0.012,
                basis: "captured_text",
                unitsBasis: "words",
                numeratorUnits: 8,
                denominatorUnits: 660,
              },
        slots: {
          title: { state: state(0), occurrences: 1 },
          description: { state: state(1), occurrences: 1 },
          h1: { state: state(2), occurrences: 1 },
          subHeadings: { state: state(3), occurrences: 2 },
          openingText: { state: state(4), occurrences: 1 },
          url: { state: state(5) },
        },
      },
    ],
  } as unknown as KeywordEvidence;
}

const SITE_RESOURCES = {
  robotsFetched: true,
  robotsGroupsObserved: 3,
  sitemapReferencesObserved: 1,
  sitemapFetched: true,
} as const;

function record(
  id: string,
  overrides: Partial<SeoAuditRecord> = {},
): SeoAuditRecord {
  return {
    id,
    category: "indexability",
    state: "observed",
    unit: "page",
    population: "every_collected_page",
    targetTested: null,
    tested: 120,
    affected: 0,
    observations: [],
    limitation: null,
    ...overrides,
  } as unknown as SeoAuditRecord;
}

function score(
  overrides: {
    readonly extract?: Partial<SeoAuditTargetPageExtract>;
    readonly evidence?: KeywordEvidence;
    readonly siteRecords?: readonly SeoAuditRecord[];
  } = {},
) {
  return buildOnPageScore({
    extract: extract(overrides.extract),
    evidence: overrides.evidence ?? evidence(),
    siteResources: SITE_RESOURCES,
    siteRecords: overrides.siteRecords ?? [],
  });
}

describe("buildOnPageScore", () => {
  it("scores a well-built page in the top band", () => {
    const result = score();

    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A");
    expect(result.caps).toEqual([]);
    expect(result.counts.fail).toBe(0);
  });

  it("counts every graded check and leaves observations out of the denominator", () => {
    const result = score();

    const gradedMax = result.checks
      .filter((entry) => entry.max > 0)
      .reduce((total, entry) => total + entry.max, 0);
    expect(result.available).toBe(gradedMax);
    // Observations are shown but never scored, so an unscored fact cannot move
    // the number in either direction.
    expect(
      result.checks.filter((entry) => entry.state === "info" && entry.score > 0),
    ).toEqual([]);
  });

  it("holds a page that is not about the keyword below the structure it has", () => {
    // Flawless markup, but the keyword appears in one field out of six.
    const result = score({ evidence: evidence({ covered: 1 }) });

    expect(result.caps.map((cap) => cap.reason)).toEqual(["topic_focus"]);
    expect(result.score).toBeLessThanOrEqual(45);
    expect(result.topicFocus).toBeCloseTo(1 / 6, 5);
  });

  it("holds a thin page down however good the rest of the sheet is", () => {
    const result = score({
      extract: {
        staticBodyWords: 120,
        staticBodyUnits: { units: 120, basis: "words" },
        termFrequencies: null,
      },
    });

    expect(result.caps.map((cap) => cap.reason)).toContain("body_words");
    expect(result.score).toBeLessThanOrEqual(55);
  });

  it("applies the lowest ceiling when both caps bite", () => {
    const result = score({
      extract: {
        staticBodyWords: 90,
        staticBodyUnits: { units: 90, basis: "words" },
        termFrequencies: null,
      },
      evidence: evidence({ covered: 0 }),
    });

    expect(result.caps).toHaveLength(2);
    expect(result.score).toBe(25);
  });

  it("does not record a cap that did not bite", () => {
    // A page already at or under the ceiling was not "capped at 45"; recording
    // one would tell the visitor a rule bit when nothing about the score moved.
    // 500 words puts this page in the band whose ceiling is 75, and the rest of
    // the sheet lands exactly on it. The boundary is the point: a ceiling equal
    // to the score took nothing away, so it is not reported as having bitten.
    const base = extract();
    const result = score({
      extract: {
        title: null,
        metaDescription: null,
        h1: [],
        subHeadings: [],
        staticBodyWords: 500,
        staticBodyUnits: { units: 500, basis: "words" },
        termFrequencies: null,
        declared: null,
        // Deliberately still indexable and still 200: those are their own
        // ceilings now, and this case is about a ceiling that does NOT bite.
        response: {
          ...base.response,
          canonicalTarget: null,
          jsonLdTypes: [],
          internalOutlinks: 0,
          sitemapMember: false,
          responseMs: 4_000,
        },
      },
    });

    expect(result.score).toBeLessThan(75);
    expect(result.caps).toEqual([]);
  });

  it("reports unknown markup as unknown rather than as a page with none", () => {
    const result = score({ extract: { declared: null } });

    const declaredChecks = result.checks.filter(
      (entry) => entry.detail.key === "declaredUnavailable",
    );
    expect(declaredChecks.length).toBeGreaterThan(0);
    // Every one of them is an observation: a fact we did not collect must not
    // be scored as a fact the page failed.
    expect(declaredChecks.every((entry) => entry.max === 0)).toBe(true);
    expect(result.counts.fail).toBe(0);
  });

  it("reads absence from a site-wide rule as a pass only when the rule tested every page", () => {
    const conditional = score({
      siteRecords: [
        record("title_duplicate", { population: "conditional_subset" }),
      ],
    });
    const everyPage = score({ siteRecords: [record("title_duplicate")] });

    // A rule that tested a qualifying subset says nothing about a page that
    // never qualified — absence there is not evidence of passing.
    expect(
      conditional.checks.find((entry) => entry.id === "title_duplicate")?.state,
    ).toBe("info");
    expect(
      everyPage.checks.find((entry) => entry.id === "title_duplicate")?.state,
    ).toBe("pass");
  });

  it("fails a site-wide rule that named this page", () => {
    const result = score({
      siteRecords: [
        record("title_duplicate", {
          affected: 4,
          observations: [{ url: "https://acme.test/pricing", values: [] }],
        }),
      ],
    });

    const entry = result.checks.find((item) => item.id === "title_duplicate");
    expect(entry?.state).toBe("fail");
    expect(entry?.score).toBe(0);
  });

  it("matches a flagged page across a trailing-slash difference", () => {
    const result = score({
      siteRecords: [
        record("title_duplicate", {
          affected: 2,
          observations: [{ url: "https://acme.test/pricing/", values: [] }],
        }),
      ],
    });

    expect(
      result.checks.find((item) => item.id === "title_duplicate")?.state,
    ).toBe("fail");
  });

  it("scores nothing rather than everything when nothing could be graded", () => {
    const result = buildOnPageScore({
      extract: extract(),
      evidence: { availability: "unavailable", reason: "extract_missing" } as
        unknown as KeywordEvidence,
      siteResources: SITE_RESOURCES,
      siteRecords: [],
    });

    // The keyword category drops out entirely; the rest still grades.
    expect(result.available).toBeGreaterThan(0);
    expect(result.topicFocus).toBeNull();
  });

  it("marks a noindex page as a failure rather than a warning", () => {
    const result = score({
      extract: {
        response: { ...extract().response, robotsIndexable: false },
      },
    });

    const robots = result.checks.find((entry) => entry.id === "robots");
    expect(robots?.state).toBe("fail");
    expect(robots?.score).toBe(0);
  });
});

/**
 * Every branch that can reach the screen must have wording for it.
 *
 * next-intl renders a missing key as its own dotted path and throws nothing, so
 * a cap the visitor actually hits shows up as literal
 * `tools.onPageChecker.score.caps.not_indexable`. A render test only covers the
 * caps a fixture happens to trigger; this walks the union itself, so a cap
 * added later fails here rather than in front of someone.
 */
describe("score cap wording", () => {
  // Read from the module rather than restated here: a second list agrees with
  // itself and falls behind the union it was copied from.
  const ALL_CAPS: readonly ScoreCap[] = SCORE_CAP_REASONS;

  it.each(["en", "zh"])("%s carries a sentence for every cap reason", async (locale) => {
    const catalogue = (await import(`../../i18n/messages/${locale}.json`, {
      with: { type: "json" },
    })) as unknown as { default: Record<string, never> };
    const caps = (
      catalogue.default as unknown as {
        tools: { onPageChecker: { score: { caps: Record<string, string> } } };
      }
    ).tools.onPageChecker.score.caps;

    for (const cap of ALL_CAPS) {
      expect(caps[cap], `missing wording for cap "${cap}" in ${locale}`).toBeTypeOf(
        "string",
      );
      // The ceiling is the whole point of the sentence; a cap that does not say
      // what it capped to is not an explanation.
      expect(caps[cap]).toContain("{ceiling}");
    }
    // And nothing stale: a reason removed from the union must lose its wording.
    expect(Object.keys(caps).sort()).toEqual([...ALL_CAPS].sort());
  });
});

/**
 * Verdicts that were confidently wrong before review.
 *
 * Each of these scored in the nineties on a page no one should be told is good.
 * The weighted sum could not express them: each failure is worth a few points
 * against a hundred, so failing one still left an A.
 */
describe("verdicts a weighted sum cannot express", () => {
  it("does not grade a 404 page as excellent", () => {
    const r = score({
      extract: {
        response: { ...extract().response, status: 404, finalStatus: 404 },
      },
    });

    expect(r.caps.map((cap) => cap.reason)).toContain("not_reachable");
    expect(r.grade).not.toBe("A");
    expect(r.score).toBeLessThanOrEqual(20);
  });

  it("does not grade a noindex page as excellent", () => {
    const r = score({
      extract: {
        response: { ...extract().response, robotsIndexable: false },
      },
    });

    expect(r.caps.map((cap) => cap.reason)).toContain("not_indexable");
    expect(r.grade).not.toBe("A");
  });

  it("holds a page whose keywords could not be measured", () => {
    // Previously this REMOVED the largest category from the denominator, so the
    // page scored 100 — higher than it would have with its keywords measured.
    const r = score({
      evidence: {
        availability: "unavailable",
        reason: "extract_missing",
      } as unknown as KeywordEvidence,
    });

    expect(r.caps.map((cap) => cap.reason)).toContain("keyword_unmeasured");
    expect(r.score).toBeLessThanOrEqual(60);
  });

  it("holds a thin page whose language cannot be counted in words", () => {
    const r = score({
      extract: {
        staticBodyWords: null,
        staticBodyUnits: null,
        termFrequencies: null,
        declared: { ...extract().declared!, visibleTextBytes: 300 },
      },
    });

    expect(r.caps.map((cap) => cap.reason)).toContain("body_bytes");
    expect(r.score).toBeLessThanOrEqual(35);
  });

  it("does not cap on words and bytes at once", () => {
    // One body, one measure. Capping twice would be two verdicts on one fact.
    const r = score({
      extract: {
        staticBodyWords: 50,
        staticBodyUnits: { units: 50, basis: "words" },
        termFrequencies: null,
      },
    });

    const reasons = r.caps.map((cap) => cap.reason);
    expect(reasons).toContain("body_words");
    expect(reasons).not.toContain("body_bytes");
  });

  it("does not lower the score just because more queries were submitted", () => {
    // Topic focus is the PRIMARY query's coverage. Summing across every query
    // meant adding exploratory words to the form capped an unchanged page.
    const onePerfect = score({ evidence: evidence({ covered: 6 }) });
    const samePagePlusFourStrays = buildOnPageScore({
      extract: extract(),
      evidence: {
        ...(evidence({ covered: 6 }) as unknown as Record<string, unknown>),
        // The panel's own summed count: 6 covered of 30 applicable.
        focus: { covered: 6, applicable: 30 },
      } as unknown as KeywordEvidence,
      siteResources: SITE_RESOURCES,
      siteRecords: [],
    });

    expect(samePagePlusFourStrays.score).toBe(onePerfect.score);
    expect(samePagePlusFourStrays.caps).toEqual([]);
  });

  it("publishes density without grading it", () => {
    const r = score();
    const density = r.checks.find((entry) => entry.id === "keyword.density");

    // The denominator is the region a keyword is meant to be dense in, so no
    // defensible band exists for it yet.
    expect(density?.max).toBe(0);
    expect(density?.state).toBe("info");
    // And the occurrence count must be the one the evidence table shows.
    expect(density?.detail.values?.["occurrences"]).toBe(8);
  });
});

/**
 * Checks that used to say something untrue, or nothing at all.
 *
 * Each of these was measured before the fix, either telling a visitor a fact
 * about their page that was false or withholding a verdict it was entitled to.
 */
describe("what the sheet can now say", () => {
  function find(result: ReturnType<typeof score>, id: string) {
    return result.checks.find((entry) => entry.id === id);
  }

  it("passes a conditional site rule the page was actually inside", () => {
    // Three of the five site rules test a qualifying subset, so absence used to
    // read as "that rule did not cover this page" — false for a page that
    // qualified and was clean, which is the ordinary case.
    const result = score({
      siteRecords: [
        record("title_duplicate", {
          category: "metadata",
          population: "conditional_subset",
          targetTested: true,
          state: "not_observed",
        }),
      ],
    });

    const entry = find(result, "title_duplicate");
    expect(entry?.state).toBe("pass");
    expect(entry?.detail.key).toBe("site.title_duplicate.clear");
  });

  it("still withholds a verdict when the page was outside the subset", () => {
    const result = score({
      siteRecords: [
        record("title_duplicate", {
          category: "metadata",
          population: "conditional_subset",
          targetTested: false,
          state: "not_observed",
        }),
      ],
    });

    expect(find(result, "title_duplicate")?.detail.key).toBe(
      "site.title_duplicate.notTested",
    );
  });

  it("accepts an encoding declared only in the response header", () => {
    // The header outranks the meta tag, and we were collecting it and reading
    // only the tag — marking pages down for a declaration they had made in the
    // stronger place.
    const result = score({
      extract: {
        declared: { ...extract().declared!, charset: null },
        response: {
          ...extract().response,
          contentType: "text/html; charset=UTF-8",
        },
      },
    });

    const entry = find(result, "charset");
    expect(entry?.state).toBe("pass");
    expect(entry?.detail.key).toBe("charset.fromHeader");
    expect(entry?.detail.values?.charset).toBe("utf-8");
  });

  it("grades a Chinese page's length instead of exempting it", () => {
    // `staticBodyWords` is withheld for a body written without word gaps, which
    // used to remove the thin-content ceiling entirely: a hundred-character
    // Chinese page scored 100.
    const thin = score({
      extract: {
        staticBodyWords: null,
        staticBodyUnits: { units: 90, basis: "cjk_chars" },
        termFrequencies: null,
      },
    });
    expect(thin.caps.map((cap) => cap.reason)).toContain("body_words");
    expect(find(thin, "bodyWords")?.detail.key).toBe("bodyWords.thinUnits");

    const full = score({
      extract: {
        staticBodyWords: null,
        staticBodyUnits: { units: 2_000, basis: "cjk_chars" },
        termFrequencies: null,
      },
    });
    expect(full.caps).toEqual([]);
    expect(find(full, "bodyWords")?.state).toBe("pass");
  });

  it("judges the H1 by its length as well as its count", () => {
    expect(find(score({ extract: { h1: ["Pricing"] } }), "h1")?.detail.key).toBe(
      "h1.tooShort",
    );
    expect(
      find(score({ extract: { h1: ["A".repeat(90)] } }), "h1")?.detail.key,
    ).toBe("h1.tooLong");
    // Cut to 200 characters upstream, so the width shown is the cut one and the
    // copy has to say so. The verdict is unaffected: 200 is past the bound
    // whichever way the real heading ran.
    expect(
      find(
        score({ extract: { h1: ["A".repeat(200)], truncatedLists: true } }),
        "h1",
      )?.detail.key,
    ).toBe("h1.tooLongClipped");
  });

  it("names the first URL problem and counts the rest", () => {
    const clean = score({ extract: { url: "https://acme.test/pricing" } });
    expect(find(clean, "urlShape")?.detail.key).toBe("urlShape.clean");

    const messy = score({
      extract: {
        url: "https://acme.test/A/b/c/d/e/f/Some_Long_Name?a=1&b=2&c=3",
      },
    });
    const entry = find(messy, "urlShape");
    // Query parameters come first because they cost a reader the most.
    expect(entry?.detail.key).toBe("urlShape.parameters");
    expect(entry?.detail.values?.others).toBe(3);
  });

  it("separates a document that ships its content from one that ships a program", () => {
    const server = score();
    expect(find(server, "rendering")?.detail.key).toBe("rendering.serverSide");

    const client = score({
      extract: {
        declared: {
          ...extract().declared!,
          visibleTextBytes: 120,
          scriptBytes: 800_000,
        },
      },
    });
    expect(find(client, "rendering")?.detail.key).toBe("rendering.clientSide");
  });

  it("reports interactive elements without claiming a page has none", () => {
    const none = score();
    const quiet = find(none, "demandCapture");
    expect(quiet?.detail.key).toBe("demandCapture.none");
    // An observation, never a verdict: a calculator mounted by client
    // JavaScript is not in the HTML and would be judged absent.
    expect(quiet?.max).toBe(0);

    const active = score({
      extract: {
        declared: {
          ...extract().declared!,
          interactive: {
            forms: 1,
            inputs: 3,
            buttons: 1,
            selects: 0,
            textareas: 0,
            canvases: 1,
            media: 0,
            iframes: 0,
          },
        },
      },
    });
    expect(find(active, "demandCapture")?.detail.values?.controls).toBe(6);
  });

  it("says whether the markup reserves space for its images", () => {
    const missing = score();
    expect(find(missing, "imageDimensions")?.detail.key).toBe(
      "imageDimensions.some",
    );

    const declared = score({
      extract: {
        declared: {
          ...extract().declared!,
          images: {
            total: 3,
            withAlt: 3,
            withEmptyAlt: 0,
            withoutAlt: 0,
            withDimensions: 3,
            lazyLoaded: 2,
          },
        },
      },
    });
    expect(find(declared, "imageDimensions")?.state).toBe("pass");
    expect(find(declared, "imageLoading")?.detail.values?.lazy).toBe(2);
  });
});
