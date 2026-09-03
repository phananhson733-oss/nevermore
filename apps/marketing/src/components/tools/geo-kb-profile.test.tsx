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
  it("disables a candidate whose stable fact key already exists", async () => {
    await render({ onAddFact: vi.fn(), facts: [{ key: "productName", value: "Copied product", reason: "", sourceUrl: "https://example.com", observedAt: "2026-09-01" }] });
    const disabled = [...host.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.disabled);
    expect(disabled).toHaveLength(1);
    expect(disabled[0]?.textContent).toBe(en.tools.geoKnowledgeBase.asset.featureCandidateExists);
  });
  it("gives current and frozen copies independent input and label identities", async () => {
    await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}>
      <GeoKbInheritedProfile profile={null} copy={copy} locale="en" />
      <GeoKbInheritedProfile profile={null} copy={copy} locale="en" />
    </NextIntlClientProvider>));
    const ids = [...host.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const label of host.querySelectorAll("label")) expect(label.control).not.toBeNull();
  });
  it("shows the fields GEO reads, including the 32nd feature and their provenance, in read-only Profile-style controls", async () => {
    await render();
    const values = [...host.querySelectorAll("input,textarea")].map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value);
    expect(values).toContain("Copied product");
    expect(values).toContain("Copied ICP");
    expect(values).toContain("Complete feature 32");
    expect(values).toContain("en-CA");
    expect(host.querySelector('a[href="https://example.com/about"]')).not.toBeNull();
    // Only the fields GEO reads. The other fifteen belong to the Profile
    // editor one card above; showing them here presented values nothing in
    // GEO consumes as though they were part of this asset.
    const names = [...host.querySelectorAll("[data-geo-profile-field]")].map(node => node.getAttribute("data-geo-profile-field"));
    expect(names.sort()).toEqual([...GEO_PROFILE_SUBSET_FIELDS].sort());
    expect(names).not.toContain("jtbd");
    expect(names).not.toContain("businessModel");
    expect(names.length).toBeLessThan(WEBSITE_PROFILE_FIELD_NAMES.length);
    // The source list follows the fields, so it does not describe rows that
    // are no longer here.
    const provenance = host.querySelector("details:last-of-type")?.textContent ?? "";
    expect(provenance).not.toContain(en.account.websites.fields.jtbd);
    const controls = [...host.querySelectorAll("input,textarea")];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.readOnly : false)).toBe(true);
  });
  it("leads with the values GEO actually measures and keeps the rest one disclosure away", async () => {
    await render();
    const summary = host.querySelector("[data-geo-profile-summary]");
    expect(summary).not.toBeNull();
    // Inherited values are rendered as read-only controls, as they are in the
    // Profile editor, so what the visitor reads includes those values.
    expect(renderedText(summary)).toContain("Copied product");
    expect(renderedText(summary)).toContain("Copied positioning");
    expect(renderedText(summary)).toContain("Complete feature 1");
    expect(renderedText(summary)).toContain("CA · en-CA");
    expect(renderedText(summary)).not.toContain("Copied ICP");
    const complete = host.querySelector<HTMLDetailsElement>("details[data-geo-copy-complete]");
    expect(complete).not.toBeNull();
    expect(complete?.open).toBe(false);
    expect(complete?.textContent).toContain(en.tools.geoKnowledgeBase.asset.hash.replace("{hash}", "a".repeat(64)));
    expect(complete?.querySelector('[data-geo-profile-field="primaryIcp"]')).not.toBeNull();
    expect(host.textContent).toContain(en.tools.geoKnowledgeBase.asset.copyScopeNote);
  });
  it("offers one fact action per Profile value rather than one per rendering of it", async () => {
    await render({ onAddFact: vi.fn() });
    const complete = host.querySelector("details[data-geo-copy-complete]");
    expect(complete?.querySelectorAll("button")).toHaveLength(0);
    const keys = [...host.querySelectorAll<HTMLButtonElement>("button")].map(button => button.getAttribute("aria-label"));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("does not replace a saved copy with the latest Profile proposal", async () => {
    await render();
    const values = [...host.querySelectorAll("input,textarea")].map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value);
    expect(values).toContain("Copied product");
    expect(host.textContent).not.toContain("New source, not copied");
    expect(host.textContent).toContain("2");
  });
});
