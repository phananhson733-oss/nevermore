// @input -- the shape shared by a v3 draft and a published v2 knowledge pack
// @output -- client-safe atoms, module states and per-item content shapes
// @pos -- browser-safe: no digest, no store, no server module may be imported here

/**
 * One definition of what a knowledge item *is*, used by both sides:
 *
 *   draft (payload v3)   = content shape + draft provenance (origin, no decision)
 *   published (pack v2)  = content shape + published provenance (origin + decision)
 *
 * Keeping the content shape here, in a file the browser can import, is what
 * lets the editor and the published renderer agree without the editor pulling
 * `node:crypto` in through a digest module. `geo-kb-v2-wire.test.ts` enforces
 * that boundary by rejecting any import whose specifier matches digest/store/
 * server, so a shared file that imported one would fail the build's own guard.
 */
import { z } from "zod";

import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { hasLoneSurrogate } from "../agents/geo-canonical.ts";

export const GEO_KNOWLEDGE_LIMITS = {
  sources: 32,
  ownPages: 8,
  competitorIdentities: 5,
  competitorPagesPerIdentity: 2,
  machineSourcesPerKind: 1,
  excerptsPerSource: 8,
  excerptCodePoints: 1_200,
  sourceRefs: 16,
  aliases: 12,
  secondaryCategories: 12,
  sameAs: 16,
  facts: 64,
  qa: 32,
  variants: 8,
  comparisons: 5,
  comparisonRows: 16,
  scopeItems: 24,
  evidenceItems: 32,
  coverageItems: 24,
  qualifiers: 8,
} as const;

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/u;
// Preserve exact excerpts, including line breaks, while excluding JSON-hostile controls.
// eslint-disable-next-line no-control-regex
const DISALLOWED_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export function geoBoundedText(maximum: number, nonempty = true) {
  return z.string().refine((value) => (
    (!nonempty || value.trim().length > 0)
    && Array.from(value).length <= maximum
    && !DISALLOWED_TEXT.test(value)
    && !hasLoneSurrogate(value)
  ), `Expected bounded text of at most ${maximum} code points`);
}

export const geoText = geoBoundedText(800);
export const geoShortText = geoBoundedText(200);
export const geoLabel = geoBoundedText(120);
export const geoId = geoBoundedText(128).regex(ID);
export const geoHash = z.string().regex(HASH);
export const geoYear = z.string().regex(/^\d{4}$/u);
export const geoTimestamp = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  "Expected a canonical ISO timestamp",
);
export const geoPublicUrl = z.string().max(2_048).refine((value) => {
  if (!/^https?:\/\//u.test(value)) return false;
  const normalized = normalizeAccountWebsiteUrl(value);
  return normalized !== null && normalized.submittedUrl === value;
}, "Expected an exact normalized public HTTP(S) URL");

/**
 * A bounded count carried as a canonical decimal string. Counts are data the
 * payload has to hold, and the payload's hash domain has no number type.
 */
export function geoCount(maximum: number) {
  return z.string().regex(/^(0|[1-9]\d{0,14})$/u).refine(
    (value) => Number(value) <= maximum,
    `Expected a count of at most ${maximum}`,
  );
}

/**
 * A length-bounded string with no structural meaning, still rejected when it
 * carries what PostgreSQL JSONB cannot store: a NUL, or a lone surrogate that
 * has no valid `jsonb::text` representation at all.
 */
export function geoPlainString(maximum: number, minimum = 0) {
  return z.string().min(minimum).max(maximum).refine(
    (value) => !value.includes("\u0000") && !hasLoneSurrogate(value),
    "Expected a string PostgreSQL JSONB can store",
  );
}

export const geoUnique = (values: readonly string[]) => new Set(values).size === values.length;
export const geoNormalizedUnique = (values: readonly string[]) => new Set(
  values.map((value) => value.normalize("NFC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim()),
).size === values.length;
export const geoRefList = (minimum: 0 | 1) => z.array(geoId).min(minimum).max(GEO_KNOWLEDGE_LIMITS.sourceRefs).refine(geoUnique, "Duplicate source reference");
export const geoList = <T extends z.ZodTypeAny>(item: T, maximum: number) => z.array(item).max(maximum);

export const geoUnavailableReasonSchema = z.enum([
  "not_collected",
  "not_published",
  "not_found",
  "timeout",
  "fetch_failed",
  "blocked",
  "rate_limited",
  "invalid_response",
  "partial_body",
  "unsupported_language",
  "generation_unavailable",
  "outcome_unknown",
  "insufficient_evidence",
  "not_applicable",
  "context_stale",
  /**
   * The owner emptied the section: the run collected supported items and the
   * review excluded or suppressed every one of them. Deliberately not
   * `insufficient_evidence` -- that sentence is about the collection run, and
   * saying it here would blame the evidence for a decision a person made.
   */
  "owner_excluded_all",
  /**
   * The owner excluded a field the section cannot be published without: an
   * entity name, its primary category, a definition, its audience or its home
   * link. Such a value cannot be dropped and the rest published, so the whole
   * section is withheld -- and says which kind of decision withheld it.
   */
  "owner_excluded_required",
]);
export type GeoUnavailableReason = z.infer<typeof geoUnavailableReasonSchema>;

/** available / partial(limitation) / unavailable(reason) -- unchanged from v1. */
export function geoModuleSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), value }).strict(),
    z.object({ status: z.literal("partial"), limitation: geoText, value }).strict(),
    z.object({ status: z.literal("unavailable"), reason: geoUnavailableReasonSchema }).strict(),
  ]);
}

