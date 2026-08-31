import { expect, it } from "vitest";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { geoKbSubmission } from "./geo-kb-editor-payload.ts";

it("preserves reviewed competitor aliases in the saved payload without adding them to legacy entries", () => {
  const payload = emptyGeoKbPayload("https://example.com");
  const result = geoKbSubmission({ ...payload, competitors: [
    { domain: "rival.example", brandName: "Rival", confirmed: false, aliases: [" Alternate ", "Alternate"] },
    { domain: "legacy.example", brandName: "Legacy", confirmed: true },
  ] });
  expect(result.competitors).toEqual([
    { domain: "rival.example", brandName: "Rival", confirmed: false, aliases: ["Alternate"] },
    { domain: "legacy.example", brandName: "Legacy", confirmed: true },
  ]);
});
