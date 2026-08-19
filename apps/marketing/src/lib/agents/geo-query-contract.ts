// @input  -- a generated or edited GEO query set crossing the browser/server boundary
// @output -- the versioned query unit, its strict guard, and its content fingerprint
// @pos    -- the contract that decides what a paid GEO run is allowed to ask

import {
  canonicalGeoAssetTypes,
  isGeoAssetType,
  type GeoAssetType,
} from "./geo-asset-type.ts";
import {
  geoDomainHash,
  hasArrayHole,
  hasLoneSurrogate,
  isGeoDigest,
  normalizeGeoText,
  type GeoCanonicalValue,
} from "./geo-canonical.ts";
import {
  findGeoTemplate,
  isGeoTemplateRendering,
  isGeoTemplateShippable,
} from "./geo-template-registry.ts";

export const GEO_QUERY_SET_SCHEMA_VERSION = "geo_query_set.v1" as const;

/** Hash domain for the query-set content fingerprint (§5.2). */
export const GEO_QUERY_SET_CONTENT_HASH_DOMAIN = "geo_query_set_content.v1";

/**
 * Provider ceiling on one prompt.
 *
 * Counted twice, in characters and in UTF-8 bytes, because the provider's own
 * counting unit has never been verified: the documentation says 500 and the
 * error it returns says nothing more. A question of 500 characters containing
 * one accented letter is 501 bytes, and the conservative reading is the one
 * that cannot bill for a call the provider then refuses.
 */
export const GEO_MAX_QUERY_TEXT_LENGTH = 500;

/** How many core slots one paid run covers. */
export const GEO_CORE_QUERY_COUNT = 8;

/** Samples a retrieval probe takes: three, to expose citation variability. */
export const GEO_RETRIEVAL_SAMPLES = 3;

/**
 * Samples a natural-demand question takes: one.
 *
 * The uniform three-sample policy is deliberately broken. Three retrieval
 * samples buy information — the same question asked four times produced four
 * citation sets whose intersection was empty — while three repeats of a natural
 * question mostly repeat a non-observation for a brand the model has never
 * heard of. Three different natural questions asked once each buy intent
 * breadth instead, for the same money.
 */
export const GEO_NATURAL_DEMAND_SAMPLES = 1;

/**
 * The paid call count of one core_8 run.
 *
 * Five retrieval probes at three samples plus three natural-demand questions at
 * one. Shown to the visitor before the run starts and enforced by the server's
 * immutable execution plan, so the number on the button and the number on the
 * invoice are the same number.
 */
export const GEO_MAX_RETRIEVAL_PROBES = 5;

export const GEO_PLANNED_CALLS_PER_RUN =
  GEO_MAX_RETRIEVAL_PROBES * GEO_RETRIEVAL_SAMPLES +
  (GEO_CORE_QUERY_COUNT - GEO_MAX_RETRIEVAL_PROBES) * GEO_NATURAL_DEMAND_SAMPLES;

/**
 * The eight buyer-decision slots, in the order a run presents them.
 *
 * The order is part of the content fingerprint, so it is a schema fact rather
 * than a presentation choice.
 */
export const GEO_CORE_SLOTS = [
  "category_discovery",
  "jtbd_outcome",
  "pain_how_to",
  "constraint_fit",
  "alternative_status_quo",
  "brand_comparison",
  "due_diligence",
  "negative_fit_objection",
] as const;

export type GeoQuerySlot = (typeof GEO_CORE_SLOTS)[number];

/**
 * Whether the question is asked to observe citations or to observe demand.
 *
 * Not a quality ranking. A `retrieval_probe` uses wording measured to reach the
 * live web, so its citation counts mean something; a `natural_demand` question
 * uses the wording a buyer would actually type, which the same calibration
 * proved usually does not trigger a search. Mixing their denominators is the
 * single easiest way to turn this report into a lie, which is why the mode
 * travels with every sample rather than being inferred later.
 */
export type GeoQueryMode = "natural_demand" | "retrieval_probe";

