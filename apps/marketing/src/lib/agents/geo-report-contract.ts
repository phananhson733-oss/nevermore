// @input  -- GEO run values crossing from the server to Agent clients
// @output -- exact v1 sampled-observation types and a strict browser-safe guard
// @pos    -- public wire contract for the repeated-sampling GEO visibility report

export const AGENT_GEO_REPORT_SCHEMA_VERSION = "agent_geo_report.v1" as const;

/**
 * How many independent samples every buyer question is asked for.
 *
 * Three, because one is not a measurement. Calibration on 2026-08-17 asked one
 * question four times against the same model, with web search confirmed on and
 * a full answer returned every time, and got four citation sets of 4, 8, 14 and
 * 2 hosts whose union was 25 hosts and whose intersection was EMPTY — not one
 * host appeared in all four. A single sample therefore cannot separate "this
 * site is not cited" from "this run happened not to cite it", which is the only
 * question the report exists to answer. Three is the smallest count that lets
 * the report say "N of 3" instead of a boolean.
 */
export const GEO_SAMPLES_PER_QUESTION = 3;

/**
 * How many buyer questions one run covers.
 *
 * Eight rather than the twenty a single-sample design would allow: at a
 * measured $0.032 per call the budget buys either 20 unrepeatable answers or 8
 * answers sampled three times, and only the second supports a defensible
 * verdict. It is also the largest set a visitor will actually read and confirm
 * before starting a paid run.
 */
export const GEO_QUESTIONS_PER_RUN = 8;

/**
 * Provider ceiling on one prompt, in characters.
 *
 * DataForSEO rejects a longer `user_prompt` outright, so a question that
 * overruns is a paid round trip that returns nothing. Enforced here as well as
 * at generation time because the contract is the last place a malformed
 * question can be stopped before it reaches the wire.
 */
export const GEO_MAX_QUESTION_LENGTH = 500;

/**
 * What one sample of one question observed.
 *
 * The six states exist because the four a first design reaches for
 * (cited/mentioned/unseen/unavailable) merge two pairs that mean different
 * things. `answer_had_no_citations` is not `cited_others_only`: the first says
 * the model answered from its own weights and cited nobody, the second says it
 * cited sources and none of them was this site — only the second is evidence of
 * a competitive gap, so merging them would overstate how often competitors win.
 * `search_not_performed` is not `unavailable` either: the call succeeded and
 * was billed, the provider simply chose not to search, and an answer written
 * without searching is no evidence about who gets cited when it does.
 *
 * Both non-citing states were common in a first calibration that ran at an
 * output ceiling of 1024 tokens (62% and 25% respectively) and absent from a
 * second at 4096 (0% and 0%): below the higher ceiling the model's own
 * reasoning consumed the whole budget and no answer was emitted at all. That
 * was a configuration defect, not a property of the provider, so these states
 * are kept for the cases that remain possible rather than because they are
 * expected. The collector pins the higher ceiling; see geo-provider.ts.
 */
export type GeoSampleState =
  | "cited"
  | "mentioned"
  | "cited_others_only"
  | "answer_had_no_citations"
  | "search_not_performed"
  | "unavailable";

/**
 * The states that may be counted.
 *
 * Admissibility is about whether the sample carries information about
 * citations at all, not about whether the news was good: an answer that cited
 * nobody is a real observation and belongs in the denominator, while an answer
 * produced without a web search, or a call that never produced an answer, is
 * not an observation of anything.
 */
export const GEO_ADMISSIBLE_SAMPLE_STATES = [
  "cited",
  "mentioned",
  "cited_others_only",
  "answer_had_no_citations",
] as const satisfies readonly GeoSampleState[];

const ADMISSIBLE_STATES = new Set<GeoSampleState>(GEO_ADMISSIBLE_SAMPLE_STATES);

const SAMPLE_STATES = new Set<GeoSampleState>([
  "cited",
  "mentioned",
  "cited_others_only",
  "answer_had_no_citations",
  "search_not_performed",
  "unavailable",
]);

/**
 * What the three samples of one question, taken together, support.
 *
 * `intermittent` is a first-class finding rather than a degraded
 * `stable_cited`: on calibration data it is the most common truthful answer,
 * and a report that renders it as "insufficient data" would be hiding its
 * single most representative result.
 */
export type GeoQuestionVerdict =
  | "stable_cited"
  | "intermittent"
  | "not_observed"
  | "inconclusive";

