// @input -- complete frozen/prepared context received by the browser
// @output -- a safe renderable shape; cryptographic integrity is checked separately on the server
// @pos -- client-safe shared schema, with no stores, Node crypto or current Profile reads
import { z } from "zod";
import { parseWebsiteProfileReference, fieldProvenanceSchema, normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { geoRoleSourceV2Schema, geoReviewSchema, geoFactSupportRefSchema, geoEvidenceRefSchema } from "./kb-v2-contract.ts";
import { geoV2JsonbBytes, canonicalGeoV2Text } from "./kb-v2-json.ts";
import type { GeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { geoCompetitorSourceV2Schema } from "./kb-source-contract.ts";

export const GEO_SNAPSHOT_CONTEXT_SCHEMA_V2 = "marketing-geo-snapshot-context.v2" as const;
export const GEO_CONTEXT_V2_MAX_BYTES = 524_288;
export const GEO_CONTEXT_EVIDENCE_MAX_BYTES = 196_608;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = z.string().max(2048);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const url = text.refine(value => { try { new URL(value); return normalizeAccountWebsiteUrl(value) !== null; } catch { return false; } });
const layer = z.enum(["problem", "evaluation"]);
const counts = z.object({ profile: z.number().int().nonnegative().max(10000), gsc: z.number().int().nonnegative().max(10000), crawl: z.number().int().nonnegative().max(10000), manual: z.number().int().nonnegative().max(10000) }).strict();
export const geoSourceReceiptRefSchema = z.object({ receiptId: z.string().uuid(), contentHash: hash }).strict();
const profile = z.object({ reference: z.unknown().transform(parseWebsiteProfileReference), productName: text, oneLinePositioning: text, coreFeatures: z.array(text).max(32), market: z.object({ country: text, language: text }).strict(), fieldProvenance: z.array(fieldProvenanceSchema).max(3) }).strict();
const gsc = z.object({ status: z.enum(["available", "unavailable"]), reason: text.nullable(), property: text.nullable(), window: z.object({ startDate: z.string().date(), endDate: z.string().date() }).strict().nullable(), queryCount: z.number().int().nonnegative().max(10000).nullable(), truncated: z.boolean().nullable(), observedAt: timestamp.nullable() }).strict().superRefine((value, ctx) => {
  if (value.status === "available" ? value.reason !== null || !value.property || value.window === null || value.queryCount === null || value.truncated === null || value.observedAt === null : !value.reason || value.queryCount !== null || value.truncated !== null || value.observedAt !== null) ctx.addIssue({ code: "custom", message: "Invalid GSC availability metadata" });
});
const role = z.object({ roleId: z.string().min(1).max(64), review: geoReviewSchema, source: geoRoleSourceV2Schema, userEdited: z.boolean(), eligibleLayers: z.array(layer).max(2) }).strict();
const fact = z.object({ key: z.string().min(1).max(200), value: z.string().min(1).max(200).nullable(), reason: z.enum(["", "notPublished", "fetchFailed", "lowConfidence", "conflicting"]), review: geoReviewSchema, source: z.enum(["none", "user_confirmed", "crawl"]), sourceUrl: url.nullable(), observedAt: timestamp.nullable(), supportRef: geoFactSupportRefSchema.nullable() }).strict();
const competitor = z.object({ domain: z.string().max(255), brandName: z.string().max(200), confirmed: z.boolean(), aliases: z.array(z.string().max(200)).max(10).optional() }).strict();
const competitorEvidence = geoSourceReceiptRefSchema.extend({ receiptCreatedAt: timestamp, capture: geoCompetitorSourceV2Schema }).strict();
const schema = z.object({ schemaVersion: z.literal(GEO_SNAPSHOT_CONTEXT_SCHEMA_V2), candidateId: z.string().uuid(), kbId: z.string().uuid(), targetHost: z.string().max(255), payloadHash: hash, profile,
  sourceReceiptRefs: z.array(geoSourceReceiptRefSchema).max(32), evidenceCatalog: z.array(z.object({ id: geoEvidenceRefSchema, kind: z.enum(["profile", "gsc", "crawl", "manual"]), text: z.string().min(1).max(32768) }).strict()).max(256),
  sourceSummary: z.object({ gsc: gsc.nullable(), selectedEvidenceCounts: counts, availableEvidenceCounts: counts }).strict(), roles: z.array(role).max(5), facts: z.array(fact).max(24), competitors: z.array(competitor).max(5), competitorEvidence: z.array(competitorEvidence).max(5), skippedLayers: z.array(layer).max(2), questionSetHash: hash, contentHash: hash,
}).strict();

export function parseGeoSnapshotContextV2Shape(value: unknown): GeoSnapshotContextV2 {
  if (geoV2JsonbBytes(value) > GEO_CONTEXT_V2_MAX_BYTES) throw new Error("Context exceeds byte limit");
  const parsed = schema.parse(value);
  if (normalizeAccountWebsiteUrl(`https://${parsed.targetHost}`)?.host !== parsed.targetHost) throw new Error("Context site mismatch");
  if (geoV2JsonbBytes(parsed.evidenceCatalog) > GEO_CONTEXT_EVIDENCE_MAX_BYTES) throw new Error("Evidence catalog exceeds byte limit");
  const evidence = new Set(parsed.evidenceCatalog.map(item => item.id)), receiptIds = new Set(parsed.sourceReceiptRefs.map(item => item.receiptId));
  if (evidence.size !== parsed.evidenceCatalog.length || receiptIds.size !== parsed.sourceReceiptRefs.length || new Set(parsed.roles.map(item => item.roleId)).size !== parsed.roles.length || new Set(parsed.facts.map(item => item.key)).size !== parsed.facts.length) throw new Error("Duplicate context identity");
  if (new Set(parsed.competitorEvidence.map(item => item.capture.domain)).size !== parsed.competitorEvidence.length) throw new Error("Duplicate competitor capture");
  for (const item of parsed.competitorEvidence) {
    if (item.capture.domain === "" || !parsed.competitors.some(competitor => competitor.domain === item.capture.domain)
      || !parsed.sourceReceiptRefs.some(ref => ref.receiptId === item.receiptId && ref.contentHash === item.contentHash)
      || item.capture.observedAt !== null && item.capture.observedAt > item.receiptCreatedAt) throw new Error("Competitor capture scope mismatch");
  }
  for (const kind of ["profile", "gsc", "crawl", "manual"] as const) {
    if (parsed.sourceSummary.selectedEvidenceCounts[kind] !== parsed.evidenceCatalog.filter(item => item.kind === kind).length || parsed.sourceSummary.availableEvidenceCounts[kind] < parsed.sourceSummary.selectedEvidenceCounts[kind]) throw new Error("Evidence counts mismatch");
  }
  if (parsed.sourceSummary.selectedEvidenceCounts.gsc > 0 && parsed.sourceSummary.gsc?.status !== "available") throw new Error("Unavailable GSC cannot supply evidence");
  for (const item of parsed.roles) {
    if (item.source.evidenceRefs.some(ref => !evidence.has(ref)) || (item.source.kind !== "model" && item.userEdited) || (item.review !== "accepted" && item.eligibleLayers.length > 0) || new Set(item.eligibleLayers).size !== item.eligibleLayers.length) throw new Error("Invalid role policy/lineage");
  }
  const skipped = (["problem", "evaluation"] as const).filter(part => !parsed.roles.some(item => item.eligibleLayers.includes(part)));
  if (canonicalGeoV2Text(skipped) !== canonicalGeoV2Text(parsed.skippedLayers)) throw new Error("Invalid skipped-layer policy");
  for (const item of parsed.facts) {
    if (item.source === "none" ? item.value !== null || item.sourceUrl !== null || item.observedAt !== null || item.supportRef !== null : item.review !== "accepted" || item.reason !== "" || item.value === null || item.sourceUrl === null || item.observedAt === null) throw new Error("Invalid positive fact policy");
    if (item.source === "user_confirmed" && item.supportRef !== null) throw new Error("User confirmation is not crawl evidence");
    if (item.source === "crawl" && (item.supportRef === null || !receiptIds.has(item.supportRef.receiptId))) throw new Error("Crawl support is not in exact receipts");
  }
  return parsed;
}
