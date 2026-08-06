import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectOpportunity: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/opportunities", () => ({
  getProjectOpportunity: mocks.getProjectOpportunity,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const opportunityId = "00000000-0000-4000-8000-000000000007";
const executionPreview = {
  templateId: "create_gap_content.v1",
  templateVersion: 1,
  artifactType: "content_brief",
  effort: "large",
  risk: "low",
  contentLocale: "en",
  title: "Create content for an uncovered keyword cluster",
  description:
    "Create decision-stage content for a high-volume keyword cluster with no matching indexable page.",
  expectedOutcome:
    "The cluster gains a targeted page that captures existing demand.",
} as const;

function invoke(id: string, uiLocaleCookie?: string) {
  const headers = new Headers({ "X-Request-Id": "request-opportunity" });
  if (uiLocaleCookie !== undefined) {
    headers.set("cookie", `sf_ui_locale=${uiLocaleCookie}`);
  }
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/opportunities/${id}`,
      { headers },
    ),
    { params: Promise.resolve({ projectId, opportunityId: id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectOpportunity.mockResolvedValue({
    projectId,
    siteId: "00000000-0000-4000-8000-000000000005",
    diagnosticRunId: "00000000-0000-4000-8000-000000000006",
    data: { readiness: "reviewable", executionPreview },
  });
});

describe("GET project opportunity detail", () => {
  it("passes the validated opportunity id (primary finding) to the service", async () => {
    const response = await invoke(opportunityId);
    expect(response.status).toBe(200);
    expect(mocks.getProjectOpportunity).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "zh-CN" },
      projectId,
      opportunityId,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        data: { readiness: "reviewable", executionPreview },
      },
    });
  });

  it("does not reinterpret Project-delivery preview content from the UI cookie", async () => {
    const response = await invoke(opportunityId, "zh-CN");

    expect(response.status).toBe(200);
    expect(mocks.getProjectOpportunity).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "zh-CN",
      },
      projectId,
      opportunityId,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        data: {
          executionPreview: {
            contentLocale: "en",
            title: "Create content for an uncovered keyword cluster",
          },
        },
      },
    });
  });

  it("rejects a malformed opportunity id without calling the service", async () => {
    const response = await invoke("not-a-uuid");
    expect(response.status).toBe(404);
    expect(mocks.getProjectOpportunity).not.toHaveBeenCalled();
  });
});
