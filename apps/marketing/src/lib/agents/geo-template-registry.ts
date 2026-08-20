// @input  -- nothing at runtime; the calibration record is a frozen literal here
// @output -- the wording authority: which strings may be asked, and on what evidence
// @pos    -- the only place a GEO question's phrasing is allowed to come from

import { normalizeGeoText } from "./geo-canonical.ts";
import type {
  GeoBuyerStage,
  GeoQueryMode,
  GeoQuerySlot,
} from "./geo-query-contract.ts";

/**
 * Why a registry exists at all.
 *
 * Search triggering is a property of the exact rendered string, not of the
 * question's intent. The first shipped generator did not know that and returned
 * 21 of 24 samples with no web search: `web_search: true` PERMITS a search, and
 * a model asked for advice answers from its own weights and cites nobody.
 * Ninety-five paid calls on 2026-08-17 separated the phrasings that reach the
 * live web from the ones that do not, and the survivors are worth exactly as
 * much as the record of how they were measured. A boolean `measured` flag would
 * not have been: measurement has a scope — this model, this endpoint, this
 * market, this substitution — and it goes stale.
 *
 * Two rules came out of the calibration and both are visible in the entries
 * below. A request for a CURRENT LIST reaches the web; a request for advice or
 * a yes/no judgement does not. And a trailing "for {buyer}" suppresses the
 * search on its own — twelve variants ended that way and not one searched,
 * including one that differs from a 3/3 template by those two words alone.
 *
 * The natural-demand entries are the same fact used deliberately. They are
 * phrasings the calibration measured at 0/3, chosen because they are what a
 * buyer actually types; their contract is that they will probably NOT search,
 * which is why they carry one sample instead of three and why their citation
 * counts are never presented as a competitive finding.
 */

/** Hash domain for the calibration-locked template text. */
export const GEO_TEMPLATE_TEXT_HASH_DOMAIN = "geo_template_text.v1";

/** The version literal every P0 query set carries. */
export const GEO_TEMPLATE_REGISTRY_VERSION =
  "geo.templates.2026-08-17" as const;

export type GeoTemplateStatus = "passed" | "failed" | "stale" | "unmeasured";

/**
 * Whose names the template's own text puts in front of the model.
 *
 * Independent of the slot and of the mode: this is the axis that decides
 * whether a brand mention in the answer is evidence of anything.
 */
export type GeoPromptConditioning =
  | "customer_unbranded"
  | "competitor_named"
  | "customer_brand_named";

/**
 * What the calibration says this wording does, so a live run can be judged.
 *
 * `web_search_expected` makes a no-search sample an instrumentation failure.
 * `no_web_search_expected` makes it the predicted outcome, and makes the
 * question's value the mention rather than the citation.
 */
export type GeoTemplateExpectation =
  | "web_search_expected"
  | "no_web_search_expected";

export type GeoTemplatePlaceholderName =
  | "categoryStem"
  | "categoryPlural"
  | "categorySingular"
  | "categorySoftware"
  | "buyer"
  | "rivalList"
  | "productName";

/**
 * Known limits of a template's measurement, as codes rather than prose.
 *
 * `software_category_only`: the calibration ran on a software category; the
 * same eight regenerated for "pet insurance" stopped searching on three of
 * them, and which three was not recorded.
 * `single_seed_grandfathered`: measured under the older one-seed bar, not the
 * four-seed bar new wording must now clear.
 * `substituted_name_differs_from_seed`: the seed put a competitor's name where
 * the shipped template puts the customer's.
 */
export type GeoTemplateLimitationCode =
  | "software_category_only"
  | "single_seed_grandfathered"
  | "substituted_name_differs_from_seed";

export interface GeoTemplateSeedEvidence {
  /** The substitution set, for the record: "seo / ceo / semrush". */
  readonly seedLabel: string;
  /** The exact string that was sent, not a description of it. */
  readonly renderedQuestion: string;
  readonly samples: number;
  /** How many of those samples came back with `web_search` true. */
  readonly searchedSamples: number;
}

