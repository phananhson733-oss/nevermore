// @input -- frozen v2/v3 context and untrusted model or exported generation
// @output -- exact source-bound whole writing plan
// @pos -- v2 generation validation; legacy v1 remains unchanged
import { canonicalizeUrl } from "@sf/sources/canonical-url";
import { keywordCoverageProperty } from "../keyword-opportunity/property.ts";
import { canonicalize } from "./canonical.ts";
import { buildSerpObservations } from "./assemble.ts";
import {
  EXPECTED_BRIEF_SCRIPTS, NON_WHITESPACE_TOKENIZED_LANGUAGES, SERP_DEPTH,
  SUPPORTING_KEYWORDS_MAX, UNSEGMENTED_SCRIPT_CLASS,
} from "./constants.ts";
import type { ProfileFact } from "./contract.ts";
import {
  array, at, finite, identifier, invalid, isRecord, literal, modelText, nullable, object, ok, oneOf, reference,
  serpObservationShape, serpReadMeta, tagged, text,
  type Decoded, type Decoder,
} from "./parse-brief-shape.ts";
import {
  BRIEF_TITLE_ALTERNATIVES_MAX, briefPlanningAvailable,
  RESEARCH_HEADING_MAX_CHARS, RESEARCH_OUTLINE_MAX, RESEARCH_PAGE_UNITS_MAX, RESEARCH_PAA_MAX,
  RESEARCH_QUESTION_MAX, RESEARCH_QUESTION_MAX_CHARS, type ModelResearchOutput, type ResearchResult,
} from "./v2-contract.ts";
import { parseResearchBundle, parseResearchResult, validateResearchOutput } from "./v2-research.ts";
import type {
  BriefV2Context, BriefV2Generated, BriefV2PlanStep, BriefV2Planning, BriefV2SectionPlan, BriefV2SectionPurpose, BriefV2WritingPlan, ModelBriefV2Output,
} from "./v2-generation-contract.ts";

const TEXT_MAX = 400;
const UNIT_MAX = RESEARCH_PAGE_UNITS_MAX + RESEARCH_PAA_MAX;
const sourceText = (max: number): Decoder<string> => (input, path) =>
  typeof input === "string" && input.trim() !== "" && Array.from(input).length <= max ? ok(input) : invalid(path);
const count: Decoder<number> = (input, path) =>
  typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? ok(input) : invalid(path);
const positive: Decoder<number> = (input, path) =>
  typeof input === "number" && Number.isFinite(input) && input > 0 ? ok(input) : invalid(path);
const revision: Decoder<number> = (input, path) =>
  typeof input === "number" && Number.isSafeInteger(input) && input > 0 ? ok(input) : invalid(path);
const hash: Decoder<string> = (input, path) =>
  typeof input === "string" && /^[a-f0-9]{64}$/u.test(input) ? ok(input) : invalid(path);
const date: Decoder<string> = (input, path) => {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(input)) return invalid(path);
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === input ? ok(input) : invalid(path);
};
const url: Decoder<string> = (input, path) => {
  if (typeof input !== "string" || input.length > 2048) return invalid(path);
  try {
    const parsed = new URL(input);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname !== "" &&
      parsed.username === "" && parsed.password === "" && parsed.href.length <= 2048 ? ok(input) : invalid(path);
  } catch { return invalid(path); }
};
const phrase = (value: string) => value.trim().replace(/\s+/gu, " ");
const queryKey = (value: string) => phrase(value.normalize("NFKC")).toLowerCase();
const keyword: Decoder<string> = (input, path) => {
  const parsed = sourceText(200)(input, path);
  return parsed.ok && phrase(parsed.value) !== parsed.value ? invalid(path) : parsed;
};
function pageKey(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  return parsed.href;
}

/** Stable page identity for candidate selection and bindings, never a replacement for raw source URLs. */
export function briefV2PageKey(value: string): string | null {
  return url(value, "").ok ? canonicalizeUrl(value)?.subjectUrl ?? null : null;
}

/** Browser-safe page identity; transport separately enforces public DNS, ports and every redirect hop. */
export function sameBriefV2OwnedPage(submittedUrl: string, destination: string): boolean {
  if (!url(submittedUrl, "").ok || !url(destination, "").ok) return false;
  const submitted = new URL(submittedUrl);
  const target = new URL(destination);
  if (submitted.protocol === "https:" && target.protocol !== "https:") return false;
  const fromHost = submitted.hostname;
  const toHost = target.hostname;
  if (fromHost.replace(/^www\./u, "") !== toHost.replace(/^www\./u, "")) return false;
  if (fromHost !== toHost && fromHost !== `www.${toHost}` && toHost !== `www.${fromHost}`) return false;
  const rebased = canonicalizeUrl(`${target.origin}${submitted.pathname}${submitted.search}`);
  return rebased !== null && rebased.subjectUrl === canonicalizeUrl(destination)?.subjectUrl;
}

function nested<T>(result: Decoded<T>, path: string): Decoded<T> {
  return result.ok ? result : { ...result, path: at(path, result.path) };
}