export interface GeoSample {
  /** 1-based position in the question's sample sequence. */
  readonly sampleIndex: number;
  readonly state: GeoSampleState;
  /** Null exactly when the provider returned no observation. */
  readonly observedAt: string | null;
  readonly webSearchPerformed: boolean;
  /** Every host the answer cited, normalized and deduped. */
  readonly citedHosts: readonly string[];
  /** The subset of citedHosts that matched a known competitor. */
  readonly competitorHosts: readonly string[];
  readonly limitation: string | null;
}

export interface GeoQuestionAggregate {
  /** Samples that carried citation information; the denominator. */
  readonly admissibleSamples: number;
  readonly targetCitedIn: number;
  readonly targetMentionedIn: number;
  readonly verdict: GeoQuestionVerdict;
}

export interface GeoQuestionObservation {
  readonly questionId: string;
  readonly question: string;
  readonly samples: readonly GeoSample[];
  readonly aggregate: GeoQuestionAggregate;
}

export type GeoCoverageAvailability = "available" | "partial" | "unavailable";

export interface GeoCoverage {
  readonly questionsRequested: number;
  readonly samplesAttempted: number;
  readonly samplesObserved: number;
  readonly samplesSearchNotPerformed: number;
  readonly samplesUnavailable: number;
  readonly availability: GeoCoverageAvailability;
}

export interface GeoProviderProvenance {
  readonly tool: "dataforseo_chat_gpt_llm_responses";
  readonly model: string;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly samplesPerQuestion: number;
  readonly costUsd: number;
}

export interface GeoReportRun {
  readonly agent: "geo";
  readonly mode: "authenticated_agent";
  /**
   * Unlike every other marketing Agent, which pins `persistence: "none"`.
   *
   * A GEO run bills 24 provider calls, so losing it to a closed tab or a
   * double-click is a real cost rather than a re-run. The record expires
   * instead of living forever: it is a snapshot of one moment's answers, and
   * the design deliberately refuses to imply a history it cannot support.
   */
  readonly persistence: "expiring";
  readonly schemaVersion: typeof AGENT_GEO_REPORT_SCHEMA_VERSION;
  readonly sampledAt: string;
  readonly expiresAt: string;
  readonly targetHost: string;
  readonly provider: GeoProviderProvenance;
}

export interface GeoReportData {
  readonly run: GeoReportRun;
  readonly coverage: GeoCoverage;
  readonly questions: readonly GeoQuestionObservation[];
}

export interface GeoReportSuccessEnvelope {
  readonly data: GeoReportData;
}

export interface GeoReportErrorEnvelope<TCode extends string = string> {
  readonly error: { readonly code: TCode };
}

export type GeoReportResponseEnvelope =
  | GeoReportSuccessEnvelope
  | GeoReportErrorEnvelope;

type UnknownObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: UnknownObject,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

/**
 * Hosts as the report stores them: lowercase, no scheme, no `www.`, no port.
 *
 * Normalized at the boundary rather than compared loosely later, because the
 * provider's citation URLs arrive with tracking query strings and mixed case,
 * and a target-host match that sometimes fails is indistinguishable from a
 * site that sometimes is not cited — the exact confusion this report exists to
 * remove.
 */
function isNormalizedHost(value: unknown): value is string {
  return (
    isNonEmptyString(value, 253) &&
    value === value.toLowerCase() &&
    !value.startsWith("www.") &&
    !value.includes("/") &&
    !value.includes(":") &&
    !value.includes(" ") &&
    value.includes(".")
  );
}

function isUniqueNormalizedHosts(
  value: unknown,
  maxItems: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => isNormalizedHost(item)) &&
    new Set(value).size === value.length
  );
}

/** One answer cannot plausibly cite more distinct hosts than this. */
const MAX_CITED_HOSTS_PER_SAMPLE = 40;

