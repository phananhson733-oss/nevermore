import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectGeoQueryEvidenceV2, extractGeoCompetitorSourceV2, inspectGeoFactSourceV2, finalizeGeoKbSourceReportV2, verifyGeoKbSourceReportV2, geoKbSourceCatalogueV2 } from "./kb-sources.ts";
import { canonicalGeoEnrichmentText } from "./kb-enrichment.ts";
import { GEO_KB_SOURCE_SCHEMA } from "./kb-source-contract.ts";

describe("V2 actual query evidence", () => {
  it("retains a singleton query with a content-stable identifier", () => {
    const text = "how to read a natal chart";
    expect(collectGeoQueryEvidenceV2([text])).toEqual([
      { id: `G${createHash("sha256").update(text).digest("hex")}`, text },
    ]);
  });
  it("keeps every unique real query without rewriting case or whitespace", () => {
    const inputs = ["a singleton", "  Actual  query ", "Actual Query", "a singleton"];
    expect(collectGeoQueryEvidenceV2(inputs).map((query) => query.text)).toEqual([...new Set(inputs)].sort());
    expect(collectGeoQueryEvidenceV2([...inputs].reverse())).toEqual(collectGeoQueryEvidenceV2(inputs));
  });
  it.each(["", "  ", "x".repeat(513), "invalid\u0001query", "bad\ud800query"])("refuses invalid query input instead of truncating or repairing it", (query) => {
    expect(() => collectGeoQueryEvidenceV2([query])).toThrow();
  });
});

describe("V2 bounded facts remain unconfirmed source evidence", () => {
  const fact = { key: "Price", value: "$20", reason: "" as const, sourceUrl: "https://rival.example/", observedAt: "" };
  it("retains positive visible support without converting it into human confirmation", () => {
    expect(inspectGeoFactSourceV2(fact, page("<p>Price: $20 per month.</p>"), "F1")).toMatchObject({ status: "available", value: "$20", confirmed: false, source: "crawl", observedAt: AT });
  });
  it.each(["<p>Price: $30 per month.</p>", "<p>Price is not $20.</p>", "<p>Price: $20.</p><p>Price: $30.</p>"])("preserves a provable numeric or negated conflict: %s", (body) => {
    expect(inspectGeoFactSourceV2(fact, page(body), "F1")).toMatchObject({ status: "conflict", reason: "conflicting", value: null, confirmed: false, source: "crawl" });
  });
  it("keeps an unknown value distinct from a failed or absent source", () => {
    expect(inspectGeoFactSourceV2({ ...fact, value: "" }, page("<p>Price not disclosed.</p>"), "F1")).toMatchObject({ status: "unavailable", reason: "value_missing", value: null, confirmed: false });
    expect(inspectGeoFactSourceV2(fact, { kind: "unavailable", reason: "fetch_failed", url: URL }, "F1")).toMatchObject({ status: "unavailable", reason: "fetch_failed", value: null, source: null });
    expect(inspectGeoFactSourceV2(fact, page("<p>No pricing information.</p>"), "F1")).toMatchObject({ status: "unavailable", reason: "not_found", value: null });
  });
  it("does not invent a conflict from a number attached to another dimension", () => {
    expect(inspectGeoFactSourceV2(fact, page("<p>Price: $20 per month.</p><p>Seats: 30.</p>"), "F1")).toMatchObject({ status: "available", value: "$20", confirmed: false });
  });
});

describe("V2 source receipt fingerprints", () => {
  const body = () => ({ schemaVersion: GEO_KB_SOURCE_SCHEMA, receiptId: "11111111-1111-4111-8111-111111111111", kbId: "22222222-2222-4222-8222-222222222222",
    targetHost: "example.com", draftVersion: 1, draftHash: "a".repeat(64), profileReference: null, createdAt: AT, competitors: [], facts: [],
    gsc: { status: "available" as const, reason: null, property: "sc-domain:example.com", window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: 1, truncated: false, observedAt: AT, queries: [...collectGeoQueryEvidenceV2(["actual query"])] },
  });
  it("hashes the entire source body and refuses tampered content", () => {
    const source = body(), result = finalizeGeoKbSourceReportV2(source);
    expect(result.contentHash).toBe(createHash("sha256").update(canonicalGeoEnrichmentText(source)).digest("hex"));
    expect(verifyGeoKbSourceReportV2(result)).toEqual(result);
    expect(() => verifyGeoKbSourceReportV2({ ...result, draftVersion: 2 })).toThrow();
  });
  it("refuses a rehashed query with an ID unrelated to its actual text", () => {
    const source = body(); source.gsc.queries[0] = { id: `G${"d".repeat(64)}`, text: "actual query" };
    const forged = { ...source, contentHash: createHash("sha256").update(canonicalGeoEnrichmentText(source)).digest("hex") };
    expect(() => verifyGeoKbSourceReportV2(forged)).toThrow();
  });
  it("builds a globally scoped semantic catalogue without dropping singleton queries", () => {
    const source = body();
    source.gsc.queries = [...collectGeoQueryEvidenceV2(Array.from({ length: 1000 }, (_, i) => `singleton ${i}`))]; source.gsc.queryCount = 1000;
    const report = finalizeGeoKbSourceReportV2({ ...source,
      competitors: [inspect("<title>Actual Rival</title>"), inspect('<meta property="og:site_name" content="Alpha"><title>Beta</title>')].map((entry, index) => ({ ...entry, evidenceId: `C${index + 1}` })),
      facts: [inspectGeoFactSourceV2({ key: "Price", value: "$20", reason: "", sourceUrl: URL, observedAt: "" }, page("<p>Price: $20.</p>"), "F1")],
    });
    const catalogue = geoKbSourceCatalogueV2(report);
    expect(catalogue.filter((entry) => entry.kind === "gsc")).toHaveLength(1000);
    expect(catalogue).toContainEqual({ id: `S:${report.receiptId}:F1`, kind: "crawl", text: "Price: $20." });
    expect(catalogue.some((entry) => entry.id === `S:${report.receiptId}:C1` && entry.text.includes("Actual Rival"))).toBe(true);
    expect(catalogue.some((entry) => entry.id === `S:${report.receiptId}:C2`)).toBe(false);
    expect(new Set(catalogue.map((entry) => entry.id)).size).toBe(catalogue.length);
    expect(catalogue.every((entry) => entry.id.length <= 128)).toBe(true);
    const other = finalizeGeoKbSourceReportV2({ ...source, receiptId: "33333333-3333-4333-8333-333333333333" });
    expect(geoKbSourceCatalogueV2(other).every((entry) => !catalogue.some((original) => original.id === entry.id))).toBe(true);
  });
});

