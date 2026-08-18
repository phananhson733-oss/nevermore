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

  return (
    value.affected === value.observations.length &&
    value.affected <= value.tested &&
    (value.state === "observed" ? value.affected > 0 : value.affected === 0)
  );
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
    typeof value.sitemapFetched === "boolean"
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
  "truncatedLists",
];

function isBoundedStringList(
  value: unknown,
  maxEntries: number,
  maxChars: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxEntries &&
    value.every((entry) => typeof entry === "string" && entry.length <= maxChars)
  );
}

function isBoundedNullableString(
  value: unknown,
  maxChars: number,
): value is string | null {
  return (
    value === null || (typeof value === "string" && value.length <= maxChars)
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
function isTargetPageExtract(
  value: unknown,
): value is SeoAuditTargetPageExtract {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== TARGET_PAGE_EXTRACT_KEYS.length) return false;
  if (keys.some((key) => !TARGET_PAGE_EXTRACT_KEYS.includes(key))) return false;

  return (
    typeof value.url === "string" &&
    value.url.length <= 2_048 &&
    isBoundedNullableString(value.title, 512) &&
    isBoundedNullableString(value.metaDescription, 2_048) &&
    isBoundedStringList(value.h1, 10, 200) &&
    (value.subHeadings === null ||
      isBoundedStringList(value.subHeadings, 60, 200)) &&
    isBoundedNullableString(value.openingText, 500) &&
    (value.staticBodyWords === null ||
      isNonNegativeInteger(value.staticBodyWords)) &&
    typeof value.truncatedLists === "boolean"
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
    run.schemaVersion === "seo_audit.sitewide.v5" &&
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
      isTargetPageExtract(result.targetPageExtract)) &&
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