function isSample(value: unknown, targetHost: string): value is GeoSample {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "sampleIndex",
      "state",
      "observedAt",
      "webSearchPerformed",
      "citedHosts",
      "competitorHosts",
      "limitation",
    ]) ||
    !isNonNegativeInteger(value.sampleIndex) ||
    value.sampleIndex < 1 ||
    value.sampleIndex > GEO_SAMPLES_PER_QUESTION ||
    typeof value.state !== "string" ||
    !SAMPLE_STATES.has(value.state as GeoSampleState) ||
    typeof value.webSearchPerformed !== "boolean" ||
    !isUniqueNormalizedHosts(value.citedHosts, MAX_CITED_HOSTS_PER_SAMPLE) ||
    !isUniqueNormalizedHosts(
      value.competitorHosts,
      MAX_CITED_HOSTS_PER_SAMPLE,
    ) ||
    (value.limitation !== null && !isNonEmptyString(value.limitation, 500))
  ) {
    return false;
  }

  const state = value.state as GeoSampleState;
  const citedHosts = value.citedHosts;
  const competitorHosts = value.competitorHosts;

  // Competitors are a subset of what was cited, never a parallel list. A
  // competitor host that is not in citedHosts would mean the report knows a
  // rival was mentioned without being able to say where.
  if (!competitorHosts.every((host) => citedHosts.includes(host))) {
    return false;
  }

  // A sample with no observation time is not an observation. Both non-counting
  // states may still carry hosts from a partial response, so the timestamp is
  // what separates them rather than the host list.
  if (state === "unavailable") {
    return (
      value.observedAt === null &&
      // A call that produced no answer produced no evidence that a search ran
      // either, so the honest value is false rather than whatever the failed
      // request happened to ask for.
      value.webSearchPerformed === false &&
      citedHosts.length === 0 &&
      isNonEmptyString(value.limitation, 500)
    );
  }
  if (!isCanonicalIsoTimestamp(value.observedAt)) return false;

  if (state === "search_not_performed") {
    return value.webSearchPerformed === false;
  }

  // Every remaining state asserts something about a searched answer, so a
  // sample claiming one of them while reporting no search is self-contradictory.
  if (value.webSearchPerformed !== true) return false;

  const targetCited = citedHosts.includes(targetHost);
  if (state === "answer_had_no_citations") return citedHosts.length === 0;
  if (state === "cited") return targetCited;
  // `mentioned` means the brand appeared in prose while the site was not cited;
  // `cited_others_only` means somebody else was. Both require the target absent.
  if (targetCited) return false;
  if (state === "cited_others_only") return citedHosts.length > 0;
  return true;
}

/**
 * Recompute the aggregate from the samples and reject any disagreement.
 *
 * The counts are the report's headline claim, so they are verified rather than
 * trusted: a client that received a hand-edited or partially-migrated payload
 * would otherwise render a denominator the samples do not support.
 */
function isAggregateOf(
  value: unknown,
  samples: readonly GeoSample[],
): value is GeoQuestionAggregate {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "admissibleSamples",
      "targetCitedIn",
      "targetMentionedIn",
      "verdict",
    ]) ||
    !isNonNegativeInteger(value.admissibleSamples) ||
    !isNonNegativeInteger(value.targetCitedIn) ||
    !isNonNegativeInteger(value.targetMentionedIn)
  ) {
    return false;
  }

  const admissible = samples.filter((sample) =>
    ADMISSIBLE_STATES.has(sample.state),
  ).length;
  const cited = samples.filter((sample) => sample.state === "cited").length;
  const mentioned = samples.filter(
    (sample) => sample.state === "mentioned",
  ).length;

  if (
    value.admissibleSamples !== admissible ||
    value.targetCitedIn !== cited ||
    value.targetMentionedIn !== mentioned
  ) {
    return false;
  }

  return value.verdict === geoQuestionVerdict(admissible, cited);
}

/**
 * The only place a verdict is decided.
 *
 * Exported so the server derives it with the same rule the guard checks
 * against; a second implementation is how the two drift.
 */
export function geoQuestionVerdict(
  admissibleSamples: number,
  targetCitedIn: number,
): GeoQuestionVerdict {
  if (admissibleSamples === 0) return "inconclusive";
  if (targetCitedIn === 0) return "not_observed";
  return targetCitedIn === admissibleSamples ? "stable_cited" : "intermittent";
}

function isQuestion(
  value: unknown,
  targetHost: string,
): value is GeoQuestionObservation {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["questionId", "question", "samples", "aggregate"]) ||
    !isNonEmptyString(value.questionId, 64) ||
    !isNonEmptyString(value.question, GEO_MAX_QUESTION_LENGTH) ||
    !Array.isArray(value.samples) ||
    value.samples.length !== GEO_SAMPLES_PER_QUESTION ||
    !value.samples.every((sample) => isSample(sample, targetHost))
  ) {
    return false;
  }

  const indexes = value.samples.map((sample) => sample.sampleIndex);
  if (new Set(indexes).size !== GEO_SAMPLES_PER_QUESTION) return false;

  return isAggregateOf(value.aggregate, value.samples);
}

