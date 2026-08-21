// @input  -- a confirmed context snapshot, or a bare category/buyer/rival seed
// @output -- the versioned core_8 query set, and the legacy eight-question list
// @pos    -- the deterministic question generator the visitor confirms before paying

import { geoCategoryStem } from "./geo-category-stem.ts";
import { canonicalGeoAssetTypes, type GeoAssetType } from "./geo-asset-type.ts";
import { normalizeGeoText } from "./geo-canonical.ts";
import {
  deriveGeoBrandStance,
  type GeoContextSnapshotV1,
} from "./geo-context.ts";
import {
  geoQuerySetContentHash,
  geoSamplesForMode,
  GEO_CORE_QUERY_COUNT,
  GEO_MAX_QUERY_TEXT_LENGTH,
  GEO_CORE_SLOTS,
  isPayableGeoQueryText,
  GEO_QUERY_SET_SCHEMA_VERSION,
  type GeoQuerySetV1,
  type GeoQuerySlot,
  type GeoQueryUnitV1,
} from "./geo-query-contract.ts";
import {
  findGeoTemplate,
  isGeoTemplateShippable,
  renderGeoTemplate,
  validateGeoPlaceholderValue,
  GEO_TEMPLATE_REGISTRY_VERSION,
  type GeoPlaceholderRejection,
  type GeoTemplateEntry,
  type GeoTemplatePlaceholderName,
} from "./geo-template-registry.ts";

/**
 * Why these are templates rather than a model call.
 *
 * The visitor confirms and edits every question before a single paid call is
 * made, so the generator's job is to produce a defensible starting set, not a
 * clever one. A model call here would add a second provider, a second failure
 * mode and a second bill to a step whose output a human immediately rewrites.
 * The templates are also auditable: a question that reads badly can be traced
 * to a line in this file instead of to a prompt.
 *
 * Why every template below is a measured one.
 *
 * The first version of this file shipped eight plausible-sounding questions and
 * was worthless: in the first real run, 21 of 24 samples came back with no web
 * search at all, because `web_search: true` PERMITS a search and does not force
 * one — asked something it believes it already knows, the model answers from
 * its own weights and cites nobody. Ninety-five paid calls on 2026-08-17 (the
 * visitor's own failing inputs, category "seo" and buyer "ceo", which is the
 * hardest case because both words are generic) separated the phrasings that
 * reach the live web from the ones that do not:
 *
 *   searched 3/3   What are the top ${category} tools right now?
 *   searched 3/3   Which ${category} tools are getting the best reviews right now?
 *   searched 3/3   Best alternatives to ${rivals} for ${category}          (1 and 2 rivals)
 *   searched 3/3   Which ${category} tools do people recommend instead of ${rivals} right now?
 *   searched 3/3   What should ${buyer} look for ... and which tools currently do it best?
 *   searched 3/3   Which ${category} tools are worth paying for right now?
 *   searched 3/3   Which ${category} tool should ${buyer} pick, and what do current reviews say?
 *   searched 3/3   Which ${category} tool has the best free plan right now?
 *   searched 3/3   What are the leading ${category} tools right now, and how do they differ?
 *   searched 3/3   Which ${category} tools are people switching to right now?
 *   searched 0/3   What are the best ${category} tools for ${buyer} right now?
 *   searched 0/3   How does ${rival} compare to other ${category} tools?
 *   searched 0/3   Is paid ${category} software worth it right now, or are free tools enough?
 *   searched 0/1   ...and every one of eight other phrasings ending in "for ${buyer}"
 *
 * The same eight, regenerated for a different category and buyer, searched 8/8.
 * They are calibrated for a software category: regenerated for "pet insurance",
 * which the templates' own noun does not fit, three of the eight stopped
 * searching. This Agent's visitors sell software, and the confirm step exists
 * for the ones who do not.
 *
 * Two rules came out of it, and both shape the set below.
 *
 * First, a request for a CURRENT LIST reaches the web; a request for ADVICE or a
 * YES/NO judgement does not. "Which tools are worth paying for right now" is
 * searched every time; "is paid software worth it" never is, though they ask
 * nearly the same thing. Naming a rival works for the same reason — "best
 * alternatives to X" is a list request.
 *
 * Second, a trailing "for ${buyer}" suppresses the search on its own. Twelve
 * variants ended that way and not one searched, including "What are the best
 * ${category} tools for ${buyer} right now?", which differs from a 3/3 template
 * by those two words alone. The buyer is therefore never the last thing the
 * question asks for: where it appears it sits in a leading clause, and a
 * factual second clause closes the sentence.
 *
 * A year does not help. "in 2026" was tried on four templates and searched on
 * none of them; the model reads a year as something it already knows and
 * "right now" as something it does not.
 *
 * Changing any wording here changes what the run measures, so treat these
 * strings as calibrated values and re-measure before editing them.
 */