/** Where a claim came from. Independent of what anyone decided about it. */
export const geoItemOriginSchema = z.enum([
  "observed_own",
  "observed_competitor",
  "observed_third_party",
  "observed_gsc",
  "declared_profile",
  "declared_owner",
  "synthesized",
]);
export type GeoItemOrigin = z.infer<typeof geoItemOriginSchema>;

/**
 * What the machine checked about a citation. Deliberately not "verified":
 * `cited_and_literals_match` proves the cited source exists and that every
 * numeric literal in the claim occurs in it. It does not prove the claim true.
 */
export const geoEvidenceCheckSchema = z.enum(["cited_and_literals_match", "owner_declared", "not_applicable"]);
export type GeoEvidenceCheck = z.infer<typeof geoEvidenceCheckSchema>;

export const geoSourceCompetitorShape = { key: geoId, name: geoShortText, confirmed: z.literal(true) } as const;
export const geoSourceCompetitorSchema = z.object(geoSourceCompetitorShape).strict();

export const geoSourceCatalogueItemSchema = z.object({
  id: geoId,
  kind: z.enum(["own_page", "competitor_page", "robots", "sitemap", "llms", "gsc", "accepted_fact", "third_party_page"]),
  label: geoLabel,
  url: geoPublicUrl.nullable(),
  competitor: geoSourceCompetitorSchema.nullable(),
  availability: z.enum(["available", "partial", "unavailable"]),
  reason: geoUnavailableReasonSchema.nullable(),
  observedAt: geoTimestamp.nullable(),
  bodyHash: geoHash.nullable(),
  excerpts: z.array(geoBoundedText(GEO_KNOWLEDGE_LIMITS.excerptCodePoints)).max(GEO_KNOWLEDGE_LIMITS.excerptsPerSource),
  /**
   * Set on `third_party_page` only. Independence needs positive evidence: a
   * byline or publisher identity distinct from the brand, and no owner-submitted
   * marker. "No counter-evidence found" is `undetermined`, never `independent`.
   */
  independence: z.enum(["independent", "self_submitted", "syndicated", "undetermined"]).nullable(),
}).strict().superRefine((source, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((source.kind === "competitor_page") !== (source.competitor !== null)) issue("Invalid competitor source scope");
  if ((source.kind === "third_party_page") !== (source.independence !== null)) issue("Independence applies to third-party sources only");
  if (!["gsc", "accepted_fact"].includes(source.kind) && source.url === null) issue("Public source URL required");
  if (source.bodyHash !== null && source.observedAt === null) issue("Body hash requires an observation time");
  if (source.availability === "unavailable") {
    if (source.reason === null || source.observedAt !== null || source.bodyHash !== null || source.excerpts.length !== 0) issue("Unavailable source cannot carry observed content");
    return;
  }
  if (source.availability === "available" ? source.reason !== null : source.reason === null) issue("Source availability reason mismatch");
  if (source.excerpts.length === 0) issue("Available source requires exact evidence excerpts");
  if (source.kind === "gsc" && source.observedAt === null) issue("GSC source requires an observation time");
  if (!["gsc", "accepted_fact"].includes(source.kind) && (source.observedAt === null || source.bodyHash === null)) issue("Crawled source requires observation time and body hash");
});
export type GeoKnowledgeSource = z.infer<typeof geoSourceCatalogueItemSchema>;

