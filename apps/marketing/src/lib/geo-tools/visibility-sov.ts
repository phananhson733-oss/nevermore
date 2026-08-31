// @input -- upstream-filtered, non-prompted/non-branded question answer counts
// @output -- conditional-answer SOV and conservative question-cluster bounds
// @pos -- pure statistics; no providers, random bootstrap, or persistence

/** Count each answer once, even if it names both own brand and several rivals.
 * Callers must filter prompted/branded questions and unconfirmed rivals first. */
export interface VisibilitySovCluster {
  readonly questionId: string;
  readonly own: number;
  readonly anyBrand: number;
  readonly answered: number;
  readonly planned: number;
}

export const VISIBILITY_SOV_MIN_CLUSTERS = 10;
const ALPHA = 0.05;

export interface VisibilitySovEstimate {
  readonly ownAnswers: number;
  readonly anyBrandAnswers: number;
  readonly answered: number;
  readonly planned: number;
  readonly point: number | null;
  readonly lo: number | null;
  readonly hi: number | null;
  readonly clusters: number;
  readonly unobservedClusters: number;
  readonly method: "question_cluster_hoeffding_ratio_95.v1";
  readonly intervalReason: "no_observed_questions" | "no_brand_present_answers" | "fewer_than_10_question_clusters" | null;
  readonly assumption: "independent_question_clusters";
  readonly scope: "observed_answers";
}

export interface VisibilitySovComparison {
  /** Difference between ratios on the paired subset, not the two full headlines. */
  readonly point: number | null;
  readonly beforePoint: number | null;
  readonly afterPoint: number | null;
  readonly lo: number | null;
  readonly hi: number | null;
  readonly pairs: number;
  readonly matchedQuestionIds: readonly string[];
  readonly method: "paired_question_cluster_hoeffding_ratio_95.v1";
  readonly intervalReason: "no_paired_questions" | "no_brand_present_answers" | "fewer_than_10_question_pairs" | null;
  readonly assumption: "independent_question_clusters";
  readonly scope: "paired_observed_answers";
  readonly direction: "increase" | "decrease" | "inconclusive";
}

function validateClusters(clusters: readonly VisibilitySovCluster[]): void {
  if (!Array.isArray(clusters)) throw new RangeError("SOV clusters must be an array");
  const seen = new Set<string>();
  for (const cluster of clusters) {
    if (typeof cluster !== "object" || cluster === null ||
      typeof cluster.questionId !== "string" || cluster.questionId.length === 0 || cluster.questionId.trim() !== cluster.questionId || seen.has(cluster.questionId) ||
      ![cluster.own, cluster.anyBrand, cluster.answered, cluster.planned].every((count) => Number.isSafeInteger(count) && count >= 0) ||
      cluster.own > cluster.anyBrand || cluster.anyBrand > cluster.answered || cluster.answered > cluster.planned) {
      throw new RangeError("Invalid or duplicate SOV question counts");
    }
    seen.add(cluster.questionId);
  }
}

function totals(clusters: readonly VisibilitySovCluster[]) {
  let ownAnswers = 0;
  let anyBrandAnswers = 0;
  let answered = 0;
  let planned = 0;
  let observed = 0;
  let plannedCap = 0;
  for (const cluster of clusters) {
    ownAnswers += cluster.own;
    anyBrandAnswers += cluster.anyBrand;
    answered += cluster.answered;
    planned += cluster.planned;
    if (![ownAnswers, anyBrandAnswers, answered, planned].every(Number.isSafeInteger)) throw new RangeError("SOV aggregate counts exceed safe integer precision");
    if (cluster.answered > 0) observed += 1;
    plannedCap = Math.max(plannedCap, cluster.planned);
  }
  return { ownAnswers, anyBrandAnswers, answered, planned, observed, plannedCap };
}

const clamp = (value: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, value));

/**
 * Hoeffding for independent [0,1] question units, not answer replicas:
 * P(|mean-E(mean)| >= e) <= 2 exp(-2 n e^2). Union-bound two means for
 * a single ratio (4 tails), or four means for paired ratios (8 tails).
 * Source: P.B. Stark, Statistics 240 §1.17.5, inequalities (23)/(24):
 * https://www.stat.berkeley.edu/~stark/Teach/S240/Notes/ch1.pdf
 *
 * This ratio construction is our deterministic derivation from that bound.
 * A shared frozen-plan cap M makes Xi=own_i/M and Yi=anyBrand_i/M bounded;
 * their ratio is sum(own)/sum(anyBrand), never a question-Bernoulli point.
 * Question clusters must be independent; within-question draws may depend.
 * Missing answers are not failures: inference is scoped to observed answers,
 * conditional on the observed question subset, not to all attempted answers.
 */