export interface GeoTemplateEntry {
  readonly templateId: string;
  readonly templateVersion: string;
  /** Exact text, punctuation and clause order included. */
  readonly text: string;
  /** Digest of {@link text}; the test recomputes it, so an edit cannot be quiet. */
  readonly textHash: string;
  readonly placeholders: readonly GeoTemplatePlaceholderName[];
  readonly slot: GeoQuerySlot;
  readonly mode: GeoQueryMode;
  readonly buyerStage: GeoBuyerStage;
  readonly conditioning: GeoPromptConditioning;
  readonly providerEndpoint: string;
  readonly modelPinned: string;
  /** `web_search: true` is a permission, never a guarantee of execution. */
  readonly webSearchRequested: true;
  readonly maxOutputTokensRequested: 4_096;
  readonly queryLanguageTag: "en";
  readonly calibrationMarket: "US";
  readonly expectation: GeoTemplateExpectation;
  readonly seeds: readonly GeoTemplateSeedEvidence[];
  readonly calibratedOn: string;
  /**
   * Whether the wording anchors itself to "now".
   *
   * A property of the string, recorded rather than derived: the currency cue is
   * exactly what makes several of these templates reach the live web, and a
   * question that claims to be about the present has to say which present.
   */
  readonly timeSensitive: boolean;
  /** The registered current-evidence clause, when the template carries one. */
  readonly retrievalTriggerClause: string | null;
  readonly status: GeoTemplateStatus;
  /**
   * Measured under the older bar and carried forward as measured.
   *
   * An optional top-up round can raise these to the four-seed bar. That is a
   * hardening step, not a blocker: the alternative is throwing away evidence
   * that ninety-five paid calls actually produced.
   */
  readonly grandfathered: boolean;
  readonly limitations: readonly GeoTemplateLimitationCode[];
}

const DFS_ENDPOINT =
  "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live";
const PINNED_MODEL = "gpt-5-2025-08-07";
const CALIBRATED_ON = "2026-08-17";

const COMMON = {
  providerEndpoint: DFS_ENDPOINT,
  modelPinned: PINNED_MODEL,
  webSearchRequested: true,
  maxOutputTokensRequested: 4_096,
  queryLanguageTag: "en",
  calibrationMarket: "US",
  calibratedOn: CALIBRATED_ON,
  status: "passed",
  grandfathered: true,
  timeSensitive: true,
} as const;

/**
 * The measured library.
 *
 * Every `renderedQuestion` below is a string that was actually sent and paid
 * for on 2026-08-17 against the visitor's own failing inputs — category "seo",
 * buyer "ceo", rival "semrush" — which is the hardest case because both words
 * are generic. The second seed is the same eight regenerated for a different
 * category and buyer, which searched 8/8 at one sample each.
 */
