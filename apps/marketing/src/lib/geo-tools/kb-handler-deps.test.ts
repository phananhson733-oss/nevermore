import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyGeoKbPayload } from "./kb-contract.ts";
import {
  emptyMarketingWebsiteProfile,
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
} from "../account-websites/contracts.ts";
import {
  GEO_QUESTION_SET_SCHEMA_VERSION,
  type GeoQuestion,
  type GeoQuestionMode,
  type GeoQuestionSet,
} from "./kb-questions.ts";
import type { GeoKbDetails, GeoKbFrozenSnapshot } from "./kb-store.ts";
import { createHash } from "node:crypto";
import { canonicalProfileJson } from "../account-websites/contracts.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { contextPayload } from "./snapshot-context.test-fixtures.ts";

const mocks = vi.hoisted(() => ({
  ensureGeoKnowledgeBase: vi.fn(),
  findAccountWebsiteByUrl: vi.fn(),
  readFrozenGeoKb: vi.fn(),
  readGeoKnowledgeBase: vi.fn(),
  readLatestGeoEnrichmentReceipt: vi.fn(),
  readGeoSnapshotContext: vi.fn(),
  saveGeoKbDraft: vi.fn(),
}));

vi.mock("./asset-context-store.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./asset-context-store.ts")>(),
  readLatestGeoEnrichmentReceipt: mocks.readLatestGeoEnrichmentReceipt,
  readGeoSnapshotContext: mocks.readGeoSnapshotContext,
}));

vi.mock("../account-websites/store.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../account-websites/store.ts")
  >();
  return {
    ...actual,
    findAccountWebsiteByUrl: mocks.findAccountWebsiteByUrl,
  };
});

vi.mock("./kb-store.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./kb-store.ts")>();
  return {
    ...actual,
    ensureGeoKnowledgeBase: mocks.ensureGeoKnowledgeBase,
    readFrozenGeoKb: mocks.readFrozenGeoKb,
    readGeoKnowledgeBase: mocks.readGeoKnowledgeBase,
    saveGeoKbDraft: mocks.saveGeoKbDraft,
  };
});

const { DEFAULT_GEO_KB_HANDLER_DEPENDENCIES } = await import(
  "./kb-handler-deps.ts"
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const KB_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-08-31T00:00:00.000Z";

function question(mode: GeoQuestionMode, index: number): GeoQuestion {
  return {
    id: `q${String(index + 1)}`,
    text: `question ${String(index + 1)}`,
    layer: "discovery",
    mode,
    roleId: null,
    requiredEntities: [],
    templateId: mode === "retrieval" ? `template-${String(index + 1)}` : null,
    calibrated: mode === "retrieval",
  };
}

const QUESTION_SET: GeoQuestionSet = {
  schemaVersion: GEO_QUESTION_SET_SCHEMA_VERSION,
  registryVersion: "test",
  language: "en",
  country: "US",
  questions: [
    ...Array.from({ length: 8 }, (_, index) => question("retrieval", index)),
    ...Array.from({ length: 3 }, (_, index) => question("demand", index + 8)),
  ],
};

const FROZEN = {
  snapshotId: SNAPSHOT_ID,
  revision: 1,
  contentHash: "content-hash",
  questionSetHash: "question-set-hash",
  frozenAt: NOW,
  questionCount: QUESTION_SET.questions.length,
} as const;

function details(frozen: GeoKbDetails["frozen"] = FROZEN): GeoKbDetails {
  return {
    kbId: KB_ID,
    origin: "https://example.com",
    host: "example.com",
    canonicalSiteKey: "example.com",
    createdAt: NOW,
    updatedAt: NOW,
    draft: null,
    frozen,
  };
}

const SNAPSHOT: GeoKbFrozenSnapshot = {
  ...FROZEN,
  kbId: KB_ID,
  payload: emptyGeoKbPayload("https://example.com"),
  questionSet: QUESTION_SET,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureGeoKnowledgeBase.mockResolvedValue({
    kind: "ok",
    value: { kbId: KB_ID, created: false },
  });
  mocks.readGeoKnowledgeBase.mockResolvedValue({
    kind: "ok",
    value: details(),
  });
  mocks.readFrozenGeoKb.mockResolvedValue({ kind: "ok", value: SNAPSHOT });
  mocks.findAccountWebsiteByUrl.mockResolvedValue({ kind: "missing" });
  mocks.readLatestGeoEnrichmentReceipt.mockResolvedValue({ kind: "ok", value: null });
  mocks.readGeoSnapshotContext.mockResolvedValue({ kind: "ok", value: null });
  mocks.saveGeoKbDraft.mockResolvedValue({ kind: "ok", value: { draftVersion: 1, updatedAt: NOW, contentHash: "a".repeat(64) } });
});

