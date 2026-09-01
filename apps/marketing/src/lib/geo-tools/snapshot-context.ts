// @input -- owner-resolved draft/Profile and an immutable server-read enrichment receipt
// @output -- exact frozen context and source-conditioned questions; never client provenance
// @pos -- additive GEO context; historical KB payload hashes remain unchanged
import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeAccountWebsiteUrl, parseWebsiteProfileReference, fieldProvenanceSchema } from "../account-websites/contracts.ts";
import type { GeoInheritedProfile } from "./asset-context.ts";
import { type GeoKbPayload, type GeoKbValue } from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { canonicalGeoEnrichmentText, verifyGeoEnrichmentReport } from "./kb-enrichment.ts";
import type { GeoKbEnrichmentReport } from "./kb-enrichment-contract.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest, type GeoQuestionSet } from "./kb-questions.ts";

export const GEO_SNAPSHOT_CONTEXT_SCHEMA = "marketing-geo-snapshot-context.v1" as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = z.string().max(2048);
const url = text.refine((value) => normalizeAccountWebsiteUrl(value) !== null);
const profileReference = z.custom<GeoInheritedProfile["reference"]>((value) => {
  try { parseWebsiteProfileReference(value); return true; } catch { return false; }
});
const source = z.enum(["kb", "crawl"]);
const sourceFields = { source, sourceUrl: url.nullable(), observedAt: text.nullable(), evidenceId: z.string().max(64).nullable() };
const roleSchema = z.object({ roleId: z.string().max(64), source: z.enum(["kb", "gsc"]), evidenceId: z.string().max(64).nullable(), queryCount: z.number().int().positive().nullable(), window: z.object({ startDate: z.string().date(), endDate: z.string().date() }).strict().nullable() }).strict();
const factSchema = z.object({ key: text, value: text.nullable(), reason: z.enum(["", "notPublished", "fetchFailed", "lowConfidence", "conflicting"]), ...sourceFields }).strict();
const competitorSchema = z.object({ domain: text, brandName: text, aliases: z.array(text).max(10), ...sourceFields }).strict();
const contextSchema = z.object({
  schemaVersion: z.literal(GEO_SNAPSHOT_CONTEXT_SCHEMA), kbId: z.string().uuid(), targetHost: text, payloadHash: hash,
  profile: z.object({ reference: profileReference, productName: text, oneLinePositioning: text, coreFeatures: z.array(text).max(32).readonly(), market: z.object({ country: text, language: text }).strict(), fieldProvenance: z.array(fieldProvenanceSchema).max(3).refine((rows) => rows.every((row) => ["/productName", "/oneLinePositioning", "/coreFeatures"].includes(row.path)) && new Set(rows.map((row) => row.path)).size === rows.length).readonly().optional() }).strict().nullable(),
  enrichment: z.object({ receiptId: z.string().uuid(), contentHash: hash }).strict().nullable(),
  roles: z.array(roleSchema).max(6), facts: z.array(factSchema).max(24), competitors: z.array(competitorSchema).max(5),
  skippedLayers: z.array(z.enum(["problem", "evaluation"])).max(2), questionSetHash: hash, contentHash: hash,
}).strict();
export type GeoSnapshotContext = z.infer<typeof contextSchema>;
export type GeoSnapshotContextBody = Omit<GeoSnapshotContext, "contentHash">;

export function geoSnapshotContextHash(body: GeoSnapshotContextBody): string {
  return createHash("sha256").update(canonicalGeoEnrichmentText(body)).digest("hex");
}

export function parseGeoSnapshotContext(value: unknown): GeoSnapshotContext {
  if (Buffer.byteLength(JSON.stringify(value) ?? "") > 262_144) throw new Error("context exceeds byte limit");
  const parsed = contextSchema.parse(value);
  const { contentHash, ...body } = parsed;
  if (geoSnapshotContextHash(body) !== contentHash) throw new Error("context hash mismatch");
  if (normalizeAccountWebsiteUrl(`https://${parsed.targetHost}`)?.host !== parsed.targetHost) throw new Error("invalid context host");
  const actualSkip = parsed.roles.some((role) => role.source === "gsc") ? [] : ["problem", "evaluation"];
  if (JSON.stringify(parsed.skippedLayers) !== JSON.stringify(actualSkip)) throw new Error("inconsistent skipped layers");
  for (const role of parsed.roles) {
    if (role.source === "gsc" ? !parsed.enrichment || !role.evidenceId || !role.queryCount || !role.window : role.evidenceId !== null || role.queryCount !== null || role.window !== null) throw new Error("invalid role provenance");
  }
  for (const item of [...parsed.facts, ...parsed.competitors]) {
    if (item.source === "crawl" && (!parsed.enrichment || !item.evidenceId || !item.sourceUrl || !item.observedAt)) throw new Error("invalid crawl provenance");
    if (item.source === "kb" && item.evidenceId !== null) throw new Error("manual evidence id");
  }
  return parsed;
}

