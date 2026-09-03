// @input  -- existing seo_audit.sitewide.v18 envelopes and projected Agent data
// @output -- frozen authenticated Agent API types plus strict client/upstream guards
// @pos    -- shared wire contract for the SEO Agent API and UI, both focuses

import type {
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
  isKeywordEvidenceRecord,
  isPagePerformanceRecord,
  isSearchPerformanceRecord,
  isSeoAuditTargetPageExtract,
  isSerpShapeRecord,
} from "@sf/public-tools/seo-audit/contract";
import {
  SEO_AUDIT_RECORD_CATEGORIES,
  SEO_AUDIT_RECORD_IDS,
} from "@sf/public-tools/seo-audit/record-ledger";
import { SEARCH_PERFORMANCE_RECORD_IDS } from "@sf/public-tools/seo-audit/search-performance";
import { INDEX_COVERAGE_RECORD_IDS } from "@sf/public-tools/seo-audit/index-coverage";
import { KEYWORD_EVIDENCE_RECORD_IDS } from "@sf/public-tools/seo-audit/keyword-evidence/records";
import { PAGE_PERFORMANCE_RECORD_IDS } from "@sf/public-tools/seo-audit/page-performance";
import { SERP_SHAPE_RECORD_IDS } from "@sf/public-tools/seo-audit/serp-shape";

export { isCanonicalIsoTimestamp };

export interface SerpLandscapeRow {
  readonly position: number;
  /** Sitelinks shown under this result; zero also covers "not described". */
  readonly sitelinkCount: number;
  readonly domain: string;
  /** The checked site holds this result. Says nothing about which page. */
  readonly isTarget: boolean;
  /**
   * Whether this result is the submitted page itself.
   *
   * Null when the site does not hold the result, or when the provider gave no
   * URL to compare — which is a different fact from "a different page".
   */
  readonly isTargetPage: boolean | null;
}

/**
 * Page one for one query, in one market.
 *
 * Declared here rather than beside the lookup that fills it: this module is the
 * wire contract both the route and the browser read, and the lookup builds a
 * provider client whose graph reaches `node:net`. Keeping the shape on this
 * side means the client never has a reason to name that module at all.
 */
export type SerpLandscape =
  | {
      readonly availability: "available";
      readonly query: string;
      readonly market: string;
      readonly language: string;
      readonly resultsObserved: number;
      /** Results showing sitelinks, the strength signal the reference tool uses. */
      readonly withSitelinks: number;
      /** Feature blocks on the page, or null when the provider named none. */
      readonly features: readonly string[] | null;
      /** Where this page's own host sits, or null when it is not on page one. */
      readonly targetPosition: number | null;
      /** True only when one of those results is the submitted page itself. */
      readonly targetPageOnPage: boolean;
      readonly rows: readonly SerpLandscapeRow[];
      /**
       * Estimated monthly organic traffic per page-one domain, or null.
       *
       * Null means this market has no traffic-estimate source, or the lookup
       * did not answer. Kept apart from an empty list, which would state that
       * page one holds no small site — a finding, not a gap.
       */
      readonly domainTraffic:
        | readonly {
            readonly domain: string;
            readonly organicEtv: number | null;
          }[]
        | null;
    }
  | {
      readonly availability: "unavailable";
      readonly reason:
        | "no_target_query"
        | "market_not_supported"
        | "provider_not_configured"
        | "provider_unavailable";
    };

export type AgentKind = "seo" | "tech";
export type AgentAuditCacheStatus = "hit" | "miss";
export const AGENT_AUDIT_SOURCE_SCHEMA_VERSION =
  "seo_audit.sitewide.v18" as const;
export const AGENT_AUDIT_SOURCE_SCOPE =
  "discoverable_same_origin_static_html_audit" as const;

