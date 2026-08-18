import type {
  SeoAuditCoverage,
  SeoAuditPage,
  SeoAuditPayload,
  SeoAuditRecord,
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

function isRecordPopulation(value: unknown): boolean {
  return (
    value === "every_collected_page" ||
    value === "conditional_subset" ||
    value === "site_resource"
  );
}

export function isSeoAuditRecord(value: unknown): value is SeoAuditRecord {
  if (!isObject(value)) return false;
  if (
    typeof value.id !== "string" ||
    ![
      "crawl",
      "indexability",
      "metadata",
      "structure",
      "links",
      "structured_data",
    ].includes(value.category as string) ||
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
  "staticBodyUnits",
  "termFrequencies",
  "truncatedLists",
  "response",
  "declared",
];

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

const IMAGE_FACTS_KEYS: readonly string[] = [
  "total",
  "withAlt",
  "withEmptyAlt",
  "withoutAlt",
  "withDimensions",
  "lazyLoaded",
];

function isImageFacts(value: unknown): boolean {
  return (
    isObject(value) &&
    hasExactly(value, IMAGE_FACTS_KEYS) &&
    IMAGE_FACTS_KEYS.every((key) => isNonNegativeInteger(value[key]))
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
function isTermTables(value: unknown): boolean {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length > 5) return false;
  return value.every((table) => {
    if (!isObject(table) || !hasExactly(table, ["size", "rows"])) return false;
    if (
      typeof table.size !== "number" ||
      !Number.isSafeInteger(table.size) ||
      table.size < 1 ||
      table.size > 5
    ) {
      return false;
    }
    return (
      Array.isArray(table.rows) &&
      table.rows.length <= 15 &&
      table.rows.every(
        (row) =>
          isObject(row) &&
          hasExactly(row, ["phrase", "count"]) &&
          typeof row.phrase === "string" &&
          characterLength(row.phrase) <= 120 &&
          isNonNegativeInteger(row.count),
      )
    );
  });
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
    isTermTables(value.termFrequencies) &&
    typeof value.truncatedLists === "boolean" &&
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
    run.schemaVersion === "seo_audit.sitewide.v7" &&
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
