import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  assertWorkspaceAttemptRateLimit: vi.fn(),
  listProjectAuditKeywordRelations: vi.fn(),
  refreshProjectAuditKeywordRelations: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.getOperatorContext,
}));

vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceAttemptRateLimit:
    mocks.assertWorkspaceAttemptRateLimit,
}));

vi.mock("@/lib/services/growth-map-keyword-relations", () => ({
  listProjectAuditKeywordRelations:
    mocks.listProjectAuditKeywordRelations,
  refreshProjectAuditKeywordRelations:
    mocks.refreshProjectAuditKeywordRelations,
}));

const { GET, POST } = await import("./route");

const ids = {
  actor: "94000000-0000-4000-8000-000000000001",
  workspace: "94000000-0000-4000-8000-000000000002",
  project: "94000000-0000-4000-8000-000000000003",
  keywordA: "94000000-0000-4000-8000-000000000004",
  keywordB: "94000000-0000-4000-8000-000000000005",
} as const;

function getRequest(query = "") {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${ids.project}/audit/keyword-relations${query}`,
    {
      headers: {
        "x-request-id": "request-keyword-relations-list",
      },
    },
  );
}

function postRequest(options?: {
  readonly query?: string;
  readonly body?: unknown;
}) {
  const body =
    options && "body" in options
      ? JSON.stringify(options.body)
      : undefined;
  return new NextRequest(
    `http://localhost/api/mvp/projects/${ids.project}/audit/keyword-relations${options?.query ?? ""}`,
    {
      method: "POST",
      headers: {
        ...(body === undefined
          ? {}
          : { "content-type": "application/json" }),
        origin: "http://localhost",
        "x-request-id": "request-keyword-relations-refresh",
      },
      ...(body === undefined ? {} : { body }),
    },
  );
}

function postRequestWithRuntimeBody(
  chunks: readonly Uint8Array[],
) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk !== undefined) {
        controller.enqueue(chunk);
        return;
      }
      controller.close();
    },
  });
  const init = {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "x-request-id": "request-keyword-relations-runtime-body",
    },
    body,
    duplex: "half",
  } as const;
  return new NextRequest(
    `http://localhost/api/mvp/projects/${ids.project}/audit/keyword-relations`,
    init,
  );
}

function invokeGet(
  request = getRequest(),
  projectId: string = ids.project,
) {
  return GET(request, { params: Promise.resolve({ projectId }) });
}

