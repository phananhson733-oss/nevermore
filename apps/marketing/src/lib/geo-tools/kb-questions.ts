// @input  -- a frozen knowledge-base payload
// @output -- the question set that payload implies, with each question's mode and required entities
// @pos    -- pure and offline; the same payload always produces the same set, which is what makes a run reproducible

import {
  findGeoTemplate,
  GEO_TEMPLATES,
  isGeoTemplateShippable,
  renderGeoTemplate,
  type GeoTemplateEntry,
  type GeoTemplatePlaceholderName,
} from "../agents/geo-template-registry.ts";
import { geoCategoryStem } from "../agents/geo-category-stem.ts";
import {
  canonicalGeoKbText,
  type GeoKbPayload,
  type GeoKbValue,
} from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { geoQuestionReferencesEntity } from "./question-quality.ts";

export const GEO_QUESTION_SET_SCHEMA_VERSION = "marketing-geo-question-set.v1";
/** Frozen-set policy token: absent historical versions retain their original fact projection. */
export const GEO_PROFILE_FACT_OVERRIDES_POLICY = "profile-fact-overrides-v1";

/**
 * Which stage of a buyer's search the question belongs to.
 *
 * Kept separate from `mode` on purpose: the layer is what the question is
 * about, the mode is whether its citation counts mean anything.
 */
export type GeoQuestionLayer =
  | "problem"
  | "discovery"
  | "comparison"
  | "evaluation"
  | "branded";

/**
 * Whether this wording was measured to reach the live web.
 *
 * `retrieval` questions come from the calibrated registry, so their citation
 * counts have a denominator. `demand` questions use the wording a buyer would
 * actually type, which the same ninety-five paid calls showed usually answers
 * from memory - their mentions are worth counting and their citations are not.
 * Mixing the two denominators is the fastest way to publish a number that is
 * not true.
 */
export type GeoQuestionMode = "retrieval" | "demand";

export interface GeoQuestion {
  readonly id: string;
  readonly text: string;
  readonly layer: GeoQuestionLayer;
  readonly mode: GeoQuestionMode;
  /** Null for questions that are not about one role. */
  readonly roleId: string | null;
  /** What a correct answer would have to name. Drives coverage attribution. */
  readonly requiredEntities: readonly string[];
  /** Null when the wording was assembled here rather than taken from the registry. */
  readonly templateId: string | null;
  /**
   * True only for text taken verbatim from a template with recorded search
   * behaviour. False text is still asked; it is simply not allowed to carry a
   * citation denominator.
   */
  readonly calibrated: boolean;
}

export interface GeoQuestionSet {
  readonly schemaVersion: typeof GEO_QUESTION_SET_SCHEMA_VERSION;
  /** Registry release plus the downstream projection policies used for this frozen set. */
  readonly registryVersion: string;
  readonly language: string;
  readonly country: string;
  readonly questions: readonly GeoQuestion[];
}

/** The four category forms the calibrated templates expect. */
function categoryPhrases(value: string): {
  readonly stem: string;
  readonly plural: string;
  readonly singular: string;
  readonly software: string;
} {
  const stem = geoCategoryStem(value);
  if (stem.length === 0) {
    // A category that stems to nothing renders questions with no subject at
    // all ("What are the top tools right now?"), which the calibration showed
    // never reaches the web. The caller refuses such a payload before freezing;
    // this branch only keeps the function total.
    return { stem: "", plural: "tools", singular: "tool", software: "software" };
  }
  return {
    stem,
    plural: `${stem} tools`,
    singular: `${stem} tool`,
    software: `${stem} software`,
  };
}

function templateValues(
  payload: GeoKbPayload,
  options: { readonly buyer?: string; readonly rivalList?: string },
): Partial<Record<GeoTemplatePlaceholderName, string>> {
  const phrases = categoryPhrases(payload.categoryTerms[0] ?? "");
  return {
    categoryStem: phrases.stem.length > 0 ? phrases.stem : phrases.plural,
    categoryPlural: phrases.plural,
    categorySingular: phrases.singular,
    categorySoftware: phrases.software,
    productName: payload.officialName,
    ...(options.buyer === undefined ? {} : { buyer: options.buyer }),
    ...(options.rivalList === undefined ? {} : { rivalList: options.rivalList }),
  };
}

function shippable(entry: GeoTemplateEntry): boolean {
  return isGeoTemplateShippable(
    entry.templateId,
    entry.templateVersion,
    entry.mode,
  );
}

/** Confirmed competitors only; an unconfirmed brand name is not a name. */
function confirmedRivals(payload: GeoKbPayload): readonly string[] {
  return payload.competitors
    .filter((entry) => entry.confirmed && entry.brandName.length > 0)
    .map((entry) => entry.brandName);
}

function layerOf(entry: GeoTemplateEntry): GeoQuestionLayer {
  switch (entry.slot) {
    case "category_discovery":
      return "discovery";
    case "alternative_status_quo":
    case "brand_comparison":
      return "comparison";
    case "due_diligence":
    case "constraint_fit":
    case "negative_fit_objection":
      return "evaluation";
    case "jtbd_outcome":
    case "pain_how_to":
      return "problem";
    default:
      return "discovery";
  }
}