describe("default GEO knowledge-base load", () => {
  it("includes exact frozen payload, not today's source proposal, in its read-only preview", async () => {
    const loaded = await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase({ userId: USER_ID, url: "https://example.com/" });
    expect(loaded).toMatchObject({ kind: "ok", value: { frozen: { payload: SNAPSHOT.payload } } });
  });
  it("requires the Profile reference the editor actually saw before saving a new-source draft", async () => {
    const result = await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.saveDraft({ userId: USER_ID, kbId: KB_ID, payload: emptyGeoKbPayload("https://example.com"), baseVersion: 0 });
    expect(result.kind).toBe("context_stale");
    expect(mocks.saveGeoKbDraft).not.toHaveBeenCalled();
  });
  it("reloads the exact frozen questions and previews missing-source layer skips", async () => {
    const loaded = await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase({ userId: USER_ID, url: "https://example.com/" });
    expect(loaded).toMatchObject({ kind: "ok", value: { frozen: { questions: QUESTION_SET.questions, questionSetHash: FROZEN.questionSetHash, registryVersion: "test" }, context: { skippedLayers: ["problem", "evaluation"] } } });
  });
  it("carries the confirmed website profile as an exact inherited reference", async () => {
    const profile = {
      ...emptyMarketingWebsiteProfile(),
      productName: "Example", oneLinePositioning: "A confirmed product statement",
      coreFeatures: ["Birth chart calculator", "Journal"], country: "US", locale: "en",
    };
    const reference = {
      schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
      websiteId: "44444444-4444-4444-8444-444444444444",
      snapshotId: "55555555-5555-4555-8555-555555555555",
      snapshotRevision: 3,
      profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex"),
    };
    mocks.findAccountWebsiteByUrl.mockResolvedValue({
      kind: "ok",
      value: {
        website: {
          websiteId: reference.websiteId,
          origin: "https://example.com",
          canonicalSiteKey: "example.com",
        },
        reference,
        profile,
      },
    });
    const outcome = await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase({
      userId: USER_ID,
      url: "https://example.com/",
    });
    expect(outcome).toMatchObject({
      kind: "ok",
      value: {
        kbId: KB_ID,
        profile: {
          reference,
          productName: "Example",
          oneLinePositioning: "A confirmed product statement",
          coreFeatures: ["Birth chart calculator", "Journal"],
          market: { country: "US", language: "en" },
          fieldProvenance: [],
        },
      },
    });
  });

  it("counts retrieval questions from the exact frozen set", async () => {
    const outcome = await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase({
      userId: USER_ID,
      url: "https://example.com/",
    });

    expect(mocks.readFrozenGeoKb).toHaveBeenCalledWith({
      userId: USER_ID,
      kbId: KB_ID,
      revision: 1,
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.value.frozen).toMatchObject({
        questionCount: 11,
        retrievalCount: 8,
      });
    }
  });

  it("fails closed when the frozen set cannot be read", async () => {
    mocks.readFrozenGeoKb.mockResolvedValue({
      kind: "unavailable",
      reason: "store_unavailable",
    });

    await expect(
      DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase({
        userId: USER_ID,
        url: "https://example.com/",
      }),
    ).resolves.toEqual({ kind: "unavailable", reason: "store_unavailable" });
  });

  it("treats a missing exact frozen set as store inconsistency", async () => {
    mocks.readFrozenGeoKb.mockResolvedValue({ kind: "missing" });

    await expect(
      DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase({
        userId: USER_ID,
        url: "https://example.com/",
      }),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: "frozen snapshot unavailable",
    });
  });

  it("does not read a snapshot when the knowledge base has none frozen", async () => {
    mocks.readGeoKnowledgeBase.mockResolvedValue({
      kind: "ok",
      value: details(null),
    });

    const outcome = await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase({
      userId: USER_ID,
      url: "https://example.com/",
    });

    expect(mocks.readFrozenGeoKb).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.value.frozen).toBeNull();
  });
});

