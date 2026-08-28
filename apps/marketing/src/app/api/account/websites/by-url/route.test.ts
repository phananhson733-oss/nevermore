import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  emptyMarketingWebsiteProfile,
} from "../../../../../lib/account-websites/contracts.ts";

const mocks = vi.hoisted(() => ({
  getServerAuthenticatedUser: vi.fn(),
  findAccountWebsiteByUrl: vi.fn(),
}));

vi.mock("../../../../../lib/auth/server-auth-user.ts", () => ({
  getServerAuthenticatedUser: mocks.getServerAuthenticatedUser,
}));

vi.mock("../../../../../lib/account-websites/store.ts", () => ({
  findAccountWebsiteByUrl: mocks.findAccountWebsiteByUrl,
}));

const { GET } = await import("./route.ts");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";

function websiteSummary(overrides: Record<string, unknown> = {}) {
  return {
    websiteId: WEBSITE_ID,
    origin: "https://example.com",
    host: "example.com",
    canonicalSiteKey: "example.com",
    displayName: "Example",
    isPrimary: true,
    profileState: "confirmed",
    confirmedSnapshotId: SNAPSHOT_ID,
    confirmedSnapshotRevision: 1,
    confirmedAt: "2026-08-27T08:00:00.000Z",
    createdAt: "2026-08-27T08:00:00.000Z",
    updatedAt: "2026-08-27T08:00:00.000Z",
    ...overrides,
  };
}

function resolvedWebsiteProfile(overrides: Record<string, unknown> = {}) {
  const profile = {
    ...emptyMarketingWebsiteProfile(),
    productName: "Example",
    oneLinePositioning: "Example positioning",
    valueProposition: "Example value",
    primaryIcp: "Example ICP",
    locale: "en-US",
  };
  return {
    website: websiteSummary(),
    reference: {
      schemaVersion: "website-profile-reference.v1",
      websiteId: WEBSITE_ID,
      snapshotId: SNAPSHOT_ID,
      snapshotRevision: 1,
      profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      profileHash:
        "8a7f13e9471cc5d697f1c2f7c2d222f3f7bcd5ce6bf0f4f4a56fa2d1e1c9d5c3",
    },
    profile,
    ...overrides,
  };
}

function request(url: string): Request {
  return new Request(
    `https://gengrowth.ai/api/account/websites/by-url?url=${encodeURIComponent(url)}`,
  );
}

beforeEach(() => {
  mocks.getServerAuthenticatedUser.mockReset();
  mocks.findAccountWebsiteByUrl.mockReset();

  mocks.getServerAuthenticatedUser.mockResolvedValue({
    status: "authenticated",
    userId: USER_ID,
    email: "ada@example.test",
    avatarUrl: null,
  });
  mocks.findAccountWebsiteByUrl.mockResolvedValue({
    kind: "ok",
    value: resolvedWebsiteProfile(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/account/websites/by-url", () => {
  it("answers 503 when auth itself is unavailable", async () => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({ status: "unavailable" });

    const response = await GET(request("https://example.com"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
  });

  it("answers 401 for a signed-out visitor", async () => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({
      status: "unauthenticated",
    });

    const response = await GET(request("https://example.com"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
  });

  it("rejects a missing or malformed target URL", async () => {
    mocks.findAccountWebsiteByUrl.mockResolvedValue({
      kind: "invalid",
      code: "invalid_url",
    });

    const response = await GET(request("notaurl"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_url" },
    });
  });

  it("answers 404 when the user owns no matching website", async () => {
    mocks.findAccountWebsiteByUrl.mockResolvedValue({ kind: "missing" });

    const response = await GET(request("https://example.com"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "website_not_found" },
    });
  });

  it("answers 503 without exposing the store reason", async () => {
    mocks.findAccountWebsiteByUrl.mockResolvedValue({
      kind: "unavailable",
      reason: "connection_refused",
    });

    const response = await GET(request("https://example.com"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "account_websites_unavailable" },
    });
  });

  it("refuses to reference a draft-only website", async () => {
    mocks.findAccountWebsiteByUrl.mockResolvedValue({
      kind: "invalid",
      code: "profile_not_confirmed",
    });

    const response = await GET(request("https://example.com"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "profile_not_confirmed" },
    });
  });

  it("returns an exact owned snapshot reference and its profile", async () => {
    const response = await GET(request("https://www.example.com/pricing"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: resolvedWebsiteProfile(),
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findAccountWebsiteByUrl).toHaveBeenCalledWith(
      USER_ID,
      "https://www.example.com/pricing",
    );
  });
});