/**
 * Re-exported, not re-declared.
 *
 * This was a second hand-written copy of the producer's ledger, and the guard
 * below refuses any upstream payload whose records differ from it at all. The
 * tests here build their fixtures from the copy, so a detector added to the
 * crawl never met the guard: five landed, a real run published twenty-nine
 * records against a list of twenty-four, and the Agent audit answered 502 while
 * every unit test stayed green. Verified against main's copy at merge time —
 * it holds nothing the shared ledger lacks.
 */
export { SEO_AUDIT_RECORD_CATEGORIES as AGENT_AUDIT_RECORD_CATEGORIES } from "@sf/public-tools/seo-audit/record-ledger";

const AGENT_AUDIT_RECORD_IDS = SEO_AUDIT_RECORD_IDS;
const AGENT_SEARCH_PERFORMANCE_RECORD_IDS = [
  ...SEARCH_PERFORMANCE_RECORD_IDS,
  ...INDEX_COVERAGE_RECORD_IDS,
];

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
/**
 * One page this run is willing to judge on its own, beside the submitted one.
 *
 * Neutral facts only: which pages matter to a business is a question the
 * client asks against a confirmed Profile, and this shape travels in a
 * response projected from a payload cached across visitors.
 */
export interface AgentKeyPageCandidate {
  /**
   * The crawl's fetch URL, which is the form every observation carries.
   *
   * Not `subjectUrl`: the evaluator compares these with only a fragment
   * stripped, so publishing the other normalisation would make every key page
   * match nothing and read as "no observation".
   */
  readonly url: string;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly depth: number;
  readonly inboundLinks: number;
}

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
   * Where the crawl actually landed for the submitted page, or null.
   *
   * `inspectedTargetUrl` is the URL the crawl REQUESTED. On a page that
   * redirects, the audit is of the destination while every label on screen
   * still named the URL that was typed -- so a visitor auditing a tracking
   * short link read a report about their homepage and had no way to tell.
   * Search Console keys its rows by the end of the redirect journey, which is
   * why this value already decided the GSC and CrUX lookups inside this
   * handler; it was the only reader that could not see it.
   *
   * Null when the target was never inspected. Equal to the requested URL when
   * nothing redirected, which is the common case and says so.
   */
  readonly landedTargetUrl: string | null;
  /**
   * Pages this run can judge individually, beside the submitted one.
   *
   * Optional so an older cached payload, or a crawl that collected nothing,
   * stays readable: absent means "this run published no shortlist", which is
   * different from a site with one page.
   */
  readonly keyPages?: readonly AgentKeyPageCandidate[];
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
  /**
   * The same region's findings, as records the checks read.
   *
   * Separate from `keywordEvidence` rather than folded into it: that region is
   * a published shape with its own version and its own readers, and adding a
   * field to it would mean every consumer of `keyword_evidence.v1` had to be
   * re-versioned to gain two audit records.
   */
  readonly keywordChecks?: AgentKeywordChecks;
  /**
   * CrUX field data for the submitted page, when a key is configured.
   *
   * Absent means one of two settled facts, both stated by the records: no key
   * at the deploy boundary, or CrUX had nothing for that URL. Neither is a
   * failure of the audit.
   */
  readonly pagePerformance?: AgentPagePerformance;
  /**
   * Present only when the visitor holds a Search Console grant covering the
   * audited host.
   *
   * Absent from `SeoAuditReport` for the same reason as the keyword region, and
   * a stronger one: the crawl payload is cached by host and shared, while these
   * numbers belong to one visitor's verified property. Storing them beside a
   * crawl would answer the next visitor with this one's search data. The
   * payload guard refuses their evidence category outright, so the mistake
   * cannot be made quietly.
   */
  readonly searchPerformance?: AgentSearchPerformance;
  /**
   * Set when Search Console was reachable in principle and did not answer.
   *
   * Absent means one of two settled facts: the region is present, or nothing
   * covers this host. Without this third state a timeout, a rate limit or an
   * expired token all rendered as "authorize this tool" — sending a visitor
   * who is already connected back through OAuth to fix something OAuth cannot.
   */
  readonly searchPerformanceUnavailable?: true;
  /**
   * Page one for the primary query, when this boundary looked it up.
   *
   * Absent from the cached payload for the same reason the keyword region is:
   * a results page is a fact about one query in one market, and the cache row
   * is shared by every visitor to the host.
   */
  readonly serpLandscape?: SerpLandscape;
  /**
   * 9.1 and 9.4, read off the landscape above.
   *
   * A separate region because the checks need their own versioned ledger and
   * guard, not because they need their own lookup: a second paid call for the
   * same query in the same run would double the cost of every audit to learn a
   * fact already in hand.
   */
  readonly serpShape?: AgentSerpShape;
};

