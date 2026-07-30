import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  extractClientIp: vi.fn(() => "unknown"),
}));

vi.mock("../../../lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

vi.mock("../../../lib/rate-limit", () => ({
  extractClientIp: mocks.extractClientIp,
}));

vi.mock("../../../lib/api-response", () => ({
  apiSuccess: (data: unknown, status = 200) =>
    Response.json({ data }, { status }),
  apiError: (code: string, message: string, status = 400) =>
    Response.json({ error: { code, message } }, { status }),
  safeApiError: (code: string, _message: string, status = 500) =>
    Response.json(
      { error: { code, message: "An internal error occurred" } },
      { status },
    ),
}));

import { POST } from "./route";

const validBody = {
  visitor_id: "test-visitor",
  categories: [{ category: "essential", status: "granted" }],
  policy_version: "test-policy",
  locale: "en",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function configurePersistence() {
  vi.stubEnv("CONSENT_PERSISTENCE_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
}

function request() {
  return new Request("https://gengrowth.ai/api/consent", {
    body: JSON.stringify(validBody),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function requestWithBody(body: unknown) {
  return new Request("https://gengrowth.ai/api/consent", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function mockInsertResult(result: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const select = vi.fn().mockResolvedValue(result);
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  mocks.createServerSupabaseClient.mockResolvedValue({ from });
  return { from, insert, select };
}

describe("POST /api/consent persistence boundary", () => {
  it.each([
    ["a null body", null, "INVALID_BODY"],
    [
      "a malformed category",
      { ...validBody, categories: [null] },
      "INVALID_CATEGORIES",
    ],
  ])("rejects %s without throwing", async (_label, body, code) => {
    const response = await POST(requestWithBody(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({ code }),
    });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("returns an honest local-only 202 when persistence is not configured", async () => {
    vi.stubEnv("CONSENT_PERSISTENCE_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const response = await POST(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      data: {
        recorded: false,
        reason: "persistence_not_configured",
      },
    });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("keeps blog Supabase configuration local-only without explicit consent opt-in", async () => {
    vi.stubEnv("CONSENT_PERSISTENCE_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");

    const response = await POST(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      data: {
        recorded: false,
        reason: "persistence_not_configured",
      },
    });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("returns an honest local-only 202 when the consent table is unavailable", async () => {
    configurePersistence();
    mockInsertResult({
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find the table in the schema cache",
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      data: {
        recorded: false,
        reason: "consent_store_unavailable",
      },
    });
  });

  it("keeps unexpected persistence failures as sanitized 500 responses", async () => {
    configurePersistence();
    mockInsertResult({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table consent_events",
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INSERT_FAILED",
        message: "An internal error occurred",
      },
    });
  });

  it("sanitizes client creation exceptions", async () => {
    configurePersistence();
    mocks.createServerSupabaseClient.mockRejectedValue(
      new Error("malformed Supabase URL secret=do-not-return"),
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INSERT_FAILED",
        message: "An internal error occurred",
      },
    });
  });

  it("sanitizes query exceptions", async () => {
    configurePersistence();
    const select = vi
      .fn()
      .mockRejectedValue(new Error("network secret=do-not-return"));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    mocks.createServerSupabaseClient.mockResolvedValue({ from });

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INSERT_FAILED",
        message: "An internal error occurred",
      },
    });
  });

  it("preserves the successful 201 persistence contract", async () => {
    configurePersistence();
    const persisted = [{ id: "consent-event-id" }];
    const insert = mockInsertResult({ data: persisted, error: null });

    const response = await POST(request());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: persisted });
    expect(insert.from).toHaveBeenCalledWith("consent_events");
    expect(insert.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        visitor_id: "test-visitor",
        category: "essential",
        status: "granted",
        policy_version: "test-policy",
      }),
    ]);
  });
});
