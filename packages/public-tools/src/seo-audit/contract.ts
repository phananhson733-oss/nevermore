// The narrow subpath, never the `@sf/sources` barrel. This module is reachable
// from the client bundle, and the barrel drags the crawler in with it — which
// puts `node:net` in a browser chunk and fails `pnpm build` with an error that
// names a different file. Unit tests and typecheck both stay green.
import { CRAWL_PROJECTION_LIMITS } from "@sf/sources/crawl-limits";

import { SITEMAP_URLS_PUBLISHED_CAP } from "./types.ts";

import type {
  SeoAuditCoverage,
  SeoAuditPage,
  SeoAuditPayload,
  SeoAuditRecord,
  SeoAuditRecordPopulation,
  SeoAuditSiteResources,
  SeoAuditTargetPageExtract,
} from "./types.ts";

type UnknownObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isHttpResponseStatus(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 100 &&
    (value as number) < 600
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Accept only the UTC millisecond form emitted by `Date#toISOString`. */
export function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_ISO_TIMESTAMP.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function isEvidenceValue(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

type EvidenceEntry = Readonly<{
  label: string;
  value: string | number | boolean | null;
}>;

type RecordObservation = Readonly<{
  url: string | null;
  values: readonly EvidenceEntry[];
}>;

type AggregateRecordCandidate = Readonly<{
  id: string;
  category: string;
  state: string;
  unit: string;
  population: string;
  targetTested: boolean | null;
  tested: number;
  affected: number;
  observations: readonly RecordObservation[];
  limitation: string | null;
}>;

/**
 * Every population value, proved complete at compile time.
 *
 * A `Record` keyed by the union rather than an array of strings, because an
 * array only proves there are no extras — adding a member to the type left this
 * list short and the wire guard silently refused every region that used the new
 * value. `satisfies` would not have caught it either, for the same reason.
 * Adding a member to `SeoAuditRecordPopulation` now fails the build here.
 */
const RECORD_POPULATIONS: Readonly<Record<SeoAuditRecordPopulation, true>> = {
  every_collected_page: true,
  conditional_subset: true,
  site_resource: true,
  target_page: true,
};

function isRecordPopulation(value: unknown): boolean {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(RECORD_POPULATIONS, value)
  );
}

/** Categories a crawl payload may carry. */
const CRAWL_CATEGORIES = [
  "crawl",
  "indexability",
  "metadata",
  "structure",
  "links",
  "structured_data",
  // `search_performance`, `keyword_evidence`, `page_performance` and
  // `serp_shape` are deliberately absent. A
  // crawl payload is cached by host and shared across visitors, while both of
  // those belong to one visitor — an authorized property, a typed-in query.
  // Refusing the categories here is what stops such a record from ever
  // reaching a shared cache row.
] as const;

export function isSeoAuditRecord(value: unknown): value is SeoAuditRecord {
  return isRecordOfCategory(value, CRAWL_CATEGORIES);
}

/**
 * The same shape, for the one category a crawl payload must never carry.
 *
 * Split rather than widened: reusing `isSeoAuditRecord` for the per-visitor
 * search region meant every real region was refused by the guard meant to
 * protect it, and widening it would delete the cache boundary instead.
 */
export function isSearchPerformanceRecord(
  value: unknown,
): value is SeoAuditRecord {
  return isRecordOfCategory(value, ["search_performance"]);
}

/** The same, for the region derived from one visitor's confirmed queries. */
export function isKeywordEvidenceRecord(
  value: unknown,
): value is SeoAuditRecord {
  return isRecordOfCategory(value, ["keyword_evidence"]);
}

/** The same, for the CrUX field region fetched per run against one URL. */
export function isPagePerformanceRecord(
  value: unknown,
): value is SeoAuditRecord {
  return isRecordOfCategory(value, ["page_performance"]);
}

/** The same, for the one live results-page sample a run may take. */
export function isSerpShapeRecord(value: unknown): value is SeoAuditRecord {
  return isRecordOfCategory(value, ["serp_shape"]);
}

function hasExactEvidenceLabels(
  values: readonly EvidenceEntry[],
  labels: readonly string[],
): boolean {
  return (
    values.length === labels.length &&
    labels.every((label, index) => values[index]?.label === label)
  );
}

function evidenceValue(
  observation: RecordObservation,
  label: string,
): string | number | boolean | null | undefined {
  return observation.values.find((entry) => entry.label === label)?.value;
}

function isAbandonedUrlImpressionShareRecord(
  value: AggregateRecordCandidate,
): boolean {
  if (value.id !== "abandoned_url_impression_share") return false;
  if (
    value.category !== "search_performance" ||
    value.state !== "observed" ||
    value.unit !== "pages" ||
    value.population !== "every_collected_page" ||
    value.targetTested !== null ||
    value.tested === 0 ||
    value.affected > value.tested ||
    value.observations.length !== value.affected + 1 ||
    value.limitation !==
      "abandoned_share_counts_only_urls_this_crawl_fetched_and_resolved"
  ) {
    return false;
  }

  const [aggregate, ...details] =
    value.observations as readonly RecordObservation[];
  if (
    aggregate === undefined ||
    typeof aggregate.url !== "string" ||
    aggregate.url.length === 0 ||
    !hasExactEvidenceLabels(aggregate.values, [
      "abandoned_url_impression_share",
      "impressions_in_band",
      "impressions_total",
      "property",
    ])
  ) {
    return false;
  }

  const share = evidenceValue(aggregate, "abandoned_url_impression_share");
  const inBand = evidenceValue(aggregate, "impressions_in_band");
  const total = evidenceValue(aggregate, "impressions_total");
  const property = evidenceValue(aggregate, "property");
  if (
    typeof share !== "number" ||
    !Number.isFinite(share) ||
    share < 0 ||
    share > 1 ||
    !isFiniteNonNegativeNumber(inBand) ||
    !isFiniteNonNegativeNumber(total) ||
    inBand > total ||
    typeof property !== "string" ||
    property.length === 0 ||
    property !== aggregate.url
  ) {
    return false;
  }

  return details.every(
    (observation) =>
      typeof observation.url === "string" &&
      observation.url.length > 0 &&
      hasExactEvidenceLabels(observation.values, [
        "impressions",
        "final_status",
      ]) &&
      isFiniteNonNegativeNumber(evidenceValue(observation, "impressions")) &&
      isHttpResponseStatus(evidenceValue(observation, "final_status")),
  );
}

const INDEX_STATUS_VERDICTS: Readonly<Record<string, true>> = {
  VERDICT_UNSPECIFIED: true,
  PARTIAL: true,
  FAIL: true,
  NEUTRAL: true,
};

function isSitemapUrlNotIndexedRecord(
  value: AggregateRecordCandidate,
): boolean {
  if (value.id !== "sitemap_url_not_indexed") return false;
  if (
    value.category !== "search_performance" ||
    value.state !== "observed" ||
    value.unit !== "pages" ||
    value.population !== "site_resource" ||
    value.targetTested !== null ||
    value.tested === 0 ||
    value.affected > value.tested ||
    value.observations.length !== value.affected + 1 ||
    value.limitation !==
      "index_status_is_googles_own_verdict_per_declared_url"
  ) {
    return false;
  }

  const [aggregate, ...details] =
    value.observations as readonly RecordObservation[];
  if (
    aggregate === undefined ||
    aggregate.url !== null ||
    !hasExactEvidenceLabels(aggregate.values, [
      "index_coverage_rate",
      "sitemap_urls_inspected",
    ])
  ) {
    return false;
  }

  const coverageRate = evidenceValue(aggregate, "index_coverage_rate");
  const inspected = evidenceValue(aggregate, "sitemap_urls_inspected");
  if (
    typeof coverageRate !== "number" ||
    !Number.isFinite(coverageRate) ||
    coverageRate < 0 ||
    coverageRate > 1 ||
    inspected !== value.tested
  ) {
    return false;
  }

  return details.every((observation) => {
    const verdict = evidenceValue(observation, "index_status_verdict");
    return (
      typeof observation.url === "string" &&
      observation.url.length > 0 &&
      hasExactEvidenceLabels(observation.values, ["index_status_verdict"]) &&
      typeof verdict === "string" &&
      Object.prototype.hasOwnProperty.call(INDEX_STATUS_VERDICTS, verdict)
    );
  });
}

function isAggregateBackedObservedRecord(
  value: AggregateRecordCandidate,
): boolean {
  return (
    isAbandonedUrlImpressionShareRecord(value) ||
    isSitemapUrlNotIndexedRecord(value)
  );
}

function isAggregateBackedRecordId(id: string): boolean {
  return (
    id === "abandoned_url_impression_share" || id === "sitemap_url_not_indexed"
  );
}

function isRecordOfCategory(
  value: unknown,
  categories: readonly string[],
): value is SeoAuditRecord {
  if (!isObject(value)) return false;
  if (
    typeof value.id !== "string" ||
    !categories.includes(value.category as string) ||
    !["observed", "not_observed", "unverified"].includes(
      value.state as string,
    ) ||
    !["pages", "link_targets", "site_resource"].includes(
      value.unit as string,
    ) ||
    !isRecordPopulation(value.population) ||
    !isNonNegativeInteger(value.tested) ||
    !(value.targetTested === null || typeof value.targetTested === "boolean") ||
    !isNonNegativeInteger(value.affected) ||
    !Array.isArray(value.observations) ||
    !isNullableString(value.limitation)
  ) {
    return false;
  }

  const observationsAreValid = value.observations.every((observation) => {
    if (
      !isObject(observation) ||
      !isNullableString(observation.url) ||
      !Array.isArray(observation.values)
    ) {
      return false;
    }
    return observation.values.every(
      (entry) =>
        isObject(entry) &&
        typeof entry.label === "string" &&
        isEvidenceValue(entry.value),
    );
  });

  if (!observationsAreValid) return false;

  const record: AggregateRecordCandidate = {
    id: value.id as string,
    category: value.category as string,
    state: value.state as string,
    unit: value.unit as string,
    population: value.population as string,
    targetTested: value.targetTested as boolean | null,
    tested: value.tested as number,
    affected: value.affected as number,
    observations: value.observations as readonly RecordObservation[],
    limitation: value.limitation as string | null,
  };
  const genericInvariant =
    value.affected <= value.tested &&
    value.affected === value.observations.length &&
    (value.state === "observed" ? value.affected > 0 : value.affected === 0);

  if (isAggregateBackedRecordId(record.id)) {
    const isSearchPerformanceGuard =
      categories.length === 1 &&
      categories[0] === "search_performance" &&
      record.category === "search_performance";
    if (!isSearchPerformanceGuard) return false;
    if (record.state === "unverified") return genericInvariant;
    return (
      record.state === "observed" && isAggregateBackedObservedRecord(record)
    );
  }

  return genericInvariant;
}

function isCoverage(value: unknown): value is SeoAuditCoverage {
  if (!isObject(value)) return false;
  return (
    ["available", "partial", "unavailable"].includes(
      value.availability as string,
    ) &&
    isNonNegativeInteger(value.pagesInspected) &&
    isNonNegativeInteger(value.linksObserved) &&
    isNonNegativeInteger(value.sitemapUrlsObserved) &&
    isNonNegativeInteger(value.urlsSkipped) &&
    isNonNegativeInteger(value.urlsBlocked) &&
    isNonNegativeInteger(value.urlsDisallowed) &&
    isNonNegativeInteger(value.urlsErrored) &&
    isNullableString(value.stopReason)
  );
}

function isSiteResources(value: unknown): value is SeoAuditSiteResources {
  if (!isObject(value)) return false;
  return (
    typeof value.robotsFetched === "boolean" &&
    isNonNegativeInteger(value.robotsGroupsObserved) &&
    isNonNegativeInteger(value.sitemapReferencesObserved) &&
    typeof value.sitemapFetched === "boolean" &&
    isBoundedStringList(
      value.sitemapUrls,
      SITEMAP_URLS_PUBLISHED_CAP,
      CRAWL_PROJECTION_LIMITS.maxUrlChars,
    ) &&
    typeof value.sitemapUrlsComplete === "boolean"
  );
}

function isSeoAuditPage(value: unknown): value is SeoAuditPage {
  if (!isObject(value)) return false;
  return (
    typeof value.url === "string" &&
    typeof value.subjectUrl === "string" &&
    typeof value.finalUrl === "string" &&
    isNonNegativeInteger(value.depth) &&
    (value.initialStatus === null ||
      isNonNegativeInteger(value.initialStatus)) &&
    (value.finalStatus === null || isNonNegativeInteger(value.finalStatus)) &&
    isNonNegativeInteger(value.redirectHops) &&
    isNullableString(value.contentType) &&
    (value.robotsDirectiveState === null ||
      value.robotsDirectiveState === "noindex_observed" ||
      value.robotsDirectiveState === "noindex_not_observed") &&
    isNullableString(value.canonicalTarget) &&
    isNullableString(value.title) &&
    isNullableString(value.metaDescription) &&
    isNonNegativeInteger(value.h1Count) &&
    isNonNegativeInteger(value.headingsCount) &&
    (value.wordCount === null || isNonNegativeInteger(value.wordCount)) &&
    isNonNegativeInteger(value.inboundLinks) &&
    isNonNegativeInteger(value.outboundLinks) &&
    typeof value.sitemapMember === "boolean" &&
    Array.isArray(value.jsonLdTypes) &&
    value.jsonLdTypes.every((entry) => typeof entry === "string") &&
    isNonNegativeInteger(value.jsonLdErrorCount)
  );
}

/**
 * Runtime authority for the target page extract.
 *
 * Checks every field for real. A guard that accepted the shape without reading
 * it would let a payload through whose text fields are missing, and the
 * keyword layer would then report "not covered" for a page it never read.
 */
const TARGET_PAGE_EXTRACT_KEYS: readonly string[] = [
  "url",
  "title",
  "metaDescription",
  "h1",
  "subHeadings",
  "openingText",
  "staticBodyWords",
  "staticBodyUnits",
  "termFrequencies",
  "truncatedLists",
  "response",
  "declared",

  "headingLevels",
  "wordsUnderEachH3",];

/**
 * Characters, counted the way the producer counts them.
 *
 * The crawl projection bounds its strings with `boundChars`, which slices by
 * Unicode code point so a cut never orphans a surrogate half. These guards used
 * `.length`, which counts UTF-16 code units. One astral character — any emoji —
 * is 1 to the producer and 2 to the checker, and `boundChars` returns a string
 * untouched once its code points fit, so an emoji-dense value ships at up to
 * twice the bound and is then refused here.
 *
 * That is not a dead cache. `isSeoAuditPayload` also gates the Agent response,
 * so a rocket emoji in a hero headline turned the whole tool into a 502 for
 * that page. Same seam, same shape as the timestamp disagreement before it:
 * both sides individually right, no test between them.
 */
function characterLength(value: string): number {
  return [...value].length;
}

function isBoundedStringList(
  value: unknown,
  maxEntries: number,
  maxChars: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxEntries &&
    value.every(
      (entry) => typeof entry === "string" && characterLength(entry) <= maxChars,
    )
  );
}

