// @input  -- GEO run values crossing from the server to Agent clients
// @output -- the v3 orthogonal observation contract and its strict browser-safe guard
// @pos    -- public wire contract for the sampled GEO observation report

import {
  hasArrayHole,
  isGeoDigest,
  normalizeGeoText,
} from "./geo-canonical.ts";
import { isGeoCountryCode } from "./geo-context.ts";
import {
  findGeoTemplate,
  isGeoTemplateRendering,
  isGeoTemplateShippable,
} from "./geo-template-registry.ts";
import {
  deriveGeoRunCoverage,
  deriveProbeStatus,
  isSameGeoCounts,
  isSameGeoCoverage,
  type GeoObservationCounts,
  type GeoRunCoverageV3,
} from "./geo-report-derive.ts";
import type {
  GeoBrandStance,
  GeoQueryMode,
  GeoQuerySlot,
} from "./geo-query-contract.ts";
import {
  isNormalizedGeoCitationUrl,
  isNormalizedGeoHost,
  geoCitationDomain,
} from "./geo-url.ts";

/**
 * v3 replaces the mutually exclusive sample state with orthogonal fields.
 *
 * The literal is bumped rather than extended because a v2 client recomputes the
 * old rule, disagrees with the new payload and refuses it — correctly, since it
 * cannot render a report whose headline word its own rule does not produce. The
 * server checks this literal on the REQUEST, before any provider call, so a tab
 * left open across a deploy is told to reload instead of being billed for
 * eighteen answers it would then discard.
 *
 * What changed, and why one field could not carry it: the old `GeoSampleState`
 * merged "the model answered without searching" with "the model searched and
 * cited nobody" into one ladder, so an answer that named the brand while
 * answering from memory had nowhere to be recorded. Search execution, citation
 * evaluability, mention, prompt conditioning and recommendation are five
 * independent facts, and the contract now says so.
 */
export const AGENT_GEO_REPORT_SCHEMA_VERSION = "agent_geo_report.v3" as const;

/** Hash domain for the report content fingerprint. */
export const GEO_REPORT_CONTENT_HASH_DOMAIN = "geo_report_content.v1";

/**
 * Whether the provider produced an answer this run could read.
 *
 * Deliberately not `callStatus`. A `no_usable_answer` sample may have been
 * dispatched, completed and billed — three of eight calibration calls at a 1024
 * output ceiling looked exactly like that — so a name suggesting the call did
 * not happen would be wrong in the one direction that costs money.
 */
export type GeoAnswerStatus = "answered" | "no_usable_answer";

/**
 * What a retrieval probe's own samples say about its instrumentation.
 *
 * A retrieval probe exists because somebody paid to measure that its exact
 * wording reaches the live web. When a live run's samples show it did not, that
 * is an instrumentation failure, not an observation about the customer — so a
 * `trigger_failed` probe never enters a citation denominator and the run renders
 * as degraded. Derived after the whole immutable plan has run; P0 does not stop
 * a failing probe mid-run.
 */
export type GeoProbeStatus =
  | "valid"
  | "trigger_failed"
  | "degraded_mixed_trigger"
  | "provider_failed";

/**
 * What this sample's annotations showed.
 *
 * There is deliberately no `not_applicable`. Even an answer written without a
 * web search can be inspected for annotations, and finding none is a fact about
 * that answer. The report layer stratifies these counts by whether a search
 * actually ran, so an unsearched `observed_none` never reads as "searched you
 * and ignored you".
 */
export type GeoCitationStatus =
  | "observed_target"
  | "observed_others_only"
  | "observed_none"
  | "unavailable";

export type GeoMentionStatus = "observed" | "not_observed" | "unavailable";

/**
 * Whether a mention could have been evidence of anything.
 *
 * A prompted answer repeating a brand the question already named is tautology,
 * not discovery. Only `unprompted` observations may feed a discovery or
 * consideration reading; prompted ones measure comparative framing and which
 * sources the model reaches for to describe the brand.
 */
export type GeoMentionEligibility = "unprompted" | "prompted";

/** Wider taxonomy arrives only through the §7.3 evaluator gate. */
export type GeoRecommendationStatus = "not_evaluated";

