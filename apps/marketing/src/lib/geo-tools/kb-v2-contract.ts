// @input -- complete GEO v2 draft content, not a provider's untrusted proposal
// @output -- strict role/fact review and lineage contracts with an exact Profile copy
// @pos -- client-safe v2 contract; legacy payloads keep their original parser
import { z } from "zod";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { parseGeoKbPayload, type GeoKbPayload, type GeoKbRole, type GeoKbFact } from "./kb-contract.ts";
import { parseGeoProfileCopy, type GeoProfileCopy } from "./kb-profile-copy.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";

export const GEO_KB_SCHEMA_VERSION_V2 = "marketing-geo-kb.v2" as const;
export const GEO_KB_V2_MAX_BYTES = 393_216;
export const geoReviewSchema = z.enum(["pending", "accepted", "excluded"]);
// eslint-disable-next-line no-control-regex
export const geoEvidenceRefSchema = z.string().min(1).max(256).regex(/^[^\s\u0000-\u001f]+$/u);
const refs = z.array(geoEvidenceRefSchema).max(32).refine(values => new Set(values).size === values.length);
const string = (max: number) => z.string().max(max);
const list = (max: number) => z.array(z.string().min(1).max(80)).max(max);
export const geoRoleSourceV2Schema = z.object({ kind: z.enum(["manual", "profile", "model"]), generationId: string(128).min(1).nullable(), itemId: string(128).min(1).nullable(), evidenceRefs: refs }).strict().superRefine((source, ctx) => {
  if (source.kind === "model" ? source.generationId === null || source.itemId === null || source.evidenceRefs.length === 0 : source.generationId !== null || source.itemId !== null) ctx.addIssue({ code: "custom", message: "Invalid role source identity" });
  if (source.kind === "profile" && source.evidenceRefs.length === 0) ctx.addIssue({ code: "custom", message: "Profile role requires source references" });
});
export const geoRoleV2Schema = z.object({ id: string(64).min(1), label: string(200), questionLabel: string(120), segment: string(200), painPoints: list(8), decisionCriteria: list(8), vocabulary: list(12), alternatives: list(8), review: geoReviewSchema, source: geoRoleSourceV2Schema }).strict().superRefine((role, ctx) => {
  if (role.review === "accepted" && (role.label.trim() === "" || role.questionLabel.trim() === "")) ctx.addIssue({ code: "custom", message: "Accepted role requires meaningful labels" });
});
export const geoFactSupportRefSchema = z.object({ receiptId: z.string().uuid(), evidenceId: geoEvidenceRefSchema }).strict();
export const absolutePublicUrl = (value: string) => {
  try { const url = new URL(value); return (url.protocol === "http:" || url.protocol === "https:") && normalizeAccountWebsiteUrl(value) !== null; }
  catch { return false; }
};
export const validTimestamp = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const geoFactV2Schema = z.object({ key: string(200).min(1), value: string(200), reason: z.enum(["", "notPublished", "fetchFailed", "lowConfidence", "conflicting"]), sourceUrl: string(2048), observedAt: string(40), review: geoReviewSchema, supportRef: geoFactSupportRefSchema.nullable() }).strict().superRefine((fact, ctx) => {
  // Unreviewed legacy source/time strings remain editable without loss. Only
  // accepted positive values acquire the stricter source/time obligation.
  if (fact.value === "" && fact.reason === "") ctx.addIssue({ code: "custom", message: "Unknown fact requires a reason" });
  if (fact.review === "accepted" && fact.value !== "" && (fact.reason !== "" || !absolutePublicUrl(fact.sourceUrl) || !validTimestamp(fact.observedAt))) ctx.addIssue({ code: "custom", message: "Accepted fact requires conflict-free source and time" });
});
export type GeoKbReview = z.infer<typeof geoReviewSchema>;
export type GeoKbRoleSourceV2 = Readonly<Omit<z.infer<typeof geoRoleSourceV2Schema>, "evidenceRefs">> & { readonly evidenceRefs: readonly string[] };
export interface GeoKbRoleV2 extends GeoKbRole {
  readonly alternatives: readonly string[]; readonly questionLabel: string;
  readonly review: GeoKbReview; readonly source: GeoKbRoleSourceV2;
}
export interface GeoKbFactV2 extends GeoKbFact {
  readonly review: GeoKbReview;
  readonly supportRef: z.infer<typeof geoFactSupportRefSchema> | null;
}
export interface GeoKbPayloadV2 extends Omit<GeoKbPayload, "schemaVersion" | "roles" | "facts" | "profileCopy"> {
  readonly schemaVersion: typeof GEO_KB_SCHEMA_VERSION_V2;
  readonly profileCopy: GeoProfileCopy;
  readonly roles: readonly GeoKbRoleV2[];
  readonly facts: readonly GeoKbFactV2[];
}
export type AnyGeoKbPayload = GeoKbPayload | GeoKbPayloadV2;
const supplementSchema = z.object({
  schemaVersion: z.literal(GEO_KB_SCHEMA_VERSION_V2), targetUrl: z.string(), officialName: z.string(), aliases: z.array(z.string()), categoryTerms: z.array(z.string()),
  market: z.object({ country: z.string(), language: z.string() }).strict(),
  roles: z.array(geoRoleV2Schema).max(5), facts: z.array(geoFactV2Schema).max(24),
  competitors: z.array(z.unknown()), importedFrom: z.unknown(), profileCopy: z.unknown().transform(parseGeoProfileCopy),
}).strict();

export function parseGeoKbPayloadV2(value: unknown): GeoKbPayloadV2 {
  if (geoV2JsonbBytes(value) > GEO_KB_V2_MAX_BYTES) throw new Error("GEO v2 payload exceeds byte limit");
  const parsed = supplementSchema.parse(value);
  // Reuse unchanged operational bounds while keeping v2 review-only facts
  // separate: pending proposals may legitimately have no support URL yet.
  const base = parseGeoKbPayload({ ...parsed, schemaVersion: "marketing-geo-kb.v1", roles: parsed.roles.map(({ alternatives: _a, questionLabel: _q, review: _r, source: _s, ...role }) => role), facts: [] });
  if (!base.ok) throw new Error(`Invalid GEO base: ${base.reason}`);
  if (new Set(parsed.facts.map(fact => fact.key)).size !== parsed.facts.length) throw new Error("Duplicate fact key");
  const result = { ...base.value, schemaVersion: GEO_KB_SCHEMA_VERSION_V2, profileCopy: parsed.profileCopy, roles: parsed.roles, facts: parsed.facts };
  if (canonicalGeoV2Text(result) !== canonicalGeoV2Text(value)) throw new Error("GEO v2 input must already be canonical and exact");
  return result;
}

export function parseAnyGeoKbPayload(value: unknown): AnyGeoKbPayload {
  if (value !== null && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === GEO_KB_SCHEMA_VERSION_V2) return parseGeoKbPayloadV2(value);
  const parsed = parseGeoKbPayload(value);
  if (!parsed.ok) throw new Error(`Invalid legacy GEO payload: ${parsed.reason}`);
  return parsed.value;
}

export function geoRoleEligibleForLayer(role: GeoKbRoleV2, layer: "problem" | "evaluation"): boolean {
  return role.review === "accepted" && role.questionLabel.trim() !== "" && (layer === "problem" ? role.painPoints : role.decisionCriteria).some(value => value.trim() !== "");
}