function isBoundedNullableString(
  value: unknown,
  maxChars: number,
): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && characterLength(value) <= maxChars)
  );
}

/**
 * Runtime authority for the target page extract.
 *
 * The key set is exact and every value is bounded. A shape check alone would
 * let an upstream or cached payload carry an extra field — page HTML, a debug
 * dump, anything the crawler happened to hold — straight through the Agent
 * projection to the browser, and would let one enormous heading become the
 * whole response.
 */

const RESPONSE_FACTS_KEYS: readonly string[] = [
  "status",
  "finalStatus",
  "redirectHops",
  "responseMs",
  "contentType",
  "canonicalTarget",
  "robotsIndexable",
  "robotsDirectives",
  "sitemapMember",
  "jsonLdTypes",
  "jsonLdErrorCount",
  "internalOutlinks",
  "internalOutlinksWithoutAnchorText",
];

const DECLARED_FACTS_KEYS: readonly string[] = [
  "lang",
  "openGraph",
  "twitterCard",
  "viewport",
  "charset",
  "faviconDeclared",
  "hreflang",
  "images",
  "externalLinks",
  "htmlBytes",
  "visibleTextBytes",
  "scriptBytes",
  "interactive",
];

function hasExactly(value: object, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return (
    own.length === keys.length && own.every((key) => keys.includes(key))
  );
}