export type GeoQueryCohort = "core" | "explore";

/**
 * Whose names the prompt itself contains.
 *
 * `unbranded` means neither the customer nor a competitor is named — the only
 * conditioning under which a mention is evidence of discovery. `brand` means
 * the customer's own name is in the question and no competitor is. `mixed`
 * means a competitor is named, with or without the customer. Derived from the
 * rendered text against confirmed names, never asserted by the client.
 */
export type GeoBrandStance = "unbranded" | "brand" | "mixed";

export type GeoBuyerStage = "awareness" | "consideration" | "decision";

export type GeoQuerySource = "profile" | "user_edit" | "llm_candidate";

export interface GeoQueryUnitV1 {
  readonly queryId: string;
  readonly slot: GeoQuerySlot;
  readonly text: string;
  readonly cohort: GeoQueryCohort;
  readonly mode: GeoQueryMode;
  readonly brandStance: GeoBrandStance;
  readonly buyerStage: GeoBuyerStage;
  readonly marketCode: string;
  /** Language of the query text (§2.8), not a provider setting. */
  readonly queryLanguageTag: "en";
  readonly timeSensitive: boolean;
  readonly asOf: string | null;
  readonly expectedAssetTypes: readonly GeoAssetType[];
  readonly source: GeoQuerySource;
  readonly userConfirmed: boolean;
  /** Registry identity for template-derived wording; null for custom text. */
  readonly templateId: string | null;
  readonly templateVersion: string | null;
  /** Calibration-registered current-evidence clause (§2.2); null when none. */
  readonly retrievalTriggerClause: string | null;
  readonly samplesPlanned:
    | typeof GEO_NATURAL_DEMAND_SAMPLES
    | typeof GEO_RETRIEVAL_SAMPLES;
}

export interface GeoQuerySetV1 {
  readonly schemaVersion: typeof GEO_QUERY_SET_SCHEMA_VERSION;
  /** Display/lineage metadata only; not part of the content fingerprint. */
  readonly querySetId: string;
  /**
   * Display metadata only.
   *
   * With zero persistence the server can prove "the content changed, so the
   * fingerprint changed"; it cannot prove this set is version 5 rather than
   * version 900, because there is no stored predecessor to compare against.
   * Nothing in the contract or the UI may imply otherwise.
   */
  readonly version: number;
  readonly templateVersion: string;
  readonly contextHash: string;
  readonly marketCode: string;
  readonly queryLanguageTag: "en";
  readonly queries: readonly GeoQueryUnitV1[];
  readonly querySetContentHash: string;
  readonly confirmedAt: string | null;
}

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

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    // Refused here as well as in the hasher: a value the guard admits but the
    // fingerprint throws on would make the strict contract and the shared
    // fingerprint disagree about what is valid.
    !hasLoneSurrogate(value) &&
    normalizeGeoText(value) === value
  );
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** UTF-8 length, which is the unit the provider cap is conservatively read in. */
export function geoPromptByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Both counting units, so a question that cannot be billed is never confirmed. */
export function isPayableGeoQueryText(value: string): boolean {
  return (
    value.length <= GEO_MAX_QUERY_TEXT_LENGTH &&
    geoPromptByteLength(value) <= GEO_MAX_QUERY_TEXT_LENGTH
  );
}

const SLOT_RANK: ReadonlyMap<string, number> = new Map(
  GEO_CORE_SLOTS.map((slot, index) => [slot, index]),
);

const MODES: ReadonlySet<string> = new Set<GeoQueryMode>([
  "natural_demand",
  "retrieval_probe",
]);
const COHORTS: ReadonlySet<string> = new Set<GeoQueryCohort>([
  "core",
  "explore",
]);
const STANCES: ReadonlySet<string> = new Set<GeoBrandStance>([
  "unbranded",
  "brand",
  "mixed",
]);
const STAGES: ReadonlySet<string> = new Set<GeoBuyerStage>([
  "awareness",
  "consideration",
  "decision",
]);
const SOURCES: ReadonlySet<string> = new Set<GeoQuerySource>([
  "profile",
  "user_edit",
  "llm_candidate",
]);

