import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["DATABASE_URL"] ??= "postgres://wzb@localhost:5432/signalframe_mvp_dev";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { workspaces } from "@sf/db/schema";
import { OAuthIntentsRepository, type OAuthIntentRow, type ProjectScope } from "@sf/db";
import { encryptCredential } from "@sf/sources";
import { ProblemError } from "@sf/observability";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { handleGoogleCallback } from "@/lib/services/source-connect";
import {
  generateState,
  hashState,
  generateCodeVerifier,
  type GoogleOAuthClient,
  type GoogleProperty,
} from "@/lib/oauth/google";

/**
 * AC-014 (spec §7.4, §11.1): the Google OAuth callback consumes external state
 * as a SINGLE-USE token. A replayed state (already advanced past `initiated`) is
 * rejected as `OAUTH_STATE_REPLAYED` (303 back to Sources with the error), an
 * expired state as `OAUTH_STATE_EXPIRED`, and an unknown/mismatched state as
 * `OAUTH_STATE_INVALID`. Tested at the service level with an injected OAuth
 * client + clock — no real Google network.
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

const credentialKey = () => Buffer.from(process.env["CREDENTIAL_ENCRYPTION_KEY"]!, "base64");

/** An offline OAuth client that never touches the network. */
const fakeClient = (): GoogleOAuthClient => ({
  exchangeCode: async () => ({
    accessToken: "fake-access-token",
    refreshToken: "fake-refresh-token",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
  }),
  listProperties: async (): Promise<GoogleProperty[]> => [
    { externalPropertyId: "https://seed.example/", displayName: "seed.example" },
  ],
});

/** Seed an `initiated` GSC oauth_intent with a known state; return the raw state. */
async function seedIntent(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  actor: string,
  expiresAt: string,
): Promise<{ state: string; intentId: string }> {
  const state = generateState();
  const intent = await new OAuthIntentsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    initiatedBy: actor,
    provider: "gsc",
    stateHash: hashState(state),
    pkceVerifierCipher: encryptCredential(generateCodeVerifier(), credentialKey()),
    redirectPath: `/p/${scope.projectId}/sources`,
    expiresAt,
  });
  return { state, intentId: intent.id };
}

describeDb("handleGoogleCallback — single-use state (AC-014)", () => {
  let handle: DbHandle;
  let scope: ProjectScope;
  let siteId: string;
  const actor = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [ws] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning();
    const workspaceId = ws!.id;
    const created = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      {
        clientName: "OAuth",
        projectName: "OAuth",
        siteUrl: "https://oauth.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    scope = { workspaceId, projectId: created.project.id };
    siteId = created.project.site.id;
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("consumes the state once, then rejects a replay as OAUTH_STATE_REPLAYED", async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const { state, intentId } = await seedIntent(handle, scope, siteId, actor, expiresAt);
    const repo = new OAuthIntentsRepository(handle.db);

    // First callback succeeds: state consumed → intent advances to properties_ready.
    const first = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client: fakeClient() },
    );
    expect(first).toBe(`/p/${scope.projectId}/sources?oauthIntentId=${intentId}`);
    const afterFirst = (await repo.findById(scope, intentId)) as OAuthIntentRow;
    expect(afterFirst.status).toBe("properties_ready");

    // Replaying the SAME state is rejected — the state is single-use.
    const replay = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client: fakeClient() },
    );
    expect(replay).toContain(`/p/${scope.projectId}/sources`);
    expect(replay).toContain("error=OAUTH_STATE_REPLAYED");
    const afterReplay = (await repo.findById(scope, intentId)) as OAuthIntentRow;
    expect(afterReplay.status).toBe("failed");
    expect(afterReplay.failure_code).toBe("OAUTH_STATE_REPLAYED");
  });

  it("rejects an expired state as OAUTH_STATE_EXPIRED", async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const { state } = await seedIntent(handle, scope, siteId, actor, expiresAt);
    // A clock past the intent TTL trips the expiry guard before any exchange.
    const result = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { now: () => Date.parse(expiresAt) + 1_000 },
    );
    expect(result).toContain("error=OAUTH_STATE_EXPIRED");
  });

  it("rejects an unknown/mismatched state as OAUTH_STATE_INVALID (no intent)", async () => {
    await expect(
      handleGoogleCallback(
        { workspaceId: scope.workspaceId },
        { code: "auth-code", state: generateState(), error: null },
        { client: fakeClient() },
      ),
    ).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
  });

  it("rejects a missing state as OAUTH_STATE_INVALID", async () => {
    await expect(
      handleGoogleCallback(
        { workspaceId: scope.workspaceId },
        { code: "auth-code", state: null, error: null },
        {},
      ),
    ).rejects.toBeInstanceOf(ProblemError);
    await expect(
      handleGoogleCallback(
        { workspaceId: scope.workspaceId },
        { code: "auth-code", state: null, error: null },
        {},
      ),
    ).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
  });
});