function isNullableStatus(value: unknown): boolean {
  return value === null || isNonNegativeInteger(value);
}

function isResponseFacts(value: unknown): boolean {
  if (!isObject(value) || !hasExactly(value, RESPONSE_FACTS_KEYS)) return false;
  return (
    isNullableStatus(value.status) &&
    isNullableStatus(value.finalStatus) &&
    isNonNegativeInteger(value.redirectHops) &&
    isNullableStatus(value.responseMs) &&
    isBoundedNullableString(value.contentType, 256) &&
    isBoundedNullableString(value.canonicalTarget, 2_048) &&
    typeof value.robotsIndexable === "boolean" &&
    isBoundedStringList(value.robotsDirectives, 32, 128) &&
    typeof value.sitemapMember === "boolean" &&
    isBoundedStringList(value.jsonLdTypes, 100, 256) &&
    isNonNegativeInteger(value.jsonLdErrorCount) &&
    isNonNegativeInteger(value.internalOutlinks) &&
    isNonNegativeInteger(value.internalOutlinksWithoutAnchorText)
  );
}

/** The counted facts. `first` is not one of them — it is not a number. */
const IMAGE_COUNT_KEYS: readonly string[] = [
  "total",
  "withAlt",
  "withEmptyAlt",
  "withoutAlt",
  "withDimensions",
  "lazyLoaded",
];