/**
 * What a correct answer to this question would have to name.
 *
 * Only the primary category and people or brands actually named in this text.
 * Other category terms, role criteria and brand aliases remain KB context;
 * mentioning all of them is not a requirement for answering this question.
 */
function requiredEntitiesFor(
  text: string,
  payload: GeoKbPayload,
  role: GeoKbPayload["roles"][number] | null,
  rival: string | null,
): readonly string[] {
  const category = payload.categoryTerms[0] ?? "";
  const subject = geoCategoryStem(category);
  const categoryEntity = geoQuestionReferencesEntity(text, category) ? category : subject;
  const names = [role?.label, rival, payload.officialName].filter(
    (value): value is string => value !== undefined && value !== null && geoQuestionReferencesEntity(text, value),
  );
  return [...new Set([
    ...(geoQuestionReferencesEntity(text, subject) ? [categoryEntity] : []),
    ...names,
  ])];
}

function questionId(index: number, templateId: string | null): string {
  const suffix = templateId ?? "assembled";
  return `q${String(index + 1).padStart(2, "0")}-${suffix.replace(/^geo\./, "")}`;
}

/**
 * Branded questions, assembled rather than rendered.
 *
 * There is no calibrated template that names the customer's own brand without
 * also naming a rival, so these two are built here and marked uncalibrated.
 * They are asked because "does the model know what we are" is worth observing;
 * they are excluded from every citation denominator because nobody measured
 * whether this wording searches.
 */
function brandedQuestions(payload: GeoKbPayload): readonly string[] {
  const name = payload.officialName;
  const phrases = categoryPhrases(payload.categoryTerms[0] ?? "");
  return [
    `What is ${name}, and who is it for?`,
    `Is ${name} a good choice among ${phrases.plural}?`,
  ];
}

export function buildGeoQuestionSet(payload: GeoKbPayload): GeoQuestionSet {
  const questions: GeoQuestion[] = [];
  const rivals = confirmedRivals(payload);
  const roles = payload.roles;

  const push = (
    text: string,
    layer: GeoQuestionLayer,
    mode: GeoQuestionMode,
    roleId: string | null,
    templateId: string | null,
    calibrated: boolean,
    rival: string | null,
  ): void => {
    const role = roles.find((entry) => entry.id === roleId) ?? null;
    questions.push({
      id: questionId(questions.length, templateId),
      text,
      layer,
      mode,
      roleId,
      requiredEntities: requiredEntitiesFor(text, payload, role, rival),
      templateId,
      calibrated,
    });
  };

  for (const entry of GEO_TEMPLATES) {
    if (!shippable(entry)) continue;
    const wantsBuyer = entry.placeholders.includes("buyer");
    const wantsRival = entry.placeholders.includes("rivalList");
    const mode: GeoQuestionMode =
      entry.mode === "retrieval_probe" ? "retrieval" : "demand";
    const layer = layerOf(entry);

    // One question per role, or per rival, or exactly one - so a knowledge base
    // with three roles asks the buyer-shaped questions three times rather than
    // silently picking one role and reporting the answer as everyone's.
    const buyers = wantsBuyer
      ? roles.map((role) => ({ id: role.id, buyer: role.label }))
      : [{ id: null as string | null, buyer: undefined }];
    const rivalValues = wantsRival
      ? rivals.map((rival) => rival)
      : [undefined as string | undefined];

    for (const buyer of buyers) {
      for (const rival of rivalValues) {
        const rendered = renderGeoTemplate(
          entry,
          templateValues(payload, {
            ...(buyer.buyer === undefined ? {} : { buyer: buyer.buyer }),
            ...(rival === undefined ? {} : { rivalList: rival }),
          }),
        );
        // A template that will not render with these values is skipped rather
        // than patched. Trimming a value to make it fit is how a run ends up
        // paying for wording nobody measured.
        if (!rendered.ok) continue;
        push(
          rendered.text,
          layer,
          mode,
          buyer.id,
          entry.templateId,
          true,
          rival ?? null,
        );
      }
    }
  }

  for (const text of brandedQuestions(payload)) {
    push(text, "branded", "demand", null, null, false, null);
  }

  return {
    schemaVersion: GEO_QUESTION_SET_SCHEMA_VERSION,
    registryVersion: registryVersionOf(),
    language: payload.market.language,
    country: payload.market.country,
    questions,
  };
}

function registryVersionOf(): string {
  // Imported lazily through a function so the constant stays a single source
  // and a version bump shows up in every frozen set that follows it.
  return REGISTRY_VERSION;
}

const REGISTRY_VERSION: string = `${
  findGeoTemplate("geo.retrieval.category_top", "1")?.calibratedOn ?? "unknown"
}/${String(GEO_TEMPLATES.length)}/question-entities-v2/${GEO_PROFILE_FACT_OVERRIDES_POLICY}`;

export function geoQuestionSetDigest(set: GeoQuestionSet): string {
  return geoKbDigest(set as unknown as GeoKbValue);
}

export function geoQuestionSetCanonicalText(set: GeoQuestionSet): string {
  return canonicalGeoKbText(set as unknown as GeoKbValue);
}

/** How many provider calls one run of this set would cost, per sample count. */
export function geoQuestionSetCallCount(
  set: GeoQuestionSet,
  samplesPerQuestion: number,
): number {
  return set.questions.length * samplesPerQuestion;
}
