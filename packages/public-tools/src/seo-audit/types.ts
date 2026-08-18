import type { PublicToolResultEnvelope } from "../contract.ts";

export type SeoAuditAvailability = "available" | "partial" | "unavailable";
export type SeoAuditRecordState = "observed" | "not_observed" | "unverified";
export type SeoAuditRobotsDirectiveState =
  | "noindex_observed"
  | "noindex_not_observed";
export type SeoAuditRecordUnit = "pages" | "link_targets" | "site_resource";
/**
 * Which pages a record actually tested.
 *
 * `every_collected_page` means the record ran over the whole collected
 * population, so a page's absence from its observations is real evidence that
 * the page is clean. `conditional_subset` means the record only tested pages
 * meeting a precondition (has a title, is a sitemap member, self-canonical),
 * so absence proves nothing about a page that may never have qualified.
 */
export type SeoAuditRecordPopulation =
  | "every_collected_page"
  | "conditional_subset"
  | "site_resource";
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
  readonly population: SeoAuditRecordPopulation;
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

/**
 * Static text of the submitted target page, kept for keyword comparison.
 *
 * Visitor-neutral on purpose: it holds what the page says, never what anyone
 * asked about it, so one crawl can be reused across visitors while keyword
 * evidence itself is derived per request and never cached.
 *
 * Every field is *static extraction* — decoded, whitespace-normalized and
 * truncated markup text. It is not byte-level source, and it is not browser
 * visibility: paired `nav`/`footer`/`aside`/`script` blocks are removed, but
 * CSS, `hidden` and client rendering are not evaluated.
 */
/**
 * What the target page's HTML declared, as declared.
 *
 * Mirrors the crawler's side-car facts one-for-one. Absent stays null or zero
 * *as observed* — this whole object is null when the crawl did not carry the
 * side-car at all, which is a different fact from a page that declared nothing.
 */
export interface SeoAuditTargetDeclaredFacts {
  readonly lang: string | null;
  readonly openGraph: {
    readonly title: string | null;
    readonly description: string | null;
    readonly image: string | null;
  };
  readonly twitterCard: string | null;
  readonly viewport: string | null;
  readonly charset: string | null;
  readonly faviconDeclared: boolean;
  readonly hreflang: readonly string[];
  readonly images: {
    readonly total: number;
    readonly withAlt: number;
    /** `alt=""`, a correct decorative declaration — not a missing alt. */
    readonly withEmptyAlt: number;
    readonly withoutAlt: number;
  };
  readonly externalLinks: {
    readonly total: number;
    readonly nofollow: number;
    readonly blankWithoutNoopener: number;
  };
  /** UTF-8 bytes, not characters: a CJK page would read a third of its size. */
  readonly htmlBytes: number;
  readonly visibleTextBytes: number;
}

/** The crawl's own HTTP journey to the target page. Known once it was collected. */
export interface SeoAuditTargetResponseFacts {
  readonly status: number | null;
  readonly finalStatus: number | null;
  /** Redirect hops taken, not the URLs — those are the site's, not this page's. */
  readonly redirectHops: number;
  readonly responseMs: number | null;
  readonly contentType: string | null;
  readonly canonicalTarget: string | null;
  readonly robotsIndexable: boolean;
  readonly robotsDirectives: readonly string[];
  readonly sitemapMember: boolean;
  readonly jsonLdTypes: readonly string[];
  readonly jsonLdErrorCount: number;
  readonly internalOutlinks: number;
  readonly internalOutlinksWithoutAnchorText: number;
}

export interface SeoAuditTargetPageExtract {
  readonly url: string;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly h1: readonly string[];
  /**
   * H2–H6 as one merged list, or null when it could not be derived.
   *
   * Heading levels are not retained by the crawl projection, so this is the
   * headings list minus the H1 texts. Null means the H1 collector hit its own
   * cap, which makes that subtraction unsound — reported as unavailable rather
   * than as a list we cannot stand behind.
   */
  readonly subHeadings: readonly string[] | null;
  /** First 500 characters of the statically extracted body, or null. */
  readonly openingText: string | null;
  /**
   * Whitespace-separated word count of the full static body.
   *
   * Null for pages written mostly in a script with no word gaps, where the
   * count would be off by an order of magnitude. A known-wrong number does not
   * get published just because a number is expected.
   */
  readonly staticBodyWords: number | null;
  /** True when a list field was cut to its own budget before publication. */
  readonly truncatedLists: boolean;
  /** The crawl's HTTP journey to this page. */
  readonly response: SeoAuditTargetResponseFacts;
  /** What the markup declared, or null when the crawl did not carry it. */
  readonly declared: SeoAuditTargetDeclaredFacts | null;
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
  /**
   * The collected page that is the submitted target, in the exact form its
   * observations carry. Matching on the submitted string instead would miss a
   * page whose URL was normalised on the way in (a trailing slash, a tracking
   * parameter), and report its problems as a clean pass.
   */
  readonly inspectedTargetUrl: string | null;
  /**
   * Static text of the inspected target page, or null when there was no such
   * page. Visitor-neutral, so it travels with the cached crawl; keyword
   * evidence is derived from it per request and is never cached.
   */
  readonly targetPageExtract: SeoAuditTargetPageExtract | null;
  readonly records: readonly SeoAuditRecord[];
  readonly pages: readonly SeoAuditPage[];
}

export type SeoAuditPayload = PublicToolResultEnvelope<
  SeoAuditReport,
  "seo_audit",
  "discoverable_same_origin_static_html_audit"
>;
