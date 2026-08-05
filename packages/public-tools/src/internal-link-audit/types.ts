import type { PublicToolResultEnvelope } from "../contract.ts";

export type InternalLinkAuditAvailability =
  | "available"
  | "partial"
  | "unavailable";
export type InternalLinkAuditNodeKind =
  | "home"
  | "page"
  | "deep"
  | "unreachable"
  | "orphan_candidate"
  /** Sitemap-only page on a truncated crawl: the graph cannot settle the question. */
  | "orphan_undetermined"
  | "unresolved_target";
export type InternalLinkAuditFindingKind =
  | "orphan_candidate"
  /**
   * Same page, truncated crawl. "Nothing links here" and "we stopped before
   * reaching the pages that link here" are indistinguishable once a budget cut
   * the crawl short, so the finding says which one it is: neither.
   */
  | "orphan_undetermined"
  | "low_inbound"
  | "deep_page"
  | "unreachable_page"
  | "duplicate_content"
  | "unresolved_target";
export type InternalLinkAuditPriority = "P1" | "P2";
export type InternalLinkAuditConfidence = "high" | "medium" | "low";
export type InternalLinkAuditImpact = "high" | "medium" | "low";

export interface InternalLinkAuditNode {
  readonly id: string;
  readonly url: string;
  readonly title: string | null;
  /** Collection order depth. Sitemap seeds can make this shallower than clicks. */
  readonly crawlDepth: number;
  /** Shortest observed HTML-link path from the homepage; null means unreachable. */
  readonly clickDepth: number | null;
  /** Deterministic predecessor on one shortest observed homepage path. */
  readonly primaryParentId: string | null;
  readonly inboundLinks: number;
  readonly outboundLinks: number;
  readonly statusCode: number | null;
  readonly sitemapMember: boolean;
  readonly robotsIndexable: boolean;
  readonly canonicalTarget: string | null;
  readonly kind: InternalLinkAuditNodeKind;
}

export interface InternalLinkAuditEdge {
  readonly from: string;
  readonly to: string;
  readonly anchorText: string | null;
}

export interface InternalLinkAuditFinding {
  readonly id: string;
  readonly priority: InternalLinkAuditPriority;
  readonly confidence: InternalLinkAuditConfidence;
  readonly impact: InternalLinkAuditImpact;
  readonly kind: InternalLinkAuditFindingKind;
  /** Primary sample kept for selection and backwards-compatible consumers. */
  readonly nodeId: string;
  readonly nodeIds: readonly string[];
  readonly affectedUrls: readonly string[];
  readonly title: string;
  readonly detail: string;
  readonly evidence: string;
  readonly limitation: string;
  readonly suggestedSourceUrl: string | null;
  readonly observedAnchorText: string | null;
}

export interface InternalLinkAuditDepthDistribution {
  readonly oneClick: number;
  readonly twoClicks: number;
  readonly threeClicks: number;
  readonly fourPlusClicks: number;
  readonly unreachable: number;
}

export interface InternalLinkAuditReport {
  readonly targetUrl: string;
  readonly availability: InternalLinkAuditAvailability;
  readonly stopReason: string | null;
  readonly limitation: string;
  readonly pagesCrawled: number;
  readonly linksObserved: number;
  readonly sitemapFetched: boolean;
  readonly sitemapUrlsObserved: number;
  readonly actionablePages: number;
  readonly clickDepthDistribution: InternalLinkAuditDepthDistribution;
  readonly nodes: readonly InternalLinkAuditNode[];
  readonly edges: readonly InternalLinkAuditEdge[];
  readonly findings: readonly InternalLinkAuditFinding[];
}

export type InternalLinkAuditPayload = PublicToolResultEnvelope<
  InternalLinkAuditReport,
  "internal_link_audit",
  "bounded_same_origin_static_html_crawl"
>;

export type InternalLinkAuditUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly code: "invalid_url" };
