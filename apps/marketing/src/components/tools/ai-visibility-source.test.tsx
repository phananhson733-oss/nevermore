// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile, WEBSITE_PROFILE_FIELD_NAMES } from "../../lib/account-websites/contracts.ts";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { createGeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import type { VisibilityWebsiteContext } from "../../lib/geo-tools/visibility-context.ts";
import enMessages from "../../i18n/messages/en.json";
import zhMessages from "../../i18n/messages/zh.json";
import { AiVisibilitySource } from "./ai-visibility-source.tsx";

const en = enMessages.tools.aiVisibility;
const zh = zhMessages.tools.aiVisibility;
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const time = "2026-08-31T00:00:00.000Z";
const profile = { ...emptyMarketingWebsiteProfile(), productName: "Frozen brand", country: "US", locale: "en", coreFeatures: Array.from({ length: 32 }, (_, i) => `Feature ${i + 1}`), directCompetitors: ["one.com", "two.com", "three.com", "four.com", "five.com", "six.com"] };
const reference = { schemaVersion: "website-profile-reference.v1", websiteId: id(1), snapshotId: id(2), snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) } as const;
function fixture(): VisibilityWebsiteContext {
  return {
    website: { websiteId: id(1), origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", displayName: "Example", isPrimary: true, profileState: "confirmed", confirmedSnapshotId: id(3), confirmedSnapshotRevision: 3, confirmedAt: time, createdAt: time, updatedAt: time },
    currentProfile: { reference: { ...reference, snapshotId: id(3), snapshotRevision: 3, profileHash: "d".repeat(64) }, profile: { ...profile, productName: "Latest brand" }, confirmedAt: time },
    knowledgeBase: { kbId: id(4), draftVersion: 5, hasDraft: true },
    frozen: { snapshotId: id(5), revision: 2, frozenAt: time, contentHash: "b".repeat(64), questionSetHash: "c".repeat(64), registryVersion: "registry-v1", questionCount: 1, retrievalCount: 1, profileReference: reference, profileCompleteness: "complete", skippedLayers: ["problem"],
      payload: { ...emptyGeoKbPayload("https://example.com"), officialName: "Measured brand", categoryTerms: ["analytics"], profileCopy: createGeoProfileCopy(reference, profile), roles: [{ id: "buyer", label: "Buyer", segment: "Small teams", painPoints: ["Fragmented data"], decisionCriteria: ["Accuracy"], vocabulary: ["analytics"] }], competitors: [{ domain: "one.com", brandName: "One", aliases: ["One analytics"], confirmed: true }, { domain: "two.com", brandName: "", confirmed: false }], facts: [{ key: "pricing", value: "", reason: "notPublished", sourceUrl: "javascript:alert(1)", observedAt: time }] },
      questions: [{ id: "q1", text: "What are the best analytics tools?", layer: "discovery", mode: "retrieval", calibrated: true, roleId: "buyer", templateId: "template-v1", requiredEntities: ["analytics"] }] },
    preparation: { status: "profile_update_available", profileSync: "outdated", languageWarnings: ["category_terms_not_english"] },
  };
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function mount(site = fixture(), historical = false, locale: "en" | "zh" = "en") {
  act(() => root.render(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={{ tools: { aiVisibility: locale === "zh" ? zh : en } }}><AiVisibilitySource site={site} locale={locale} historical={historical} /></NextIntlClientProvider>));
}

describe("complete and exact AI Visibility source inspection", () => {
  it("separates latest settings from the actual frozen source and measurement input", () => {
    mount();
    const current = host.querySelector('[data-source="current-profile"]');
    const frozen = host.querySelector('[data-source="frozen"]');
    expect(current?.textContent).toContain("Latest brand");
    expect(current?.textContent).not.toContain("Frozen brand");
    expect(frozen?.textContent).toContain("Frozen brand");
    expect(frozen?.textContent).toContain("Measured brand");
    expect(frozen?.textContent).not.toContain("Latest brand");
    expect(frozen?.textContent).toContain("a".repeat(64));
    expect(frozen?.textContent).toContain("b".repeat(64));
    expect(frozen?.textContent).toContain("c".repeat(64));
    expect(current?.hasAttribute("open")).toBe(false);
    expect(frozen?.hasAttribute("open")).toBe(false);
  });
  it("retains all profile fields, 32 features, six competitors and operational role details", () => {
    mount();
    const frozen = host.querySelector('[data-source="frozen"]')!;
    expect(frozen.querySelectorAll("[data-profile-field]")).toHaveLength(WEBSITE_PROFILE_FIELD_NAMES.length);
    expect(frozen.textContent).toContain("Feature 32");
    expect(frozen.textContent).toContain("six.com");
    for (const text of ["Small teams", "Fragmented data", "Accuracy", "One analytics", "Unconfirmed · excluded from SOV", "Not published"]) expect(frozen.textContent).toContain(text);
    expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
  });
  it("exposes stored questions, calibration and preparation warnings without rewriting them", () => {
    mount();
    const questions = host.querySelector('[data-source="questions"]');
    expect(questions?.textContent).toContain("What are the best analytics tools?");
    expect(questions?.textContent).toContain("Retrieval calibrated");
    expect(questions?.textContent).toContain("template-v1");
    expect(host.textContent).toContain("Category terms are not in English");
    expect(host.querySelector('a[href="/account/websites/' + id(1) + '"]')).not.toBeNull();
    expect(host.querySelector('a[href="/account/websites/' + id(1) + '/geo"]')).not.toBeNull();
    expect(host.querySelector("input, textarea, button")).toBeNull();
    expect(host.querySelector('[data-testid="visibility-source"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="frozen-question-preview"]')).not.toBeNull();
  });
  it("labels operational overrides and competitor selection separately from complete Profile retention", () => {
    mount();
    const differences = host.querySelector('[data-source="measurement-differences"]');
    expect(differences?.textContent).toContain("Brand name for matching");
    expect(differences?.textContent).toContain("Measured competitors");
    expect(differences?.textContent).toContain("a selected subset");
  });
  it("compares operational values with their exact frozen Profile, not the latest Profile", () => {
    const site = fixture();
    const retained = { ...profile, categories: ["analytics"], buyer: "Teams", primaryIcp: "Operators", directCompetitors: ["one.com"] };
    mount({ ...site, frozen: { ...site.frozen!, payload: { ...site.frozen!.payload, profileCopy: createGeoProfileCopy(reference, retained), officialName: "Frozen brand", roles: [{ id: "profile-primary", label: "Teams", segment: "Operators", painPoints: [], decisionCriteria: [], vocabulary: [] }], competitors: [{ domain: "one.com", brandName: "One", aliases: ["One analytics"], confirmed: true }] } } });
    expect(host.querySelector('[data-source="measurement-differences"]')).toBeNull();
  });
  it("never fills historical legacy gaps with the current profile", () => {
    const site = fixture();
    const { profileCopy: _copy, ...payload } = site.frozen!.payload;
    mount({ ...site, frozen: { ...site.frozen!, payload, profileReference: null, profileCompleteness: "legacy_partial" } }, true);
    expect(host.querySelector('[data-source="current-profile"]')).toBeNull();
    expect(host.textContent).not.toContain("Latest brand");
    expect(host.textContent).not.toContain("Feature 32");
    expect(host.textContent).toContain("The complete Profile was not retained");
    expect(host.textContent).toContain(id(5));
  });
  it("shows an unprepared website without inventing frozen content", () => {
    mount({ ...fixture(), frozen: null, preparation: { status: "freeze_required", profileSync: "missing", languageWarnings: [] } });
    expect(host.querySelector('[data-source="frozen"]')).toBeNull();
    expect(host.querySelector('[data-source="questions"]')).toBeNull();
    expect(host.textContent).toContain("No frozen input yet");
    expect(host.querySelector('[data-source="current-profile"]')).not.toBeNull();
  });
  it("keeps the same source distinctions and canonical links in Chinese", () => {
    mount(fixture(), false, "zh");
    expect(host.textContent).toContain("设置中的最新资料");
    expect(host.textContent).toContain("本轮实际使用的冻结输入");
    expect(host.textContent).not.toContain("tools.aiVisibility.source");
    expect(host.querySelector('a[href="/zh/account/websites/' + id(1) + '"]')).not.toBeNull();
  });
});
