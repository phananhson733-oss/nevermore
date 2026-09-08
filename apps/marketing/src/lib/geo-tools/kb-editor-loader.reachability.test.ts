// @input  -- the two real route handlers a browser hits, over in-memory stores
// @output -- proof that a knowledge base with nothing stored can become a v3 one
// @pos    -- no provider call, no database, and no seam below the routes stubbed

/**
 * The chain that had no code, driven end to end.
 *
 * `createGeoKbV3Draft` had zero non-test callers and `handleGeoKbV3DraftCreate`
 * was referenced only by its own route file, so no owner could ever reach a v3
 * knowledge base: the website GEO route synthesised a v1 -> v2 payload for a
 * knowledge base with no draft, the v2 card wrote a v2 draft, and the create
 * route then refused that draft forever (`legacy_draft`). Every unit suite over
 * that arrangement was green.
 *
 * So this file starts where a browser starts -- the exported `POST` of
 * `app/api/account/websites/[websiteId]/geo/route.ts` -- runs the browser's own
 * create call in between, and ends on the HTTP body the second load returns.
 * Nothing between the two routes is stubbed except the stores they read and
 * write: the real dispatch, the real loaders, the real identity builder and the
 * real v3 payload contract all run, and the draft the second load reads is the
 * one the first create actually wrote.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  readWebsite: vi.fn(),
  findWebsiteByUrl: vi.fn(),
  ensure: vi.fn(),
  readDetails: vi.fn(),
  saveDraftV3: vi.fn(),
  readSource: vi.fn(),
  readLatestPrepared: vi.fn(),
  readLatestGeneration: vi.fn(),
  readComplete: vi.fn(),
  quota: vi.fn(),
}));

vi.mock("../auth/server-auth-user.ts", () => ({ getServerAuthenticatedUser: mocks.authenticate }));
vi.mock("../account-websites/store.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readAccountWebsite: mocks.readWebsite,
  findAccountWebsiteByUrl: mocks.findWebsiteByUrl,
}));
vi.mock("./kb-store.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ensureGeoKnowledgeBase: mocks.ensure,
}));
vi.mock("./kb-versioned-read.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readVersionedGeoKnowledgeBase: mocks.readDetails,
}));
vi.mock("./kb-complete-read.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readCompleteGeoKnowledgeBase: mocks.readComplete,
}));
vi.mock("./kb-prepared-store.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readGeoSourceReceiptV2: mocks.readSource,
  DEFAULT_GEO_KB_PREPARED_STORE: { read: vi.fn(), readLatest: mocks.readLatestPrepared, freeze: vi.fn() },
}));
vi.mock("./kb-generation-store.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DEFAULT_GEO_KB_GENERATION_STORE: {
    claim: vi.fn(), markDispatched: vi.fn(), finish: vi.fn(),
    read: vi.fn(), readLatest: mocks.readLatestGeneration, readByKey: vi.fn(),
  },
}));
vi.mock("./kb-v3-store.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveGeoKbDraftV3: mocks.saveDraftV3,
}));
vi.mock("../tools/shared-rate-limit.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumePublicToolQuota: mocks.quota,
}));

import { POST as GEO_POST } from "../../app/api/account/websites/[websiteId]/geo/route.ts";
import { POST as DRAFT_POST } from "../../app/api/tools/geo-knowledge-base/v3/draft/route.ts";
import { createGeoKbV3Draft, parseGeoKbEditorViewV3 } from "../../components/tools/use-geo-kb-v3-editor.ts";
import { parseGeoKbEditorViewV2 } from "../../components/tools/geo-kb-v2-wire.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { completePayloadV2 } from "./kb-v2.test-fixtures.ts";
import { isGeoKbPayloadV3Value, type AnyVersionedGeoKbPayload } from "./kb-versioned-read.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const KB_ID = "11111111-1111-4111-8111-111111111113";
/** The website the v2 fixture's stored Profile copy names. */
const WEBSITE_ID = "11111111-1111-4111-8111-111111111115";
const ORIGIN = "https://example.com";
const AT = "2026-09-07T00:00:00.000Z";
const APP = "https://gengrowth.ai";

