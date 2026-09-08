// @input -- receipt-backed evidence plus the locked v3 generation identity
// @output -- strict v2 narrative whose facts and questions carry content identity
// @pos -- model text cannot invent authorities, URLs, competitors, or numeric claims

/**
 * v2 exists for one reason: an owner correction has to survive the next update.
 *
 * v1 asked the model for a fact as one sentence, so the only thing a merge
 * could compare was wording, and the pack derived a fact id from the source
 * that evidenced it -- re-crawling the same page under a new id produced a new
 * item and silently dropped the decision attached to the old one. v2 asks for
 * the triple the identity is actually made of (`subject` / `attribute` /
 * `qualifiers`) plus the comparable `value`, and for a `canonicalQuestion`
 * beside each question. Two prices that differ only by plan then differ by
 * qualifier, so they get different item keys, and correcting one can never
 * reach the other.
 *
 * Everything v1 refused, v2 still refuses. The evidence bindings below are
 * ported check for check: a cited source must exist in the catalogue, every
 * numeric literal must occur verbatim in a cited excerpt, and a comparison
 * needs evidence on both sides.
 */
import { z } from "zod";

import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import {
  GEO_KNOWLEDGE_LIMITS, geoBoundedText, geoFactContentShape, geoHash, geoId,
  geoLiteralsAllSupported, geoNormalizedUnique, geoQaContentShape, geoTimestamp, geoUnique,
} from "./kb-knowledge-shape.ts";
import {
  GEO_ITEM_KEY_SEPARATOR, geoItemKeyBasis, normalizeGeoIdentityText, type GeoItemKeyParts,
} from "./kb-item-identity.ts";
import { geoProfileRefSchema } from "./kb-v3-contract.ts";
import { parseGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";

export const GEO_KNOWLEDGE_SYNTHESIS_INPUT_V2_SCHEMA = "marketing-geo-knowledge-synthesis-input.v2" as const;
export const GEO_KNOWLEDGE_NARRATIVE_V2_SCHEMA = "marketing-geo-knowledge-narrative.v2" as const;
export const GEO_KNOWLEDGE_GENERATION_INPUT_V2_SCHEMA = "marketing-geo-knowledge-generation-input.v2" as const;
export const GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA = "marketing-geo-knowledge-generation-result.v2" as const;
export const GEO_KNOWLEDGE_GENERATION_RESULT_V2_MAX_BYTES = 2_097_152;

export const GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS = {
  inputBytes: 163_840, narrativeBytes: 131_072, sources: 32, aliases: 12, categoryTerms: 8, competitors: 5,
  sourceRefs: 16, facts: 64, qa: 32, variants: 8, comparisons: 5, comparisonRows: 16, scopeItems: 24,
  qualifiers: GEO_KNOWLEDGE_LIMITS.qualifiers, receiptRefs: 32, shortText: 200, label: 120,
  excerpts: 8, excerptCodePoints: 1_200,
  /**
   * The most the source catalogue may weigh -- and only the catalogue.
   *
   * This is one half of a budget. What the step actually has to fit is the
   * whole input, and the other half of it is not a constant: `profileRef`
   * alone admits five 2 000-character strings and five 64-item arrays of
   * 500-character strings, which is 178 607 bytes at the schema maximum, more
   * by itself than `inputBytes`. A catalogue fitted against this number alone
   * therefore says "it fits" about inputs that do not.
   *
   * So this stays a ceiling on the catalogue -- nothing collected today is
   * made to shrink -- and the two budgets below are what the projection
   * actually spends against, one per unit anything is refused in. See
   * `geoKnowledgeSynthesisV2CatalogueBudget` and
   * `geoKnowledgeSynthesisV2CataloguePromptBudget`.
   */
  catalogueBytes: 102_400,
  /**
   * The most the whole synthesis input may weigh in storage, catalogue
   * included. No longer the thing that keeps the prompt buyable.
   *
   * It was written to be that: 102 400 for the catalogue plus 9 279 assumed for
   * everything else, less the two bytes an empty catalogue costs, on the theory
   * that the prompt is the input plus about 13 900 bytes of system prompt,
   * response schema and envelope. The envelope estimate was right -- 13 291,
   * measured -- and the rest of it was wrong twice over: the 9 279 was measured
   * with `profileRef` at fixture size (954 bytes) against a schema maximum 187
   * times larger, and it counted code points as ASCII bytes when
   * `geoBoundedText` bounds code points and admits four bytes each. Worse, the
   * unit is wrong: these are JSONB bytes and the prompt is charged in escaped
   * ones, which for quote-dense page text is nearly twice as many.
   *
   * `promptBytes` and `promptEnvelopeBytes` below, spent through
   * `geoKnowledgeSynthesisV2CataloguePromptBudget`, are what keeps the prompt
   * buyable now, and they are measured from the input in hand rather than
   * assumed. This number is kept beside them, unchanged, for one reason: the
   * projection must satisfy both budgets, so keeping it can only make a
   * catalogue smaller than the rule it was written under would have made it.
   * That is what lets every generation result already fitted under the old rule
   * re-derive to exactly the catalogue it stores -- a record that was bought had
   * a request inside `promptBytes`, so its stored cap satisfies the new budget
   * too, and the cap above it failed the old one and still fails it.
   *
   * `GEO knowledge synthesis v2 catalogue budget` in the tests rebuilds the
   * worst cases rather than trusting this paragraph.
   */
  inputBudgetBytes: 111_677,
  /**
   * The adapter's prompt ceiling, mirrored here because the projection has to
   * be re-derivable from a stored record forever.
   *
   * `GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES` in `kb-knowledge-synthesis-v2.ts`
   * is the number that actually refuses a request, and this file cannot import
   * it: that module imports this one. `mirrors the adapter's own prompt
   * ceiling` in the tests reads the real constant and refuses to agree if the
   * two drift.
   */
  promptBytes: 131_072,
  /**
   * What the request costs before the input is put into it, reserved.
   *
   * The adapter measures `JSON.stringify({ prompt, responseJsonSchema })`. Every
   * byte of that which is not the user turn -- the system prompt, the response
   * schema, and the keys and braces around them -- measured 13 291 when this was
   * written, and the tests measure it again from the real prompt module rather
   * than trusting the sentence.
   *
   * Reserved slightly above the measurement, and deliberately frozen. Reserving
   * more than the envelope costs can only make `fits` pessimistic, never wrong.
   * Changing it, in either direction, changes which catalogue a stored record
   * re-derives to, so once a v2 generation result exists this number is part of
   * that record's identity: raise it only together with a re-derivation
   * compatibility argument. The headroom is what lets the system prompt be
   * reworded without touching it.
   */
  promptEnvelopeBytes: 14_336,
  definitionCodePoints: { w25: 250, w55: 550, w120: 1_200 },
} as const;

/**
 * The four bytes a catalogue costs less inside an input than it does measured
 * on its own.
 *
 * `geoV2PromptBytes` quotes whatever it is handed, so a catalogue measured
 * alone pays for two quotation marks the whole input does not, and the
 * skeleton it is spliced into already paid two bytes for the `[]` it replaces.
 * `splices into the input exactly` in the tests re-derives this from real
 * values rather than from this paragraph.
 */
const GEO_PROMPT_SPLICE_BYTES = 4;

// ---------------------------------------------------------------------------
// Shared atoms. Text bounds come from the shared shape module so the narrative
// and the v3 draft that stores it cannot drift apart on what text is legal.
// ---------------------------------------------------------------------------

/**
 * A bare domain counts as a URL: the model has no browsing authority, and a
 * naked hostname in generated prose reads to a downstream consumer exactly
 * like a citation it never earned.
 */
const URL_TEXT = /(?:https?:\/\/|www\.|(?:^|[^\p{L}\p{N}_-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?=$|[^\p{L}\p{N}_-]))/iu;
const PROPER_SUBJECT_CLAIM = /(?:^|[.!?]\s+)([A-Z]{2,}|[A-Z][\p{Ll}\p{N}&'’-]*(?:\s+(?:[A-Z]{2,}|[A-Z][\p{Ll}\p{N}&'’-]*))*)\s+(?:is|offers|provides|supports|competes|replaces|alternative|competitor|versus|vs)\b/gu;

