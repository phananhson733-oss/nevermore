import { emptyGeoKbPayload, type GeoKbPayload, type GeoKbValue } from "./kb-contract.ts";
import type { GeoInheritedProfile } from "./asset-context.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { finalizeGeoEnrichmentReport } from "./kb-enrichment.ts";

export const CONTEXT_KB_ID = "11111111-1111-4111-8111-111111111113";
export const CONTEXT_PROFILE: GeoInheritedProfile = {
  reference: { schemaVersion: "website-profile-reference.v1", websiteId: "11111111-1111-4111-8111-111111111115", snapshotId: "11111111-1111-4111-8111-111111111116", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) },
  productName: "Acme", oneLinePositioning: "Analytics for teams", coreFeatures: ["Reporting"], market: { country: "US", language: "en" },
};
export function contextPayload(): GeoKbPayload {
  return { ...emptyGeoKbPayload("https://example.com"), officialName: "Acme", aliases: ["Acme"], categoryTerms: ["analytics"],
    roles: [{ id: "analytics", label: "People researching analytics", segment: "Query-interest cluster", painPoints: ["analytics reporting"], decisionCriteria: [], vocabulary: ["analytics"] }],
    competitors: [{ domain: "rival.example", brandName: "Rival", aliases: ["Rival Analytics"], confirmed: true }],
    facts: [{ key: "price", value: "$20", reason: "", sourceUrl: "https://example.com/pricing", observedAt: "2026-08-30T00:00:00.000Z" }],
  };
}
export function contextReceipt(kbId = CONTEXT_KB_ID) {
  const payload = contextPayload();
  return finalizeGeoEnrichmentReport({ schemaVersion: "marketing-geo-kb-enrichment.v1", receiptId: "11111111-1111-4111-8111-111111111117", kbId, targetHost: "example.com", draftVersion: 1, draftHash: geoKbDigest(payload as unknown as GeoKbValue), profileReference: CONTEXT_PROFILE.reference, createdAt: "2026-08-31T00:00:00.000Z",
    competitors: [{ evidenceId: "C1", domain: "rival.example", confirmed: false, status: "available", reason: null, source: "crawl", sourceUrl: "https://rival.example/", observedAt: "2026-08-31T00:00:00.000Z", bodyHash: "b".repeat(64), method: "json_ld", brandName: "Rival", aliases: ["Rival Analytics"] }],
    facts: [{ evidenceId: "F1", key: "price", value: "$20", status: "available", reason: null, source: "crawl", sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31T00:00:00.000Z", bodyHash: "c".repeat(64), excerpt: "The price is $20 per month." }],
    gsc: { status: "available", reason: null, property: "sc-domain:example.com", window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: 2, truncated: false, observedAt: "2026-08-31T00:00:00.000Z", roles: [{ evidenceId: "R1", source: "gsc", role: payload.roles[0]!, queryCount: 2, queries: ["analytics reporting", "analytics tools"], queriesTruncated: false }] }, skippedLayers: [],
  });
}