// ---------------------------------------------------------------------------
// Per-item content shapes. Provenance is added by the caller: a draft adds
// origin only, a published pack adds origin plus the owner's decision.
// ---------------------------------------------------------------------------

export const geoEntityValueShape = {
  name: geoShortText,
  aliases: z.array(geoShortText).max(GEO_KNOWLEDGE_LIMITS.aliases).refine(geoNormalizedUnique),
  categories: z.object({
    primary: geoShortText,
    secondary: z.array(geoShortText).max(GEO_KNOWLEDGE_LIMITS.secondaryCategories).refine(geoNormalizedUnique),
  }).strict(),
  definitions: z.object({ w25: geoText, w55: geoText, w120: geoText }).strict(),
  audience: z.object({ who: geoText, notFor: geoText.nullable() }).strict(),
  founded: z.object({ year: geoYear.nullable(), team: geoText.nullable(), location: geoText.nullable() }).strict(),
  disambiguation: geoText.nullable(),
  links: z.object({
    home: geoPublicUrl,
    pricing: geoPublicUrl.nullable(),
    docs: geoPublicUrl.nullable(),
    about: geoPublicUrl.nullable(),
    changelog: geoPublicUrl.nullable(),
    faq: geoPublicUrl.nullable(),
  }).strict(),
  /**
   * Only cross-referenced identities reach this list. A page that merely
   * mentions the brand, or that the brand links to without naming it back,
   * stays a candidate in the evidence module and never becomes a sameAs claim.
   */
  sameAs: z.array(geoPublicUrl).max(GEO_KNOWLEDGE_LIMITS.sameAs).refine(geoUnique),
  sourceRefs: geoRefList(1),
} as const;

/**
 * The entity fields an item key and an owner correction may address. A free
 * string here would let a correction name a field nothing can apply it to, and
 * would leave the claim behind an entity item unresolvable -- which is what the
 * literal check needs in order to check anything.
 */
export const GEO_ENTITY_FIELD_PATHS = [
  "name", "aliases", "categories.primary", "categories.secondary",
  "definitions.w25", "definitions.w55", "definitions.w120",
  "audience.who", "audience.notFor",
  "founded.year", "founded.team", "founded.location",
  "disambiguation",
  "links.home", "links.pricing", "links.docs", "links.about", "links.changelog", "links.faq",
  "sameAs",
] as const;
export const geoEntityFieldPathSchema = z.enum(GEO_ENTITY_FIELD_PATHS);
export type GeoEntityFieldPath = (typeof GEO_ENTITY_FIELD_PATHS)[number];

/**
 * The subset an owner correction can address. A correction carries one short
 * string, so it can replace a scalar field and nothing else: a list, a URL or
 * a `sameAs` set needs its own gesture. Every other path still gets an item key
 * and can be excluded -- it just cannot be rewritten in place.
 */
export const GEO_ENTITY_CORRECTABLE_PATHS = [
  "name", "categories.primary",
  "definitions.w25", "definitions.w55", "definitions.w120",
  "audience.who", "audience.notFor",
  "founded.year", "founded.team", "founded.location",
  "disambiguation",
] as const satisfies readonly GeoEntityFieldPath[];
export const geoEntityCorrectablePathSchema = z.enum(GEO_ENTITY_CORRECTABLE_PATHS);

/**
 * The entity fields a published entity can be *missing*.
 *
 * Excluding a field has to remove the value, not merely its provenance row --
 * publishing text the owner rejected is the one thing an exclusion must never
 * do. So the question "may this field be excluded?" is the same question as
 * "does the entity contract still parse without it?", and the answer is a
 * property of the shape, which is why it lives here rather than in the
 * assembler: the review UI is a client component and cannot import the
 * assembler, but it must not offer a gesture the assembler will refuse.
 *
 * A list empties, a nullable scalar becomes null. Everything else -- the name,
 * the primary category, the three definitions, the audience and the home link
 * -- has no publishable absent form, so it is required.
 */