/**
 * Words the subject heuristic matches but that are never proper names.
 *
 * The wh-words are the one deliberate widening of this set relative to v1. The
 * pattern reads "What is Pine Cloud?" as a claim whose subject is "What", and
 * v1 then required "what" to occur inside a cited excerpt -- so the plainest
 * phrasing of a definition question was refused outright. v2 makes
 * `canonicalQuestion` mandatory and asks for exactly that plain phrasing, so
 * keeping the false positive would refuse the common case. No coverage of real
 * proper names is lost: the captured group only collapses to a bare wh-word
 * when nothing capitalised follows it ("What Pine Cloud is" still yields the
 * subject "What Pine Cloud" and is still checked against the evidence).
 */
const ORDINARY_SUBJECTS = new Set([
  "yes", "teams", "supports", "what", "which", "who", "whom", "whose", "how", "when", "where", "why",
]);

const unique = (values: readonly string[]) => geoUnique(values);
const normalized = (value: string) => value.normalize("NFC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim();
const normalizedUnique = (values: readonly string[]) => geoNormalizedUnique(values);

const text = (maximum: number) => geoBoundedText(maximum);
const id = geoId;
const hash = geoHash;
const timestamp = geoTimestamp;

/**
 * Exact, public, HTTPS-only, and byte-identical after re-serialisation. Kept
 * local rather than taken from the shared shape module, which also admits
 * http:// -- a synthesis input is the thing a paid generation is bound to.
 */
const publicUrl = z.string().max(2_048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      && url.port === "" && url.hash === "" && url.toString() === value;
  } catch { return false; }
}, "Expected exact public HTTPS URL");

function canonicalCompetitorKey(value: string): boolean {
  try {
    const url = new URL(`https://${value}/`);
    return value === value.toLocaleLowerCase("en") && value.includes(".") && !value.endsWith(".")
      && url.hostname === value && url.username === "" && url.password === "" && url.port === ""
      && url.pathname === "/" && url.search === "" && url.hash === "";
  } catch { return false; }
}

const competitorSchema = z.object({
  key: id.refine(canonicalCompetitorKey, "Expected canonical competitor hostname"),
  name: text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText),
  confirmed: z.literal(true),
}).strict();

const sourceSchema = z.object({
  id,
  kind: z.enum(["own_page", "competitor_page", "robots", "sitemap", "llms", "gsc", "accepted_fact"]),
  label: text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.label),
  url: publicUrl.nullable(),
  competitor: competitorSchema.nullable(),
  availability: z.enum(["available", "partial"]),
  reason: z.enum([
    "not_collected", "not_published", "not_found", "timeout", "fetch_failed", "blocked",
    "rate_limited", "invalid_response", "partial_body", "unsupported_language",
    "generation_unavailable", "outcome_unknown", "insufficient_evidence", "not_applicable", "context_stale",
  ]).nullable(),
  observedAt: timestamp.nullable(),
  bodyHash: hash.nullable(),
  excerpts: z.array(text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.excerptCodePoints))
    .min(1).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.excerpts),
}).strict().superRefine((source, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((source.kind === "competitor_page") !== (source.competitor !== null)) issue("Invalid competitor source scope");
  if (!["gsc", "accepted_fact"].includes(source.kind) && source.url === null) issue("Public source URL required");
  if (source.availability === "available" ? source.reason !== null : source.reason === null) issue("Source availability reason mismatch");
  if (source.bodyHash !== null && source.observedAt === null) issue("Body hash requires observation time");
  if (!["gsc", "accepted_fact"].includes(source.kind) && (source.observedAt === null || source.bodyHash === null)) issue("Crawled source requires observation receipt");
  if (source.kind === "gsc" && source.observedAt === null) issue("GSC source requires observation time");
});

// ---------------------------------------------------------------------------
// marketing-geo-knowledge-synthesis-input.v2
// ---------------------------------------------------------------------------

const inputBodySchema = z.object({
  schemaVersion: z.literal(GEO_KNOWLEDGE_SYNTHESIS_INPUT_V2_SCHEMA),
  officialName: text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText),
  aliases: z.array(text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText)).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.aliases).refine(normalizedUnique, "Duplicate alias"),
  categoryTerms: z.array(text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText)).min(1).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.categoryTerms).refine(normalizedUnique, "Duplicate category term"),
  market: text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.label),
  language: text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.label),
  targetUrl: publicUrl,
  /**
   * The 13-field confirmed Profile subset by reference, replacing v1's
   * `profileCopy`. Copying all 28 fields made a paid generation's identity
   * depend on fields GEO never reads, so an unrelated Profile edit invalidated
   * work that did not depend on it.
   */
  profileRef: geoProfileRefSchema,
  /**
   * The run-scoped identity locked right after the roles step. Every generation
   * record produced from this input stores the same value, and publishing only
   * reuses records whose hash still matches the draft being published.
   */
  generationInputHash: hash,
  confirmedCompetitors: z.array(competitorSchema).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.competitors).refine((values) => unique(values.map((value) => value.key)), "Duplicate competitor"),
  evidenceContentHash: hash,
  sourceCatalogueHash: hash,
  sourceCatalogue: z.array(sourceSchema).min(1).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.sources),
}).strict();
const inputSchema = inputBodySchema.extend({ contentHash: hash }).strict();
export type GeoKnowledgeSynthesisInputBodyV2 = z.infer<typeof inputBodySchema>;
export type GeoKnowledgeSynthesisInputV2 = z.infer<typeof inputSchema>;
export type GeoKnowledgeSourceV2 = GeoKnowledgeSynthesisInputV2["sourceCatalogue"][number];