const factBase = { id: identifier("P"), field: sourceText(2000), text: sourceText(300) };
const firstHandFact = (derivation: "declared" | "observed" | "computed") => object({
  ...factBase, derivation: literal(derivation), provenance: object({ method: literal("observed"), origin: literal("product_profile") }),
});
const fact: Decoder<ProfileFact> = tagged("derivation", {
  declared: firstHandFact("declared"), observed: firstHandFact("observed"), computed: firstHandFact("computed"),
  inferred: object({ ...factBase, derivation: literal("inferred"), provenance: object({
    method: literal("model"), derived_from: (input, path) =>
      Array.isArray(input) && input.length === 1 && input[0] === "product_profile" ? ok<["product_profile"]>(["product_profile"]) : invalid(path),
  }) }),
});
const candidateId = oneOf(["T1", "T2", "T3"] as const);
type SerpSnapshot = NonNullable<BriefV2Context["serp"]>;
const serpSnapshotShape = object({ rows: array(serpObservationShape(text(2048)), { max: SERP_DEPTH }), read: serpReadMeta });
const serpSnapshot: Decoder<SerpSnapshot> = (input, path) => {
  const parsed = serpSnapshotShape(input, path);
  if (!parsed.ok) return parsed;
  const { rows, read } = parsed.value;
  if (read.status === "unavailable") {
    if (rows.length !== 0 || (read.attempted !== null && !Number.isSafeInteger(read.attempted))) return reference(path);
  } else {
    if (![read.requested, read.returned, read.unresolved].every(Number.isSafeInteger) || read.requested > SERP_DEPTH ||
        read.returned < 1 || read.returned > read.requested || rows.length !== read.returned ||
        (read.status === "partial") !== (read.returned < read.requested || read.unresolved > 0)) return reference(at(path, "read"));
  }
  if (new Set(rows.map((row) => row.rank)).size !== rows.length || rows.some((row) => !Number.isSafeInteger(row.rank))) return reference(at(path, "rows"));
  const rebuilt = buildSerpObservations(rows);
  return canonicalize(rebuilt) === canonicalize(rows) ? parsed : reference(at(path, "rows"));
};
const contextFields = {
  input: object({ primary: keyword, supporting: array(keyword, { max: SUPPORTING_KEYWORDS_MAX }), market: sourceText(64), language: sourceText(64) }),
  research: (input: unknown, path: string) => nested(parseResearchBundle(input), path),
  facts: array(fact, { max: 32 }),
  profile_snapshot: nullable(object({ website_id: sourceText(128), revision, hash })),
  gsc: object({
    status: oneOf(["complete", "partial", "unavailable"] as const), property: nullable(sourceText(2048)),
    window: nullable(object({ start: date, end: date, lookback_days: literal(28) })),
    reason: nullable(oneOf(["not_requested", "not_connected", "timeout", "provider_error"] as const)), omitted_matches: count,
    matches: array(object({
      id: identifier("G"), query: sourceText(2000), keyword, scope: oneOf(["primary", "supporting"] as const),
      page: url, clicks: finite(0), impressions: finite(0), position: nullable(positive),
    }), { max: 30 }),
  }),
  candidates: array(object({
    id: candidateId, url, match_refs: array(identifier("G"), { max: 30, unique: true }), read: oneOf(["observed", "unavailable", "redirected"] as const),
  }), { max: 3 }),
};
const contextShape: Decoder<BriefV2Context> = object(contextFields);
const contextWithSerpShape: Decoder<BriefV2Context> = object({ ...contextFields, serp: serpSnapshot });

