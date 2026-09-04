// @input  -- keyword evidence built by the real producer from real page text
// @output -- proof delegated keyword records remain complete and preserve null semantics
// @pos    -- unit coverage for the producer ledger retained after catalog pruning

import { describe, expect, it } from "vitest";

import { evaluateAgentAuditScope } from "../../agent-audit/evaluate.ts";
import { buildKeywordEvidence } from "./evidence.ts";
import { normalizeTargetQueries } from "./normalize.ts";
import {
  buildKeywordEvidenceRecords,
  buildPageShapeRecords,
  KEYWORD_EVIDENCE_RECORD_IDS,
} from "./records.ts";
import type { KeywordEvidence } from "./types.ts";

const TARGET = "https://acme.test/chart";

function extract(overrides: Record<string, unknown> = {}) {
  return {
    title: "Free natal chart calculator",
    metaDescription: "Draw a natal chart.",
    h1: ["Natal chart calculator"],
    subHeadings: ["How it works"],
    openingText: "Enter a birth date to draw your natal chart.",
    url: TARGET,
    ...overrides,
  } as never;
}

function evidenceFor(
  queries: readonly string[],
  overrides: Record<string, unknown> = {},
): KeywordEvidence {
  const normalized = normalizeTargetQueries(queries);
  if (!normalized.ok) throw new Error(normalized.reason);
  return buildKeywordEvidence(extract(overrides), normalized.queries, null, true);
}

function records(evidence: KeywordEvidence | null) {
  return buildKeywordEvidenceRecords(TARGET, evidence);
}

function keywordRecord(evidence: KeywordEvidence | null, id: string) {
  return records(evidence).find((entry) => entry.id === id);
}

