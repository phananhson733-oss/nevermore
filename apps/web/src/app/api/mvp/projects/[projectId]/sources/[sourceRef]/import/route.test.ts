import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MULTIPART_BODY_OVERHEAD_BYTES } from "@/lib/http/validate";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

const mocks = vi.hoisted(() => ({
  assertWorkspaceAttemptRateLimit: vi.fn(),
  assertWorkspaceRateLimit: vi.fn(),
  confirmImport: vi.fn(),
  previewImport: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceAttemptRateLimit: mocks.assertWorkspaceAttemptRateLimit,
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));

vi.mock("@/lib/services/csv-import", () => ({
  MAX_IMPORT_BYTES,
  confirmImport: mocks.confirmImport,
  previewImport: mocks.previewImport,
}));

const { POST } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const endpoint = `http://localhost/api/mvp/projects/${projectId}/sources/csv/import`;
const routeContext = {
  params: Promise.resolve({ projectId, sourceRef: "csv" }),
};

beforeEach(() => {
  mocks.assertWorkspaceAttemptRateLimit.mockReset().mockResolvedValue(undefined);
  mocks.assertWorkspaceRateLimit.mockReset().mockResolvedValue(undefined);
  mocks.confirmImport.mockReset();
  mocks.previewImport.mockReset();
});

describe("POST CSV import multipart body cap", () => {
  it("returns 429 without pulling or parsing the request body when the workspace is already limited", async () => {
    mocks.assertWorkspaceAttemptRateLimit.mockRejectedValueOnce(
      new ProblemError("RATE_LIMITED", "Too many CSV preview attempts.", {
        headers: { "Retry-After": "60" },
      }),
    );
    const formData = vi.fn(async () => {
      const form = new FormData();
      form.set("file", new File(["keyword,volume\nshoes,12\n"], "keywords.csv"));
      return form;
    });
    const getReader = vi.fn(() => {
      throw new Error("body stream must stay untouched");
    });
    const request = {
      url: endpoint,
      method: "POST",
      headers: new Headers({
        "content-type": "multipart/form-data; boundary=csv-rate-test",
        origin: "http://localhost",
        "x-request-id": "request-csv-rate-cap",
      }),
      body: { getReader },
      formData,
    } as unknown as NextRequest;

    const response = await POST(request, routeContext);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(getReader).not.toHaveBeenCalled();
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.previewImport).not.toHaveBeenCalled();
  });

  it("counts the attempt then rejects a decoded stream over the cap despite a tiny Content-Length before service work", async () => {
    const maxBodyBytes = MAX_IMPORT_BYTES + MAX_MULTIPART_BODY_OVERHEAD_BYTES;
    const read = vi
      .fn<() => Promise<ReadableStreamReadResult<Uint8Array>>>()
      .mockResolvedValueOnce({
        done: false,
        value: new Uint8Array(maxBodyBytes + 1),
      })
      .mockRejectedValueOnce(new Error("must stop after the cap is crossed"));
    const cancel = vi.fn(async () => undefined);
    const request = {
      url: endpoint,
      method: "POST",
      headers: new Headers({
        "content-type": "multipart/form-data; boundary=csv-cap-test",
        "content-length": "1",
        origin: "http://localhost",
        "x-request-id": "request-csv-body-cap",
      }),
      body: {
        getReader: () => ({ read, cancel, releaseLock: vi.fn() }),
      },
    } as unknown as NextRequest;

    const response = await POST(request, routeContext);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "IMPORT_TOO_LARGE",
      status: 413,
      requestId: "request-csv-body-cap",
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mocks.assertWorkspaceAttemptRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.previewImport).not.toHaveBeenCalled();
    expect(mocks.confirmImport).not.toHaveBeenCalled();
  });

  it("keeps the actual CSV File.size limit at 20MB after attempt admission and before service work", async () => {
    const form = new FormData();
    form.set("templateId", "keyword_gap_v1");
    form.set(
      "file",
      new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "too-large.csv", {
        type: "text/csv",
      }),
    );
    const request = new NextRequest(endpoint, {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "x-request-id": "request-csv-file-cap",
      },
      body: form,
    });

    const response = await POST(request, routeContext);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "IMPORT_TOO_LARGE",
      status: 413,
      requestId: "request-csv-file-cap",
    });
    expect(mocks.assertWorkspaceAttemptRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.previewImport).not.toHaveBeenCalled();
  });

  it("parses a bounded multipart body and passes only the CSV bytes to preview", async () => {
    mocks.previewImport.mockResolvedValueOnce({
      importToken: "preview-token",
      expiresAt: "2026-07-19T01:00:00.000Z",
      rowCount: 1,
      previewRows: [{ keyword: "shoes", volume: "12" }],
      detectedColumns: ["keyword", "volume"],
      suggestedMapping: { keyword: "keyword", searchVolume: "volume" },
      errors: [],
      warnings: [],
    });
    const csv = "keyword,volume\nshoes,12\n";
    const form = new FormData();
    form.set("templateId", "keyword_gap_v1");
    form.set("file", new File([csv], "keywords.csv", { type: "text/csv" }));
    const request = new NextRequest(endpoint, {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: form,
    });

    const response = await POST(request, routeContext);

    expect(response.status).toBe(200);
    expect(mocks.assertWorkspaceAttemptRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.previewImport).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "00000000-0000-4000-8000-000000000001",
      {
        bytes: expect.any(Buffer),
        templateId: "keyword_gap_v1",
      },
    );
    const call = mocks.previewImport.mock.calls[0]?.[3] as { bytes: Buffer };
    expect(call.bytes.toString("utf8")).toBe(csv);
  });

  it("routes a mixed-case multipart media type through the bounded preview path", async () => {
    mocks.previewImport.mockResolvedValueOnce({
      importToken: "preview-token",
      expiresAt: "2026-07-19T01:00:00.000Z",
      rowCount: 1,
      previewRows: [],
      detectedColumns: ["keyword"],
      suggestedMapping: { keyword: "keyword" },
      errors: [],
      warnings: [],
    });
    const form = new FormData();
    form.set("file", new File(["keyword\nshoes\n"], "keywords.csv"));
    const request = new NextRequest(endpoint, {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: form,
    });
    const contentType = request.headers.get("content-type");
    request.headers.set(
      "content-type",
      contentType?.replace("multipart/form-data", "Multipart/Form-Data") ?? "",
    );

    const response = await POST(request, routeContext);

    expect(response.status).toBe(200);
    expect(mocks.assertWorkspaceAttemptRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.previewImport).toHaveBeenCalledTimes(1);
  });
});
