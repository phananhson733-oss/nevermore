// @input  -- a locally confirmed Marketing profile and the visitor's own confirmations
// @output -- one immutable context snapshot with a reproducible content fingerprint
// @pos    -- the Marketing-owned context contract every GEO query and report binds to

import {
  findGeoAliasMatch,
  normalizeAliasForMatch,
  GEO_MIN_ALIAS_TOKEN_LENGTH,
} from "./geo-alias-match.ts";
import {
  codePointLength,
  geoDomainHash,
  hasArrayHole,
  isGeoDigest,
  normalizeGeoText,
  type GeoCanonicalValue,
} from "./geo-canonical.ts";
import {
  normalizeGeoCitationUrl,
  normalizeGeoHost,
  normalizeGeoTargetUrl,
} from "./geo-url.ts";

export const GEO_CONTEXT_SCHEMA_VERSION = "geo_context.v1" as const;

/** Hash domain for the context fingerprint (§5.1). */
export const GEO_CONTEXT_HASH_DOMAIN = "geo_context.v1";

/**
 * Where a confirmed brand alias came from.
 *
 * Per alias, not per set. The product name and the hostname label are different
 * kinds of evidence — one the visitor supplied, one this code inferred — and a
 * set-level source would let an inference inherit the credibility of a
 * declaration. Nothing here is auto-promoted: a derived candidate is a
 * candidate until the visitor ticks it.
 */
export type GeoAliasSource =
  | "profile_product_name"
  | "host_label"
  | "user_edit";

export interface GeoConfirmedAliasV1 {
  readonly alias: string;
  readonly source: GeoAliasSource;
}

/** What the UI collects: a proposal plus the visitor's answer to it. */
export interface GeoAliasCandidateV1 extends GeoConfirmedAliasV1 {
  readonly confirmed: boolean;
}

export interface GeoContextSourceEntryV1 {
  readonly field: string;
  /** Stable enum code, not free prose; localized copy renders separately. */
  readonly source: string;
  /** Stable limitation code or null; localized copy renders separately. */
  readonly limitationCode: string | null;
}

export interface GeoContextSnapshotV1 {
  readonly schemaVersion: typeof GEO_CONTEXT_SCHEMA_VERSION;
  readonly targetUrl: string;
  readonly targetHost: string;
  readonly productName: string;
  readonly brandAliases: readonly GeoConfirmedAliasV1[];
  readonly category: string;
  readonly buyer: string;
  readonly user: string;
  readonly jtbd: string;
  readonly useCases: readonly string[];
  readonly outcomes: readonly string[];
  readonly barriers: readonly string[];
  readonly directCompetitors: readonly string[];
  readonly indirectAlternatives: readonly string[];
  readonly marketCode: string;
  /** §2.8: P0 accepts English only. */
  readonly targetQueryLanguage: "en";
  readonly sourceProfileVersion: string;
  readonly sourceSummary: readonly GeoContextSourceEntryV1[];
  readonly confirmedAt: string;
  readonly contextHash: string;
}

/** Everything the visitor confirms, before the clock and the hash are applied. */
export interface GeoContextInputV1 {
  readonly targetUrl: string;
  readonly productName: string;
  readonly brandAliases: readonly GeoAliasCandidateV1[];
  readonly category: string;
  /** Category has no source in the existing profile; it is a candidate (§5.1). */
  readonly categoryConfirmed: boolean;
  readonly buyer: string;
  readonly user: string;
  readonly jtbd: string;
  readonly useCases: readonly string[];
  readonly outcomes: readonly string[];
  readonly barriers: readonly string[];
  readonly directCompetitors: readonly string[];
  readonly indirectAlternatives: readonly string[];
  readonly marketCode: string;
  readonly targetQueryLanguage: string;
  readonly sourceProfileVersion: string;
  readonly sourceSummary: readonly GeoContextSourceEntryV1[];
}

export type GeoContextRejection =
  | "target_url_invalid"
  | "product_name_invalid"
  | "category_unconfirmed"
  | "category_invalid"
  | "buyer_invalid"
  | "aliases_none_confirmed"
  | "alias_invalid"
  | "alias_generic"
  | "alias_duplicate"
  | "alias_too_many"
  | "market_missing"
  | "market_not_a_country"
  | "query_language_unsupported"
  | "list_value_invalid"
  | "source_summary_invalid"
  | "profile_version_invalid";