export const GEO_ENTITY_REMOVABLE_PATHS = [
  "aliases", "categories.secondary", "sameAs",
  "disambiguation", "audience.notFor",
  "founded.year", "founded.team", "founded.location",
  "links.pricing", "links.docs", "links.about", "links.changelog", "links.faq",
] as const satisfies readonly GeoEntityFieldPath[];
export type GeoEntityRemovablePath = (typeof GEO_ENTITY_REMOVABLE_PATHS)[number];

const REMOVABLE_ENTITY_PATHS: ReadonlySet<string> = new Set(GEO_ENTITY_REMOVABLE_PATHS);

/**
 * Derived, never restated. A path added to `GEO_ENTITY_FIELD_PATHS` without an
 * entry above becomes required, which is the fail-closed direction: the
 * alternative is silently publishing a value the owner excluded.
 */
export const GEO_ENTITY_REQUIRED_PATHS: readonly GeoEntityFieldPath[] =
  GEO_ENTITY_FIELD_PATHS.filter((path) => !REMOVABLE_ENTITY_PATHS.has(path));

/** The claim text behind one entity field, as the reader would see it. */
export function geoEntityFieldClaim(entity: unknown, path: GeoEntityFieldPath): string {
  let node: unknown = entity;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") return "";
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.filter((entry) => typeof entry === "string").join(" ");
  return "";
}

export const geoFactContentShape = {
  id: geoId,
  type: z.enum(["price", "policy", "feature", "integration", "company", "audience", "data", "other"]),
  /** The sentence a reader sees. */
  statement: geoText,
  /**
   * The comparable short value and the label it answers. The Brief's fact table
   * is built from these two rather than from the sentence: it compares values
   * literally, and a whole sentence would never match. `value` is null exactly
   * when the fact is unavailable, and `reason` then says why -- unavailable is
   * never rendered as zero or as an empty string.
   */
  label: geoShortText,
  value: geoShortText.nullable(),
  reason: z.enum(["", "notPublished", "fetchFailed", "lowConfidence", "conflicting"]),
  /** The triple the item key is derived from, kept so a merge can explain itself. */
  subject: geoShortText,
  attribute: geoShortText,
  /**
   * Normalised uniqueness, not raw: ["Pro","pro"] is one qualifier set to the
   * key builder, so admitting it here would let a harmless extraction variation
   * change an item's identity and orphan the owner's decision.
   */
  qualifiers: z.array(geoShortText).max(GEO_KNOWLEDGE_LIMITS.qualifiers).refine(geoNormalizedUnique, "Duplicate qualifier"),
  observedAt: geoTimestamp.nullable(),
  nextReviewAt: geoTimestamp.nullable(),
} as const;

export const geoQaContentShape = {
  id: geoId,
  intent: z.enum(["definition", "comparison", "price", "operation", "trust", "boundary", "alternative", "applicability", "other"]),
  question: geoText,
  /** The stable phrasing the item key is derived from. */
  canonicalQuestion: geoText,
  variants: z.array(geoText).max(GEO_KNOWLEDGE_LIMITS.variants).refine(geoNormalizedUnique),
  directAnswer: geoText,
  expansion: geoBoundedText(2_400).nullable(),
} as const;

export const geoComparisonRowContentShape = {
  id: geoId,
  dimension: geoLabel,
  product: geoText.nullable(),
  competitor: geoText.nullable(),
  availability: z.enum(["available", "partial", "unavailable"]),
} as const;

/** Availability and the two values must agree, in both draft and pack. */
export function refineGeoComparisonRow(
  row: { readonly availability: "available" | "partial" | "unavailable"; readonly product: string | null; readonly competitor: string | null },
  ctx: z.RefinementCtx,
): void {
  if (row.availability === "available" && (row.product === null || row.competitor === null)) {
    ctx.addIssue({ code: "custom", message: "Available comparison row requires both values" });
  }
  if (row.availability === "unavailable" && (row.product !== null || row.competitor !== null)) {
    ctx.addIssue({ code: "custom", message: "Unavailable comparison row cannot carry values" });
  }
}

export const geoStatementContentShape = { id: geoId, text: geoText } as const;

