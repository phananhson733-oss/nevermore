// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import { emptyMarketingWebsiteProfile, WEBSITE_PROFILE_FIELD_NAMES } from "../../lib/account-websites/contracts.ts";
import { GeoKbInheritedProfile } from "./geo-kb-profile.tsx";
import { renderedText } from "./rendered-text.test-helper.ts";
import { GEO_PROFILE_SUBSET_FIELDS } from "../../lib/geo-tools/kb-profile-subset.ts";

const fullProfile = { ...emptyMarketingWebsiteProfile(), productName: "Copied product", oneLinePositioning: "Copied positioning",
  coreFeatures: Array.from({ length: 32 }, (_, i) => `Complete feature ${i + 1}`), valueProposition: "Copied value",
  primaryIcp: "Copied ICP", buyer: "Copied buyer", country: "CA", locale: "en-CA", directCompetitors: ["rival.example"],
  fieldProvenance: [{ path: "/productName" as const, derivation: "observed" as const, confidence: "high" as const,
    source: "public_page" as const, observedAt: "2026-08-31T00:00:00.000Z", evidenceUrls: ["https://example.com/about"], limitation: null },
    // A field GEO does not read, so the source list must not describe it either.
    { path: "/jtbd" as const, derivation: "inferred" as const, confidence: "low" as const,
      source: "local_inference" as const, observedAt: null, evidenceUrls: [], limitation: null }] };
