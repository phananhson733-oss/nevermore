import { describe, expect, it } from "vitest";

import type { SeoAuditTargetPageExtract } from "../types.ts";
import { buildKeywordEvidence } from "./evidence.ts";
import { normalizeTargetQueries } from "./normalize.ts";
import type {
  KeywordEvidenceAvailable,
  KeywordEvidenceQuery,
} from "./types.ts";

const extract: SeoAuditTargetPageExtract = {
  url: "https://www.astrologywiki.com/",
  title: "Free Birth Chart Calculator & Astrology | AstrologyWiki",
  metaDescription: "Free birth chart calculator and astrology readings.",
  h1: ["Free Birth Chart & Astrology Readings"],
  subHeadings: [
    "What a free birth chart can show you",
    "How to calculate an accurate natal chart",
  ],
  openingText:
    "A birth chart is a map of the sky at your moment of birth. This astrology guide explains how to read it.",
  staticBodyWords: 1631,
  truncatedLists: false,
};

function queries(raw: readonly string[]) {
  const result = normalizeTargetQueries(raw);
  if (!result.ok) throw new Error(`fixture rejected: ${result.reason}`);
  return result.queries;
}

function available(
  built: ReturnType<typeof buildKeywordEvidence>,
): KeywordEvidenceAvailable {
  if (built.availability !== "available") {
    throw new Error(`expected available, got ${built.reason}`);
  }
  return built;
}

function queryNamed(
  built: KeywordEvidenceAvailable,
  display: string,
): KeywordEvidenceQuery {
  const found = built.queries.find((q) => q.displayQuery === display);
  if (found === undefined) throw new Error(`no query ${display}`);
  return found;
}

describe("buildKeywordEvidence — unavailable states", () => {
  it("reports the whole region unavailable when the target page was not captured", () => {
    const built = buildKeywordEvidence(null, queries(["astrology"]), null);
    expect(built).toEqual({
      availability: "unavailable",
      reason: "target_page_not_captured",
      version: "keyword_evidence.v1",
    });
  });

  it("distinguishes a page that was never collected from one whose text is missing", () => {
    // One reason for two different facts would tell a visitor their page was
    // unreachable when it was collected and read fine.
    expect(
      buildKeywordEvidence(null, queries(["astrology"]), null, false),
    ).toMatchObject({ reason: "target_page_not_captured" });
    expect(
      buildKeywordEvidence(null, queries(["astrology"]), null, true),
    ).toMatchObject({ reason: "extract_missing" });
  });

  it("never emits zeros or crosses in place of an unavailable region", () => {
    const built = buildKeywordEvidence(null, queries(["astrology"]), null);
    expect(JSON.stringify(built)).not.toContain("not_covered");
    expect(JSON.stringify(built)).not.toContain("\"occurrences\":0");
  });
});

describe("buildKeywordEvidence — coverage slots", () => {
  it("marks a keyword present in every slot as covered", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology"]), "homepage"),
    );
    const astrology = queryNamed(built, "astrology");
    expect(astrology.slots.title.state).toBe("covered");
    expect(astrology.slots.description.state).toBe("covered");
    expect(astrology.slots.h1.state).toBe("covered");
    expect(astrology.slots.openingText.state).toBe("covered");
    expect(astrology.slots.url.state).toBe("covered");
  });

  it("marks an absent keyword not_covered without touching the others", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["horoscope"]), null),
    );
    const horoscope = queryNamed(built, "horoscope");
    expect(horoscope.slots.title.state).toBe("not_covered");
    expect(horoscope.slots.title.occurrences).toBe(0);
    expect(horoscope.capturedOccurrences).toBe(0);
  });

  it("marks a missing field not_applicable with a null count, never zero", () => {
    const withoutDescription: SeoAuditTargetPageExtract = {
      ...extract,
      metaDescription: null,
    };
    const built = available(
      buildKeywordEvidence(withoutDescription, queries(["astrology"]), null),
    );
    const slot = queryNamed(built, "astrology").slots.description;
    expect(slot.state).toBe("not_applicable");
    expect(slot.occurrences).toBeNull();
  });

  it("treats underivable sub-headings as not_applicable and says so", () => {
    const underivable: SeoAuditTargetPageExtract = {
      ...extract,
      subHeadings: null,
    };
    const built = available(
      buildKeywordEvidence(underivable, queries(["astrology"]), null),
    );
    expect(queryNamed(built, "astrology").slots.subHeadings.state).toBe(
      "not_applicable",
    );
    expect(built.limitations).toContain(
      "sub_headings_underivable_h1_cap_reached",
    );
  });

  it("treats an empty heading list as not_applicable rather than not_covered", () => {
    const noHeadings: SeoAuditTargetPageExtract = { ...extract, h1: [] };
    const built = available(
      buildKeywordEvidence(noHeadings, queries(["astrology"]), null),
    );
    expect(queryNamed(built, "astrology").slots.h1.state).toBe(
      "not_applicable",
    );
  });
});