const URL = "https://rival.example/";
const AT = "2026-08-31T00:00:00.000Z";
const page = (body: string) => ({ kind: "ok" as const, url: URL, body, observedAt: AT });
const jsonLd = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const inspect = (html: string) => extractGeoCompetitorSourceV2("rival.example", page(html), "C1");

describe("V2 competitor identity signals", () => {
  it("retains genuine same-host identity signals and agrees with a title suffix", () => {
    const value = inspect(jsonLd({ "@type": "WebSite", url: URL, name: "Rival Analytics", alternateName: ["Rival", "RA"] }) + '<meta property="og:site_name" content="Rival Analytics"><title>Rival Analytics — Reporting for teams</title>');
    expect(value).toMatchObject({ status: "available", brandName: "Rival Analytics", confirmed: false, sourceUrl: URL, observedAt: AT });
    expect(value).toHaveProperty("signals", expect.arrayContaining([expect.objectContaining({ kind: "json_ld_website", name: "Rival Analytics", url: URL, hostMatched: true })]));
  });
  it("does not use an external publisher as the competitor or as a local conflict", () => {
    const value = inspect(jsonLd({ "@graph": [
      { "@type": "Organization", name: "Outside Publisher", url: "https://publisher.example/" },
      { "@type": "WebSite", name: "Rival Analytics", url: URL },
    ] }) + "<title>Rival Analytics | Home</title>");
    expect(value).toMatchObject({ status: "available", brandName: "Rival Analytics" });
    expect(value).toHaveProperty("signals", expect.arrayContaining([expect.objectContaining({ name: "Outside Publisher", hostMatched: false, excludedReason: "foreign_host" })]));
  });
  it("does not infer host ownership from an Organization with no URL", () => {
    const value = inspect(jsonLd({ "@type": "Organization", name: "Unknown Publisher" }) + '<meta property="og:site_name" content="Rival"><title>Rival</title>');
    expect(value).toMatchObject({ status: "available", brandName: "Rival" });
    expect(value).toHaveProperty("signals", expect.arrayContaining([expect.objectContaining({ name: "Unknown Publisher", hostMatched: false, excludedReason: "unscoped_identity" })]));
  });
  it.each([
    jsonLd({ "@graph": [{ "@type": "Organization", name: "Alpha", url: URL }, { "@type": "WebSite", name: "Beta", url: URL }] }),
    '<meta property="og:site_name" content="Alpha"><title>Beta</title>',
    jsonLd({ "@type": "WebSite", name: "Alpha", url: URL }) + '<meta property="og:site_name" content="Beta">',
  ])("keeps disagreements explicit instead of preferring the first signal", (html) => {
    expect(inspect(html)).toMatchObject({ status: "conflict", reason: "identity_conflict", brandName: null, aliases: [], confirmed: false });
  });
  it("accepts an explicit alternateName as the bridge between real signals", () => {
    expect(inspect(jsonLd({ "@type": "Organization", "@id": "https://rival.example/#organization", name: "Co-Star", alternateName: "Co Star" }) + '<meta property="og:site_name" content="CoStar"><title>Co–Star — Your daily astrology</title>')).toMatchObject({ status: "available", brandName: "Co-Star" });
  });
  it("refuses a title-only advertising sentence as a brand", () => {
    expect(inspect("<title>The best all-in-one platform to transform your business today</title>")).toMatchObject({ status: "unavailable", reason: "insufficient_identity", brandName: null });
    expect(inspect("<title>Rival Analytics</title>")).toMatchObject({ status: "available", method: "title", brandName: "Rival Analytics", confirmed: false });
  });
  it("keeps a redirected foreign page unavailable", () => {
    expect(extractGeoCompetitorSourceV2("rival.example", { ...page("<title>Foreign</title>"), url: "https://foreign.example/" }, "C1")).toMatchObject({ status: "unavailable", reason: "target_redirected", brandName: null, source: null });
  });
  it("does not hide an overlong conflicting signal or identity inventory overflow", () => {
    expect(inspect(jsonLd({ "@type": "WebSite", name: "x".repeat(201), url: URL }) + '<meta property="og:site_name" content="Rival">')).toMatchObject({ status: "unavailable", reason: "identity_overflow", signalsTruncated: true });
    expect(inspect(jsonLd({ "@graph": Array.from({ length: 21 }, () => ({ "@type": "WebSite", name: "Rival", url: URL })) }))).toMatchObject({ status: "unavailable", reason: "identity_overflow", signalsTruncated: true });
  });
});