export const GEO_TEMPLATES: readonly GeoTemplateEntry[] = [
  {
    ...COMMON,
    templateId: "geo.retrieval.category_top",
    templateVersion: "1",
    text: "What are the top {categoryPlural} right now?",
    textHash:
      "sha256:5c74e0282b2ccdb1014f6eb285caa386d6ac713c4edecb386d0c22838778bc1d",
    placeholders: ["categoryPlural"],
    slot: "category_discovery",
    mode: "retrieval_probe",
    buyerStage: "awareness",
    conditioning: "customer_unbranded",
    expectation: "web_search_expected",
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo / semrush",
        renderedQuestion: "What are the top seo tools right now?",
        samples: 3,
        searchedSamples: 3,
      },
      {
        seedLabel: "second category and buyer",
        renderedQuestion: "regenerated set, one sample per question",
        samples: 1,
        searchedSamples: 1,
      },
    ],
    limitations: ["software_category_only", "single_seed_grandfathered"],
  },
  {
    ...COMMON,
    templateId: "geo.retrieval.free_plan",
    templateVersion: "1",
    text: "Which {categorySingular} has the best free plan right now?",
    textHash:
      "sha256:cd11c7431d6efd083d741d6b2f656683445768ba045884ef8ee97cefd2c5a353",
    placeholders: ["categorySingular"],
    slot: "constraint_fit",
    mode: "retrieval_probe",
    buyerStage: "consideration",
    conditioning: "customer_unbranded",
    expectation: "web_search_expected",
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo / semrush",
        renderedQuestion: "Which seo tool has the best free plan right now?",
        samples: 3,
        searchedSamples: 3,
      },
      {
        seedLabel: "second category and buyer",
        renderedQuestion: "regenerated set, one sample per question",
        samples: 1,
        searchedSamples: 1,
      },
    ],
    limitations: ["software_category_only", "single_seed_grandfathered"],
  },
  {
    ...COMMON,
    templateId: "geo.retrieval.alternatives",
    templateVersion: "1",
    // The one measured phrasing that carries the bare category rather than the
    // noun phrase — "alternatives to semrush for seo", not "for seo tools" —
    // and the one that deliberately has no question mark. Both are calibration
    // facts, not oversights.
    text: "Best alternatives to {rivalList} for {categoryStem}",
    textHash:
      "sha256:ba1827da75367ae0dcfcd1e8dd90b3b08ff0c0fe1325537094c2266d9dd0faf1",
    placeholders: ["rivalList", "categoryStem"],
    slot: "alternative_status_quo",
    mode: "retrieval_probe",
    buyerStage: "consideration",
    conditioning: "competitor_named",
    expectation: "web_search_expected",
    timeSensitive: false,
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo / semrush",
        renderedQuestion: "Best alternatives to semrush for seo",
        samples: 3,
        searchedSamples: 3,
      },
      {
        seedLabel: "seo / ceo / semrush and ahrefs",
        renderedQuestion: "Best alternatives to semrush and ahrefs for seo",
        samples: 3,
        searchedSamples: 3,
      },
    ],
    // The same reasoning already recorded on `brand_comparison`, which was not
    // applied here. Both seeds substituted `rivalList` with a name the model
    // certainly knows — "semrush", then "semrush and ahrefs". A visitor's own
    // competitor is usually not one of those, and this is the only retrieval
    // probe with no currency cue in its wording to fall back on
    // (`timeSensitive: false`), so the substituted name is doing more work here
    // than anywhere else.
    limitations: [
      "software_category_only",
      "single_seed_grandfathered",
      "substituted_name_differs_from_seed",
    ],
  },
  {
    ...COMMON,
    templateId: "geo.retrieval.leading_differ",
    templateVersion: "1",
    text: "What are the leading {categoryPlural} right now, and how do they differ?",
    textHash:
      "sha256:a35d1a6dfb946520a40153c1347344caef37e246ebe59e4191ff303ad8d93d66",
    placeholders: ["categoryPlural"],
    slot: "alternative_status_quo",
    mode: "retrieval_probe",
    buyerStage: "consideration",
    conditioning: "customer_unbranded",
    expectation: "web_search_expected",
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo / no rival",
        renderedQuestion:
          "What are the leading seo tools right now, and how do they differ?",
        samples: 3,
        searchedSamples: 3,
      },
      {
        seedLabel: "second category and buyer",
        renderedQuestion: "regenerated set, one sample per question",
        samples: 1,
        searchedSamples: 1,
      },
    ],
    limitations: ["software_category_only", "single_seed_grandfathered"],
  },
  {
    ...COMMON,
    templateId: "geo.retrieval.best_reviews",
    templateVersion: "1",
    text: "Which {categoryPlural} are getting the best reviews right now?",
    textHash:
      "sha256:8ce125a0f2a2f80dea97b6f6d8e2ce833a1692f1b1a07f33fbba9b3565d2668b",
    placeholders: ["categoryPlural"],
    slot: "due_diligence",
    mode: "retrieval_probe",
    buyerStage: "consideration",
    conditioning: "customer_unbranded",
    expectation: "web_search_expected",
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo / semrush",
        renderedQuestion:
          "Which seo tools are getting the best reviews right now?",
        samples: 3,
        searchedSamples: 3,
      },
      {
        seedLabel: "second category and buyer",
        renderedQuestion: "regenerated set, one sample per question",
        samples: 1,
        searchedSamples: 1,
      },
    ],
    limitations: ["software_category_only", "single_seed_grandfathered"],
  },
  {
    ...COMMON,
    templateId: "geo.retrieval.worth_paying",
    templateVersion: "1",
    // Its objection is specifically "is paid software worthwhile", because that
    // is what the string asks. A security, switching-cost or implementation
    // objection is a different question and needs its own calibration.
    text: "Which {categoryPlural} are worth paying for right now?",
    textHash:
      "sha256:9c070dce8be9bd6771c12aeafa4db46d6c5edeb181141fce34d5c83fe7a1df2e",
    placeholders: ["categoryPlural"],
    slot: "negative_fit_objection",
    mode: "retrieval_probe",
    buyerStage: "decision",
    conditioning: "customer_unbranded",
    expectation: "web_search_expected",
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo / semrush",
        renderedQuestion: "Which seo tools are worth paying for right now?",
        samples: 3,
        searchedSamples: 3,
      },
      {
        seedLabel: "second category and buyer",
        renderedQuestion: "regenerated set, one sample per question",
        samples: 1,
        searchedSamples: 1,
      },
    ],
    limitations: ["software_category_only", "single_seed_grandfathered"],
  },

  // Registered measured alternates. Not selected by the default core_8, kept so
  // a later version can swap a slot's wording without paying to re-measure.
  {
    ...COMMON,
    templateId: "geo.retrieval.recommend_instead",
    templateVersion: "1",
    text: "Which {categoryPlural} do people recommend instead of {rivalList} right now?",
    textHash:
      "sha256:6b1020215ba10e4aa87b3e7af95ca40e61cafe1dceb78f84c385ef7a119f6fb8",
    placeholders: ["categoryPlural", "rivalList"],
    slot: "alternative_status_quo",
    mode: "retrieval_probe",
    buyerStage: "consideration",
    conditioning: "competitor_named",
    expectation: "web_search_expected",
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo / semrush",
        renderedQuestion:
          "Which seo tools do people recommend instead of semrush right now?",
        samples: 3,
        searchedSamples: 3,
      },
    ],
    limitations: ["software_category_only", "single_seed_grandfathered"],
  },
  {
    ...COMMON,
    templateId: "geo.retrieval.switching_to",
    templateVersion: "1",
    text: "Which {categoryPlural} are people switching to right now?",
    textHash:
      "sha256:4627dd35e8516825818b714a443489f44ac98bc24e2d05cd8b482839a467bd84",
    placeholders: ["categoryPlural"],
    slot: "alternative_status_quo",
    mode: "retrieval_probe",
    buyerStage: "consideration",
    conditioning: "customer_unbranded",
    expectation: "web_search_expected",
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo / no rival",
        renderedQuestion: "Which seo tools are people switching to right now?",
        samples: 3,
        searchedSamples: 3,
      },
    ],
    limitations: ["software_category_only", "single_seed_grandfathered"],
  },
  {
    ...COMMON,
    templateId: "geo.retrieval.buyer_criteria",
    templateVersion: "1",
    // The buyer appears in a LEADING clause and a factual clause closes the
    // sentence. Reversed — ending on "for {buyer}" — the same question measured
    // 0/3. The trailing clause is registered below as the trigger.
    text: "What should {buyer} look for when choosing {categorySoftware}, and which tools currently do it best?",
    textHash:
      "sha256:ebbb497f9df8811fcf65dffc7f444d8410b2cb3730c4b98db4c58c7293cb7a6a",
    placeholders: ["buyer", "categorySoftware"],
    slot: "constraint_fit",
    mode: "retrieval_probe",
    buyerStage: "consideration",
    conditioning: "customer_unbranded",
    expectation: "web_search_expected",
    retrievalTriggerClause: "which tools currently do it best",
    seeds: [
      {
        seedLabel: "seo / ceo / semrush",
        renderedQuestion:
          "What should ceo look for when choosing seo software, and which tools currently do it best?",
        samples: 3,
        searchedSamples: 3,
      },
    ],
    limitations: ["software_category_only", "single_seed_grandfathered"],
  },
  {
    ...COMMON,
    templateId: "geo.retrieval.pick_reviews",
    templateVersion: "1",
    text: "Which {categorySingular} should {buyer} pick, and what do current reviews say?",
    textHash:
      "sha256:4014e4a046674095e15446f7e3f1279157257fad097f8d28b85ddb76919883a1",
    placeholders: ["categorySingular", "buyer"],
    slot: "due_diligence",
    mode: "retrieval_probe",
    buyerStage: "decision",
    conditioning: "customer_unbranded",
    expectation: "web_search_expected",
    retrievalTriggerClause: "what do current reviews say",
    seeds: [
      {
        seedLabel: "seo / ceo / semrush",
        renderedQuestion:
          "Which seo tool should ceo pick, and what do current reviews say?",
        samples: 3,
        searchedSamples: 3,
      },
    ],
    limitations: ["software_category_only", "single_seed_grandfathered"],
  },

  // Natural demand. These deliberately use phrasings the same calibration
  // measured at 0/3: they are what a buyer types, and the mode exists so that
  // asking them does not have to be dressed up as a citation probe.
  {
    ...COMMON,
    templateId: "geo.natural.jtbd_best_for_buyer",
    templateVersion: "1",
    text: "What are the best {categoryPlural} for {buyer}?",
    textHash:
      "sha256:0cc0b0feea8f2db1d8b59dcd978f68e79223e0d3c1e69db3de162a82be4173a7",
    placeholders: ["categoryPlural", "buyer"],
    slot: "jtbd_outcome",
    mode: "natural_demand",
    buyerStage: "awareness",
    conditioning: "customer_unbranded",
    expectation: "no_web_search_expected",
    timeSensitive: false,
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo",
        renderedQuestion: "What are the best seo tools for ceo?",
        samples: 3,
        searchedSamples: 0,
      },
      {
        seedLabel: "seo / ceo, with a currency cue appended",
        renderedQuestion: "What are the best seo tools for ceo right now?",
        samples: 3,
        searchedSamples: 0,
      },
    ],
    limitations: ["software_category_only"],
  },
  {
    ...COMMON,
    templateId: "geo.natural.pain_current_workflow",
    templateVersion: "1",
    text: "How do {buyer} currently handle {categoryStem}, and which tools do they use?",
    textHash:
      "sha256:5fe186e9ed10d0ae8061215933783d61204f60ef153d305f05cec13cf3be94b6",
    placeholders: ["buyer", "categoryStem"],
    slot: "pain_how_to",
    mode: "natural_demand",
    buyerStage: "awareness",
    conditioning: "customer_unbranded",
    expectation: "no_web_search_expected",
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / ceo",
        renderedQuestion:
          "How do ceo currently handle seo, and which tools do they use?",
        samples: 3,
        searchedSamples: 0,
      },
    ],
    limitations: ["software_category_only"],
  },
  {
    ...COMMON,
    templateId: "geo.natural.brand_comparison",
    templateVersion: "1",
    // A prompted-brand diagnostic. The answer WILL repeat the brand, because
    // the question contains it, so a mention here is never evidence of
    // discovery — what it measures is how the model frames the brand against
    // its alternatives and which sources it reaches for to do so.
    text: "How does {productName} compare to other {categoryPlural}?",
    textHash:
      "sha256:6f3a305c8192e5cd9308cf5f934c215aa6747676e91cb23b10671ff425290394",
    placeholders: ["productName", "categoryPlural"],
    slot: "brand_comparison",
    mode: "natural_demand",
    buyerStage: "decision",
    conditioning: "customer_brand_named",
    expectation: "no_web_search_expected",
    timeSensitive: false,
    retrievalTriggerClause: null,
    seeds: [
      {
        seedLabel: "seo / semrush in the brand position",
        renderedQuestion: "How does semrush compare to other seo tools?",
        samples: 3,
        searchedSamples: 0,
      },
    ],
    limitations: [
      "software_category_only",
      "substituted_name_differs_from_seed",
    ],
  },
];