/**
 * Version of the results-page sample region.
 *
 * Freezes the depth, that one query is sampled rather than all of them, and
 * which provider item types count as an AI answer or as a community result.
 */
export const AGENT_SERP_SHAPE_VERSION = "serp_shape.agent.v1" as const;

export interface AgentSerpShape {
  readonly version: typeof AGENT_SERP_SHAPE_VERSION;
  readonly records: SeoAuditReport["records"];
}

function isAgentSerpShape(value: unknown): value is AgentSerpShape {
  if (!isObject(value)) return false;
  if (
    value.version !== AGENT_SERP_SHAPE_VERSION ||
    !Array.isArray(value.records) ||
    !value.records.every(isSerpShapeRecord)
  ) {
    return false;
  }
  const ids = value.records.map((record) => record.id).sort();
  const expected = SERP_SHAPE_RECORD_IDS.slice().sort();
  return (
    ids.length === expected.length && ids.every((id, i) => id === expected[i])
  );
}

/**
 * Version of the CrUX field region.
 *
 * Freezes the form factor, that origin-level data is used as a fallback and
 * labelled, and that a metric CrUX withheld is unverified rather than zero.
 */
export const AGENT_PAGE_PERFORMANCE_VERSION =
  "page_performance.agent.v1" as const;

export interface AgentPagePerformance {
  readonly version: typeof AGENT_PAGE_PERFORMANCE_VERSION;
  readonly records: SeoAuditReport["records"];
}

function isAgentPagePerformance(value: unknown): value is AgentPagePerformance {
  if (!isObject(value)) return false;
  if (
    value.version !== AGENT_PAGE_PERFORMANCE_VERSION ||
    !Array.isArray(value.records) ||
    !value.records.every(isPagePerformanceRecord)
  ) {
    return false;
  }
  const ids = value.records.map((record) => record.id).sort();
  const expected = PAGE_PERFORMANCE_RECORD_IDS.slice().sort();
  return (
    ids.length === expected.length && ids.every((id, i) => id === expected[i])
  );
}

/**
 * Version of the derived keyword-check region.
 *
 * Freezes its own decisions — which query is judged, what a `not_applicable`
 * slot means, and that matching is a token sequence with no synonyms — none of
 * which the crawl version or the keyword evidence version describes.
 */
export const AGENT_KEYWORD_CHECKS_VERSION = "keyword_checks.agent.v1" as const;

/** Records derived from this visitor's confirmed queries, never cached. */
export interface AgentKeywordChecks {
  readonly version: typeof AGENT_KEYWORD_CHECKS_VERSION;
  readonly records: SeoAuditReport["records"];
}

function isAgentKeywordChecks(value: unknown): value is AgentKeywordChecks {
  if (!isObject(value)) return false;
  if (
    value.version !== AGENT_KEYWORD_CHECKS_VERSION ||
    !Array.isArray(value.records) ||
    !value.records.every(isKeywordEvidenceRecord)
  ) {
    return false;
  }
  // Complete or not a region: a subset would render as a check that decided
  // when its record was simply missing.
  const ids = value.records.map((record) => record.id).sort();
  const expected = KEYWORD_EVIDENCE_RECORD_IDS.slice().sort();
  return (
    ids.length === expected.length && ids.every((id, i) => id === expected[i])
  );
}

