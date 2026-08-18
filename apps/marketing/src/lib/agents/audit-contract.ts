// @input  -- existing seo_audit.sitewide.v7 envelopes and projected Agent data
// @output -- frozen authenticated Agent API types plus strict client/upstream guards
// @pos    -- shared wire contract for the SEO Agent API and UI, both focuses

import type {
  SeoAuditCategory,
  SeoAuditCoverage,
  SeoAuditPayload,
  SeoAuditReport,
  SeoAuditSiteResources,
} from "@sf/public-tools/seo-audit/types";
/**
 * From the narrow path, never the package barrel.
 *
 * This module is imported by a client component. The barrel re-exports the
 * crawl scanner, so one value import from it pulls `node:net` into the browser
 * bundle — which typecheck and the unit suite both pass, and only the
 * production build catches.
 */
import {
  KEYWORD_EVIDENCE_VERSION,
  TEXT_UNITS_VERSION,
  type KeywordEvidence,
} from "@sf/public-tools/seo-audit/keyword-evidence/types";
import {
  isCanonicalIsoTimestamp,
  isSeoAuditPayload,
  isSeoAuditRecord,
  isSeoAuditTargetPageExtract,
} from "@sf/public-tools/seo-audit/contract";

export { isCanonicalIsoTimestamp };

export type AgentKind = "seo" | "tech";
export type AgentAuditCacheStatus = "hit" | "miss";
export const AGENT_AUDIT_SOURCE_SCHEMA_VERSION =
  "seo_audit.sitewide.v7" as const;
export const AGENT_AUDIT_SOURCE_SCOPE =
  "discoverable_same_origin_static_html_audit" as const;

/** Exact neutral evidence ledger emitted by seo_audit.sitewide.v7. */
export const AGENT_AUDIT_RECORD_CATEGORIES = {
  robots_resource: "crawl",
  sitemap_resource: "crawl",
  non_2xx_final_status: "crawl",
  redirect_chain: "crawl",
  http_url: "crawl",
  noindex_directive: "indexability",
  canonical_missing: "indexability",
  canonical_differs: "indexability",
  title_missing: "metadata",
  title_duplicate: "metadata",
  meta_description_missing: "metadata",
  meta_description_duplicate: "metadata",
  h1_missing: "structure",
  multiple_h1: "structure",
  sitemap_page_without_observed_inlink: "links",
  internal_target_http_error: "links",
  json_ld_parse_error: "structured_data",
  page_outbound_broken_link: "links",
  page_not_in_sitemap: "crawl",
  title_length_outside_range: "metadata",
  meta_description_length_outside_range: "metadata",
  page_without_outbound_internal_link: "links",
  click_depth_beyond_reviewed_limit: "links",
  json_ld_missing: "structured_data",
} as const satisfies Readonly<Record<string, SeoAuditCategory>>;

const AGENT_AUDIT_RECORD_IDS = Object.keys(AGENT_AUDIT_RECORD_CATEGORIES);

export interface AgentAuditSourceProvenance {
  readonly tool: "seo_audit";
  readonly schemaVersion: typeof AGENT_AUDIT_SOURCE_SCHEMA_VERSION;
  readonly completedAt: string;
  readonly cache: {
    readonly status: AgentAuditCacheStatus;
    readonly capturedAt: string | null;
  };
}

export interface AgentAuditRun {
  readonly agent: AgentKind;
  readonly mode: "authenticated_agent";
  readonly persistence: "none";
  readonly source: AgentAuditSourceProvenance;
}

/** The bounded report exposed to Agent clients. Raw crawled page rows stay server-side. */
export type AgentAuditResult = Pick<
  SeoAuditReport,
  | "targetUrl"
  | "siteOrigin"
  | "scannedAt"
  | "targetInspected"
  | "inspectedTargetUrl"
  | "targetPageExtract"
  | "coverage"
  | "siteResources"
  | "records"
> & {
  /**
   * Present only when the caller sent target queries.
   *
   * Deliberately absent from `SeoAuditReport`, which is exactly the cached
   * payload: this region is derived from one visitor's queries, and a shared
   * cache row that carried it would hand the next visitor someone else's
   * question. Deriving it here, per request, makes that impossible to get
   * wrong by accident rather than by discipline.
   */
  readonly keywordEvidence?: KeywordEvidence;
};