function assertInputIntegrity(body: GeoKnowledgeSynthesisInputBodyV2): void {
  const sources = new Map(body.sourceCatalogue.map((source) => [source.id, source]));
  if (sources.size !== body.sourceCatalogue.length) throw new Error("Duplicate source id");
  const urls = body.sourceCatalogue.flatMap((source) => source.url === null ? [] : [source.url]);
  if (!unique(urls)) throw new Error("Duplicate source URL");
  if (geoKnowledgeSynthesisV2SourceCatalogueDigest(body.sourceCatalogue) !== body.sourceCatalogueHash) {
    throw new Error("Knowledge synthesis source catalogue hash mismatch");
  }
  const competitors = new Map(body.confirmedCompetitors.map((competitor) => [competitor.key, competitor.name]));
  const target = new URL(body.targetUrl);
  for (const source of body.sourceCatalogue) {
    if (source.competitor !== null && competitors.get(source.competitor.key) !== source.competitor.name) throw new Error("Unconfirmed competitor source");
    if (source.kind === "competitor_page" && source.url !== null && new URL(source.url).host !== source.competitor?.key) throw new Error("Foreign competitor source");
    if (["own_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null && new URL(source.url).host !== target.host) throw new Error("Foreign own-site source");
    if (source.url === null) continue;
    const url = new URL(source.url);
    const path = url.pathname.toLocaleLowerCase("en");
    if (source.kind === "robots" && (url.pathname !== "/robots.txt" || url.search !== "")) throw new Error("Invalid robots source URL");
    if (source.kind === "llms" && (url.pathname !== "/llms.txt" || url.search !== "")) throw new Error("Invalid llms source URL");
    if (source.kind === "sitemap" && (url.search !== "" || !path.includes("sitemap") || !path.endsWith(".xml"))) throw new Error("Invalid sitemap source URL");
  }
}

/**
 * A synthesis input too heavy to store, thrown with the measurements that say
 * which half of it was heavy.
 *
 * Typed rather than described, because this is the one refusal a caller has to
 * be able to tell apart from "this is not a synthesis input", and deciding an
 * owner-visible label by matching prose that four modules are free to reword is
 * how v1 got that wrong. The message is left byte-identical to the one this
 * used to throw so that nothing which already reads it changes behaviour.
 *
 * `nonCatalogueBytes` above `inputBudgetBytes` means no catalogue could have
 * fitted beside it: the evidence is not what is too large.
 */
export class GeoKnowledgeSynthesisInputTooLargeError extends Error {
  readonly inputBytes: number;
  readonly nonCatalogueBytes: number;
  readonly limitBytes: number;
  constructor(inputBytes: number, nonCatalogueBytes: number, limitBytes: number) {
    super("Knowledge synthesis input exceeds byte budget");
    this.name = "GeoKnowledgeSynthesisInputTooLargeError";
    this.inputBytes = inputBytes;
    this.nonCatalogueBytes = nonCatalogueBytes;
    this.limitBytes = limitBytes;
  }
}

function assertInputBytes(value: GeoKnowledgeSynthesisInputV2): void {
  const bytes = geoV2JsonbBytes(value);
  if (bytes <= GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes) return;
  throw new GeoKnowledgeSynthesisInputTooLargeError(
    bytes, geoKnowledgeSynthesisV2NonCatalogueBytes(value), GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes,
  );
}

/**
 * A stand-in of the exact width of the two hashes, used only for measuring.
 *
 * `sourceCatalogueHash` and `contentHash` change with every catalogue and are
 * always 64 hex characters, so a measurement that used their real values would
 * depend on the catalogue it exists to be independent of.
 */
const GEO_HASH_WIDTH_PLACEHOLDER = "0".repeat(64);

/** Every field of a synthesis input the source catalogue does not determine. */
export type GeoKnowledgeSynthesisV2NonCatalogueFields =
  Omit<GeoKnowledgeSynthesisInputBodyV2, "sourceCatalogue" | "sourceCatalogueHash">;

/**
 * What this input weighs with its catalogue taken out, in the same JSONB bytes
 * the whole input is measured in.
 *
 * The fields are named one by one rather than spread, so that adding a field to
 * `inputBodySchema` and forgetting it here is a change to this function rather
 * than a silent under-count; `every non-catalogue field is paid for` in the
 * tests re-derives the same number by spreading a parsed input and refuses to
 * agree if one is missing.
 *
 * Called twice for every generation, and the two calls must return the same
 * number or the projection could not be re-derived: once by
 * `buildGeoKnowledgeSynthesisInputV2`, before a catalogue exists at all, and
 * once by `parseResultBody`, from the stored input. That is why the hashes are
 * replaced rather than read.
 */
function nonCatalogueSkeleton(fields: GeoKnowledgeSynthesisV2NonCatalogueFields): Record<string, unknown> {
  return {
    schemaVersion: fields.schemaVersion,
    officialName: fields.officialName,
    aliases: fields.aliases,
    categoryTerms: fields.categoryTerms,
    market: fields.market,
    language: fields.language,
    targetUrl: fields.targetUrl,
    profileRef: fields.profileRef,
    generationInputHash: fields.generationInputHash,
    confirmedCompetitors: fields.confirmedCompetitors,
    evidenceContentHash: fields.evidenceContentHash,
    sourceCatalogueHash: GEO_HASH_WIDTH_PLACEHOLDER,
    sourceCatalogue: [],
    contentHash: GEO_HASH_WIDTH_PLACEHOLDER,
  };
}

export function geoKnowledgeSynthesisV2NonCatalogueBytes(
  fields: GeoKnowledgeSynthesisV2NonCatalogueFields,
): number {
  return geoV2JsonbBytes(nonCatalogueSkeleton(fields));
}

/**
 * What a value costs the prompt, in the bytes the adapter actually counts.
 *
 * Not the same unit as `geoV2JsonbBytes`, and the difference is the whole
 * reason this function exists. The user turn is the canonical input serialized
 * *into a JSON string*, so every quotation mark, backslash and newline in page
 * text is escaped a second time on its way into the request -- a quotation mark
 * that costs two bytes in storage costs four in the request, and the same
 * escape is why the two units differ by nearly a factor of two on page text
 * generally rather than only on quotes. A budget kept in storage bytes
 * therefore says "this fits" about catalogues whose prompt is nearly twice its
 * budget, which is the refusal a content-rich site of quote-dense pages used to
 * get: measured, a maximal collection of quoted pages weighed 93 373 storage
 * bytes and bought a 194 517-byte prompt against a 131 072-byte ceiling.
 *
 * `canonicalGeoV2Text` and the `canonicalJson` the prompt is built with are two
 * implementations that must agree byte for byte on a synthesis input. They do
 * -- both sort keys with the default comparator and both hand strings to
 * `JSON.stringify` -- and `predicts the prompt the adapter measures` in the
 * tests compares this function's arithmetic against the real prompt rather than
 * against this paragraph.
 */
function geoV2PromptBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(canonicalGeoV2Text(value))).byteLength;
}

/**
 * What the rest of this particular input costs the prompt, measured the same
 * way and from the same fields as `geoKnowledgeSynthesisV2NonCatalogueBytes`,
 * so both halves of the budget are re-derivable from what is stored.
 */
