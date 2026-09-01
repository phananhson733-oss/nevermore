import { describe, expect, it } from "vitest";
import { selectGeoCompetitorEvidence } from "./kb-competitor-evidence.ts";
import { extractGeoCompetitorSourceV2, finalizeGeoKbSourceReportV2 } from "./kb-sources.ts";
import { V2_KB_ID } from "./kb-v2.test-fixtures.ts";

const AT = "2026-08-31T00:00:00.000Z";
const competitor = { domain: "rival.example", brandName: "Current manual name", confirmed: true };
function receipt(id: string, createdAt = AT, failed = false) {
  const capture = extractGeoCompetitorSourceV2(competitor.domain, failed
    ? { kind: "unavailable", url: "https://rival.example/", reason: "fetch_failed" }
    : { kind: "ok", url: "https://rival.example/", observedAt: AT, body: '<meta property="og:site_name" content="Original name">' }, "C1");
  return finalizeGeoKbSourceReportV2({ schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId: id, kbId: V2_KB_ID, targetHost: "example.com", draftVersion: 1, draftHash: "a".repeat(64), profileReference: null, createdAt,
    competitors: [capture], facts: [], gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] } });
}
function input(receipts = [receipt("11111111-1111-4111-8111-111111111111")]) {
  return { kbId: V2_KB_ID, targetHost: "example.com", competitors: [competitor], receipts, sourceReceiptRefs: receipts.map(({ receiptId, contentHash }) => ({ receiptId, contentHash })) };
}
describe("exact selected competitor extraction", () => {
  it("preserves the latest failure even when an older capture succeeded, without changing the manual mapping", () => {
    const first = receipt("11111111-1111-4111-8111-111111111111"), last = receipt("11111111-1111-4111-8111-111111111112", "2026-08-31T01:00:00.000Z", true);
    const value = input([last, first]), before = JSON.stringify(value);
    expect(selectGeoCompetitorEvidence(value)).toEqual([{ receiptId: last.receiptId, contentHash: last.contentHash, receiptCreatedAt: last.createdAt, capture: last.competitors[0] }]);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("breaks equal capture times by receipt identity rather than reader order", () => {
    const first = receipt("11111111-1111-4111-8111-111111111111"), last = receipt("11111111-1111-4111-8111-111111111112");
    expect(selectGeoCompetitorEvidence(input([first, last]))).toEqual(selectGeoCompetitorEvidence(input([last, first])));
    expect(selectGeoCompetitorEvidence(input([first, last]))[0]!.receiptId).toBe(last.receiptId);
  });
  it("does not invent missing captures or retain removed competitors", () => {
    expect(selectGeoCompetitorEvidence(input([]))).toEqual([]);
    expect(selectGeoCompetitorEvidence({ ...input(), competitors: [{ ...competitor, domain: "other.example" }] })).toEqual([]);
  });
  it("does not require or invent extraction identity for brand-only competitors", () => {
    const competitors = [{ ...competitor, domain: "", brandName: "Rival A" }, { ...competitor, domain: "", brandName: "Rival B" }];
    expect(selectGeoCompetitorEvidence({ ...input([]), competitors })).toEqual([]);
    const { contentHash: _hash, ...body } = receipt("11111111-1111-4111-8111-111111111111");
    const failed = finalizeGeoKbSourceReportV2({ ...body, competitors: competitors.map((_, index) => extractGeoCompetitorSourceV2("", { kind: "unavailable", url: null, reason: "missing_url" }, `C${index + 1}`)) });
    expect(selectGeoCompetitorEvidence({ ...input([failed]), competitors })).toEqual([]);
  });
  it.each(["scope", "host", "hash", "missing_receipt", "unselected_receipt", "duplicate_receipt", "duplicate_domain"])("refuses %s rather than silently changing the selected source basis", kind => {
    const value = input();
    if (kind === "scope") value.kbId = "22222222-2222-4222-8222-222222222222";
    if (kind === "host") value.targetHost = "other.example";
    if (kind === "hash") value.receipts[0]!.competitors[0]!.sourceUrl = "https://rival.example/changed";
    if (kind === "missing_receipt") value.receipts = [];
    if (kind === "unselected_receipt") value.sourceReceiptRefs = [];
    if (kind === "duplicate_receipt") value.receipts.push(value.receipts[0]!);
    if (kind === "duplicate_domain") value.competitors.push(competitor);
    expect(() => selectGeoCompetitorEvidence(value)).toThrow();
  });
});
