import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditCompetitor: vi.fn(),
  getProjectAuditCompetitorReviewDetail: vi.fn(),
  reviewProjectAuditCompetitor: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-competitors", () => ({
  getProjectAuditCompetitor: mocks.getProjectAuditCompetitor,
  getProjectAuditCompetitorReviewDetail:
    mocks.getProjectAuditCompetitorReviewDetail,
  reviewProjectAuditCompetitor: mocks.reviewProjectAuditCompetitor,
}));

const { GET, PATCH } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const competitorId = "00000000-0000-4000-8000-000000000004";
const diagnosticRunId = "00000000-0000-7000-8000-000000000005";

function invoke(query = "", selectedCompetitorId = competitorId) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/competitors/${selectedCompetitorId}${query}`,
      { headers: { "X-Request-Id": "request-growth-map-competitor" } },
    ),
    {
      params: Promise.resolve({
        projectId,
        competitorId: selectedCompetitorId,
      }),
    },
  );
}

const review = {
  expectedRevision: 2,
  name: "Reviewed Competitor",
  reviewStatus: "approved",
  relationship: "benchmark",
  analysisScope: ["positioning"],
} as const;

function invokePatch(
  body: unknown = review,
  selectedCompetitorId = competitorId,
  query = "",
) {
  return PATCH(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/competitors/${selectedCompetitorId}${query}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "X-Request-Id": "request-review-growth-map-competitor",
        },
        body: JSON.stringify(body),
      },
    ),
    {
      params: Promise.resolve({
        projectId,
        competitorId: selectedCompetitorId,
      }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditCompetitor.mockResolvedValue({
    projectId,
    data: { competitorId },
  });
  mocks.getProjectAuditCompetitorReviewDetail.mockResolvedValue({
    projectId,
    data: { competitorId, name: "Current Review", revision: 4 },
  });
  mocks.reviewProjectAuditCompetitor.mockResolvedValue({
    projectId,
    data: { competitorId, revision: 3 },
  });
});

describe("GET selected Growth Map Competitor", () => {
  it("scopes the exact Competitor lookup to the operator workspace", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditCompetitor).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      competitorId,
      { diagnosticRunId: null },
    );
    await expect(response.json()).resolves.toEqual({
      data: { projectId, data: { competitorId } },
    });
  });

  it("accepts a lowercase UUIDv7 pin for one exact published detail generation", async () => {
    const response = await invoke(`?diagnosticRunId=${diagnosticRunId}`);

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditCompetitor).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      competitorId,
      { diagnosticRunId },
    );
    expect(
      mocks.getProjectAuditCompetitorReviewDetail,
    ).not.toHaveBeenCalled();
  });

  it("reads live current governance only from the explicit review view", async () => {
    const response = await invoke("?view=review");

    expect(response.status).toBe(200);
    expect(
      mocks.getProjectAuditCompetitorReviewDetail,
    ).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      competitorId,
    );
    expect(mocks.getProjectAuditCompetitor).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      data: {
        projectId,
        data: { competitorId, name: "Current Review", revision: 4 },
      },
    });
  });

  it("rejects a diagnostic generation pin in review view instead of mixing frozen facts", async () => {
    const response = await invoke(
      `?view=review&diagnosticRunId=${diagnosticRunId}`,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [
        {
          pointer: "/diagnosticRunId",
          code: "mutually_exclusive_query_parameters",
        },
      ],
    });
    expect(mocks.getProjectAuditCompetitor).not.toHaveBeenCalled();
    expect(
      mocks.getProjectAuditCompetitorReviewDetail,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["view=published", "/view", "invalid_query_value"],
    [
      "diagnosticRunId=customer-private-run",
      "/diagnosticRunId",
      "invalid_query_value",
    ],
    [
      "diagnosticRunId=00000000-0000-9000-8000-000000000005",
      "/diagnosticRunId",
      "invalid_query_value",
    ],
    ["unexpected=true", "/unexpected", "unknown_query_parameter"],
  ])(
    "rejects invalid detail query %s",
    async (query, pointer, code) => {
      const response = await invoke(`?${query}`);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        errors: [{ pointer, code }],
      });
      expect(mocks.getProjectAuditCompetitor).not.toHaveBeenCalled();
      expect(
        mocks.getProjectAuditCompetitorReviewDetail,
      ).not.toHaveBeenCalled();
    },
  );

  it("rejects an uppercase UUIDv7 diagnostic pin as non-canonical", async () => {
    const uppercaseRunId =
      "00000000-0000-7000-8000-00000000000A";
    const response = await invoke(
      `?diagnosticRunId=${uppercaseRunId}`,
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [
        {
          pointer: "/diagnosticRunId",
          code: "invalid_query_value",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(uppercaseRunId);
    expect(mocks.getProjectAuditCompetitor).not.toHaveBeenCalled();
    expect(
      mocks.getProjectAuditCompetitorReviewDetail,
    ).not.toHaveBeenCalled();
  });

  it.each(["view=review&view=review", `diagnosticRunId=${diagnosticRunId}&diagnosticRunId=${diagnosticRunId}`])(
    "rejects duplicate detail query %s",
    async (query) => {
      const response = await invoke(`?${query}`);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        errors: [
          {
            code: "duplicate_query_parameter",
          },
        ],
      });
      expect(mocks.getProjectAuditCompetitor).not.toHaveBeenCalled();
      expect(
        mocks.getProjectAuditCompetitorReviewDetail,
      ).not.toHaveBeenCalled();
    },
  );

  it("rejects a malformed Competitor id as not found before service access", async () => {
    const response = await invoke("", "customer-private-competitor");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(JSON.stringify(body)).not.toContain("customer-private-competitor");
    expect(mocks.getProjectAuditCompetitor).not.toHaveBeenCalled();
    expect(
      mocks.getProjectAuditCompetitorReviewDetail,
    ).not.toHaveBeenCalled();
  });
});

describe("PATCH selected Growth Map Competitor review", () => {
  it("passes only the strict review contract and operator scope to the service", async () => {
    const response = await invokePatch();

    expect(response.status).toBe(200);
    expect(mocks.reviewProjectAuditCompetitor).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      competitorId,
      review,
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        projectId,
        data: { competitorId, revision: 3 },
      },
    });
  });

  it("rejects a published-generation pin on PATCH before reading the mutation body", async () => {
    const response = await invokePatch(
      review,
      competitorId,
      `?diagnosticRunId=${diagnosticRunId}`,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [
        {
          pointer: "/diagnosticRunId",
          code: "unknown_query_parameter",
        },
      ],
    });
    expect(mocks.reviewProjectAuditCompetitor).not.toHaveBeenCalled();
  });

  it("rejects incoherent or widened payloads before service access", async () => {
    const response = await invokePatch({
      ...review,
      relationship: null,
      customerPrivateField: "must-not-pass",
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(JSON.stringify(body)).not.toContain("must-not-pass");
    expect(mocks.reviewProjectAuditCompetitor).not.toHaveBeenCalled();
  });

  it("rejects a malformed Competitor id before body or service access", async () => {
    const response = await invokePatch(review, "customer-private-competitor");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(mocks.reviewProjectAuditCompetitor).not.toHaveBeenCalled();
  });

  it("preserves structured revision conflicts from the service", async () => {
    mocks.reviewProjectAuditCompetitor.mockRejectedValueOnce(
      new ProblemError(
        "STALE_REVISION",
        "Competitor review revision is stale.",
        {
          current: {
            kind: "revision_conflict",
            resource: "competitor_review",
            projectId,
            resourceId: competitorId,
            expectedRevision: 2,
            currentRevision: 4,
          },
        },
      ),
    );

    const response = await invokePatch();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "STALE_REVISION",
      status: 409,
      current: {
        kind: "revision_conflict",
        resource: "competitor_review",
        projectId,
        resourceId: competitorId,
        expectedRevision: 2,
        currentRevision: 4,
      },
    });
  });
});
