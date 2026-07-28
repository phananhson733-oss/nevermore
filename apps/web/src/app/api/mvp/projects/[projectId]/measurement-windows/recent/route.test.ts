import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectRecentMeasurementWindows: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "94000000-0000-4000-8000-000000000001",
    workspaceId: "94000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/measurement", () => ({
  DEFAULT_MEASUREMENT_WINDOW_RECENT_LIMIT: 50,
  listProjectRecentMeasurementWindows:
    mocks.listProjectRecentMeasurementWindows,
}));

const { GET } = await import("./route");

const projectId = "94000000-0000-4000-8000-000000000003";
const generatedAt = "2026-07-28T08:09:10.123Z";

function invoke(search = "", selectedProjectId = projectId) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/measurement-windows/recent${search}`,
      { headers: { "X-Request-Id": "request-recent-measurements" } },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProjectRecentMeasurementWindows.mockResolvedValue({
    projectId,
    windows: [],
    generatedAt,
  });
});

describe("GET recent project Measurement Windows", () => {
  it("passes the validated limit and authenticated workspace scope", async () => {
    const response = await invoke("?limit=25");

    expect(response.status).toBe(200);
    expect(
      mocks.listProjectRecentMeasurementWindows,
    ).toHaveBeenCalledWith(
      { workspaceId: "94000000-0000-4000-8000-000000000002" },
      projectId,
      { limit: 25 },
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        projectId,
        windows: [],
        generatedAt,
      },
    });
  });

  it("uses the bounded default only when limit is absent", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(
      mocks.listProjectRecentMeasurementWindows,
    ).toHaveBeenCalledWith(
      { workspaceId: "94000000-0000-4000-8000-000000000002" },
      projectId,
      { limit: 50 },
    );
  });

  it.each(["0", "101", "1.5", "01", "not-a-number"])(
    "rejects invalid limit %s without service access",
    async (limit) => {
      const response = await invoke(`?limit=${limit}`);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        errors: [{ pointer: "/limit" }],
      });
      expect(
        mocks.listProjectRecentMeasurementWindows,
      ).not.toHaveBeenCalled();
    },
  );

  it("rejects a duplicate limit rather than choosing one value", async () => {
    const response = await invoke("?limit=25&limit=50");

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      errors: [
        {
          pointer: "/limit",
          code: "duplicate_query_parameter",
        },
      ],
    });
    expect(
      mocks.listProjectRecentMeasurementWindows,
    ).not.toHaveBeenCalled();
  });

  it("rejects target filters because this is an all-target project feed", async () => {
    const response = await invoke("?targetRef=site-page%3A%2F%2Fprivate");

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      errors: [
        {
          pointer: "/targetRef",
          code: "unknown_query_parameter",
        },
      ],
    });
    expect(
      mocks.listProjectRecentMeasurementWindows,
    ).not.toHaveBeenCalled();
  });

  it("treats a malformed project id as not found before service access", async () => {
    const response = await invoke("", "customer-private-project");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(
      mocks.listProjectRecentMeasurementWindows,
    ).not.toHaveBeenCalled();
  });
});