/** The source ledger is immutable observed data, not a source-authenticity signature. */
export function parseBriefV2Context(input: unknown): Decoded<BriefV2Context> {
  const parsed = isRecord(input) && Object.hasOwn(input, "serp") ? contextWithSerpShape(input, "") : contextShape(input, "");
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const primary = queryKey(value.input.primary);
  const supporting = new Set(value.input.supporting.map(queryKey));
  if (supporting.size !== value.input.supporting.length || supporting.has(primary)) return reference("input.supporting");
  if (new Set(value.facts.map((item) => item.id)).size !== value.facts.length) return reference("facts");
  if (value.facts.length > 0 && value.profile_snapshot === null) return reference("profile_snapshot");
  const gsc = value.gsc;
  if (gsc.property !== null) {
    const probe = gsc.property.startsWith("sc-domain:") ? `https://${gsc.property.slice("sc-domain:".length)}` : gsc.property;
    if (keywordCoverageProperty(probe, [gsc.property]) !== gsc.property) return reference("gsc.property");
  } else if (value.candidates.length > 0 || value.research.pages.some((item) => item.role === "owned")) return reference("gsc.property");
  const ownedByProperty = (page: string) => gsc.property !== null && keywordCoverageProperty(page, [gsc.property]) === gsc.property;
  for (const [index, page] of value.research.pages.entries()) {
    if (page.role === "owned" ? !ownedByProperty(page.url) || !ownedByProperty(page.final_url)
      : ownedByProperty(page.url) || ownedByProperty(page.final_url)) return reference(`research.pages[${index}].role`);
    if (value.serp !== undefined && page.role === "competitor") {
      const row = value.serp.rows.find((item) => item.id === page.id.replace(/^C/u, "S"));
      if (row === undefined || row.url !== page.url) return reference(`research.pages[${index}].url`);
    }
  }
  if (gsc.window !== null && Date.parse(gsc.window.end) - Date.parse(gsc.window.start) !== 27 * 86400_000) return reference("gsc.window");
  if (gsc.status === "unavailable") {
    if (gsc.reason === null || gsc.matches.length !== 0 || gsc.omitted_matches !== 0) return reference("gsc");
    if (gsc.reason === "not_requested" && (gsc.property !== null || gsc.window !== null)) return reference("gsc");
    if (["timeout", "provider_error"].includes(gsc.reason) && gsc.property === null) return reference("gsc.property");
  } else if (gsc.reason !== null || gsc.property === null || gsc.window === null || (gsc.omitted_matches > 0 && gsc.status !== "partial")) return reference("gsc");
  const seenMatches = new Set<string>();
  for (const [index, match] of gsc.matches.entries()) {
    const path = `gsc.matches[${index}]`;
    if (match.id !== `G${index + 1}`) return reference(`${path}.id`);
    if (!ownedByProperty(match.page)) return reference(`${path}.page`);
    const key = queryKey(match.query);
    if (key !== queryKey(match.keyword) || (match.scope === "primary" ? key !== primary : !supporting.has(key))) return reference(`${path}.scope`);
    const identity = JSON.stringify([match.query, pageKey(match.page)]);
    if (seenMatches.has(identity)) return reference(path);
    seenMatches.add(identity);
  }
  const matches = new Map(gsc.matches.map((item) => [item.id, item]));
  const owned = new Map(value.research.pages.filter((item) => item.role === "owned").map((item) => [item.id, item]));
  const candidateIds = new Set<string>();
  const candidateUrls = new Set<string | null>();
  for (const [index, candidate] of value.candidates.entries()) {
    const path = `candidates[${index}]`;
    if (!ownedByProperty(candidate.url)) return reference(`${path}.url`);
    const identity = briefV2PageKey(candidate.url);
    if (candidateIds.has(candidate.id) || candidateUrls.has(identity)) return reference(path);
    candidateIds.add(candidate.id);
    candidateUrls.add(identity);
    for (const ref of candidate.match_refs) {
      const match = matches.get(ref);
      if (match === undefined || briefV2PageKey(match.page) !== identity) return reference(`${path}.match_refs`);
    }
    const page = owned.get(candidate.id);
    if (candidate.read === "observed") {
      if (page === undefined || page.url !== candidate.url || page.research.segments.length === 0 ||
          !sameBriefV2OwnedPage(candidate.url, page.final_url)) return reference(`${path}.read`);
    } else if (page !== undefined) return reference(`${path}.read`);
  }
  if ([...owned.keys()].some((id) => !candidateIds.has(id))) return reference("candidates");
  return parsed;
}

/** Only free text is normalized at the model boundary. IDs and mappings stay exact. */
function generatedText(max: number, strict: boolean): Decoder<string> {
  const decode = modelText(max);
  return (input, path) => decode(typeof input === "string" && !strict ? phrase(input) : input, path);
}
function writingShape(strict: boolean, answerPrefix: "U" | "Q"): Decoder<BriefV2WritingPlan> {
  const text = generatedText(TEXT_MAX, strict);
  return object({
    intent: nullable(object({ value: oneOf(["informational", "commercial", "transactional", "navigational"] as const), rationale: text })),
    format: nullable(object({ value: oneOf(["guide", "listicle", "comparison", "product_page", "tool", "other"] as const), rationale: text })),
    page_plan: object({
      action: oneOf(["create", "update", "undecidable"] as const), rationale: text, target_ref: nullable(candidateId),
      steps: array(object({ kind: oneOf(["keep", "add", "rewrite"] as const), instruction: text,
        sources: array(identifier("U"), { max: UNIT_MAX, unique: true }), answers: array(identifier(answerPrefix), { max: RESEARCH_QUESTION_MAX, unique: true }),
      }), { max: 12 }),
    }),
    gap_angle: nullable(object({ value: text, rationale: text, fact_refs: array(identifier("P"), { min: 1, max: 32, unique: true }), sources: array(identifier("U"), { min: 1, max: RESEARCH_PAGE_UNITS_MAX, unique: true }) })),
    internal_links: array(object({ page_ref: candidateId, anchor: text, why: text }), { max: 5 }),
    do_not_cover: array(object({ page_ref: candidateId, topic: text, why: text }), { max: 5 }),
  });
}

/**
 * One planning member is required and the rest are optional, by construction.
 *
 * planning is the key this brief grows editorial layers in, and a brief issued
 * between two deploys has to stay readable rather than fail the exact key set
 * on a field nobody had written yet. title shipped with the key; every member
 * added after it is stripped out before the key set runs and decoded on its
 * own, so an old brief is missing a member rather than carrying an unknown one.
 *
 * A model reply sends one focus per section in outline order and no id; the
 * frozen document that comes back stores the O id the server bound it to. That
 * is the same distinction `strict` already carries everywhere in this file.
 */