describe("complete source-copy lifecycle", () => {
  function source() {
    const profile = { ...emptyMarketingWebsiteProfile(), productName: "Example", categories: ["analytics"], coreFeatures: Array.from({ length: 32 }, (_, i) => `feature${String(i)}`), buyer: "Long source buyer ".repeat(100), country: "US", locale: "en" };
    const reference = { schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION, websiteId: "44444444-4444-4444-8444-444444444444", snapshotId: "55555555-5555-4555-8555-555555555555", snapshotRevision: 3, profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION, profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") };
    mocks.findAccountWebsiteByUrl.mockResolvedValue({ kind: "ok", value: { website: { websiteId: reference.websiteId, origin: "https://example.com", canonicalSiteKey: "example.com" }, profile, reference } });
    mocks.readGeoKnowledgeBase.mockResolvedValue({ kind: "ok", value: details(null) });
    return { profile, reference, payload: { ...contextPayload(), profileCopy: createGeoProfileCopy(reference, profile) } };
  }
  it("prepares an unsaved exact full copy and sends complete current source data for explicit adoption", async () => {
    const { profile, payload } = source();
    const loaded = await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase({ userId: USER_ID, url: "https://example.com/" });
    expect(loaded).toMatchObject({ kind: "ok", value: { draftVersion: 0, payload: { profileCopy: payload.profileCopy }, profile: { fullProfile: profile } } });
    expect(mocks.saveGeoKbDraft).not.toHaveBeenCalled();
  });
  it("does not replace an existing copy or operational edits when the current Profile changes", async () => {
    const { profile, payload, reference } = source();
    const oldProfile = { ...profile, valueProposition: "Previously saved source" };
    const oldCopy = createGeoProfileCopy({ ...reference, snapshotRevision: 2, profileHash: createHash("sha256").update(canonicalProfileJson(oldProfile)).digest("hex") }, oldProfile);
    const saved = { ...payload, profileCopy: oldCopy, aliases: ["custom"], facts: contextPayload().facts };
    mocks.readGeoKnowledgeBase.mockResolvedValue({ kind: "ok", value: { ...details(null), draft: { draftVersion: 8, payload: saved, contentHash: "c".repeat(64), updatedAt: NOW } } });
    expect(await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.loadKnowledgeBase({ userId: USER_ID, url: "https://example.com/" })).toMatchObject({ kind: "ok", value: { payload: saved, profile: { fullProfile: profile } } });
    expect(mocks.saveGeoKbDraft).not.toHaveBeenCalled();
  });
  it.each(["foreign", "stale", "forged", "self_hash_forged"])("rejects %s copy on save before persistence", async (kind) => {
    const { reference, payload } = source();
    const copy = { ...payload.profileCopy };
    if (kind === "foreign") copy.websiteId = USER_ID;
    if (kind === "stale") copy.snapshotRevision = "2";
    if (kind === "forged" || kind === "self_hash_forged") copy.profile = { ...copy.profile, productName: "Forged" };
    if (kind === "self_hash_forged") copy.profileHash = createHash("sha256").update(canonicalProfileJson(copy.profile)).digest("hex");
    expect(await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.saveDraft({ userId: USER_ID, kbId: KB_ID, baseVersion: 0, payload: { ...payload, profileCopy: copy }, expectedProfileReference: reference })).toEqual({ kind: "context_stale" });
    expect(mocks.saveGeoKbDraft).not.toHaveBeenCalled();
  });
  it("requires explicit copy adoption before saving or freezing a legacy draft", async () => {
    const { reference } = source();
    const payload = contextPayload();
    expect(await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.saveDraft({ userId: USER_ID, kbId: KB_ID, baseVersion: 1, payload, expectedProfileReference: reference })).toEqual({ kind: "profile_copy_required" });
    mocks.readGeoKnowledgeBase.mockResolvedValue({ kind: "ok", value: { ...details(null), draft: { payload, draftVersion: 1, contentHash: "d".repeat(64), updatedAt: NOW } } });
    expect(await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.readDraftPayload({ userId: USER_ID, kbId: KB_ID })).toEqual({ kind: "profile_copy_required" });
    expect(mocks.saveGeoKbDraft).not.toHaveBeenCalled();
  });
  it("builds freeze context from the saved full copy without a current Profile read", async () => {
    const { payload } = source();
    mocks.findAccountWebsiteByUrl.mockRejectedValue(new Error("Profile source offline"));
    mocks.readGeoKnowledgeBase.mockResolvedValue({ kind: "ok", value: { ...details(null), draft: { payload, draftVersion: 1, contentHash: "d".repeat(64), updatedAt: NOW } } });
    const result = await DEFAULT_GEO_KB_HANDLER_DEPENDENCIES.readDraftPayload({ userId: USER_ID, kbId: KB_ID });
    expect(result).toMatchObject({ kind: "ok", value: { payload, context: { profile: { reference: { snapshotRevision: 3, profileHash: payload.profileCopy.profileHash } } } } });
    expect(mocks.findAccountWebsiteByUrl).not.toHaveBeenCalled();
  });
});