export function geoKnowledgeSynthesisV2NonCataloguePromptBytes(
  fields: GeoKnowledgeSynthesisV2NonCatalogueFields,
): number {
  return geoV2PromptBytes(nonCatalogueSkeleton(fields));
}

/**
 * What the catalogue may weigh once the rest of this particular input has taken
 * its share.
 *
 * Both halves of the composite, rather than the catalogue's half with the other
 * held at the size of a test fixture. The two bytes added back are the `[]`
 * that an empty catalogue already cost inside `nonCatalogueBytes`, which would
 * otherwise be paid for twice.
 *
 * The result is clamped to `catalogueBytes`, so it can only ever be smaller
 * than the constant it replaces: a thin input buys no more evidence than it
 * bought before, and a heavy one buys less rather than being refused.
 *
 * It can go to zero or below. That is not a mistake and is not hidden -- the
 * projection floors at one excerpt per source, reports `fits: false`, and lets
 * the oversized input be refused where a refusal can be explained, rather than
 * dropping sources to force a fit.
 */
export function geoKnowledgeSynthesisV2CatalogueBudget(nonCatalogueBytes: number): number {
  // A budget that is not a number compares false against every catalogue size,
  // which would leave the cap at 8 and call the largest possible catalogue
  // unfitted rather than shrinking it. Refused, because the quiet version of
  // that is a full-size catalogue sent under a budget nobody computed.
  if (!Number.isSafeInteger(nonCatalogueBytes) || nonCatalogueBytes < 0) {
    throw new Error("Knowledge synthesis catalogue budget needs a measured non-catalogue size");
  }
  return Math.min(
    GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.catalogueBytes,
    GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBudgetBytes - (nonCatalogueBytes - 2),
  );
}

/**
 * The same question asked in the unit the refusal is actually decided in.
 *
 * The adapter buys nothing whose `JSON.stringify({ prompt, responseJsonSchema })`
 * passes `promptBytes`. That request is the envelope plus the canonical input
 * escaped into a JSON string, and escaping is additive across the splice, so
 * the catalogue's share is the ceiling less the envelope less what the rest of
 * this input escapes to. No estimate and no fitted constant: both terms are
 * measured from the input in hand.
 *
 * Unlike `geoKnowledgeSynthesisV2CatalogueBudget` this one is not clamped to
 * `catalogueBytes`. The clamp there exists to stop a thin input buying more
 * evidence than the rule it was written under allowed; a second clamp here
 * would only re-state it, and the two budgets are applied together -- the
 * projection has to satisfy both -- so the tighter one always wins.
 *
 * Like the other budget it can go to zero or below, and for the same reason:
 * an input whose profile alone fills the prompt leaves the evidence nothing,
 * and saying so is more use than pretending there was a budget.
 */
export function geoKnowledgeSynthesisV2CataloguePromptBudget(nonCataloguePromptBytes: number): number {
  if (!Number.isSafeInteger(nonCataloguePromptBytes) || nonCataloguePromptBytes < 0) {
    throw new Error("Knowledge synthesis catalogue budget needs a measured non-catalogue size");
  }
  return GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.promptBytes
    - GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.promptEnvelopeBytes
    + GEO_PROMPT_SPLICE_BYTES
    - nonCataloguePromptBytes;
}

export function geoKnowledgeSynthesisV2SourceCatalogueDigest(value: GeoKnowledgeSynthesisInputBodyV2["sourceCatalogue"]): string {
  return geoV2Digest(value);
}

export function geoKnowledgeSynthesisInputV2Digest(body: GeoKnowledgeSynthesisInputBodyV2): string {
  return geoV2Digest(body);
}

const seedSchema = z.object({
  officialName: text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText),
  aliases: z.array(text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText)),
  categoryTerms: z.array(text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText)),
  market: text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.label),
  language: text(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.label),
  profileRef: geoProfileRefSchema,
  generationInputHash: hash,
}).strict();

type GeoKnowledgeCatalogueSourceV2 = GeoKnowledgeEvidenceV1["sourceCatalogue"][number];

export interface GeoKnowledgeSynthesisV2CatalogueProjection {
  /** What the model is shown, and what the narrative is checked against. */
  readonly catalogue: readonly GeoKnowledgeCatalogueSourceV2[];
  /** Leading excerpts kept per source; the contract maximum when nothing was left out. */
  readonly excerptCap: number;
  /** Sources that lost excerpts, in catalogue order. Empty when none did. */
  readonly trimmedSourceIds: readonly string[];
  /** How many excerpts were left out in total. Zero when none were. */
  readonly droppedExcerpts: number;
  /** What this catalogue was allowed to weigh in storage, after the rest of the input took its share. */
  readonly budgetBytes: number;
  /** What it actually weighs in storage. */
  readonly catalogueBytes: number;
  /** What the rest of the input costs the prompt, escaping included. */
  readonly nonCataloguePromptBytes: number;
  /** What the catalogue is allowed to cost the prompt, once the rest has taken its share. */
  readonly promptBudgetBytes: number;
  /** What it actually costs the prompt. */
  readonly cataloguePromptBytes: number;
  /**
   * Whether it got under both budgets.
   *
   * True is a guarantee in one direction only, and that direction is the one
   * that matters: a fitted catalogue's request is at most `promptBytes`, so the
   * adapter will buy it. False is not the converse -- it can also mean the
   * storage budget bound first -- and no caller should read it as "the prompt
   * was too big"; the numbers beside it say which budget was missed and by how
   * much.
   *
   * False means one excerpt per source is still too much, which happens only
   * when the rest of the input has eaten a budget whole. The catalogue is
   * returned anyway, intact and honest about its size, because the alternative
   * -- dropping sources -- silently unbalances the comparisons they belong to.
   * A caller that cannot afford the result refuses it; it never trims it.
   */
  readonly fits: boolean;
}

function cappedCatalogue(
  sources: readonly GeoKnowledgeCatalogueSourceV2[],
  cap: number,
): GeoKnowledgeCatalogueSourceV2[] {
  return sources.map((source) => source.excerpts.length <= cap ? source : {
    ...source,
    excerpts: source.excerpts.slice(0, cap),
    // What the model, and any reader of the stored input, is told about this
    // source: its page text arrives incomplete, so a claim being absent from
    // its excerpts is not evidence the claim is false. A source that already
    // declared itself partial keeps the reason it declared.
    availability: "partial",
    reason: source.reason ?? "partial_body",
  });
}

