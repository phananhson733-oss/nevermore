import type { PublicToolResultEnvelope } from "../contract.ts";

export type SeoAuditAvailability = "available" | "partial" | "unavailable";
export type SeoAuditRecordState = "observed" | "not_observed" | "unverified";
export type SeoAuditRobotsDirectiveState =
  | "noindex_observed"
  | "noindex_not_observed";
export type SeoAuditRecordUnit = "pages" | "link_targets" | "site_resource";
export type SeoAuditCategory =
  | "crawl"
  | "indexability"
  | "metadata"
  | "structure"
  | "links"
  | "structured_data";

export type SeoAuditEvidenceValue = string | number | boolean | null;

export interface SeoAuditEvidenceValueEntry {
  readonly label: string;
  readonly value: SeoAuditEvidenceValue;
}

export interface SeoAuditObservation {
  /** Null only for a site-level resource observation. */
  readonly url: string | null;
  readonly values: readonly SeoAuditEvidenceValueEntry[];
}

/**
 * One neutral audit record.
 *
 * Records deliberately contain no score, severity, priority, diagnosis, or
 * remediation field. A record states only whether a named condition was
 * observed in the collected crawl evidence and exposes the supporting
 * measurements.
 */
export interface SeoAuditRecord {
  readonly id: string;
  readonly category: SeoAuditCategory;
  readonly state: SeoAuditRecordState;
  readonly unit: SeoAuditRecordUnit;
  readonly tested: number;
  readonly affected: number;
  readonly observations: readonly SeoAuditObservation[];
  readonly limitation: string | null;
}

export interface SeoAuditPage {
  readonly url: string;
  readonly subjectUrl: string;
  readonly finalUrl: string;
  readonly depth: number;
  readonly initialStatus: number | null;
  readonly finalStatus: number | null;
  readonly redirectHops: number;
  readonly contentType: string | null;
  /**
   * Static meta/X-Robots evidence for a collected 2xx HTML response.
   * Null means the response was not eligible for this observation.
   */
  readonly robotsDirectiveState: SeoAuditRobotsDirectiveState | null;
  readonly canonicalTarget: string | null;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly h1Count: number;
  readonly headingsCount: number;
  readonly wordCount: number | null;
  readonly inboundLinks: number;
  readonly outboundLinks: number;
  readonly sitemapMember: boolean;
  readonly jsonLdTypes: readonly string[];
  readonly jsonLdErrorCount: number;
}

export interface SeoAuditCoverage {
  readonly availability: SeoAuditAvailability;
  readonly pagesInspected: number;
  readonly linksObserved: number;
  readonly sitemapUrlsObserved: number;
  readonly urlsSkipped: number;
  readonly urlsBlocked: number;
  readonly urlsDisallowed: number;
  readonly urlsErrored: number;
  readonly stopReason: string | null;
}

export interface SeoAuditSiteResources {
  readonly robotsFetched: boolean;
  readonly robotsGroupsObserved: number;
  readonly sitemapReferencesObserved: number;
  readonly sitemapFetched: boolean;
}

export interface SeoAuditReport {
  /** The submitted URL, retained even when the site redirects to its canonical origin. */
  readonly targetUrl: string;
  /** The final public origin selected after allowed entry redirects. */
  readonly siteOrigin: string;
  readonly scannedAt: string;
  readonly coverage: SeoAuditCoverage;
  readonly siteResources: SeoAuditSiteResources;
  /**
   * True when the submitted URL itself was collected as a 2xx HTML page.
   * Without it, "the target is absent from every issue list" proves nothing
   * about the target.
   */
  readonly targetInspected: boolean;
  readonly records: readonly SeoAuditRecord[];
  readonly pages: readonly SeoAuditPage[];
}

export type SeoAuditPayload = PublicToolResultEnvelope<
  SeoAuditReport,
  "seo_audit",
  "discoverable_same_origin_static_html_audit"
>;