type DecodedSectionPlan = { readonly section_id?: string; readonly purpose: BriefV2SectionPurpose; readonly focus: string };
type DecodedPlanning = { readonly title: BriefV2Planning["title"]; readonly sections?: readonly DecodedSectionPlan[] };
function planningShape(strict: boolean): Decoder<DecodedPlanning> {
  const option = object({ value: generatedText(RESEARCH_HEADING_MAX_CHARS, strict), rationale: generatedText(TEXT_MAX, strict) });
  const titled = object({ title: object({ recommended: option, alternatives: array(option, { max: BRIEF_TITLE_ALTERNATIVES_MAX }) }) });
  const purpose = oneOf(["define", "procedure", "interpret", "compare", "limits"] as const);
  const plan: Decoder<DecodedSectionPlan> = strict
    ? object({ section_id: identifier("O"), purpose, focus: generatedText(TEXT_MAX, strict) })
    : object({ purpose, focus: generatedText(TEXT_MAX, strict) });
  return (input, path) => {
    if (!isRecord(input)) return invalid(path);
    const { sections, ...rest } = input;
    const title = titled(rest, path);
    if (!title.ok || !Object.hasOwn(input, "sections")) return title;
    const decoded = array(plan, { max: RESEARCH_OUTLINE_MAX })(sections, at(path, "sections"));
    return decoded.ok ? ok({ ...title.value, sections: decoded.value }) : decoded;
  };
}

/**
 * Bind each focus to the section it plans, and refuse a plan that cannot be.
 *
 * One entry per outline section, in outline order: fewer or more is a reply
 * that lost track of its own article, and binding it anyway would attach one
 * section's purpose to another's evidence. On the frozen re-read the stored id
 * has to be the id this outline derives, so a document whose sections were
 * renumbered cannot keep its old plan.
 */
function bindSectionPlans(planning: DecodedPlanning, outline: ResearchResult["outline"]): Decoded<BriefV2Planning> {
  const { sections, ...rest } = planning;
  if (sections === undefined) return ok(rest);
  if (sections.length !== outline.length) return reference("planning.sections");
  const bound: BriefV2SectionPlan[] = [];
  for (const [index, plan] of sections.entries()) {
    const section_id = outline[index]!.id;
    if (plan.section_id !== undefined && plan.section_id !== section_id) return reference(`planning.sections[${index}].section_id`);
    bound.push({ section_id, purpose: plan.purpose, focus: plan.focus });
  }
  return ok({ ...rest, sections: bound });
}

/**
 * Every word the run actually put in front of the model, lowercased.
 *
 * The title is checked against this and nothing else. Page text and headings
 * are what the excerpts said; the requested keywords and the Search Console
 * queries are what the visitor asked about; PAA is what the search engine
 * reported people ask. A word in none of them was not read anywhere.
 */
function suppliedVocabulary(context: BriefV2Context): ReadonlySet<string> {
  const sources = [
    context.input.primary, ...context.input.supporting,
    ...context.facts.map((fact) => fact.text),
    ...context.gsc.matches.flatMap((match) => [match.query, match.keyword]),
    ...context.research.paa.flatMap((item) => [item.question, item.seed_question ?? ""]),
    ...context.research.pages.flatMap((page) => page.research.segments.flatMap((segment) => [segment.text, segment.heading?.text ?? ""])),
    ...(context.serp === undefined ? [] : context.serp.rows.map((row) => row.title ?? "")),
  ];
  const vocabulary = new Set<string>();
  for (const source of sources) for (const word of words(source)) vocabulary.add(word.toLowerCase());
  return vocabulary;
}

/**
 * One word list, applied to the title and to every supplied string alike.
 *
 * Two normalisations, both of which exist because a lookup that misses is a
 * correct title refused. NFKC because the context's own keyword matching
 * already treats compatibility spellings as the same word, so a run whose
 * keyword is written in fullwidth letters supplies GSC and would otherwise
 * have "GSC" refused as unsupplied. And a full stop between two letters is
 * dropped, so an initialism written as U.S. is one token on both sides rather
 * than single letters no acronym rule can see.
 */
function words(value: string): readonly string[] {
  return value.normalize("NFKC").replace(/(\p{L})\.(?=\p{L})/gu, "$1")
    .split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
}

/** Two letters or more, all of them capitals: the one proper-noun shape Title Case cannot disguise. */
const ACRONYM = /^\p{Lu}{2,}$/u;
/**
 * Every number a reader can see, including the one Unicode does not count.
 *
 * U+1F51F KEYCAP TEN is a symbol, not a Number, so \p{N} alone accepts
 * "\u{1F51F} Reasons Search Console Data Lags" -- a published count with no
 * evidence behind it, which is the exact string this rule exists to refuse.
 * The check runs on the title as written, before NFKC: normalising first would
 * turn a Roman numeral into letters and let it through as an acronym instead.
 */
const DIGIT = /[\p{N}\u{1F51F}]/u;

/**
 * What a title may not do, given that no sentence rule will ever see it.
 *
 * Both rules are subtractive and both name a concrete harm. A number in a title
 * is a published measurement with no evidence_refs behind it and no support
 * count derived for it -- "3 Reasons", "The 2026 Guide", "the 90% case" -- and
 * the excerpt that would have justified it is never checked. An all-capital
 * token is the one proper noun that survives Title Case, which is why a
 * fabricated authority hides there and nowhere the eye can catch it.
 *
 * This is a floor, not entity recognition. An invented ordinary-cased name
 * still passes, because in Title Case every word is capitalized and the only
 * table available for telling content words from function words is a
 * heading-normalisation stopword list -- narrow enough that "what" and "how"
 * are content words to it, so a provenance rule built on it would drop correct
 * titles far more often than fabricated ones. The prompt carries that rule as
 * an instruction instead, and the title stays droppable so a rejection costs
 * the title rather than the run.
 */
