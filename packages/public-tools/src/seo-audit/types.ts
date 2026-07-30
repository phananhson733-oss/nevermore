import type {
  PublicToolCheck,
  PublicToolCheckStatus,
  PublicToolEvidence,
  PublicToolResultEnvelope,
  PublicToolSeverity,
} from "../contract.ts";

export type SeoAuditStatus = PublicToolCheckStatus;
export type SeoAuditSeverity = PublicToolSeverity;
export type SeoAuditModuleId =
  | "crawlability"
  | "technical"
  | "on_page"
  | "content"
  | "structured_data";

export type SeoAuditResourceState =
  | "parsed"
  | "absent"
  | "missing"
  | "malformed"
  | "empty"
  | "server_error"
  | "fetch_error"
  | "too_large";

export interface SeoAuditPageProbe {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly firstStatus: number;
  readonly statusCode: number;
  readonly redirectChain: readonly string[];
  readonly contentType: string | null;
  readonly bodyComplete: boolean;
  readonly robotsNoindex: boolean | null;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly canonical: string | null;
  readonly htmlLang: string | null;
  readonly h1Count: number;
  readonly headingOutline: readonly string[];
  readonly wordCount: number;
  readonly internalLinkCount: number;
  readonly socialMetaTagsPresent: number;
  readonly jsonLdBlockCount: number;
  readonly jsonLdErrorCount: number;
}

export interface SeoAuditResourceProbe {
  readonly url: string;
  readonly state: SeoAuditResourceState;
  readonly statusCode: number;
  readonly bodyComplete: boolean;
}

export interface SeoAuditProbe {
  readonly requestedUrl: string;
  readonly scannedAt: string;
  readonly page: SeoAuditPageProbe;
  readonly robots: SeoAuditResourceProbe;
  readonly robotsPageAllowed: boolean | null;
  readonly sitemap: SeoAuditResourceProbe;
}

export type SeoAuditEvidenceSource =
  | "submitted_page_static"
  | "robots_txt"
  | "sitemap_xml";
export type SeoAuditEvidence = PublicToolEvidence<SeoAuditEvidenceSource>;
export type SeoAuditCheck = PublicToolCheck<
  SeoAuditModuleId,
  SeoAuditEvidenceSource
>;

export interface SeoAuditModule {
  readonly id: SeoAuditModuleId;
  readonly score: number | null;
  readonly measuredChecks: number;
  readonly totalChecks: number;
  readonly measuredWeight: number;
  readonly totalWeight: number;
  readonly coveragePercent: number;
  readonly checks: readonly SeoAuditCheck[];
}

export interface SeoAuditReport {
  readonly targetUrl: string;
  readonly finalUrl: string;
  readonly score: number | null;
  readonly measuredChecks: number;
  readonly totalChecks: number;
  readonly measuredWeight: number;
  readonly totalWeight: number;
  readonly coveragePercent: number;
  readonly modules: readonly SeoAuditModule[];
  readonly priorities: readonly SeoAuditCheck[];
}

export type SeoAuditPayload = PublicToolResultEnvelope<
  SeoAuditReport,
  "seo_audit",
  "single_raw_page_and_standard_support_files"
>;
