import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProblemError } from "@sf/observability";
import type { IcpProfile } from "@/lib/api/types";

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  getContext: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  shouldUseE2eProjectShell: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.getOperatorContext,
}));
vi.mock("@/lib/services/context", () => ({ getContext: mocks.getContext }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("../_e2e-shell", () => ({
  shouldUseE2eProjectShell: mocks.shouldUseE2eProjectShell,
}));

const { loadInitialContext } = await import("./_initial-context");

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const PROFILE: IcpProfile = {
  id: "00000000-0000-4000-8000-000000000501",
  projectId: PROJECT_ID,
  version: 3,
  status: "draft",
  profile: { productName: "Server-rendered product" },
  contentHash: "sha256:server-context",
  createdAt: "2026-07-20T00:00:00.000Z",
};

beforeEach(() => {
  mocks.getOperatorContext.mockReset();
  mocks.getContext.mockReset();
  mocks.notFound.mockClear();
  mocks.shouldUseE2eProjectShell.mockReset();
  mocks.shouldUseE2eProjectShell.mockReturnValue(false);
});

describe("Context page first paint", () => {
  it("loads the scoped canonical profile for the server render", async () => {
    mocks.getOperatorContext.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
    });
    mocks.getContext.mockResolvedValue(PROFILE);

    await expect(loadInitialContext(PROJECT_ID)).resolves.toBe(PROFILE);
    expect(mocks.getContext).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      PROJECT_ID,
    );
  });

  it("preserves the browser-backed database-free E2E harness", async () => {
    mocks.shouldUseE2eProjectShell.mockReturnValue(true);

    await expect(loadInitialContext(PROJECT_ID)).resolves.toBeUndefined();
    expect(mocks.getOperatorContext).not.toHaveBeenCalled();
    expect(mocks.getContext).not.toHaveBeenCalled();
  });

  it("maps a missing scoped project to the shared 404 boundary", async () => {
    mocks.getOperatorContext.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
    });
    mocks.getContext.mockRejectedValue(
      new ProblemError("NOT_FOUND", "Project not found."),
    );

    await expect(loadInitialContext(PROJECT_ID)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });
});
