import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyMarketingWebsiteProfile } from "../../../../../lib/account-websites/contracts.ts";

const mocks = vi.hoisted(() => ({
  getServerAuthenticatedUser: vi.fn(),
  readAccountWebsite: vi.fn(),
  setPrimaryAccountWebsite: vi.fn(),
  saveAccountWebsiteDraft: vi.fn(),
}));

vi.mock("../../../../../lib/auth/server-auth-user.ts", () => ({
  getServerAuthenticatedUser: mocks.getServerAuthenticatedUser,
}));

vi.mock("../../../../../lib/account-websites/store.ts", () => ({
  readAccountWebsite: mocks.readAccountWebsite,
  setPrimaryAccountWebsite: mocks.setPrimaryAccountWebsite,
  saveAccountWebsiteDraft: mocks.saveAccountWebsiteDraft,
}));

const { GET, PATCH } = await import("./route.ts");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const DETAILS = {
  websiteId: WEBSITE_ID,
  origin: "https://example.com",
  host: "example.com",
  canonicalSiteKey: "example.com",
  displayName: "Example",
  isPrimary: false,
  profileState: "not_generated",
  confirmedSnapshotId: null,
  confirmedSnapshotRevision: null,
  confirmedAt: null,
  createdAt: "2026-08-27T08:00:00.000Z",
  updatedAt: "2026-08-27T08:00:00.000Z",
  draft: null,
  currentConfirmedSnapshot: null,
};
const PROFILE = {
  ...emptyMarketingWebsiteProfile(),
  productName: "Example",
  oneLinePositioning: "Positioning",
  valueProposition: "Value",
  primaryIcp: "Teams",
  locale: "en-US",
};
const CONTEXT = { params: Promise.resolve({ websiteId: WEBSITE_ID }) };

