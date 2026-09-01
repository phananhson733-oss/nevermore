import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emptyGeoKbPayload,
  GEO_KB_SCHEMA_VERSION,
  type GeoKbPayload,
  type GeoKbValue,
} from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { createHash } from "node:crypto";
import { canonicalProfileJson, emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import {
  buildGeoQuestionSet,
  geoQuestionSetDigest,
  type GeoQuestionSet,
} from "./kb-questions.ts";
import type { GeoKbStoreDependencies, GeoKbSnapshotSelector } from "./kb-store.ts";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock("../supabase/admin.ts", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

const {
  DEFAULT_GEO_KB_STORE_DEPENDENCIES,
  GEO_KB_STORE_REASONS,
  ensureGeoKnowledgeBase,
  freezeGeoKb,
  listGeoKnowledgeBases,
  readFrozenGeoKb,
  readGeoKnowledgeBase,
  saveGeoKbDraft,
} = await import("./kb-store.ts");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const KB_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const OTHER_KB_ID = "b4f53f12-8090-4c5f-8ddb-7d9587758d7a";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";
/** The spelling PostgREST returns: an offset and microseconds. */
const PG_NOW = "2026-08-29T08:00:00.123456+00:00";
const ISO_NOW = "2026-08-29T08:00:00.123Z";

function digest(value: unknown): string {
  return geoKbDigest(value as GeoKbValue);
}

/** A payload that clears every freeze blocker. */
function payload(): GeoKbPayload {
  return {
    ...emptyGeoKbPayload("https://example.com/"),
    officialName: "Example",
    aliases: ["Example App"],
    categoryTerms: ["invoice automation"],
    roles: [
      {
        id: "ops",
        label: "operations lead",
        segment: "small teams",
        painPoints: ["chasing unpaid invoices"],
        decisionCriteria: ["setup time"],
        vocabulary: ["invoice"],
      },
    ],
    competitors: [{ domain: "rival.example", brandName: "Rival", confirmed: true }],
    facts: [],
  };
}

const PAYLOAD_HASH = digest(payload());
const QUESTION_SET: GeoQuestionSet = buildGeoQuestionSet(payload());
const QUESTION_SET_HASH = geoQuestionSetDigest(QUESTION_SET);

describe("complete Profile copy integrity", () => {
  const profile = { ...emptyMarketingWebsiteProfile(), productName: "Example", coreFeatures: Array.from({ length: 32 }, (_, i) => `Feature ${String(i)}`) };
  const copy = createGeoProfileCopy({ schemaVersion: "website-profile-reference.v1", websiteId: USER_ID, snapshotId: SNAPSHOT_ID, snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") }, profile);
  it("rejects a self-consistent GEO payload that lies about its copied Profile digest before RPC", async () => {
    const deps = dependencies();
    const bad = { ...payload(), profileCopy: { ...copy, profile: { ...profile, productName: "Forged" } } };
    expect(await saveGeoKbDraft({ userId: USER_ID, kbId: KB_ID, baseVersion: 2, payload: bad }, deps)).toMatchObject({ kind: "invalid", code: "invalid_payload", rejection: "profile_copy" });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });
  it("rejects stored copied Profile corruption even if the outer GEO digest was recomputed", async () => {
    const bad = { ...payload(), profileCopy: { ...copy, profileHash: "b".repeat(64) } };
    const deps = dependencies({ readSnapshot: async () => ({ kind: "ok", data: snapshotRow({ payload: bad, content_hash: digest(bad) }) }) });
    expect((await readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID }, deps)).kind).toBe("unavailable");
  });
  it("round-trips a valid full copy through save and frozen read with no Profile table access", async () => {
    const complete = { ...payload(), profileCopy: copy };
    const deps = dependencies({
      callRpc: async () => ({ kind: "ok", data: [{ outcome: "saved", draft_version: 3, content_hash: digest(complete), updated_at: PG_NOW }] }),
      readSnapshot: async () => ({ kind: "ok", data: snapshotRow({ payload: complete, content_hash: digest(complete) }) }),
    });
    expect((await saveGeoKbDraft({ userId: USER_ID, kbId: KB_ID, baseVersion: 2, payload: complete }, deps)).kind).toBe("ok");
    expect(await readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID }, deps)).toMatchObject({ kind: "ok", value: { payload: complete } });
  });
  it.each(["profile_stale", "profile_copy_mismatch"])("maps the atomic SQL %s fence to a reloadable source conflict", async (outcome) => {
    const deps = dependencies({ callRpc: async () => ({ kind: "ok", data: [{ outcome }] }) });
    expect(await saveGeoKbDraft({ userId: USER_ID, kbId: KB_ID, baseVersion: 2, payload: { ...payload(), profileCopy: copy } }, deps)).toEqual({ kind: "invalid", code: "context_stale" });
  });
});

function kbRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: KB_ID,
    user_id: USER_ID,
    canonical_site_key: "example.com",
    origin: "https://example.com",
    host: "example.com",
    current_frozen_snapshot_id: SNAPSHOT_ID,
    created_at: PG_NOW,
    updated_at: PG_NOW,
    ...overrides,
  };
}

function draftRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kb_id: KB_ID,
    user_id: USER_ID,
    schema_version: GEO_KB_SCHEMA_VERSION,
    draft_version: 2,
    content_hash: PAYLOAD_HASH,
    updated_at: PG_NOW,
    payload: payload(),
    ...overrides,
  };
}

function snapshotRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: SNAPSHOT_ID,
    kb_id: KB_ID,
    user_id: USER_ID,
    revision: 1,
    schema_version: GEO_KB_SCHEMA_VERSION,
    content_hash: PAYLOAD_HASH,
    question_set: QUESTION_SET,
    question_set_hash: QUESTION_SET_HASH,
    frozen_at: PG_NOW,
    payload: payload(),
    ...overrides,
  };
}

function bundle(
  overrides: {
    readonly knowledgeBases?: readonly Record<string, unknown>[];
    readonly drafts?: readonly Record<string, unknown>[];
    readonly snapshots?: readonly Record<string, unknown>[];
  } = {},
): Record<string, unknown> {
  return {
    knowledgeBases: overrides.knowledgeBases ?? [kbRow()],
    drafts: overrides.drafts ?? [draftRow()],
    snapshots: overrides.snapshots ?? [snapshotRow()],
  };
}

function dependencies(
  overrides: Partial<GeoKbStoreDependencies> = {},
): GeoKbStoreDependencies {
  return {
    readList: vi.fn(async () => ({ kind: "ok" as const, data: bundle() })),
    readDetails: vi.fn(async () => ({ kind: "ok" as const, data: bundle() })),
    readSnapshot: vi.fn(async () => ({
      kind: "ok" as const,
      data: snapshotRow(),
    })),
    callRpc: vi.fn(async () => ({
      kind: "ok" as const,
      data: [{ outcome: "saved", draft_version: 3, content_hash: PAYLOAD_HASH, updated_at: PG_NOW }],
    })),
    ...overrides,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("registering a GEO knowledge base", () => {
  it("passes the normalized site to the upsert RPC and reports whether it was created", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ kb_id: KB_ID, created: true }],
      })),
    });

    await expect(
      ensureGeoKnowledgeBase(
        {
          userId: USER_ID,
          origin: "https://example.com",
          host: "example.com",
          canonicalSiteKey: "example.com",
        },
        deps,
      ),
    ).resolves.toEqual({ kind: "ok", value: { kbId: KB_ID, created: true } });

    expect(deps.callRpc).toHaveBeenCalledWith("marketing_geo_upsert_kb", {
      p_user_id: USER_ID,
      p_origin: "https://example.com",
      p_host: "example.com",
      p_canonical_site_key: "example.com",
    });
  });

  it("refuses a site the column constraints would reject, without calling the RPC", async () => {
    const deps = dependencies();

    await expect(
      ensureGeoKnowledgeBase(
        { userId: USER_ID, origin: "", host: "example.com", canonicalSiteKey: "example.com" },
        deps,
      ),
    ).resolves.toEqual({ kind: "invalid", code: "invalid_site" });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });

  it("reports the provider code and nothing else when the upsert fails", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({ kind: "error" as const, code: "PGRST301" })),
    });

    await expect(
      ensureGeoKnowledgeBase(
        {
          userId: USER_ID,
          origin: "https://example.com",
          host: "example.com",
          canonicalSiteKey: "example.com",
        },
        deps,
      ),
    ).resolves.toEqual({ kind: "unavailable", reason: "PGRST301" });
  });

  it("refuses an upsert answer that is not a row set", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: { kb_id: KB_ID, created: true },
      })),
    });

    await expect(
      ensureGeoKnowledgeBase(
        {
          userId: USER_ID,
          origin: "https://example.com",
          host: "example.com",
          canonicalSiteKey: "example.com",
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("refuses an upsert answer that is not a knowledge base identity", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ kb_id: "not-a-uuid", created: true }],
      })),
    });

    await expect(
      ensureGeoKnowledgeBase(
        {
          userId: USER_ID,
          origin: "https://example.com",
          host: "example.com",
          canonicalSiteKey: "example.com",
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });
});