const IMAGE_FACTS_KEYS: readonly string[] = [
  ...IMAGE_COUNT_KEYS,
  "first",
  "sources",
];

const FIRST_IMAGE_KEYS: readonly string[] = ["lazyLoaded", "width", "height"];

function isFirstImage(value: unknown): boolean {
  if (value === null) return true;
  return (
    isObject(value) &&
    hasExactly(value, FIRST_IMAGE_KEYS) &&
    typeof value["lazyLoaded"] === "boolean" &&
    (value["width"] === null || isNonNegativeInteger(value["width"])) &&
    (value["height"] === null || isNonNegativeInteger(value["height"]))
  );
}

function isImageFacts(value: unknown): boolean {
  return (
    isObject(value) &&
    hasExactly(value, IMAGE_FACTS_KEYS) &&
    IMAGE_COUNT_KEYS.every((key) => isNonNegativeInteger(value[key])) &&
    isFirstImage(value["first"]) &&
    // The parser's own caps, not a second copy of them: a guard that hard-codes
    // the numbers passes a payload the parser can no longer produce, and fails
    // one it can, the moment either cap moves.
    isBoundedStringList(
      value["sources"],
      CRAWL_PROJECTION_LIMITS.maxImages,
      CRAWL_PROJECTION_LIMITS.maxUrlChars,
    )
  );
}

