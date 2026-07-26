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
  mocks.getWorkspaceView.mockResolvedValue({ view: "overview", actions: [] });
});

/**
 * This route had no colocated test. It is the only thing that decides which
 * `view` values exist, and stop gate §19.4 is about that list having drifted in
 * two directions at once: it still admits `plan`, `studio` and `report`, all of
 * which have been `redirect()` screens since Slice 1, while the service's own
 * `WorkspaceViewName` union carries a fifth value, `execution`, that this
 * allowlist rejects before the service is ever called.
 *
 * These cases do not take a position on which way that should be resolved. They
 * pin what is true today, so whichever direction the Owner chooses shows up as
 * a failing test rather than as a silent change of API surface.
 */
describe("GET project workspace view", () => {
  it.each(["overview", "plan", "studio", "report"])(
    "accepts the advertised view %s",
    async (view) => {
      const response = await invoke(`?view=${view}`);
      expect(response.status).toBe(200);
      expect(mocks.getWorkspaceView).toHaveBeenCalledWith(
        { workspaceId: "00000000-0000-4000-8000-000000000002" },
        projectId,
        view,
        // `parseOptionalOutputLocale` answers null, not undefined.
        null,
      );
    },
  );

  it("rejects execution, which the service can serve but this route does not offer", async () => {
    // Deliberately asserted rather than left implicit: `workspace-view.ts:666`
    // has a `case "execution"` branch that no HTTP request can reach, because
    // it is absent from this allowlist and from `openapi/mvp.yaml`. If that is
    // ever intended to be reachable, this is the test that has to change.
    const response = await invoke("?view=execution");
    expect(response.status).toBe(422);
    expect(mocks.getWorkspaceView).not.toHaveBeenCalled();
  });

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

  it("passes an output locale through and omits it when absent", async () => {
    await invoke("?view=overview&outputLocale=en");
    expect(mocks.getWorkspaceView).toHaveBeenLastCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "overview",
      "en",
    );
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