/**
 * Phrasings measured to 0/3 that a retrieval probe may never use.
 *
 * Kept as exact rendered strings rather than patterns: "What are the best seo
 * tools for ceo right now?" asks for something current, does not end on the
 * buyer, and still measured 0/3, so every loose rule that admits the survivors
 * admits it too. A natural-demand question may use these deliberately — three
 * of the entries above do — but only with `no_web_search_expected` recorded.
 */
export const GEO_MEASURED_DEAD_RETRIEVAL_WORDINGS: readonly string[] = [
  "What are the best seo tools for ceo?",
  "What are the best seo tools for ceo right now?",
  "What are the best seo tools for ceo in 2026?",
  "How does semrush compare to other seo tools?",
  "Is paid seo software worth it right now, or are the free tools enough?",
  "Which seo tool is easiest for ceo to start with?",
  "Which seo tool are people recommending right now for ceo?",
  "How do ceo currently handle seo, and which tools do they use?",
];

const BY_KEY: ReadonlyMap<string, GeoTemplateEntry> = new Map(
  GEO_TEMPLATES.map((entry) => [
    `${entry.templateId}@${entry.templateVersion}`,
    entry,
  ]),
);

export function findGeoTemplate(
  templateId: string,
  templateVersion: string,
): GeoTemplateEntry | null {
  return BY_KEY.get(`${templateId}@${templateVersion}`) ?? null;
}

