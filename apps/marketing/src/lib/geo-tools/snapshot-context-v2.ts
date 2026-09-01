// @input -- exact saved v2 content, exact questions and server-validated source selections
// @output -- self-contained v2 source policy; human review is not crawl observation
// @pos -- distinct from historical GSC-only context and unchanged v1 hashes
import type { GeoInheritedProfile } from "./asset-context.ts";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { parseGeoKbPayloadV2, geoRoleEligibleForLayer, type GeoKbPayloadV2, type GeoKbRoleSourceV2, type GeoKbReview, type GeoKbFactV2 } from "./kb-v2-contract.ts";
import { parseGeoQuestionSetV2, type GeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import { parseGeoSnapshotContext, type GeoSnapshotContext } from "./snapshot-context.ts";
import { inheritedProfileFromCopy } from "./kb-profile-copy-server.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoCompetitorSourceV2 } from "./kb-source-contract.ts";

export { GEO_SNAPSHOT_CONTEXT_SCHEMA_V2, GEO_CONTEXT_V2_MAX_BYTES, GEO_CONTEXT_EVIDENCE_MAX_BYTES, geoSourceReceiptRefSchema } from "./snapshot-context-v2-shape.ts";
import { GEO_SNAPSHOT_CONTEXT_SCHEMA_V2, parseGeoSnapshotContextV2Shape } from "./snapshot-context-v2-shape.ts";
export interface GeoSourceReceiptRef { readonly receiptId: string; readonly contentHash: string }
/** Last selected extraction, not provenance for the separately saved manual mapping. */
export interface GeoCompetitorEvidenceV2 { readonly receiptId: string; readonly contentHash: string; readonly receiptCreatedAt: string; readonly capture: GeoCompetitorSourceV2 }
export interface GeoContextEvidenceV2 { readonly id: string; readonly kind: "profile" | "gsc" | "crawl" | "manual"; readonly text: string }
export interface GeoEvidenceCountsV2 { readonly profile: number; readonly gsc: number; readonly crawl: number; readonly manual: number }
export interface GeoSourceSummaryV2 {
  readonly gsc: { readonly status: "available" | "unavailable"; readonly reason: string | null; readonly property: string | null; readonly window: { readonly startDate: string; readonly endDate: string } | null; readonly queryCount: number | null; readonly truncated: boolean | null; readonly observedAt: string | null } | null;
  readonly selectedEvidenceCounts: GeoEvidenceCountsV2;
  readonly availableEvidenceCounts: GeoEvidenceCountsV2;
}
export interface GeoSnapshotContextV2 {
  readonly schemaVersion: typeof GEO_SNAPSHOT_CONTEXT_SCHEMA_V2;
  readonly candidateId: string; readonly kbId: string; readonly targetHost: string;
  readonly payloadHash: string; readonly profile: GeoInheritedProfile;
  readonly sourceReceiptRefs: readonly GeoSourceReceiptRef[];
  readonly evidenceCatalog: readonly GeoContextEvidenceV2[];
  readonly sourceSummary: GeoSourceSummaryV2;
  readonly roles: readonly { readonly roleId: string; readonly review: GeoKbReview; readonly source: GeoKbRoleSourceV2; readonly userEdited: boolean; readonly eligibleLayers: readonly ("problem" | "evaluation")[] }[];
  readonly facts: readonly { readonly key: string; readonly value: string | null; readonly reason: GeoKbFactV2["reason"]; readonly review: GeoKbReview; readonly source: "none" | "user_confirmed" | "crawl"; readonly sourceUrl: string | null; readonly observedAt: string | null; readonly supportRef: GeoKbFactV2["supportRef"] }[];
  readonly competitors: GeoKbPayloadV2["competitors"];
  readonly competitorEvidence: readonly GeoCompetitorEvidenceV2[];
  readonly skippedLayers: readonly ("problem" | "evaluation")[];
  readonly questionSetHash: string; readonly contentHash: string;
}
export type AnyGeoSnapshotContext = GeoSnapshotContext | GeoSnapshotContextV2;
export interface GeoVerifiedFactSupportV2 { readonly receiptId: string; readonly evidenceId: string; readonly key: string; readonly value: string; readonly sourceUrl: string; readonly observedAt: string }
export interface BuildGeoSnapshotContextV2Input {
  readonly candidateId: string; readonly kbId: string; readonly payload: GeoKbPayloadV2;
  readonly questionSet: GeoQuestionSetV2;
  readonly sourceReceiptRefs: readonly GeoSourceReceiptRef[];
  readonly evidenceCatalog: readonly GeoContextEvidenceV2[];
  readonly sourceSummary: GeoSourceSummaryV2;
  readonly modelRoleEdits?: Readonly<Record<string, boolean>>;
  readonly verifiedFactSupport?: readonly GeoVerifiedFactSupportV2[];
  readonly competitorEvidence?: readonly GeoCompetitorEvidenceV2[];
}
export function parseGeoSnapshotContextV2(value: unknown): GeoSnapshotContextV2 {
  const parsed = parseGeoSnapshotContextV2Shape(value);
  const { contentHash, ...body } = parsed;
  if (geoV2Digest(body) !== contentHash) throw new Error("Context hash mismatch");
  return parsed;
}

export function parseAnyGeoSnapshotContext(value: unknown): AnyGeoSnapshotContext {
  return value !== null && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === GEO_SNAPSHOT_CONTEXT_SCHEMA_V2 ? parseGeoSnapshotContextV2(value) : parseGeoSnapshotContext(value);
}

type KnownContextInput = Omit<BuildGeoSnapshotContextV2Input, "questionSet" | "candidateId">;
function knownContextBody(input: KnownContextInput) {
  const payload = parseGeoKbPayloadV2(input.payload);
  const targetHost = normalizeAccountWebsiteUrl(payload.targetUrl)?.host;
  if (!targetHost) throw new Error("Candidate scope mismatch");
  const roles: GeoSnapshotContextV2["roles"] = payload.roles.map(item => {
    const userEdited = item.source.kind === "model" ? input.modelRoleEdits?.[item.id] : false;
    if (userEdited === undefined) throw new Error("Model role edit lineage must be server-resolved");
    return { roleId: item.id, review: item.review, source: item.source, userEdited, eligibleLayers: (["problem", "evaluation"] as const).filter(part => geoRoleEligibleForLayer(item, part)) };
  });
  const facts: GeoSnapshotContextV2["facts"] = payload.facts.map(item => {
    const positive = item.review === "accepted" && item.value !== "" && item.reason === "";
    const verified = positive && item.supportRef !== null ? input.verifiedFactSupport?.find(evidence => evidence.receiptId === item.supportRef!.receiptId && evidence.evidenceId === item.supportRef!.evidenceId && evidence.key === item.key && evidence.value === item.value && evidence.sourceUrl === item.sourceUrl && evidence.observedAt === item.observedAt) : undefined;
    const source = !positive || (item.supportRef !== null && verified === undefined) ? "none" : verified ? "crawl" : "user_confirmed";
    return { key: item.key, review: item.review, reason: item.reason, source, value: source === "none" ? null : item.value, sourceUrl: source === "none" ? null : item.sourceUrl, observedAt: source === "none" ? null : item.observedAt, supportRef: source === "crawl" ? item.supportRef : null };
  });
  return { schemaVersion: GEO_SNAPSHOT_CONTEXT_SCHEMA_V2, kbId: input.kbId, targetHost, payloadHash: geoV2Digest(payload), profile: inheritedProfileFromCopy(payload.profileCopy), sourceReceiptRefs: input.sourceReceiptRefs, evidenceCatalog: input.evidenceCatalog, sourceSummary: input.sourceSummary, roles, facts, competitors: payload.competitors, competitorEvidence: input.competitorEvidence ?? [], skippedLayers: (["problem", "evaluation"] as const).filter(part => !roles.some(item => item.eligibleLayers.includes(part))) };
}

/** All variable-width context fields are known before dispatch. UUID/digests below
 * represent their fixed encoded lengths only; no candidate/questions are created. */
export function assertGeoSnapshotContextV2KnownInput(input: KnownContextInput): void {
  parseGeoSnapshotContextV2Shape({ ...knownContextBody(input), candidateId: "00000000-0000-4000-8000-000000000000", questionSetHash: "0".repeat(64), contentHash: "0".repeat(64) });
}

export function buildGeoSnapshotContextV2(input: BuildGeoSnapshotContextV2Input): GeoSnapshotContextV2 {
  const known = knownContextBody(input), questions = parseGeoQuestionSetV2(input.questionSet);
  if (questions.country !== input.payload.market.country || questions.language !== input.payload.market.language) throw new Error("Candidate scope mismatch");
  const sourceIds = new Set(input.evidenceCatalog.map(item => item.id));
  if (questions.evidenceRefs.some(ref => !sourceIds.has(ref))) throw new Error("Question evidence is not in selected sources");
  for (const q of questions.questions) {
    const owner = known.roles.find(item => item.roleId === q.roleId);
    if (q.roleId !== null && (owner === undefined || owner.review !== "accepted")) throw new Error("Question uses an unreviewed or missing role");
    if (q.provenance.kind === "semantic" && (q.layer === "problem" || q.layer === "evaluation") && !owner?.eligibleLayers.includes(q.layer)) throw new Error("Question layer lacks reviewed role evidence");
  }
  const body = { ...known, candidateId: input.candidateId, questionSetHash: geoV2Digest(questions) };
  return parseGeoSnapshotContextV2({ ...body, contentHash: geoV2Digest(body) });
}