/**
 * Version of the derived search region, separate from the crawl payload's.
 *
 * `seo_audit.sitewide.v6` versions the shared crawl. This region is derived per
 * request and freezes its own decisions — the window, the finalisation lag, the
 * row cap, how a query's average position becomes a band — none of which the
 * crawl version describes. Changing any of them has to change this literal.
 *
 * v2 adds the target page's own query rows and the band record built from them.
 * A v1 payload is not a v2 payload missing a field: its ledger is complete for
 * three records and the guard below requires four, so an old cached or in-
 * flight body is rejected rather than rendered with a check that silently never
 * decides.
 */
export const AGENT_SEARCH_PERFORMANCE_VERSION =
  "search_performance.agent.v2" as const;

/** The visitor's own search numbers for this host, read fresh on every run. */
export interface AgentSearchPerformance {
  readonly version: typeof AGENT_SEARCH_PERFORMANCE_VERSION;
  /** Property identifier the rows came from, for display beside the result. */
  readonly property: string;
  /** Inclusive window, in the property's own reporting days. */
  readonly startDate: string;
  readonly endDate: string;
  readonly records: SeoAuditReport["records"];
}

function isAgentSearchPerformance(
  value: unknown,
): value is AgentSearchPerformance {
  if (!isObject(value)) return false;
  if (
    value.version !== AGENT_SEARCH_PERFORMANCE_VERSION ||
    typeof value.property !== "string" ||
    value.property.trim() === "" ||
    typeof value.startDate !== "string" ||
    typeof value.endDate !== "string" ||
    !Array.isArray(value.records) ||
    // The crawl guard refuses this category by design, so reusing it here
    // rejected every real region and let an empty one through. Its own guard
    // accepts exactly the category a crawl may not carry.
    !value.records.every(isSearchPerformanceRecord)
  ) {
    return false;
  }
  // The ledger is complete or the region is not one: a subset would render as
  // a check that decided when its record was simply missing. Ids come from the
  // producer rather than a second list beside it.
  const ids = value.records.map((record) => record.id).sort();
  const expected = AGENT_SEARCH_PERFORMANCE_RECORD_IDS.slice().sort();
  return (
    ids.length === expected.length &&
    ids.every((id, index) => id === expected[index])
  );
}

/**
 * Every record one run publishes, from every region.
 *
 * One function because there were three copies of this join — the evaluator,
 * the results view and the display seam each spread the regions by hand — and
 * a region added to two of them renders records the third refuses, or worse,
 * passes a vocabulary check the panel never applies. Adding a region here
 * reaches all of them.
 *
 * The regions stay separate on the wire: the crawl payload is cached by host
 * and shared, while these belong to one visitor. They are joined at read time
 * and never on the way to a cache.
 */