/**
 * Why a sample carries less than a full observation, as a code rather than a
 * sentence.
 *
 * A sentence written here reaches the report verbatim, so an English one lands
 * untranslated in the middle of an otherwise Chinese page — and these are the
 * lines that explain why a sample was excluded from a denominator, which is the
 * honesty claim the whole report rests on.
 *
 * The four provider/transport codes are kept apart on purpose.
 * `provider_no_answer` means the call succeeded and produced nothing usable;
 * `provider_error` means the provider said no; `transport_error` means the
 * request demonstrably failed; `transport_outcome_unknown` means a timeout or
 * abort left it genuinely unknown whether the provider received, answered and
 * billed the call. Only the last one makes a retry a possible nineteenth
 * charge, which is why it is never merged into the others.
 */
export const GEO_SAMPLE_LIMITATION_CODES = [
  "time_budget",
  "cost_ceiling",
  "provider_not_configured",
  "provider_no_answer",
  "provider_error",
  "transport_error",
  "transport_outcome_unknown",
  "citation_extraction_incomplete",
  "alias_matcher_out_of_scope",
  "retrieval_trigger_failed",
] as const;

export type GeoSampleLimitationCode =
  (typeof GEO_SAMPLE_LIMITATION_CODES)[number];

const SAMPLE_LIMITATIONS: ReadonlySet<string> = new Set(
  GEO_SAMPLE_LIMITATION_CODES,
);

/** Limitations that describe the run rather than one sample. */
export const GEO_RUN_LIMITATION_CODES = [
  "report_contents_not_persisted",
  "no_paired_recheck",
  "single_surface_chat_gpt_via_dataforseo",
  "sentinel_cohort_not_full_coverage",
  "degraded_retrieval_trigger",
  "partial_run",
  "cost_incomplete",
  "cost_ceiling_reached",
  "outside_calibrated_market",
  "recommendation_not_evaluated",
] as const;

export type GeoRunLimitationCode = (typeof GEO_RUN_LIMITATION_CODES)[number];

const RUN_LIMITATIONS: ReadonlySet<string> = new Set(GEO_RUN_LIMITATION_CODES);

/**
 * A citation the answer actually carried.
 *
 * `annotationText` is the anchor the answer itself contains — usually a markdown
 * link. It is not an excerpt of the page it points at, and the report is never
 * allowed to render it as one.
 */
export interface GeoCitationEvidenceRefV1 {
  readonly kind: "cited";
  readonly evidenceId: string;
  readonly exactUrl: string;
  /** Always recomputed from exactUrl; never trusted separately. */
  readonly domain: string;
  readonly title: string | null;
  readonly annotationText: string | null;
  readonly providerOutputItemIndex: number;
  readonly sectionIndex: number;
  readonly startIndex: number | null;
  readonly endIndex: number | null;
  /**
   * `target` or `unknown`, and nothing else.
   *
   * `target` is exact canonical-host equality under the rule shown to the
   * visitor before payment. There is no honest way to decide from a URL alone
   * whether some other host is a competitor, a marketplace or a blog, so
   * `observed_others_only` means "valid citations exist and none used the
   * target host" — it asserts nothing about who owns those URLs.
   */
  readonly ownership: "target" | "unknown";
  readonly sourceType: "owned_page" | "unknown";
}

/**
 * The brand appearing in the answer's own prose.
 *
 * Its own subtype with its own field, because a mention is not a citation and
 * the report must never let one be rendered as the other. It carries no URL, no
 * `annotationText` and no provider citation coordinates — the shape makes the
 * confusion impossible rather than relying on the renderer to avoid it.
 */
export interface GeoMentionEvidenceRefV1 {
  readonly kind: "mention";
  readonly evidenceId: string;
  readonly matchedAlias: string;
  /** Bounded excerpt of the model's answer; not a citation, not source text. */
  readonly mentionSnippet: string | null;
  readonly snippetBasis: "provider_answer_text";
}

export type GeoEvidenceRefV1 =
  | GeoCitationEvidenceRefV1
  | GeoMentionEvidenceRefV1;

export interface GeoSampleV3 {
  readonly sampleId: string;
  /** 1-based position in this question's own sample sequence. */
  readonly sampleIndex: number;
  readonly answerStatus: GeoAnswerStatus;
  readonly observedAt: string | null;
  readonly webSearchPerformed: boolean | null;
  /** Non-null exactly for retrieval-probe samples. */
  readonly probeStatus: GeoProbeStatus | null;
  readonly citationStatus: GeoCitationStatus;
  readonly mentionStatus: GeoMentionStatus;
  readonly mentionEligibility: GeoMentionEligibility;
  readonly recommendationStatus: GeoRecommendationStatus;
  readonly evidence: readonly GeoEvidenceRefV1[];
  readonly limitations: readonly GeoSampleLimitationCode[];
}

