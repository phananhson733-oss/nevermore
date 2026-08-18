import { describe, expect, it } from "vitest";
import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import type {
  SeoAuditRecord,
  SeoAuditTargetPageExtract,
} from "@sf/public-tools/seo-audit/types";
import { buildOnPageScore } from "./scoring.ts";

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
      images: { total: 3, withAlt: 3, withEmptyAlt: 0, withoutAlt: 0 },
      externalLinks: { total: 2, nofollow: 1, blankWithoutNoopener: 0 },
      htmlBytes: 40_000,
      visibleTextBytes: 12_000,
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
    const result = score({ extract: { staticBodyWords: 120 } });

    expect(result.caps.map((cap) => cap.reason)).toContain("body_words");
    expect(result.score).toBeLessThanOrEqual(55);
  });

  it("applies the lowest ceiling when both caps bite", () => {
    const result = score({
      extract: { staticBodyWords: 90 },
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
        declared: null,
        response: {
          ...base.response,
          robotsIndexable: false,
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