/**
 * How a full collection is made to fit the one prompt this step buys.
 *
 * The collector emits up to 21 usable sources -- 8 own pages, 5 competitors at
 * 2 pages each, plus robots/sitemap/llms -- and each page source carries up to
 * 8 excerpts of up to 1 200 code points. At those maxima the catalogue alone is
 * around 175 KB: past this contract's own 163 840-byte input ceiling, so
 * `buildGeoKnowledgeSynthesisInputV2` threw, the caller reported
 * `invalid_input`, and the owner of a content-rich site got no knowledge base
 * at all while a thin site synthesised fine. The richer the evidence, the worse
 * the outcome, which is the wrong way round.
 *
 * The rule, written so it can be shown to an owner: every source is shown the
 * same number of leading excerpts -- the largest cap, counting down from 8,
 * whose whole catalogue fits both budgets. Nothing else is touched:
 *
 *   - No source is dropped. Dropping one competitor page silently unbalances
 *     the comparison that page was the other half of.
 *   - No excerpt is truncated. Half a sentence is a worse citation than a
 *     missing one, and cutting a number in half makes it a different number.
 *   - A source that lost excerpts is marked `partial` / `partial_body`, so
 *     "we showed the model part of this page" is recorded in the durable input
 *     rather than inferred from its absence.
 *
 * Leading excerpts, not a sample: `pageData` emits them in document order, so
 * the first are the title, headings and opening paragraphs.
 *
 * Two budgets, because two different things can refuse this input, and until
 * this round only one of them was measured:
 *
 *   `catalogueBytes` / `inputBudgetBytes` bound what the input weighs in
 *   storage, in the JSONB bytes the row is charged.
 *
 *   `promptBytes` / `promptEnvelopeBytes` bound what the request costs, in the
 *   escaped bytes the adapter counts. This is the one the older rule missed,
 *   and missing it was not academic: a maximal collection of quote-dense pages
 *   passed the storage budget at cap 2 and produced a 194 517-byte request
 *   against a 131 072-byte ceiling, so the site whose pages carry the most
 *   quoted text -- markup, JSON, prices in quotes -- got `input_too_large` and
 *   no knowledge base at all, while a site of plain prose synthesised fine.
 *   Under both budgets the same collection settles at cap 1 and buys a 108 809
 *   byte request: fewer excerpts per source, every source present, each one
 *   marked `partial`, and a knowledge base instead of a refusal.
 *
 * A pure function of its two arguments, so `parseResultBody` can re-derive it
 * and refuse a synthesis input that is not exactly this projection. The second
 * argument is the rest of the input itself, not a number measured from it: the
 * two budgets are in different units and a caller cannot be asked to know
 * which. `nonCatalogueSkeleton` names the fields it measures one by one, with
 * the two catalogue-dependent hashes replaced by a stand-in of their own width,
 * so both measures are recomputable from what is stored.
 *
 * The consequence worth stating: because those numbers are read from the
 * input's other fields rather than fixed, a record whose `profileRef` was
 * rewritten after the fact re-derives against a different budget. What that
 * buys an attacker is bounded to "more excerpts of evidence this record already
 * holds", never an excerpt the evidence does not contain, and it costs
 * corrupting the owner's stored profile to get. Fitting the catalogue against a
 * number that has nothing to do with the input it lives in was the larger lie.
 *
 * The cap bottoms out at 1, because `sourceSchema` requires one excerpt, and
 * there are inputs where that is still too much. The largest one an owner can
 * actually produce is worth stating exactly, because a previous round claimed
 * this rule fitted it and it does not:
 *
 *   a Website Profile filled to every product limit -- five 2 000-character
 *   text fields, five 32-item lists of 500-character entries
 *   (`WEBSITE_PROFILE_LIST_MAX_ITEMS`), three provenance rows with 2 048
 *   character evidence URLs -- escapes to 99 109 prompt bytes on its own. The
 *   ceiling leaves 17 631 for evidence. A complete collection at one excerpt
 *   per source is 29 456. The request is 141 852 against 131 072, and no cap
 *   this rule is allowed to choose closes a 10 780-byte gap: dropping a source
 *   loses one side of a comparison silently and truncating an excerpt changes
 *   what it says, which are the two things this projection exists not to do.
 *
 * So that owner is refused, and the refusal is `input_too_large` with nothing
 * spent and nothing attempted -- never `invalid_input`, because nothing about
 * their Profile is invalid. `fits: false` here is that refusal seen one step
 * early, carrying the four numbers needed to explain it: what the rest of the
 * input cost, what was left, what the evidence needed, and what it weighs.
 */
export function projectGeoKnowledgeSynthesisV2Catalogue(
  sources: readonly GeoKnowledgeCatalogueSourceV2[],
  nonCatalogue: GeoKnowledgeSynthesisV2NonCatalogueFields,
): GeoKnowledgeSynthesisV2CatalogueProjection {
  const budgetBytes = geoKnowledgeSynthesisV2CatalogueBudget(
    geoKnowledgeSynthesisV2NonCatalogueBytes(nonCatalogue),
  );
  const nonCataloguePromptBytes = geoKnowledgeSynthesisV2NonCataloguePromptBytes(nonCatalogue);
  const promptBudgetBytes = geoKnowledgeSynthesisV2CataloguePromptBudget(nonCataloguePromptBytes);
  let excerptCap = GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.excerpts;
  let catalogue = cappedCatalogue(sources, excerptCap);
  let catalogueBytes = geoV2JsonbBytes(catalogue);
  let cataloguePromptBytes = geoV2PromptBytes(catalogue);
  while (excerptCap > 1 && (catalogueBytes > budgetBytes || cataloguePromptBytes > promptBudgetBytes)) {
    excerptCap -= 1;
    catalogue = cappedCatalogue(sources, excerptCap);
    catalogueBytes = geoV2JsonbBytes(catalogue);
    cataloguePromptBytes = geoV2PromptBytes(catalogue);
  }
  const trimmed = sources.filter((source) => source.excerpts.length > excerptCap);
  return {
    catalogue,
    excerptCap,
    trimmedSourceIds: trimmed.map((source) => source.id),
    droppedExcerpts: trimmed.reduce((total, source) => total + source.excerpts.length - excerptCap, 0),
    budgetBytes,
    catalogueBytes,
    nonCataloguePromptBytes,
    promptBudgetBytes,
    cataloguePromptBytes,
    fits: catalogueBytes <= budgetBytes && cataloguePromptBytes <= promptBudgetBytes,
  };
}

export function buildGeoKnowledgeSynthesisInputV2(
  seed: unknown,
  rawEvidence: GeoKnowledgeEvidenceV1,
): GeoKnowledgeSynthesisInputV2 {
  const evidence = parseGeoKnowledgeEvidenceV1(rawEvidence);
  const { profileRef, generationInputHash, ...profile } = seedSchema.parse(seed);
  // Measured before the catalogue is projected, because the catalogue's budget
  // is what these fields leave. `parseResultBody` measures the same fields
  // again from the stored input and must arrive at this number.
  const nonCatalogue: GeoKnowledgeSynthesisV2NonCatalogueFields = {
    schemaVersion: GEO_KNOWLEDGE_SYNTHESIS_INPUT_V2_SCHEMA,
    ...profile,
    profileRef,
    generationInputHash,
    targetUrl: evidence.targetUrl,
    confirmedCompetitors: evidence.confirmedCompetitors,
    evidenceContentHash: evidence.contentHash,
  };
  const sourceCatalogue = z.array(sourceSchema).parse(
    projectGeoKnowledgeSynthesisV2Catalogue(
      evidence.sourceCatalogue.filter((source) => source.availability !== "unavailable"),
      nonCatalogue,
    ).catalogue,
  );
  const body = inputBodySchema.parse({
    ...nonCatalogue,
    sourceCatalogueHash: geoKnowledgeSynthesisV2SourceCatalogueDigest(sourceCatalogue),
    sourceCatalogue,
  });
  assertInputIntegrity(body);
  const result = inputSchema.parse({ ...body, contentHash: geoKnowledgeSynthesisInputV2Digest(body) });
  assertInputBytes(result);
  return result;
}