export interface GeoQuestionObservationV3 {
  readonly queryId: string;
  readonly slot: GeoQuerySlot;
  readonly text: string;
  readonly mode: GeoQueryMode;
  readonly brandStance: GeoBrandStance;
  readonly samplesPlanned: number;
  readonly templateId: string | null;
  readonly templateVersion: string | null;
  readonly samples: readonly GeoSampleV3[];
  readonly counts: GeoObservationCounts;
}

/**
 * What surface produced these observations, stated in parts.
 *
 * One "provider" label would let a DataForSEO API answer be rendered as if a
 * visitor had asked ChatGPT Pro themselves. Collector, upstream, surface, model
 * requested, model observed, search permission, market, calibration scope and
 * output ceiling are separate facts and at least one of them is always the one
 * a reader needs.
 */
export interface GeoSurfaceProvenanceV1 {
  readonly collector: "dataforseo";
  readonly upstream: "openai";
  readonly surface: "dataforseo_chat_gpt_llm_responses_api";
  /** Permission, not proof of execution. */
  readonly searchModeRequested: "web_search_permitted";
  readonly modelRequested: string;
  /** Labels returned by the collector; not independently verified identity. */
  readonly modelObserved: readonly string[];
  /** Run-identity fact: 1024 measurably starves about a third of answers. */
  readonly maxOutputTokensRequested: 4_096;
  readonly webSearchCountryIsoCodeRequested: string;
  readonly calibrationMarket: "US";
  readonly triggerCalibrationScope:
    | "calibrated_market"
    | "outside_calibrated_market";
  /** Language of the query text (§2.8); the provider has no language parameter. */
  readonly queryLanguageTag: "en";
  readonly retrievalSamplesPerProbe: 3;
  readonly naturalDemandSamplesPerQuery: 1;
  /**
   * Cost in integer micro-USD, plus whether the total is whole.
   *
   * Integers because a required `costUsd: number` total would pressure a null
   * per-call price into a zero, and "unavailable is not zero" is the house's
   * oldest red line. A total is rendered as an actual cost only when
   * `costComplete` is true.
   */
  readonly knownCostUsdMicros: number;
  readonly costComplete: boolean;
  readonly unknownCostSamples: number;
}

export interface GeoReportRunV3 {
  readonly agent: "geo";
  readonly mode: "authenticated_agent";
  /**
   * The exact persistence claim, as a literal.
   *
   * Not `none`. Report contents, provider answers and evidence are genuinely
   * not stored server-side, but the existing credits system does retain minimal
   * billing and quota metadata, and a payload announcing "none" would be making
   * a promise the deployment does not keep.
   */
  readonly persistence: "report_contents_not_persisted";
  readonly schemaVersion: typeof AGENT_GEO_REPORT_SCHEMA_VERSION;
  /** Ephemeral identity binding a report to the actions and packet built on it. */
  readonly runId: string;
  readonly sampledAt: string;
  readonly targetHost: string;
  readonly contextHash: string;
  readonly querySetContentHash: string;
  readonly provenance: GeoSurfaceProvenanceV1;
  readonly reportContentHash: string;
}

export interface GeoReportDataV3 {
  readonly run: GeoReportRunV3;
  readonly coverage: GeoRunCoverageV3;
  readonly questions: readonly GeoQuestionObservationV3[];
  readonly limitations: readonly GeoRunLimitationCode[];
}

export interface GeoReportSuccessEnvelope {
  readonly data: GeoReportDataV3;
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

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    normalizeGeoText(value) === value
  );
}

function isUniqueCodeList(
  value: unknown,
  allowed: ReadonlySet<string>,
  maxItems: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((entry) => typeof entry === "string" && allowed.has(entry)) &&
    new Set(value).size === value.length
  );
}

const CITATION_EVIDENCE_KEYS = [
  "kind",
  "evidenceId",
  "exactUrl",
  "domain",
  "title",
  "annotationText",
  "providerOutputItemIndex",
  "sectionIndex",
  "startIndex",
  "endIndex",
  "ownership",
  "sourceType",
] as const;

const MENTION_EVIDENCE_KEYS = [
  "kind",
  "evidenceId",
  "matchedAlias",
  "mentionSnippet",
  "snippetBasis",
] as const;

/** Longest verbatim provider strings the report will carry. */
export const GEO_MAX_EVIDENCE_TITLE_LENGTH = 300;
export const GEO_MAX_EVIDENCE_ANNOTATION_LENGTH = 400;
/**
 * Exported so the producer bounds the snippet against this number rather than
 * its own copy of it. A second literal here is how the producer and this guard
 * come to disagree about what fits, and disagreement voids a paid run.
 */