export const geoEvidenceItemShape = {
  id: geoId,
  label: geoLabel,
  summary: geoText,
  url: geoPublicUrl.nullable(),
  sourceRefs: geoRefList(1),
  /**
   * How independent this evidence is of the brand. Owner-submitted profiles and
   * syndicated copies are still listed -- hiding them would misrepresent what
   * was found -- but they are labelled, because only an independent source
   * supports a trust claim.
   */
  independence: z.enum(["first_party", "independent", "self_submitted", "syndicated", "undetermined"]),
} as const;

export const GEO_EVIDENCE_GROUPS = ["proof", "changelog", "press", "thirdPartyProfiles", "firstPartyProof"] as const;
export type GeoEvidenceGroup = (typeof GEO_EVIDENCE_GROUPS)[number];

export const geoMachineStatusSchema = z.enum(["present", "absent", "unreachable", "not_checked"]);
export const geoCrawlerAccessSchema = z.enum(["allowed", "disallowed", "unspecified"]);
export const geoCrawlerRowSchema = z.object({ agent: geoShortText, access: geoCrawlerAccessSchema }).strict();

export const geoMachineValueShape = {
  jsonLd: z.object({ status: geoMachineStatusSchema, types: z.array(geoShortText).max(32).refine(geoNormalizedUnique), sourceRefs: geoRefList(1) }).strict(),
  llms: z.object({ status: geoMachineStatusSchema, sourceRefs: geoRefList(1) }).strict(),
  robots: z.object({ status: geoMachineStatusSchema, sourceRefs: geoRefList(1) }).strict(),
  sitemap: z.object({
    status: geoMachineStatusSchema,
    /**
     * A decimal string, not a number: the v3 payload's canonical form has no
     * JSON number type at all, so a numeric `urlCount` made every site that
     * actually has a sitemap unsaveable.
     */
    urlCount: geoCount(1_000_000).nullable(),
    knowledgePagesListed: z.boolean().nullable(),
    sourceRefs: geoRefList(1),
  }).strict(),
  hreflang: z.object({ status: geoMachineStatusSchema, locales: z.array(geoShortText).max(64).refine(geoNormalizedUnique), sourceRefs: geoRefList(1) }).strict(),
  /**
   * Search-use and training-use crawler permissions are independent: blocking
   * GPTBot does not remove a page from AI Overviews, and Google-Extended governs
   * training only. One combined "AI crawlers" verdict would state something
   * untrue about both.
   */
  aiCrawlers: z.object({
    search: z.array(geoCrawlerRowSchema).max(16).refine((rows) => geoUnique(rows.map((row) => row.agent))),
    training: z.array(geoCrawlerRowSchema).max(16).refine((rows) => geoUnique(rows.map((row) => row.agent))),
    sourceRefs: geoRefList(1),
  }).strict(),
  /** Snippet permission: nosnippet or max-snippet:0 removes citation eligibility. */
  snippets: z.object({ status: z.enum(["allowed", "blocked", "not_checked"]), sourceRefs: geoRefList(1) }).strict(),
} as const;

/**
 * Which source kind each machine observation must cite. A robots.txt fetch
 * cannot evidence a sitemap's URL count, and the published pack already refuses
 * that mismatch -- so a draft allowed to carry it is a draft that saves and
 * then fails at publish, after the paid work, with the owner watching.
 */
export const GEO_MACHINE_SOURCE_KINDS = {
  jsonLd: ["own_page"],
  llms: ["llms"],
  robots: ["robots"],
  sitemap: ["sitemap"],
  hreflang: ["own_page"],
  aiCrawlers: ["robots"],
  snippets: ["own_page", "robots"],
} as const;

export function refineGeoMachine(
  machine: {
    readonly jsonLd: { readonly status: string; readonly types: readonly string[] };
    readonly sitemap: { readonly status: string; readonly urlCount: string | null; readonly knowledgePagesListed: boolean | null };
    readonly hreflang: { readonly status: string; readonly locales: readonly string[] };
  },
  ctx: z.RefinementCtx,
): void {
  if (machine.jsonLd.status !== "present" && machine.jsonLd.types.length !== 0) ctx.addIssue({ code: "custom", message: "Unobserved JSON-LD types" });
  if (machine.sitemap.status === "present"
    ? machine.sitemap.urlCount === null || machine.sitemap.knowledgePagesListed === null
    : machine.sitemap.urlCount !== null || machine.sitemap.knowledgePagesListed !== null) ctx.addIssue({ code: "custom", message: "Invalid sitemap observation" });
  if (machine.hreflang.status !== "present" && machine.hreflang.locales.length !== 0) ctx.addIssue({ code: "custom", message: "Unobserved hreflang locales" });
}