export type GeoContextConfirmation =
  | { readonly ok: true; readonly snapshot: GeoContextSnapshotV1 }
  | { readonly ok: false; readonly rejections: readonly GeoContextRejection[] };

export const GEO_MAX_BRAND_ALIASES = 5;
export const GEO_MAX_ALIAS_CODE_POINTS = 80;
const MAX_PRODUCT_NAME = 80;
const MAX_CATEGORY = 60;
const MAX_BUYER = 60;
const MAX_SENTENCE = 300;
const MAX_LIST_ITEMS = 12;
const MAX_LIST_ITEM = 120;
const MAX_COMPETITORS = 10;
const MAX_SOURCE_ENTRIES = 40;

/**
 * Single words too common to identify anybody.
 *
 * A brand alias is used to decide whether an answer named the customer, so an
 * alias of "growth" turns every sentence about growth into a mention. Rejected
 * rather than merely warned about, because the resulting count looks exactly
 * like a real one.
 */
const GENERIC_ALIAS_WORDS: ReadonlySet<string> = new Set([
  "ai",
  "analytics",
  "app",
  "apps",
  "brand",
  "cloud",
  "data",
  "digital",
  "growth",
  "hub",
  "labs",
  "marketing",
  "media",
  "one",
  "platform",
  "pro",
  "search",
  "seo",
  "smart",
  "software",
  "studio",
  "tool",
  "tools",
  "web",
]);

/**
 * ISO 3166-1 alpha-2, in full.
 *
 * A two-letter regular expression is not a country check: it accepts "EU",
 * which is a union rather than a country and which the provider cannot take,
 * and it accepts "UK", which is not the code for the United Kingdom. Both are
 * exactly what a visitor types. Since a missing or ambiguous market stops the
 * run with no US fallback, the check has to be able to tell the difference.
 */
const ISO_3166_ALPHA2: ReadonlySet<string> = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
    "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
    "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
    "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
    "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
    "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

/** Whether the code is a real ISO 3166-1 alpha-2 country. */
export function isGeoCountryCode(value: string): boolean {
  return ISO_3166_ALPHA2.has(value);
}

/** Codes that would let a workflow flag be rendered as a server-proven fact. */
const FORBIDDEN_SOURCE_CODES: ReadonlySet<string> = new Set([
  "verified",
  "server_verified",
  "confirmed_by_server",
]);

const CODE_SHAPE = /^[a-z][a-z0-9_]{0,63}$/u;

function bounded(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = normalizeGeoText(value);
  return text.length > 0 && text.length <= max ? text : null;
}

function boundedOrEmpty(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = normalizeGeoText(value);
  return text.length <= max ? text : null;
}

