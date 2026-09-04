// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { completePayloadV2, V2_KB_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { WebsiteGeoEditor } from "./website-geo-editor.tsx";
import { renderedText } from "../tools/rendered-text.test-helper.ts";

const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const PROFILE = {
  reference: { schemaVersion: "website-profile-reference.v1", websiteId: WEBSITE_ID, snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987", snapshotRevision: 2, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) },
  productName: "Inherited product", oneLinePositioning: "Exact saved positioning", coreFeatures: ["Saved feature"], market: { country: "US", language: "en-US" },
};
const VIEW = { kbId: "kb-existing", origin: "https://example.com", host: "example.com", draftVersion: 7, payload: { ...emptyGeoKbPayload("https://example.com"), officialName: "Alias override", market: { country: "US", language: "en-us" } }, frozen: null, importAvailable: true, profile: PROFILE };
const DATA = { website: { websiteId: WEBSITE_ID, origin: VIEW.origin, host: VIEW.host, profileState: "confirmed" }, knowledgeBase: VIEW };
const ASSET = {
  featureCandidateHelp: "Add a pending fact, then review its value, URL and capture time. Nothing is verified automatically.",
  featureCandidateAdd: "Add pending fact",
  title: "Website GEO extension", loading: "Loading website GEO…", retry: "Retry",
  profileRequired: "Confirm this website’s Product Profile to inherit its product facts.",
  profileUnavailable: "The confirmed Product Profile could not be resolved.",
  editProfile: "Edit original Product Profile", canonicalLink: "Open this website’s GEO settings",
  backToWebsites: "All websites", profileTitle: "Inherited Product Profile", profileBody: "Read-only inherited facts.",
  productName: "Product name", positioning: "One-line positioning", features: "Core features",
  revision: "Confirmed Profile revision {revision}", hash: "Profile hash: {hash}",
  officialNameHelp: "Matching alias override, not product name.", websiteNotFound: "Website unavailable in your account.",
  unsupportedLanguage: "Question generation is unavailable for {language}.",
};
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

async function render(websiteId = WEBSITE_ID, confirmedRevision?: number): Promise<void> {
  await act(async () => root.render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={{ tools: { geoKnowledgeBase: { ...en.tools.geoKnowledgeBase, asset: { ...en.tools.geoKnowledgeBase.asset, ...ASSET } } } }}><WebsiteGeoEditor websiteId={websiteId} {...(confirmedRevision === undefined ? {} : { confirmedRevision })} /></NextIntlClientProvider>));
}
function modernData() {
  const payload = completePayloadV2();
  return { ...DATA, knowledgeBase: { schemaVersion: "marketing-geo-kb-editor.v2", kbId: V2_KB_ID, origin: VIEW.origin, host: VIEW.host,
    draftVersion: 1, draftHash: "b".repeat(64), profileCopyHash: "c".repeat(64), payload: { ...payload, profileCopy: { ...payload.profileCopy, websiteId: WEBSITE_ID } }, requiresSave: false,
    profile: null, frozen: null, sourceReceipt: null, prepared: null, generations: { roles: null, questions: null } } };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  fetchMock = vi.fn(async () => Response.json({ data: DATA })); globalThis.fetch = fetchMock as typeof fetch;
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch;
});

