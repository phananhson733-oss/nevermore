// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json";
import { emptyMarketingWebsiteProfile, WEBSITE_PROFILE_FIELD_NAMES } from "../../lib/account-websites/contracts.ts";
import { GeoKbInheritedProfile } from "./geo-kb-profile.tsx";

const fullProfile = { ...emptyMarketingWebsiteProfile(), productName: "Copied product", oneLinePositioning: "Copied positioning",
  coreFeatures: Array.from({ length: 32 }, (_, i) => `Complete feature ${i + 1}`), valueProposition: "Copied value",
  primaryIcp: "Copied ICP", buyer: "Copied buyer", country: "CA", locale: "en-CA", directCompetitors: ["rival.example"],
  fieldProvenance: [{ path: "/productName" as const, derivation: "observed" as const, confidence: "high" as const,
    source: "public_page" as const, observedAt: "2026-08-31T00:00:00.000Z", evidenceUrls: ["https://example.com/about"], limitation: null }] };
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
  it("gives current and frozen copies independent input and label identities", async () => {
    await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}>
      <GeoKbInheritedProfile profile={null} copy={copy} locale="en" />
      <GeoKbInheritedProfile profile={null} copy={copy} locale="en" />
    </NextIntlClientProvider>));
    const ids = [...host.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const label of host.querySelectorAll("label")) expect(label.control).not.toBeNull();
  });
  it("shows every copied field, including the 32nd feature and provenance, in read-only Profile-style controls", async () => {
    await render();
    const values = [...host.querySelectorAll("input,textarea")].map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value);
    expect(values).toContain("Copied product");
    expect(values).toContain("Copied ICP");
    expect(values).toContain("Complete feature 32");
    expect(values).toContain("en-CA");
    expect(host.querySelector('a[href="https://example.com/about"]')).not.toBeNull();
    const names = [...host.querySelectorAll("[data-geo-profile-field]")].map(node => node.getAttribute("data-geo-profile-field"));
    expect(names.sort()).toEqual([...WEBSITE_PROFILE_FIELD_NAMES].sort());
    const controls = [...host.querySelectorAll("input,textarea")];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.readOnly : false)).toBe(true);
  });
  it("does not replace a saved copy with the latest Profile proposal", async () => {
    await render();
    const values = [...host.querySelectorAll("input,textarea")].map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value);
    expect(values).toContain("Copied product");
    expect(host.textContent).not.toContain("New source, not copied");
    expect(host.textContent).toContain("2");
  });
});
