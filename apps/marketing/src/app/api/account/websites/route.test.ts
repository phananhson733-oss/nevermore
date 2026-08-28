import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  emptyMarketingWebsiteProfile,
} from "../../../../lib/account-websites/contracts.ts";

const mocks = vi.hoisted(() => ({
  getServerAuthenticatedUser: vi.fn(),
  isSameOriginPost: vi.fn(() => true),
  readPublicToolJson: vi.fn(),
  listAccountWebsites: vi.fn(),
  addAccountWebsite: vi.fn(),
}));

vi.mock("../../../../lib/auth/server-auth-user.ts", () => ({
  getServerAuthenticatedUser: mocks.getServerAuthenticatedUser,
}));

vi.mock("../../../../lib/auth/disconnect.ts", () => ({
  isSameOriginPost: mocks.isSameOriginPost,
}));

vi.mock("../../../../lib/tools/public-tool-request.ts", () => ({
  readPublicToolJson: mocks.readPublicToolJson,
}));

vi.mock("../../../../lib/account-websites/store.ts", () => ({
  listAccountWebsites: mocks.listAccountWebsites,
  addAccountWebsite: mocks.addAccountWebsite,
}));

const { GET, POST } = await import("./route.ts");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";

function websiteSummary(overrides: Record<string, unknown> = {}) {
  return {
    websiteId: WEBSITE_ID,
    origin: "https://example.com",
    host: "example.com",
    canonicalSiteKey: "example.com",
    displayName: "Example",
    isPrimary: true,
    profileState: "confirmed",
    confirmedSnapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
    confirmedSnapshotRevision: 1,
    confirmedAt: "2026-08-27T08:00:00.000Z",
    createdAt: "2026-08-27T08:00:00.000Z",
    updatedAt: "2026-08-27T08:00:00.000Z",
    ...overrides,
  };
}

function websiteDetails(overrides: Record<string, unknown> = {}) {
  const profile = {
    ...emptyMarketingWebsiteProfile(),
    productName: "Example",
    oneLinePositioning: "Example positioning",
    valueProposition: "Example value",
    primaryIcp: "Example ICP",
    locale: "en-US",
  };
  return {
    ...websiteSummary(),
    draft: {
      draftVersion: 2,
      updatedAt: "2026-08-27T08:00:00.000Z",
      profileHash:
        "8a7f13e9471cc5d697f1c2f7c2d222f3f7bcd5ce6bf0f4f4a56fa2d1e1c9d5c3",
      profile,
    },
    currentConfirmedSnapshot: {
      schemaVersion: "website-profile-reference.v1",
      websiteId: WEBSITE_ID,
      snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
      snapshotRevision: 1,
      profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      profileHash:
        "8a7f13e9471cc5d697f1c2f7c2d222f3f7bcd5ce6bf0f4f4a56fa2d1e1c9d5c3",
      confirmedAt: "2026-08-27T08:00:00.000Z",
      profile,
    },
    ...overrides,
  };
}

function request(body?: unknown, contentType = "application/json"): Request {
  return new Request("https://gengrowth.ai/api/account/websites", {
    method: "POST",
    headers: body === undefined ? {} : { "content-type": contentType },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getServerAuthenticatedUser.mockReset();
  mocks.isSameOriginPost.mockReset();
  mocks.readPublicToolJson.mockReset();
  mocks.listAccountWebsites.mockReset();
  mocks.addAccountWebsite.mockReset();

  mocks.getServerAuthenticatedUser.mockResolvedValue({
    status: "authenticated",
    userId: USER_ID,
    email: "ada@example.test",
    avatarUrl: null,
  });
  mocks.isSameOriginPost.mockReturnValue(true);
  mocks.listAccountWebsites.mockResolvedValue({
    kind: "ok",
    value: [websiteSummary()],
  });
  mocks.readPublicToolJson.mockResolvedValue({
    ok: true,
    value: { url: "example.com", displayName: "Example" },
  });
  mocks.addAccountWebsite.mockResolvedValue({
    kind: "ok",
    value: websiteDetails(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/account/websites", () => {
  it("answers 503 when auth itself is unavailable", async () => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({ status: "unavailable" });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
  });

  it("answers 401 when the visitor is signed out", async () => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({
      status: "unauthenticated",
    });

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(mocks.listAccountWebsites).not.toHaveBeenCalled();
  });

  it("returns private summaries with no-store caching", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { websites: [websiteSummary()] },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.listAccountWebsites).toHaveBeenCalledWith(USER_ID);
  });

  it("answers 503 when the store cannot read the list", async () => {
    mocks.listAccountWebsites.mockResolvedValue({
      kind: "unavailable",
      reason: "store_unavailable",
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "account_websites_unavailable" },
    });
  });
});

describe("POST /api/account/websites", () => {
  it.each([
    ["unavailable", 503, "auth_unavailable"],
    ["unauthenticated", 401, "auth_required"],
  ] as const)(
    "maps %s authentication before reading the mutation body",
    async (status, expectedStatus, code) => {
      mocks.getServerAuthenticatedUser.mockResolvedValue({ status });

      const response = await POST(request({ url: "example.com" }));

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toEqual({ error: { code } });
      expect(mocks.readPublicToolJson).not.toHaveBeenCalled();
      expect(mocks.addAccountWebsite).not.toHaveBeenCalled();
    },
  );

  it("rejects a cross-origin mutation before reading the body", async () => {
    mocks.isSameOriginPost.mockReturnValue(false);

    const response = await POST(request({ url: "example.com" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "cross_origin" },
    });
    expect(mocks.readPublicToolJson).not.toHaveBeenCalled();
  });

  it("maps request body reader failures to stable request errors", async () => {
    mocks.readPublicToolJson.mockResolvedValue({
      ok: false,
      code: "payload_too_large",
    });

    const response = await POST(request({ url: "example.com" }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
    expect(mocks.addAccountWebsite).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_request", 400],
    ["unsupported_media_type", 415],
  ] as const)("maps %s without calling the store", async (code, status) => {
    mocks.readPublicToolJson.mockResolvedValue({ ok: false, code });

    const response = await POST(request({ url: "example.com" }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(mocks.addAccountWebsite).not.toHaveBeenCalled();
  });

  it("returns 409 with the existing website summary on duplicate add", async () => {
    mocks.addAccountWebsite.mockResolvedValue({
      kind: "duplicate",
      website: websiteSummary(),
    });

    const response = await POST(request({ url: "example.com" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "website_exists",
        details: { website: websiteSummary() },
      },
    });
  });

  it("creates the website and returns its owned details", async () => {
    const response = await POST(request({ url: "example.com" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: { website: websiteDetails() },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.addAccountWebsite).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        url: "example.com",
        displayName: "Example",
      },
    );
  });
});
