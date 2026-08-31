import { describe, expect, it } from "vitest";
import {
  clusterGeoQueries, extractCompetitorIdentity, inspectGeoFact,
  enrichmentContentHash, finalizeGeoEnrichmentReport, selectGeoGscProperty,
} from "./kb-enrichment.ts";
import { parseGeoKbEnrichmentReport } from "./kb-enrichment-contract.ts";

const URL = "https://rival.example/";
const AT = "2026-08-31T00:00:00.000Z";
const HTML = '<html><head><script type="application/ld+json">{"@type":"Organization","name":"Rival Analytics","alternateName":["Rival","RA"]}</script></head><body><p>Team plan pricing: USD 20 per month.</p></body></html>';
const PAGE = { kind: "ok" as const, url: URL, body: HTML, observedAt: AT };

describe("actual GEO enrichment extraction", () => {
  it("extracts structured homepage names and aliases as unconfirmed crawl candidates", () => {
    const result = extractCompetitorIdentity("rival.example", PAGE, "C1");
    expect(result).toMatchObject({ status: "available", source: "crawl", domain: "rival.example", brandName: "Rival Analytics", aliases: ["Rival", "RA"], confirmed: false, sourceUrl: URL, observedAt: AT, method: "json_ld" });
    expect(result.bodyHash).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("does not pretend a hostname or parse failure is an observed brand", () => {
    const result = extractCompetitorIdentity("rival.example", { ...PAGE, body: "<body>No identity</body>" }, "C1");
    expect(result).toMatchObject({ status: "unavailable", reason: "not_found", brandName: null, aliases: [], source: null });
    expect(extractCompetitorIdentity("rival.example", { kind: "unavailable", reason: "fetch_failed", url: URL }, "C1")).toMatchObject({ observedAt: null, bodyHash: null, source: null });
  });
  it("never takes a foreign redirect's brand as the requested competitor", () => {
    expect(extractCompetitorIdentity("rival.example", { ...PAGE, url: "https://foreign.example/" }, "C1")).toMatchObject({ status: "unavailable", reason: "target_redirected", brandName: null });
  });
  it("only backs a fact with an actual visible excerpt containing both its key and value", () => {
    const fact = { key: "Team plan pricing", value: "USD 20 per month", reason: "" as const, sourceUrl: URL, observedAt: "" };
    expect(inspectGeoFact(fact, PAGE, "F1")).toMatchObject({ source: "crawl", status: "available", value: fact.value, sourceUrl: URL, observedAt: AT, excerpt: "Team plan pricing: USD 20 per month." });
    expect(inspectGeoFact(fact, { ...PAGE, body: `<script>${fact.key}: ${fact.value}</script><body>Nothing here</body>` }, "F1")).toMatchObject({ status: "unavailable", source: null, value: null, reason: "not_found" });
    expect(inspectGeoFact(fact, { kind: "unavailable", reason: "fetch_failed", url: URL }, "F1")).toMatchObject({ status: "unavailable", source: null, observedAt: null });
  });
  it("does not promote a numeric substring or hidden markup into fact evidence", () => {
    const fact = { key: "Price", value: "$1", reason: "" as const, sourceUrl: URL, observedAt: "" };
    expect(inspectGeoFact(fact, { ...PAGE, body: "<p>Price: $100</p>" }, "F1").status).toBe("unavailable");
    expect(inspectGeoFact(fact, { ...PAGE, body: '<p hidden>Price: $1</p><p>Content</p>' }, "F1").status).toBe("unavailable");
  });
});

describe("server chosen GSC property and deterministic query clusters", () => {
  it("selects only the exact domain or root URL property, never a sibling or URL substring", () => {
    expect(selectGeoGscProperty("example.com", ["https://evil.test/example.com/", "sc-domain:other.example", "https://www.example.com/", "sc-domain:example.com"])).toBe("sc-domain:example.com");
    expect(selectGeoGscProperty("example.com", ["https://example.com/blog/"])).toBeNull();
    expect(selectGeoGscProperty("example.com", ["https://www.example.com/"])).toBe("https://www.example.com/");
  });
  it("forms stable bounded query-interest candidates without inventing personas", () => {
    const queries = ["how to compare analytics tools", "analytics pricing", "analytics for teams", "garden watering", "garden sprinkler"];
    const first = clusterGeoQueries(queries);
    expect(clusterGeoQueries([...queries].reverse())).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
    expect(first[0]).toMatchObject({ source: "gsc", queryCount: 3, queries: expect.arrayContaining(["analytics pricing"]) });
    expect(first[0]?.role.label).toContain("analytics");
    expect(first[0]?.role.label).not.toMatch(/manager|founder|owner/iu);
    expect(clusterGeoQueries([])).toEqual([]);
  });
  it("preserves total queryCount even when representative query samples are bounded", () => {
    const roles = clusterGeoQueries(Array.from({ length: 80 }, (_, index) => `analytics workflow ${index}`));
    expect(roles[0]?.queryCount).toBe(80);
    expect(roles[0]?.queries).toHaveLength(50);
    expect(roles[0]?.queriesTruncated).toBe(true);
  });
});

describe("immutable enrichment receipt", () => {
  const report = () => finalizeGeoEnrichmentReport({
    schemaVersion: "marketing-geo-kb-enrichment.v1", receiptId: "b920cd2e-c645-4df6-a80e-4f434dd09266", kbId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6", targetHost: "example.com", draftVersion: 2, draftHash: "a".repeat(64), profileReference: null, createdAt: AT,
    competitors: [extractCompetitorIdentity("rival.example", PAGE, "C1")], facts: [],
    gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, roles: [] }, skippedLayers: ["problem", "evaluation"],
  });
  it("validates exact evidence and a hash that changes for every material change", () => {
    const value = report();
    expect(parseGeoKbEnrichmentReport(value)).toEqual(value);
    const { contentHash: _hash, ...body } = value;
    expect(enrichmentContentHash(body)).toBe(value.contentHash);
    expect(enrichmentContentHash({ ...body, draftVersion: 3 })).not.toBe(value.contentHash);
  });
  it("rejects false observed receipts, unsafe numeric values, and extra secret fields", () => {
    const value = report();
    expect(() => parseGeoKbEnrichmentReport({ ...value, accessToken: "never-allowed" })).toThrow();
    expect(() => parseGeoKbEnrichmentReport({ ...value, draftVersion: Infinity })).toThrow();
    expect(() => parseGeoKbEnrichmentReport({ ...value, gsc: { ...value.gsc, queryCount: 0 } })).toThrow();
    expect(() => parseGeoKbEnrichmentReport({ ...value, competitors: [{ ...value.competitors[0], observedAt: null }] })).toThrow();
  });
});