export function allAgentAuditRecords(
  data: AgentAuditSuccessData,
): SeoAuditReport["records"] {
  return [
    ...data.result.records,
    ...(data.result.searchPerformance?.records ?? []),
    ...(data.result.keywordChecks?.records ?? []),
    ...(data.result.pagePerformance?.records ?? []),
    ...(data.result.serpShape?.records ?? []),
  ];
}

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
    readonly run: Omit<SeoAuditPayload["run"], "schemaVersion" | "scope"> & {
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
      !Object.hasOwn(SEO_AUDIT_RECORD_CATEGORIES, record.id) ||
      record.category !==
        SEO_AUDIT_RECORD_CATEGORIES[
          record.id as keyof typeof SEO_AUDIT_RECORD_CATEGORIES
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

/**
 * Exported so the wording guard walks the same list the validator does.
 *
 * A reason with no sentence renders as its own key path in the one section
 * that exists to explain why a lookup produced nothing.
 */
export const SERP_UNAVAILABLE_REASONS: readonly string[] = [
  "no_target_query",
  "market_not_supported",
  "provider_not_configured",
  "provider_unavailable",
];

/**
 * The results-page region, checked all the way down.
 *
 * Its rows carry a domain that the report prints, so they are bounded here the
 * way every other printed string is. Ten results at most, because one page is
 * what was asked for.
 */
export function isSerpLandscape(value: unknown): value is SerpLandscape {
  return isSerpLandscapeShape(value);
}

function isSerpLandscapeShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.availability === "unavailable") {
    return (
      Object.keys(value).length === 2 &&
      typeof value.reason === "string" &&
      SERP_UNAVAILABLE_REASONS.includes(value.reason)
    );
  }
  if (value.availability !== "available") return false;
  if (
    typeof value.query !== "string" ||
    value.query.length > 200 ||
    typeof value.market !== "string" ||
    !/^[A-Z]{2}$/.test(value.market) ||
    typeof value.language !== "string" ||
    !/^[a-z]{2,3}$/.test(value.language) ||
    typeof value.targetPageOnPage !== "boolean" ||
    !isNonNegativeInteger(value.resultsObserved) ||
    !isNonNegativeInteger(value.withSitelinks) ||
    value.withSitelinks > value.resultsObserved ||
    !(
      value.targetPosition === null ||
      (isNonNegativeInteger(value.targetPosition) && value.targetPosition > 0)
    ) ||
    !(
      value.features === null ||
      (Array.isArray(value.features) &&
        value.features.length <= 40 &&
        value.features.every(
          (entry) => typeof entry === "string" && entry.length <= 64,
        ))
    ) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 10 ||
    value.rows.length !== value.resultsObserved
  ) {
    return false;
  }
  return value.rows.every(
    (row) =>
      isObject(row) &&
      Object.keys(row).length === 5 &&
      isNonNegativeInteger(row.position) &&
      row.position > 0 &&
      typeof row.domain === "string" &&
      row.domain.length > 0 &&
      row.domain.length <= 253 &&
      isNonNegativeInteger(row.sitelinkCount) &&
      typeof row.isTarget === "boolean" &&
      (row.isTargetPage === null || typeof row.isTargetPage === "boolean"),
  );
}

/** Bound published beside the type, so the guard and the producer agree. */
export const AGENT_KEY_PAGE_WIRE_LIMIT = 24;

function isAgentKeyPageCandidates(
  value: unknown,
): value is readonly AgentKeyPageCandidate[] {
  return (
    Array.isArray(value) &&
    value.length <= AGENT_KEY_PAGE_WIRE_LIMIT &&
    value.every(
      (entry) =>
        isObject(entry) &&
        // Exactly five: a sixth field would be whatever an upstream payload
        // happened to carry, published to the browser without review.
        Object.keys(entry).length === 5 &&
        typeof entry.url === "string" &&
        entry.url.length > 0 &&
        (entry.title === null || typeof entry.title === "string") &&
        (entry.metaDescription === null ||
          typeof entry.metaDescription === "string") &&
        isNonNegativeInteger(entry.depth) &&
        isNonNegativeInteger(entry.inboundLinks),
    )
  );
}

function isAgentResult(value: unknown): value is AgentAuditResult {
  if (
    !isObject(value) ||
    typeof value.targetUrl !== "string" ||
    typeof value.siteOrigin !== "string" ||
    typeof value.targetInspected !== "boolean" ||
    !isNullableString(value.inspectedTargetUrl) ||
    !(
      value.keyPages === undefined || isAgentKeyPageCandidates(value.keyPages)
    ) ||
    !isNullableString(value.landedTargetUrl) ||
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
    ) ||
    !(
      value.keywordChecks === undefined ||
      isAgentKeywordChecks(value.keywordChecks)
    ) ||
    !(
      value.pagePerformance === undefined ||
      isAgentPagePerformance(value.pagePerformance)
    ) ||
    !(
      value.searchPerformance === undefined ||
      isAgentSearchPerformance(value.searchPerformance)
    ) ||
    !(
      value.searchPerformanceUnavailable === undefined ||
      value.searchPerformanceUnavailable === true
    ) ||
    !(
      value.serpLandscape === undefined ||
      isSerpLandscapeShape(value.serpLandscape)
    ) ||
    !(value.serpShape === undefined || isAgentSerpShape(value.serpShape))
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