export const GEO_MAX_MENTION_SNIPPET_LENGTH = 600;
export const GEO_MAX_EVIDENCE_PER_SAMPLE = 41;

function isCitationEvidence(value: UnknownObject, targetHost: string): boolean {
  if (
    !hasExactKeys(value, CITATION_EVIDENCE_KEYS) ||
    !isBoundedText(value.evidenceId, 96) ||
    !isNormalizedGeoCitationUrl(value.exactUrl) ||
    !isNonNegativeInteger(value.providerOutputItemIndex) ||
    !isNonNegativeInteger(value.sectionIndex) ||
    (value.title !== null &&
      !isBoundedText(value.title, GEO_MAX_EVIDENCE_TITLE_LENGTH)) ||
    (value.annotationText !== null &&
      !isBoundedText(value.annotationText, GEO_MAX_EVIDENCE_ANNOTATION_LENGTH))
  ) {
    return false;
  }

  // Recomputed here, never compared as a string the producer supplied. A
  // `domain` that could disagree with the link beside it would be a
  // disagreement in the one place the report claims to be exact.
  if (geoCitationDomain(value.exactUrl) !== value.domain) return false;

  const bothNull = value.startIndex === null && value.endIndex === null;
  const bothSet =
    isNonNegativeInteger(value.startIndex) &&
    isNonNegativeInteger(value.endIndex) &&
    (value.startIndex as number) <= (value.endIndex as number);
  if (!bothNull && !bothSet) return false;

  const isTarget = value.domain === targetHost;
  if (value.ownership !== (isTarget ? "target" : "unknown")) return false;
  return value.sourceType === (isTarget ? "owned_page" : "unknown");
}

function isMentionEvidence(value: UnknownObject): boolean {
  return (
    hasExactKeys(value, MENTION_EVIDENCE_KEYS) &&
    isBoundedText(value.evidenceId, 96) &&
    isBoundedText(value.matchedAlias, 80) &&
    (value.mentionSnippet === null ||
      isBoundedText(value.mentionSnippet, GEO_MAX_MENTION_SNIPPET_LENGTH)) &&
    value.snippetBasis === "provider_answer_text"
  );
}

function isEvidence(value: unknown, targetHost: string): boolean {
  if (!isObject(value)) return false;
  if (value.kind === "cited") return isCitationEvidence(value, targetHost);
  if (value.kind === "mention") return isMentionEvidence(value);
  // There is no `kind: "evaluation"` in P0, and a payload inventing one is a
  // payload claiming an evaluator this build does not have.
  return false;
}

const SAMPLE_KEYS = [
  "sampleId",
  "sampleIndex",
  "answerStatus",
  "observedAt",
  "webSearchPerformed",
  "probeStatus",
  "citationStatus",
  "mentionStatus",
  "mentionEligibility",
  "recommendationStatus",
  "evidence",
  "limitations",
] as const;

const PROBE_STATUSES: ReadonlySet<string> = new Set<GeoProbeStatus>([
  "valid",
  "trigger_failed",
  "degraded_mixed_trigger",
  "provider_failed",
]);

/**
 * The codes that say a planned call produced nothing usable.
 *
 * Exactly one of them appears on a failed sample, and none appears on an
 * answered one. `provider_error` means the provider definitively said no;
 * `transport_outcome_unknown` means it is genuinely unknown whether the call
 * arrived, answered and billed. A sample carrying both is a sample that cannot
 * be reconciled against an invoice.
 */
const FAILURE_CAUSE_CODES: readonly GeoSampleLimitationCode[] = [
  "time_budget",
  "cost_ceiling",
  "provider_not_configured",
  "provider_no_answer",
  "provider_error",
  "transport_error",
  "transport_outcome_unknown",
];

const CITATION_STATUSES: ReadonlySet<string> = new Set<GeoCitationStatus>([
  "observed_target",
  "observed_others_only",
  "observed_none",
  "unavailable",
]);

/**
 * Validate one sample, including the combinations that must be impossible.
 *
 * The per-sample invariants are where a hand-edited or half-migrated payload is
 * caught: an `observed_target` with no target citation, a failed call carrying
 * evidence, a mention record on a sample whose mention status says the matcher
 * could not read the alias set.
 */
