import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  listProjects: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.getOperatorContext,
}));
vi.mock("@/lib/services/projects", () => ({
  listProjects: mocks.listProjects,
}));

const { default: HomePage } = await import("./page.tsx");

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const REMAINING_PROJECT_ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOperatorContext.mockResolvedValue({
    userId: "00000000-0000-4000-8000-000000000003",
    workspaceId: WORKSPACE_ID,
  });
});

describe("workspace root product selection", () => {
  it("opens a remaining active product after another product is archived", async () => {
    mocks.listProjects.mockResolvedValue({
      data: [{ id: REMAINING_PROJECT_ID }],
      nextCursor: null,
      limit: 1,
    });

    await expect(HomePage()).rejects.toThrow(
      `NEXT_REDIRECT:/p/${REMAINING_PROJECT_ID}/overview`,
    );
    expect(mocks.listProjects).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID },
      { limit: 1, cursor: null, archived: false },
    );
  });

  it("opens product creation only when no active products remain", async () => {
    mocks.listProjects.mockResolvedValue({
      data: [],
      nextCursor: null,
      limit: 1,
    });

    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/new-project");
  });
});
