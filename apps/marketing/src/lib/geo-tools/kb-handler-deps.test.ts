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
    const reference = {
      schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
      websiteId: "44444444-4444-4444-8444-444444444444",
      snapshotId: "55555555-5555-4555-8555-555555555555",
      snapshotRevision: 3,
      profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      profileHash: "a".repeat(64),
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
        profile: {
          ...emptyMarketingWebsiteProfile(),
          productName: "Example",
          oneLinePositioning: "A confirmed product statement",
          coreFeatures: ["Birth chart calculator", "Journal"],
          country: "US",
          locale: "en",
        },
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