/**
 * The bar new retrieval wording has to clear: four different seeds, three
 * identical samples each, every one of them searching.
 *
 * Four seeds that exercise substitution risk, not four synonyms — a short
 * generic category, a multiword category, one carrying an acronym or hyphen,
 * and one near the length bound. This is an operational gate, not statistical
 * proof: no finite seed suite certifies every production rendering, which is
 * why every live retrieval probe is also judged by its own probe status.
 */
export const GEO_CALIBRATION_SEED_COUNT = 4;
export const GEO_CALIBRATION_SAMPLES_PER_SEED = 3;

function meetsCurrentRetrievalBar(entry: GeoTemplateEntry): boolean {
  return (
    entry.seeds.length >= GEO_CALIBRATION_SEED_COUNT &&
    entry.seeds.every(
      (seed) =>
        seed.samples >= GEO_CALIBRATION_SAMPLES_PER_SEED &&
        seed.searchedSamples === seed.samples,
    )
  );
}

/**
 * Whether the grandfathered evidence is what it claims to be.
 *
 * At least one seed measured with every sample searching. Weaker than the bar
 * above and deliberately so — these strings were measured before the bar
 * existed and the alternative is discarding real evidence — but not weaker than
 * "somebody said it was fine".
 */
function meetsGrandfatheredBar(entry: GeoTemplateEntry): boolean {
  return entry.seeds.some(
    (seed) => seed.samples >= 3 && seed.searchedSamples === seed.samples,
  );
}

