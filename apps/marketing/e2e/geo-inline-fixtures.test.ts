import { describe, expect, it } from "vitest";
import { parseWebsiteDetails } from "../src/lib/account-websites/contracts.ts";
import { isGeoKbView } from "../src/components/tools/geo-kb-wire.ts";
import { createGeoProfileCopy } from "../src/lib/geo-tools/kb-profile-copy.ts";
import { parseGeoKbPayload } from "../src/lib/geo-tools/kb-contract.ts";
import { GEO_CHAIN_USER } from "./geo-chain-fixtures.ts";
import { createInlineGeoFixture, inlineViewForWebsite } from "./geo-inline-fixtures.ts";

describe("offline inline GEO browser fixtures", () => {
  it("uses complete browser-parseable account and knowledge-base responses", async () => {
    const state = createInlineGeoFixture();
    expect(await parseWebsiteDetails(state.fixture.website)).toEqual(state.fixture.website);
    expect(isGeoKbView(state.fixture.view())).toBe(true);
    const parsed = parseGeoKbPayload(state.initialPayload);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(state.initialPayload);
    expect(isGeoKbView(inlineViewForWebsite(state.fixture.website))).toBe(true);
  });
  it("keeps the stored and historical copies detached until an explicit GEO save", async () => {
    const state = createInlineGeoFixture();
    const changed = { ...state.fixture.website.draft!.profile, productName: "Confirmed new name" };
    expect(await parseWebsiteDetails(state.saveProfile(changed))).toEqual(state.fixture.website);
    expect(await parseWebsiteDetails(state.confirmProfile())).toEqual(state.fixture.website);
    expect(state.fixture.view().profile?.fullProfile?.productName).toBe(changed.productName);
    expect(state.fixture.view().payload.profileCopy?.profile.productName).toBe("Acme");
    const current = state.fixture.view();
    const copy = createGeoProfileCopy(current.profile!.reference, current.profile!.fullProfile!);
    const result = await state.fixture.kbDependencies.saveDraft({ userId: GEO_CHAIN_USER, kbId: current.kbId, baseVersion: current.draftVersion,
      expectedProfileReference: current.profile!.reference, payload: { ...current.payload, profileCopy: copy } });
    expect(result.kind).toBe("ok");
    expect(state.fixture.view().payload.profileCopy?.profile.productName).toBe(changed.productName);
    expect(state.fixture.view().frozen?.payload).toEqual(state.initialPayload);
    expect(isGeoKbView(state.fixture.view())).toBe(true);
  });
});