function checkTitle(planning: DecodedPlanning, vocabulary: ReadonlySet<string>, path: string): string | null {
  const options = [{ option: planning.title.recommended, at: `${path}.title.recommended` },
    ...planning.title.alternatives.map((option, index) => ({ option, at: `${path}.title.alternatives[${index}]` }))];
  for (const { option, at: where } of options) {
    if (DIGIT.test(option.value)) return `${where}.value`;
    for (const word of words(option.value)) {
      if (ACRONYM.test(word) && !vocabulary.has(word.toLowerCase())) return `${where}.value`;
    }
  }
  const values = options.map(({ option }) => option.value);
  return new Set(values).size === values.length ? null : `${path}.title.alternatives`;
}

const modelResearchShape: Decoder<ModelResearchOutput> = object({
  questions: array(object({ anchor: identifier("U"), q: generatedText(RESEARCH_QUESTION_MAX_CHARS, false), sources: array(identifier("U"), { min: 1, max: UNIT_MAX, unique: true }) }), { max: RESEARCH_QUESTION_MAX }),
  outline: array(object({ h2: generatedText(RESEARCH_HEADING_MAX_CHARS, false), h3: array(generatedText(RESEARCH_HEADING_MAX_CHARS, false), { max: 3 }), answers: array(identifier("U"), { min: 1, max: RESEARCH_QUESTION_MAX, unique: true }) }), { max: RESEARCH_OUTLINE_MAX }),
});

type DecodedWholeShape<R> = Omit<BriefV2WritingPlan, "planning"> & { readonly planning?: DecodedPlanning; readonly research: R };
function wholeShape<R>(input: unknown, research: Decoder<R>, strict: boolean, answerPrefix: "U" | "Q", planningAllowed: boolean): Decoded<DecodedWholeShape<R>> {
  // Decode the known writing fields without dropping unknown top-level keys.
  if (typeof input !== "object" || input === null || Array.isArray(input)) return invalid("");
  if (!Object.hasOwn(input, "research")) return invalid("research");
  const { research: rawResearch, ...rest } = input as Record<string, unknown>;
  // Only a run that was offered the planning layer takes the key out before the
  // strict key set runs. On every other run it stays in, so an unrequested
  // planning block is refused by the same rule, at the same path, as it was
  // before the layer existed.
  const { planning: rawPlanning, ...offered } = rest;
  const carried = planningAllowed && Object.hasOwn(rest, "planning");
  const plan = writingShape(strict, answerPrefix)(planningAllowed ? offered : rest, "");
  if (!plan.ok) return plan;
  const result = research(rawResearch, "research");
  if (!result.ok) return result;
  if (!carried) return ok({ ...plan.value, research: result.value });
  const planning = planningShape(strict)(rawPlanning, "planning");
  return planning.ok ? ok({ ...plan.value, planning: planning.value, research: result.value }) : planning;
}

const CJK_LETTER = new RegExp(`[${UNSEGMENTED_SCRIPT_CLASS}]`, "u");
const LETTER = /\p{L}/u;
/** Four letters is enough to tell a written phrase from a quoted term or a code. */
const SCRIPT_SAMPLE_MIN = 4;

/**
 * Quoted spans are dropped before counting.
 *
 * "『吾輩は猫である』: plot" is a correct English heading that names a work by
 * its original title, and counting the title's letters as generated prose made
 * the majority test reject it. A citation is not the writing.
 *
 * Only paired quotation marks delimit a span. The apostrophe is deliberately
 * absent: "the writer's own words" would otherwise read as a quotation and
 * lose its letters, and an English possessive is far commoner here than a
 * single-quoted title.
 */
const QUOTE_OPEN: ReadonlySet<string> = new Set(["\u300c", "\u300e", "\u201c", "\u00ab", "\u300a", "\""]);
const QUOTE_CLOSE: ReadonlySet<string> = new Set(["\u300d", "\u300f", "\u201d", "\u00bb", "\u300b", "\""]);

/**
 * Two passes, not a regular expression.
 *
 * The obvious pattern for a quoted span is `open [^close]* close`, which is
 * quadratic on an opening mark that never closes: the inner class runs to the
 * end and backtracks, once per opening mark. Measured on that shape, 4000
 * characters cost 14 ms and 20000 cost 382 ms. This is not a live denial of
 * service — every string that reaches here was already rejected above unless it
 * fits its own decoder, and the longest of those is a 400-character question —
 * so the quadratic form cost a few milliseconds, not a run. It is replaced
 * because a bound that only holds through another module is not a bound; a
 * backward pass recording the next closing mark makes this one local.
 *
 * An unterminated opening mark is deliberately not a span. Treating the rest
 * of the string as quoted would let one stray quote exempt a whole heading
 * from the language check.
 */
function withoutQuotedSpans(value: string): string {
  const chars = [...value];
  const nextClose = new Int32Array(chars.length + 1).fill(-1);
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    nextClose[index] = QUOTE_CLOSE.has(chars[index]!) ? index : nextClose[index + 1]!;
  }
  let out = "";
  for (let index = 0; index < chars.length; index += 1) {
    const character = chars[index]!;
    if (!QUOTE_OPEN.has(character)) { out += character; continue; }
    const close = nextClose[index + 1]!;
    if (close === -1) { out += character; continue; }
    out += " ";
    index = close;
  }
  return out;
}