function boundedList(
  value: unknown,
  maxItems: number,
  maxItem: number,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const items: string[] = [];
  for (const entry of value) {
    const text = bounded(entry, maxItem);
    if (text === null) return null;
    if (!items.includes(text)) items.push(text);
  }
  return items;
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isSourceEntry(value: unknown): value is GeoContextSourceEntryV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry);
  if (
    keys.length !== 3 ||
    !Object.hasOwn(entry, "field") ||
    !Object.hasOwn(entry, "source") ||
    !Object.hasOwn(entry, "limitationCode")
  ) {
    return false;
  }
  if (typeof entry.field !== "string" || !CODE_SHAPE.test(entry.field)) {
    return false;
  }
  if (typeof entry.source !== "string" || !CODE_SHAPE.test(entry.source)) {
    return false;
  }
  // Not a denylist of three spellings: any code containing "verif" would let a
  // workflow flag be rendered as a server-proven fact, which is the one claim
  // this product must never make about a locally confirmed value.
  if (
    FORBIDDEN_SOURCE_CODES.has(entry.source) ||
    entry.source.includes("verif")
  ) {
    return false;
  }
  if (entry.limitationCode !== null) {
    if (
      typeof entry.limitationCode !== "string" ||
      !CODE_SHAPE.test(entry.limitationCode)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Whether the alias set is inside the matcher's tested semantics.
 *
 * The matcher segments on ASCII-style word boundaries. That model does not
 * describe Chinese, Japanese, Korean or Thai, where words are not
 * space-delimited, and it does not describe a name whose leading or trailing
 * punctuation is load-bearing — ".NET" normalizes to "net", which then matches
 * the ordinary word "net" in any sentence. When the set is out of scope, mention
 * evaluation reports `unavailable`. It never reports `not_observed`, because
 * "the matcher cannot answer" and "the answer did not name you" are different
 * facts and only one of them is about the customer.
 */
export type GeoAliasMatcherScope = "supported" | "out_of_scope";

const UNSEGMENTED_SCRIPTS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const EDGE_NON_WORD = /^[^\p{L}\p{N}]|[^\p{L}\p{N}]$/u;

export function geoAliasMatcherScope(
  aliases: readonly GeoConfirmedAliasV1[],
): GeoAliasMatcherScope {
  for (const entry of aliases) {
    if (
      normalizeAliasForMatch(entry.alias).length < GEO_MIN_ALIAS_TOKEN_LENGTH
    ) {
      return "out_of_scope";
    }
    if (UNSEGMENTED_SCRIPTS.test(entry.alias)) return "out_of_scope";
    if (EDGE_NON_WORD.test(entry.alias)) return "out_of_scope";
  }
  return "supported";
}

/** Whether the rendered prompt itself names the customer (§2.3). */
export function promptContainsTargetAlias(
  text: string,
  aliases: readonly GeoConfirmedAliasV1[],
): boolean {
  return (
    findGeoAliasMatch(
      text,
      aliases.map((entry) => entry.alias),
    ) !== null
  );
}

/**
 * Which names the rendered prompt puts in front of the model.
 *
 * Derived from the text, never asserted by the client. A question the client
 * labelled `unbranded` that in fact contains the customer's own name would make
 * every mention in its answer tautological, and the report would be presenting
 * "the model repeated the word we gave it" as discovery evidence.
 */
export function deriveGeoBrandStance(
  text: string,
  aliases: readonly GeoConfirmedAliasV1[],
  competitorNames: readonly string[],
): "unbranded" | "brand" | "mixed" {
  // The customer's own name decides first. "Acme vs Semrush" and "alternatives
  // to Semrush" are different questions, and only the first makes a mention in
  // the answer tautological; a rule that called both "mixed" would leave the
  // label unable to say which. The discovery reading never reads this field
  // anyway — it reads `mentionEligibility`, which is derived from the customer
  // alias alone — but a label a reader cannot interpret is still a bad label.
  if (promptContainsTargetAlias(text, aliases)) return "brand";
  return findGeoAliasMatch(text, competitorNames) !== null
    ? "mixed"
    : "unbranded";
}

/**
 * Whether a mention in this question's answer could be evidence of discovery.
 *
 * Falls back to `prompted` when the matcher cannot speak about the alias set.
 * That is the conservative direction: `prompted` keeps the observation out of
 * the discovery denominator, while `unprompted` would let a mention the matcher
 * may have hallucinated count as the customer being found on their own.
 */
export function deriveGeoMentionEligibility(
  text: string,
  aliases: readonly GeoConfirmedAliasV1[],
  scope: GeoAliasMatcherScope,
): "prompted" | "unprompted" {
  if (scope === "out_of_scope") return "prompted";
  return promptContainsTargetAlias(text, aliases) ? "prompted" : "unprompted";
}

/**
 * The exact projection the context fingerprint covers.
 *
 * Written out field by field. A spread of the whole snapshot would silently
 * admit every metadata field added later — including, eventually, one that is
 * localized or one that carries a timestamp — and the fingerprint would stop
 * being reproducible without anybody changing a line of hashing code.
 * `contextHash` and `confirmedAt` are excluded by construction: the same
 * confirmed content confirmed a second later must hash identically.
 */
export function geoContextHashProjection(
  snapshot: GeoContextSnapshotV1,
): GeoCanonicalValue {
  return {
    schemaVersion: snapshot.schemaVersion,
    targetUrl: snapshot.targetUrl,
    targetHost: snapshot.targetHost,
    productName: snapshot.productName,
    brandAliases: snapshot.brandAliases.map((entry) => ({
      alias: entry.alias,
      source: entry.source,
    })),
    category: snapshot.category,
    buyer: snapshot.buyer,
    user: snapshot.user,
    jtbd: snapshot.jtbd,
    useCases: [...snapshot.useCases],
    outcomes: [...snapshot.outcomes],
    barriers: [...snapshot.barriers],
    directCompetitors: [...snapshot.directCompetitors],
    indirectAlternatives: [...snapshot.indirectAlternatives],
    marketCode: snapshot.marketCode,
    targetQueryLanguage: snapshot.targetQueryLanguage,
    sourceProfileVersion: snapshot.sourceProfileVersion,
    sourceSummary: snapshot.sourceSummary.map((entry) => ({
      field: entry.field,
      source: entry.source,
      limitationCode: entry.limitationCode,
    })),
  };
}

/** The fingerprint itself. Takes no clock: the same content always hashes alike. */
export async function geoContextHash(
  snapshot: GeoContextSnapshotV1,
): Promise<string> {
  return geoDomainHash(
    GEO_CONTEXT_HASH_DOMAIN,
    geoContextHashProjection(snapshot),
  );
}

export type GeoAliasRejection =
  | "alias_invalid"
  | "alias_generic"
  | "alias_duplicate";

/**
 * The one alias rule, applied by the producer and by the wire guard.
 *
 * When only the producer applied it, a payload assembled by hand could put
 * `"growth"` into a snapshot, pass the guard, and turn every ordinary sentence
 * about growth into a customer mention across eighteen billed answers. The
 * fingerprint does not help: it proves content identity, not that this code
 * produced the content.
 */
export function rejectGeoAlias(
  alias: string,
  seen: ReadonlySet<string>,
): GeoAliasRejection | null {
  if (normalizeGeoText(alias) !== alias || alias.length === 0) {
    return "alias_invalid";
  }
  if (codePointLength(alias) > GEO_MAX_ALIAS_CODE_POINTS)
    return "alias_invalid";
  const normalized = normalizeAliasForMatch(alias);
  if (normalized.length < GEO_MIN_ALIAS_TOKEN_LENGTH) return "alias_generic";
  // Every token generic, not just a single generic word. "SEO Tool" is a
  // product name that matches the ordinary phrase "an seo tool should", and a
  // mention count built on that is manufactured rather than observed.
  const tokens = normalized.split(" ");
  if (tokens.every((token) => GENERIC_ALIAS_WORDS.has(token))) {
    return "alias_generic";
  }
  if (seen.has(normalized)) return "alias_duplicate";
  return null;
}

function validateAliases(
  candidates: readonly GeoAliasCandidateV1[],
  rejections: GeoContextRejection[],
): readonly GeoConfirmedAliasV1[] {
  if (!Array.isArray(candidates)) {
    rejections.push("alias_invalid");
    return [];
  }
  const confirmed: GeoConfirmedAliasV1[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.confirmed !== "boolean" ||
      typeof candidate.alias !== "string" ||
      (candidate.source !== "profile_product_name" &&
        candidate.source !== "host_label" &&
        candidate.source !== "user_edit")
    ) {
      rejections.push("alias_invalid");
      continue;
    }
    // An unconfirmed candidate is not an error; it is a proposal the visitor
    // declined, and the whole point of the alias step is that declining is
    // possible. It simply does not enter the snapshot.
    if (!candidate.confirmed) continue;

    const alias = normalizeGeoText(candidate.alias);
    const rejection = rejectGeoAlias(alias, seen);
    if (rejection !== null) {
      rejections.push(rejection);
      continue;
    }
    seen.add(normalizeAliasForMatch(alias));
    confirmed.push({ alias, source: candidate.source });
  }

  if (confirmed.length > GEO_MAX_BRAND_ALIASES) {
    rejections.push("alias_too_many");
    return confirmed.slice(0, GEO_MAX_BRAND_ALIASES);
  }
  if (confirmed.length === 0 && !rejections.includes("alias_invalid")) {
    rejections.push("aliases_none_confirmed");
  }
  return confirmed;
}

/**
 * Turn confirmed input into an immutable snapshot, or say exactly why not.
 *
 * The clock is injected and read once, here, so the timestamp is the only part
 * of the snapshot that a second confirmation of identical content can change —
 * and the fingerprint, which excludes it, stays the same. Nothing in this
 * function reaches the network, and nothing it produces is a server-proven
 * fact: `confirmedAt` records that the visitor pressed the button in their own
 * browser, which is a workflow assertion and must never be rendered as
 * verification.
 */
export async function confirmGeoContext(
  input: GeoContextInputV1,
  clock: () => Date,
): Promise<GeoContextConfirmation> {
  const rejections: GeoContextRejection[] = [];

  const targetUrl = normalizeGeoTargetUrl(input.targetUrl);
  const targetHost = targetUrl === null ? null : normalizeGeoHost(targetUrl);
  if (targetUrl === null || targetHost === null) {
    rejections.push("target_url_invalid");
  }

  const productName = bounded(input.productName, MAX_PRODUCT_NAME);
  if (productName === null) rejections.push("product_name_invalid");

  if (input.categoryConfirmed !== true) rejections.push("category_unconfirmed");
  const category = bounded(input.category, MAX_CATEGORY);
  if (category === null) rejections.push("category_invalid");

  const buyer = bounded(input.buyer, MAX_BUYER);
  if (buyer === null) rejections.push("buyer_invalid");

  const brandAliases = validateAliases(input.brandAliases, rejections);

  const marketCode =
    typeof input.marketCode === "string" ? input.marketCode.trim() : "";
  if (marketCode.length === 0) {
    rejections.push("market_missing");
  } else if (!ISO_3166_ALPHA2.has(marketCode)) {
    // No US fallback, deliberately. Defaulting a missing market to the market
    // the calibration happened to use would silently sell an uncalibrated run
    // as a calibrated one.
    rejections.push("market_not_a_country");
  }

  if (input.targetQueryLanguage !== "en") {
    rejections.push("query_language_unsupported");
  }

  const user = boundedOrEmpty(input.user, MAX_SENTENCE);
  const jtbd = boundedOrEmpty(input.jtbd, MAX_SENTENCE);
  const useCases = boundedList(input.useCases, MAX_LIST_ITEMS, MAX_LIST_ITEM);
  const outcomes = boundedList(input.outcomes, MAX_LIST_ITEMS, MAX_LIST_ITEM);
  const barriers = boundedList(input.barriers, MAX_LIST_ITEMS, MAX_LIST_ITEM);
  const directCompetitors = boundedList(
    input.directCompetitors,
    MAX_COMPETITORS,
    MAX_LIST_ITEM,
  );
  const indirectAlternatives = boundedList(
    input.indirectAlternatives,
    MAX_COMPETITORS,
    MAX_LIST_ITEM,
  );
  if (
    user === null ||
    jtbd === null ||
    useCases === null ||
    outcomes === null ||
    barriers === null ||
    directCompetitors === null ||
    indirectAlternatives === null
  ) {
    rejections.push("list_value_invalid");
  }

  const sourceProfileVersion = bounded(input.sourceProfileVersion, 64);
  if (sourceProfileVersion === null) rejections.push("profile_version_invalid");

  const sourceSummary = input.sourceSummary;
  if (
    !Array.isArray(sourceSummary) ||
    sourceSummary.length === 0 ||
    sourceSummary.length > MAX_SOURCE_ENTRIES ||
    hasArrayHole(sourceSummary) ||
    !sourceSummary.every((entry) => isSourceEntry(entry))
  ) {
    rejections.push("source_summary_invalid");
  }

  if (rejections.length > 0) {
    return { ok: false, rejections: [...new Set(rejections)] };
  }

  // The clock is read exactly once, here. Reading it again inside the hash
  // helper — or hashing the timestamp — would mean the same confirmed content
  // produced a different fingerprint every second, and the fingerprint's whole
  // job is to say "this is the same eight facts you confirmed".
  const draft: GeoContextSnapshotV1 = {
    schemaVersion: GEO_CONTEXT_SCHEMA_VERSION,
    targetUrl: targetUrl!,
    targetHost: targetHost!,
    productName: productName!,
    brandAliases,
    category: category!,
    buyer: buyer!,
    user: user!,
    jtbd: jtbd!,
    useCases: useCases!,
    outcomes: outcomes!,
    barriers: barriers!,
    directCompetitors: directCompetitors!,
    indirectAlternatives: indirectAlternatives!,
    marketCode,
    targetQueryLanguage: "en",
    sourceProfileVersion: sourceProfileVersion!,
    // Each entry copied, not just the array: sharing the caller's objects means
    // a later mutation changes the snapshot while its fingerprint still
    // describes the old value.
    sourceSummary: sourceSummary.map((entry) => ({
      field: entry.field,
      source: entry.source,
      limitationCode: entry.limitationCode,
    })),
    confirmedAt: clock().toISOString(),
    contextHash: "",
  };

  const contextHash = await geoContextHash(draft);
  return { ok: true, snapshot: { ...draft, contextHash } };
}

type UnknownObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SNAPSHOT_KEYS = [
  "schemaVersion",
  "targetUrl",
  "targetHost",
  "productName",
  "brandAliases",
  "category",
  "buyer",
  "user",
  "jtbd",
  "useCases",
  "outcomes",
  "barriers",
  "directCompetitors",
  "indirectAlternatives",
  "marketCode",
  "targetQueryLanguage",
  "sourceProfileVersion",
  "sourceSummary",
  "confirmedAt",
  "contextHash",
] as const;

/**
 * Validate a snapshot that arrived over the wire.
 *
 * Shape only. The hash is recomputed separately by the server before it claims
 * a budget, because that check is async and this guard is called from
 * synchronous paths on both sides of the wire.
 */
export function isGeoContextSnapshotV1(
  value: unknown,
): value is GeoContextSnapshotV1 {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== SNAPSHOT_KEYS.length ||
    !SNAPSHOT_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    return false;
  }
  if (
    value.schemaVersion !== GEO_CONTEXT_SCHEMA_VERSION ||
    value.targetQueryLanguage !== "en" ||
    !isGeoDigest(value.contextHash) ||
    typeof value.marketCode !== "string" ||
    !ISO_3166_ALPHA2.has(value.marketCode) ||
    typeof value.targetUrl !== "string" ||
    normalizeGeoCitationUrl(value.targetUrl) !== value.targetUrl ||
    typeof value.targetHost !== "string" ||
    normalizeGeoHost(value.targetUrl) !== value.targetHost ||
    bounded(value.productName, MAX_PRODUCT_NAME) !== value.productName ||
    bounded(value.category, MAX_CATEGORY) !== value.category ||
    bounded(value.buyer, MAX_BUYER) !== value.buyer ||
    bounded(value.sourceProfileVersion, 64) !== value.sourceProfileVersion ||
    // `new Date(NaN).toISOString()` throws, so the parse is checked before the
    // round trip. A malformed timestamp must make the guard answer "no", not
    // turn pre-billing validation into a 500.
    !isCanonicalIsoTimestamp(value.confirmedAt)
  ) {
    return false;
  }

  if (
    !Array.isArray(value.brandAliases) ||
    value.brandAliases.length === 0 ||
    value.brandAliases.length > GEO_MAX_BRAND_ALIASES
  ) {
    return false;
  }
  const aliasKeys = ["alias", "source"];
  const seenAliases = new Set<string>();
  for (const entry of value.brandAliases) {
    if (
      !isObject(entry) ||
      Object.keys(entry).length !== aliasKeys.length ||
      !aliasKeys.every((key) => Object.hasOwn(entry, key)) ||
      typeof entry.alias !== "string" ||
      (entry.source !== "profile_product_name" &&
        entry.source !== "host_label" &&
        entry.source !== "user_edit")
    ) {
      return false;
    }
    // The producer's own rule, not a looser one. A guard that admitted aliases
    // `confirmGeoContext` refuses is a guard that lets a hand-built payload buy
    // eighteen answers scored against a generic word.
    if (rejectGeoAlias(entry.alias, seenAliases) !== null) return false;
    seenAliases.add(normalizeAliasForMatch(entry.alias));
  }

  const lists: readonly [unknown, number, number][] = [
    [value.useCases, MAX_LIST_ITEMS, MAX_LIST_ITEM],
    [value.outcomes, MAX_LIST_ITEMS, MAX_LIST_ITEM],
    [value.barriers, MAX_LIST_ITEMS, MAX_LIST_ITEM],
    [value.directCompetitors, MAX_COMPETITORS, MAX_LIST_ITEM],
    [value.indirectAlternatives, MAX_COMPETITORS, MAX_LIST_ITEM],
  ];
  for (const [list, maxItems, maxItem] of lists) {
    const parsed = boundedList(list, maxItems, maxItem);
    if (parsed === null) return false;
    if (parsed.length !== (list as readonly unknown[]).length) return false;
  }

  if (
    boundedOrEmpty(value.user, MAX_SENTENCE) !== value.user ||
    boundedOrEmpty(value.jtbd, MAX_SENTENCE) !== value.jtbd
  ) {
    return false;
  }

  // A provenance record that may be empty is a provenance record that can be
  // omitted, and the whole point of showing sources before payment is that the
  // visitor sees where each fact came from.
  return (
    Array.isArray(value.sourceSummary) &&
    value.sourceSummary.length > 0 &&
    value.sourceSummary.length <= MAX_SOURCE_ENTRIES &&
    !hasArrayHole(value.sourceSummary) &&
    value.sourceSummary.every((entry) => isSourceEntry(entry))
  );
}

