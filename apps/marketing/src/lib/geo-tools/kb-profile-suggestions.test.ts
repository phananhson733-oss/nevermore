import { describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { emptyGeoKbPayload, geoKbBlockers } from "./kb-contract.ts";
import { buildGeoProfileSuggestions, applyGeoProfileSuggestions, geoProfileMeasurementDifferences } from "./kb-profile-suggestions.ts";
const profile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", categories: ["analytics"], primaryIcp: "Analytics teams", buyer: "Marketing leaders", country: "US", locale: "en", directCompetitors: ["https://rival.example", "two.com", "Three", "four.com", "five.com", "six.com"], indirectAlternatives: ["Indirect"], excludedAlternatives: ["Excluded"] };
const payload = { ...emptyGeoKbPayload("https://example.com"), officialName: "Custom Acme", categoryTerms: ["old category"], aliases: ["Keep Alias"], roles: [{ id: "manual", label: "Manual persona", segment: "Manual", painPoints: [], decisionCriteria: [], vocabulary: [] }], competitors: [{ domain: "rival.example", brandName: "Confirmed Rival", confirmed: true, aliases: ["Rival"] }], facts: [{ key: "price", value: "$10", reason: "" as const, sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31" }] };
describe("explicit Profile to measurement review", () => {
  it("presents every direct competitor without selecting or silently shortening to five", () => {
    const proposal = buildGeoProfileSuggestions(profile, payload);
    expect(proposal.competitors).toHaveLength(6);
    expect(proposal.competitors.map(row => row.sourceValue)).toEqual(profile.directCompetitors);
    expect(proposal.competitors.some(row => row.sourceValue === "Excluded")).toBe(false);
    expect(proposal.competitors[0]?.value).toEqual(payload.competitors[0]);
    expect(proposal.competitors[1]?.value?.confirmed).toBe(false);
  });
  it("applies only explicitly selected fields and competitors, preserving facts and overrides", () => {
    const proposal = buildGeoProfileSuggestions(profile, payload);
    const next = applyGeoProfileSuggestions(payload, proposal, { fields: ["categoryTerms"], competitorIndices: [0, 5] });
    expect(next.categoryTerms).toEqual(["analytics"]);
    expect(next.competitors).toEqual([payload.competitors[0], { domain: "six.com", brandName: "", confirmed: false }]);
    for (const field of ["officialName", "aliases", "market", "roles", "facts"] as const) expect(next[field]).toEqual(payload[field]);
    expect(payload.categoryTerms).toEqual(["old category"]);
  });
  it("rejects more than five selected competitors and duplicate/invalid indices", () => {
    const proposal = buildGeoProfileSuggestions(profile, payload);
    for (const indices of [[0, 1, 2, 3, 4, 5], [0, 0], [9], [-1]]) expect(() => applyGeoProfileSuggestions(payload, proposal, { fields: [], competitorIndices: indices })).toThrow();
  });
  it("does not turn a long source name/category/persona into truncated or empty replacement", () => {
    const proposal = buildGeoProfileSuggestions({ ...profile, productName: "A".repeat(300), categories: ["a".repeat(100)], buyer: "x".repeat(300) }, payload);
    expect(proposal.fields.officialName).toBeNull();
    expect(proposal.fields.categoryTerms).toBeNull();
    expect(proposal.fields.roles).toBeNull();
    expect(() => applyGeoProfileSuggestions(payload, proposal, { fields: ["roles"], competitorIndices: null })).toThrow();
  });
  it("offers only values that fit GEO text and locale contracts without hiding newlines or unsupported locale parts", () => {
    const proposal = buildGeoProfileSuggestions({ ...profile, productName: "Acme\nTeams", categories: ["analytics\nsoftware"], buyer: "one\ntwo", locale: "en-Latn-US" }, payload);
    expect(proposal.fields.officialName).toBeNull();
    expect(proposal.fields.categoryTerms).toBeNull();
    expect(proposal.fields.roles).toBeNull();
    expect(proposal.fields.market).toBeNull();
    expect(buildGeoProfileSuggestions({ ...profile, locale: "en-US" }, payload).fields.market).toEqual({ country: "US", language: "en-us" });
  });
  it("uses actual registry category bounds for proposals and new freezes without truncating", () => {
    const fits = "a".repeat(60), tooLong = "a".repeat(61);
    expect(buildGeoProfileSuggestions({ ...profile, categories: [fits] }, payload).fields.categoryTerms).toEqual([fits]);
    expect(buildGeoProfileSuggestions({ ...profile, categories: [tooLong] }, payload).fields.categoryTerms).toBeNull();
    expect(geoKbBlockers({ ...payload, categoryTerms: [tooLong] })).toContain("category_placeholder_invalid");
    expect(geoKbBlockers({ ...payload, categoryTerms: [fits] })).not.toContain("category_placeholder_invalid");
  });
  it("checks only category and role labels actually inserted into questions", () => {
    const source = { ...payload, categoryTerms: ["analytics", "未使用的扩展词"], roles: [{ ...payload.roles[0]!, id: "supported", label: "Analytics teams", painPoints: ["中文痛点"], decisionCriteria: ["中文条件"], vocabulary: ["中文用词"] }, { ...payload.roles[0]!, id: "manual", label: "中文手工角色" }] };
    expect(geoKbBlockers(source, { activeRoleIds: ["supported"] })).not.toContain("role_terms_not_english");
    expect(geoKbBlockers(source, { activeRoleIds: ["supported"] })).not.toContain("category_terms_not_english");
    expect(geoKbBlockers(source, { activeRoleIds: ["manual"] })).toContain("role_terms_not_english");
    expect(geoKbBlockers({ ...source, categoryTerms: ["中文实际品类"] }, { activeRoleIds: ["supported"] })).toContain("category_terms_not_english");
  });
  it("shows source-to-measurement differences even if the full copy has already been adopted", () => {
    expect(geoProfileMeasurementDifferences(profile, payload)).toEqual(expect.arrayContaining(["officialName", "categoryTerms", "roles", "competitors"]));
  });
  it("refuses new English freezes containing mixed-language category placeholders but allows brand names", () => {
    const valid = { ...payload, aliases: ["Acme"], officialName: "占星指南", categoryTerms: ["astrology"], market: { country: "US", language: "en" } };
    expect(geoKbBlockers(valid)).not.toContain("category_terms_not_english");
    expect(geoKbBlockers({ ...valid, categoryTerms: ["占星工具"] })).toContain("category_terms_not_english");
  });
  it("requires English role placeholders only when those layers will actually be generated", () => {
    const mixed = { ...payload, roles: [{ ...payload.roles[0]!, label: "中文买家" }] };
    expect(geoKbBlockers(mixed)).toContain("role_terms_not_english");
    expect(geoKbBlockers(mixed, { roleLayersSkipped: true })).not.toContain("role_terms_not_english");
  });
});
