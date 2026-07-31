import type { PublicToolResultEnvelope } from "../contract.ts";

export type InternalLinkAuditAvailability =
  | "available"
  | "partial"
  | "unavailable";
export type InternalLinkAuditNodeKind =
  | "home"
  | "page"
  | "deep"
  | "orphan_candidate"
  | "unresolved_target";
export type InternalLinkAuditFindingKind =
  | "orphan_candidate"
  | "low_inbound"
  | "deep_page"
  | "unresolved_target";
export type InternalLinkAuditPriority = "P1" | "P2";

export interface InternalLinkAuditNode {
  readonly id: string;
  readonly url: string;
  readonly title: string | null;
  readonly depth: number;
  readonly inboundLinks: number;
  readonly outboundLinks: number;
  readonly statusCode: number | null;
  readonly sitemapMember: boolean;
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
  readonly kind: InternalLinkAuditFindingKind;
  readonly nodeId: string;
  readonly title: string;
  readonly detail: string;
  readonly evidence: string;
  readonly limitation: string;
  readonly suggestedSourceUrl: string | null;
  readonly observedAnchorText: string | null;
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
