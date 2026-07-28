import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDeliveryConnection: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/services/delivery-connections", () => ({
  getDeliveryConnection: mocks.getDeliveryConnection,
}));

const { GET } = await import("./route.ts");
const projectId = "10000000-0000-4000-8000-000000000003";
const destinationRef = "10000000-0000-4000-8000-000000000004";

beforeEach(() => {
  vi.clearAllMocks();
});

it("reads an exact workspace/project/destination history", async () => {
  mocks.getDeliveryConnection.mockResolvedValue({
    current: { destinationRef },
    revisions: [{ destinationRef }],
    readiness: { state: "ready" },
  });
  const response = await GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/delivery-connections/${destinationRef}`,
    ),
    { params: Promise.resolve({ projectId, destinationRef }) },
  );

  expect(response.status).toBe(200);
  expect(mocks.getDeliveryConnection).toHaveBeenCalledWith(
    { workspaceId: "10000000-0000-4000-8000-000000000002" },
    projectId,
    destinationRef,
  );
});

it("treats a malformed destination ref as not found", async () => {
  const response = await GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/delivery-connections/private-ref`,
    ),
    {
      params: Promise.resolve({
        projectId,
        destinationRef: "private-ref",
      }),
    },
  );

  expect(response.status).toBe(404);
  expect(mocks.getDeliveryConnection).not.toHaveBeenCalled();
});
