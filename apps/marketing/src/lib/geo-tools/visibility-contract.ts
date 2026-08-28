// @input  -- nothing; the vocabulary one AI visibility run is written in
// @output -- sample, judgement, metric and report shapes, plus the thresholds printed beside them
// @pos    -- the contract every stage of the run agrees on, from the provider call to the page

import type { GeoQuestionLayer, GeoQuestionMode } from "./kb-questions.ts";

export const GEO_VISIBILITY_SCHEMA_VERSION = "marketing-geo-visibility.v1";

/** How many times one question is asked. */
export const VISIBILITY_SAMPLES_OPTIONS = [3, 5, 10] as const;
export const VISIBILITY_SAMPLES_DEFAULT = 5;

/**
 * How many provider calls run at once.
 *
 * Eight was measured: at that width the wall clock equals the slowest single
 * call, with no throttling and no degradation. Raising it has not been
 * measured, and the failure mode would be a paid run that hits a 429 halfway.
 */
export const VISIBILITY_CONCURRENCY = 8;

/**
 * A safety valve, not a budget.
 *
 * The Owner lifted the budget cap for this work, so these exist to stop a
 * runaway loop rather than to ration normal use. Both are printed on the page.
 */
export const VISIBILITY_RUNS_PER_DAY = 5;
export const VISIBILITY_DAILY_WINDOW_SECONDS = 24 * 60 * 60;

/** Observed price per call, from the same calibration the Agent uses. */
export const VISIBILITY_CALL_COST_USD = 0.0457;
/** Slowest observed call, used for the estimate printed before a run starts. */
export const VISIBILITY_CALL_SECONDS = 34;

export type VisibilitySampleStatus =
  | "ok"
  | "timeout"
  | "blocked"
  | "error";

/**
 * One answer, judged.
 *
 * `webSearchPerformed` travels with every sample because the run cannot decide
 * afterwards whether a citation was possible. A question answered from memory
 * has no citation denominator, and folding it into one is the difference
 * between "nobody cites you" and "the model did not look".
 */
export interface VisibilitySample {
  readonly questionId: string;
  readonly sampleIndex: number;
  readonly status: VisibilitySampleStatus;
  readonly webSearchPerformed: boolean | null;
  readonly mentioned: boolean;
  readonly cited: boolean;
  /** Domains the answer cited, normalized, deduplicated within the answer. */
  readonly citedDomains: readonly string[];
  /** Confirmed competitor brand names named in the answer. */
  readonly competitorsMentioned: readonly string[];
  /** The sentence the mention was found in, bounded. Never the whole answer. */
  readonly excerpt: string | null;
  readonly costUsd: number | null;
  readonly observedAt: string | null;
}

export interface VisibilityQuestionResult {
  readonly questionId: string;
  readonly text: string;
  readonly layer: GeoQuestionLayer;
  readonly mode: GeoQuestionMode;
  readonly calibrated: boolean;
  readonly samples: readonly VisibilitySample[];
  /** Samples that came back at all. */
  readonly answered: number;
  readonly mentioned: number;
  /** Samples where a citation was possible: answered and the model searched. */
  readonly citationEvaluable: number;
  readonly cited: number;
}

export interface VisibilityProportion {
  readonly successes: number;
  readonly trials: number;
  readonly point: number | null;
  readonly lo: number | null;
  readonly hi: number | null;
}

/**
 * The run's numbers.
 *
 * Every rate carries its own denominator because they are different
 * denominators: mention counts answered samples, citation counts only the
 * samples where the model actually looked something up.
 */
export interface VisibilityMetrics {
  /** Unprompted layers only: a branded question mentioning the brand is circular. */
  readonly unpromptedMention: VisibilityProportion;
  readonly promptedMention: VisibilityProportion;
  /** Retrieval-mode questions whose samples searched. */
  readonly citation: VisibilityProportion;
  /**
   * Questions mentioned at least once, over questions asked.
   *
   * The unit is the question rather than the sample, because five samples of
   * one question are not five independent observations.
   */
  readonly questionsMentioned: VisibilityProportion;
  readonly byLayer: readonly {
    readonly layer: GeoQuestionLayer;
    readonly mention: VisibilityProportion;
    readonly citation: VisibilityProportion;
  }[];
}