export function isGeoQuerySlot(value: unknown): value is GeoQuerySlot {
  return typeof value === "string" && SLOT_RANK.has(value);
}

/** How many samples a query of this mode is contracted to take. */
export function geoSamplesForMode(mode: GeoQueryMode): 1 | 3 {
  return mode === "retrieval_probe"
    ? GEO_RETRIEVAL_SAMPLES
    : GEO_NATURAL_DEMAND_SAMPLES;
}

function isGeoQueryUnit(value: unknown, set: UnknownObject): boolean {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "queryId",
      "slot",
      "text",
      "cohort",
      "mode",
      "brandStance",
      "buyerStage",
      "marketCode",
      "queryLanguageTag",
      "timeSensitive",
      "asOf",
      "expectedAssetTypes",
      "source",
      "userConfirmed",
      "templateId",
      "templateVersion",
      "retrievalTriggerClause",
      "samplesPlanned",
    ]) ||
    !isBoundedText(value.queryId, 64) ||
    !isGeoQuerySlot(value.slot) ||
    !isBoundedText(value.text, GEO_MAX_QUERY_TEXT_LENGTH) ||
    !isPayableGeoQueryText(value.text) ||
    typeof value.cohort !== "string" ||
    !COHORTS.has(value.cohort) ||
    typeof value.mode !== "string" ||
    !MODES.has(value.mode) ||
    typeof value.brandStance !== "string" ||
    !STANCES.has(value.brandStance) ||
    typeof value.buyerStage !== "string" ||
    !STAGES.has(value.buyerStage) ||
    value.marketCode !== set.marketCode ||
    value.queryLanguageTag !== set.queryLanguageTag ||
    typeof value.timeSensitive !== "boolean" ||
    typeof value.source !== "string" ||
    !SOURCES.has(value.source) ||
    typeof value.userConfirmed !== "boolean"
  ) {
    return false;
  }

  // A time-sensitive question that cannot say what "now" meant is a question
  // whose answer cannot be compared to anything later.
  if (value.timeSensitive) {
    if (!isCanonicalIsoTimestamp(value.asOf)) return false;
  } else if (value.asOf !== null) {
    return false;
  }

  if (
    !Array.isArray(value.expectedAssetTypes) ||
    value.expectedAssetTypes.length === 0 ||
    !value.expectedAssetTypes.every((entry) => isGeoAssetType(entry))
  ) {
    return false;
  }
  const assetTypes = value.expectedAssetTypes as readonly GeoAssetType[];
  const canonicalAssetTypes = canonicalGeoAssetTypes(assetTypes);
  if (
    assetTypes.length !== canonicalAssetTypes.length ||
    assetTypes.some((entry, index) => entry !== canonicalAssetTypes[index])
  ) {
    return false;
  }

  const mode = value.mode as GeoQueryMode;
  if (value.samplesPlanned !== geoSamplesForMode(mode)) return false;

  const templateId = value.templateId;
  const templateVersion = value.templateVersion;
  const linked = templateId !== null || templateVersion !== null;
  if (linked) {
    if (
      !isBoundedText(templateId, 64) ||
      !isBoundedText(templateVersion, 32)
    ) {
      return false;
    }
  }

  if (value.retrievalTriggerClause !== null) {
    if (
      mode !== "retrieval_probe" ||
      !isBoundedText(value.retrievalTriggerClause, 160) ||
      // The clause is the part of this exact sentence the calibration proved
      // is doing the work. Recorded separately so it can be reported, but it
      // must still literally be in the sentence it describes.
      !(value.text as string).includes(value.retrievalTriggerClause)
    ) {
      return false;
    }
  }

  if (linked) {
    // A template link is a claim about where the wording came from, so it is
    // checked rather than trusted: the entry must be shippable for this mode,
    // own this slot, declare this trigger clause, and the text must actually
    // be a rendering of its literal. Without the last check, `templateId` is a
    // label a client can staple to arbitrary unmeasured text.
    const entry = findGeoTemplate(templateId as string, templateVersion as string);
    if (entry === null) return false;
    if (!isGeoTemplateShippable(entry.templateId, entry.templateVersion, mode)) {
      return false;
    }
    if (entry.slot !== value.slot) return false;
    if (entry.retrievalTriggerClause !== value.retrievalTriggerClause) {
      return false;
    }
    if (!isGeoTemplateRendering(entry, value.text as string)) return false;
  }

  if (mode === "retrieval_probe") {
    // A retrieval probe is the only thing in this product that claims its
    // citation counts mean something, and that claim rests entirely on wording
    // somebody paid to measure. Unregistered wording cannot make it.
    if (!linked) return false;
    if (value.source === "user_edit") return false;
  } else if (!linked && value.source !== "user_edit") {
    // Custom natural-demand text is allowed — that is what editing produces —
    // but only when it says it is custom. Template-free text claiming to come
    // from the profile would be unmeasured wording with no way to tell.
    return false;
  }

  return true;
}

