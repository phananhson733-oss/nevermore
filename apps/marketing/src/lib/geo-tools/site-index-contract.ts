// @input -- independently fetched public documents, never inferred search results
// @output -- bounded inventory/reference-page/T2 evidence used by deterministic gaps
// @pos -- browser-safe evidence contract; no full HTML or rendered document storage
import type { CitabilityCheck, CITABILITY_RULES_VERSION } from "./citability-contract.ts";
import type { CitabilityRenderEvidence } from "./citability-render-contract.ts";

export const GEO_SITE_EVIDENCE_SCHEMA = "marketing-geo-site-evidence.v1";
export interface GeoSitePriorityHints { readonly snapshotId: string; readonly contextHash: string; readonly coreFeatures: readonly string[] }
export type GeoPageType = "listicle" | "comparison" | "product" | "article" | "documentation" | "other" | "unavailable";
export interface GeoReadPage {
  readonly id: string;
  readonly url: string;
  readonly finalUrl: string | null;
  readonly fetchedAt: string;
  readonly state: "read" | "unavailable";
  readonly reason: "blocked" | "fetch_failed" | "not_html" | "truncated" | "deadline" | "limit" | null;
  readonly httpStatus: number | null;
  readonly contentSha256: string | null;
  readonly contentMethod: "raw_html" | "rendered_visible_text" | null;
  readonly bodyComplete: boolean;
  readonly title: string | null;
  readonly headings: readonly string[];
  readonly pageType: GeoPageType;
  readonly pageTypeBasis: "title_headings" | "jsonld" | null;
  readonly ownPresence: boolean | null;
  readonly ownPresenceBasis: "brand_text" | "site_link" | "none" | null;
  readonly ownPresenceExcerpt: string | null;
  readonly matches: readonly { readonly questionId: string; readonly entities: readonly string[]; readonly terms: readonly string[] }[];
}
export interface GeoSiteIndex {
  readonly priority?: { readonly method: "frozen_profile_core_features.v1" | "none"; readonly snapshotId: string; readonly contextHash: string | null; readonly featureCount: number; readonly prioritizedUrls: readonly string[] };
  readonly scope: "declared_and_reachable_inventory";
  readonly status: "complete" | "partial" | "unavailable";
  readonly targetHost: string;
  readonly discoveredCount: number;
  readonly pages: readonly GeoReadPage[];
  readonly sitemapUrls: readonly string[];
  readonly inventorySources: readonly { readonly url: string; readonly fetchedAt: string; readonly httpStatus: number | null; readonly bodyComplete: boolean; readonly contentSha256: string | null }[];
  readonly limits: readonly string[];
}
export interface GeoReferencePage extends GeoReadPage {
  readonly sampleSlots: readonly string[];
}
export interface GeoPageCitabilityEvidence {
  /** Absent only in historical v1 evidence; never reinterpret its original kinds. */
  readonly rulesVersion?: typeof CITABILITY_RULES_VERSION;
  readonly id: string;
  readonly pageId: string;
  readonly questionId: string;
  readonly url: string;
  readonly checkedAt: string;
  readonly checks: readonly CitabilityCheck[];
  readonly renderStatus: CitabilityRenderEvidence["status"];
  readonly renderReason: CitabilityRenderEvidence["reason"];
  readonly rawToRenderedRatio: number | null;
}
export interface VisibilitySiteEvidenceV1 {
  readonly schemaVersion: typeof GEO_SITE_EVIDENCE_SCHEMA;
  readonly collectedAt: string;
  readonly index: GeoSiteIndex;
  readonly references: readonly GeoReferencePage[];
  readonly referenceOmittedCount: number;
  readonly citability: readonly GeoPageCitabilityEvidence[];
  readonly citabilityOmittedCount: number;
}
