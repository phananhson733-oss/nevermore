import type { QaContext } from "./context.ts";
import { pass, type QaRuleResult } from "./rule-types.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";
import {
  extractMarkdownLinks,
  extractUrls,
  isListItem,
  isTableRow,
  paragraphBlocks,
  sentenceCount,
  stripInlineCode,
  wordCount,
} from "./text.ts";

/**
 * GEO citability scoring — clean-room, advisory, never gating.
 *
 * BASIS (kept verbatim, because it is our written record of where this came
 * from): the feature families are re-derived from the public GEO literature on
 * what makes a passage quotable by generative answer engines (Aggarwal,
 * Murahari et al., "GEO: Generative Engine Optimization", KDD 2024,
 * arXiv:2311.09735). No unlicensed source code was vendored or copied; the
 * counting, normalization and weighting below are our own.
 *
 * CAVEAT (kept verbatim, and returned to callers): this is an editorial
 * heuristic, not a measurement. The score is not a predicted citation rate, it
 * demonstrates no causal effect, and the weights are uncalibrated. It must be
 * rendered as a suggestion and never as a number the product claims to have
 * measured.
 *
 * It NEVER participates in the verdict. The rule it emits is advisory by
 * declaration and its claim is never `failed`, so no draft is gated on an
 * uncalibrated heuristic.
 */

export const CITABILITY_METHOD = "citability-geo-heuristic-v1";

export const CITABILITY_BASIS =
  "Feature families re-derived from the public GEO literature on quotable passages (Aggarwal, Murahari et al., KDD 2024, arXiv:2311.09735). Clean-room: no source code from that work, or from the tooling this port draws on, was vendored or copied.";

export const CITABILITY_CAVEAT =
  "Editorial heuristic, not a measurement: this is not a predicted citation rate, it demonstrates no causal effect, and the weights are uncalibrated. Render it as a suggestion, never as a measured number.";

export interface CitabilityScore {
  /** 0-100 advisory score. Never a pass/fail gate. */
  readonly score: number;
  readonly rationale: string;
  readonly method: string;
  readonly basis: string;
  readonly caveat: string;
  readonly features: Readonly<Record<string, number>>;
  readonly normalized: Readonly<Record<string, number>>;
  readonly weakFeatures: readonly string[];
}

/** Saturation targets: the count at which a feature is considered fully served. */
const SATURATION: Readonly<Record<string, number>> = Object.freeze({
  statistics: 6,
  citations: 4,
  quotations: 2,
  definitions: 3,
  structure: 8,
  excerptability: 10,
  fluency: 12,
});

/** Weights sum to 1. Uncalibrated, by the caveat above. */
const WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  statistics: 0.18,
  citations: 0.18,
  quotations: 0.08,
  definitions: 0.16,
  structure: 0.14,
  excerptability: 0.16,
  fluency: 0.1,
});

function countFeatures(context: QaContext): Readonly<Record<string, number>> {
  let statistics = 0;
  let citations = 0;
  let quotations = 0;
  let definitions = 0;
  let structure = 0;
  for (const entry of context.body) {
    const text = stripInlineCode(entry.text);
    if (text.trim().length === 0) continue;
    statistics += [...text.matchAll(/\b\d+(?:\.\d+)?\s?%|\b\d{2,}\b/g)].length;
    citations += extractMarkdownLinks(text).length + extractUrls(text).length;
    quotations += [...text.matchAll(/"[^"\n]{12,}"/g)].length;
    definitions += [...text.matchAll(/\*\*[^*\n]+\*\*/g)].length;
    if (isListItem(text) || isTableRow(text)) structure += 1;
  }
  structure += context.view.headings.filter((heading) => heading.level >= 2).length;

  const blocks = paragraphBlocks(context.body);
  const excerptable = blocks.filter((block) => {
    const words = wordCount(block.text);
    return words >= 20 && words <= 90;
  }).length;
  const fluent = blocks.filter(
    (block) => sentenceCount(block.text) >= 2 && wordCount(block.text) >= 25,
  ).length;

  return Object.freeze({
    statistics,
    citations,
    quotations,
    definitions,
    structure,
    excerptability: excerptable,
    fluency: fluent,
  });
}

export function scoreCitability(context: QaContext): CitabilityScore {
  const features = countFeatures(context);
  const normalized: Record<string, number> = {};
  let total = 0;
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const saturation = SATURATION[name] ?? 1;
    const value = Math.min(1, (features[name] ?? 0) / saturation);
    normalized[name] = value;
    total += value * weight;
  }
  const weakFeatures = Object.keys(WEIGHTS)
    .filter((name) => (normalized[name] ?? 0) < 0.5)
    .sort();
  const score = Math.round(total * 100);
  return {
    score,
    rationale:
      weakFeatures.length === 0
        ? "Every citability feature family is served."
        : `Thin on: ${weakFeatures.join(", ")}.`,
    method: CITABILITY_METHOD,
    basis: CITABILITY_BASIS,
    caveat: CITABILITY_CAVEAT,
    features,
    normalized: Object.freeze(normalized),
    weakFeatures,
  };
}

/**
 * The advisory claim. Always `pass`, by construction: a rule that can never
 * change a verdict must never report a failure either, or the persisted claim
 * would read as a gate to anyone who cannot see the severity table.
 */
export function citabilityRule(score: CitabilityScore): QaRuleResult {
  return pass(
    "citability_geo",
    score.score >= QA_THRESHOLDS.citabilityAdvisoryFloor
      ? "citability_above_floor"
      : "citability_below_floor",
    `Advisory (never gates): GEO citability heuristic scores ${score.score}/100 (${score.rationale}) Method ${score.method}. ${score.caveat}`,
  );
}
