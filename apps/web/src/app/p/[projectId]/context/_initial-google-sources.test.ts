import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  getOnboardingGoogleSourceState: vi.fn(),
  shouldUseE2eProjectShell: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.getOperatorContext,
}));
vi.mock("@/lib/services/source-connect", () => ({
  getOnboardingGoogleSourceState: mocks.getOnboardingGoogleSourceState,
}));
vi.mock("../_e2e-shell", () => ({
  shouldUseE2eProjectShell: mocks.shouldUseE2eProjectShell,
}));

const { loadInitialConnectedGoogleProviders } = await import(
  "./_initial-google-sources"
);

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shouldUseE2eProjectShell.mockReturnValue(false);
});

describe("Product Profile connected-source first paint", () => {
  it("preserves the browser-backed database-free E2E harness", async () => {
    mocks.shouldUseE2eProjectShell.mockReturnValue(true);

    await expect(
      loadInitialConnectedGoogleProviders(PROJECT_ID, {}),
    ).resolves.toEqual([]);
    expect(mocks.getOperatorContext).not.toHaveBeenCalled();
    expect(mocks.getOnboardingGoogleSourceState).not.toHaveBeenCalled();
  });

  it("returns the scoped connected Google providers", async () => {
    mocks.getOperatorContext.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      workspaceId: WORKSPACE_ID,
    });
    mocks.getOnboardingGoogleSourceState.mockResolvedValue({
      connectedProviders: ["gsc", "ga4"],
    });

    await expect(
      loadInitialConnectedGoogleProviders(PROJECT_ID, {}),
    ).resolves.toEqual(["gsc", "ga4"]);
    expect(mocks.getOnboardingGoogleSourceState).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID },
      PROJECT_ID,
    );
  });

  it("leaves auth handling to the client page", async () => {
    mocks.getOperatorContext.mockResolvedValue(null);

    await expect(
      loadInitialConnectedGoogleProviders(PROJECT_ID, {}),
    ).resolves.toEqual([]);
    expect(mocks.getOnboardingGoogleSourceState).not.toHaveBeenCalled();
  });
});
