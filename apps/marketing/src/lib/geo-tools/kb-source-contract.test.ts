import { describe, expect, it } from "vitest";
import { collectGeoQueryEvidenceV2 } from "./kb-sources.ts";
import { parseGeoKbSourceReportV2 } from "./kb-source-contract.ts";

const AT = "2026-08-31T00:00:00.000Z";
function receipt() {
  return { schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId: "11111111-1111-4111-8111-111111111111", kbId: "22222222-2222-4222-8222-222222222222",
    targetHost: "example.com", draftVersion: 1, draftHash: "a".repeat(64), profileReference: null, createdAt: AT, contentHash: "b".repeat(64), competitors: [], facts: [],
    gsc: { status: "available", reason: null, property: "sc-domain:example.com", window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: 1, truncated: false, observedAt: AT, queries: collectGeoQueryEvidenceV2(["single observed query"]) },
  };
}
describe("V2 source receipt boundary", () => {
  it("accepts actual singleton query evidence without a persona projection", () => {
    expect(parseGeoKbSourceReportV2(receipt())).toEqual(receipt());
  });
  it.each(["extra", "old_schema", "query_count", "duplicate_query", "foreign_property", "window", "legacy_roles", "unavailable_queries", "future_observation"])("rejects %s rather than repairing source evidence", (kind) => {
    const value = receipt();
    if (kind === "extra") Object.assign(value, { accessToken: "not-part-of-the-contract" });
    if (kind === "old_schema") value.schemaVersion = "marketing-geo-kb-enrichment.v1";
    if (kind === "query_count") value.gsc.queryCount = 99;
    if (kind === "duplicate_query") { value.gsc.queries = [...value.gsc.queries, ...value.gsc.queries]; value.gsc.queryCount = 2; }
    if (kind === "foreign_property") value.gsc.property = "sc-domain:other.example";
    if (kind === "window") value.gsc.window.startDate = "2026-05-31";
    if (kind === "legacy_roles") Object.assign(value.gsc, { roles: [] });
    if (kind === "unavailable_queries") value.gsc.status = "unavailable";
    if (kind === "future_observation") value.gsc.observedAt = "2026-09-01T00:00:00.000Z";
    expect(() => parseGeoKbSourceReportV2(value)).toThrow();
  });
  it("retains the full bounded UTF-8 query inventory even when it exceeds V1's 512 KiB", () => {
    const value = receipt();
    value.gsc.queries = collectGeoQueryEvidenceV2(Array.from({ length: 1_000 }, (_, index) => `${String(index).padStart(4, "0")}${"界".repeat(508)}`));
    value.gsc.queryCount = 1_000; value.gsc.truncated = true;
    expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(512 * 1024);
    expect(parseGeoKbSourceReportV2(value)).toEqual(value);
  });
});