type StoredDraft = {
  readonly draftVersion: number;
  readonly contentHash: string;
  readonly updatedAt: string;
  readonly payload: AnyVersionedGeoKbPayload;
};
/** The one row both routes share, so the second read sees the first write. */
let draft: StoredDraft | null = null;

function website() {
  return {
    websiteId: WEBSITE_ID, origin: ORIGIN, host: "example.com", canonicalSiteKey: "example.com",
    submittedUrl: `${ORIGIN}/`, displayName: "Acme", isPrimary: true, profileState: "confirmed" as const,
    confirmedSnapshotId: null, confirmedSnapshotRevision: null, confirmedAt: null,
    createdAt: AT, updatedAt: AT, draft: null, currentConfirmedSnapshot: null,
  };
}

beforeEach(() => {
  // Call history, not implementations: every implementation below is re-armed
  // here, and a test that asserts "the store was never written" must not be
  // reading a write the previous test made.
  vi.clearAllMocks();
  draft = null;
  const copy = completePayloadV2().profileCopy;
  mocks.authenticate.mockResolvedValue({ status: "authenticated", userId: USER, email: null, avatarUrl: null });
  mocks.ensure.mockResolvedValue({ kind: "ok", value: { kbId: KB_ID, created: false } });
  mocks.readWebsite.mockResolvedValue({ kind: "ok", value: website() });
  mocks.findWebsiteByUrl.mockResolvedValue({
    kind: "ok",
    value: { website: website(), reference: profileCopyReference(copy), profile: copy.profile },
  });
  mocks.readDetails.mockImplementation(async () => ({
    kind: "ok",
    value: {
      kbId: KB_ID, origin: ORIGIN, host: "example.com", canonicalSiteKey: "example.com",
      createdAt: AT, updatedAt: AT, frozen: null, draft,
    },
  }));
  // The store's own compare-and-swap, which is what makes `baseVersion: 0` mean
  // "only where nothing is stored" rather than "overwrite whatever is there".
  mocks.saveDraftV3.mockImplementation(async (input: { readonly payload: AnyVersionedGeoKbPayload; readonly baseVersion: number }) => {
    const current = draft?.draftVersion ?? 0;
    if (input.baseVersion !== current) return { kind: "conflict", currentDraftVersion: current };
    const contentHash = geoV2Digest(input.payload);
    draft = { draftVersion: current + 1, contentHash, updatedAt: AT, payload: input.payload };
    return { kind: "ok", value: { draftVersion: draft.draftVersion, contentHash, updatedAt: AT } };
  });
  mocks.readSource.mockResolvedValue({ kind: "ok", value: null });
  mocks.readLatestPrepared.mockResolvedValue({ kind: "ok", value: null });
  mocks.readLatestGeneration.mockResolvedValue({ kind: "ok", generation: null });
  mocks.readComplete.mockResolvedValue({ kind: "unavailable", reason: "no frozen version in these fixtures" });
  mocks.quota.mockResolvedValue({ kind: "allowed" });
});

/** The website GEO load, exactly as the account page issues it. */
async function loadGeo(): Promise<Response> {
  const request = new Request(`${APP}/api/account/websites/${WEBSITE_ID}/geo`, {
    method: "POST", headers: { "content-type": "application/json", origin: APP }, body: "{}",
  });
  return GEO_POST(request, { params: Promise.resolve({ websiteId: WEBSITE_ID }) });
}

/**
 * The browser's own create call, over the real create route.
 *
 * `createGeoKbV3Draft` is driven rather than the handler, because the request
 * body and the response reader are two halves of one contract stated twice --
 * once in the route's schema and once in the card's. A test that posted a
 * hand-written body would prove the server half and leave the browser free to
 * send something the route refuses.
 */
