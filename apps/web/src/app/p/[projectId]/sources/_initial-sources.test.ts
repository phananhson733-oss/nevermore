import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  operator: vi.fn(),
  gate: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((location: string): never => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  }),
  shouldUseE2eProjectShell: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.operator,
}));

vi.mock("@/lib/services/source-connect", () => ({
  getSourceConnectionGate: mocks.gate,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

vi.mock("../_e2e-shell", () => ({
  shouldUseE2eProjectShell: mocks.shouldUseE2eProjectShell,
}));

const { ensureSourcesPageAccess } = await import("./_initial-sources");

const projectId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const env = {} as Readonly<Record<string, string | undefined>>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shouldUseE2eProjectShell.mockReturnValue(false);
  mocks.operator.mockResolvedValue({
    userId: "00000000-0000-4000-8000-000000000003",
    workspaceId,
  });
});

describe("Sources page Product Profile gate", () => {
  it("safely returns an unconfirmed project to the Product/ICP screen", async () => {
    mocks.gate.mockResolvedValue("product_profile_required");

    await expect(
      ensureSourcesPageAccess(projectId, env),
    ).rejects.toThrow(`NEXT_REDIRECT:/p/${projectId}/context`);

    expect(mocks.gate).toHaveBeenCalledWith({ workspaceId }, projectId);
    expect(mocks.redirect).toHaveBeenCalledWith(`/p/${projectId}/context`);
  });

  it("preserves the Sources screen after confirmation", async () => {
    mocks.gate.mockResolvedValue("allowed");

    await expect(
      ensureSourcesPageAccess(projectId, env),
    ).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps missing or foreign projects behind the existing 404 boundary", async () => {
    mocks.gate.mockResolvedValue("not_found");

    await expect(
      ensureSourcesPageAccess(projectId, env),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("keeps an unauthenticated request behind the existing 404 boundary", async () => {
    mocks.operator.mockResolvedValue(null);

    await expect(
      ensureSourcesPageAccess(projectId, env),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.gate).not.toHaveBeenCalled();
  });

  it("preserves the exact loopback-only database-free browser harness", async () => {
    mocks.shouldUseE2eProjectShell.mockReturnValue(true);

    await expect(
      ensureSourcesPageAccess(projectId, env),
    ).resolves.toBeUndefined();
    expect(mocks.operator).not.toHaveBeenCalled();
    expect(mocks.gate).not.toHaveBeenCalled();
  });
});
