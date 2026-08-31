import { describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { importGeoKbPayload } from "./kb-import.ts";
const source = { websiteId: "11111111-1111-4111-8111-111111111111", snapshotId: "11111111-1111-4111-8111-111111111112", snapshotRevision: 1, origin: "https://example.com", profile: { ...emptyMarketingWebsiteProfile(), productName: "Acme", directCompetitors: ["one.com", "two.com", "three.com", "four.com", "five.com", "six.com"] } };
describe("bounded measurement prefill", () => {
  it("leaves an oversized source competitor set unselected instead of silently taking the first five", () => {
    const imported = importGeoKbPayload(source);
    expect(imported.competitors).toEqual([]);
    expect(source.profile.directCompetitors).toHaveLength(6);
  });
  it("keeps a within-limit source prefill unconfirmed", () => {
    const imported = importGeoKbPayload({ ...source, profile: { ...source.profile, directCompetitors: ["one.com", "Two Brand"] } });
    expect(imported.competitors).toEqual([{ domain: "one.com", brandName: "", confirmed: false }, { domain: "", brandName: "Two Brand", confirmed: false }]);
  });
});