/**
 * Why the language of the output is checked at all.
 *
 * The evidence a brief is built from is whatever the top ten results happen to
 * be written in, and it regularly outweighs the visitor's own keywords. An
 * English run on 2026-09-07 came back with every heading in Chinese, because
 * thirty-two of the supplied profile facts were Chinese and nothing in the
 * pipeline disagreed. The instruction now names the language, and this is the
 * check that makes the instruction enforceable.
 *
 * Two tests, because the two directions are not alike. The per-string majority
 * test below reads a Latin-script run and rejects any single string that came
 * back mostly CJK: that is unmistakable, and the minimum sample keeps a
 * two-character borrowing out of it. The brief-level test reads every accepted
 * language, including the ones written without spaces, and asks only whether
 * the brief contains its own script anywhere -- the weaker question, because
 * the strict one has no false-positive-free answer in that direction.
 *
 * Neither is a language identifier. Both are script tests, and they catch the
 * failure that happened -- a brief written wholesale in the sources' language --
 * not a sentence of it.
 */
/**
 * A URL is a literal the writer copies, not prose to translate, so it is masked
 * before any script counting: a Chinese path once outvoted the English sentence
 * around it and the brief was rejected for the link it cited.
 *
 * Whitespace is the only boundary, and the scheme is matched in any case. Every
 * narrower class was wrong in both directions: it cut a Chinese domain at its
 * ideographic dot and counted the remainder as prose, and it ended the URL at
 * the apostrophe in `?wd=O'Reilly...`, exposing the query string that followed.
 * There is no boundary rule, because CJK runs a URL into the next sentence with
 * no space at all. The two mistakes are not equal: masking too much loses a
 * check on text the reader can still see and edit, masking too little rejects a
 * brief that was paid for. So this masks as far as it can.
 */
const URL_TOKEN = /https?:\/\/\S+/giu;

function prose(value: string): string {
  return value.replace(URL_TOKEN, " ");
}

function wrongScript(value: string): boolean {
  // Quoted spans are dropped, including a string that is nothing but one, so a
  // heading in quotation marks is exempt from this test. That is a real hole and
  // nothing below closes it: the brief-level check counts a Latin acronym
  // anywhere as the brief's own script, so `"理解 GSC 报告延迟"` in every field
  // still passes. The alternative was worse. Judging the original whenever no
  // letters remained outside the quotes rejected `『吾輩は猫である』 (1905)`, an
  // English heading naming a work and its year, because a year is not letters --
  // and that is the exact case the stripping exists for. A quoted citation and a
  // quoted heading are the same shape; no script test separates them.
  const text = withoutQuotedSpans(prose(value));
  let letters = 0;
  let cjk = 0;
  for (const character of text) {
    if (!LETTER.test(character)) continue;
    letters += 1;
    if (CJK_LETTER.test(character)) cjk += 1;
  }
  return letters >= SCRIPT_SAMPLE_MIN && cjk * 2 > letters;
}

/**
 * Whether the brief contains the script its language is written in, anywhere.
 *
 * The per-string test above only works in one direction. Chinese script inside
 * English prose is unmistakable string by string; the reverse is not, because
 * Chinese prose embeds Latin constantly -- an acronym, a product name, `Google
 * Search Console` as a whole subheading. Any per-string rule strict enough to
 * catch an English heading in a Chinese brief also rejects those, and rejecting
 * costs the reader a run they paid for while a stray heading costs them an edit.
 *
 * So this asks the weaker question that has no false positives: does the brief
 * contain its own script at all? A brief genuinely written in Chinese has Han in
 * it somewhere. One that came back wholly in the sources' language does not, and
 * that is the failure that actually happened. It returns the first string that
 * had letters, as the place to point at.
 *
 * What it does not catch, deliberately: a brief that is English except for one
 * Chinese rationale. That is visible on the page and the headings are editable.
 */
function missingExpectedScript(value: BriefV2Generated, primary: string): string | null {
  const script = EXPECTED_BRIEF_SCRIPTS.get(primary);
  if (script === undefined) return null;
  const expected = new RegExp(`[${script}]`, "u");
  let letters = 0;
  let offender: string | null = null;
  for (const [path, text] of generatedStrings(value)) {
    const masked = prose(text);
    if (expected.test(masked)) return null;
    for (const character of masked) if (LETTER.test(character)) letters += 1;
    if (offender === null && LETTER.test(masked)) offender = path;
  }
  return letters >= SCRIPT_SAMPLE_MIN ? offender : null;
}

