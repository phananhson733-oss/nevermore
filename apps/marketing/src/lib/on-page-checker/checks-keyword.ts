// @input  -- the derived keyword evidence for this visitor's queries
// @output -- the keyword category checks, plus the focus figure that can cap
// @pos    -- the only category that reads visitor input rather than page facts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  KeywordEvidenceQuery,
  KeywordEvidenceTextSlot,
} from "@sf/public-tools/seo-audit/keyword-evidence/types";
import {
  check,
  observation,
  type CheckInput,
  type OnPageCheck,
} from "./check-types.ts";

/**
 * Density is published, not graded.
 *
 * The denominator is the captured text — title, description, headings and the
 * first 500 characters — which is precisely the region a keyword is *supposed*
 * to be concentrated in. Measured on a correctly optimised page (keyword in
 * title, description, H1, one sub-heading, once in the opening), density over
 * that region reads around 20%: a band borrowed from whole-body density would
 * tell that page it "reads as written for a crawler".
 *
 * We could invent a band for this denominator, but we have not measured what a
 * good one looks like, and a threshold we cannot defend is worse than no
 * threshold. So the number is shown with its basis stated and no verdict
 * attached — which is also what the density figure honestly supports.
 */

/** Slots scored, and what each is worth. Title and H1 carry the most. */
const SLOT_POINTS: Readonly<Record<KeywordEvidenceTextSlot | "url", number>> = {
  title: 8,
  description: 4,
  h1: 8,
  subHeadings: 3,
  openingText: 3,
  url: 2,
};

export const SLOT_ORDER: readonly (KeywordEvidenceTextSlot | "url")[] = [
  "title",
  "description",
  "h1",
  "subHeadings",
  "openingText",
  "url",
];

function slotState(
  query: KeywordEvidenceQuery,
  slot: KeywordEvidenceTextSlot | "url",
): { readonly state: string; readonly occurrences: number | null } {
  if (slot === "url") {
    return { state: query.slots.url.state, occurrences: null };
  }
  const result = query.slots[slot];
  return { state: result.state, occurrences: result.occurrences };
}

/**
 * The query the rest of the checks are written about.
 *
 * The evidence layer already chose one and published why; re-deriving it here
 * would let the score and the table disagree about which word the page is
 * being judged on.
 */
export function primaryQuery(
  input: CheckInput,
): KeywordEvidenceQuery | null {
  if (input.evidence === null) return null;
  if (input.evidence.availability !== "available") return null;
  return (
    input.evidence.queries.find((query) => query.isPrimary) ??
    input.evidence.queries[0] ??
    null
  );
}

export function keywordChecks(input: CheckInput): readonly OnPageCheck[] {
  const query = primaryQuery(input);
  if (query === null) {
    // Two different sentences, because they are two different facts. "Not
    // asked" is the visitor running a URL-only check; "unavailable" is a query
    // they did name whose page text could not be read. Sharing one line told
    // half the visitors their page had failed something.
    return [
      observation(
        "keywordSlots",
        "keyword",
        input.evidence === null
          ? "keyword.notRequested"
          : "keyword.unavailable",
      ),
    ];
  }

  const checks: OnPageCheck[] = [];
  for (const slot of SLOT_ORDER) {
    const max = SLOT_POINTS[slot];
    const { state, occurrences } = slotState(query, slot);
    if (state === "not_applicable") {
      // The page has no such field. Scoring it as a miss would mark a page
      // down for failing a check it was never eligible for, so it leaves the
      // denominator instead.
      checks.push(
        observation(`keyword.${slot}`, "keyword", `keyword.${slot}.notApplicable`, {
          query: query.displayQuery,
        }),
      );
      continue;
    }
    const covered = state === "covered";
    checks.push(
      check(
        `keyword.${slot}`,
        "keyword",
        covered ? "pass" : "fail",
        covered ? max : 0,
        max,
        covered ? `keyword.${slot}.covered` : `keyword.${slot}.absent`,
        {
          query: query.displayQuery,
          ...(occurrences === null ? {} : { occurrences }),
        },
      ),
    );
  }

  const density = query.density;
  checks.push(
    density === null
      ? observation("keyword.density", "keyword", "keyword.density.unavailable", {
          query: query.displayQuery,
        })
      : observation("keyword.density", "keyword", "keyword.density.observed", {
          query: query.displayQuery,
          percent: Math.round(density.value * 10_000) / 100,
          // The occurrence count the evidence table shows. `numeratorUnits` is
          // occurrences × query length, so publishing it here put two different
          // numbers for one query on the same screen.
          occurrences: query.capturedOccurrences,
          units: density.denominatorUnits,
        }),
  );

  // Published as an observation, never as points: a brand term is expected to
  // sit at a density that would read as thin for a topic term, and we do not
  // want the same number judged twice.
  if (query.brandCandidate === "matched") {
    checks.push(
      observation("keyword.brand", "keyword", "keyword.brand.matched", {
        query: query.displayQuery,
      }),
    );
  }

  return checks;
}

/**
 * How much of the page is actually about the PRIMARY query, 0–1.
 *
 * Derived here from that one query's slots rather than read off
 * `evidence.focus`, which sums coverage across every submitted query. Under the
 * summed figure a page that covers its real target perfectly, submitted beside
 * four exploratory words, scored 6/30 = 20% and was capped at 45 — so adding
 * words to the form lowered the score of an unchanged page, under a message
 * that says "the target keyword", singular. The evidence panel still shows the
 * summed count, and says in its own copy that it is a count and not a score.
 *
 * Built from the slots that could be checked, so a page with no meta
 * description is not marked down for a field it does not have.
 */
export function topicFocus(input: CheckInput): number | null {
  const query = primaryQuery(input);
  if (query === null) return null;

  let covered = 0;
  let applicable = 0;
  for (const slot of SLOT_ORDER) {
    const { state } = slotState(query, slot);
    if (state === "not_applicable") continue;
    applicable += 1;
    if (state === "covered") covered += 1;
  }
  if (applicable === 0) return null;
  return covered / applicable;
}
