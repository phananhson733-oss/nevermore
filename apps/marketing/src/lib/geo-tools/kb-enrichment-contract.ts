// @input  -- private server enrichment receipts or their browser wire projection
// @output -- bounded evidence records; unavailable never means a zero observation
// @pos    -- client-safe receipt contract; hashing/fetching remain server-only

import { z } from "zod";
import { normalizeAccountWebsiteUrl, parseWebsiteProfileReference, type WebsiteProfileReferenceV1 } from "../account-websites/contracts.ts";

export const GEO_KB_ENRICHMENT_SCHEMA = "marketing-geo-kb-enrichment.v1" as const;
export const GEO_KB_ENRICHMENT_MAX_BYTES = 512 * 1_024;
export const GEO_KB_ENRICHMENT_LIMITS = { competitors: 5, facts: 24, roles: 6, roleQueries: 50, queryRows: 1_000, pageBytes: 512 * 1_024, fetchMs: 8_000 } as const;
const text = z.string().max(512);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().datetime();
const sourceUrl = z.string().max(2_048).refine((value) => normalizeAccountWebsiteUrl(value) !== null);
const evidenceId = z.string().regex(/^[CFR][1-9]\d{0,2}$/u);
const failure = z.enum(["missing_url", "fetch_failed", "not_found", "target_redirected", "partial_body", "not_html", "invalid_response", "rate_limited"]);
const common = { evidenceId, sourceUrl: sourceUrl.nullable() };
const missingSource = { source: z.null(), observedAt: z.null(), bodyHash: z.null() };
const crawlSource = { source: z.literal("crawl"), observedAt: timestamp, bodyHash: hash };
const competitorCommon = { ...common, domain: z.string().max(253), confirmed: z.literal(false) };
const competitorSchema = z.discriminatedUnion("status", [
  z.object({ ...competitorCommon, ...crawlSource, sourceUrl, status: z.literal("available"), reason: z.null(), method: z.enum(["json_ld", "og_site_name", "title"]), brandName: text.min(1), aliases: z.array(text.min(1)).max(10) }).strict(),
  z.object({ ...competitorCommon, ...missingSource, status: z.literal("unavailable"), reason: failure, method: z.null(), brandName: z.null(), aliases: z.array(text).max(0) }).strict(),
]);
const factSchema = z.discriminatedUnion("status", [
  z.object({ ...common, ...crawlSource, sourceUrl, status: z.literal("available"), reason: z.null(), key: text.min(1), value: text.min(1), excerpt: z.string().min(1).max(1_000) }).strict(),
  z.object({ ...common, ...missingSource, status: z.literal("unavailable"), reason: failure, key: text.min(1), value: z.null(), excerpt: z.null() }).strict(),
]);
const roleSchema = z.object({ id: text.min(1), label: text.min(1), segment: text, painPoints: z.array(text).max(5).readonly(), decisionCriteria: z.array(text).max(5).readonly(), vocabulary: z.array(text).max(5).readonly() }).strict();
const roleCandidateSchema = z.object({ evidenceId, source: z.literal("gsc"), role: roleSchema,
  queryCount: z.number().int().min(2).max(GEO_KB_ENRICHMENT_LIMITS.queryRows),
  queries: z.array(text.min(1)).min(2).max(GEO_KB_ENRICHMENT_LIMITS.roleQueries), queriesTruncated: z.boolean(),
}).strict().refine((value) => value.queryCount >= value.queries.length && value.queriesTruncated === (value.queryCount > value.queries.length));
const windowSchema = z.object({ startDate: z.string().date(), endDate: z.string().date() }).strict()
  .refine((value) => Date.parse(value.endDate) - Date.parse(value.startDate) === 89 * 86_400_000);
const gscSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), reason: z.null(), property: text.min(1), window: windowSchema,
    queryCount: z.number().int().nonnegative().max(GEO_KB_ENRICHMENT_LIMITS.queryRows), truncated: z.boolean(), observedAt: timestamp, roles: z.array(roleCandidateSchema).max(GEO_KB_ENRICHMENT_LIMITS.roles),
  }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["not_connected", "property_not_granted", "grant_unavailable", "fetch_failed", "rate_limited", "invalid_response"]), property: text.nullable(), window: windowSchema,
    queryCount: z.null(), truncated: z.null(), observedAt: z.null(), roles: z.array(roleCandidateSchema).max(0),
  }).strict(),
]);
const profileReference = z.custom<WebsiteProfileReferenceV1>((value) => {
  try { parseWebsiteProfileReference(value); return true; } catch { return false; }
});
export const geoKbEnrichmentSchema = z.object({
  schemaVersion: z.literal(GEO_KB_ENRICHMENT_SCHEMA), receiptId: z.string().uuid(), kbId: z.string().uuid(),
  targetHost: z.string().max(253).refine((value) => normalizeAccountWebsiteUrl(`https://${value}`)?.host === value),
  draftVersion: z.number().int().nonnegative(), draftHash: hash, profileReference: profileReference.nullable(), createdAt: timestamp,
  competitors: z.array(competitorSchema).max(GEO_KB_ENRICHMENT_LIMITS.competitors),
  gsc: gscSchema, facts: z.array(factSchema).max(GEO_KB_ENRICHMENT_LIMITS.facts),
  skippedLayers: z.array(z.enum(["problem", "evaluation"])).max(2), contentHash: hash,
}).strict().superRefine((value, context) => {
  const allIds = [...value.competitors, ...value.facts, ...value.gsc.roles].map((entry) => entry.evidenceId);
  if (new Set(allIds).size !== allIds.length) context.addIssue({ code: "custom", message: "duplicate evidence" });
  const expected = value.gsc.roles.length === 0 ? ["problem", "evaluation"] : [];
  if (JSON.stringify(value.skippedLayers) !== JSON.stringify(expected)) context.addIssue({ code: "custom", message: "incorrect skipped layers" });
  if (value.gsc.status === "available") {
    const queryCount = value.gsc.queryCount;
    if (value.gsc.roles.some((role) => role.queryCount > queryCount)) context.addIssue({ code: "custom", message: "role exceeds query count" });
  }
});

export type GeoKbEnrichmentReport = z.infer<typeof geoKbEnrichmentSchema>;
export type GeoKbEnrichmentBody = Omit<GeoKbEnrichmentReport, "contentHash">;
export type GeoCompetitorEvidence = GeoKbEnrichmentReport["competitors"][number];
export type GeoFactEvidence = GeoKbEnrichmentReport["facts"][number];
export type GeoRoleCandidate = GeoKbEnrichmentReport["gsc"]["roles"][number];
export type GeoGscEnrichment = GeoKbEnrichmentReport["gsc"];

export function parseGeoKbEnrichmentReport(value: unknown): GeoKbEnrichmentReport {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > GEO_KB_ENRICHMENT_MAX_BYTES) throw new Error("enrichment exceeds byte limit");
  return geoKbEnrichmentSchema.parse(value);
}