export interface AgentAuditSuccessData {
  readonly run: AgentAuditRun;
  readonly result: AgentAuditResult;
}

export interface AgentAuditSuccessEnvelope {
  readonly data: AgentAuditSuccessData;
}

export interface AgentAuditErrorEnvelope<TCode extends string = string> {
  readonly error: { readonly code: TCode };
}

export type AgentAuditResponseEnvelope =
  | AgentAuditSuccessEnvelope
  | AgentAuditErrorEnvelope;

export interface SeoAuditUpstreamSuccessEnvelope {
  readonly data: {
    readonly run: Omit<
      SeoAuditPayload["run"],
      "schemaVersion" | "scope"
    > & {
      readonly schemaVersion: typeof AGENT_AUDIT_SOURCE_SCHEMA_VERSION;
      readonly scope: typeof AGENT_AUDIT_SOURCE_SCOPE;
    };
    readonly result: SeoAuditPayload["result"];
  };
}

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

function hasCompleteNeutralRecordLedger(
  records: readonly SeoAuditReport["records"][number][],
): boolean {
  if (records.length !== AGENT_AUDIT_RECORD_IDS.length) return false;

  const observedIds = new Set<string>();
  for (const record of records) {
    if (
      !Object.hasOwn(AGENT_AUDIT_RECORD_CATEGORIES, record.id) ||
      record.category !==
        AGENT_AUDIT_RECORD_CATEGORIES[
          record.id as keyof typeof AGENT_AUDIT_RECORD_CATEGORIES
        ] ||
      observedIds.has(record.id)
    ) {
      return false;
    }
    observedIds.add(record.id);
  }

  return observedIds.size === AGENT_AUDIT_RECORD_IDS.length;
}

/**
 * Shape check for the derived keyword region.
 *
 * Only the discriminant and version are read here: the region is built in this
 * process from a validated extract, so the value at risk is a wrong or stale
 * version reaching a client that would then read the numbers under the wrong
 * rules.
 */
function isKeywordEvidenceShape(value: unknown): value is KeywordEvidence {
  if (!isObject(value)) return false;
  if (value.version !== KEYWORD_EVIDENCE_VERSION) return false;

  if (value.availability === "unavailable") {
    return (
      value.reason === "target_page_not_captured" ||
      value.reason === "extract_missing"
    );
  }
  if (value.availability !== "available") return false;

  // Read the region rather than glance at it. A guard that stopped at the
  // discriminant would pass `queries: "none"` and `focus: null` through to a
  // client that then renders whatever that turns into.
  return (
    // The exact literal, not any string: a region computed under a different
    // counting algorithm would otherwise be published as current, and the
    // density beside it read under rules that did not produce it.
    value.textUnitsVersion === TEXT_UNITS_VERSION &&
    (value.pageRole === null ||
      value.pageRole === "homepage" ||
      value.pageRole === "product" ||
      value.pageRole === "tool" ||
      value.pageRole === "guide") &&
    isObject(value.focus) &&
    isNonNegativeInteger(value.focus.covered) &&
    isNonNegativeInteger(value.focus.applicable) &&
    value.focus.covered <= value.focus.applicable &&
    Array.isArray(value.limitations) &&
    value.limitations.every((entry) => typeof entry === "string") &&
    Array.isArray(value.queries) &&
    value.queries.length >= 1 &&
    value.queries.length <= 5 &&
    value.queries.every(isKeywordEvidenceQuery)
  );
}

/**
 * The extract as the Agent publishes it, checked all the way down.
 *
 * The projection is what decides what reaches a browser, and "whatever the
 * payload had" is not a decision. It used to restate the key list here and
 * check only that — no types, no bounds, and never inside `response` or
 * `declared`, which is where every field added since then went. The upstream
 * guard is the one definition of this shape, so the projection defers to it
 * instead of keeping a second list that can fall behind.
 */
function isAgentTargetPageExtract(value: unknown): boolean {
  return isSeoAuditTargetPageExtract(value);
}

const SLOT_STATES: readonly string[] = [
  "covered",
  "not_covered",
  "not_applicable",
];