const INTERACTIVE_FACTS_KEYS: readonly string[] = [
  "forms",
  "inputs",
  "buttons",
  "selects",
  "textareas",
  "canvases",
  "media",
  "iframes",
];

function isInteractiveFacts(value: unknown): boolean {
  return (
    isObject(value) &&
    hasExactly(value, INTERACTIVE_FACTS_KEYS) &&
    INTERACTIVE_FACTS_KEYS.every((key) => isNonNegativeInteger(value[key]))
  );
}

/**
 * The repeated-phrase tables, bounded exactly as the builder bounds them.
 *
 * Five tables at most, fifteen rows each, and a phrase no longer than the
 * builder's own cap. Everything the target extract carries is bounded, because
 * this guard is what stands between a cached payload and a browser.
 */
function isTermTables(value: unknown, totalUnits: number | null): boolean {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length > 5) return false;
  const sizes: number[] = [];
  for (const table of value) {
    if (!isObject(table) || !hasExactly(table, ["size", "rows"])) return false;
    if (
      typeof table.size !== "number" ||
      !Number.isSafeInteger(table.size) ||
      table.size < 1 ||
      table.size > 5 ||
      // One table per length, in order. Two tables claiming the same size are
      // not a shape this builder can produce, and they render as duplicate
      // React keys on the way out.
      sizes.includes(table.size) ||
      (sizes.length > 0 && table.size <= (sizes.at(-1) ?? 0))
    ) {
      return false;
    }
    sizes.push(table.size);
    // A phrase of `size` units cannot occur more times than there are windows
    // of that length in the body. Without this a cached row could carry a count
    // of a million against a ten-unit body and the browser would print
    // 10,000,000%.
    const ceiling =
      totalUnits === null ? null : Math.max(0, totalUnits - table.size + 1);
    if (
      !Array.isArray(table.rows) ||
      table.rows.length > 15 ||
      !table.rows.every(
        (row) =>
          isObject(row) &&
          hasExactly(row, ["phrase", "count"]) &&
          typeof row.phrase === "string" &&
          row.phrase.length > 0 &&
          characterLength(row.phrase) <= 120 &&
          isNonNegativeInteger(row.count) &&
          row.count > 0 &&
          (ceiling === null || row.count <= ceiling),
      )
    ) {
      return false;
    }
  }
  return true;
}