/**
 * Recompute coverage from the questions, including its availability word.
 *
 * `samplesObserved` counts admissible samples only. The two excluded states are
 * reported as their own totals so the report can show the true denominator
 * ("24 attempted / 21 observed / 2 not searched / 1 unavailable") rather than
 * silently shrinking the base it divides by.
 */
function isCoverageOf(
  value: unknown,
  questions: readonly GeoQuestionObservation[],
): value is GeoCoverage {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "questionsRequested",
      "samplesAttempted",
      "samplesObserved",
      "samplesSearchNotPerformed",
      "samplesUnavailable",
      "availability",
    ]) ||
    !isNonNegativeInteger(value.questionsRequested) ||
    !isNonNegativeInteger(value.samplesAttempted) ||
    !isNonNegativeInteger(value.samplesObserved) ||
    !isNonNegativeInteger(value.samplesSearchNotPerformed) ||
    !isNonNegativeInteger(value.samplesUnavailable)
  ) {
    return false;
  }

  const samples = questions.flatMap((question) => question.samples);
  const observed = samples.filter((sample) =>
    ADMISSIBLE_STATES.has(sample.state),
  ).length;
  const notSearched = samples.filter(
    (sample) => sample.state === "search_not_performed",
  ).length;
  const unavailable = samples.filter(
    (sample) => sample.state === "unavailable",
  ).length;

  if (
    value.questionsRequested !== questions.length ||
    value.samplesAttempted !== samples.length ||
    value.samplesObserved !== observed ||
    value.samplesSearchNotPerformed !== notSearched ||
    value.samplesUnavailable !== unavailable
  ) {
    return false;
  }

  return (
    value.availability === geoCoverageAvailability(samples.length, observed)
  );
}

/** Exported for the same reason as {@link geoQuestionVerdict}. */
export function geoCoverageAvailability(
  samplesAttempted: number,
  samplesObserved: number,
): GeoCoverageAvailability {
  if (samplesObserved === 0) return "unavailable";
  return samplesObserved === samplesAttempted ? "available" : "partial";
}

function isProvider(value: unknown): value is GeoProviderProvenance {
  return (
    isObject(value) &&
    hasExactKeys(value, [
      "tool",
      "model",
      "marketCode",
      "languageCode",
      "samplesPerQuestion",
      "costUsd",
    ]) &&
    value.tool === "dataforseo_chat_gpt_llm_responses" &&
    isNonEmptyString(value.model, 100) &&
    typeof value.marketCode === "string" &&
    /^[A-Z]{2}$/.test(value.marketCode) &&
    isNonEmptyString(value.languageCode, 35) &&
    value.samplesPerQuestion === GEO_SAMPLES_PER_QUESTION &&
    typeof value.costUsd === "number" &&
    Number.isFinite(value.costUsd) &&
    value.costUsd >= 0
  );
}

function isRun(value: unknown): value is GeoReportRun {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "agent",
      "mode",
      "persistence",
      "schemaVersion",
      "sampledAt",
      "expiresAt",
      "targetHost",
      "provider",
    ]) ||
    value.agent !== "geo" ||
    value.mode !== "authenticated_agent" ||
    value.persistence !== "expiring" ||
    value.schemaVersion !== AGENT_GEO_REPORT_SCHEMA_VERSION ||
    !isCanonicalIsoTimestamp(value.sampledAt) ||
    !isCanonicalIsoTimestamp(value.expiresAt) ||
    !isNormalizedHost(value.targetHost) ||
    !isProvider(value.provider)
  ) {
    return false;
  }
  // An expiry at or before the sampling instant would render a report that is
  // already gone, which is a contradiction rather than an edge case.
  return Date.parse(value.expiresAt) > Date.parse(value.sampledAt);
}

export function isGeoReportSuccessEnvelope(
  value: unknown,
): value is GeoReportSuccessEnvelope {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["data"]) ||
    !isObject(value.data) ||
    !hasExactKeys(value.data, ["run", "coverage", "questions"]) ||
    !isRun(value.data.run)
  ) {
    return false;
  }

  const { targetHost } = value.data.run;
  const questions = value.data.questions;
  if (
    !Array.isArray(questions) ||
    questions.length === 0 ||
    questions.length > GEO_QUESTIONS_PER_RUN ||
    !questions.every((question) => isQuestion(question, targetHost))
  ) {
    return false;
  }

  const ids = questions.map((question) => question.questionId);
  if (new Set(ids).size !== ids.length) return false;

  return isCoverageOf(value.data.coverage, questions);
}