export function parseGeoKnowledgeSynthesisInputV2(value: unknown): GeoKnowledgeSynthesisInputV2 {
  const parsed = inputSchema.parse(value);
  const { contentHash, ...body } = parsed;
  assertInputIntegrity(body);
  assertInputBytes(parsed);
  if (geoKnowledgeSynthesisInputV2Digest(body) !== contentHash) throw new Error("Knowledge synthesis input hash mismatch");
  return parsed;
}

// ---------------------------------------------------------------------------
// marketing-geo-knowledge-narrative.v2
// ---------------------------------------------------------------------------

const refs = z.array(id).min(1).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.sourceRefs).refine(unique, "Duplicate source reference");
const narrativeText = (maximum: number) => text(maximum).refine((value) => !URL_TEXT.test(value), "Model output cannot contain URLs");
const nullableNarrativeText = (maximum: number) => narrativeText(maximum).nullable();
const definition = (wordCap: number, codePointCap: number) => narrativeText(codePointCap)
  .refine((value) => value.trim().split(/\s+/u).filter(Boolean).length <= wordCap, `Expected no more than ${wordCap} words`);

const entitySchema = z.object({
  definitions: z.object({
    w25: definition(25, GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.definitionCodePoints.w25),
    w55: definition(55, GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.definitionCodePoints.w55),
    w120: definition(120, GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.definitionCodePoints.w120),
  }).strict(),
  audience: z.object({ who: narrativeText(800), notFor: nullableNarrativeText(800) }).strict(),
  founded: z.object({ year: z.string().regex(/^\d{4}$/u).nullable(), team: nullableNarrativeText(800), location: nullableNarrativeText(800) }).strict(),
  disambiguation: nullableNarrativeText(800),
  sourceRefs: refs,
}).strict();

/**
 * The v2 fact. `statement` is what a reader sees; `label` and `value` are what
 * a fact table compares literally; `subject` / `attribute` / `qualifiers` are
 * what the item key is derived from. `value` is null exactly when the fact is
 * unavailable, and `reason` then says why -- unavailable is never rendered as
 * zero or as an empty string.
 */
const factSchema = z.object({
  id,
  type: geoFactContentShape.type,
  statement: narrativeText(800),
  label: narrativeText(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText),
  value: nullableNarrativeText(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText),
  reason: geoFactContentShape.reason,
  subject: narrativeText(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText),
  attribute: narrativeText(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText),
  /**
   * The limiting dimensions: plan, market, billing period, platform, version.
   * An empty array is the normal case and means the attribute is unqualified.
   */
  qualifiers: z.array(narrativeText(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.shortText))
    .max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.qualifiers).refine(unique, "Duplicate qualifier"),
  sourceRefs: refs,
}).strict().superRefine((fact, ctx) => {
  if ((fact.value === null) !== (fact.reason !== "")) {
    ctx.addIssue({ code: "custom", message: "An unavailable fact needs a reason and an available one cannot carry one" });
  }
});

/**
 * `canonicalQuestion` is the stable phrasing the item key is derived from, and
 * `question` is what a reader sees. They are often the same sentence, which is
 * why the duplicate-text ledger below deliberately ignores the canonical one.
 */
const qaSchema = z.object({
  id,
  intent: geoQaContentShape.intent,
  question: narrativeText(800),
  canonicalQuestion: narrativeText(800),
  variants: z.array(narrativeText(800)).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.variants).refine(normalizedUnique, "Duplicate variant"),
  directAnswer: narrativeText(800),
  expansion: nullableNarrativeText(2_400),
  sourceRefs: refs,
}).strict();

const rowSchema = z.object({
  id,
  dimension: narrativeText(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.label),
  product: nullableNarrativeText(800),
  competitor: nullableNarrativeText(800),
  sourceRefs: refs,
  availability: z.enum(["available", "partial", "unavailable"]),
}).strict().superRefine((row, ctx) => {
  if (row.availability === "available" && (row.product === null || row.competitor === null)) {
    ctx.addIssue({ code: "custom", message: "Available comparison row requires both values" });
  }
  if (row.availability === "unavailable" && (row.product !== null || row.competitor !== null)) {
    ctx.addIssue({ code: "custom", message: "Unavailable comparison row cannot carry values" });
  }
});

const comparisonSchema = z.object({
  id,
  competitor: competitorSchema,
  rows: z.array(rowSchema).min(1).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.comparisonRows),
  verdict: narrativeText(800),
  sourceRefs: refs,
}).strict();

const statementSchema = z.object({ id, text: narrativeText(800), sourceRefs: refs }).strict();
const scopeSchema = z.object({
  does: z.array(statementSchema).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.scopeItems),
  doesNot: z.array(statementSchema).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.scopeItems),
  needsHuman: z.array(statementSchema).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.scopeItems),
  misconceptions: z.array(statementSchema).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.scopeItems),
}).strict().refine((scope) => Object.values(scope).some((items) => items.length > 0), "Scope cannot be empty");

const narrativeSchema = z.object({
  schemaVersion: z.literal(GEO_KNOWLEDGE_NARRATIVE_V2_SCHEMA),
  entity: entitySchema,
  facts: z.array(factSchema).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.facts),
  qa: z.array(qaSchema).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.qa),
  comparisons: z.array(comparisonSchema).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.comparisons),
  scope: scopeSchema,
}).strict();
export type GeoKnowledgeNarrativeV2 = z.infer<typeof narrativeSchema>;

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function mentions(value: string, competitor: { readonly name: string; readonly key: string }): boolean {
  return [competitor.name, competitor.key].some((candidate) =>
    new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped(candidate)}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(value));
}

function properSubjects(value: string): readonly string[] {
  return [...value.matchAll(PROPER_SUBJECT_CLAIM)]
    .map((match) => match[1] as string)
    .filter((subject) => !ORDINARY_SUBJECTS.has(normalized(subject)));
}

interface Claim {
  readonly text: readonly string[];
  readonly sourceRefs: readonly string[];
  /** True when the claim is about the product itself and needs own-site evidence. */
  readonly productEvidence: boolean;
}

/**
 * A part that normalises to nothing carries no identity: `geoItemKeyBasis`
 * would hash an empty string there, and two visibly different items would
 * collide on one key -- which is one owner's decision reaching another item.
 * Identity normalisation keeps punctuation, so this only catches text built
 * entirely from invisible code points, which is exactly the text that looks
 * distinct on screen and is not.
 */
function assertIdentityPart(value: string, label: string): void {
  if (normalizeGeoIdentityText(value) === "") throw new Error(`Identity part ${label} normalises to nothing`);
}