describe("buildKeywordEvidence — focus", () => {
  it("counts only checkable slots in the denominator", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology"]), null),
    );
    expect(built.focus.applicable).toBe(6);
    expect(built.focus.covered).toBeGreaterThan(0);
  });

  it("shrinks the denominator when a field is missing, so unavailable is not failure", () => {
    const thin: SeoAuditTargetPageExtract = {
      ...extract,
      metaDescription: null,
      subHeadings: null,
    };
    const built = available(
      buildKeywordEvidence(thin, queries(["astrology"]), null),
    );
    expect(built.focus.applicable).toBe(4);
  });

  it("never publishes a percentage or a grade", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology"]), null),
    );
    const serialized = JSON.stringify(built);
    expect(serialized).not.toContain("score");
    expect(serialized).not.toContain("grade");
    expect(serialized).not.toContain("percent");
  });
});

describe("buildKeywordEvidence — density", () => {
  it("shares one total between numerator and denominator", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology"]), null),
    );
    const density = queryNamed(built, "astrology").density;
    expect(density).not.toBeNull();
    expect(density?.basis).toBe("captured_text");
    expect(density?.denominatorUnits).toBeGreaterThan(0);
    expect(density?.value).toBeCloseTo(
      (density?.numeratorUnits ?? 0) / (density?.denominatorUnits ?? 1),
      4,
    );
  });

  it("scales the numerator by the query's own unit count", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["birth chart"]), null),
    );
    const query = queryNamed(built, "birth chart");
    expect(query.density?.numeratorUnits).toBe(query.capturedOccurrences * 2);
  });

  it("returns null density rather than zero when nothing was captured", () => {
    const empty: SeoAuditTargetPageExtract = {
      ...extract,
      title: null,
      metaDescription: null,
      h1: [],
      subHeadings: null,
      openingText: null,
    };
    const built = available(
      buildKeywordEvidence(empty, queries(["astrology"]), null),
    );
    expect(queryNamed(built, "astrology").density).toBeNull();
  });
});

describe("buildKeywordEvidence — primary query", () => {
  it("picks the query covering the most slots and says why", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology", "horoscope"]), null),
    );
    const primary = built.queries.filter((q) => q.isPrimary);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.displayQuery).toBe("astrology");
    expect(primary[0]?.primaryReason).toBe("most_fields_covered");
  });

  it("breaks a tie on the longer query, then on submission order", () => {
    const absent = available(
      buildKeywordEvidence(
        extract,
        queries(["zzz alpha", "qqq"]),
        null,
      ),
    );
    expect(absent.queries.find((q) => q.isPrimary)?.displayQuery).toBe(
      "zzz alpha",
    );
    expect(absent.queries.find((q) => q.isPrimary)?.primaryReason).toBe(
      "longest",
    );

    const sameLength = available(
      buildKeywordEvidence(extract, queries(["qqq", "zzz"]), null),
    );
    expect(sameLength.queries.find((q) => q.isPrimary)?.displayQuery).toBe(
      "qqq",
    );
    expect(sameLength.queries.find((q) => q.isPrimary)?.primaryReason).toBe(
      "submission_order",
    );
  });

  it("marks exactly one primary and leaves the reason off the others", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology", "horoscope"]), null),
    );
    expect(built.queries.filter((q) => q.isPrimary)).toHaveLength(1);
    for (const query of built.queries) {
      if (!query.isPrimary) expect(query.primaryReason).toBeUndefined();
    }
  });
});