export interface VisibilityCitedDomain {
  readonly domain: string;
  /** Answers that cited this domain, not URLs. */
  readonly answers: number;
  readonly isOwn: boolean;
  readonly isCompetitor: boolean;
  readonly sampleUrls: readonly string[];
}

export type VisibilityRunStatus = "ok" | "partial" | "insufficient";

/** Below this share of samples coming back, the run does not draw conclusions. */
export const VISIBILITY_MIN_SUCCESS_RATIO = 0.7;

export interface VisibilityRunManifest {
  readonly schemaVersion: typeof GEO_VISIBILITY_SCHEMA_VERSION;
  readonly kbId: string;
  readonly snapshotId: string;
  readonly snapshotRevision: number;
  readonly questionSetHash: string;
  readonly questionCount: number;
  readonly samplesPerQuestion: number;
  readonly marketCode: string;
  readonly model: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly calls: number;
  readonly answered: number;
  readonly successRatio: number;
  readonly costUsd: number | null;
  readonly status: VisibilityRunStatus;
}

export interface VisibilityReport {
  readonly manifest: VisibilityRunManifest;
  readonly metrics: VisibilityMetrics;
  readonly questions: readonly VisibilityQuestionResult[];
  readonly citedDomains: readonly VisibilityCitedDomain[];
  /** Message keys under `tools.aiVisibility.limits`. */
  readonly limits: readonly string[];
  /** Present when a previous run of the same frozen question set exists. */
  readonly comparison: VisibilityComparison | null;
}

export interface VisibilityComparison {
  readonly baseRunId: string;
  readonly baseFinishedAt: string;
  readonly aggregates: readonly {
    readonly metric: "unpromptedMention" | "citation" | "questionsMentioned";
    readonly base: VisibilityProportion;
    readonly current: VisibilityProportion;
    readonly diff: number | null;
    readonly lo: number | null;
    readonly hi: number | null;
    /** True only when the test rejected and the interval excludes zero. */
    readonly changed: boolean;
    readonly testable: boolean;
  }[];
  /** Direction only. One question at five samples cannot support more. */
  readonly questions: readonly {
    readonly questionId: string;
    readonly text: string;
    readonly baseMentioned: number;
    readonly currentMentioned: number;
    readonly of: number;
    readonly direction: "gained" | "lost";
  }[];
}

/**
 * What this run does not do, printed with the report.
 *
 * The first one is the important one: this tool observes, it does not explain.
 * Classifying why a question missed needs the site's own pages indexed, which
 * this run does not do.
 */
export const VISIBILITY_LIMITS = [
  "oneSurface",
  "notAttribution",
  "sampledNotCensus",
  "demandQuestions",
  "englishOnly",
] as const;

export type VisibilityErrorCode =
  | "auth_required"
  | "auth_unavailable"
  | "cross_origin"
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "no_frozen_version"
  | "not_found"
  | "daily_limit"
  | "provider_unconfigured"
  | "run_unavailable"
  | "store_unavailable"
  | "internal_error";

export function visibilityCallCount(
  questionCount: number,
  samplesPerQuestion: number,
): number {
  return questionCount * samplesPerQuestion;
}

export function visibilityCostEstimateUsd(calls: number): number {
  return Math.round(calls * VISIBILITY_CALL_COST_USD * 100) / 100;
}

export function visibilityMinutesEstimate(calls: number): number {
  return Math.max(
    1,
    Math.round((Math.ceil(calls / VISIBILITY_CONCURRENCY) * VISIBILITY_CALL_SECONDS) / 60),
  );
}
