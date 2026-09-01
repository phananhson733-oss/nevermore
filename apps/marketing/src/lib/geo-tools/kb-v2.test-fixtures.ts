import { createHash } from "node:crypto";
import { emptyMarketingWebsiteProfile, canonicalProfileJson } from "../account-websites/contracts.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { contextPayload, CONTEXT_PROFILE } from "./snapshot-context.test-fixtures.ts";
import { parseGeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { parseGeoQuestionSetV2 } from "./kb-question-set-v2.ts";

export const V2_KB_ID = "11111111-1111-4111-8111-111111111113";
export const V2_CANDIDATE_ID = "11111111-1111-4111-8111-111111111119";
export function completePayloadV2() {
  const profile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", country: "US", locale: "en" };
  const profileCopy = createGeoProfileCopy({ ...CONTEXT_PROFILE.reference, profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") }, profile);
  return parseGeoKbPayloadV2({ ...contextPayload(), schemaVersion: "marketing-geo-kb.v2", profileCopy,
    roles: [{ id: "r1", label: "Finance teams", questionLabel: "finance teams", segment: "small companies", painPoints: ["late invoices"], decisionCriteria: ["setup effort"], vocabulary: ["receivables"], alternatives: ["spreadsheets"], review: "accepted", source: { kind: "manual", generationId: null, itemId: null, evidenceRefs: ["manual:r1"] } }],
    facts: [{ key: "Seats", value: "3", reason: "", sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31T00:00:00.000Z", review: "accepted", supportRef: null }],
  });
}
export function questionSetV2() {
  return parseGeoQuestionSetV2({ schemaVersion: "marketing-geo-question-set.v2", registryVersion: "none", methodVersion: "geo-semantic.v1", language: "en", country: "US", evidenceRefs: ["manual:r1"], entityCatalog: [{ id: "E1", text: "late invoices", kind: "role_pain", roleId: "r1", evidenceRefs: ["manual:r1"] }], questions: [{ id: "q1", text: "How can finance teams reduce late invoices?", layer: "problem", mode: "demand", roleId: "r1", requiredEntities: ["late invoices"], templateId: null, calibrated: false, provenance: { kind: "semantic", generatorVersion: "geo-semantic.v1", evidenceRefs: ["manual:r1"], entityRefs: ["E1"] } }] });
}
