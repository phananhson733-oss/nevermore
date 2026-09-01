// Offline complete wire fixture; never imported by runtime components.
import { completePayloadV2, questionSetV2, V2_KB_ID, V2_CANDIDATE_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { createGeoPreparedCandidate } from "../../lib/geo-tools/kb-prepared-contract.ts";
import { buildGeoSnapshotContextV2 } from "../../lib/geo-tools/snapshot-context-v2.ts";
import { geoV2Digest } from "../../lib/geo-tools/kb-v2-digest.ts";
import { profileCopyReference } from "../../lib/geo-tools/kb-profile-copy.ts";
import type { GeoKbEditorViewV2 } from "./geo-kb-v2-wire.ts";
import type { GeoKbSourceReportV2 } from "../../lib/geo-tools/kb-source-contract.ts";
export function editorFixture(): GeoKbEditorViewV2 {
  const payload = completePayloadV2(), questionSet = questionSetV2();
  const context = buildGeoSnapshotContextV2({ kbId: V2_KB_ID, candidateId: V2_CANDIDATE_ID, payload, questionSet, sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { manual: 1, profile: 0, gsc: 0, crawl: 0 }, availableEvidenceCounts: { manual: 1, profile: 0, gsc: 0, crawl: 0 } } });
  const prepared = createGeoPreparedCandidate({ schemaVersion: "marketing-geo-prepared-candidate.v1", candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, baseDraftVersion: "1", baseDraftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy), sourceReceiptRefs: [], generatorVersion: "geo-semantic.v1", payload, questionSet, context });
  return { schemaVersion: "marketing-geo-kb-editor.v2", kbId: V2_KB_ID, origin: "https://example.com", host: "example.com", draftVersion: 1, draftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy), payload, requiresSave: false,
    profile: { reference: profileCopyReference(payload.profileCopy), fullProfile: payload.profileCopy.profile, productName: payload.profileCopy.profile.productName, oneLinePositioning: payload.profileCopy.profile.oneLinePositioning, coreFeatures: payload.profileCopy.profile.coreFeatures, market: payload.market },
    frozen: null, sourceReceipt: null, prepared, generations: { roles: null, questions: null } };
}
export function sourceFixture(view = editorFixture()): GeoKbSourceReportV2 {
  return { schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId: "33333333-3333-4333-8333-333333333333", kbId: view.kbId, targetHost: view.host, draftVersion: view.draftVersion, draftHash: view.draftHash!, profileReference: profileCopyReference(view.payload.profileCopy), createdAt: "2026-08-31T00:00:00.000Z", contentHash: "b".repeat(64), competitors: [], facts: [], gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] } };
}