function isSample(
  value: unknown,
  targetHost: string,
  mode: GeoQueryMode,
  samplesPlanned: number,
): value is GeoSampleV3 {
  if (
    !isObject(value) ||
    !hasExactKeys(value, SAMPLE_KEYS) ||
    !isBoundedText(value.sampleId, 96) ||
    !isNonNegativeInteger(value.sampleIndex) ||
    (value.sampleIndex as number) < 1 ||
    (value.sampleIndex as number) > samplesPlanned ||
    (value.answerStatus !== "answered" &&
      value.answerStatus !== "no_usable_answer") ||
    typeof value.citationStatus !== "string" ||
    !CITATION_STATUSES.has(value.citationStatus) ||
    (value.mentionStatus !== "observed" &&
      value.mentionStatus !== "not_observed" &&
      value.mentionStatus !== "unavailable") ||
    (value.mentionEligibility !== "prompted" &&
      value.mentionEligibility !== "unprompted") ||
    value.recommendationStatus !== "not_evaluated" ||
    !isUniqueCodeList(
      value.limitations,
      SAMPLE_LIMITATIONS,
      GEO_SAMPLE_LIMITATION_CODES.length,
    ) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > GEO_MAX_EVIDENCE_PER_SAMPLE ||
    !value.evidence.every((entry) => isEvidence(entry, targetHost))
  ) {
    return false;
  }

  // Non-null exactly for retrieval probes. A natural-demand sample carrying a
  // probe status would be claiming an instrumentation verdict about a question
  // that was never instrumented for retrieval.
  if (mode === "retrieval_probe") {
    if (
      typeof value.probeStatus !== "string" ||
      !PROBE_STATUSES.has(value.probeStatus)
    ) {
      return false;
    }
  } else if (value.probeStatus !== null) {
    return false;
  }

  const evidence = value.evidence as readonly GeoEvidenceRefV1[];
  const citations = evidence.filter(
    (entry): entry is GeoCitationEvidenceRefV1 => entry.kind === "cited",
  );
  const mentions = evidence.filter(
    (entry): entry is GeoMentionEvidenceRefV1 => entry.kind === "mention",
  );
  if (mentions.length > 1) return false;

  const limitations = value.limitations as readonly GeoSampleLimitationCode[];
  const causes = limitations.filter((code) =>
    FAILURE_CAUSE_CODES.includes(code),
  );

  if (value.answerStatus === "no_usable_answer") {
    return (
      value.observedAt === null &&
      value.webSearchPerformed === null &&
      value.citationStatus === "unavailable" &&
      value.mentionStatus === "unavailable" &&
      evidence.length === 0 &&
      // Exactly one kind of nothing, and nothing else. Two causes cannot both
      // be true — a definitive provider refusal and an unknown transport
      // outcome are different facts about whether the call was billed — and a
      // failed call cannot also carry an unreadable-annotation or
      // matcher-scope limitation, because it had no answer to inspect.
      causes.length === 1 &&
      limitations.length === 1
    );
  }

  // An answered sample cannot also carry a reason it produced no answer.
  if (causes.length > 0) return false;

  if (
    !isCanonicalIsoTimestamp(value.observedAt) ||
    typeof value.webSearchPerformed !== "boolean"
  ) {
    return false;
  }

  const targetCitations = citations.filter(
    (entry) => entry.ownership === "target",
  );
  switch (value.citationStatus) {
    case "observed_target":
      if (targetCitations.length === 0) return false;
      break;
    case "observed_others_only":
      if (citations.length === 0 || targetCitations.length > 0) return false;
      break;
    case "observed_none":
      if (citations.length > 0) return false;
      break;
    case "unavailable":
      // All-or-nothing: a partly-read annotation list must not let
      // `observed_none` or `observed_others_only` overclaim.
      if (citations.length > 0) return false;
      break;
    default:
      return false;
  }

  // An "if and only if", not a one-way implication. Admitting that the
  // annotation list could not be read while still publishing "cited nobody" is
  // exactly the unavailable-as-zero failure the report exists to avoid.
  if (
    limitations.includes("citation_extraction_incomplete") !==
    (value.citationStatus === "unavailable")
  ) {
    return false;
  }

  if (value.mentionStatus === "observed" && mentions.length !== 1) return false;
  if (value.mentionStatus !== "observed" && mentions.length !== 0) return false;
  // "The matcher cannot answer" and "the answer did not name you" are different
  // facts, and only one of them is about the customer. Enforced both ways: an
  // `unavailable` mention must say which limit produced it, and a sample
  // admitting the matcher was out of scope may not also report `not_observed`.
  if (
    limitations.includes("alias_matcher_out_of_scope") !==
    (value.mentionStatus === "unavailable")
  ) {
    return false;
  }

  // Sample-level, because evaluability is judged per sample: a retrieval sample
  // that answered without searching leaves the citation denominator, and it may
  // not leave without saying so. A mixed-trigger probe therefore marks only the
  // calls that actually failed to trigger.
  if (
    limitations.includes("retrieval_trigger_failed") !==
    (value.probeStatus !== null && value.webSearchPerformed === false)
  ) {
    return false;
  }

  return true;
}