/** `text_units.v1`, as published beside the whitespace word count. */
function isNullableTextUnits(value: unknown): boolean {
  if (value === null) return true;
  return (
    isObject(value) &&
    hasExactly(value, ["units", "basis"]) &&
    isNonNegativeInteger(value.units) &&
    ["words", "cjk_chars", "mixed"].includes(value.basis as string)
  );
}

function isExternalLinkFacts(value: unknown): boolean {
  return (
    isObject(value) &&
    hasExactly(value, ["total", "nofollow", "blankWithoutNoopener"]) &&
    isNonNegativeInteger(value.total) &&
    isNonNegativeInteger(value.nofollow) &&
    isNonNegativeInteger(value.blankWithoutNoopener)
  );
}

function isOpenGraphFacts(value: unknown): boolean {
  return (
    isObject(value) &&
    hasExactly(value, ["title", "description", "image"]) &&
    isBoundedNullableString(value.title, 2_048) &&
    isBoundedNullableString(value.description, 2_048) &&
    isBoundedNullableString(value.image, 2_048)
  );
}

function isDeclaredFacts(value: unknown): boolean {
  if (!isObject(value) || !hasExactly(value, DECLARED_FACTS_KEYS)) return false;
  return (
    isBoundedNullableString(value.lang, 128) &&
    isOpenGraphFacts(value.openGraph) &&
    isBoundedNullableString(value.twitterCard, 2_048) &&
    isBoundedNullableString(value.viewport, 2_048) &&
    isBoundedNullableString(value.charset, 2_048) &&
    typeof value.faviconDeclared === "boolean" &&
    isBoundedStringList(value.hreflang, 32, 128) &&
    isImageFacts(value.images) &&
    isExternalLinkFacts(value.externalLinks) &&
    isNonNegativeInteger(value.htmlBytes) &&
    isNonNegativeInteger(value.visibleTextBytes) &&
    isNonNegativeInteger(value.scriptBytes) &&
    isInteractiveFacts(value.interactive)
  );
}

