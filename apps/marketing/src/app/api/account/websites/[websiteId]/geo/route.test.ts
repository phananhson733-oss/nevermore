import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * This suite drives the exported route handler, not the loader.
 *
 * The loader's own tests already proved that `createGeoKbEditorLoaderAny`
 * answers a v3 knowledge base with the v3 review view, and they were green
 * while this route passed `loadGeoKbEditorV2` instead -- under which every real
 * owner with a v3 draft got `store_unavailable` 503 and the review card, whose
 * only feed is this route, was unreachable. A test one layer down cannot see
 * that. So nothing below the route is stubbed except the stores themselves:
 * the real `handleWebsiteGeoLoad`, the real runtime wiring and the real
 * dispatch all run, and the assertion is on the HTTP body a browser receives.
 */
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  readWebsite: vi.fn(),
  findWebsiteByUrl: vi.fn(),
  ensure: vi.fn(),
  readDetails: vi.fn(),
  readSource: vi.fn(async () => ({ kind: "ok" as const, value: null })),
  readLatestPrepared: vi.fn(async () => ({ kind: "ok" as const, value: null })),
  readLatestGeneration: vi.fn(async () => ({ kind: "ok" as const, generation: null })),
  readComplete: vi.fn(async () => ({ kind: "unavailable" as const, reason: "no frozen version in these fixtures" })),
}));

vi.mock("../../../../../../lib/auth/server-auth-user.ts", () => ({ getServerAuthenticatedUser: mocks.authenticate }));
vi.mock("../../../../../../lib/account-websites/store.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readAccountWebsite: mocks.readWebsite,
  findAccountWebsiteByUrl: mocks.findWebsiteByUrl,
}));
vi.mock("../../../../../../lib/geo-tools/kb-store.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ensureGeoKnowledgeBase: mocks.ensure,
}));
vi.mock("../../../../../../lib/geo-tools/kb-versioned-read.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readVersionedGeoKnowledgeBase: mocks.readDetails,
}));
vi.mock("../../../../../../lib/geo-tools/kb-complete-read.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readCompleteGeoKnowledgeBase: mocks.readComplete,
}));
vi.mock("../../../../../../lib/geo-tools/kb-prepared-store.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readGeoSourceReceiptV2: mocks.readSource,
  DEFAULT_GEO_KB_PREPARED_STORE: { read: vi.fn(), readLatest: mocks.readLatestPrepared, freeze: vi.fn() },
}));
vi.mock("../../../../../../lib/geo-tools/kb-generation-store.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DEFAULT_GEO_KB_GENERATION_STORE: {
    claim: vi.fn(), markDispatched: vi.fn(), finish: vi.fn(),
    read: vi.fn(), readLatest: mocks.readLatestGeneration, readByKey: vi.fn(),
  },
}));

import { geoV2Digest } from "../../../../../../lib/geo-tools/kb-v2-digest.ts";
import { profileCopyReference } from "../../../../../../lib/geo-tools/kb-profile-copy.ts";
import { completePayloadV2 } from "../../../../../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { completePayloadV3, V3_WEBSITE_ID } from "../../../../../../lib/geo-tools/kb-v3.test-fixtures.ts";
import { parseGeoKbEditorViewV3 } from "../../../../../../components/tools/use-geo-kb-v3-editor.ts";
import { parseGeoKbEditorViewV2 } from "../../../../../../components/tools/geo-kb-v2-wire.ts";
import { POST } from "./route.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const KB_ID = "11111111-1111-4111-8111-111111111113";
/** The website the v2 fixture's stored Profile copy names. */
const V2_WEBSITE_ID = "11111111-1111-4111-8111-111111111115";
const AT = "2026-08-31T00:00:00.000Z";
const APP = "https://gengrowth.ai";

function website(websiteId: string) {
  return {
    websiteId, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com",
    submittedUrl: "https://example.com/", displayName: "Acme", isPrimary: true, profileState: "confirmed" as const,
    confirmedSnapshotId: null, confirmedSnapshotRevision: null, confirmedAt: null,
    createdAt: AT, updatedAt: AT, draft: null, currentConfirmedSnapshot: null,
  };
}
function registered() {
  return {
    kbId: KB_ID, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com",
    createdAt: AT, updatedAt: AT, frozen: null, draft: null,
  };
}
function details(payload: unknown, draftVersion: number) {
  return { ...registered(), draft: { draftVersion, contentHash: geoV2Digest(payload), updatedAt: AT, payload } };
}
function arrange(websiteId: string, stored: object | null) {
  mocks.readWebsite.mockResolvedValue({ kind: "ok", value: website(websiteId) });
  mocks.readDetails.mockResolvedValue({ kind: "ok", value: stored });
}
/**
 * Every test starts signed in, with the knowledge base registered and no
 * confirmed Profile. Each mock is re-armed here rather than at the end of the
 * test that changed it, so a failing test cannot leave the next one running
 * against a fixture it never chose.
 */
