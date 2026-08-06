import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectOpportunities: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/opportunities", () => ({
  DEFAULT_OPPORTUNITY_PAGE_SIZE: 50,
  listProjectOpportunities: mocks.listProjectOpportunities,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const cursor = Buffer.from(
  "2026-07-21T00:00:00.000Z 00000000-0000-4000-8000-000000000004",
).toString("base64url");

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

function invoke(query = "", uiLocaleCookie?: string) {
  const headers = new Headers({ "X-Request-Id": "request-opportunities" });
  if (uiLocaleCookie !== undefined) {
    headers.set("cookie", `sf_ui_locale=${uiLocaleCookie}`);
  }
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/opportunities${query}`,
      { headers },
    ),
    { params: Promise.resolve({ projectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProjectOpportunities.mockResolvedValue({
    projectId,
    siteId: "00000000-0000-4000-8000-000000000005",
    diagnosticRunId: "00000000-0000-4000-8000-000000000006",
    data: [{ readiness: "reviewable", executionPreview }],
    meta: { limit: 50, nextCursor: null, hasNext: false },
  });
});

describe("GET project opportunities", () => {
  it("passes validated bounded list options and workspace scope", async () => {
    const response = await invoke(`?limit=25&cursor=${cursor}`);
    expect(response.status).toBe(200);
    expect(mocks.listProjectOpportunities).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "zh-CN" },
      projectId,
      { limit: 25, cursor },
    );
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({
        projectId,
        data: [{ readiness: "reviewable", executionPreview }],
      }),
    });
  });

  it("keeps Project-delivery English preview copy when the UI locale is Chinese", async () => {
    const response = await invoke("", "zh-CN");

    expect(response.status).toBe(200);
    expect(mocks.listProjectOpportunities).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "zh-CN",
      },
      projectId,
      { limit: 50, cursor: null },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        data: [
          {
            executionPreview: {
              contentLocale: "en",
              title: "Create content for an uncovered keyword cluster",
            },
          },
        ],
      },
    });
  });

  it("uses the documented default when limit is absent", async () => {
    await invoke();
    expect(mocks.listProjectOpportunities).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "zh-CN" },
      projectId,
      { limit: 50, cursor: null },
    );
  });

  it.each([
    ["limit", "0"],
    ["limit", "101"],
    ["cursor", "customer+private+cursor"],
  ])("rejects invalid %s without calling the service", async (name, value) => {
    const response = await invoke(`?${name}=${encodeURIComponent(value)}`);
    expect(response.status).toBe(422);
    expect(mocks.listProjectOpportunities).not.toHaveBeenCalled();
  });
});
