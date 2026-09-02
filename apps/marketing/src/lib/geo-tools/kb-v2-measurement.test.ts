import { describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { completePayloadV2 } from "./kb-v2.test-fixtures.ts";
import { applyGeoV2Measurement, geoV2MeasurementGap, geoV2MeasurementProposal, hasGeoV2MeasurementGap } from "./kb-v2-measurement.ts";

const SIX = ["astro.com", "astro-seek.com", "astrostyle.com", "cafeastrology.com", "astrotheme.com", "astro-charts.com"];
const profile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", country: "US", locale: "en", directCompetitors: SIX };
const draft = { ...completePayloadV2(), officialName: "Acme", categoryTerms: [] as readonly string[], market: { country: "US", language: "en" }, competitors: [{ domain: "astro.com", brandName: "Astrodienst", confirmed: true }] };

describe("GEO V2 measurement gap", () => {
  it("names the competitor count difference the draft cannot show on its own", () => {
    const gap = geoV2MeasurementGap(profile, draft);
    expect(gap.sourceCompetitorCount).toBe(6);
    expect(gap.draftCompetitorCount).toBe(1);
    expect(gap.competitorsDiffer).toBe(true);
    expect(gap.overCompetitorLimit).toBe(true);
    expect(hasGeoV2MeasurementGap(gap)).toBe(true);
  });
  it("does not report a difference for a value the Profile cannot supply", () => {
    const blank = { ...emptyMarketingWebsiteProfile(), productName: "", country: "US", locale: "en", directCompetitors: [] };
    const gap = geoV2MeasurementGap(blank, { ...draft, competitors: [] });
    expect(gap.fields).not.toContain("officialName");
    expect(gap.competitorsDiffer).toBe(false);
    expect(hasGeoV2MeasurementGap(gap)).toBe(false);
  });
  it("adopts a chosen five and refuses a sixth", () => {
    const proposal = geoV2MeasurementProposal(profile, draft);
    const next = applyGeoV2Measurement(draft, proposal, { fields: [], competitorIndices: [0, 1, 2, 3, 4] });
    expect(next.competitors.map(row => row.domain)).toEqual(SIX.slice(0, 5));
    expect(next.competitors[0]).toEqual({ domain: "astro.com", brandName: "Astrodienst", confirmed: true });
    expect(() => applyGeoV2Measurement(draft, proposal, { fields: [], competitorIndices: [0, 1, 2, 3, 4, 5] })).toThrow();
    expect(() => applyGeoV2Measurement(draft, proposal, { fields: [], competitorIndices: [0, 0] })).toThrow();
  });
  it("leaves roles and facts exactly as reviewed while adopting measurement fields", () => {
    const source = { ...profile, productName: "Renamed", categories: ["birth chart calculator"] };
    const proposal = geoV2MeasurementProposal(source, draft);
    const next = applyGeoV2Measurement(draft, proposal, { fields: ["officialName", "categoryTerms", "market"], competitorIndices: [0] });
    expect(next.officialName).toBe("Renamed");
    expect(next.categoryTerms).toEqual(["birth chart calculator"]);
    expect(next.roles).toEqual(draft.roles);
    expect(next.facts).toEqual(draft.facts);
    expect(next.profileCopy).toBe(draft.profileCopy);
    expect(next.schemaVersion).toBe("marketing-geo-kb.v2");
  });
});

describe("a gap the visitor can actually close", () => {
  const five = SIX.slice(0, 5).map(domain => ({ domain, brandName: "", confirmed: false }));
  it("stops reporting once the measurement set is full, so the notice can be cleared", () => {
    const gap = geoV2MeasurementGap(profile, { ...draft, competitors: five });
    expect(gap.draftCompetitorCount).toBe(5);
    expect(gap.missingCompetitorCount).toBe(1);
    expect(gap.competitorsDiffer).toBe(false);
    expect(hasGeoV2MeasurementGap(gap)).toBe(false);
  });
  it("does not treat a different order as a difference", () => {
    const reversed = [...five].reverse();
    expect(geoV2MeasurementGap({ ...profile, directCompetitors: SIX.slice(0, 5) }, { ...draft, competitors: reversed }).competitorsDiffer).toBe(false);
  });
  it("ignores a Profile entry GEO cannot map, which nothing could adopt", () => {
    const unmappable = { ...profile, directCompetitors: ["astro.com", "x".repeat(400)] };
    const gap = geoV2MeasurementGap(unmappable, { ...draft, competitors: [{ domain: "astro.com", brandName: "Astrodienst", confirmed: true }] });
    expect(gap.missingCompetitorCount).toBe(0);
    expect(gap.competitorsDiffer).toBe(false);
  });
  it("still reports a mappable competitor that is absent while there is room", () => {
    const gap = geoV2MeasurementGap(profile, { ...draft, competitors: [{ domain: "astro.com", brandName: "Astrodienst", confirmed: true }] });
    expect(gap.missingCompetitorCount).toBe(5);
    expect(gap.competitorsDiffer).toBe(true);
  });
  it("refuses to write an unrecognised field onto whichever branch is last", () => {
    const proposal = geoV2MeasurementProposal(profile, draft);
    expect(() => applyGeoV2Measurement(draft, proposal, { fields: ["roles" as never], competitorIndices: null })).toThrow();
  });
});

describe("a proposal in the form the draft is saved in", () => {
  it("does not re-open a gap the save already closed by trimming and de-duplicating", () => {
    const padded = { ...profile, categories: ["  birth chart  ", "birth chart", "synastry "] };
    const saved = { ...draft, categoryTerms: ["birth chart", "synastry"], competitors: SIX.slice(0, 5).map(domain => ({ domain, brandName: "", confirmed: false })) };
    expect(geoV2MeasurementGap(padded, saved).fields).not.toContain("categoryTerms");
  });
  it("counts two spellings of one competitor once, so both can never be selected as duplicates", () => {
    const spelled = { ...profile, directCompetitors: ["astro.com", "https://www.astro.com/", "astro-seek.com"] };
    const proposal = geoV2MeasurementProposal(spelled, { ...draft, competitors: [] });
    expect(proposal.competitors.map(row => row.value?.domain)).toEqual(["astro.com", "astro-seek.com"]);
    expect(geoV2MeasurementGap(spelled, { ...draft, competitors: [] }).missingCompetitorCount).toBe(2);
  });
  it("refuses an index that names no proposal, a repeated field, and returns the draft unchanged for an empty selection", () => {
    const proposal = geoV2MeasurementProposal(profile, draft);
    for (const competitorIndices of [[-1], [1.5], [99]]) expect(() => applyGeoV2Measurement(draft, proposal, { fields: [], competitorIndices })).toThrow();
    expect(() => applyGeoV2Measurement(draft, proposal, { fields: ["officialName", "officialName"], competitorIndices: null })).toThrow();
    expect(applyGeoV2Measurement(draft, proposal, { fields: [], competitorIndices: null })).toEqual(draft);
  });
});
