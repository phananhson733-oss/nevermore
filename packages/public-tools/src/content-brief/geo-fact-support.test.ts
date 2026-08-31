import { describe, expect, it } from "vitest";
import { checkGeoFactSupport, geoMissingFactStatements } from "./geo-fact-support.ts";
import type { GeoFactEvidence } from "./geo-contract.ts";
const facts = new Map<string, GeoFactEvidence>();
describe("GEO lexical support regressions", () => {
  it.each(["Pricing", "Cost", "Costs", "Fee", "Fees"])("binds the %s alias to an actually missing Price facet", label => {
    expect(checkGeoFactSupport({ text: `${label} is free.`, claim: "no_claim", evidence_refs: [] }, facts, [{ label: "Price", reason: "fetchFailed" }])).toBe("geo_missing_value");
  });
  it("does not invent a missing facet when no matching label exists", () => {
    expect(checkGeoFactSupport({ text: "Compare cost before choosing.", claim: "no_claim", evidence_refs: [] }, facts, [{ label: "Seats", reason: "missing" }])).toBeNull();
  });
  it("keeps English once as a connective but catches the Spanish numeral in a known assertion context", () => {
    expect(checkGeoFactSupport({ text: "Once you choose a tool, review the workflow.", claim: "no_claim", evidence_refs: [] }, facts, [])).toBeNull();
    expect(checkGeoFactSupport({ text: "La herramienta admite once asientos.", claim: "no_claim", evidence_refs: [] }, facts, [])).toBe("geo_unsupported_number");
  });
  it.each(["它支持三十个席位。", "La herramienta admite treinta asientos.", "La herramienta cuesta veintinueve euros."])("rejects known out-of-language numeral forms: %s", text => {
    expect(checkGeoFactSupport({ text, claim: "no_claim", evidence_refs: [] }, facts, [])).toBe("geo_unsupported_number");
  });
  it("accepts an exact missing statement containing a trusted array index", () => {
    const missing = [{ label: "coreFeatures[0]", reason: "unverified" }];
    for (const text of geoMissingFactStatements(missing[0]!)) expect(checkGeoFactSupport({ text, claim: "gap", evidence_refs: [] }, facts, missing)).toBeNull();
  });
  it("does not let one matching missing statement bypass a conflicting missing row", () => {
    const missing = [{ label: "coreFeatures[0]", reason: "notPublished" }, { label: "coreFeatures[0]", reason: "fetchFailed" }];
    expect(checkGeoFactSupport({ text: "coreFeatures[0] is not published.", claim: "gap", evidence_refs: [] }, facts, missing)).toBe("geo_missing_reason");
  });
});
