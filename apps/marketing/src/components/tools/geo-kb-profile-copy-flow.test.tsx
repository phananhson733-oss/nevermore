// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import { emptyMarketingWebsiteProfile, profileSha256, type WebsiteProfileReferenceV1 } from "../../lib/account-websites/contracts.ts";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { createGeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import { GeoKnowledgeBase } from "./geo-knowledge-base.tsx";
import type { GeoKbView } from "./geo-kb-wire.ts";

const WEBSITE = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const KB = "bf9d42bc-2de8-4faf-98b0-f5f80f3be125";
const baseProfile = { ...emptyMarketingWebsiteProfile(), productName: "Original Profile product", oneLinePositioning: "Positioning one",
  valueProposition: "Original value", primaryIcp: "Original buyer", coreFeatures: ["Feature one"], categories: ["Profile category"],
  country: "US", locale: "en-US" };
const updatedProfile = { ...baseProfile, productName: "New confirmed Profile product", primaryIcp: "New buyer" };
const ref = (hash: string, revision: number): WebsiteProfileReferenceV1 => ({ schemaVersion: "website-profile-reference.v1", websiteId: WEBSITE,
  snapshotId: revision === 1 ? "a53f4ddb-7cd6-42da-af53-88cc68b41987" : "305ef0c6-d145-4e09-8d58-8aebfae33c65",
  snapshotRevision: revision, profileSchemaVersion: "marketing-website-profile.v1", profileHash: hash });
let host: HTMLDivElement;
let root: Root;
let view: GeoKbView;
let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const oldRef = ref(await profileSha256(baseProfile), 1), newRef = ref(await profileSha256(updatedProfile), 2);
  const payload = { ...emptyGeoKbPayload("https://example.com"), officialName: "Custom matching name", aliases: ["Keep alias"], categoryTerms: ["Keep query phrase"],
    market: { country: "GB", language: "en-GB" }, competitors: [{ domain: "rival.example", brandName: "Keep rival", confirmed: true }],
    roles: [{ id: "role-1", label: "Keep role", segment: "Keep segment", painPoints: ["Keep pain"], decisionCriteria: ["Keep criterion"], vocabulary: ["Keep word"] }],
    facts: [{ key: "Keep fact", value: "Recorded value", reason: "" as const, sourceUrl: "https://example.com/fact", observedAt: "2026-08-30T00:00:00Z" }],
    profileCopy: createGeoProfileCopy(oldRef, baseProfile) };
  view = { kbId: KB, origin: "https://example.com", host: "example.com", draftVersion: 7, payload, importAvailable: true,
    profile: { reference: newRef, productName: updatedProfile.productName, oneLinePositioning: updatedProfile.oneLinePositioning, coreFeatures: updatedProfile.coreFeatures,
      market: { country: updatedProfile.country, language: updatedProfile.locale }, fullProfile: updatedProfile },
    context: { skippedLayers: ["problem", "evaluation"], questionSetHash: "c".repeat(64), contentHash: "d".repeat(64) },
    frozen: { snapshotId: "f68a599b-fada-427b-bb94-5f0175d3cdcc", revision: 1, frozenAt: "2026-08-30T00:00:00Z", contentHash: "b".repeat(64), questionCount: 1,
      retrievalCount: 1, payload, questions: [{ id: "q1", text: "Original frozen question", layer: "discovery", mode: "retrieval", calibrated: true }] } };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async (url: string) => url.endsWith("/load") ? Response.json({ data: view }) : Response.json({ data: { draftVersion: 8, updatedAt: "2026-08-31T00:00:00Z", blockers: [], context: view.context } }));
  globalThis.fetch = fetchMock as typeof fetch;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = originalFetch; });
async function render(parentRevision = 2) { await act(async () => root.render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={en}><GeoKnowledgeBase locale="en" signedIn initialView={view} canonicalWebsiteId={WEBSITE} inline confirmedProfileRevision={parentRevision} /></NextIntlClientProvider>)); }
function button(text: string) { const found = [...host.querySelectorAll("button")].find(node => node.textContent === text); expect(found, `button ${text}`).toBeDefined(); return found!; }

