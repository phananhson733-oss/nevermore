import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/projects", () => ({
  createProject: mocks.createProject,
  listProjects: mocks.listProjects,
}));

const { POST } = await import("./route");

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/mvp/projects idempotency wire contract", () => {
  it("preserves a legacy path/query URL for service-level replay", async () => {
    const siteUrl = "https://example.com/customer-path?campaign=legacy";
    mocks.createProject.mockResolvedValueOnce({
      status: 201,
      project: { id: "00000000-0000-4000-8000-000000000003" },
      location: "/p/00000000-0000-4000-8000-000000000003/overview",
      replayed: true,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/mvp/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "legacy-project-create",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          clientName: "Client",
          projectName: "Project",
          siteUrl,
          marketCodes: ["US"],
          siteLanguageCodes: ["en"],
          defaultDeliveryLocale: "en",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createProject).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      "00000000-0000-4000-8000-000000000001",
      "legacy-project-create",
      expect.objectContaining({ siteUrl }),
    );
  });
});