/**
 * Propose alias candidates, every one of them unconfirmed.
 *
 * Two sources, kept apart because they are different kinds of evidence: the
 * product name is something the visitor declared, and the hostname label is
 * something this code guessed from a URL. Neither becomes a fact by being
 * proposed — `confirmed` starts false on both, and the confirmation step is
 * per alias rather than per set, because "yes, we are also called Acme" and
 * "yes, our product is called Acme Analytics" are separate answers.
 */
export function proposeGeoAliasCandidates(
  targetUrl: string,
  productName: string,
): readonly GeoAliasCandidateV1[] {
  const candidates: GeoAliasCandidateV1[] = [];
  const seen = new Set<string>();

  const push = (raw: string, source: GeoAliasSource): void => {
    const alias = normalizeGeoText(raw);
    if (alias.length === 0) return;
    const key = normalizeAliasForMatch(alias);
    if (key.length < GEO_MIN_ALIAS_TOKEN_LENGTH || seen.has(key)) return;
    if (!key.includes(" ") && GENERIC_ALIAS_WORDS.has(key)) return;
    seen.add(key);
    candidates.push({ alias, source, confirmed: false });
  };

  push(productName, "profile_product_name");

  const host = normalizeGeoHost(targetUrl);
  if (host !== null) {
    const label = host.split(".")[0] ?? "";
    push(label, "host_label");
  }

  return candidates.slice(0, GEO_MAX_BRAND_ALIASES);
}