describe("explicit complete Profile copy adoption", () => {
  it("keeps an observed source change pending even if the upper revision later returns to its old value", async () => {
    await render(1);
    await act(async () => button("Review latest confirmed Profile").click());
    await act(async () => button("Copy this version into the GEO draft").click());
    await act(async () => button(en.tools.geoKnowledgeBase.draft.save).click());
    expect(button(en.tools.geoKnowledgeBase.freeze.action).disabled).toBe(false);
    await render(3);
    expect(button(en.tools.geoKnowledgeBase.freeze.action).disabled).toBe(true);
    await render(1);
    expect(button(en.tools.geoKnowledgeBase.freeze.action).disabled).toBe(true);
  });
  it("also treats a confirmation reverting to an older snapshot revision as a source-change signal", async () => {
    if (!view.profile?.fullProfile) throw new Error("Fixture missing");
    view = { ...view, payload: { ...view.payload, profileCopy: createGeoProfileCopy(view.profile.reference, view.profile.fullProfile) } };
    await render(2);
    expect(button(en.tools.geoKnowledgeBase.freeze.action).disabled).toBe(false);
    await render(1);
    expect(button(en.tools.geoKnowledgeBase.freeze.action).disabled).toBe(true);
  });
  it("accepts a newer explicitly reviewed source even when the upper Profile was loaded before another tab confirmed it", async () => {
    await render(1);
    await act(async () => button("Review latest confirmed Profile").click());
    await act(async () => button("Copy this version into the GEO draft").click());
    await act(async () => button(en.tools.geoKnowledgeBase.draft.save).click());
    expect(button(en.tools.geoKnowledgeBase.freeze.action).disabled).toBe(false);
  });
  it("does not claim an identical copy changed or create a needless dirty draft", async () => {
    if (!view.profile?.fullProfile) throw new Error("Fixture missing");
    view = { ...view, payload: { ...view.payload, profileCopy: createGeoProfileCopy(view.profile.reference, view.profile.fullProfile) } };
    await render();
    await act(async () => button("Review latest confirmed Profile").click());
    expect(button("Copy this version into the GEO draft").disabled).toBe(true);
    expect(host.textContent).not.toContain(en.tools.geoKnowledgeBase.asset.copyMetadataChanged);
  });
  it("retains the exact complete payload returned by freezing for immediate inspection", async () => {
    if (!view.profile?.fullProfile || !view.frozen) throw new Error("Fixture missing");
    const payload = { ...view.payload, profileCopy: createGeoProfileCopy(view.profile.reference, view.profile.fullProfile) };
    const frozen = { ...view.frozen, revision: 2, payload, reusedExisting: false };
    view = { ...view, payload, frozen: null };
    fetchMock.mockResolvedValueOnce(Response.json({ data: frozen }));
    await render();
    await act(async () => button(en.tools.geoKnowledgeBase.freeze.action).click());
    expect([...(host.querySelector('[data-frozen-knowledge-base]')?.querySelectorAll<HTMLInputElement>("input") ?? [])].some(input => input.value === "New confirmed Profile product")).toBe(true);
    expect(host.querySelector('[data-frozen-knowledge-base]')?.textContent).not.toContain("does not contain a complete Profile copy");
  });
  it("keeps a shared base name read-only and associates GEO controls with their labels", async () => {
    view = { ...view, payload: { ...view.payload, officialName: baseProfile.productName } };
    await render();
    const name = [...host.querySelectorAll("label")].find(label => label.textContent === en.tools.geoKnowledgeBase.brand.officialNameLabel)?.control;
    expect(name).toBeInstanceOf(HTMLInputElement);
    expect((name as HTMLInputElement).readOnly).toBe(true);
    const aliases = [...host.querySelectorAll("label")].find(label => label.textContent === en.tools.geoKnowledgeBase.brand.aliasesLabel);
    expect(aliases?.htmlFor).toBeTruthy();
    expect(aliases?.control).toBeInstanceOf(HTMLInputElement);
  });
  it("previews then copies the source without resetting GEO operations or saving implicitly", async () => {
    await render();
    const currentValues = () => [...host.querySelectorAll("input,textarea")].map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value);
    expect(currentValues()).toContain("Original Profile product");
    expect(button(en.tools.geoKnowledgeBase.freeze.action).disabled).toBe(true);
    await act(async () => button("Review latest confirmed Profile").click());
    expect(host.textContent).toContain("New confirmed Profile product");
    expect(currentValues()).toContain("Original Profile product");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => button("Copy this version into the GEO draft").click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(en.tools.geoKnowledgeBase.draft.unsaved);
    await act(async () => button(en.tools.geoKnowledgeBase.draft.save).click());
    const sent = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(sent.payload.profileCopy.profile).toEqual(updatedProfile);
    for (const field of ["aliases", "categoryTerms", "market", "competitors", "roles", "facts", "officialName"] as const) expect(sent.payload[field]).toEqual(view.payload[field]);
    expect(sent.expectedProfileReference).toEqual(view.profile?.reference);
    expect(sent.baseVersion).toBe(7);
    expect(button(en.tools.geoKnowledgeBase.freeze.action).disabled).toBe(false);
    const frozenValues = [...(host.querySelector('[data-frozen-knowledge-base]')?.querySelectorAll("input,textarea") ?? [])].map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value);
    expect(frozenValues).toContain("Original Profile product");
    expect(frozenValues).not.toContain("New confirmed Profile product");
  });

  it("keeps the legacy copy missing until explicit adoption, and prevents an incomplete freeze", async () => {
    const { profileCopy: _copy, ...legacy } = view.payload;
    view = { ...view, payload: legacy };
    await render();
    expect(host.textContent).toContain("This legacy GEO draft has no complete Profile copy.");
    expect(button(en.tools.geoKnowledgeBase.freeze.action).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