const reference = { schemaVersion: "website-profile-reference.v1" as const, websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
  snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987", snapshotRevision: 2, profileSchemaVersion: "marketing-website-profile.v1" as const, profileHash: "a".repeat(64) };
const copy = { schemaVersion: "marketing-geo-profile-copy.v1" as const, websiteId: reference.websiteId, snapshotId: reference.snapshotId,
  snapshotRevision: "2", profileHash: reference.profileHash, profile: fullProfile };
const latest = { reference: { ...reference, snapshotRevision: 3 }, productName: "New source, not copied", oneLinePositioning: "New positioning",
  coreFeatures: ["New source feature"], market: { country: "US", language: "en" }, fullProfile: { ...fullProfile, productName: "New source, not copied" } };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(extra: Record<string, unknown> = {}) {
  const props = { profile: latest, copy, locale: "en", ...extra } as ComponentProps<typeof GeoKbInheritedProfile>;
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><GeoKbInheritedProfile {...props} /></NextIntlClientProvider>));
}
describe("complete GEO Profile copy display", () => {
  it("allows the prepared-version view to describe its copy without calling it already frozen", async () => {
    await render({ copyDescription: "This is the exact version currently under review." });
    expect(host.textContent).toContain("This is the exact version currently under review.");
    expect(host.textContent).not.toContain(en.tools.geoKnowledgeBase.asset.copyBody);
    expect(host.textContent).not.toContain(en.tools.geoKnowledgeBase.asset.frozenCopyBody);
  });
  it("stages exact Profile values as pending facts without calling them verified", async () => {
    const onAddFact = vi.fn();
    await render({ onAddFact });
    const actions = [...host.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent === en.tools.geoKnowledgeBase.asset.featureCandidateAdd);
    expect(actions).toHaveLength(34);
    for (const action of actions.slice(0, 3)) await act(async () => action.click());
    expect(onAddFact.mock.calls).toEqual([
      ["productName", "Copied product"],
      ["oneLinePositioning", "Copied positioning"],
      ["coreFeatures[0]", "Complete feature 1"],
    ]);
    expect(host.textContent).toContain(en.tools.geoKnowledgeBase.asset.profileFactBoundary);
  });
  it("offers no fact action on a blank field instead of a length complaint", async () => {
    // A blank value is one of the two fields that carry the action, so this is
    // a row that really can render a button. `pendingGeoProfileFact` reports a
    // blank value as `too_long`, and the disabled button then read "the name
    // exceeds the fact-name limit" about a field with nothing in it.
    await render({ onAddFact: vi.fn(), copy: { ...copy, profile: { ...fullProfile, oneLinePositioning: "" } } });
    const blank = host.querySelector('[data-geo-profile-field="oneLinePositioning"]');
    expect(renderedText(blank)).toContain(en.tools.geoKnowledgeBase.asset.emptyField);
    expect(blank?.querySelectorAll("button")).toHaveLength(0);
    expect(host.textContent).not.toContain(en.tools.geoKnowledgeBase.asset.featureCandidateTooLong);
    // The filled field beside it still offers one.
    expect(host.querySelector('[data-geo-profile-field="productName"]')?.querySelectorAll("button")).toHaveLength(1);
  });
  it("does not repeat the surrounding block's description, and still describes a frozen copy", async () => {
    await render();
    // The block above the card already says the copy belongs to this draft and
    // how it is updated. The panel adds no second description of its own.
    expect(host.querySelector("[data-geo-profile-fields]")?.previousElementSibling).toBeNull();
    expect(host.textContent).not.toContain(en.tools.geoKnowledgeBase.asset.copyBody);
    expect(host.textContent).not.toContain(en.tools.geoKnowledgeBase.asset.frozenCopyBody);
    await render({ frozen: true });
    // A frozen copy is the one case the panel has something of its own to say:
    // this is what was saved then, and neither editor changes it now.
    expect(host.textContent).toContain(en.tools.geoKnowledgeBase.asset.frozenCopyBody);
  });
  it("disables a candidate whose stable fact key already exists", async () => {
    await render({ onAddFact: vi.fn(), facts: [{ key: "productName", value: "Copied product", reason: "", sourceUrl: "https://example.com", observedAt: "2026-09-01" }] });
    const disabled = [...host.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.disabled);
    expect(disabled).toHaveLength(1);
    expect(disabled[0]?.textContent).toBe(en.tools.geoKnowledgeBase.asset.featureCandidateExists);
  });
  it("gives current and frozen copies independent identities", async () => {
    await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}>
      <GeoKbInheritedProfile profile={null} copy={copy} locale="en" />
      <GeoKbInheritedProfile profile={null} copy={copy} locale="en" />
    </NextIntlClientProvider>));
    const ids = [...host.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Each panel's heading has to be the one its own region points at, or a
    // screen reader announces both regions under the same name.
    const regions = [...host.querySelectorAll("section[aria-labelledby]")];
    expect(regions).toHaveLength(2);
    for (const region of regions) {
      const named = region.getAttribute("aria-labelledby") ?? "";
      expect([...host.querySelectorAll("[id]")].filter(node => node.id === named)).toHaveLength(1);
    }
  });
  it("shows the fields GEO reads, and reads them out rather than faking editable controls", async () => {
    await render();
    const text = renderedText(host);
    expect(text).toContain("Copied product");
    expect(text).toContain("Copied ICP");
    expect(text).toContain("Complete feature 32");
    expect(text).toContain("en-CA");
    // Only the fields GEO reads. The other fifteen belong to the Profile
    // editor one card above; showing them here presented values nothing in
    // GEO consumes as though they were part of this asset.
    const names = [...host.querySelectorAll("[data-geo-profile-field]")].map(node => node.getAttribute("data-geo-profile-field"));
    expect(names.sort()).toEqual([...GEO_PROFILE_SUBSET_FIELDS].sort());
    expect(names).not.toContain("jtbd");
    expect(names).not.toContain("businessModel");
    expect(names.length).toBeLessThan(WEBSITE_PROFILE_FIELD_NAMES.length);
    // Nothing here is typed into: the values are edited in the Profile. A
    // read-only input would still carry a caret and a focus ring, and an empty
    // one would hide its "not provided" text in a placeholder.
    expect(host.querySelectorAll("input,textarea,select")).toHaveLength(0);
    for (const field of names) expect(host.querySelector(`[data-geo-profile-field="${field}"] [data-geo-readout]`)).not.toBeNull();
  });
  it("shows every value at rest and says nothing about where it came from", async () => {
    await render();
    // No disclosure to open: each of the 13 is legible without a gesture.
    expect(host.querySelectorAll("details")).toHaveLength(0);
    const text = renderedText(host);
    expect(text).toContain("Copied product");
    expect(text).toContain("Copied ICP");
    // The hash, the revision, the per-field source list and its evidence links
    // describe how the value was produced. The question this panel asks is
    // whether the value matches the product, which none of them answers.
    expect(text).not.toContain(en.tools.geoKnowledgeBase.asset.hash.replace("{hash}", "a".repeat(64)));
    expect(text).not.toContain(en.tools.geoKnowledgeBase.asset.provenanceTitle);
    expect(text).not.toContain("public_page");
    expect(host.querySelector('a[href="https://example.com/about"]')).toBeNull();
  });
  it("offers one fact action per Profile value rather than one per rendering of it", async () => {
    await render({ onAddFact: vi.fn() });
    const keys = [...host.querySelectorAll<HTMLButtonElement>("button")].map(button => button.getAttribute("aria-label"));
    expect(keys).toHaveLength(34);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("does not replace a saved copy with the latest Profile proposal", async () => {
    await render();
    // The panel reads the draft's own copy. `latest` carries a newer Profile;
    // nothing from it may appear until the copy is explicitly adopted. Pinning
    // the revision number here would be a dead pin -- "2" occurs in half the
    // fixture -- so the check is on the values themselves.
    expect(renderedText(host)).toContain("Copied product");
    expect(host.textContent).not.toContain("New source, not copied");
    expect(host.textContent).not.toContain("New source feature");
  });
});