describe("keyword evidence records", () => {
  it("emits both records whatever happened", () => {
    // A missing record reads to the wire guard as a producer that broke and
    // takes the whole region down, so every no-basis case is a present record
    // in the unverified state.
    for (const evidence of [null, evidenceFor(["natal chart"])]) {
      expect(records(evidence).map((record) => record.id)).toEqual(
        KEYWORD_EVIDENCE_RECORD_IDS,
      );
    }
  });

  it("records no missing-query condition when title and H1 both carry the query", () => {
    const evidence = evidenceFor(["natal chart"]);
    expect(keywordRecord(evidence, "title_without_target_query")?.state).toBe(
      "not_observed",
    );
    expect(keywordRecord(evidence, "h1_without_target_query")?.state).toBe(
      "not_observed",
    );
  });

  it("separates the two slots", () => {
    const evidence = evidenceFor(["natal chart"], {
      title: "Free calculator",
    });
    expect(keywordRecord(evidence, "title_without_target_query")?.state).toBe(
      "observed",
    );
    expect(keywordRecord(evidence, "h1_without_target_query")?.state).toBe(
      "not_observed",
    );
  });

  it("does not judge a page that has no title at all", () => {
    // "This page has no title" is a different finding with its own check.
    // Reading it as "the query is missing" charges one defect twice.
    const evidence = evidenceFor(["natal chart"], { title: null });
    expect(keywordRecord(evidence, "title_without_target_query")?.state).toBe(
      "unverified",
    );
  });

  it("keeps both slot records unverified with no confirmed query", () => {
    expect(keywordRecord(null, "title_without_target_query")?.state).toBe(
      "unverified",
    );
    expect(keywordRecord(null, "h1_without_target_query")?.state).toBe(
      "unverified",
    );
  });

  it("names the query it judged in the evidence", () => {
    const evidence = evidenceFor(["natal chart"], { title: "Free calculator" });
    const record = records(evidence).find(
      (entry) => entry.id === "title_without_target_query",
    );

    expect(
      record?.observations[0]?.values.find(
        (entry) => entry.label === "target_query",
      )?.value,
    ).toBe("natal chart");
  });

  describe("target-query coverage across the other text slots", () => {
    it("reaches a verdict rather than sitting excluded forever", () => {
      // The catalog delegates this to the single-page checker, while the wire
      // ledger still requires a present record for old and new clients alike.
      const record = records(evidenceFor(["natal chart"])).find(
        (entry) => entry.id === "target_query_slot_coverage",
      );

      expect(record).toBeDefined();
      expect(record?.state).not.toBe("unverified");
    });

    it("fires once for the page, not once per slot", () => {
      // Four slots, one decision about how the page presents itself. Reporting
      // each slot separately would charge one page four times.
      const record = records(evidenceFor(["natal chart"])).find(
        (entry) => entry.id === "target_query_slot_coverage",
      );

      expect(record?.state).toBe("observed");
      expect(record?.affected).toBe(1);
      expect(record?.observations).toHaveLength(1);
      expect(
        record?.observations[0]?.values.map((entry) => entry.label),
      ).toEqual(["target_query", "slots_applicable"]);
    });

    it("does not read an exact-match domain as coverage", () => {
      // The URL slot compares the letters of the whole absolute address,
      // hostname included. Counted here, every page on astrologywiki.com would
      // "cover" the query `astrology wiki` and this check could never fire on
      // the sites whose domain already says what they are about.
      const record = records(evidenceFor(["astrology wiki"])).find(
        (entry) => entry.id === "target_query_slot_coverage",
      );

      expect(record?.state).toBe("observed");
      expect(record?.affected).toBe(1);
    });

    it("does not charge a page for slots it does not have", () => {
      // A page with no description, no sub-headings and no opening text is
      // already reported by the checks that own those absences. Reading them
      // as a missing query charges one page twice.
      const record = buildKeywordEvidenceRecords(
        TARGET,
        evidenceFor(["natal chart"], {
          metaDescription: null,
          subHeadings: [],
          openingText: null,
        }),
      ).find((entry) => entry.id === "target_query_slot_coverage");

      expect(record?.state).toBe("unverified");
      expect(record?.affected).toBe(0);
      expect(record?.limitation).toContain(
        "no_description_subheadings_or_opening_text",
      );
    });

    it("states the basis it measured on", () => {
      // It was the only keyword-evidence record publishing none.
      const record = records(evidenceFor(["natal chart"])).find(
        (entry) => entry.id === "target_query_slot_coverage",
      );

      expect(record?.limitation).toContain("token_sequence_match");
    });

    it("says nothing when no query was confirmed", () => {
      const record = buildKeywordEvidenceRecords(TARGET, null).find(
        (entry) => entry.id === "target_query_slot_coverage",
      );

      expect(record?.state).toBe("unverified");
      expect(record?.affected).toBe(0);
      expect(record?.limitation).toContain("no_target_query_was_confirmed");
    });
  });

  describe("3.6 — words under each H3", () => {
    const shape = (words: readonly number[], wordCountIsMeaningful = true) => ({
      levels: words.map(() => 3),
      pageType: "guide",
      h2: { min: 0, max: 99 },
      h3: { min: 0, max: 99 },
      substanceWords: 80,
      wordsUnderEachH3: words,
      wordCountIsMeaningful,
    });
    const decide = (words: readonly number[] | null) =>
      evaluateAgentAuditScope("page", {
        availability: "available",
        records: buildPageShapeRecords(
          TARGET,
          words === null ? null : shape(words),
        ),
        targetUrl: TARGET,
        targetInspected: true,
        inspectedTargetUrl: TARGET,
      }).checks.find((entry) => entry.check.id === "3.6");

    it("passes sections that carry the reviewed substance", () => {
      expect(decide([120, 100])?.result).toBe("pass");
    });

    it("fires on sections that carry almost nothing", () => {
      expect(decide([4, 6])?.result).toBe("tip");
    });

    it("does not judge a page with no H3 at all", () => {
      // An outline with no third level is 3.5's finding, not this one.
      expect(decide([])?.result).toBe("excluded");
    });

    it("does not judge a run with no confirmed page type", () => {
      expect(decide(null)?.result).toBe("excluded");
    });
    it("does not judge a page whose words are not what it is made of", () => {
      // The published threshold says a page written without inter-word spaces
      // is not measured here. The crawler's whitespace split reports about one
      // "word" per section on such a page, so measuring it anyway reported
      // every section as thin -- the copy said one thing and the code did the
      // other.
      const record = buildPageShapeRecords(
        TARGET,
        shape([1, 1, 1], false),
      ).find((entry) => entry.id === "thin_section_under_h3");

      expect(record?.state).toBe("unverified");
      expect(record?.affected).toBe(0);
      expect(record?.tested).toBe(0);
      expect(record?.limitation).toContain("not_measured_by_whitespace_words");
    });

  });

  it("carries a category a crawl payload may never hold", () => {
    // The cache is keyed by host and shared. A record derived from one
    // visitor's typed query must be refused by the crawl payload guard, and
    // the category is what does the refusing.
    for (const record of records(evidenceFor(["natal chart"]))) {
      expect(record.category).toBe("keyword_evidence");
    }
  });
});