export const geoCoverageItemShape = {
  id: geoId,
  label: geoLabel,
  status: z.enum(["covered", "partial", "missing"]),
  summary: geoText,
  nextAction: geoText.nullable(),
  sourceRefs: geoRefList(0),
} as const;

/**
 * One numeric literal a text asserts, split into the number and the unit sign
 * written against it.
 *
 * They are kept apart so that the sign is compared rather than discarded, but
 * both must match: a claim saying 9,900 is not supported by an excerpt saying
 * 12,000, and a claim saying ₩9,900 is not supported by one saying ₹9,900 --
 * nor by one saying a bare 9,900, because a claim that names a unit the page
 * never showed has invented it. That strictness is not new; it is what the four
 * signs this used to hard-code already did. Generalising it is the point.
 *
 * The known cost, deliberate: a page that writes the unit after the number as a
 * word ("9,900원", "9,900 円", "9,900 dollars") reads as signless here, so a
 * signed claim about it is refused. That is a false negative, and it fails the
 * safe way -- the item is dropped or marked `not_applicable` rather than
 * published with an unearned citation badge. Fixing it properly means teaching
 * the tokenizer to read suffix units, not re-opening the sign to anything.
 */
export interface GeoLiteralToken {
  /** The currency sign written against the number, or `null` if none was. */
  readonly symbol: string | null;
  /** The number itself: sign and percent kept, currency and spacing removed. */
  readonly core: string;
}

/**
 * `\p{Sc}` rather than a hand-written list of signs. Which currencies a guard
 * knows must not depend on which ones somebody remembered to type: the four
 * ASCII-adjacent signs this used to list left ₩, ₹, ₽, ₺ and every other sign
 * silently stripped, so a won price and a rupee price of the same digits were
 * the same literal.
 */
const GEO_LITERAL_RE = /[+-]?(?:(\p{Sc})\s*)?\p{N}+(?:[.,:/-]\p{N}+)*(?:\s*%)?/gu;

/**
 * Numeric literals a text asserts, read under NFKC.
 *
 * NFKC is what makes a CJK page comparable to the claim written about it: it
 * folds ￥ onto ¥, ％ onto %, and fullwidth digits ９９００ onto 9900, which are
 * compatibility spellings of the same number rather than different numbers.
 * It is applied to a copy for comparison only -- nothing here writes back, and
 * stored excerpts keep the bytes the page actually served.
 *
 * The cost is deliberate and small: NFKC also expands a few compatibility
 * numerals (½ becomes 1⁄2, ² becomes 2), so those compare as their expansions
 * on both sides rather than as single literals.
 */
export function geoLiteralTokens(value: string): readonly GeoLiteralToken[] {
  return [...value.normalize("NFKC").matchAll(GEO_LITERAL_RE)].map((match) => ({
    symbol: match[1] ?? null,
    core: match[0].replace(/\p{Sc}/gu, "").replace(/\s+/gu, ""),
  }));
}

/**
 * Whether the cited excerpts support a claim's numbers. This is the whole
 * content of `cited_and_literals_match`: the claim's numeric literals all occur
 * in text that was actually observed. It says nothing about whether the claim
 * is true, and a claim with no numbers is supported by any non-empty excerpt.
 */
export function geoLiteralsSupported(claim: string, excerpts: readonly string[]): boolean {
  return geoLiteralsAllSupported([claim], excerpts);
}

/** The same rule over several claim strings that cite the same excerpts. */
export function geoLiteralsAllSupported(claims: readonly string[], excerpts: readonly string[]): boolean {
  const observed = excerpts.flatMap((excerpt) => geoLiteralTokens(excerpt));
  return claims.flatMap((claim) => geoLiteralTokens(claim)).every((literal) => observed.some((seen) => (
    seen.core === literal.core && seen.symbol === literal.symbol
  )));
}