const QUESTION_KEYS = [
  "queryId",
  "slot",
  "text",
  "mode",
  "brandStance",
  "samplesPlanned",
  "templateId",
  "templateVersion",
  "samples",
  "counts",
] as const;

const MODES: ReadonlySet<string> = new Set<GeoQueryMode>([
  "natural_demand",
  "retrieval_probe",
]);
const STANCES: ReadonlySet<string> = new Set<GeoBrandStance>([
  "unbranded",
  "brand",
  "mixed",
]);
const SLOTS: ReadonlySet<string> = new Set<GeoQuerySlot>([
  "category_discovery",
  "jtbd_outcome",
  "pain_how_to",
  "constraint_fit",
  "alternative_status_quo",
  "brand_comparison",
  "due_diligence",
  "negative_fit_objection",
]);

function isQuestion(
  value: unknown,
  targetHost: string,
): value is GeoQuestionObservationV3 {
  if (
    !isObject(value) ||
    !hasExactKeys(value, QUESTION_KEYS) ||
    !isBoundedText(value.queryId, 64) ||
    typeof value.slot !== "string" ||
    !SLOTS.has(value.slot) ||
    !isBoundedText(value.text, 500) ||
    typeof value.mode !== "string" ||
    !MODES.has(value.mode) ||
    typeof value.brandStance !== "string" ||
    !STANCES.has(value.brandStance) ||
    (value.samplesPlanned !== 1 && value.samplesPlanned !== 3) ||
    !Array.isArray(value.samples)
  ) {
    return false;
  }

  const mode = value.mode as GeoQueryMode;
  const planned = value.samplesPlanned as number;
  const expected = mode === "retrieval_probe" ? 3 : 1;
  if (planned !== expected) return false;
  // Every planned slot produces exactly one record, successful or not. A run
  // that simply omitted a failed call would shrink its own denominator.
  if (value.samples.length !== planned) return false;
  if (
    !value.samples.every((sample) =>
      isSample(sample, targetHost, mode, planned),
    )
  ) {
    return false;
  }

  const samples = value.samples as readonly GeoSampleV3[];
  const indexes = samples.map((sample) => sample.sampleIndex);
  if (new Set(indexes).size !== planned) return false;

  if (mode === "retrieval_probe") {
    // Recomputed, not read. A payload claiming `valid` for a probe whose three
    // answers never searched would suppress the degraded banner and put three
    // instrumentation failures into the citation denominator as if they were
    // observations about the customer.
    const expected = deriveProbeStatus(samples);
    if (samples.some((sample) => sample.probeStatus !== expected)) return false;
  }

  // Eligibility is derived from the question's own text, so every sample of one
  // question must agree. A set that mixed them could feed the same prompted
  // question into both the prompted and the unprompted denominator.
  const eligibilities = new Set(
    samples.map((sample) => sample.mentionEligibility),
  );
  if (eligibilities.size !== 1) return false;

  const linked = value.templateId !== null || value.templateVersion !== null;
  if (linked) {
    if (
      !isBoundedText(value.templateId, 64) ||
      !isBoundedText(value.templateVersion, 32)
    ) {
      return false;
    }
  }
  if (linked) {
    // Registry metadata is not identity. A valid calibrated id stapled to
    // arbitrary edited wording would launder unmeasured text as measured, so
    // the entry must own this slot, this mode, and the text must be a rendering
    // of its literal.
    const entry = findGeoTemplate(
      value.templateId as string,
      value.templateVersion as string,
    );
    if (entry === null) return false;
    if (
      !isGeoTemplateShippable(entry.templateId, entry.templateVersion, mode)
    ) {
      return false;
    }
    if (entry.slot !== value.slot) return false;
    if (!isGeoTemplateRendering(entry, value.text as string)) return false;
  }
  // The one claim this report makes that rests on paid measurement.
  if (mode === "retrieval_probe" && !linked) return false;

  // A question that names the customer cannot report its answers as unprompted
  // discovery. The converse is deliberately allowed: an alias set outside the
  // matcher's tested semantics falls back to `prompted`, which is the direction
  // that keeps a doubtful observation out of the discovery denominator.
  if (
    value.brandStance === "brand" &&
    samples.some((sample) => sample.mentionEligibility !== "prompted")
  ) {
    return false;
  }

  return isSameGeoCounts(value.counts, samples);
}

