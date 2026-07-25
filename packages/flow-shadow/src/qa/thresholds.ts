/**
 * QA thresholds — package constants, never configuration.
 *
 * They are deliberately NOT stored in the database and NOT read from the
 * environment. `flow_shadow_runs.content_hash` freezes the input tuple plus
 * `flow_adapter_version`; a threshold that lived outside that tuple would let
 * the same frozen inputs produce a different verdict after someone edited a
 * row, which is exactly the reproducibility promise red line C makes.
 *
 * The consequence is intentional and is the point: changing any number here
 * MUST advance `CONTENT_SHADOW_ADAPTER_VERSION`, which changes every future
 * run's hash and leaves already-frozen runs replayable under the constants they
 * were judged with.
 *
 * The sibling tooling read these from a JSON snapshot at module-import time.
 * That is filesystem IO plus hidden global state in a judgement that has to be
 * a pure function of its inputs, so it is not ported.
 */
export const QA_THRESHOLDS = Object.freeze({
  /** RL4: a section counts as anchored above any one of these floors. */
  rl4JaccardFloor: 0.05,
  rl4ShingleFloor: 0.1,
  rl4ShingleN: 5,
  rl4TargetRecallFloor: 0.5,
  /** B2B value (the oracle profile used 2, which is far too tight for B2B). */
  rl4DriftedSectionsFail: 4,
  rl5FlatMaxCount: 12,
  rl5SingleWordDensityCeil: 0.015,
  rl5MultiWordDensityCeil: 0.028,
  sc3MaxSentences: 7,
  sc3MaxWords: 180,
  sc3bMinParagraphs: 10,
  sc3cMaxSectionParas: 3,
  sc4FirstLinkMaxWords: 150,
  sc5MinFaqQuestions: 3,
  sc7MinBullets: 3,
  sc9MinSourceEntries: 1,
  sc10MinCols: 4,
  sc10MinRows: 3,
  scdupMaxBriefNgram: 40,
  /** Advisory only. Never compared against for gating (decision D-B). */
  citabilityAdvisoryFloor: 50,
  /** Upper bound on input size: the n-gram DP is O(n·m). */
  maxDraftChars: 400_000,
  /** Token cap for the n-gram DP, independent of the character bound. */
  maxNgramTokens: 6_000,
  /** Below this a name token is too generic to be an identity ("data", "the"). */
  nameMatchMinTokenLen: 4,
  /** Bound on how many violation excerpts one claim's detail may enumerate. */
  maxReportedFindings: 6,
  /** Bound on a single quoted excerpt inside a claim detail. */
  maxExcerptChars: 120,
} as const);

export type QaThresholds = typeof QA_THRESHOLDS;
