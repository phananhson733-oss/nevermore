import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IdempotencyRepository,
  ProjectsRepository,
  type IdempotencyRow,
} from "@sf/db";
import type { CreateCollectionRunRequest } from "@sf/contracts";

const mocks = vi.hoisted(() => ({
  contentHash: vi.fn(),
}));

vi.mock("@sf/db", async () => {
  const actual = await vi.importActual<typeof import("@sf/db")>("@sf/db");
  mocks.contentHash.mockImplementation(actual.contentHash);
  return { ...actual, contentHash: mocks.contentHash };
});
vi.mock("@/lib/db", () => ({ getDb: () => ({ db: {} }) }));
vi.mock("@/lib/boss", () => ({ getBoss: vi.fn() }));
vi.mock("@/env", () => ({
  getEnv: () => ({
    DATAFORSEO_ENABLED: "false",
    DATAFORSEO_MAX_KEYWORDS: 200,
  }),
}));

const {
  createCollectionRun,
  dataForSeoCollectionScopeForSite,
  keywordLibraryContextForSite,
} = await import("../collection.ts");

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const idempotencyKey = "collection-wire-body";

const run = {
  id: runId,
  projectId,
  kind: "collection",
  status: "queued",
  progress: {
    phase: "queued",
    current: 0,
    total: null,
    messageKey: "run.queued",
  },
  lastError: null,
  resultRef: null,
  queuedAt: "2026-07-20T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
};

function completedKey(requestHash: string): IdempotencyRow {
  const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;
  return {
    id: "00000000-0000-4000-8000-000000000005",
    workspace_id: workspaceId,
    scope: "createCollectionRun",
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    status: "completed",
    response_status: 202,
    response_body: {
      run,
      statusUrl,
      resourceRef: { type: "collection_run", id: runId },
    },
    resource_type: "collection_run",
    resource_id: runId,
    expires_at: "2026-07-21T00:00:00.000Z",
  };
}

async function captureRequestHash(
  body: CreateCollectionRunRequest,
): Promise<string> {
  const stopBeforeMutableState = new Error("stop before mutable state");
  const findKey = vi
    .spyOn(IdempotencyRepository.prototype, "find")
    .mockResolvedValueOnce(null);
  const findProject = vi
    .spyOn(ProjectsRepository.prototype, "findById")
    .mockRejectedValueOnce(stopBeforeMutableState);
  mocks.contentHash.mockClear();

  await expect(
    createCollectionRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    ),
  ).rejects.toBe(stopBeforeMutableState);
  expect(mocks.contentHash).toHaveBeenCalledTimes(1);

  const requestHash = mocks.contentHash.mock.results[0]?.value;
  findKey.mockRestore();
  findProject.mockRestore();
  expect(requestHash).toEqual(expect.any(String));
  return requestHash as string;
}

async function replayAgainstCapturedHash(
  originalBody: CreateCollectionRunRequest,
  replayBody: CreateCollectionRunRequest,
) {
  const requestHash = await captureRequestHash(originalBody);
  vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(
    completedKey(requestHash),
  );
  return createCollectionRun(
    { workspaceId },
    projectId,
    actorId,
    idempotencyKey,
    replayBody,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.contentHash.mockClear();
});

describe("createCollectionRun wire-body idempotency", () => {
  it("freezes only a complete canonical Site context for GSC Keyword Library projection", () => {
    expect(
      keywordLibraryContextForSite({
        market_codes: ["us"],
        language_codes: ["en-us"],
      }),
    ).toEqual({
      basis: "project_context",
      marketCode: "US",
      languageTag: "en-US",
    });
    expect(
      keywordLibraryContextForSite({
        market_codes: [],
        language_codes: ["en-US"],
      }),
    ).toBeNull();
    expect(
      keywordLibraryContextForSite({
        market_codes: ["US"],
        language_codes: ["not_a_language"],
      }),
    ).toBeNull();
    expect(
      keywordLibraryContextForSite({
        market_codes: ["US", "GB"],
        language_codes: ["en-US"],
      }),
    ).toBeNull();
    expect(
      keywordLibraryContextForSite({
        market_codes: ["US"],
        language_codes: ["en-US", "en-GB"],
      }),
    ).toBeNull();
    expect(
      keywordLibraryContextForSite({
        market_codes: ["ZZ"],
        language_codes: ["en-US"],
      }),
    ).toBeNull();
  });

  it.each([
    ["primary market", { market_codes: [], language_codes: ["en"] }],
    ["site language", { market_codes: ["US"], language_codes: [] }],
  ] as const)(
    "fails closed when the primary Site is missing its explicit %s scope",
    (missingLabel, scope) => {
      expect(() =>
        dataForSeoCollectionScopeForSite({
          host: "www.example.com",
          ...scope,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "CONTEXT_INCOMPLETE",
          status: 422,
          message: expect.stringContaining(missingLabel),
        }),
      );
    },
  );

  it("keeps an explicitly configured historical US/en Site valid without inventing scope", () => {
    expect(
      dataForSeoCollectionScopeForSite({
        host: "www.example.com",
        market_codes: ["US"],
        language_codes: ["en"],
      }),
    ).toEqual({
      schemaVersion: "dataforseo.collection-scope.v1",
      queryKind: "ranked_keywords",
      target: "example.com",
      marketCode: "US",
      languageTag: "en",
      providerLanguageCode: "en",
      location: { kind: "name", name: "United States" },
      limit: 200,
    });
  });

  it("fails closed before database access when DataForSEO is disabled", async () => {
    await expect(
      createCollectionRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        { provider: "dataforseo" },
      ),
    ).rejects.toMatchObject({ code: "FEATURE_DISABLED", status: 503 });
  });

  it("replays the original response for the exact same body", async () => {
    const body = { provider: "crawl" as const };

    await expect(replayAgainstCapturedHash(body, body)).resolves.toMatchObject({
      status: 202,
      replayed: true,
      run: { id: runId },
    });
  });

  it("rejects the same key when an omitted operation is added explicitly", async () => {
    await expect(
      replayAgainstCapturedHash(
        { provider: "crawl" },
        { provider: "crawl", operation: "site_graph" },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
  });

  it("rejects the same key when an omitted sourceConnectionId becomes null", async () => {
    await expect(
      replayAgainstCapturedHash(
        { provider: "crawl" },
        { provider: "crawl", sourceConnectionId: null },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
  });

  it("treats undefined optional members like omitted JSON members", async () => {
    const withUndefined = {
      provider: "crawl" as const,
      operation: undefined,
      sourceConnectionId: undefined,
    };

    await expect(
      replayAgainstCapturedHash({ provider: "crawl" }, withUndefined),
    ).resolves.toMatchObject({ replayed: true, run: { id: runId } });
  });
});