beforeEach(() => {
  mocks.authenticate.mockResolvedValue({ status: "authenticated", userId: USER, email: null, avatarUrl: null });
  mocks.ensure.mockResolvedValue({ kind: "ok", value: { kbId: KB_ID, created: false } });
  mocks.findWebsiteByUrl.mockResolvedValue({ kind: "missing" });
  mocks.readSource.mockResolvedValue({ kind: "ok", value: null });
  mocks.readLatestPrepared.mockResolvedValue({ kind: "ok", value: null });
  mocks.readLatestGeneration.mockResolvedValue({ kind: "ok", generation: null });
  mocks.readComplete.mockClear();
});
async function post(websiteId: string): Promise<Response> {
  const request = new Request(`${APP}/api/account/websites/${websiteId}/geo`, {
    method: "POST", headers: { "content-type": "application/json", origin: APP }, body: "{}",
  });
  return POST(request, { params: Promise.resolve({ websiteId }) });
}

describe("canonical website GEO route, end to end over the stores", () => {
  it("answers a stored v3 draft with the v3 review view the card reads", async () => {
    const payload = completePayloadV3();
    arrange(V3_WEBSITE_ID, details(payload, 5));

    const response = await post(V3_WEBSITE_ID);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { knowledgeBase: Record<string, unknown> } };
    const knowledgeBase = body.data.knowledgeBase;
    // The discriminator is the whole point: the client branches that render the
    // review card test this exact literal, so a body without it renders nothing.
    expect(knowledgeBase["schemaVersion"]).toBe("marketing-geo-kb-editor.v3");
    expect(knowledgeBase["kbId"]).toBe(KB_ID);
    expect(knowledgeBase["draftVersion"]).toBe(5);
    expect(knowledgeBase["draftHash"]).toBe(geoV2Digest(payload));
    expect(knowledgeBase["payload"]).toEqual(payload);
    // And the browser's own reader accepts it. Asserting the discriminator
    // alone would pass for a body whose payload the card refuses to parse,
    // which reaches the owner as "bad response" instead of an editor.
    expect(parseGeoKbEditorViewV3(knowledgeBase)).not.toBeNull();
    // A knowledge base with no published version reads no snapshot. Narrow on
    // purpose: it says nothing about the path that does have one, which the
    // loader's own tests cover.
    expect(mocks.readComplete).not.toHaveBeenCalled();
  });

  it("still answers a v2 knowledge base with the v2 editor view", async () => {
    const payload = completePayloadV2();
    arrange(V2_WEBSITE_ID, details(payload, 1));

    const response = await post(V2_WEBSITE_ID);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { knowledgeBase: Record<string, unknown> } };
    const knowledgeBase = body.data.knowledgeBase;
    expect(knowledgeBase["schemaVersion"]).toBe("marketing-geo-kb-editor.v2");
    expect(knowledgeBase["payload"]).toEqual(payload);
    expect(knowledgeBase["requiresSave"]).toBe(false);
    expect(parseGeoKbEditorViewV2(knowledgeBase)).not.toBeNull();
  });

  it("refuses a v3 draft whose locked Profile revision names another website", async () => {
    const payload = completePayloadV3();
    // Same canonical site, different Website row: the store answered with a
    // knowledge base built from a Profile revision this website does not own.
    const foreign = "11111111-1111-4111-8111-11111111111f";

    // First the control, with this exact fixture. Without it the refusal below
    // is satisfied by any earlier failure -- including the dispatch bug this
    // file exists to catch, which answers 503 for every v3 draft -- and the
    // test would keep passing while checking nothing it is named for.
    arrange(V3_WEBSITE_ID, details(payload, 5));
    expect((await post(V3_WEBSITE_ID)).status).toBe(200);

    arrange(foreign, details(payload, 5));
    const response = await post(foreign);

    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "store_unavailable" } });
    // Nothing from the other website's knowledge crosses the boundary.
    expect(text).not.toContain("The Pro plan costs 9 per month.");
    expect(text).not.toContain("Charts for astrologers.");
  });
});

/**
 * What an owner who has never built a knowledge base is told.
 *
 * The route collapses every non-`ok` load outcome that is not `not_found` or
 * `profile_copy_required` into 503 `store_unavailable`, which is a claim about
 * the store. These two pin the states that would be wrong to make that claim
 * about: neither of them is an outage, and neither of them answers 503.
 */
describe("a website with no knowledge base yet is not an outage", () => {
  it("builds the first editor view from the confirmed Profile rather than reporting a store failure", async () => {
    const copy = completePayloadV2().profileCopy;
    arrange(V2_WEBSITE_ID, registered());
    mocks.findWebsiteByUrl.mockResolvedValue({
      kind: "ok", value: { reference: profileCopyReference(copy), profile: copy.profile },
    });

    const response = await post(V2_WEBSITE_ID);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { knowledgeBase: Record<string, unknown> } };
    expect(body.data.knowledgeBase["schemaVersion"]).toBe("marketing-geo-kb-editor.v2");
    // Nothing is stored yet, and the view says so instead of pretending a
    // draft exists: version 0, no content hash, and a save still owed.
    expect(body.data.knowledgeBase["draftVersion"]).toBe(0);
    expect(body.data.knowledgeBase["draftHash"]).toBeNull();
    expect(body.data.knowledgeBase["requiresSave"]).toBe(true);
  });

  it("names the missing confirmed Profile instead of blaming the store", async () => {
    arrange(V2_WEBSITE_ID, registered());

    const response = await post(V2_WEBSITE_ID);

    // 409 with the step the owner has to take first, never 503: a retry of an
    // outage that is not happening can never succeed.
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "profile_copy_required" } });
  });
});
