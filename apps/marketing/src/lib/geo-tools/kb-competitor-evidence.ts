// @input -- exact owner-validated receipt selections and the saved competitor domains
// @output -- complete last selected capture per current domain, including failures
// @pos -- prepare-time pure selection; neither freeze nor historical reads fetch sources
import type { GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import type { GeoKbSourceReportV2 } from "./kb-source-contract.ts";
import type { GeoCompetitorEvidenceV2, GeoSourceReceiptRef } from "./snapshot-context-v2.ts";
import { verifyGeoKbSourceReportV2 } from "./kb-sources.ts";

export function selectGeoCompetitorEvidence(input: {
  readonly kbId: string; readonly targetHost: string;
  readonly competitors: GeoKbPayloadV2["competitors"];
  readonly sourceReceiptRefs: readonly GeoSourceReceiptRef[];
  readonly receipts: readonly GeoKbSourceReportV2[];
}): readonly GeoCompetitorEvidenceV2[] {
  const refs = new Map(input.sourceReceiptRefs.map(ref => [ref.receiptId, ref.contentHash]));
  const domains = input.competitors.map(item => item.domain).filter(Boolean);
  if (refs.size !== input.sourceReceiptRefs.length || refs.size !== input.receipts.length
    || new Set(input.receipts.map(receipt => receipt.receiptId)).size !== input.receipts.length
    || new Set(domains).size !== domains.length) throw new Error("Ambiguous competitor source selection");
  const receipts = input.receipts.map(value => {
    const receipt = verifyGeoKbSourceReportV2(value);
    const capturedDomains = receipt.competitors.map(item => item.domain).filter(Boolean);
    if (receipt.kbId !== input.kbId || receipt.targetHost !== input.targetHost || refs.get(receipt.receiptId) !== receipt.contentHash
      || new Set(capturedDomains).size !== capturedDomains.length) throw new Error("Competitor source scope mismatch");
    return receipt;
  }).sort((a, b) => a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.receiptId < b.receiptId ? 1 : -1);
  return input.competitors.flatMap(competitor => {
    if (competitor.domain === "") return [];
    const receipt = receipts.find(item => item.competitors.some(capture => capture.domain === competitor.domain));
    if (!receipt) return [];
    const capture = receipt.competitors.find(item => item.domain === competitor.domain)!;
    return [{ receiptId: receipt.receiptId, contentHash: receipt.contentHash, receiptCreatedAt: receipt.createdAt, capture }];
  });
}