/** Every generated string, with the path a rejection should name. */
function* generatedStrings(value: BriefV2Generated): Generator<readonly [string, string]> {
  for (const [index, question] of value.research.questions.entries()) {
    yield [`research.questions[${index}].q`, question.q];
  }
  for (const [index, section] of value.research.outline.entries()) {
    yield [`research.outline[${index}].h2`, section.h2];
    for (const [level, heading] of section.h3.entries()) yield [`research.outline[${index}].h3[${level}]`, heading];
  }
  for (const key of ["intent", "format"] as const) {
    const judgment = value[key];
    if (judgment !== null) yield [`${key}.rationale`, judgment.rationale];
  }
  yield ["page_plan.rationale", value.page_plan.rationale];
  for (const [index, step] of value.page_plan.steps.entries()) {
    yield [`page_plan.steps[${index}].instruction`, step.instruction];
  }
  if (value.gap_angle !== null) {
    yield ["gap_angle.value", value.gap_angle.value];
    yield ["gap_angle.rationale", value.gap_angle.rationale];
  }
  for (const [index, link] of value.internal_links.entries()) {
    yield [`internal_links[${index}].anchor`, link.anchor];
    yield [`internal_links[${index}].why`, link.why];
  }
  for (const [index, item] of value.do_not_cover.entries()) {
    yield [`do_not_cover[${index}].topic`, item.topic];
    yield [`do_not_cover[${index}].why`, item.why];
  }
}

function checkGeneratedLanguage(value: BriefV2Generated, language: string): Decoded<BriefV2Generated> | null {
  // The tool's own codes are bare, but a confirmed revision can carry a full
  // BCP-47 tag: "zh-CN" is Chinese, and comparing the whole tag to a set of
  // bare codes would have this check reject a Chinese brief for being Chinese.
  const primary = language.toLowerCase().split(/[-_]/u)[0] ?? "";
  const missing = missingExpectedScript(value, primary);
  if (missing !== null) return reference(missing);
  if (NON_WHITESPACE_TOKENIZED_LANGUAGES.has(primary)) return null;
  for (const [path, text] of generatedStrings(value)) {
    if (wrongScript(text)) return reference(path);
  }
  return null;
}

/**
 * The generated-language rule applies when a model writes a brief, and never
 * when a brief is read back.
 *
 * `parseBriefV2Generated` re-runs this validator over a frozen result to prove
 * it is internally consistent, and the Draft Writer runs the same path over a
 * confirmed brief a visitor pastes in. A brief exported before this rule
 * existed — one whose headings came back in the sources' script, exactly the
 * population the rule was written for — would fail that read as a generic
 * decode error, with an unchanged schema version to warn anyone. Off by
 * default is what keeps a rule from being applied to artifacts that predate
 * it; the two generation call sites ask for it by name.
 */
export interface ValidateModelBriefV2Options {
  readonly checkLanguage?: boolean;
  /**
   * Whether the call that produced this reply was asked for a title.
   *
   * Defaults to the language gate, which is the answer for every reply already
   * stored and for every read-back. A caller passes false when it knows the
   * prompt it actually sent left the title block out, so a title written
   * without the rules it would have been judged by is refused rather than kept.
   */
  readonly planning?: boolean;
}

/**
 * Whether this run's evidence can carry a "create" recommendation.
 *
 * Saying a page should be created is saying the pages that already exist do not
 * serve the request, and that claim needs the sample it was read from to be
 * whole: Search Console complete, every owned candidate actually observed, and
 * every page Search Console matched present among those observed. A candidate
 * the crawl failed on might be exactly the page that covers the subject, and a
 * matched page outside the three-slot candidate list is the same uncertainty
 * one step further out.
 *
 * Exported because the generation boundary needs the same answer the validator
 * reaches. A reply that recommends create against this predicate is downgraded
 * to "undecidable" rather than discarded, and a second copy of the rule would
 * be a second answer the moment either one changed.
 */
export function createActionAvailable(context: BriefV2Context): boolean {
  const observedUrls = new Set(context.candidates.filter((item) => item.read === "observed").map((item) => briefV2PageKey(item.url)));
  return context.gsc.status === "complete" &&
    context.candidates.every((item) => item.read === "observed") &&
    context.gsc.matches.every((item) => observedUrls.has(briefV2PageKey(item.page)));
}