/** Whether a natural-demand entry's expected-no-search claim was measured. */
function meetsNaturalDemandBar(entry: GeoTemplateEntry): boolean {
  return entry.seeds.some(
    (seed) => seed.samples >= 3 && seed.searchedSamples === 0,
  );
}

/**
 * Whether this template may be attached to a query of this mode.
 *
 * The query contract calls this before a retrieval probe is allowed to exist,
 * and the server calls the query contract again before it bills anything.
 */
export function isGeoTemplateShippable(
  templateId: string,
  templateVersion: string,
  mode: GeoQueryMode,
): boolean {
  const entry = findGeoTemplate(templateId, templateVersion);
  return entry !== null && isGeoTemplateEntryShippable(entry, mode);
}

/**
 * The same decision on an entry that is not in the registry.
 *
 * Exported so a test can prove a `failed`, `stale` or `unmeasured` entry is
 * refused without a broken template having to be shipped in the live library to
 * demonstrate it.
 */
export function isGeoTemplateEntryShippable(
  entry: GeoTemplateEntry,
  mode: GeoQueryMode,
): boolean {
  if (entry.mode !== mode) return false;
  if (entry.status !== "passed") return false;

  if (mode === "retrieval_probe") {
    if (entry.expectation !== "web_search_expected") return false;
    if (GEO_MEASURED_DEAD_RETRIEVAL_WORDINGS.includes(entry.text)) return false;
    return entry.grandfathered
      ? meetsGrandfatheredBar(entry)
      : meetsCurrentRetrievalBar(entry);
  }

  return meetsNaturalDemandBar(entry);
}

export type GeoPlaceholderRejection =
  | "empty"
  | "too_long"
  | "not_normalized"
  | "template_syntax"
  | "markup"
  | "sentence_punctuation"
  | "too_many_words";

