import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAuthenticatedUser: vi.fn(),
  confirmAccountWebsiteProfile: vi.fn(),
}));

vi.mock("../../../../../../lib/auth/server-auth-user.ts", () => ({
  getServerAuthenticatedUser: mocks.getServerAuthenticatedUser,
}));

vi.mock("../../../../../../lib/account-websites/store.ts", () => ({
  confirmAccountWebsiteProfile: mocks.confirmAccountWebsiteProfile,
}));

const { POST } = await import("./route.ts");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const DETAILS = {
  websiteId: WEBSITE_ID,
  profileState: "confirmed",
  draft: { draftVersion: 2 },
  currentConfirmedSnapshot: {
    snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
  },
};
const CONTEXT = { params: Promise.resolve({ websiteId: WEBSITE_ID }) };

function post(
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(
    "https://gengrowth.ai/api/account/websites/" + WEBSITE_ID + "/confirm",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://gengrowth.ai",
        ...headers,
      },
      body,
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerAuthenticatedUser.mockResolvedValue({
    status: "authenticated",
    userId: USER_ID,
    email: null,
    avatarUrl: null,
  });
  mocks.confirmAccountWebsiteProfile.mockResolvedValue({
    kind: "ok",
    value: DETAILS,
  });
});

describe("POST /api/account/websites/[websiteId]/confirm", () => {
  it.each([
    ["unavailable", 503, "auth_unavailable"],
    ["unauthenticated", 401, "auth_required"],
  ] as const)("maps %s authentication", async (status, expectedStatus, code) => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({ status });

    const response = await POST(post('{"baseVersion":2}'), CONTEXT);

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(mocks.confirmAccountWebsiteProfile).not.toHaveBeenCalled();
  });

  it("rejects an invalid identity without probing the store", async () => {
    const response = await POST(post('{"baseVersion":2}'), {
      params: Promise.resolve({ websiteId: "not-a-uuid" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.confirmAccountWebsiteProfile).not.toHaveBeenCalled();
  });

  it("rejects cross-origin confirmation", async () => {
    const response = await POST(
      post('{"baseVersion":2}', {
        origin: "https://attacker.example",
      }),
      CONTEXT,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "cross_origin" },
    });
  });

  it.each([
    [
      new Request(
        "https://gengrowth.ai/api/account/websites/" + WEBSITE_ID + "/confirm",
        { method: "POST", body: "{}" },
      ),
      415,
      "unsupported_media_type",
    ],
    [post("{"), 400, "invalid_request"],
    [
      post("{}", { "content-length": "2000" }),
      413,
      "payload_too_large",
    ],
    [post('{"baseVersion":-1}'), 400, "invalid_request"],
  ] as const)("bounds and validates confirmation bodies", async (
    request,
    status,
    code,
  ) => {
    const response = await POST(request, CONTEXT);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });

  it.each([
    [{ kind: "missing" }, 404, { code: "website_not_found" }],
    [
      {
        kind: "invalid",
        code: "profile_incomplete",
        fields: ["valueProposition"],
      },
      422,
      { code: "profile_incomplete", fields: ["valueProposition"] },
    ],
    [
      { kind: "unavailable", reason: "store_down" },
      503,
      { code: "account_websites_unavailable" },
    ],
  ] as const)("maps safe confirmation failures", async (
    result,
    status,
    error,
  ) => {
    mocks.confirmAccountWebsiteProfile.mockResolvedValue(result);

    const response = await POST(post('{"baseVersion":2}'), CONTEXT);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
  });

  it("returns current details on confirmation conflict", async () => {
    mocks.confirmAccountWebsiteProfile.mockResolvedValue({
      kind: "conflict",
      current: DETAILS,
    });

    const response = await POST(post('{"baseVersion":2}'), CONTEXT);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "profile_conflict",
        details: { website: DETAILS },
      },
    });
  });

  it("confirms the exact saved draft version with private caching", async () => {
    const response = await POST(post('{"baseVersion":2}'), CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { website: DETAILS },
    });
    expect(mocks.confirmAccountWebsiteProfile).toHaveBeenCalledWith({
      userId: USER_ID,
      websiteId: WEBSITE_ID,
      baseVersion: 2,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