export function validateModelBriefV2(
  input: unknown,
  context: BriefV2Context,
  options: ValidateModelBriefV2Options = {},
): Decoded<BriefV2Generated> {
  const checked = parseBriefV2Context(context);
  if (!checked.ok) return nested(checked, "context");
  const decoded = wholeShape(input, modelResearchShape, false, "U", options.planning ?? briefPlanningAvailable(checked.value.input.language));
  if (!decoded.ok) return decoded;
  const research = validateResearchOutput(decoded.value.research, checked.value.research);
  if (!research.ok) return nested(research, "research");
  const { page_plan: plan, gap_angle: gap } = decoded.value;
  if (research.value.questions.length > 0 && (decoded.value.intent === null || decoded.value.format === null)) return reference("intent");
  const candidates = new Map(checked.value.candidates.map((item) => [item.id, item]));
  const units = new Map(checked.value.research.units.map((item) => [item.id, item]));
  const pages = new Map(checked.value.research.pages.map((item) => [item.id, item]));
  const target = plan.target_ref === null ? undefined : candidates.get(plan.target_ref);
  const targetIdentity = target === undefined ? null : briefV2PageKey(target.url);
  const competitorPages = new Set(checked.value.research.pages.filter((item) => item.role === "competitor").map((item) => item.id));
  const anchors = new Map(research.value.questions.map((item) => [item.anchor, item.id]));
  const steps: BriefV2PlanStep[] = [];
  if (plan.action === "update") {
    if (plan.target_ref === null || candidates.get(plan.target_ref)?.read !== "observed") return reference("page_plan.target_ref");
    if (plan.steps.length === 0 || plan.steps.every((step) => step.kind === "keep")) return reference("page_plan.steps");
  } else {
    if (plan.target_ref !== null || plan.steps.length !== 0) return reference("page_plan");
    if (plan.action === "create" && !createActionAvailable(checked.value)) return reference("page_plan.action");
  }
  for (const [index, step] of plan.steps.entries()) {
    const path = `page_plan.steps[${index}]`;
    // keep and rewrite act on text that exists, so they must cite the units
    // they act on. An add step is bound by its answers instead: a question the
    // evidence raised may be a question only PAA raised, and "add a section
    // answering this" is a statement about what to cover, not a claim. A
    // reviewer read the empty-sources case as an ungrounded factual
    // instruction; the validator cannot tell one instruction's prose from
    // another's, and forbidding it would forbid the PAA-only case the tests
    // below name deliberately.
    if (step.kind === "add" ? step.answers.length === 0 : step.sources.length === 0) return reference(path);
    for (const ref of step.sources) {
      const unit = units.get(ref);
      if (unit?.kind !== "page" || (step.kind !== "add" && unit.page_ref !== plan.target_ref)) return reference(`${path}.sources`);
      const page = pages.get(unit.page_ref);
      if (step.kind !== "add" && (page?.role !== "owned" || briefV2PageKey(page.url) !== targetIdentity)) return reference(`${path}.sources`);
    }
    const answers: string[] = [];
    for (const anchor of step.answers) {
      const id = anchors.get(anchor);
      if (id === undefined) return reference(`${path}.answers`);
      answers.push(id);
    }
    steps.push({ ...step, sources: [...step.sources], answers });
  }
  if (gap !== null) {
    const facts = new Set(checked.value.facts.map((item) => item.id));
    if (gap.fact_refs.some((ref) => !facts.has(ref))) return reference("gap_angle.fact_refs");
    if (gap.sources.some((ref) => { const unit = units.get(ref); return unit?.kind !== "page" || !competitorPages.has(unit.page_ref); })) return reference("gap_angle.sources");
  }
  for (const key of ["internal_links", "do_not_cover"] as const) {
    const refs = decoded.value[key].map((item) => item.page_ref);
    const identities = refs.map((ref) => { const candidate = candidates.get(ref); return candidate === undefined ? null : briefV2PageKey(candidate.url); });
    if (new Set(identities).size !== refs.length || refs.some((ref, index) => identities[index] === targetIdentity || candidates.get(ref)?.read !== "observed")) return reference(key);
  }
  let planning: BriefV2Planning | undefined;
  if (decoded.value.planning !== undefined) {
    const rejected = checkTitle(decoded.value.planning, suppliedVocabulary(checked.value), "planning");
    if (rejected !== null) return reference(rejected);
    const bound = bindSectionPlans(decoded.value.planning, research.value.outline);
    if (!bound.ok) return bound;
    planning = bound.value;
  }
  const { planning: _decodedPlanning, ...rest } = decoded.value;
  const value: BriefV2Generated = { ...rest, research: research.value, page_plan: { ...plan, steps },
    ...(planning === undefined ? {} : { planning }) };
  if (options.checkLanguage !== true) return ok(value);
  return checkGeneratedLanguage(value, checked.value.input.language) ?? ok(value);
}

/** Rebuild the model graph, recompute public IDs, and compare the frozen result exactly. */
export function parseBriefV2Generated(input: unknown, context: BriefV2Context): Decoded<BriefV2Generated> {
  const checked = parseBriefV2Context(context);
  if (!checked.ok) return nested(checked, "context");
  const decoded = wholeShape<ResearchResult>(input, (value, path) => nested(parseResearchResult(value, checked.value.research), path), true, "Q", briefPlanningAvailable(checked.value.input.language));
  if (!decoded.ok) return decoded;
  const { planning: storedPlanning, ...stored } = decoded.value;
  const bound = storedPlanning === undefined ? null : bindSectionPlans(storedPlanning, stored.research.outline);
  if (bound !== null && !bound.ok) return bound;
  const value: BriefV2Generated = { ...stored, ...(bound === null ? {} : { planning: bound.value }) };
  const anchors = new Map(value.research.questions.map((item) => [item.id, item.anchor]));
  const model: ModelBriefV2Output = {
    ...value,
    // The model form has no O ids: they are derived from the outline it sent,
    // so the rebuild has to hand back the shape a reply actually has.
    ...(value.planning === undefined ? {} : { planning: { ...value.planning,
      ...(value.planning.sections === undefined ? {} : { sections: value.planning.sections.map(({ purpose, focus }) => ({ purpose, focus })) }) } }),
    research: {
      questions: value.research.questions.map((item) => ({ anchor: item.anchor, q: item.q, sources: item.source_refs })),
      outline: value.research.outline.map((item) => ({ h2: item.h2, h3: item.h3, answers: item.answers.map((id) => anchors.get(id) ?? "invalid") })),
    },
    page_plan: { ...value.page_plan, steps: value.page_plan.steps.map((step) => ({ ...step, answers: step.answers.map((id) => anchors.get(id) ?? "invalid") })) },
  };
  const rebuilt = validateModelBriefV2(model, checked.value);
  if (!rebuilt.ok) return rebuilt;
  return canonicalize(rebuilt.value) === canonicalize(value) ? ok(value) : reference("generated");
}
