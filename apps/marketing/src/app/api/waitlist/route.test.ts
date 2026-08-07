import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  checkRateLimit: vi.fn(),
  extractClientIp: vi.fn(() => "203.0.113.7"),
}));

vi.mock("../../../lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

vi.mock("../../../lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
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

import { PATCH, POST } from "./route";

afterEach(() => {
  vi.clearAllMocks();
});

function allowRateLimit() {
  mocks.checkRateLimit.mockReturnValue({
    allowed: true,
    remaining: 4,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 0,
  });
}

function postRequest(body: unknown) {
  return new Request("https://gengrowth.ai/api/waitlist", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function patchRequest(body: unknown) {
  return new Request("https://gengrowth.ai/api/waitlist", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

function mockInsert(result: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  mocks.createAdminSupabaseClient.mockReturnValue({ from });
  return { from, insert };
}

describe("POST /api/waitlist", () => {
  it("rejects a body that is not valid JSON", async () => {
    allowRateLimit();
    const response = await POST(postRequest("{not json"));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("INVALID_JSON");
  });

  it("rejects a missing or malformed email", async () => {
    allowRateLimit();
    for (const email of [undefined, "", "not-an-email", 42]) {
      const response = await POST(postRequest({ email }));
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error.code).toBe("INVALID_EMAIL");
    }
  });

  it("returns 429 when the per-IP rate limit is exhausted", async () => {
    mocks.checkRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterSeconds: 30,
    });
    const response = await POST(postRequest({ email: "visitor@example.com" }));
    expect(response.status).toBe(429);
    const json = await response.json();
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it("stores a normalized signup and returns its id", async () => {
    allowRateLimit();
    const { insert } = mockInsert({ data: { id: "sub-1" }, error: null });
    const response = await POST(
      postRequest({
        email: "  Visitor@Example.COM ",
        locale: "zh",
        source: "tools-hidden-keywords",
        landing_page: "/tools/hidden-keywords",
      }),
    );
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.data.id).toBe("sub-1");
    expect(insert).toHaveBeenCalledWith({
      email: "visitor@example.com",
      locale: "zh",
      source: "tools-hidden-keywords",
      landing_page: "/tools/hidden-keywords",
    });
  });

  it("keeps a duplicate signup indistinguishable from a first signup", async () => {
    allowRateLimit();
    mockInsert({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const response = await POST(postRequest({ email: "visitor@example.com" }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.id).toBeNull();
  });

  it("answers 503 when the table has not been provisioned", async () => {
    allowRateLimit();
    mockInsert({
      data: null,
      error: { code: "PGRST205", message: "missing table" },
    });
    const response = await POST(postRequest({ email: "visitor@example.com" }));
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error.code).toBe("LEAD_CAPTURE_UNAVAILABLE");
  });

  it("answers 503 when admin credentials are not configured", async () => {
    allowRateLimit();
    mocks.createAdminSupabaseClient.mockImplementation(() => {
      throw new Error("Missing Supabase admin credentials");
    });
    const response = await POST(postRequest({ email: "visitor@example.com" }));
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error.code).toBe("LEAD_CAPTURE_UNAVAILABLE");
  });
});

describe("PATCH /api/waitlist", () => {
  function mockProfileClient({
    createdAt,
    updateError = null,
  }: {
    createdAt: string | null;
    updateError?: { message: string } | null;
  }) {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: createdAt ? { created_at: createdAt } : null,
      error: null,
    });
    const selectEq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq: selectEq }));

    const updateSingle = vi.fn().mockResolvedValue({
      data: updateError ? null : { id: "sub-1" },
      error: updateError,
    });
    const updateSelect = vi.fn(() => ({ single: updateSingle }));
    const updateEq = vi.fn(() => ({ select: updateSelect }));
    const update = vi.fn(() => ({ eq: updateEq }));

    const from = vi.fn(() => ({ select, update }));
    mocks.createAdminSupabaseClient.mockReturnValue({ from });
    return { update };
  }

  it("requires subscriber_id", async () => {
    const response = await PATCH(patchRequest({ name: "A" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("MISSING_ID");
  });

  it("rate limits profile updates", async () => {
    mocks.checkRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 60,
    });
    const response = await PATCH(
      patchRequest({ subscriber_id: "sub-1", name: "A" }),
    );
    expect(response.status).toBe(429);
    const json = await response.json();
    expect(json.error.code).toBe("RATE_LIMITED");
  });

  it("answers 404 for an unknown subscriber", async () => {
    allowRateLimit();
    mockProfileClient({ createdAt: null });
    const response = await PATCH(
      patchRequest({ subscriber_id: "missing", name: "A" }),
    );
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("refuses updates outside the ten-minute window", async () => {
    allowRateLimit();
    mockProfileClient({
      createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    });
    const response = await PATCH(
      patchRequest({ subscriber_id: "sub-1", name: "A" }),
    );
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error.code).toBe("WINDOW_EXPIRED");
  });

  it("updates only the provided profile fields", async () => {
    allowRateLimit();
    const { update } = mockProfileClient({
      createdAt: new Date().toISOString(),
    });
    const response = await PATCH(
      patchRequest({ subscriber_id: "sub-1", name: "A", role: "founder" }),
    );
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ name: "A", role: "founder" });
  });
});