async function createFromTheBrowser(kbId = KB_ID) {
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    seen.push(path);
    return DRAFT_POST(new Request(`${APP}${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin: APP }, body: String(init?.body),
    }));
  }) as typeof fetch;
  try {
    return { result: await createGeoKbV3Draft(kbId), seen };
  } finally {
    globalThis.fetch = original;
  }
}

describe("a knowledge base with nothing stored becomes a v3 one", () => {
  it("answers the review view from the same route, once the browser's own create has run", async () => {
    // Before: the only thing an owner could be shown is the v2 editor view the
    // loader synthesises, and it says plainly that nothing is stored.
    const before = (await loadGeo().then((response) => response.json())) as { data: { knowledgeBase: Record<string, unknown> } };
    expect(before.data.knowledgeBase["schemaVersion"]).toBe("marketing-geo-kb-editor.v2");
    expect(before.data.knowledgeBase["draftVersion"]).toBe(0);
    expect(before.data.knowledgeBase["draftHash"]).toBeNull();
    expect(before.data.knowledgeBase["frozen"]).toBeNull();
    // And the browser's reader accepts it, which is what makes the card that
    // offers the start gesture render at all.
    expect(parseGeoKbEditorViewV2(before.data.knowledgeBase)).not.toBeNull();

    const { result, seen } = await createFromTheBrowser();

    expect(seen).toEqual(["/api/tools/geo-knowledge-base/v3/draft"]);
    expect(result).toMatchObject({ ok: true, draft: { kbId: KB_ID, draftVersion: 1 } });
    // The Profile fixture names no categories, so the created draft reports the
    // blocker for it rather than a draft that looks ready to run.
    expect(result.ok && result.draft.blockers).toContain("category_terms_missing");
    expect(draft !== null && isGeoKbPayloadV3Value(draft.payload)).toBe(true);

    const response = await loadGeo();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { knowledgeBase: Record<string, unknown> } };
    const knowledgeBase = body.data.knowledgeBase;
    // The discriminator the page branches on. Without it the redesign renders
    // nothing, however green its own tests are.
    expect(knowledgeBase["schemaVersion"]).toBe("marketing-geo-kb-editor.v3");
    expect(knowledgeBase["kbId"]).toBe(KB_ID);
    expect(knowledgeBase["draftVersion"]).toBe(1);
    expect(knowledgeBase["draftHash"]).toBe(draft?.contentHash);
    expect(knowledgeBase["published"]).toBeNull();
    // Asserting the literal alone would pass for a body the card refuses to
    // parse, which reaches the owner as "bad response" instead of an editor.
    expect(parseGeoKbEditorViewV3(knowledgeBase)).not.toBeNull();
  });

  it("refuses to turn an existing v1/v2 draft into a v3 one, and leaves it on its own card", async () => {
    const payload = completePayloadV2();
    draft = { draftVersion: 3, contentHash: geoV2Digest(payload), updatedAt: AT, payload };

    const { result } = await createFromTheBrowser();

    // Named apart from `draft_exists` because the next step differs, and the
    // version is returned because whoever asked has a stale idea of this
    // knowledge base either way.
    expect(result).toEqual({ ok: false, code: "legacy_draft", draftVersion: 3 });
    expect(mocks.saveDraftV3).not.toHaveBeenCalled();
    expect(draft.payload).toBe(payload);

    const body = (await loadGeo().then((response) => response.json())) as { data: { knowledgeBase: Record<string, unknown> } };
    expect(body.data.knowledgeBase["schemaVersion"]).toBe("marketing-geo-kb-editor.v2");
    expect(body.data.knowledgeBase["draftVersion"]).toBe(3);
  });

  it("creates once: a second create over the draft it just wrote is refused rather than replacing it", async () => {
    const first = await createFromTheBrowser();
    expect(first.result).toMatchObject({ ok: true });
    const written = draft;

    const second = await createFromTheBrowser();

    expect(second.result).toEqual({ ok: false, code: "draft_exists", draftVersion: 1 });
    expect(draft).toBe(written);
  });
});