/**
 * The provenance table the visitor sees before paying, as codes.
 *
 * Every entry answers "where did this come from", and the limitation column
 * answers "what does that not prove". Codes rather than sentences: localized
 * copy renders from these outside the contract, so translating the UI cannot
 * change the context fingerprint.
 */
export function buildGeoContextSourceSummary(fields: {
  readonly hasCompetitors: boolean;
  readonly hasJtbd: boolean;
  readonly aliasSources: readonly GeoAliasSource[];
}): readonly GeoContextSourceEntryV1[] {
  const usedHostLabel = fields.aliasSources.includes("host_label");
  return [
    { field: "target_url", source: "visitor_url", limitationCode: null },
    {
      field: "product_name",
      source: "visitor_declared",
      limitationCode: "not_independently_checked",
    },
    {
      field: "category",
      source: "visitor_confirmed",
      limitationCode: "no_profile_source_exists",
    },
    {
      field: "buyer",
      source: "visitor_declared",
      limitationCode: "not_independently_checked",
    },
    {
      field: "brand_aliases",
      source: usedHostLabel
        ? "visitor_confirmed_with_inference"
        : "visitor_confirmed",
      limitationCode: usedHostLabel ? "hostname_label_inferred" : null,
    },
    {
      field: "direct_competitors",
      source: fields.hasCompetitors ? "visitor_declared" : "not_supplied",
      limitationCode: fields.hasCompetitors ? null : "not_supplied",
    },
    {
      field: "jtbd",
      source: fields.hasJtbd ? "visitor_declared" : "not_supplied",
      limitationCode: fields.hasJtbd ? null : "not_supplied",
    },
    {
      field: "market_code",
      source: "visitor_confirmed",
      limitationCode: "calibrated_for_us_only",
    },
    {
      field: "target_query_language",
      source: "product_constraint",
      limitationCode: "english_only_in_p0",
    },
  ];
}