const PROVENANCE_KEYS = [
  "collector",
  "upstream",
  "surface",
  "searchModeRequested",
  "modelRequested",
  "modelObserved",
  "maxOutputTokensRequested",
  "webSearchCountryIsoCodeRequested",
  "calibrationMarket",
  "triggerCalibrationScope",
  "queryLanguageTag",
  "retrievalSamplesPerProbe",
  "naturalDemandSamplesPerQuery",
  "knownCostUsdMicros",
  "costComplete",
  "unknownCostSamples",
] as const;

function isProvenance(
  value: unknown,
  scheduledSamples: number,
  answeredSamples: number,
): value is GeoSurfaceProvenanceV1 {
  if (
    !isObject(value) ||
    !hasExactKeys(value, PROVENANCE_KEYS) ||
    value.collector !== "dataforseo" ||
    value.upstream !== "openai" ||
    value.surface !== "dataforseo_chat_gpt_llm_responses_api" ||
    value.searchModeRequested !== "web_search_permitted" ||
    !isBoundedText(value.modelRequested, 100) ||
    value.maxOutputTokensRequested !== 4_096 ||
    typeof value.webSearchCountryIsoCodeRequested !== "string" ||
    // The full ISO set, not a two-letter shape. "EU" and "ZZ" both match the
    // regular expression and neither is a country the provider can search in.
    !isGeoCountryCode(value.webSearchCountryIsoCodeRequested) ||
    value.calibrationMarket !== "US" ||
    (value.triggerCalibrationScope !== "calibrated_market" &&
      value.triggerCalibrationScope !== "outside_calibrated_market") ||
    value.queryLanguageTag !== "en" ||
    value.retrievalSamplesPerProbe !== 3 ||
    value.naturalDemandSamplesPerQuery !== 1
  ) {
    return false;
  }

  // The calibration was run with US market settings. A run for another country
  // may not claim its trigger behaviour was calibrated.
  const isUs = value.webSearchCountryIsoCodeRequested === "US";
  if (
    value.triggerCalibrationScope !==
    (isUs ? "calibrated_market" : "outside_calibrated_market")
  ) {
    return false;
  }

  if (
    !Array.isArray(value.modelObserved) ||
    value.modelObserved.length > 8 ||
    !value.modelObserved.every((entry) => isBoundedText(entry, 100)) ||
    new Set(value.modelObserved).size !== value.modelObserved.length
  ) {
    return false;
  }
  // Deterministically sorted, never in response arrival order: two identical
  // runs must produce identical payloads.
  const sorted = [...(value.modelObserved as readonly string[])].sort();
  if (
    (value.modelObserved as readonly string[]).some(
      (entry, index) => entry !== sorted[index],
    )
  ) {
    return false;
  }

  return (
    isNonNegativeInteger(value.knownCostUsdMicros) &&
    typeof value.costComplete === "boolean" &&
    isNonNegativeInteger(value.unknownCostSamples) &&
    (value.unknownCostSamples as number) <= scheduledSamples &&
    value.costComplete === ((value.unknownCostSamples as number) === 0) &&
    // A billed answer priced at exactly zero micros is not a measurement, it is
    // a missing price wearing one. The "unavailable is not zero" rule applies
    // at the cost boundary too.
    !(
      answeredSamples > 0 &&
      (value.knownCostUsdMicros as number) === 0 &&
      value.costComplete === true
    )
  );
}

const RUN_KEYS = [
  "agent",
  "mode",
  "persistence",
  "schemaVersion",
  "runId",
  "sampledAt",
  "targetHost",
  "contextHash",
  "querySetContentHash",
  "provenance",
  "reportContentHash",
] as const;

/**
 * Validate a whole report envelope.
 *
 * The honest boundary of this guard, which the UI must never overstate: it
 * recomputes counts, reference integrity, URL and domain relationships,
 * ownership against the target host, and the consistency of every status
 * combination. It cannot recompute whether the answer really mentioned the
 * brand or whether an annotation existed in the provider payload — those inputs
 * are server-only. "The browser independently verifies the observation" would
 * be false.
 */