describe("reading GEO knowledge bases", () => {
  it("lists this user's knowledge bases with their draft and frozen versions", async () => {
    const deps = dependencies({
      readList: vi.fn(async () => ({
        kind: "ok" as const,
        // A list read carries no payload column, so the mapping must not need one.
        data: bundle({
          drafts: [{ ...draftRow(), payload: undefined }],
          snapshots: [{ ...snapshotRow(), payload: undefined, question_set: undefined }],
        }),
      })),
    });

    await expect(listGeoKnowledgeBases({ userId: USER_ID }, deps)).resolves.toEqual({
      kind: "ok",
      value: [
        {
          kbId: KB_ID,
          origin: "https://example.com",
          host: "example.com",
          canonicalSiteKey: "example.com",
          createdAt: ISO_NOW,
          updatedAt: ISO_NOW,
          draft: { draftVersion: 2, contentHash: PAYLOAD_HASH, updatedAt: ISO_NOW },
          frozen: {
            snapshotId: SNAPSHOT_ID,
            revision: 1,
            contentHash: PAYLOAD_HASH,
            questionSetHash: QUESTION_SET_HASH,
            frozenAt: ISO_NOW,
          },
        },
      ],
    });
    expect(deps.readList).toHaveBeenCalledWith(USER_ID);
  });

  it("refuses a list that reached another account's row", async () => {
    const deps = dependencies({
      readList: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({ drafts: [draftRow({ user_id: OTHER_USER_ID })] }),
      })),
    });

    await expect(listGeoKnowledgeBases({ userId: USER_ID }, deps)).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("refuses a knowledge base that points at a version the read did not return", async () => {
    const deps = dependencies({
      readList: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({ snapshots: [] }),
      })),
    });

    await expect(listGeoKnowledgeBases({ userId: USER_ID }, deps)).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("refuses a list carrying a version no knowledge base points at", async () => {
    const deps = dependencies({
      readList: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({
          knowledgeBases: [kbRow({ current_frozen_snapshot_id: null })],
          snapshots: [snapshotRow()],
        }),
      })),
    });

    await expect(listGeoKnowledgeBases({ userId: USER_ID }, deps)).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("refuses a detail read carrying more than one knowledge base", async () => {
    const deps = dependencies({
      readDetails: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({
          knowledgeBases: [
            kbRow(),
            kbRow({ id: OTHER_KB_ID, current_frozen_snapshot_id: null }),
          ],
        }),
      })),
    });

    await expect(
      readGeoKnowledgeBase({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("refuses a detail read carrying more than one version", async () => {
    const deps = dependencies({
      readDetails: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({
          snapshots: [
            snapshotRow(),
            snapshotRow({ id: "5f0dcb27-3c2c-4b7e-9a55-9ba5a67f4fd2", revision: 2 }),
          ],
        }),
      })),
    });

    await expect(
      readGeoKnowledgeBase({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("returns the draft payload and the frozen summary the editor renders", async () => {
    const deps = dependencies();

    await expect(
      readGeoKnowledgeBase({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toEqual({
      kind: "ok",
      value: {
        kbId: KB_ID,
        origin: "https://example.com",
        host: "example.com",
        canonicalSiteKey: "example.com",
        createdAt: ISO_NOW,
        updatedAt: ISO_NOW,
        draft: {
          draftVersion: 2,
          contentHash: PAYLOAD_HASH,
          updatedAt: ISO_NOW,
          payload: payload(),
        },
        frozen: {
          snapshotId: SNAPSHOT_ID,
          revision: 1,
          contentHash: PAYLOAD_HASH,
          questionSetHash: QUESTION_SET_HASH,
          frozenAt: ISO_NOW,
          questionCount: QUESTION_SET.questions.length,
        },
      },
    });
    expect(deps.readDetails).toHaveBeenCalledWith(USER_ID, KB_ID);
  });

  it("reports a knowledge base that is not this user's as missing", async () => {
    const deps = dependencies({
      readDetails: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({ knowledgeBases: [], drafts: [], snapshots: [] }),
      })),
    });

    await expect(
      readGeoKnowledgeBase({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toEqual({ kind: "missing" });
  });

  it("returns null draft and null frozen version for a knowledge base with neither", async () => {
    const deps = dependencies({
      readDetails: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({
          knowledgeBases: [kbRow({ current_frozen_snapshot_id: null })],
          drafts: [],
          snapshots: [],
        }),
      })),
    });

    await expect(
      readGeoKnowledgeBase({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toMatchObject({ kind: "ok", value: { draft: null, frozen: null } });
  });

  it("refuses a stored payload the contract rejects", async () => {
    const deps = dependencies({
      readDetails: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({
          drafts: [draftRow({ payload: { ...payload(), categoryTerms: [] } })],
        }),
      })),
    });

    await expect(
      readGeoKnowledgeBase({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedPayload,
    });
  });

  it("refuses a stored payload its own hash no longer describes", async () => {
    const deps = dependencies({
      readDetails: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({
          drafts: [draftRow({ payload: { ...payload(), officialName: "Edited In Transit" } })],
        }),
      })),
    });

    await expect(
      readGeoKnowledgeBase({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedPayload,
    });
  });

  it("refuses a read that answered with a different knowledge base", async () => {
    const deps = dependencies({
      readDetails: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({
          knowledgeBases: [kbRow({ id: OTHER_KB_ID })],
          drafts: [draftRow({ kb_id: OTHER_KB_ID })],
          snapshots: [snapshotRow({ kb_id: OTHER_KB_ID })],
        }),
      })),
    });

    await expect(
      readGeoKnowledgeBase({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("refuses an identifier that is not a knowledge base id without reading", async () => {
    const deps = dependencies();

    await expect(
      readGeoKnowledgeBase({ userId: USER_ID, kbId: "../../etc/passwd" }, deps),
    ).resolves.toEqual({ kind: "invalid", code: "invalid_kb_id" });
    expect(deps.readDetails).not.toHaveBeenCalled();
  });

  it("keeps a thrown transport error out of the result and out of the log", async () => {
    const secret = "postgres://operator:hunter2@db.internal:5432/marketing";
    const deps = dependencies({
      readDetails: vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED ${secret}`);
      }),
    });

    const result = await readGeoKnowledgeBase({ userId: USER_ID, kbId: KB_ID }, deps);

    expect(result).toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.unavailable,
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("hunter2");
  });
});

describe("saving a GEO knowledge base draft", () => {
  it("sends the normalized payload with the digest computed from it", async () => {
    const deps = dependencies();
    const unnormalized = {
      ...payload(),
      officialName: "  Example  ",
      aliases: ["Example App", "Example App"],
    };

    await expect(
      saveGeoKbDraft(
        { userId: USER_ID, kbId: KB_ID, payload: unnormalized, baseVersion: 2 },
        deps,
      ),
    ).resolves.toEqual({
      kind: "ok",
      value: { draftVersion: 3, contentHash: PAYLOAD_HASH, updatedAt: ISO_NOW },
    });

    expect(deps.callRpc).toHaveBeenCalledWith("marketing_geo_save_kb_draft", {
      p_user_id: USER_ID,
      p_kb_id: KB_ID,
      p_schema_version: GEO_KB_SCHEMA_VERSION,
      p_payload: payload(),
      p_content_hash: PAYLOAD_HASH,
      p_base_version: 2,
    });
  });

  it("refuses a saved answer that describes different text", async () => {
    const other = digest({ ...payload(), officialName: "Other" });
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ outcome: "saved", draft_version: 3, content_hash: other, updated_at: PG_NOW }],
      })),
    });

    await expect(
      saveGeoKbDraft(
        { userId: USER_ID, kbId: KB_ID, payload: payload(), baseVersion: 2 },
        deps,
      ),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("reports the version that won when another tab saved first", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ outcome: "conflict", draft_version: 7, content_hash: PAYLOAD_HASH, updated_at: PG_NOW }],
      })),
    });

    await expect(
      saveGeoKbDraft(
        { userId: USER_ID, kbId: KB_ID, payload: payload(), baseVersion: 2 },
        deps,
      ),
    ).resolves.toEqual({ kind: "conflict", currentDraftVersion: 7 });
  });

  it("treats a digest the database disagrees with as an integrity failure", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ outcome: "hash_mismatch", draft_version: null, content_hash: PAYLOAD_HASH, updated_at: null }],
      })),
    });

    await expect(
      saveGeoKbDraft(
        { userId: USER_ID, kbId: KB_ID, payload: payload(), baseVersion: 2 },
        deps,
      ),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.payloadHashRejected,
    });
  });

  it("maps a knowledge base the RPC could not find to missing", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ outcome: "not_found", draft_version: null, content_hash: null, updated_at: null }],
      })),
    });

    await expect(
      saveGeoKbDraft(
        { userId: USER_ID, kbId: KB_ID, payload: payload(), baseVersion: 2 },
        deps,
      ),
    ).resolves.toEqual({ kind: "missing" });
  });

  it("refuses an outcome this version does not know", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ outcome: "partially_saved" }],
      })),
    });

    await expect(
      saveGeoKbDraft(
        { userId: USER_ID, kbId: KB_ID, payload: payload(), baseVersion: 2 },
        deps,
      ),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("names the part of the payload the contract refused, without saving", async () => {
    const deps = dependencies();

    await expect(
      saveGeoKbDraft(
        {
          userId: USER_ID,
          kbId: KB_ID,
          payload: { ...payload(), officialName: "" },
          baseVersion: 2,
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "invalid",
      code: "invalid_payload",
      rejection: "official_name",
    });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });

  it("refuses a base version that is not a version", async () => {
    const deps = dependencies();

    await expect(
      saveGeoKbDraft(
        { userId: USER_ID, kbId: KB_ID, payload: payload(), baseVersion: -1 },
        deps,
      ),
    ).resolves.toEqual({ kind: "invalid", code: "invalid_base_version" });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });

  it("keeps a thrown RPC error out of the result and out of the log", async () => {
    const secret = "SUPABASE_SECRET_KEY=sb_secret_do_not_log";
    const deps = dependencies({
      callRpc: vi.fn(async () => {
        throw new Error(secret);
      }),
    });

    const result = await saveGeoKbDraft(
      { userId: USER_ID, kbId: KB_ID, payload: payload(), baseVersion: 2 },
      deps,
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.unavailable,
    });
    expect(JSON.stringify(result)).not.toContain("sb_secret_do_not_log");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sb_secret_do_not_log");
  });
});

describe("freezing a GEO knowledge base", () => {
  function freezeDependencies(
    overrides: Partial<GeoKbStoreDependencies> = {},
  ): GeoKbStoreDependencies {
    return dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [
          {
            outcome: "frozen",
            snapshot_id: SNAPSHOT_ID,
            revision: 3,
            content_hash: PAYLOAD_HASH,
            frozen_at: PG_NOW,
            reused_existing: false,
          },
        ],
      })),
      ...overrides,
    });
  }

  it("freezes the draft the caller read and records the set derived from it", async () => {
    const deps = freezeDependencies();

    await expect(
      freezeGeoKb(
        { userId: USER_ID, kbId: KB_ID, baseVersion: 2, questionSet: QUESTION_SET },
        deps,
      ),
    ).resolves.toEqual({
      kind: "ok",
      value: {
        snapshotId: SNAPSHOT_ID,
        revision: 3,
        contentHash: PAYLOAD_HASH,
        questionSetHash: QUESTION_SET_HASH,
        frozenAt: ISO_NOW,
        questionCount: QUESTION_SET.questions.length,
        reusedExisting: false,
      },
    });
    expect(deps.callRpc).toHaveBeenCalledWith("marketing_geo_freeze_kb", {
      p_user_id: USER_ID,
      p_kb_id: KB_ID,
      p_schema_version: GEO_KB_SCHEMA_VERSION,
      p_base_version: 2,
      p_question_set: QUESTION_SET,
      p_question_set_hash: QUESTION_SET_HASH,
    });
  });

  it("reports a version that already existed rather than a new one", async () => {
    const deps = freezeDependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [
          {
            outcome: "frozen",
            snapshot_id: SNAPSHOT_ID,
            revision: 1,
            content_hash: PAYLOAD_HASH,
            frozen_at: PG_NOW,
            reused_existing: true,
          },
        ],
      })),
    });

    await expect(
      freezeGeoKb(
        { userId: USER_ID, kbId: KB_ID, baseVersion: 2, questionSet: QUESTION_SET },
        deps,
      ),
    ).resolves.toMatchObject({ kind: "ok", value: { revision: 1, reusedExisting: true } });
  });

  it("refuses a question set that was not derived from the draft being frozen", async () => {
    const deps = freezeDependencies();
    const stale = buildGeoQuestionSet({ ...payload(), officialName: "Older Name" });

    await expect(
      freezeGeoKb(
        { userId: USER_ID, kbId: KB_ID, baseVersion: 2, questionSet: stale },
        deps,
      ),
    ).resolves.toEqual({ kind: "invalid", code: "question_set_stale" });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });

  it("refuses to freeze a draft that still has open preconditions", async () => {
    const incomplete = { ...payload(), aliases: [], competitors: [] };
    const deps = freezeDependencies({
      readDetails: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({
          drafts: [draftRow({ payload: incomplete, content_hash: digest(incomplete) })],
        }),
      })),
    });

    await expect(
      freezeGeoKb(
        {
          userId: USER_ID,
          kbId: KB_ID,
          baseVersion: 2,
          questionSet: buildGeoQuestionSet(incomplete),
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "invalid",
      code: "not_freezable",
      blockers: ["aliases_missing", "no_confirmed_competitor"],
    });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });

  it("refuses to freeze a version the caller did not read", async () => {
    const deps = freezeDependencies();

    await expect(
      freezeGeoKb(
        { userId: USER_ID, kbId: KB_ID, baseVersion: 1, questionSet: QUESTION_SET },
        deps,
      ),
    ).resolves.toEqual({ kind: "conflict", currentDraftVersion: 2 });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });

  it("refuses to freeze a knowledge base with no draft", async () => {
    const deps = freezeDependencies({
      readDetails: vi.fn(async () => ({
        kind: "ok" as const,
        data: bundle({ drafts: [] }),
      })),
    });

    await expect(
      freezeGeoKb(
        { userId: USER_ID, kbId: KB_ID, baseVersion: 2, questionSet: QUESTION_SET },
        deps,
      ),
    ).resolves.toEqual({ kind: "invalid", code: "no_draft" });
  });

  it("maps every freeze outcome the RPC can return", async () => {
    const outcomes = [
      { row: { outcome: "not_found" }, expected: { kind: "missing" } },
      { row: { outcome: "no_draft" }, expected: { kind: "invalid", code: "no_draft" } },
      {
        row: { outcome: "conflict", revision: 5 },
        expected: { kind: "conflict", currentDraftVersion: 5 },
      },
      {
        row: { outcome: "hash_mismatch", content_hash: PAYLOAD_HASH },
        expected: {
          kind: "unavailable",
          reason: GEO_KB_STORE_REASONS.questionSetHashRejected,
        },
      },
    ] as const;

    for (const outcome of outcomes) {
      const deps = freezeDependencies({
        callRpc: vi.fn(async () => ({ kind: "ok" as const, data: [outcome.row] })),
      });
      await expect(
        freezeGeoKb(
          { userId: USER_ID, kbId: KB_ID, baseVersion: 2, questionSet: QUESTION_SET },
          deps,
        ),
      ).resolves.toEqual(outcome.expected);
    }
  });

  it("refuses a base version that no draft can have", async () => {
    const deps = freezeDependencies();

    await expect(
      freezeGeoKb(
        { userId: USER_ID, kbId: KB_ID, baseVersion: 0, questionSet: QUESTION_SET },
        deps,
      ),
    ).resolves.toEqual({ kind: "invalid", code: "invalid_base_version" });
    expect(deps.readDetails).not.toHaveBeenCalled();
  });
});

describe("reading a frozen GEO knowledge base", () => {
  it("reads a legacy mixed-language snapshot verbatim after the generation-policy change", async () => {
    const legacyPayload = {
      ...payload(),
      categoryTerms: ["占星工具", "心理占星", "自我探索", "CBT 日记", "知识库", "合盘分析"],
    };
    const legacySet: GeoQuestionSet = {
      schemaVersion: "marketing-geo-question-set.v1",
      registryVersion: "2026-08-17/13",
      language: "en",
      country: "US",
      questions: [{
        id: "q01-retrieval.category_top",
        text: "What are the top 占星工具 tools right now?",
        layer: "discovery",
        mode: "retrieval",
        roleId: null,
        requiredEntities: legacyPayload.categoryTerms,
        templateId: "geo.retrieval.category_top",
        calibrated: true,
      }],
    };
    const contentHash = digest(legacyPayload);
    const questionSetHash = geoQuestionSetDigest(legacySet);
    const deps = dependencies({
      readSnapshot: vi.fn(async () => ({ kind: "ok" as const, data: snapshotRow({
        payload: legacyPayload, content_hash: contentHash,
        question_set: legacySet, question_set_hash: questionSetHash,
      }) })),
    });

    await expect(readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID, revision: 1 }, deps)).resolves.toEqual({
      kind: "ok",
      value: { kbId: KB_ID, snapshotId: SNAPSHOT_ID, revision: 1, frozenAt: ISO_NOW,
        payload: legacyPayload, contentHash, questionSet: legacySet, questionSetHash, questionCount: 1 },
    });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });

  it("resolves an archived snapshot id exactly, without using the current pointer", async () => {
    const deps = dependencies();
    expect((await readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID, snapshotId: SNAPSHOT_ID }, deps)).kind).toBe("ok");
    expect(deps.readSnapshot).toHaveBeenCalledWith(USER_ID, KB_ID, { by: "snapshotId", snapshotId: SNAPSHOT_ID });
    expect((await readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID, snapshotId: OTHER_KB_ID }, deps)).kind).toBe("unavailable");
  });

  it("returns the frozen payload and the question set that was frozen with it", async () => {
    const deps = dependencies();

    await expect(
      readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID, revision: 1 }, deps),
    ).resolves.toEqual({
      kind: "ok",
      value: {
        kbId: KB_ID,
        snapshotId: SNAPSHOT_ID,
        revision: 1,
        contentHash: PAYLOAD_HASH,
        questionSetHash: QUESTION_SET_HASH,
        frozenAt: ISO_NOW,
        questionCount: QUESTION_SET.questions.length,
        payload: payload(),
        questionSet: QUESTION_SET,
      },
    });
    expect(deps.readSnapshot).toHaveBeenCalledWith(USER_ID, KB_ID, {
      by: "revision",
      revision: 1,
    } satisfies GeoKbSnapshotSelector);
  });

  it("reads the version the knowledge base points at when no revision is asked for", async () => {
    const deps = dependencies();

    await expect(
      readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toMatchObject({ kind: "ok" });
    expect(deps.readSnapshot).toHaveBeenCalledWith(USER_ID, KB_ID, {
      by: "current",
    } satisfies GeoKbSnapshotSelector);
  });

  it("reports a knowledge base with no frozen version as missing", async () => {
    const deps = dependencies({
      readSnapshot: vi.fn(async () => ({ kind: "ok" as const, data: null })),
    });

    await expect(
      readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID }, deps),
    ).resolves.toEqual({ kind: "missing" });
  });

  it("refuses a frozen question set its own hash no longer describes", async () => {
    const deps = dependencies({
      readSnapshot: vi.fn(async () => ({
        kind: "ok" as const,
        data: snapshotRow({
          question_set: {
            ...QUESTION_SET,
            questions: QUESTION_SET.questions.slice(1),
          },
        }),
      })),
    });

    await expect(
      readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID, revision: 1 }, deps),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedQuestionSet,
    });
  });

  it("refuses a frozen question set written in a shape this version cannot read", async () => {
    const deps = dependencies({
      readSnapshot: vi.fn(async () => ({
        kind: "ok" as const,
        data: snapshotRow({
          question_set: { ...QUESTION_SET, schemaVersion: "marketing-geo-question-set.v2" },
        }),
      })),
    });

    await expect(
      readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID, revision: 1 }, deps),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedQuestionSet,
    });
  });

  it("refuses a snapshot that belongs to another knowledge base", async () => {
    const deps = dependencies({
      readSnapshot: vi.fn(async () => ({
        kind: "ok" as const,
        data: snapshotRow({ kb_id: OTHER_KB_ID }),
      })),
    });

    await expect(
      readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID, revision: 1 }, deps),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: GEO_KB_STORE_REASONS.malformedResponse,
    });
  });

  it("refuses a revision that is not a revision without reading", async () => {
    const deps = dependencies();

    await expect(
      readFrozenGeoKb({ userId: USER_ID, kbId: KB_ID, revision: 0 }, deps),
    ).resolves.toEqual({ kind: "invalid", code: "invalid_revision" });
    expect(deps.readSnapshot).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* The default adapter, driven by a fake Supabase client               */
/* ------------------------------------------------------------------ */

interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly code: string } | null;
}

interface FakeBuilder extends Promise<QueryResult> {
  readonly select: ReturnType<typeof vi.fn>;
  readonly eq: ReturnType<typeof vi.fn>;
  readonly in: ReturnType<typeof vi.fn>;
  readonly order: ReturnType<typeof vi.fn>;
  readonly maybeSingle: ReturnType<typeof vi.fn>;
}

function query(
  data: unknown,
  error: { readonly code: string } | null = null,
): FakeBuilder {
  const result: QueryResult = { data, error };
  const builder = Promise.resolve(result) as FakeBuilder;
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  });
  return builder;
}

/** The columns one query asked for, as a list. */
function selectedColumns(builder: FakeBuilder): readonly string[] {
  const call = builder.select.mock.calls[0];
  if (call === undefined || typeof call[0] !== "string") {
    throw new Error("select was never called with a column list");
  }
  return call[0].split(",");
}

function clientFor(tables: Readonly<Record<string, FakeBuilder>>): unknown {
  return { from: vi.fn((table: string) => tables[table]), rpc: vi.fn() };
}

describe("the default GEO knowledge base Supabase adapter", () => {
  it("scopes every list query to the user and reads no payload column", async () => {
    const knowledgeBases = query([kbRow()]);
    const drafts = query([]);
    const snapshots = query([]);
    mocks.createAdminSupabaseClient.mockReturnValue(
      clientFor({
        marketing_geo_knowledge_bases: knowledgeBases,
        marketing_geo_kb_drafts: drafts,
        marketing_geo_kb_snapshots: snapshots,
      }),
    );

    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.readList(USER_ID),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(knowledgeBases.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(drafts.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(drafts.in).toHaveBeenCalledWith("kb_id", [KB_ID]);
    expect(snapshots.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(snapshots.in).toHaveBeenCalledWith("id", [SNAPSHOT_ID]);
    // Split rather than searched: `question_set_hash` contains the name of the
    // column a list must not read, so a substring check would pass either way.
    expect(selectedColumns(drafts)).not.toContain("payload");
    expect(selectedColumns(snapshots)).not.toContain("payload");
    expect(selectedColumns(snapshots)).not.toContain("question_set");
    expect(selectedColumns(snapshots)).toContain("question_set_hash");
  });

  it("scopes knowledge base, draft, and current version detail reads", async () => {
    const knowledgeBases = query(kbRow());
    const drafts = query(draftRow());
    const snapshots = query(snapshotRow());
    mocks.createAdminSupabaseClient.mockReturnValue(
      clientFor({
        marketing_geo_knowledge_bases: knowledgeBases,
        marketing_geo_kb_drafts: drafts,
        marketing_geo_kb_snapshots: snapshots,
      }),
    );

    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.readDetails(USER_ID, KB_ID),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(knowledgeBases.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(knowledgeBases.eq).toHaveBeenCalledWith("id", KB_ID);
    expect(drafts.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(drafts.eq).toHaveBeenCalledWith("kb_id", KB_ID);
    expect(snapshots.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(snapshots.eq).toHaveBeenCalledWith("kb_id", KB_ID);
    expect(snapshots.eq).toHaveBeenCalledWith("id", SNAPSHOT_ID);
  });

  it("scopes a read of one revision to the user and the knowledge base", async () => {
    const snapshots = query(snapshotRow({ revision: 2 }));
    mocks.createAdminSupabaseClient.mockReturnValue(
      clientFor({ marketing_geo_kb_snapshots: snapshots }),
    );

    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.readSnapshot(USER_ID, KB_ID, {
        by: "revision",
        revision: 2,
      }),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(snapshots.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(snapshots.eq).toHaveBeenCalledWith("kb_id", KB_ID);
    expect(snapshots.eq).toHaveBeenCalledWith("revision", 2);
  });

  it("resolves the current version through the pointer rather than the highest revision", async () => {
    const knowledgeBases = query(kbRow());
    const snapshots = query(snapshotRow());
    mocks.createAdminSupabaseClient.mockReturnValue(
      clientFor({
        marketing_geo_knowledge_bases: knowledgeBases,
        marketing_geo_kb_snapshots: snapshots,
      }),
    );

    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.readSnapshot(USER_ID, KB_ID, { by: "current" }),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(knowledgeBases.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(knowledgeBases.eq).toHaveBeenCalledWith("id", KB_ID);
    expect(snapshots.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(snapshots.eq).toHaveBeenCalledWith("kb_id", KB_ID);
    expect(snapshots.eq).toHaveBeenCalledWith("id", SNAPSHOT_ID);
    expect(snapshots.eq).not.toHaveBeenCalledWith("revision", expect.anything());
  });

  it("answers with no row when a knowledge base has never been frozen", async () => {
    const knowledgeBases = query(kbRow({ current_frozen_snapshot_id: null }));
    const snapshots = query(snapshotRow());
    mocks.createAdminSupabaseClient.mockReturnValue(
      clientFor({
        marketing_geo_knowledge_bases: knowledgeBases,
        marketing_geo_kb_snapshots: snapshots,
      }),
    );

    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.readSnapshot(USER_ID, KB_ID, { by: "current" }),
    ).resolves.toEqual({ kind: "ok", data: null });
    expect(snapshots.eq).not.toHaveBeenCalled();
  });

  it("carries the provider code and never its message", async () => {
    const knowledgeBases = query(null, { code: "42501" });
    mocks.createAdminSupabaseClient.mockReturnValue(
      clientFor({ marketing_geo_knowledge_bases: knowledgeBases }),
    );

    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.readList(USER_ID),
    ).resolves.toEqual({ kind: "error", code: "42501" });
  });

  it("hands RPC parameters to Supabase unchanged", async () => {
    const rpc = vi.fn(async () => ({ data: [{ kb_id: KB_ID, created: false }], error: null }));
    mocks.createAdminSupabaseClient.mockReturnValue({ from: vi.fn(), rpc });

    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.callRpc("marketing_geo_upsert_kb", {
        p_user_id: USER_ID,
      }),
    ).resolves.toEqual({ kind: "ok", data: [{ kb_id: KB_ID, created: false }] });
    expect(rpc).toHaveBeenCalledWith("marketing_geo_upsert_kb", { p_user_id: USER_ID });
  });

  it("reports a client that cannot be created as an error rather than throwing", async () => {
    mocks.createAdminSupabaseClient.mockImplementation(() => {
      throw new Error("Missing Supabase admin credentials");
    });

    await expect(DEFAULT_GEO_KB_STORE_DEPENDENCIES.readList(USER_ID)).resolves.toEqual({
      kind: "error",
      code: null,
    });
    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.readDetails(USER_ID, KB_ID),
    ).resolves.toEqual({ kind: "error", code: null });
    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.readSnapshot(USER_ID, KB_ID, { by: "current" }),
    ).resolves.toEqual({ kind: "error", code: null });
    await expect(
      DEFAULT_GEO_KB_STORE_DEPENDENCIES.callRpc("marketing_geo_upsert_kb", {}),
    ).resolves.toEqual({ kind: "error", code: null });
  });
});
