// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GeoKbInheritedProfile } from "./geo-kb-profile.tsx";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

let root: Root | null = null;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); });
const profile = { reference: { schemaVersion: "website-profile-reference.v1" as const, websiteId: "11111111-1111-4111-8111-111111111111", snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 3, profileSchemaVersion: "marketing-website-profile.v1" as const, profileHash: "a".repeat(64) },
  productName: "AstrologyWiki", oneLinePositioning: "Psychological astrology tools", coreFeatures: ["Natal chart", "Synastry"], market: { country: "US", language: "en" }, fieldProvenance: [] };
async function render(props: Record<string, unknown> = {}) {
  const host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(async()=>root?.render(<GeoKbInheritedProfile profile={profile} locale="en" {...props} />));return host;
}
it("lets a user stage exact Profile values as pending facts without calling them verified",async()=>{
  const onAddFact=vi.fn();const host=await render({onAddFact});
  const actions=Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter(button=>button.textContent==="asset.featureCandidateAdd");
  expect(actions).toHaveLength(4);
  expect(actions.map(action=>action.getAttribute("aria-label"))).toEqual([
    "asset.featureCandidateAdd: asset.productName", "asset.featureCandidateAdd: asset.positioning",
    "asset.featureCandidateAdd: Natal chart", "asset.featureCandidateAdd: Synastry",
  ]);
  for(const action of actions) await act(async()=>action.click());
  expect(onAddFact.mock.calls).toEqual([["productName","AstrologyWiki"],["oneLinePositioning","Psychological astrology tools"],["coreFeatures[0]","Natal chart"],["coreFeatures[1]","Synastry"]]);
  expect(host.textContent).toContain("asset.profileFactBoundary");
});
it("disables a Profile candidate whose stable fact key already exists",async()=>{
  const host=await render({facts:[{key:"productName",value:"AstrologyWiki",reason:"",sourceUrl:"https://example.com",observedAt:"2026-09-01"}],onAddFact:vi.fn()});
  const disabled=Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter(button=>button.disabled);
  expect(disabled).toHaveLength(1);expect(disabled[0]?.textContent).toBe("asset.featureCandidateExists");
});