function keyOf(parts: GeoItemKeyParts): string {
  return geoItemKeyBasis(parts).join(GEO_ITEM_KEY_SEPARATOR);
}

function assertNarrativeIntegrity(value: GeoKnowledgeNarrativeV2, input: GeoKnowledgeSynthesisInputV2): void {
  if (geoV2JsonbBytes(value) > GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.narrativeBytes) throw new Error("Knowledge narrative exceeds byte budget");
  const sources = new Map(input.sourceCatalogue.map((source) => [source.id, source]));
  const ids: string[] = [];
  const displayText: string[] = [];
  const itemKeys: string[] = [];
  const claims: Claim[] = [];
  const add = (item: { id: string; sourceRefs: readonly string[] }, productEvidence: boolean, ...values: (string | null)[]) => {
    ids.push(item.id);
    claims.push({ text: values.filter((entry): entry is string => entry !== null), sourceRefs: item.sourceRefs, productEvidence });
  };
  const mentionedCompetitors = (texts: readonly string[]) =>
    input.confirmedCompetitors.filter((competitor) => texts.some((entry) => mentions(entry, competitor)));

  const entityText = [
    value.entity.definitions.w25, value.entity.definitions.w55, value.entity.definitions.w120,
    value.entity.audience.who, value.entity.audience.notFor, value.entity.founded.year,
    value.entity.founded.team, value.entity.founded.location, value.entity.disambiguation,
  ].filter((entry): entry is string => entry !== null);
  if (mentionedCompetitors(entityText).length > 0) throw new Error("Competitor mention is not allowed in entity narrative");
  displayText.push(...entityText);
  claims.push({ text: entityText, sourceRefs: value.entity.sourceRefs, productEvidence: true });

  for (const fact of value.facts) {
    const factText = [fact.statement, fact.label, fact.value, fact.subject, fact.attribute, ...fact.qualifiers]
      .filter((entry): entry is string => entry !== null);
    if (mentionedCompetitors(factText).length > 0) throw new Error("Competitor mention is not allowed in facts");
    assertIdentityPart(fact.subject, "fact subject");
    assertIdentityPart(fact.attribute, "fact attribute");
    // A qualifier that vanishes under normalisation would drop out of the key
    // set entirely, silently merging a qualified fact with an unqualified one.
    for (const qualifier of fact.qualifiers) assertIdentityPart(qualifier, "fact qualifier");
    itemKeys.push(keyOf({ module: "facts", type: fact.type, subject: fact.subject, attribute: fact.attribute, qualifiers: fact.qualifiers }));
    add(fact, true, ...factText);
    displayText.push(fact.statement);
  }

  for (const qa of value.qa) {
    // `canonicalQuestion` is evidence-checked like any other claim text but
    // stays out of `displayText`: it is an identity, and it is expected to
    // repeat the question verbatim.
    const qaText = [qa.question, qa.canonicalQuestion, ...qa.variants, qa.directAnswer, ...(qa.expansion === null ? [] : [qa.expansion])];
    const named = mentionedCompetitors(qaText);
    if (named.length > 0) {
      if (qa.intent !== "comparison" && qa.intent !== "alternative") throw new Error("Competitor mention requires comparison or alternative QA");
      for (const competitor of named) {
        if (!qa.sourceRefs.some((reference) => {
          const source = sources.get(reference);
          return source?.kind === "competitor_page" && source.competitor?.key === competitor.key && source.competitor.name === competitor.name;
        })) throw new Error("Competitor mention requires matching competitor evidence");
      }
    }
    assertIdentityPart(qa.canonicalQuestion, "canonical question");
    itemKeys.push(keyOf({ module: "qa", intent: qa.intent, canonicalQuestion: qa.canonicalQuestion }));
    add(qa, true, ...qaText);
    displayText.push(qa.question, ...qa.variants, qa.directAnswer, ...(qa.expansion === null ? [] : [qa.expansion]));
  }

  if (!unique(value.comparisons.map((comparison) => comparison.competitor.key))) throw new Error("Duplicate competitor comparison");
  for (const comparison of value.comparisons) {
    add(comparison, false, comparison.competitor.name, comparison.verdict);
    displayText.push(comparison.verdict);
    const confirmed = input.confirmedCompetitors.find((candidate) => candidate.key === comparison.competitor.key);
    if (confirmed?.name !== comparison.competitor.name) throw new Error("Unconfirmed or mismatched competitor");
    const comparisonSources = comparison.sourceRefs.map((reference) => sources.get(reference));
    const matchesCompetitor = (source: GeoKnowledgeSourceV2 | undefined) =>
      source?.kind === "competitor_page" && source.competitor?.key === comparison.competitor.key && source.competitor.name === comparison.competitor.name;
    if (!comparisonSources.some((source) => source?.kind === "own_page") || !comparisonSources.some(matchesCompetitor)) {
      throw new Error("Unsupported comparison verdict evidence");
    }
    for (const row of comparison.rows) {
      assertIdentityPart(row.dimension, "comparison dimension");
      itemKeys.push(keyOf({ module: "comparisons", competitorKey: comparison.competitor.key, dimension: row.dimension }));
      add(row, false, row.dimension, row.product, row.competitor);
      const rowSources = row.sourceRefs.map((reference) => sources.get(reference));
      if (row.product !== null && !rowSources.some((source) => source?.kind === "own_page")) throw new Error("Unsupported comparison row evidence");
      if (row.competitor !== null && !rowSources.some(matchesCompetitor)) throw new Error("Unsupported comparison row evidence");
    }
  }

  for (const [kind, group] of Object.entries(value.scope)) {
    for (const item of group) {
      if (mentionedCompetitors([item.text]).length > 0) throw new Error("Competitor mention is not allowed in scope");
      assertIdentityPart(item.text, "scope statement");
      itemKeys.push(keyOf({ module: "scope", kind, statement: item.text }));
      add(item, true, item.text);
      displayText.push(item.text);
    }
  }

  if (!unique(ids)) throw new Error("Duplicate content id");
  if (!normalizedUnique(displayText)) throw new Error("Duplicate narrative text");
  /**
   * Two items with the same key are one item as far as the merge in section 4.4
   * is concerned, so accepting both would hand the owner a review in which one
   * decision silently governs two rows.
   */
  if (!unique(itemKeys)) throw new Error("Duplicate item key");

  const knownSubjects = new Set([
    input.officialName, ...input.aliases,
    ...input.confirmedCompetitors.flatMap((competitor) => [competitor.name, competitor.key]),
  ].map(normalized));
  for (const claim of claims) {
    const cited = claim.sourceRefs.map((reference) => sources.get(reference));
    if (cited.some((source) => source === undefined)) throw new Error("Unknown or unavailable source reference");
    const present = cited as readonly GeoKnowledgeSourceV2[];
    for (const subject of claim.text.flatMap(properSubjects)) {
      if (!knownSubjects.has(normalized(subject))
        && !present.some((source) => source.excerpts.some((excerpt) => normalized(excerpt).includes(normalized(subject))))) {
        throw new Error("Proper-name claim subject is absent from cited evidence");
      }
    }
    const productSources = present.filter((source) => source.kind === "own_page" || source.kind === "accepted_fact");
    if (claim.productEvidence && productSources.length === 0) throw new Error("Product evidence is required");
    const excerpts = (claim.productEvidence ? productSources : present).flatMap((source) => source.excerpts);
    if (!geoLiteralsAllSupported(claim.text, excerpts)) throw new Error("Unsupported numeric claim");
  }
}


