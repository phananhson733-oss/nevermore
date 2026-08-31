import { describe, expect, it } from "vitest";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { clusterGeoQueries, extractCompetitorIdentity, finalizeGeoEnrichmentReport, inspectGeoFact } from "../../lib/geo-tools/kb-enrichment.ts";
import { applyGeoEnrichmentSuggestion } from "./geo-kb-enrichment-apply.ts";

const AT = "2026-08-31T00:00:00.000Z";
const sourceUrl = "https://example.com/pricing";
const fact = { key: "Price", value: "$20", reason: "" as const, sourceUrl, observedAt: "" };
const base = { ...emptyGeoKbPayload("https://example.com"), officialName: "Original name", competitors: [{ domain: "rival.example", brandName: "", confirmed: false }], facts: [fact] };
const report = finalizeGeoEnrichmentReport({ schemaVersion: "marketing-geo-kb-enrichment.v1", receiptId: "b920cd2e-c645-4df6-a80e-4f434dd09266", kbId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6", targetHost: "example.com", draftVersion: 4, draftHash: "a".repeat(64), profileReference: null, createdAt: AT,
  competitors: [extractCompetitorIdentity("rival.example", { kind: "ok", url: "https://rival.example/", observedAt: AT, body: '<script type="application/ld+json">{"@type":"WebSite","name":"Rival","alternateName":"Rival Analytics"}</script>' }, "C1")],
  facts: [inspectGeoFact(fact, { kind: "ok", url: sourceUrl, observedAt: AT, body: "<p>Price: $20</p>" }, "F1")],
  gsc: { status: "available", reason: null, property: "sc-domain:example.com", window: { startDate: "2026-05-31", endDate: "2026-08-28" }, queryCount: 2, truncated: false, observedAt: AT, roles: clusterGeoQueries(["analytics pricing", "analytics comparison"]) }, skippedLayers: [],
});

describe("reviewed enrichment application", () => {
  it("applies one competitor candidate without confirming it or overwriting unrelated dirty fields", () => {
    const result = applyGeoEnrichmentSuggestion({ ...base, officialName: "Unsaved user name" }, base, report, "C1");
    expect(result).toMatchObject({ ok: true, payload: { officialName: "Unsaved user name", competitors: [{ domain: "rival.example", brandName: "Rival", aliases: ["Rival Analytics"], confirmed: false }] } });
  });
  it("preserves a field edited while source collection was running", () => {
    const current = { ...base, competitors: [{ domain: "rival.example", brandName: "User wrote this", confirmed: true }] };
    expect(applyGeoEnrichmentSuggestion(current, base, report, "C1")).toEqual({ ok: false });
    expect(current.competitors[0]?.brandName).toBe("User wrote this");
  });
  it("appends an exact GSC role candidate without replacing existing manual roles", () => {
    const current = { ...base, roles: [{ id: "manual", label: "Manual role", segment: "", painPoints: [], decisionCriteria: [], vocabulary: [] }] };
    const result = applyGeoEnrichmentSuggestion(current, base, report, "R1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.roles).toEqual([current.roles[0], report.gsc.roles[0]?.role]);
  });
  it("applies verified fact evidence but refuses changed facts or unknown IDs", () => {
    expect(applyGeoEnrichmentSuggestion(base, base, report, "F1")).toMatchObject({ ok: true, payload: { facts: [{ ...fact, observedAt: AT }] } });
    expect(applyGeoEnrichmentSuggestion({ ...base, facts: [{ ...fact, value: "$99" }] }, base, report, "F1")).toEqual({ ok: false });
    expect(applyGeoEnrichmentSuggestion(base, base, report, "F999")).toEqual({ ok: false });
  });
});