/**
 * The canonical order the fingerprint and the run plan both use.
 *
 * Core queries in declared slot order first, then explore queries by id. Two
 * clients that built the same eight questions must produce the same bytes, and
 * the cheapest way to guarantee that is to require the array to arrive already
 * in the one order rather than sorting a copy and hoping the display agrees.
 */
function isCanonicallyOrdered(queries: readonly GeoQueryUnitV1[]): boolean {
  const core = queries.filter((query) => query.cohort === "core");
  const explore = queries.filter((query) => query.cohort === "explore");
  const rejoined = [...core, ...explore];
  if (queries.some((query, index) => query !== rejoined[index])) return false;

  for (let index = 1; index < core.length; index += 1) {
    const previous = SLOT_RANK.get(core[index - 1]!.slot) ?? -1;
    const current = SLOT_RANK.get(core[index]!.slot) ?? -1;
    if (previous >= current) return false;
  }
  for (let index = 1; index < explore.length; index += 1) {
    if (explore[index - 1]!.queryId >= explore[index]!.queryId) return false;
  }
  return true;
}

/**
 * Validate a query set without trusting any part of it.
 *
 * Deliberately does not check `querySetContentHash` against a recomputation:
 * the hash is async and this guard is called from synchronous validation paths
 * on both sides. The server recomputes it separately and refuses a mismatch
 * before the budget claim, which is the only place the check has to happen.
 */
export function isGeoQuerySetV1(value: unknown): value is GeoQuerySetV1 {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "querySetId",
      "version",
      "templateVersion",
      "contextHash",
      "marketCode",
      "queryLanguageTag",
      "queries",
      "querySetContentHash",
      "confirmedAt",
    ]) ||
    value.schemaVersion !== GEO_QUERY_SET_SCHEMA_VERSION ||
    !isBoundedText(value.querySetId, 64) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    !isBoundedText(value.templateVersion, 32) ||
    !isGeoDigest(value.contextHash) ||
    typeof value.marketCode !== "string" ||
    !/^[A-Z]{2}$/u.test(value.marketCode) ||
    // P0 is English-query-only (§2.8). A non-English set is refused here rather
    // than translated, because a calibration-locked template translated is a
    // different, unmeasured question.
    value.queryLanguageTag !== "en" ||
    !isGeoDigest(value.querySetContentHash) ||
    (value.confirmedAt !== null && !isCanonicalIsoTimestamp(value.confirmedAt))
  ) {
    return false;
  }

  const queries = value.queries;
  if (
    !Array.isArray(queries) ||
    queries.length === 0 ||
    queries.length > 24 ||
    // `every`/`some`/`filter` all skip holes, so a trailing hole would pass
    // every check below and then become `null` the moment this is serialized.
    hasArrayHole(queries)
  ) {
    return false;
  }
  if (!queries.every((query) => isGeoQueryUnit(query, value))) return false;

  const units = queries as readonly GeoQueryUnitV1[];
  const ids = units.map((query) => query.queryId);
  if (new Set(ids).size !== ids.length) return false;

  const core = units.filter((query) => query.cohort === "core");
  if (core.length !== GEO_CORE_QUERY_COUNT) return false;
  const slots = core.map((query) => query.slot);
  if (new Set(slots).size !== GEO_CORE_SLOTS.length) return false;

  // The composition, not just the count. Eight retrieval probes would be a
  // 24-call run while the confirm step advertised 18. The bound is a ceiling
  // rather than an equality because editing a retrieval question demotes it to
  // a one-sample natural-demand question — a legitimate, cheaper run that a
  // strict `=== 18` rule would make impossible to execute at all.
  const retrieval = core.filter((query) => query.mode === "retrieval_probe");
  if (retrieval.length > GEO_MAX_RETRIEVAL_PROBES) return false;
  if (
    core.reduce((total, query) => total + query.samplesPlanned, 0) >
    GEO_PLANNED_CALLS_PER_RUN
  ) {
    return false;
  }

  return isCanonicallyOrdered(units);
}