/** Input receipt comes from the private store, never directly from an HTTP body. */
export function buildGeoSnapshotContext(input: {
  readonly kbId: string; readonly targetHost: string; readonly payload: GeoKbPayload;
  readonly profile: GeoInheritedProfile | null; readonly receipt: GeoKbEnrichmentReport | null;
}): { readonly context: GeoSnapshotContext; readonly questionSet: GeoQuestionSet } {
  input = { ...input, kbId: input.kbId.toLowerCase() };
  const same = (a: unknown, b: unknown) => canonicalGeoEnrichmentText(a) === canonicalGeoEnrichmentText(b);
  const receipt = input.receipt === null ? null : verifyGeoEnrichmentReport(input.receipt);
  if (receipt && (receipt.kbId !== input.kbId || receipt.targetHost !== input.targetHost || !same(receipt.profileReference, input.profile?.reference ?? null))) throw new Error("receipt scope mismatch");
  const roles = input.payload.roles.map((role): GeoSnapshotContext["roles"][number] => {
    const evidence = receipt?.gsc.roles.find((candidate) => same(candidate.role, role));
    return evidence && receipt?.gsc.status === "available"
      ? { roleId: role.id, source: "gsc", evidenceId: evidence.evidenceId, queryCount: evidence.queryCount, window: receipt.gsc.window }
      : { roleId: role.id, source: "kb", evidenceId: null, queryCount: null, window: null };
  });
  const supportedRoles = new Set(roles.filter((role) => role.source === "gsc").map((role) => role.roleId));
  const skippedLayers: GeoSnapshotContext["skippedLayers"] = supportedRoles.size === 0 ? ["problem", "evaluation"] : [];
  const generated = buildGeoQuestionSet(input.payload);
  const questionSet: GeoQuestionSet = { ...generated, questions: generated.questions.filter((question) => {
    if (question.layer !== "problem" && question.layer !== "evaluation") return true;
    return supportedRoles.size > 0 && (question.roleId === null || supportedRoles.has(question.roleId));
  }) };
  const facts = input.payload.facts.map((fact): GeoSnapshotContext["facts"][number] => {
    const evidence = receipt?.facts.find((candidate) => candidate.status === "available" && candidate.key === fact.key && candidate.value === fact.value && candidate.sourceUrl === fact.sourceUrl);
    const sourced = evidence?.status === "available" && fact.value !== "";
    return { key: fact.key, value: fact.value || null, reason: fact.reason, source: sourced ? "crawl" : "kb", sourceUrl: fact.sourceUrl || null, observedAt: sourced ? evidence.observedAt : fact.observedAt || null, evidenceId: sourced ? evidence.evidenceId : null };
  });
  const competitors = input.payload.competitors.map((competitor): GeoSnapshotContext["competitors"][number] => {
    const evidence = receipt?.competitors.find((candidate) => candidate.status === "available" && candidate.domain === competitor.domain && candidate.brandName === competitor.brandName && same(candidate.aliases, competitor.aliases ?? []));
    const sourced = evidence?.status === "available";
    return { domain: competitor.domain, brandName: competitor.brandName, aliases: [...competitor.aliases ?? []], source: sourced ? "crawl" : "kb", sourceUrl: sourced ? evidence.sourceUrl : null, observedAt: sourced ? evidence.observedAt : null, evidenceId: sourced ? evidence.evidenceId : null };
  });
  const body: GeoSnapshotContextBody = {
    schemaVersion: GEO_SNAPSHOT_CONTEXT_SCHEMA, kbId: input.kbId, targetHost: input.targetHost,
    payloadHash: geoKbDigest(input.payload as unknown as GeoKbValue), profile: input.profile === null ? null : {
      reference: input.profile.reference, productName: input.profile.productName,
      oneLinePositioning: input.profile.oneLinePositioning, coreFeatures: input.profile.coreFeatures,
      market: input.profile.market,
      ...(input.profile.fieldProvenance === undefined ? {} : { fieldProvenance: input.profile.fieldProvenance }),
    },
    enrichment: receipt ? { receiptId: receipt.receiptId, contentHash: receipt.contentHash } : null,
    roles, facts, competitors, skippedLayers, questionSetHash: geoQuestionSetDigest(questionSet),
  };
  return { context: parseGeoSnapshotContext({ ...body, contentHash: geoSnapshotContextHash(body) }), questionSet };
}