describe("buildKeywordEvidence — brand candidate", () => {
  it("labels the site's own domain word as a brand candidate", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrologywiki"]), null),
    );
    expect(queryNamed(built, "astrologywiki").brandCandidate).toBe("matched");
  });

  it("does not split a concatenated domain into words", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology wiki"]), null),
    );
    expect(queryNamed(built, "astrology wiki").brandCandidate).toBe(
      "not_matched",
    );
  });

  it("changes no count or state", () => {
    const brand = available(
      buildKeywordEvidence(extract, queries(["astrologywiki"]), null),
    );
    const query = queryNamed(brand, "astrologywiki");
    expect(query.slots.url.state).toBe("covered");
    expect(query.density).not.toBeNull();
  });

  it("reports not_applicable for a single CJK token with no Latin letters", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["占星"]), null),
    );
    expect(queryNamed(built, "占星").brandCandidate).toBe("not_applicable");
  });

  it("stays not_applicable for a CJK token carrying only digits", () => {
    // The candidates are Latin labels from a hostname. Digits do not make a
    // CJK word comparable to them, so a bare "no" would still be a claim we
    // cannot support.
    const built = available(
      buildKeywordEvidence(extract, queries(["品牌123"]), null),
    );
    expect(queryNamed(built, "品牌123").brandCandidate).toBe("not_applicable");
  });

  it.each([
    ["a multi-token CJK query", "占星 工具"],
    ["a CJK query carrying Latin letters", "seo工具"],
  ])("still compares %s and answers not_matched", (_name, query) => {
    // These can be compared against the hostname labels like any other query;
    // calling them inapplicable hides a real negative behind a claim that the
    // question does not apply.
    const built = available(
      buildKeywordEvidence(extract, queries([query]), null),
    );
    expect(queryNamed(built, query).brandCandidate).toBe("not_matched");
  });
});

describe("buildKeywordEvidence — published metadata", () => {
  it("carries both versions and echoes the declared page role", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology"]), "tool"),
    );
    expect(built.version).toBe("keyword_evidence.v1");
    expect(built.textUnitsVersion).toBe("text_units.v1");
    expect(built.pageRole).toBe("tool");
  });

  it("always publishes the standing limitations", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology"]), null),
    );
    expect(built.limitations).toContain("sub_headings_h2_h6_merged_no_levels");
    expect(built.limitations).toContain(
      "opening_text_first_500_chars_static_extraction",
    );
    expect(built.limitations).toContain("density_basis_captured_text_only");
  });

  it("adds the conditional limitations only when they apply", () => {
    const plain = available(
      buildKeywordEvidence(extract, queries(["astrology"]), null),
    );
    expect(plain.limitations).not.toContain("extract_lists_truncated");
    expect(plain.limitations).not.toContain(
      "static_body_words_unavailable_for_cjk",
    );

    const flagged = available(
      buildKeywordEvidence(
        { ...extract, truncatedLists: true, staticBodyWords: null },
        queries(["astrology"]),
        null,
      ),
    );
    expect(flagged.limitations).toContain("extract_lists_truncated");
    expect(flagged.limitations).toContain(
      "static_body_words_unavailable_for_cjk",
    );
  });

  it("echoes queries in submission order", () => {
    const built = available(
      buildKeywordEvidence(
        extract,
        queries(["horoscope", "astrology", "natal chart"]),
        null,
      ),
    );
    expect(built.queries.map((q) => q.displayQuery)).toEqual([
      "horoscope",
      "astrology",
      "natal chart",
    ]);
  });

  it("does not echo any page text back into the evidence region", () => {
    const built = available(
      buildKeywordEvidence(extract, queries(["astrology"]), null),
    );
    const serialized = JSON.stringify(built);
    expect(serialized).not.toContain("Free Birth Chart Calculator");
    expect(serialized).not.toContain("map of the sky");
  });
});