function invokePost(
  request = postRequest(),
  projectId: string = ids.project,
) {
  return POST(request, { params: Promise.resolve({ projectId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOperatorContext.mockResolvedValue({
    userId: ids.actor,
    workspaceId: ids.workspace,
  });
  mocks.assertWorkspaceAttemptRateLimit.mockResolvedValue(undefined);
  mocks.listProjectAuditKeywordRelations.mockResolvedValue({
    projectId: ids.project,
    data: [],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: {
        availability: "unavailable",
        limitations: ["No relation candidates are available."],
      },
    },
  });
  mocks.refreshProjectAuditKeywordRelations.mockResolvedValue({
    projectId: ids.project,
    eligiblePairCount: 0,
    createdRelationCount: 0,
    createdCandidateCount: 0,
    generatedAt: "2026-07-28T12:00:00.000Z",
  });
});

describe("GET Growth Map Keyword Relations", () => {
  it("passes only the server workspace and bounded repeated keyword IDs", async () => {
    const response = await invokeGet(
      getRequest(
        `?limit=20&keywordId=${ids.keywordA}&keywordId=${ids.keywordB}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(
      mocks.listProjectAuditKeywordRelations,
    ).toHaveBeenCalledWith(
      { workspaceId: ids.workspace },
      ids.project,
      {
        limit: 20,
        cursor: null,
        keywordIds: [ids.keywordA, ids.keywordB],
      },
    );
  });

  it.each([
    ["unknown input", "?actorId=customer-private-actor"],
    ["duplicate scalar", "?limit=10&limit=20"],
    [
      "duplicate Keyword",
      `?keywordId=${ids.keywordA}&keywordId=${ids.keywordA}`,
    ],
    ["malformed Keyword", "?keywordId=customer-private-keyword"],
  ])("rejects %s before service access", async (_label, query) => {
    const response = await invokeGet(getRequest(query));

    expect(response.status).toBe(422);
    expect(
      mocks.listProjectAuditKeywordRelations,
    ).not.toHaveBeenCalled();
  });

  it("bounds one Keyword Library page to 50 unique IDs", async () => {
    const query = Array.from(
      { length: 51 },
      (_, index) =>
        `keywordId=94000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    ).join("&");
    const response = await invokeGet(getRequest(`?${query}`));

    expect(response.status).toBe(422);
    expect(
      mocks.listProjectAuditKeywordRelations,
    ).not.toHaveBeenCalled();
  });

  it("requires an authenticated operator before exposing relation facts", async () => {
    mocks.getOperatorContext.mockResolvedValueOnce(null);

    const response = await invokeGet();

    expect(response.status).toBe(401);
    expect(
      mocks.listProjectAuditKeywordRelations,
    ).not.toHaveBeenCalled();
  });

  it("rejects malformed project identity before service access", async () => {
    const request = new NextRequest(
      "http://localhost/api/mvp/projects/customer-private-project/audit/keyword-relations",
    );
    const response = await invokeGet(
      request,
      "customer-private-project",
    );

    expect(response.status).toBe(404);
    expect(
      mocks.listProjectAuditKeywordRelations,
    ).not.toHaveBeenCalled();
  });
});

describe("POST Growth Map Keyword Relation refresh", () => {
  it("accepts no caller facts and refreshes under the server workspace", async () => {
    const response = await invokePost();

    expect(response.status).toBe(200);
    expect(
      mocks.assertWorkspaceAttemptRateLimit,
    ).toHaveBeenCalledWith(ids.workspace, {
      scope: `keyword-relation-mutation:${ids.project}`,
      maxAttempts: 30,
      windowMs: 60 * 1_000,
    });
    expect(
      mocks.refreshProjectAuditKeywordRelations,
    ).toHaveBeenCalledWith(
      { workspaceId: ids.workspace },
      ids.project,
    );
  });

  it("accepts the zero-byte body stream created by the Next.js Node adapter", async () => {
    const request = postRequestWithRuntimeBody([]);

    expect(request.body).not.toBeNull();
    const response = await invokePost(request);

    expect(response.status).toBe(200);
    expect(
      mocks.refreshProjectAuditKeywordRelations,
    ).toHaveBeenCalledWith(
      { workspaceId: ids.workspace },
      ids.project,
    );
  });

  it("rejects actual streamed bytes before consuming an attempt", async () => {
    const request = postRequestWithRuntimeBody([
      new TextEncoder().encode("{"),
    ]);

    expect(request.headers.get("content-length")).toBeNull();
    expect(request.headers.get("content-type")).toBeNull();
    const response = await invokePost(request);

    expect(response.status).toBe(422);
    expect(
      mocks.assertWorkspaceAttemptRateLimit,
    ).not.toHaveBeenCalled();
    expect(
      mocks.refreshProjectAuditKeywordRelations,
    ).not.toHaveBeenCalled();
  });

  it.each([
    [
      "body facts",
      postRequest({
        body: {
          ruleVersion: "customer-authored",
          generatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ],
    [
      "query facts",
      postRequest({ query: "?actorId=customer-private-actor" }),
    ],
  ])(
    "rejects caller-authored %s without consuming an attempt",
    async (_label, request) => {
      const response = await invokePost(request);

      expect(response.status).toBe(422);
      expect(
        mocks.assertWorkspaceAttemptRateLimit,
      ).not.toHaveBeenCalled();
      expect(
        mocks.refreshProjectAuditKeywordRelations,
      ).not.toHaveBeenCalled();
    },
  );

  it("does not refresh when the workspace mutation budget is exhausted", async () => {
    mocks.assertWorkspaceAttemptRateLimit.mockRejectedValueOnce(
      new ProblemError("RATE_LIMITED", "Too many relation refreshes.", {
        headers: { "Retry-After": "60" },
      }),
    );

    const response = await invokePost();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(
      mocks.refreshProjectAuditKeywordRelations,
    ).not.toHaveBeenCalled();
  });
});