export function parseGeoKnowledgeNarrativeV2(raw: unknown, rawInput: GeoKnowledgeSynthesisInputV2): GeoKnowledgeNarrativeV2 {
  const input = parseGeoKnowledgeSynthesisInputV2(rawInput);
  const value = narrativeSchema.parse(raw);
  assertNarrativeIntegrity(value, input);
  return value;
}

// ---------------------------------------------------------------------------
// marketing-geo-knowledge-generation-result.v2
// ---------------------------------------------------------------------------

// Deliberately not `z.uuid()`: these identities include UUIDv8 values, and a
// version-pinning validator rejects every one of them.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const receiptRefSchema = z.object({ receiptId: uuid, contentHash: hash }).strict();

/**
 * The v2 manifest keeps v1's arity and swaps the one field that changed:
 * `profileCopyHash` becomes `generationInputHash`. Admission and publish-time
 * reuse then compare the same value, which is what lets a review edit a draft
 * without invalidating the generation it already paid for.
 */
const manifestSchema = z.object({
  schemaVersion: z.literal(GEO_KNOWLEDGE_GENERATION_INPUT_V2_SCHEMA),
  kbId: uuid,
  baseDraftVersion: z.string().regex(/^[1-9][0-9]{0,15}$/u).refine((value) => Number.isSafeInteger(Number(value)), "Expected a safe draft version"),
  baseDraftHash: hash,
  generationInputHash: hash,
  sourceReceiptRefs: z.array(receiptRefSchema).max(GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.receiptRefs),
  knowledgeSynthesisInput: z.unknown().transform(parseGeoKnowledgeSynthesisInputV2),
}).strict().superRefine((manifest, ctx) => {
  const receiptIds = manifest.sourceReceiptRefs.map((ref) => ref.receiptId);
  if (receiptIds.some((value) => value !== value.toLocaleLowerCase("en"))) ctx.addIssue({ code: "custom", message: "Source receipt references must be canonical" });
  if (new Set(receiptIds).size !== receiptIds.length) ctx.addIssue({ code: "custom", message: "Duplicate source receipt reference" });
  if (receiptIds.some((value, index) => index > 0 && (receiptIds[index - 1] as string).localeCompare(value) >= 0)) {
    ctx.addIssue({ code: "custom", message: "Source receipt references must be canonical" });
  }
});
export type GeoKnowledgeGenerationInputManifestV2 = z.infer<typeof manifestSchema>;

const resultBodySchema = z.object({
  schemaVersion: z.literal(GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA),
  generationId: uuid,
  kbId: uuid,
  manifest: manifestSchema,
  synthesisInput: z.unknown().transform(parseGeoKnowledgeSynthesisInputV2),
  evidence: z.unknown().transform(parseGeoKnowledgeEvidenceV1),
  narrative: z.unknown(),
  generatedAt: timestamp,
}).strict();
const resultSchema = resultBodySchema.extend({ contentHash: hash }).strict();

export interface GeoKnowledgeGenerationResultBodyV2 {
  readonly schemaVersion: typeof GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA;
  readonly generationId: string;
  readonly kbId: string;
  readonly manifest: GeoKnowledgeGenerationInputManifestV2;
  readonly synthesisInput: GeoKnowledgeSynthesisInputV2;
  readonly evidence: GeoKnowledgeEvidenceV1;
  readonly narrative: GeoKnowledgeNarrativeV2;
  readonly generatedAt: string;
}
export interface GeoKnowledgeGenerationResultV2 extends GeoKnowledgeGenerationResultBodyV2 {
  readonly contentHash: string;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalGeoV2Text(left) === canonicalGeoV2Text(right);
}

function parseResultBody(value: unknown): GeoKnowledgeGenerationResultBodyV2 {
  const parsed = resultBodySchema.parse(value);
  const narrative = parseGeoKnowledgeNarrativeV2(parsed.narrative, parsed.synthesisInput);
  const body: GeoKnowledgeGenerationResultBodyV2 = { ...parsed, narrative };
  if (body.manifest.kbId !== body.kbId) throw new Error("Knowledge generation kb scope mismatch");
  if (!same(body.manifest.knowledgeSynthesisInput, body.synthesisInput)) throw new Error("Knowledge generation manifest/synthesis mismatch");
  // The point of the v2 identity: the record and the input it was bought
  // against agree on which locked generation input they belong to.
  if (body.manifest.generationInputHash !== body.synthesisInput.generationInputHash) {
    throw new Error("Knowledge generation input hash mismatch");
  }
  if (body.synthesisInput.evidenceContentHash !== body.evidence.contentHash) throw new Error("Knowledge generation evidence hash mismatch");
  if (body.synthesisInput.targetUrl !== body.evidence.targetUrl) throw new Error("Knowledge generation evidence target mismatch");
  if (!same(body.synthesisInput.confirmedCompetitors, body.evidence.confirmedCompetitors)) throw new Error("Knowledge generation competitor evidence mismatch");
  // Re-derived from the stored evidence, not merely compared to it: the input
  // must be *the* projection of that evidence, so a catalogue that showed the
  // model more or fewer excerpts than the rule allows is refused.
  const usableSources = projectGeoKnowledgeSynthesisV2Catalogue(
    body.evidence.sourceCatalogue.filter((source) => source.availability !== "unavailable"),
    body.synthesisInput,
  ).catalogue;
  if (!same(body.synthesisInput.sourceCatalogue, usableSources)) throw new Error("Knowledge generation evidence source projection mismatch");
  if (Date.parse(body.generatedAt) < Date.parse(body.evidence.collectedAt)) throw new Error("Knowledge generation predates collected evidence");
  return body;
}

export function geoKnowledgeGenerationResultV2Hash(body: unknown): string {
  return geoV2Digest(body);
}

export function parseGeoKnowledgeGenerationResultV2(value: unknown): GeoKnowledgeGenerationResultV2 {
  if (geoV2JsonbBytes(value) > GEO_KNOWLEDGE_GENERATION_RESULT_V2_MAX_BYTES) throw new Error("Knowledge generation result exceeds byte limit");
  const parsed = resultSchema.parse(value);
  const { contentHash, ...rawBody } = parsed;
  const body = parseResultBody(rawBody);
  if (geoKnowledgeGenerationResultV2Hash(body) !== contentHash) throw new Error("Knowledge generation result hash mismatch");
  return { ...body, contentHash };
}

export function buildGeoKnowledgeGenerationResultV2(value: unknown): GeoKnowledgeGenerationResultV2 {
  const body = parseResultBody(value);
  return parseGeoKnowledgeGenerationResultV2({ ...body, contentHash: geoKnowledgeGenerationResultV2Hash(body) });
}