function isTextSlot(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (typeof value.state !== "string" || !SLOT_STATES.includes(value.state)) {
    return false;
  }
  // `not_applicable` must never carry a number: a zero there would read as
  // "we looked and it was absent" for a field that does not exist.
  return value.state === "not_applicable"
    ? value.occurrences === null
    : isNonNegativeInteger(value.occurrences);
}

function isKeywordEvidenceQuery(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.slots)) return false;
  const { slots } = value;
  return (
    typeof value.displayQuery === "string" &&
    typeof value.isPrimary === "boolean" &&
    (value.primaryReason === undefined ||
      value.primaryReason === "most_fields_covered" ||
      value.primaryReason === "longest" ||
      value.primaryReason === "submission_order") &&
    (value.brandCandidate === "matched" ||
      value.brandCandidate === "not_matched" ||
      value.brandCandidate === "not_applicable") &&
    (value.tokenization === "whitespace" ||
      value.tokenization === "cjk_chars" ||
      value.tokenization === "mixed") &&
    isTextSlot(slots.title) &&
    isTextSlot(slots.description) &&
    isTextSlot(slots.h1) &&
    isTextSlot(slots.subHeadings) &&
    isTextSlot(slots.openingText) &&
    isObject(slots.url) &&
    typeof slots.url.state === "string" &&
    SLOT_STATES.includes(slots.url.state) &&
    slots.url.occurrences === undefined &&
    isNonNegativeInteger(value.capturedOccurrences) &&
    (value.density === null || isDensity(value.density))
  );
}

function isDensity(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    value.basis === "captured_text" &&
    (value.unitsBasis === "words" ||
      value.unitsBasis === "cjk_chars" ||
      value.unitsBasis === "mixed") &&
    isNonNegativeInteger(value.numeratorUnits) &&
    isNonNegativeInteger(value.denominatorUnits) &&
    value.denominatorUnits > 0
  );
}

function isAgentResult(value: unknown): value is AgentAuditResult {
  if (
    !isObject(value) ||
    typeof value.targetUrl !== "string" ||
    typeof value.siteOrigin !== "string" ||
    typeof value.targetInspected !== "boolean" ||
    !isNullableString(value.inspectedTargetUrl) ||
    !isCanonicalIsoTimestamp(value.scannedAt) ||
    !isCoverage(value.coverage) ||
    !isSiteResources(value.siteResources) ||
    !Array.isArray(value.records) ||
    !value.records.every(isSeoAuditRecord) ||
    !(
      value.targetPageExtract === null ||
      isAgentTargetPageExtract(value.targetPageExtract)
    ) ||
    !(
      value.keywordEvidence === undefined ||
      isKeywordEvidenceShape(value.keywordEvidence)
    )
  ) {
    return false;
  }

  return hasCompleteNeutralRecordLedger(value.records);
}

export function isAgentAuditSuccessEnvelope(
  value: unknown,
): value is AgentAuditSuccessEnvelope {
  if (!isObject(value) || !isObject(value.data) || !isObject(value.data.run)) {
    return false;
  }

  const { run } = value.data;
  const agent = run.agent;
  if (
    (agent !== "seo" && agent !== "tech") ||
    run.mode !== "authenticated_agent" ||
    run.persistence !== "none" ||
    !isObject(run.source) ||
    run.source.tool !== "seo_audit" ||
    run.source.schemaVersion !== AGENT_AUDIT_SOURCE_SCHEMA_VERSION ||
    !isCanonicalIsoTimestamp(run.source.completedAt) ||
    !isObject(run.source.cache) ||
    (run.source.cache.status !== "hit" && run.source.cache.status !== "miss") ||
    (run.source.cache.status === "hit"
      ? !isCanonicalIsoTimestamp(run.source.cache.capturedAt)
      : run.source.cache.capturedAt !== null)
  ) {
    return false;
  }

  return isAgentResult(value.data.result);
}

/** Strictly validates the existing buffered crawler envelope before projection. */
export function isSeoAuditUpstreamSuccessEnvelope(
  value: unknown,
): value is SeoAuditUpstreamSuccessEnvelope {
  return (
    isObject(value) &&
    isSeoAuditPayload(value.data) &&
    hasCompleteNeutralRecordLedger(value.data.result.records)
  );
}