function ratioBounds(own: number, anyBrand: number, n: number, commonCap: number, means: 2 | 4): { lo: number; hi: number } {
  const x = own / commonCap / n;
  const y = anyBrand / commonCap / n;
  const epsilon = Math.sqrt(Math.log(2 * means / ALPHA) / (2 * n));
  const denominatorLo = Math.max(0, y - epsilon);
  return {
    lo: clamp(Math.max(0, x - epsilon) / Math.min(1, y + epsilon)),
    hi: denominatorLo <= 0 ? 1 : clamp((x + epsilon) / denominatorLo),
  };
}

export function computeVisibilitySov(clusters: readonly VisibilitySovCluster[]): VisibilitySovEstimate {
  validateClusters(clusters);
  const count = totals(clusters);
  const intervalReason: VisibilitySovEstimate["intervalReason"] = count.observed === 0
    ? "no_observed_questions"
    : count.anyBrandAnswers === 0 ? "no_brand_present_answers"
      : count.observed < VISIBILITY_SOV_MIN_CLUSTERS ? "fewer_than_10_question_clusters" : null;
  const bounds = intervalReason === null ? ratioBounds(count.ownAnswers, count.anyBrandAnswers, count.observed, count.plannedCap, 2) : null;
  return {
    ownAnswers: count.ownAnswers, anyBrandAnswers: count.anyBrandAnswers,
    answered: count.answered, planned: count.planned,
    point: count.anyBrandAnswers > 0 ? count.ownAnswers / count.anyBrandAnswers : null,
    lo: bounds?.lo ?? null, hi: bounds?.hi ?? null,
    clusters: count.observed, unobservedClusters: clusters.length - count.observed,
    method: "question_cluster_hoeffding_ratio_95.v1", intervalReason,
    assumption: "independent_question_clusters", scope: "observed_answers",
  };
}

/** The four-dimensional before/after vector is one question-pair unit. The
 * union bound needs independence across pairs, not between the two runs. */
export function compareVisibilitySov(before: readonly VisibilitySovCluster[], after: readonly VisibilitySovCluster[]): VisibilitySovComparison {
  validateClusters(before);
  validateClusters(after);
  // Validate aggregate precision before selecting, so malformed unmatched rows
  // cannot be hidden by an otherwise valid intersection.
  totals(before);
  totals(after);
  const beforeById = new Map(before.filter((cluster) => cluster.answered > 0).map((cluster) => [cluster.questionId, cluster]));
  const afterById = new Map(after.filter((cluster) => cluster.answered > 0).map((cluster) => [cluster.questionId, cluster]));
  const matchedQuestionIds = [...beforeById.keys()].filter((id) => afterById.has(id)).sort();
  const baseline = totals(matchedQuestionIds.map((id) => beforeById.get(id)!));
  const current = totals(matchedQuestionIds.map((id) => afterById.get(id)!));
  const pairs = matchedQuestionIds.length;
  const beforePoint = baseline.anyBrandAnswers > 0 ? baseline.ownAnswers / baseline.anyBrandAnswers : null;
  const afterPoint = current.anyBrandAnswers > 0 ? current.ownAnswers / current.anyBrandAnswers : null;
  const intervalReason: VisibilitySovComparison["intervalReason"] = pairs === 0
    ? "no_paired_questions"
    : beforePoint === null || afterPoint === null ? "no_brand_present_answers"
      : pairs < VISIBILITY_SOV_MIN_CLUSTERS ? "fewer_than_10_question_pairs" : null;
  const commonCap = Math.max(baseline.plannedCap, current.plannedCap);
  const beforeBounds = intervalReason === null ? ratioBounds(baseline.ownAnswers, baseline.anyBrandAnswers, pairs, commonCap, 4) : null;
  const afterBounds = intervalReason === null ? ratioBounds(current.ownAnswers, current.anyBrandAnswers, pairs, commonCap, 4) : null;
  const lo = beforeBounds && afterBounds ? clamp(afterBounds.lo - beforeBounds.hi, -1, 1) : null;
  const hi = beforeBounds && afterBounds ? clamp(afterBounds.hi - beforeBounds.lo, -1, 1) : null;
  return {
    point: beforePoint === null || afterPoint === null ? null : clamp(afterPoint - beforePoint, -1, 1),
    beforePoint, afterPoint, lo, hi, pairs, matchedQuestionIds,
    intervalReason, method: "paired_question_cluster_hoeffding_ratio_95.v1",
    assumption: "independent_question_clusters", scope: "paired_observed_answers",
    direction: lo !== null && lo > 0 ? "increase" : hi !== null && hi < 0 ? "decrease" : "inconclusive",
  };
}
