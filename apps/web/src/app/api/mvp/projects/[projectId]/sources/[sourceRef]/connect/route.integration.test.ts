import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "offline-client";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "offline-secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { oauthIntents, workspaces } from "@sf/db/schema";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { seedConfirmedSourceProfile } from "@/lib/services/__tests__/confirmed-source-profile-fixture";

const operator = vi.hoisted(() => ({
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({ ...operator })),
}));

vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceAttemptRateLimit: vi.fn(async () => undefined),
}));

const { POST } = await import("./route");

const DATABASE_URL = process.env["DATABASE_URL"]!;
const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

describe("POST OAuth connect returnPath isolation", () => {
  let handle: DbHandle;
  let ownerProjectId: string;
  let foreignProjectId: string;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `OAuth route ${randomUUID()}` })
      .returning();
    operator.workspaceId = workspace!.id;
    operator.userId = randomUUID();
    const owner = await createProject(
      { workspaceId: operator.workspaceId },
      operator.userId,
      randomUUID(),
      {
        mode: "product_profile",
        productName: "Owner",
        productUrl: "https://route-owner.example.com/product",
        customerModel: "b2b",
        primaryMarket: "US",
        growthObjectives: ["increase_organic_traffic"],
      },
      safeGuard,
      { defaultDeliveryLocale: "en" },
    );
    const foreign = await createProject(
      { workspaceId: operator.workspaceId },
      operator.userId,
      randomUUID(),
      {
        clientName: "Foreign",
        projectName: "Foreign",
        siteUrl: "https://route-foreign.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    ownerProjectId = owner.project.id;
    foreignProjectId = foreign.project.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  it.each([
    ["foreign", () => foreignProjectId],
    ["nonexistent", () => randomUUID()],
  ])("returns 422 for a %s project returnPath and creates no intent", async (_label, projectId) => {
    const before = await countOwnerIntents();
    const response = await POST(
      new NextRequest(
        `http://localhost:3000/api/mvp/projects/${ownerProjectId}/sources/gsc/connect`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            "x-request-id": `return-path-${_label}`,
          },
          body: JSON.stringify({
            phase: "authorize",
            returnPath: `/p/${projectId()}/sources`,
          }),
        },
      ),
      {
        params: Promise.resolve({
          projectId: ownerProjectId,
          sourceRef: "gsc",
        }),
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [
        expect.objectContaining({
          pointer: "/returnPath",
          code: "project_mismatch",
        }),
      ],
    });
    await expect(countOwnerIntents()).resolves.toBe(before);
  });

  it("rejects a valid OAuth authorize request until Product Profile and ICP are confirmed", async () => {
    const before = await countOwnerIntents();
    const response = await authorizeOwner("profile-required");

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONTEXT_INCOMPLETE",
      status: 422,
      detail: "Confirm the Product Profile and ICP before connecting GSC or GA4.",
    });
    await expect(countOwnerIntents()).resolves.toBe(before);
  });

  it("allows the exact optional setup path before Product Profile confirmation", async () => {
    const before = await countOwnerIntents();
    const response = await authorizeOwner(
      "optional-source-onboarding",
      "setup-sources",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        phase: "authorization",
        authorizationUrl: expect.stringContaining(
          "https://accounts.google.com/o/oauth2/v2/auth",
        ),
      },
    });
    await expect(countOwnerIntents()).resolves.toBe(before + 1);
  });

  it("allows OAuth authorize after the Product Profile and ICP are confirmed", async () => {
    await seedConfirmedSourceProfile(
      handle,
      {
        workspaceId: operator.workspaceId,
        projectId: ownerProjectId,
      },
      operator.userId,
    );
    const before = await countOwnerIntents();
    const response = await authorizeOwner("profile-confirmed");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        phase: "authorization",
        authorizationUrl: expect.stringContaining(
          "https://accounts.google.com/o/oauth2/v2/auth",
        ),
      },
    });
    await expect(countOwnerIntents()).resolves.toBe(before + 1);
  });

  async function authorizeOwner(
    requestId: string,
    segment: "sources" | "setup-sources" = "sources",
  ): Promise<Response> {
    return POST(
      new NextRequest(
        `http://localhost:3000/api/mvp/projects/${ownerProjectId}/sources/gsc/connect`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            "x-request-id": requestId,
          },
          body: JSON.stringify({
            phase: "authorize",
            returnPath: `/p/${ownerProjectId}/${segment}`,
          }),
        },
      ),
      {
        params: Promise.resolve({
          projectId: ownerProjectId,
          sourceRef: "gsc",
        }),
      },
    );
  }

  async function countOwnerIntents(): Promise<number> {
    const rows = await handle.db
      .select({ id: oauthIntents.id })
      .from(oauthIntents)
      .where(
        and(
          eq(oauthIntents.workspace_id, operator.workspaceId),
          eq(oauthIntents.project_id, ownerProjectId),
        ),
      );
    return rows.length;
  }
});
