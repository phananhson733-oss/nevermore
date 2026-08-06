import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditUrl: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map", () => ({
  getProjectAuditUrl: mocks.getProjectAuditUrl,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const sitePageId = "00000000-0000-4000-8000-000000000004";
const diagnosticRunId = "a0000000-0000-7000-8000-000000000006";
const executionPreview = {
  templateId: "fix_http_status.v1",
  templateVersion: 1,
  artifactType: "technical_ticket",
  effort: "medium",
  risk: "medium",
  contentLocale: "en",
  title: "Fix non-200 indexable URLs",
  description: "Repair or redirect indexable URLs that return error statuses.",
  expectedOutcome:
    "Priority URLs return an intentional indexable or redirect status.",
} as const;

function invoke(
  selectedSitePageId = sitePageId,
  uiLocaleCookie?: string,
  query = "",
) {
  const headers = new Headers({
    "X-Request-Id": "request-growth-map-url",
  });
  if (uiLocaleCookie !== undefined) {
    headers.set("cookie", `sf_ui_locale=${uiLocaleCookie}`);
  }
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/urls/${selectedSitePageId}${query}`,
      { headers },
    ),
    { params: Promise.resolve({ projectId, sitePageId: selectedSitePageId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditUrl.mockResolvedValue({
    projectId,
    siteId: "00000000-0000-4000-8000-000000000005",
    diagnosticRunId,
    crawlSnapshotId: "00000000-0000-4000-8000-000000000007",
    data: {
      sitePageId,
      findings: [
        {
          findingId: "00000000-0000-4000-8000-000000000008",
          executionPreview,
          executionRef: null,
        },
      ],
    },
  });
});

describe("GET selected Growth Map URL", () => {
  it("scopes the exact canonical SitePage lookup to the operator workspace", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditUrl).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "zh-CN",
      },
      projectId,
      sitePageId,
      { diagnosticRunId: null },
    );
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({
        projectId,
        data: {
          sitePageId,
          findings: [
            {
              findingId: "00000000-0000-4000-8000-000000000008",
              executionPreview,
              executionRef: null,
            },
          ],
        },
      }),
    });
  });

  it("resolves an explicit sf_ui_locale cookie into the required detail read scope", async () => {
    const response = await invoke(sitePageId, "en");

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditUrl).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "en",
      },
      projectId,
      sitePageId,
      { diagnosticRunId: null },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        data: {
          findings: [
            {
              executionPreview: {
                contentLocale: "en",
                title: "Fix non-200 indexable URLs",
              },
              executionRef: null,
            },
          ],
        },
      },
    });
  });

  it("passes an exact canonical UUIDv7 published-generation pin to the detail service", async () => {
    const response = await invoke(
      sitePageId,
      undefined,
      `?diagnosticRunId=${diagnosticRunId}`,
    );

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditUrl).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "zh-CN",
      },
      projectId,
      sitePageId,
      { diagnosticRunId },
    );
  });

  it("rejects a malformed SitePage id as not found before service access", async () => {
    const response = await invoke("customer-private-url");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(JSON.stringify(body)).not.toContain("customer-private-url");
    expect(mocks.getProjectAuditUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["customer-private-run"],
    [diagnosticRunId.toUpperCase()],
    [""],
  ])(
    "rejects a non-canonical diagnosticRunId %j without calling the service",
    async (value) => {
      const response = await invoke(
        sitePageId,
        undefined,
        `?diagnosticRunId=${encodeURIComponent(value)}`,
      );
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body).toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        errors: [
          {
            pointer: "/diagnosticRunId",
            code: "invalid_query_value",
          },
        ],
      });
      if (value.length > 0) {
        expect(JSON.stringify(body)).not.toContain(value);
      }
      expect(mocks.getProjectAuditUrl).not.toHaveBeenCalled();
    },
  );

  it("rejects duplicate diagnosticRunId pins instead of choosing one generation", async () => {
    const response = await invoke(
      sitePageId,
      undefined,
      `?diagnosticRunId=${diagnosticRunId}&diagnosticRunId=${diagnosticRunId}`,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [
        {
          pointer: "/diagnosticRunId",
          code: "duplicate_query_parameter",
        },
      ],
    });
    expect(mocks.getProjectAuditUrl).not.toHaveBeenCalled();
  });

  it("rejects unknown detail query parameters before service access", async () => {
    const response = await invoke(
      sitePageId,
      undefined,
      `?diagnosticRunId=${diagnosticRunId}&unexpected=customer-private-value`,
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [
        {
          pointer: "/unexpected",
          code: "unknown_query_parameter",
          message: "Unknown query parameter.",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("customer-private-value");
    expect(mocks.getProjectAuditUrl).not.toHaveBeenCalled();
  });
});