describe("website GEO canonical editor", () => {
  it("opens the complete V2 workflow and preserves its draft across Profile notifications", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: modernData() }));
    await render(WEBSITE_ID, 1);
    expect(container.querySelector("[data-geo-kb-v2]")).not.toBeNull();
    const name = [...container.querySelectorAll("input")].find(input => !input.readOnly && input.value === "Acme");
    if (!name) throw new Error("V2 alias field missing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Unsaved V2 name");
      name.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await render(WEBSITE_ID, 2);
    expect(name.isConnected).toBe(true);
    expect(name.value).toBe("Unsaved V2 name");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("refuses a complete stored copy belonging to another route-owned website", async () => {
    const modern = modernData();
    modern.knowledgeBase.payload.profileCopy.websiteId = "11111111-1111-4111-8111-111111111111";
    fetchMock.mockResolvedValueOnce(Response.json({ data: modern }));
    await render();
    expect(container.querySelector("[data-geo-kb-v2]")).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("shows an inherited saved country outside the presets without silently replacing it", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { ...DATA, knowledgeBase: { ...VIEW,
      payload: { ...VIEW.payload, market: { ...VIEW.payload.market, country: "CA" } },
      profile: { ...PROFILE, market: { ...PROFILE.market, country: "CA" } },
    } } }));
    await render();
    const country = container.querySelector<HTMLSelectElement>("#kb-country");
    expect(country?.value).toBe("CA");
    expect(country?.selectedOptions[0]?.textContent).toBe("CA");
    expect([...(country?.options ?? [])].map((option) => option.value)).toEqual(["CA", "US", "GB"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("adds an inherited feature only as an unverified fact candidate without saving or losing other edits", async () => {
    await render();
    const name = [...container.querySelectorAll("input")].find((input) => input.value === "Alias override");
    if (name === undefined) throw new Error("alias field missing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Unsaved alias");
      name.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const add = [...container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === `${ASSET.featureCandidateAdd}: Saved feature`);
    expect(add).toBeDefined();
    await act(async () => add?.click());
    expect(name.value).toBe("Unsaved alias");
    const factKey = [...container.querySelectorAll("input")].find((input) => input.value === "coreFeatures[0]");
    const factRow = factKey?.parentElement?.parentElement;
    expect([...factRow?.querySelectorAll("input") ?? []].map((input) => input.value)).toEqual([
      "coreFeatures[0]", "Saved feature", "", "",
    ]);
    expect(factRow?.querySelector("select")).toBeNull();
    // The Profile row it came from no longer offers the action: the fact is in
    // the review area, so there is nothing left to press rather than a control
    // that refuses. The candidate labels for the refused states are gone.
    expect([...container.querySelectorAll("button")].some((button) => button.getAttribute("aria-label") === `${ASSET.featureCandidateAdd}: Saved feature`)).toBe(false);
    const inherited = container.querySelector("[data-geo-profile-copy], [data-geo-profile-summary]");
    expect(inherited).not.toBeNull();
    expect(inherited?.querySelectorAll("button:disabled")).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("loads by route identity, then reuses the existing editor and exact read-only Profile", async () => {
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([`/api/account/websites/${WEBSITE_ID}/geo`, expect.objectContaining({ method: "POST", body: "{}", cache: "no-store" })]);
    expect(renderedText(container)).toContain("Inherited product");
    expect(renderedText(container)).toContain("Exact saved positioning");
    expect(renderedText(container)).toContain("Saved feature");
    expect(container.textContent).toContain("Confirmed Profile revision 2");
    expect(container.textContent).toContain("a".repeat(64));
    expect([...container.querySelectorAll("input")].some((input) => input.value === "Inherited product")).toBe(false);
    expect([...container.querySelectorAll("input")].some((input) => input.value === "Alias override")).toBe(true);
    expect(container.querySelector("#kb-site-url")).toBeNull();
    expect(container.querySelector(`a[href='/en/account/websites/${WEBSITE_ID}']`)).not.toBeNull();
    expect(container.textContent).toContain("en-us");
  });
  it("does not refetch or replace unsaved GEO edits on parent rerender", async () => {
    await render();
    const name = [...container.querySelectorAll("input")].find((input) => input.value === "Alias override");
    if (name === undefined) throw new Error("alias field missing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Unsaved alias");
      name.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await render();
    expect(name.value).toBe("Unsaved alias");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === en.tools.geoKnowledgeBase.draft.save);
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "conflict" }, draftVersion: 8 }, { status: 409 }));
    await act(async () => save?.click());
    expect(name.value).toBe("Unsaved alias");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ kbId: "kb-existing", baseVersion: 7, payload: { officialName: "Unsaved alias" } });
  });
  it("shows confirmation as the next step when no confirmed Profile exists", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { ...DATA, website: { ...DATA.website, profileState: "draft" }, knowledgeBase: { ...VIEW, profile: null, importAvailable: false } } }));
    await render();
    expect(container.textContent).toContain(ASSET.profileRequired);
    expect(container.textContent).not.toContain("Inherited product");
    expect(container.querySelector(`a[href='/en/account/websites/${WEBSITE_ID}']`)).not.toBeNull();
  });
  it("names the missing Profile instead of blaming the store, and offers no retry", async () => {
    // A website whose Profile was never confirmed answers 409; retrying it can
    // never start working, so the message has to name the step that comes first.
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "profile_copy_required" } }, { status: 409 }));
    await render();
    expect(container.textContent).toContain(ASSET.profileRequired);
    expect(container.textContent).not.toContain(en.tools.geoKnowledgeBase.errors.store_unavailable);
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders loading until the owned view arrives", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => { resolve = done; }));
    await render();
    expect(container.textContent).toContain(ASSET.loading);
    await act(async () => resolve(Response.json({ data: DATA })));
    expect(renderedText(container)).toContain("Inherited product");
  });
  it("shows the actual unsupported Profile language without suggesting English calibration", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { ...DATA, knowledgeBase: { ...VIEW, payload: { ...VIEW.payload, market: { country: "US", language: "zh-cn" } } } } }));
    await render();
    expect(container.textContent).toContain("Question generation is unavailable for zh-cn.");
    expect(container.textContent).not.toContain(en.tools.geoKnowledgeBase.brand.languageNote);
  });
  it.each([
    [401, { error: { code: "auth_required" } }],
    [404, { error: { code: "website_not_found" } }],
    [503, { error: { code: "secret_infrastructure_name" } }],
    [200, { data: { ...DATA, website: { ...DATA.website, websiteId: "another-id" } } }],
    [200, { data: { ...DATA, knowledgeBase: { ...VIEW, profile: { ...PROFILE, coreFeatures: null } } } }],
  ])("fails closed on status %s or malformed/foreign payload without displaying private data", async (status, body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
    await render();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Inherited product");
    expect(container.textContent).not.toContain("secret_infrastructure_name");
  });
});
