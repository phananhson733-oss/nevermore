import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceView: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/workspace-view", () => ({
  getWorkspaceView: mocks.getWorkspaceView,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";

function invoke(query = "") {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/workspace${query}`,
      { headers: new Headers({ "X-Request-Id": "request-workspace" }) },
    ),
    { params: Promise.resolve({ projectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWorkspaceView.mockResolvedValue({ view: "overview" });
});

/**
 * Stop gate §19.4, resolved: the workspace aggregate offers exactly the one
 * view a shipped screen consumes. `plan`, `studio` and `report` have been
 * `redirect()` screens since Slice 1, and each restored capability reads its
 * own endpoint (R1 diagnostic-runs, R2 PATCH actions, R3 report/exports);
 * `execution` never had an HTTP consumer. These cases pin that narrowed
 * surface, so widening it again is a deliberate test change, not drift.
 */
describe("GET project workspace view", () => {
  it("accepts overview, the only shipped destination", async () => {
    const response = await invoke("?view=overview");
    expect(response.status).toBe(200);
    expect(mocks.getWorkspaceView).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "overview",
    );
  });

  it.each(["plan", "studio", "report", "execution"])(
    "refuses the retired view %s as a validation error",
    async (view) => {
      // `plan|studio|report` left the enum together with their screens, and the
      // service branch behind `execution` was deleted with them; every one of
      // these now fails validation before any service code runs.
      const response = await invoke(`?view=${view}`);
      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        code: string;
        errors?: readonly { pointer: string; code: string }[];
      };
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.errors?.[0]?.pointer).toBe("/view");
      expect(mocks.getWorkspaceView).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing", ""],
    ["empty", "?view="],
    ["unknown", "?view=invented"],
  ])("refuses a %s view before reaching the service", async (_label, query) => {
    const response = await invoke(query);
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      code: string;
      errors?: readonly { pointer: string; code: string }[];
    };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.errors?.[0]?.pointer).toBe("/view");
    expect(mocks.getWorkspaceView).not.toHaveBeenCalled();
  });

  it("still validates outputLocale but no longer forwards it", async () => {
    // The query param stays in the contract, and a malformed value stays a 422
    // (next case). The Overview projection never localized anything; only the
    // retired `report` view consumed the locale, so nothing forwards it now.
    const response = await invoke("?view=overview&outputLocale=en");
    expect(response.status).toBe(200);
    expect(mocks.getWorkspaceView).toHaveBeenLastCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "overview",
    );
  });

  it("refuses a malformed outputLocale before reaching the service", async () => {
    const response = await invoke("?view=overview&outputLocale=not!!a!!locale");
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      code: string;
      errors?: readonly { pointer: string; code: string }[];
    };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.errors?.[0]?.pointer).toBe("/outputLocale");
    expect(mocks.getWorkspaceView).not.toHaveBeenCalled();
  });

  it("answers a malformed project id as not-found, never as a validation error", async () => {
    // `parseUuidParam` is documented as "an invalid id is treated as not-found
    // (no existence leak)" (`validate.ts:408`). 404 rather than 422 is the
    // point: a validation error would tell an unauthenticated prober that the
    // id shape was wrong but the project might exist.
    const response = await GET(
      new NextRequest("http://localhost/api/mvp/projects/not-a-uuid/workspace?view=overview", {
        headers: new Headers({ "X-Request-Id": "request-workspace" }),
      }),
      { params: Promise.resolve({ projectId: "not-a-uuid" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.getWorkspaceView).not.toHaveBeenCalled();
  });
});