export interface GeoQuestionSeed {
  /** What the site sells, in the visitor's words: "AI visibility tracking". */
  readonly category: string;
  /** Who buys it: "SaaS marketing teams". */
  readonly buyer: string;
  /** Competitor names the buyer would recognise. */
  readonly rivals: readonly string[];
}

export interface GeneratedGeoQuestion {
  readonly questionId: string;
  readonly question: string;
  /** Where in the buyer's journey this question sits, for the confirm UI. */
  readonly stage: "discovery" | "comparison" | "evaluation" | "decision";
}

/**
 * Longest a visitor value may be before it crowds the measured wording out.
 *
 * Capped here, on the ingredient, rather than on the finished question. Every
 * template ends on the clause that makes it work — "right now", "and what do
 * current reviews say" — and the length guard below trims from the end, so a
 * 600-character category deletes exactly the words the calibration is about.
 * Worse, five templates open with the same two words, so trimming the sentence
 * collapsed them into one string: a run spent 24 calls on 4 distinct prompts,
 * none of them a phrasing that was ever measured.
 */
const MAX_CATEGORY_LENGTH = 60;
const MAX_BUYER_LENGTH = 60;
const MAX_RIVAL_LENGTH = 40;

/** Whitespace only. Safe for a finished question, which ends in its own "?". */
function collapse(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Only at the very end. Mid-value it belongs to a name: "U.S. tax software". */
const TRAILING_SENTENCE_PUNCTUATION = /[?!.。？！]+$/u;
/**
 * Quotes and list separators only.
 *
 * Deliberately not brackets, `+` or `#`: those are parts of real names —
 * `[24]7.ai`, `C++ analytics` — and a normalizer that eats them renames the
 * competitor the visitor asked about.
 */
const EDGE_NOISE = /^[\s"'“”‘’,;:、，；：]+|[\s"'“”‘’,;:、，；：]+$/gu;

/**
 * Reduce a form value to the noun phrase every template assumes it is.
 *
 * Narrow on purpose. The ingredient lands in the middle of a calibrated
 * sentence, so a trailing full stop has to go — "SEO tools." otherwise slips
 * past the product-noun stripper and asks about "SEO tools. tools". Everything
 * else is left alone, because the same punctuation inside a value belongs to
 * the name: "U.S. tax software", "Node.js monitoring", "Yahoo! Japan",
 * "[24]7.ai", "C++ analytics". A normalizer that split on sentence punctuation
 * renamed all five, and asking about the wrong product is a worse failure than
 * any it was written to prevent.
 *
 * A visitor who types a whole instruction into the form therefore keeps it, and
 * that is deliberate rather than an oversight: every question is shown for
 * confirmation and is freely editable before a single call is billed, so the
 * confirm step — not this function — is where arbitrary wording belongs.
 */
function clean(value: string): string {
  return collapse(value)
    .replace(TRAILING_SENTENCE_PUNCTUATION, "")
    .replace(EDGE_NOISE, "")
    .trim();
}

/** Normalize, then cut to a word boundary rather than mid-word. */
function trimTo(value: string, limit: number): string {
  const text = clean(value);
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit / 3 ? cut.slice(0, lastSpace) : cut).trim();
}

function categoryPhrases(value: string): {
  /** The bare modifier: "seo". Empty when the visitor typed only a noun. */
  readonly stem: string;
  readonly plural: string;
  readonly singular: string;
  readonly software: string;
} {
  // The noun list lives in a leaf both this generator and the confirm gate
  // import, so the gate can refuse exactly the categories that would land here
  // with nothing left. The branch below is now unreachable for a confirmed
  // context and is kept as a backstop rather than a behaviour.
  const stem = geoCategoryStem(clean(value));
  if (stem.length === 0) {
    return {
      stem: "",
      plural: "tools",
      singular: "tool",
      software: "software",
    };
  }
  return {
    stem,
    plural: `${stem} tools`,
    singular: `${stem} tool`,
    software: `${stem} software`,
  };
}

/**
 * Trim to the provider's ceiling without cutting a word in half.
 *
 * A question over the limit is refused by the provider after being billed, so
 * the bound is enforced at generation time rather than discovered at run time.
 * With the ingredient caps above no template can reach it — the longest runs to
 * roughly 200 characters — so this is a backstop, and a question that trips it
 * means one of those caps was raised without checking the arithmetic.
 */
function bounded(value: string): string {
  // Whitespace-only normalization, deliberately: a finished question ends in
  // its own question mark, and the ingredient normalizer would cut it there.
  const text = collapse(value);
  if (text.length <= GEO_MAX_QUERY_TEXT_LENGTH) return text;
  const cut = text.slice(0, GEO_MAX_QUERY_TEXT_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * The eight questions.
 *
 * Spread across the journey on purpose: a set drawn only from discovery would
 * measure visibility for people who do not yet know what they want, which is
 * the easiest place to appear and the least useful place to be measured.
 *
 * The two comparison questions are the ones a competitor name buys. Without
 * rivals they fall back to measured category-wide phrasings rather than to a
 * placeholder like "the established options", which names nothing and gives the
 * model nothing to look up.
 */
export function generateGeoQuestions(
  seed: GeoQuestionSeed,
): readonly GeneratedGeoQuestion[] {
  const { stem, plural, singular, software } = categoryPhrases(
    trimTo(seed.category, MAX_CATEGORY_LENGTH),
  );
  const buyer = trimTo(seed.buyer, MAX_BUYER_LENGTH) || "small teams";
  // Deduped case-insensitively, keeping the spelling the visitor typed first:
  // a paste that repeats a competitor would otherwise ask about "Semrush and
  // semrush", which names one rival while looking like two. A Map keyed on the
  // lowercase form would keep the LAST spelling, so the first-wins order is
  // built explicitly.
  const cleanedRivals = seed.rivals
    .map((rival) => trimTo(rival, MAX_RIVAL_LENGTH))
    .filter((rival) => rival.length > 0);
  const rivals = cleanedRivals.filter(
    (rival, index) =>
      cleanedRivals.findIndex(
        (earlier) => earlier.toLowerCase() === rival.toLowerCase(),
      ) === index,
  );
  const rivalList =
    rivals.length >= 2 ? `${rivals[0]} and ${rivals[1]}` : rivals[0];

  const comparison: readonly [string, string] =
    rivalList === undefined
      ? [
          `What are the leading ${plural} right now, and how do they differ?`,
          `Which ${plural} are people switching to right now?`,
        ]
      : [
          // The one measured phrasing that carries the bare category rather
          // than the noun phrase — "alternatives to semrush for seo", not
          // "for seo tools". Kept exactly as measured; `plural` covers the
          // case where the visitor typed nothing but a product noun.
          `Best alternatives to ${rivalList} for ${stem || plural}`,
          `Which ${plural} do people recommend instead of ${rivalList} right now?`,
        ];

  const drafts: ReadonlyArray<Omit<GeneratedGeoQuestion, "questionId">> = [
    {
      stage: "discovery",
      question: `What are the top ${plural} right now?`,
    },
    {
      stage: "discovery",
      question: `Which ${plural} are getting the best reviews right now?`,
    },
    { stage: "comparison", question: comparison[0] },
    { stage: "comparison", question: comparison[1] },
    {
      stage: "evaluation",
      question: `What should ${buyer} look for when choosing ${software}, and which tools currently do it best?`,
    },
    {
      stage: "evaluation",
      question: `Which ${plural} are worth paying for right now?`,
    },
    {
      stage: "decision",
      question: `Which ${singular} should ${buyer} pick, and what do current reviews say?`,
    },
    {
      stage: "decision",
      question: `Which ${singular} has the best free plan right now?`,
    },
  ];

  return drafts.slice(0, GEO_CORE_QUERY_COUNT).map((draft, index) => ({
    questionId: `q-${index + 1}`,
    question: bounded(draft.question),
    stage: draft.stage,
  }));
}

/**
 * The core_8 cohort: which template fills each slot, and what could answer it.
 *
 * Data rather than control flow, so the whole cohort can be read in one place
 * and asserted against in one test. Slot 5 is the only one with a choice, and
 * the choice is not a preference: "Best alternatives to X" needs a competitor
 * name to be a question at all, so without one the slot falls back to the other
 * measured phrasing for the same decision rather than to a placeholder like
 * "the established options", which names nothing and gives the model nothing to
 * look up.
 */
interface GeoCoreSlotPlan {
  readonly slot: GeoQuerySlot;
  readonly templateId: string;
  /** Used when no confirmed competitor name fits the placeholder bound. */
  readonly rivalFreeTemplateId: string | null;
  readonly expectedAssetTypes: readonly GeoAssetType[];
}

export const GEO_CORE_SLOT_PLAN: readonly GeoCoreSlotPlan[] = [
  {
    slot: "category_discovery",
    templateId: "geo.retrieval.category_top",
    rivalFreeTemplateId: null,
    expectedAssetTypes: [
      "blog_guide",
      "comparison_page",
      "offsite_authority_plan",
    ],
  },
  {
    slot: "jtbd_outcome",
    templateId: "geo.natural.jtbd_best_for_buyer",
    rivalFreeTemplateId: null,
    expectedAssetTypes: ["use_case_landing", "blog_guide"],
  },
  {
    slot: "pain_how_to",
    templateId: "geo.natural.pain_current_workflow",
    rivalFreeTemplateId: null,
    expectedAssetTypes: ["existing_page_enhancement", "blog_guide"],
  },
  {
    slot: "constraint_fit",
    templateId: "geo.retrieval.free_plan",
    rivalFreeTemplateId: null,
    expectedAssetTypes: ["existing_page_enhancement", "pricing_page"],
  },
  {
    slot: "alternative_status_quo",
    templateId: "geo.retrieval.alternatives",
    rivalFreeTemplateId: "geo.retrieval.leading_differ",
    expectedAssetTypes: ["comparison_page", "offsite_authority_plan"],
  },
  {
    slot: "brand_comparison",
    templateId: "geo.natural.brand_comparison",
    rivalFreeTemplateId: null,
    expectedAssetTypes: ["existing_page_enhancement", "comparison_page"],
  },
  {
    slot: "due_diligence",
    templateId: "geo.retrieval.best_reviews",
    rivalFreeTemplateId: null,
    expectedAssetTypes: ["security_trust_page", "offsite_authority_plan"],
  },
  {
    slot: "negative_fit_objection",
    templateId: "geo.retrieval.worth_paying",
    rivalFreeTemplateId: null,
    expectedAssetTypes: ["pricing_page", "research_dataset"],
  },
];

export type GeoQuerySetRejection =
  | { readonly code: "query_language_unsupported" }
  | { readonly code: "unknown_query"; readonly queryId: string }
  | { readonly code: "template_unavailable"; readonly slot: GeoQuerySlot }
  | {
      readonly code: "placeholder_rejected";
      readonly slot: GeoQuerySlot;
      readonly placeholder: GeoTemplatePlaceholderName;
      readonly reason: GeoPlaceholderRejection | "missing";
    }
  | { readonly code: "question_not_payable"; readonly slot: GeoQuerySlot };

export type GeoQuerySetBuildResult =
  | { readonly ok: true; readonly querySet: GeoQuerySetV1 }
  | {
      readonly ok: false;
      readonly rejections: readonly GeoQuerySetRejection[];
    };

/**
 * Join at most two confirmed competitor names into the measured wording.
 *
 * Two, because both the one-name and the two-name forms were measured 3/3 and
 * nothing beyond two was. Names are never trimmed to fit: a shortened
 * competitor name is a different competitor, and asking about the wrong company
 * is a worse failure than falling back to the rival-free phrasing.
 */
function rivalListFor(competitors: readonly string[]): string | null {
  const cleaned = competitors
    .map((name) => normalizeGeoText(name))
    .filter((name) => name.length > 0);

  for (const candidate of [
    cleaned.length >= 2 ? `${cleaned[0]} and ${cleaned[1]}` : null,
    cleaned[0] ?? null,
  ]) {
    if (candidate === null) continue;
    if (validateGeoPlaceholderValue("rivalList", candidate) === null) {
      return candidate;
    }
  }
  return null;
}

function substitutionsFor(
  context: GeoContextSnapshotV1,
  rivalList: string | null,
): Partial<Record<GeoTemplatePlaceholderName, string>> {
  const phrases = categoryPhrases(context.category);
  const values: Partial<Record<GeoTemplatePlaceholderName, string>> = {
    categoryStem: phrases.stem || phrases.plural,
    categoryPlural: phrases.plural,
    categorySingular: phrases.singular,
    categorySoftware: phrases.software,
    buyer: context.buyer,
    productName: context.productName,
  };
  return rivalList === null ? values : { ...values, rivalList };
}

function templateForSlot(
  plan: GeoCoreSlotPlan,
  rivalList: string | null,
): GeoTemplateEntry | null {
  const wanted =
    rivalList === null && plan.rivalFreeTemplateId !== null
      ? plan.rivalFreeTemplateId
      : plan.templateId;
  const entry = findGeoTemplate(wanted, "1");
  if (entry === null) return null;
  return isGeoTemplateShippable(
    entry.templateId,
    entry.templateVersion,
    entry.mode,
  )
    ? entry
    : null;
}

/**
 * Build the versioned core_8 query set from a confirmed context.
 *
 * Deterministic and offline: no model call, no crawl, no network. The visitor
 * has already confirmed every ingredient, so the generator's job is to put them
 * into calibrated sentences and to refuse rather than improvise when one of them
 * does not fit. A generator that quietly trimmed a value to make a template fit
 * is how a run once spent twenty-four calls on four distinct prompts, none of
 * which had ever been measured.
 *
 * The clock is injected and read once, for the `asOf` anchor of the
 * time-sensitive questions. Two builds from the same context and the same clock
 * produce the same ids, the same text and the same fingerprint.
 */
export async function buildGeoCoreQuerySet(
  context: GeoContextSnapshotV1,
  clock: () => Date,
): Promise<GeoQuerySetBuildResult> {
  if (context.targetQueryLanguage !== "en") {
    return { ok: false, rejections: [{ code: "query_language_unsupported" }] };
  }

  const rejections: GeoQuerySetRejection[] = [];
  const rivalList = rivalListFor(context.directCompetitors);
  const values = substitutionsFor(context, rivalList);
  const asOf = clock().toISOString();
  const queries: GeoQueryUnitV1[] = [];

  for (const plan of GEO_CORE_SLOT_PLAN) {
    const entry = templateForSlot(plan, rivalList);
    if (entry === null) {
      rejections.push({ code: "template_unavailable", slot: plan.slot });
      continue;
    }

    const rendered = renderGeoTemplate(entry, values);
    if (!rendered.ok) {
      rejections.push({
        code: "placeholder_rejected",
        slot: plan.slot,
        placeholder: rendered.placeholder,
        reason: rendered.reason,
      });
      continue;
    }
    if (!isPayableGeoQueryText(rendered.text)) {
      rejections.push({ code: "question_not_payable", slot: plan.slot });
      continue;
    }

    queries.push({
      queryId: `core-${plan.slot}`,
      slot: plan.slot,
      text: rendered.text,
      cohort: "core",
      mode: entry.mode,
      // Derived from the rendered text against the confirmed names, never
      // asserted: a question labelled unbranded that in fact contains the
      // customer's own name would make every mention in its answer
      // tautological, and the report would present that as discovery.
      brandStance: deriveGeoBrandStance(
        rendered.text,
        context.brandAliases,
        context.directCompetitors,
      ),
      buyerStage: entry.buyerStage,
      marketCode: context.marketCode,
      queryLanguageTag: "en",
      timeSensitive: entry.timeSensitive,
      asOf: entry.timeSensitive ? asOf : null,
      expectedAssetTypes: canonicalGeoAssetTypes(plan.expectedAssetTypes),
      source: "profile",
      userConfirmed: false,
      templateId: entry.templateId,
      templateVersion: entry.templateVersion,
      retrievalTriggerClause:
        entry.mode === "retrieval_probe" ? entry.retrievalTriggerClause : null,
      samplesPlanned: geoSamplesForMode(entry.mode),
    });
  }

  if (rejections.length > 0) return { ok: false, rejections };

  const draft: GeoQuerySetV1 = {
    schemaVersion: GEO_QUERY_SET_SCHEMA_VERSION,
    querySetId: `qs-${context.contextHash.slice("sha256:".length, "sha256:".length + 16)}`,
    version: 1,
    templateVersion: GEO_TEMPLATE_REGISTRY_VERSION,
    contextHash: context.contextHash,
    marketCode: context.marketCode,
    queryLanguageTag: "en",
    queries,
    querySetContentHash: "",
    confirmedAt: null,
  };
  return {
    ok: true,
    querySet: {
      ...draft,
      querySetContentHash: await geoQuerySetContentHash(draft),
    },
  };
}

/**
 * Apply the visitor's edit to one question.
 *
 * Editing is allowed and expected — that is what the confirm step is for — but
 * it has consequences the contract makes visible rather than hiding. The text
 * becomes `user_edit`, which voids the template link, and a retrieval probe
 * therefore cannot stay a retrieval probe: its citation counts were only
 * meaningful because somebody paid to measure that exact string. It becomes a
 * custom natural-demand question instead, sampled once, and the UI says so.
 *
 * The brand stance is derived again from the edited text rather than carried
 * over, which is why this needs the confirmed context. The stance is a property
 * of the words, not of the question's history: an edit that adds or removes the
 * customer's own name or a competitor's changes it. Carrying the old label
 * forward did not mislabel the run — `geo-run-handler` derives the stance
 * itself and refuses any set whose labels disagree with its text — it made the
 * edited set unrunnable, refused before billing with nothing the visitor could
 * do about it.
 */
export async function editGeoQueryText(
  set: GeoQuerySetV1,
  queryId: string,
  text: string,
  context: GeoContextSnapshotV1,
): Promise<GeoQuerySetBuildResult> {
  const normalized = normalizeGeoText(text);
  const target = set.queries.find((query) => query.queryId === queryId);
  if (target === undefined) {
    return { ok: false, rejections: [{ code: "unknown_query", queryId }] };
  }
  if (normalized.length === 0 || !isPayableGeoQueryText(normalized)) {
    return {
      ok: false,
      rejections: [{ code: "question_not_payable", slot: target.slot }],
    };
  }

  const queries = set.queries.map((query) =>
    query.queryId === queryId
      ? {
          ...query,
          text: normalized,
          brandStance: deriveGeoBrandStance(
            normalized,
            context.brandAliases,
            context.directCompetitors,
          ),
          mode: "natural_demand" as const,
          samplesPlanned: geoSamplesForMode("natural_demand"),
          source: "user_edit" as const,
          templateId: null,
          templateVersion: null,
          retrievalTriggerClause: null,
          userConfirmed: false,
        }
      : query,
  );

  const draft: GeoQuerySetV1 = {
    ...set,
    version: set.version + 1,
    queries,
    querySetContentHash: "",
    confirmedAt: null,
  };
  return {
    ok: true,
    querySet: {
      ...draft,
      querySetContentHash: await geoQuerySetContentHash(draft),
    },
  };
}

/**
 * Record the visitor's confirmation of the whole set.
 *
 * `confirmedAt` and `userConfirmed` sit outside the content fingerprint on
 * purpose: ticking a box is not a change of content, and a fingerprint that
 * moved when it was ticked could not be used to prove that the confirmed set
 * and the reported set are the same eight questions. The flags remain workflow
 * assertions made in a browser — the server checks that they are set, and never
 * claims to have witnessed the confirmation.
 */
export async function confirmGeoQuerySet(
  set: GeoQuerySetV1,
  clock: () => Date,
): Promise<GeoQuerySetV1> {
  return {
    ...set,
    queries: set.queries.map((query) => ({ ...query, userConfirmed: true })),
    confirmedAt: clock().toISOString(),
  };
}

/** The slots a core cohort must cover, exported for the confirm UI. */
export { GEO_CORE_SLOTS };
