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

/**
 * Why a sample carries no observation, as a code rather than a sentence.
 *
 * A sentence written here reaches the report verbatim, so an English one lands
 * untranslated in the middle of an otherwise Chinese page — and these are the
 * lines that explain why a sample was excluded from the denominator, which is
 * the honesty claim the whole report rests on. The client renders the code.
 */
export type GeoSampleLimitation =
  | "time_budget"
  | "cost_ceiling"
  | "provider_not_configured"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_auth_failed"
  | "provider_no_answer"
  | "provider_failed";

const SAMPLE_LIMITATIONS = new Set<GeoSampleLimitation>([
  "time_budget",
  "cost_ceiling",
  "provider_not_configured",
  "provider_timeout",
  "provider_rate_limited",
  "provider_auth_failed",
  "provider_no_answer",
  "provider_failed",
]);

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
  readonly limitation: GeoSampleLimitation | null;
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
   * Nothing is stored, exactly like every other marketing Agent.
   *
   * A GEO run bills 24 provider calls, so losing it to a closed tab is a real
   * cost and durable storage is genuinely wanted — but until a store exists,
   * this field says `none`, because a payload that announces an expiry it
   * cannot honour is a promise to the visitor that the code does not keep.
   * Adding the store is what changes this literal, not the other way round.
   */
  readonly persistence: "none";
  readonly schemaVersion: typeof AGENT_GEO_REPORT_SCHEMA_VERSION;
  readonly sampledAt: string;
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
 * Reduce a URL or bare host to the form the report compares on.
 *
 * Lives here, beside the guard that validates the result, because a producer
 * with its own copy of this logic is how a paid run ends in a 502: the sampler
 * emitted a host its own guard then refused, and 24 billed answers were
 * discarded over a spelling. Every caller must use this one function.
 *
 * `www.` is stripped repeatedly and the DNS root dot removed, because a
 * target-host comparison that fails on `www.www.acme.test` or `acme.test.` is
 * indistinguishable from a site that was genuinely not cited — the exact
 * confusion this report exists to remove.
 */
export function normalizeReportHost(value: string): string | null {
  let hostname: string;
  if (/^[a-z][a-z\d+.-]*:/iu.test(value)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    hostname = parsed.hostname;
  } else {
    hostname = value;
  }

  let host = hostname.toLowerCase().replace(/\.+$/u, "");
  while (host.startsWith("www.")) host = host.slice(4);
  if (
    host.length === 0 ||
    host.length > 253 ||
    !host.includes(".") ||
    host.includes("/") ||
    host.includes(":") ||
    host.includes(" ")
  ) {
    return null;
  }
  return host;
}

/** Exactly the shape {@link normalizeReportHost} produces, and nothing else. */
function isNormalizedHost(value: unknown): value is string {
  return isNonEmptyString(value, 253) && normalizeReportHost(value) === value;
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

/**
 * Most distinct hosts one sample may report.
 *
 * Exported so the producer truncates to the same number the guard enforces.
 * When only the guard knew it, an unusually wide answer — calibration already
 * saw one cite 14 hosts — made the guard refuse the whole envelope and turned
 * 24 billed answers into a 502.
 */
export const GEO_MAX_CITED_HOSTS_PER_SAMPLE = 40;

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
    !isUniqueNormalizedHosts(
      value.citedHosts,
      GEO_MAX_CITED_HOSTS_PER_SAMPLE,
    ) ||
    !isUniqueNormalizedHosts(
      value.competitorHosts,
      GEO_MAX_CITED_HOSTS_PER_SAMPLE,
    ) ||
    (value.limitation !== null &&
      !SAMPLE_LIMITATIONS.has(value.limitation as GeoSampleLimitation))
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
  // `cited_others_only` means somebody else was. Both require the target absent
  // AND at least one citation: an answer that cited nobody is
  // `answer_had_no_citations`, which is the state the classifier produces for
  // it. Accepting a citation-free `mentioned` here would let a hand-assembled
  // payload report a mention count the sampler can never produce, and the guard
  // exists precisely to make those two agree.
  if (targetCited || citedHosts.length === 0) return false;
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
  // Two, not one. A single usable sample cannot support "cited every time" or
  // "not cited" — that is the whole premise of sampling three times, and
  // emitting either verdict off n=1 would state exactly the inference the
  // measured empty intersection says is unavailable. A partial run reports
  // `inconclusive` and still shows its raw "N of M" underneath.
  if (admissibleSamples < 2) return "inconclusive";
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
      "targetHost",
      "provider",
    ]) ||
    value.agent !== "geo" ||
    value.mode !== "authenticated_agent" ||
    value.persistence !== "none" ||
    value.schemaVersion !== AGENT_GEO_REPORT_SCHEMA_VERSION ||
    !isCanonicalIsoTimestamp(value.sampledAt) ||
    !isNormalizedHost(value.targetHost) ||
    !isProvider(value.provider)
  ) {
    return false;
  }
  return true;
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