function patch(
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(
    "https://gengrowth.ai/api/account/websites/" + WEBSITE_ID,
    {
      method: "PATCH",
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
  mocks.readAccountWebsite.mockResolvedValue({ kind: "ok", value: DETAILS });
  mocks.setPrimaryAccountWebsite.mockResolvedValue({
    kind: "ok",
    value: { ...DETAILS, isPrimary: true },
  });
  mocks.saveAccountWebsiteDraft.mockResolvedValue({
    kind: "ok",
    value: {
      ...DETAILS,
      profileState: "draft",
      draft: { draftVersion: 1, profile: PROFILE },
    },
  });
});

describe("GET /api/account/websites/[websiteId]", () => {
  it.each([
    ["unavailable", 503, "auth_unavailable"],
    ["unauthenticated", 401, "auth_required"],
  ] as const)("maps %s authentication", async (status, expectedStatus, code) => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({ status });

    const response = await GET(new Request("https://gengrowth.ai"), CONTEXT);

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(mocks.readAccountWebsite).not.toHaveBeenCalled();
  });

  it("treats an invalid or foreign identity as not found", async () => {
    const invalid = await GET(new Request("https://gengrowth.ai"), {
      params: Promise.resolve({ websiteId: "not-a-uuid" }),
    });
    expect(invalid.status).toBe(404);
    expect(mocks.readAccountWebsite).not.toHaveBeenCalled();

    mocks.readAccountWebsite.mockResolvedValue({ kind: "missing" });
    const missing = await GET(new Request("https://gengrowth.ai"), CONTEXT);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: { code: "website_not_found" },
    });
  });

  it("maps an unreadable private row to service unavailable", async () => {
    mocks.readAccountWebsite.mockResolvedValue({
      kind: "unavailable",
      reason: "malformed_store_response",
    });

    const response = await GET(new Request("https://gengrowth.ai"), CONTEXT);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "account_websites_unavailable" },
    });
  });

  it("returns exact owned details with private caching", async () => {
    const response = await GET(new Request("https://gengrowth.ai"), CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { website: DETAILS },
    });
    expect(mocks.readAccountWebsite).toHaveBeenCalledWith(USER_ID, WEBSITE_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("PATCH /api/account/websites/[websiteId]", () => {
  it.each([
    ["unavailable", 503, "auth_unavailable"],
    ["unauthenticated", 401, "auth_required"],
  ] as const)(
    "maps %s authentication before mutating the website",
    async (status, expectedStatus, code) => {
      mocks.getServerAuthenticatedUser.mockResolvedValue({ status });

      const response = await PATCH(
        patch(JSON.stringify({ intent: "set_primary" })),
        CONTEXT,
      );

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toEqual({ error: { code } });
      expect(mocks.setPrimaryAccountWebsite).not.toHaveBeenCalled();
      expect(mocks.saveAccountWebsiteDraft).not.toHaveBeenCalled();
    },
  );

  it("rejects cross-origin writes", async () => {
    const response = await PATCH(
      patch(JSON.stringify({ intent: "set_primary" }), {
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
        "https://gengrowth.ai/api/account/websites/" + WEBSITE_ID,
        { method: "PATCH", body: "{}" },
      ),
      415,
      "unsupported_media_type",
    ],
    [patch("{"), 400, "invalid_request"],
    [
      patch("{}", { "content-length": "140000" }),
      413,
      "payload_too_large",
    ],
  ] as const)("bounds malformed mutation bodies", async (request, status, code) => {
    const response = await PATCH(request, CONTEXT);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });

  it("requires one explicit mutation intent", async () => {
    const response = await PATCH(
      patch(JSON.stringify({ baseVersion: 0 })),
      CONTEXT,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
  });

  it("sets the primary website without accepting extra fields", async () => {
    const response = await PATCH(
      patch(JSON.stringify({ intent: "set_primary" })),
      CONTEXT,
    );

    expect(response.status).toBe(200);
    expect(mocks.setPrimaryAccountWebsite).toHaveBeenCalledWith({
      userId: USER_ID,
      websiteId: WEBSITE_ID,
    });
  });

  it("saves a strict profile against its exact base version", async () => {
    const response = await PATCH(
      patch(
        JSON.stringify({
          intent: "save_profile",
          baseVersion: 0,
          profile: PROFILE,
        }),
      ),
      CONTEXT,
    );

    expect(response.status).toBe(200);
    expect(mocks.saveAccountWebsiteDraft).toHaveBeenCalledWith({
      userId: USER_ID,
      websiteId: WEBSITE_ID,
      baseVersion: 0,
      profile: PROFILE,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("passes an exact snapshot guard for Agent Save Back", async () => {
    const reference = {
      schemaVersion: "website-profile-reference.v1",
      websiteId: WEBSITE_ID,
      snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
      snapshotRevision: 1,
      profileSchemaVersion: "marketing-website-profile.v1",
      profileHash: "a".repeat(64),
    };
    const response = await PATCH(
      patch(
        JSON.stringify({
          intent: "save_profile",
          baseVersion: 0,
          profile: PROFILE,
          expectedReference: reference,
        }),
      ),
      CONTEXT,
    );

    expect(response.status).toBe(200);
    expect(mocks.saveAccountWebsiteDraft).toHaveBeenCalledWith({
      userId: USER_ID,
      websiteId: WEBSITE_ID,
      baseVersion: 0,
      profile: PROFILE,
      expectedReference: reference,
    });
  });

  it("classifies a malformed snapshot guard separately from the profile", async () => {
    const response = await PATCH(
      patch(
        JSON.stringify({
          intent: "save_profile",
          baseVersion: 0,
          profile: PROFILE,
          expectedReference: { schemaVersion: "wrong" },
        }),
      ),
      CONTEXT,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_reference" },
    });
    expect(mocks.saveAccountWebsiteDraft).not.toHaveBeenCalled();
  });

  it("returns the safe current details on a stale draft", async () => {
    mocks.saveAccountWebsiteDraft.mockResolvedValue({
      kind: "conflict",
      current: DETAILS,
    });

    const response = await PATCH(
      patch(
        JSON.stringify({
          intent: "save_profile",
          baseVersion: 1,
          profile: PROFILE,
        }),
      ),
      CONTEXT,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "profile_conflict",
        details: { website: DETAILS },
      },
    });
  });

  it.each([
    [{ kind: "missing" }, 404, "website_not_found"],
    [{ kind: "invalid", code: "invalid_profile" }, 400, "invalid_profile"],
    [{ kind: "invalid", code: "invalid_reference" }, 400, "invalid_reference"],
    [
      { kind: "unavailable", reason: "store_down" },
      503,
      "account_websites_unavailable",
    ],
  ] as const)("maps write failures without leaking a profile", async (
    result,
    status,
    code,
  ) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.saveAccountWebsiteDraft.mockResolvedValue(result);

    const response = await PATCH(
      patch(
        JSON.stringify({
          intent: "save_profile",
          baseVersion: 0,
          profile: PROFILE,
        }),
      ),
      CONTEXT,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("Example");
  });
});
