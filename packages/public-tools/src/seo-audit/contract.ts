import type {
  SeoAuditCoverage,
  SeoAuditPage,
  SeoAuditPayload,
  SeoAuditRecord,
  SeoAuditSiteResources,
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

const CANONICAL_ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
    (value.state === "observed"
      ? value.affected > 0
      : value.affected === 0)
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
    (value.initialStatus === null || isNonNegativeInteger(value.initialStatus)) &&
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

/** Runtime authority for the current buffered site-wide SEO audit payload. */
export function isSeoAuditPayload(value: unknown): value is SeoAuditPayload {
  if (!isObject(value) || !isObject(value.run) || !isObject(value.result)) {
    return false;
  }

  const { run, result } = value;
  return (
    run.tool === "seo_audit" &&
    run.schemaVersion === "seo_audit.sitewide.v3" &&
    run.mode === "public_preview" &&
    run.scope === "discoverable_same_origin_static_html_audit" &&
    run.persistence === "none" &&
    isCanonicalIsoTimestamp(run.completedAt) &&
    typeof result.targetUrl === "string" &&
    typeof result.siteOrigin === "string" &&
    isCanonicalIsoTimestamp(result.scannedAt) &&
    isCoverage(result.coverage) &&
    isSiteResources(result.siteResources) &&
    Array.isArray(result.records) &&
    result.records.every(isSeoAuditRecord) &&
    Array.isArray(result.pages) &&
    result.pages.every(isSeoAuditPage)
  );
}
