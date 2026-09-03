// @input  -- keyword evidence built by the real producer from real page text
// @output -- proof 2.3 and 3.2 decide, and refuse to when there is no basis
// @pos    -- unit coverage for the record projection Batch 4 added

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

function decide(evidence: KeywordEvidence | null, id: string) {
  return evaluateAgentAuditScope("page", {
    availability: "available",
    records: records(evidence),
    targetUrl: TARGET,
    targetInspected: true,
    inspectedTargetUrl: TARGET,
  }).checks.find((entry) => entry.check.id === id);
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

  it("passes a page whose title and H1 both carry the query", () => {
    const evidence = evidenceFor(["natal chart"]);
    expect(decide(evidence, "2.3")?.result).toBe("pass");
    expect(decide(evidence, "3.2")?.result).toBe("pass");
  });

  it("separates the two slots", () => {
    const evidence = evidenceFor(["natal chart"], {
      title: "Free calculator",
    });
    // 2.3 is a Warning and 3.2 a Tip: the title is read before the click and
    // the H1 after it, so they are not the same cost.
    expect(decide(evidence, "2.3")?.result).toBe("warning");
    expect(decide(evidence, "3.2")?.result).toBe("pass");
  });

  it("does not judge a page that has no title at all", () => {
    // "This page has no title" is a different finding with its own check.
    // Reading it as "the query is missing" charges one defect twice.
    const evidence = evidenceFor(["natal chart"], { title: null });
    expect(decide(evidence, "2.3")?.result).toBe("excluded");
  });

  it("does not judge a run with no confirmed query", () => {
    expect(decide(null, "2.3")?.result).toBe("excluded");
    expect(decide(null, "3.2")?.result).toBe("excluded");
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