/** The paid call count of the core cohort: the sum of its planned samples. */
export function geoPlannedCallCount(set: GeoQuerySetV1): number {
  return set.queries
    .filter((query) => query.cohort === "core")
    .reduce((total, query) => total + query.samplesPlanned, 0);
}

/** Whether every core query carries the visitor's explicit confirmation flag. */
export function isGeoQuerySetConfirmed(set: GeoQuerySetV1): boolean {
  return (
    set.confirmedAt !== null &&
    set.queries
      .filter((query) => query.cohort === "core")
      .every((query) => query.userConfirmed)
  );
}

/**
 * The projection the content fingerprint covers.
 *
 * Written out field by field rather than spread from the set, so a field added
 * later cannot silently join the hash domain — and so the exclusions are
 * visible: `querySetContentHash` itself, the display-only `querySetId` and
 * `version`, `confirmedAt`, and `userConfirmed`. A confirmation checkbox is not
 * content, and letting it change the fingerprint would mean the same eight
 * questions had two identities depending on whether a box was ticked.
 */
export function geoQuerySetContentProjection(
  set: GeoQuerySetV1,
): GeoCanonicalValue {
  return {
    schemaVersion: set.schemaVersion,
    templateVersion: set.templateVersion,
    contextHash: set.contextHash,
    marketCode: set.marketCode,
    queryLanguageTag: set.queryLanguageTag,
    queries: set.queries.map((query) => ({
      queryId: query.queryId,
      slot: query.slot,
      text: query.text,
      cohort: query.cohort,
      mode: query.mode,
      brandStance: query.brandStance,
      buyerStage: query.buyerStage,
      marketCode: query.marketCode,
      queryLanguageTag: query.queryLanguageTag,
      timeSensitive: query.timeSensitive,
      asOf: query.asOf,
      expectedAssetTypes: [...canonicalGeoAssetTypes(query.expectedAssetTypes)],
      source: query.source,
      templateId: query.templateId,
      templateVersion: query.templateVersion,
      retrievalTriggerClause: query.retrievalTriggerClause,
      samplesPlanned: query.samplesPlanned,
    })),
  };
}

/**
 * The content fingerprint.
 *
 * What it honestly proves: two sets with this digest have identical content,
 * a changed question changes it, and a report, an action list and a handoff
 * packet carrying it refer to the same eight questions. What it does NOT prove,
 * and what neither the contract nor the UI may imply: authenticity, that a user
 * confirmed anything, where the wording came from, that the language is right,
 * that the questions are fresh, that spend was authorized, or that this is not
 * a replay of an earlier confirmed set.
 */
export async function geoQuerySetContentHash(
  set: GeoQuerySetV1,
): Promise<string> {
  return geoDomainHash(
    GEO_QUERY_SET_CONTENT_HASH_DOMAIN,
    geoQuerySetContentProjection(set),
  );
}