/**
 * Exported so the Agent projection can reuse it rather than restate it.
 *
 * The projection used to carry its own copy of the key list and check nothing
 * else — not types, not bounds, and never inside `response` or `declared`.
 * Measured: `url: 12345` and `response: "not an object"` both passed. Two lists
 * of the same keys also drift, and v7's new fields landed in exactly the region
 * the shallow copy could not see.
 */
export function isSeoAuditTargetPageExtract(
  value: unknown,
): value is SeoAuditTargetPageExtract {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== TARGET_PAGE_EXTRACT_KEYS.length) return false;
  if (keys.some((key) => !TARGET_PAGE_EXTRACT_KEYS.includes(key))) return false;

  return (
    typeof value.url === "string" &&
    characterLength(value.url) <= 2_048 &&
    isBoundedNullableString(value.title, 512) &&
    isBoundedNullableString(value.metaDescription, 2_048) &&
    isBoundedStringList(value.h1, 10, 200) &&
    (value.subHeadings === null ||
      isBoundedStringList(value.subHeadings, 60, 200)) &&
    isBoundedNullableString(value.openingText, 500) &&
    (value.staticBodyWords === null ||
      isNonNegativeInteger(value.staticBodyWords)) &&
    isNullableTextUnits(value.staticBodyUnits) &&
    isTermTables(
      value.termFrequencies,
      isObject(value.staticBodyUnits) &&
        typeof value.staticBodyUnits.units === "number"
        ? value.staticBodyUnits.units
        : null,
    ) &&
    typeof value.truncatedLists === "boolean" &&
    (value.wordsUnderEachH3 === null ||
      (Array.isArray(value.wordsUnderEachH3) &&
        value.wordsUnderEachH3.length <= 200 &&
        value.wordsUnderEachH3.every(
          (words) => typeof words === "number" && Number.isInteger(words) && words >= 0,
        ))) &&
    (value.headingLevels === null ||
      (Array.isArray(value.headingLevels) &&
        value.headingLevels.length <= 100 &&
        value.headingLevels.every(
          (level) =>
            typeof level === "number" &&
            Number.isInteger(level) &&
            level >= 1 &&
            level <= 6,
        ))) &&
    isResponseFacts(value.response) &&
    (value.declared === null || isDeclaredFacts(value.declared))
  );
}


/** Runtime authority for the current buffered site-wide SEO audit payload. */
export function isSeoAuditPayload(value: unknown): value is SeoAuditPayload {
  if (!isObject(value) || !isObject(value.run) || !isObject(value.result)) {
    return false;
  }

  const { run, result } = value;
  return (
    run.tool === "seo_audit" &&
    run.schemaVersion === "seo_audit.sitewide.v17" &&
    run.mode === "public_preview" &&
    run.scope === "discoverable_same_origin_static_html_audit" &&
    run.persistence === "none" &&
    isCanonicalIsoTimestamp(run.completedAt) &&
    typeof result.targetUrl === "string" &&
    typeof result.siteOrigin === "string" &&
    typeof result.targetInspected === "boolean" &&
    (result.inspectedTargetUrl === null ||
      typeof result.inspectedTargetUrl === "string") &&
    (result.targetPageExtract === null ||
      isSeoAuditTargetPageExtract(result.targetPageExtract)) &&
    // The keyword region is derived per request from one visitor's queries.
    // This shape is the one that gets cached under a key shared by every
    // visitor to the same host, so a payload carrying that region is not a
    // valid instance of it: refusing it here makes a poisoned row read as a
    // miss and re-crawl, instead of handing the next visitor someone else's
    // question. Structural typing cannot state this, so the runtime does.
    !Object.hasOwn(result, "keywordEvidence") &&
    isCanonicalIsoTimestamp(result.scannedAt) &&
    isCoverage(result.coverage) &&
    isSiteResources(result.siteResources) &&
    Array.isArray(result.records) &&
    result.records.every(isSeoAuditRecord) &&
    Array.isArray(result.pages) &&
    result.pages.every(isSeoAuditPage)
  );
}
