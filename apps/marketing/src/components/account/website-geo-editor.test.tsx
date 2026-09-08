// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { completePayloadV2, V2_KB_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { completePayloadV3, V3_KB_ID } from "../../lib/geo-tools/kb-v3.test-fixtures.ts";
import { parseGeoKbPayloadV3 } from "../../lib/geo-tools/kb-v3-contract.ts";
import { geoV2Digest } from "../../lib/geo-tools/kb-v2-digest.ts";
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
/**
 * A stored v3 draft exactly as the website GEO route carries it.
 *
 * `websiteId` is a parameter rather than a constant because the only difference
 * between the reachability case and the foreign-website refusal below is that
 * one field: a negative test built from a separately hand-written object could
 * pass because of some other difference nobody noticed.
 */
function v3Data(websiteId = WEBSITE_ID) {
  const base = completePayloadV3();
  const payload = parseGeoKbPayloadV3({ ...base, generationInput: { ...base.generationInput,
    profileRef: { ...base.generationInput.profileRef, websiteId } } });
  return { ...DATA, knowledgeBase: { schemaVersion: "marketing-geo-kb-editor.v3", kbId: V3_KB_ID,
    origin: VIEW.origin, host: VIEW.host, draftVersion: 4, draftHash: geoV2Digest(payload), payload, published: null } };
}

/**
 * The same website GEO response, for a knowledge base with nothing stored in
 * it: version zero, no content hash, a save still owed and no published
 * version. The route really does answer this -- see
 * `../../lib/geo-tools/kb-editor-loader.reachability.test.ts`, which reads it
 * off the HTTP body -- and the parser refuses any view where `draftVersion` and
 * `draftHash` disagree about it.
 */
function emptyV2Data() {
  const payload = completePayloadV2();
  return { ...DATA, knowledgeBase: { schemaVersion: "marketing-geo-kb-editor.v2", kbId: V3_KB_ID, origin: VIEW.origin, host: VIEW.host,
    draftVersion: 0, draftHash: null, profileCopyHash: "c".repeat(64),
    payload: { ...payload, profileCopy: { ...payload.profileCopy, websiteId: WEBSITE_ID } }, requiresSave: true,
    profile: null, frozen: null, sourceReceipt: null, prepared: null, generations: { roles: null, questions: null } } };
}
const GEO_URL = `/api/account/websites/${WEBSITE_ID}/geo`;
const DRAFT_URL = "/api/tools/geo-knowledge-base/v3/draft";
const CREATED = { kbId: V3_KB_ID, draftVersion: 1, contentHash: "c".repeat(64), updatedAt: "2026-09-07T00:00:00.000Z",
  generationInputHash: "e".repeat(64), blockers: [] };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  fetchMock = vi.fn(async () => Response.json({ data: DATA })); globalThis.fetch = fetchMock as typeof fetch;
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch;
});

describe("website GEO canonical editor", () => {
  it("mounts the V2 knowledge base once and keeps it across Profile notifications", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: modernData() }));
    await render(WEBSITE_ID, 1);
    const card = container.querySelector("[data-geo-kb-v2]");
    const generate = container.querySelector("[data-generate-kb]");
    expect(card).not.toBeNull();
    expect(generate).not.toBeNull();

    // A new confirmed Profile revision arriving must not remount the card: a
    // remount would discard a run in progress and re-read the knowledge base.
    await render(WEBSITE_ID, 2);

    expect(card?.isConnected).toBe(true);
    expect(generate?.isConnected).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("mounts the v3 review card when the route answers with a v3 draft", async () => {
    // The whole point of this one: it goes through the response reader and the
    // mount decision rather than rendering the card directly, because that is
    // the link that was missing -- nothing in the tree passed a v3 draft, so
    // the review card, its editor hook and its row components were unreachable
    // in the product no matter how well they worked in isolation.
    fetchMock.mockResolvedValueOnce(Response.json({ data: v3Data() }));
    await render();
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector("[data-geo-kb-v3]")).not.toBeNull();
    expect(container.querySelector("[data-geo-kb-v2]")).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // The publish box belongs to the v3 card alone; its presence is what says
    // the review tree really mounted rather than an empty shell.
    expect(container.querySelector("[data-kb-publish-box]")).not.toBeNull();
  });
  it("starts the redesign from an empty knowledge base and mounts what the reload answers with", async () => {
    /**
     * The link that did not exist. `createGeoKbV3Draft` had no non-test caller,
     * so nothing ever produced a first v3 draft: an owner with nothing stored
     * got the v2 card, its button wrote a v2 draft, and the create route
     * refused that draft from then on. Every step below is a real one -- the
     * response reader, the mount decision, the create request and the re-read
     * -- because the defect lived between them, not inside any of them.
     */
    const geo = [emptyV2Data(), v3Data()];
    const seen: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      seen.push(url);
      if (url === GEO_URL) return Response.json({ data: geo.shift() });
      if (url === DRAFT_URL) return Response.json({ data: CREATED });
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    });
    await render();

    expect(container.querySelector("[data-geo-kb-start]")).not.toBeNull();
    expect(container.querySelector("[data-geo-kb-v3]")).toBeNull();
    // Loading a page must not write a draft or spend a create.
    expect(seen).toEqual([GEO_URL]);

    await act(async () => container.querySelector<HTMLElement>("[data-generate-kb]")?.click());
    await act(async () => { await Promise.resolve(); });

    expect(seen.slice(0, 3)).toEqual([GEO_URL, DRAFT_URL, GEO_URL]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ kbId: V3_KB_ID, baseVersion: 0 });
    expect(container.querySelector("[data-geo-kb-v3]")).not.toBeNull();
    expect(container.querySelector("[data-geo-kb-start]")).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("leaves a v2 draft on the v2 card instead of redrawing it as a v3 review", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: modernData() }));
    await render();
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector("[data-geo-kb-v2]")).not.toBeNull();
    expect(container.querySelector("[data-geo-kb-v3]")).toBeNull();
  });
  it("refuses a v3 draft locked to another route-owned website's Profile", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: v3Data("11111111-1111-4111-8111-111111111111") }));
    await render();
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector("[data-geo-kb-v3]")).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
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
    // The fact is keyed by the claim: "coreFeatures[0]" names a Profile field,
    // appears on no page, and the crawl check looks for the key on the page.
    expect([...container.querySelectorAll("input")].some((input) => input.value === "coreFeatures[0]")).toBe(false);
    const factKey = [...container.querySelectorAll("input")].find((input) => input.value === "Saved feature");
    const factRow = factKey?.parentElement?.parentElement;
    expect([...factRow?.querySelectorAll("input") ?? []].map((input) => input.value)).toEqual([
      "Saved feature", "Saved feature", "", "",
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
