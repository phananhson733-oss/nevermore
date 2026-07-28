import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectDeliveryConnectorReadiness: vi.fn(async () => ({
    github: {
      providerKind: "github",
      state: "unavailable",
      limitation:
        "GitHub App credential issuance is not configured on this server.",
    },
    wordpress: {
      providerKind: "wordpress",
      state: "unavailable",
      limitation:
        "WordPress credential encryption is not configured on this server.",
    },
  })),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/services/delivery-connections", () => ({
  getProjectDeliveryConnectorReadiness:
    mocks.getProjectDeliveryConnectorReadiness,
}));

const { GET } = await import("./route.ts");
const projectId = "10000000-0000-4000-8000-000000000003";

it("returns honest server connector availability without claiming a destination is ready", async () => {
  const response = await GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/delivery-connections/readiness`,
    ),
    { params: Promise.resolve({ projectId }) },
  );

  expect(response.status).toBe(200);
  expect(
    mocks.getProjectDeliveryConnectorReadiness,
  ).toHaveBeenCalledWith(
    { workspaceId: "10000000-0000-4000-8000-000000000002" },
    projectId,
  );
  await expect(response.json()).resolves.toEqual({
    data: {
      github: expect.objectContaining({ state: "unavailable" }),
      wordpress: expect.objectContaining({ state: "unavailable" }),
    },
  });
});