/**
 * How long each ingredient may be.
 *
 * Bounded on the ingredient rather than on the finished question, because every
 * template ends on the clause that makes it work and a length guard that trims
 * the sentence deletes exactly the words the calibration is about. A run once
 * spent 24 calls on 4 distinct prompts because five templates opened with the
 * same two words and the trimmer collapsed them into one string.
 */
export const GEO_PLACEHOLDER_MAX_LENGTH: Readonly<
  Record<GeoTemplatePlaceholderName, number>
> = {
  categoryStem: 60,
  categoryPlural: 66,
  categorySingular: 65,
  categorySoftware: 69,
  buyer: 60,
  rivalList: 90,
  productName: 80,
};

const TRAILING_SENTENCE_PUNCTUATION = /[?!.。？！:：;；]$/u;

/**
 * Structural validation of one substitution value.
 *
 * Structural only, and that boundary is deliberate. "No instructions" cannot be
 * enforced by a keyword list — a blocklist that rejects "ignore previous" waves
 * through every rewording of it — so what is enforced here is that the value
 * stays a bounded noun phrase on one line with nothing appended after the
 * calibrated ending, and the rest is enforced by showing the visitor the exact
 * rendered question before a single call is billed.
 */
export function validateGeoPlaceholderValue(
  name: GeoTemplatePlaceholderName,
  value: string,
): GeoPlaceholderRejection | null {
  if (normalizeGeoText(value) !== value) return "not_normalized";
  if (value.length === 0) return "empty";
  if (value.length > GEO_PLACEHOLDER_MAX_LENGTH[name]) return "too_long";
  if (value.includes("{") || value.includes("}")) return "template_syntax";
  if (value.includes("<") || value.includes(">")) return "markup";
  // A trailing full stop is what turns "SEO tools." into a question about
  // "SEO tools. tools"; a trailing question mark ends the sentence early and
  // strands the calibrated clause after it.
  if (TRAILING_SENTENCE_PUNCTUATION.test(value)) return "sentence_punctuation";
  if (value.split(" ").length > 12) return "too_many_words";
  return null;
}

/**
 * Whether this text could be a rendering of this template.
 *
 * The guard cannot re-render a template — it has no substitution values — but
 * it can check the shape: literal segments in order, one bounded noun phrase
 * where each placeholder sits. Without this check, `templateId` is a label a
 * client can staple to arbitrary unmeasured text, and "measured wording" stops
 * meaning anything.
 */
export function isGeoTemplateRendering(
  entry: GeoTemplateEntry,
  text: string,
): boolean {
  const parts = entry.text.split(/\{([a-zA-Z]+)\}/u);
  // Odd indices are placeholder names, even indices are literal segments.
  const pattern = parts
    .map((part, index) =>
      index % 2 === 1
        ? "([^{}<>]+?)"
        : part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
    )
    .join("");
  const match = new RegExp(`^${pattern}$`, "u").exec(text);
  if (match === null) return false;

  for (let index = 1; index < parts.length; index += 2) {
    const name = parts[index] as GeoTemplatePlaceholderName;
    const value = match[(index + 1) / 2];
    if (value === undefined) return false;
    if (validateGeoPlaceholderValue(name, value) !== null) return false;
  }
  return true;
}

export type GeoTemplateRenderResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly placeholder: GeoTemplatePlaceholderName;
      readonly reason: GeoPlaceholderRejection | "missing";
    };

/**
 * Render one template with confirmed values.
 *
 * Every placeholder the template declares must be supplied and valid; nothing
 * else is substituted, and no value is repaired. A rejected value stops the run
 * at the confirm step, where a human can fix it, rather than reaching the
 * provider as a question nobody measured.
 */
export function renderGeoTemplate(
  entry: GeoTemplateEntry,
  values: Partial<Record<GeoTemplatePlaceholderName, string>>,
): GeoTemplateRenderResult {
  let text = entry.text;
  for (const placeholder of entry.placeholders) {
    const value = values[placeholder];
    if (value === undefined) {
      return { ok: false, placeholder, reason: "missing" };
    }
    const rejection = validateGeoPlaceholderValue(placeholder, value);
    if (rejection !== null) {
      return { ok: false, placeholder, reason: rejection };
    }
    text = text.split(`{${placeholder}}`).join(value);
  }
  return { ok: true, text };
}