export function isGeoReportSuccessEnvelope(
  value: unknown,
): value is GeoReportSuccessEnvelope {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["data"]) ||
    !isObject(value.data) ||
    !hasExactKeys(value.data, ["run", "coverage", "questions", "limitations"])
  ) {
    return false;
  }

  const run = value.data.run;
  if (
    !isObject(run) ||
    !hasExactKeys(run, RUN_KEYS) ||
    run.agent !== "geo" ||
    run.mode !== "authenticated_agent" ||
    run.persistence !== "report_contents_not_persisted" ||
    run.schemaVersion !== AGENT_GEO_REPORT_SCHEMA_VERSION ||
    !isBoundedText(run.runId, 64) ||
    !isCanonicalIsoTimestamp(run.sampledAt) ||
    !isNormalizedGeoHost(run.targetHost) ||
    !isGeoDigest(run.contextHash) ||
    !isGeoDigest(run.querySetContentHash) ||
    !isGeoDigest(run.reportContentHash)
  ) {
    return false;
  }

  const targetHost = run.targetHost;
  const questions = value.data.questions;
  if (
    !Array.isArray(questions) ||
    questions.length !== 8 ||
    hasArrayHole(questions) ||
    !questions.every((question) => isQuestion(question, targetHost))
  ) {
    return false;
  }

  const observations = questions as readonly GeoQuestionObservationV3[];
  const ids = observations.map((question) => question.queryId);
  if (new Set(ids).size !== ids.length) return false;
  // One observation per buyer decision. Duplicate slots would let one question
  // be asked twice while another was silently dropped, and the cohort would no
  // longer be the reproducible eight the report claims it is.
  const slots = observations.map((question) => question.slot);
  if (new Set(slots).size !== slots.length) return false;
  // Never more retrieval probes than the confirm step could have shown. Fewer
  // is legitimate: editing a probe demotes it to a one-sample natural question.
  const retrievalProbes = observations.filter(
    (question) => question.mode === "retrieval_probe",
  );
  if (retrievalProbes.length > 5) return false;

  const evidenceIds = observations.flatMap((question) =>
    question.samples.flatMap((sample) =>
      sample.evidence.map((entry) => entry.evidenceId),
    ),
  );
  if (new Set(evidenceIds).size !== evidenceIds.length) return false;

  const sampleIds = observations.flatMap((question) =>
    question.samples.map((sample) => sample.sampleId),
  );
  if (new Set(sampleIds).size !== sampleIds.length) return false;

  const scheduled = observations.reduce(
    (total, question) => total + question.samplesPlanned,
    0,
  );
  const answered = observations
    .flatMap((question) => question.samples)
    .filter((sample) => sample.answerStatus === "answered").length;
  if (!isProvenance(run.provenance, scheduled, answered)) return false;

  if (!isSameGeoCoverage(value.data.coverage, observations)) return false;
  const coverage = deriveGeoRunCoverage(observations);

  const limitations = value.data.limitations;
  if (!isUniqueCodeList(limitations, RUN_LIMITATIONS, RUN_LIMITATIONS.size)) {
    return false;
  }
  // A degraded run must say so. The banner in the report is driven by this
  // code, and a payload that hid it would render a broken run as a clean one.
  const degraded =
    coverage.triggerFailedProbes > 0 || coverage.degradedProbes > 0;
  if (
    degraded !==
    (limitations as readonly string[]).includes("degraded_retrieval_trigger")
  ) {
    return false;
  }
  const provenance = run.provenance as GeoSurfaceProvenanceV1;
  if (
    !provenance.costComplete !==
    (limitations as readonly string[]).includes("cost_incomplete")
  ) {
    return false;
  }

  // A call whose transport outcome is unknown may have been received, answered
  // and billed, so it cannot be missing from the unpriced count while the total
  // still calls itself complete.
  const unknownOutcomeSamples = observations
    .flatMap((question) => question.samples)
    .filter((sample) =>
      sample.limitations.includes("transport_outcome_unknown"),
    ).length;
  if (provenance.unknownCostSamples < unknownOutcomeSamples) return false;

  const outsideCalibration =
    provenance.triggerCalibrationScope === "outside_calibrated_market";
  if (
    outsideCalibration !==
    (limitations as readonly string[]).includes("outside_calibrated_market")
  ) {
    return false;
  }

  const partial = coverage.totals.unavailableSamples > 0;
  if (partial !== (limitations as readonly string[]).includes("partial_run")) {
    return false;
  }

  return true;
}
