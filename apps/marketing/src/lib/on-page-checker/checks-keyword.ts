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
 * Density band for a single-word query, as a ratio of captured text.
 *
 * Deliberately wide. Density is a symptom, not a target: the useful reading is
 * "the copy never gets round to this word" at the bottom and "this reads like
 * it was written for a crawler" at the top. Anything between says little, so
 * the band between them scores full marks rather than pretending to rank.
 */
export const DENSITY_BAND = { low: 0.005, high: 0.05 } as const;

/** Slots scored, and what each is worth. Title and H1 carry the most. */
const SLOT_POINTS: Readonly<Record<KeywordEvidenceTextSlot | "url", number>> = {
  title: 8,
  description: 4,
  h1: 8,
  subHeadings: 3,
  openingText: 3,
  url: 2,
};

const SLOT_ORDER: readonly (KeywordEvidenceTextSlot | "url")[] = [
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
    return [observation("keywordSlots", "keyword", "keyword.unavailable")];
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
  if (density === null) {
    checks.push(
      observation("keyword.density", "keyword", "keyword.density.unavailable", {
        query: query.displayQuery,
      }),
    );
  } else {
    const percent = Math.round(density.value * 10_000) / 100;
    const tooLow = density.value < DENSITY_BAND.low;
    const tooHigh = density.value > DENSITY_BAND.high;
    checks.push(
      check(
        "keyword.density",
        "keyword",
        tooLow || tooHigh ? "warn" : "pass",
        tooLow || tooHigh ? 1 : 3,
        3,
        tooLow
          ? "keyword.density.low"
          : tooHigh
            ? "keyword.density.high"
            : "keyword.density.ok",
        {
          query: query.displayQuery,
          percent,
          occurrences: density.numeratorUnits,
          units: density.denominatorUnits,
        },
      ),
    );
  }

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
 * How much of the page is actually about the primary query, 0–1.
 *
 * Built from the slots that could be checked, so a page with no meta
 * description is not marked down for a field it does not have. This is the
 * figure the score cap reads.
 */
export function topicFocus(input: CheckInput): number | null {
  if (input.evidence.availability !== "available") return null;
  const { covered, applicable } = input.evidence.focus;
  if (applicable === 0) return null;
  return covered / applicable;
}
