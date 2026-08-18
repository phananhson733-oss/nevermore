import type { PublicToolResultEnvelope } from "../contract.ts";
import type { TextUnitsBasis } from "./keyword-evidence/text-units.ts";

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
  /**
   * Whether one named page was inside this rule's tested population.
   *
   * Null when the question does not arise: no page was named, or the rule
   * counts something other than pages. Published because `population` alone
   * cannot answer it — a rule that tested a qualifying subset says nothing
   * about a page that never qualified, and says a great deal about one that
   * did. Without this, every conditional rule had to report "not covered" for
   * both, which is false for the common case and reads as a hole in the audit.
   */
  readonly targetTested: boolean | null;
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
    /** Both `width` and `height` declared, which is what reserves the box. */
    readonly withDimensions: number;
    readonly lazyLoaded: number;
  };
  readonly externalLinks: {
    readonly total: number;
    readonly nofollow: number;
    readonly blankWithoutNoopener: number;
  };
  /** UTF-8 bytes, not characters: a CJK page would read a third of its size. */
  readonly htmlBytes: number;
  readonly visibleTextBytes: number;
  /** UTF-8 bytes inside `<script>`, which is what a document ships instead. */
  readonly scriptBytes: number;
  /** Elements a visitor can act through, as far as static HTML can see them. */
  readonly interactive: {
    readonly forms: number;
    readonly inputs: number;
    readonly buttons: number;
    readonly selects: number;
    readonly textareas: number;
    readonly canvases: number;
    readonly media: number;
    readonly iframes: number;
  };
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

export interface SeoAuditTermRow {
  readonly phrase: string;
  readonly count: number;
}

export interface SeoAuditTermTable {
  /** Phrase length in text units: 1 through 5. */
  readonly size: number;
  readonly rows: readonly SeoAuditTermRow[];
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
   * get published just because a number is expected. Prefer `staticBodyUnits`
   * for anything that has to hold across scripts; this stays because "words"
   * is what a reader of an English page expects to see.
   */
  readonly staticBodyWords: number | null;
  /**
   * The same body in `text_units.v1`, which every script can be counted in.
   *
   * CJK code points count one unit each and the rest counts in whitespace
   * runs, so a Chinese page finally has a length rather than an absence. Null
   * only when the crawl did not carry the side-car that measured it.
   */
  readonly staticBodyUnits: {
    readonly units: number;
    readonly basis: TextUnitsBasis;
  } | null;
  /**
   * What the page repeats, one table per phrase length from one unit to five.
   *
   * Counted over the same body `staticBodyUnits` measures, so a row's share is
   * that count over that total and there is only one denominator on the page.
   * Visitor-neutral, so it travels with the cached crawl; whether a row covers
   * anyone's target keyword is decided per request, where the queries are.
   *
   * Null when the crawl carried no side-car to count with.
   */
  readonly termFrequencies: readonly SeoAuditTermTable[] | null;
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
