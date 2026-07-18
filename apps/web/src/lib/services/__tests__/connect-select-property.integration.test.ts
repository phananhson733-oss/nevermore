import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["DATABASE_URL"] ??=
  "postgres://wzb@localhost:5432/signalframe_mvp_dev";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { workspaces } from "@sf/db/schema";
import {
  OAuthIntentsRepository,
  SourceCredentialsRepository,
  type ProjectScope,
} from "@sf/db";
import {
  encryptCredential,
  decryptCredential,
  decodeCredentialEnvelope,
} from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import {
  connectProjectSource,
  handleGoogleCallback,
} from "@/lib/services/source-connect";
import {
  generateState,
  hashState,
  generateCodeVerifier,
  type GoogleOAuthClient,
  type GoogleProperty,
} from "@/lib/oauth/google";

/**
 * Spec §14.3 (#4 fix): the connect flow must persist the FULL Google credential
 * envelope — the once-issued refresh token and the REAL access-token expiry —
 * not just a bare access token with `expires_at = null`. This exercises the
 * callback → select_property path against a real DB and asserts the stored
 * `source_credentials` row carries the real expiry and the refresh token.
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

const credentialKey = () =>
  Buffer.from(process.env["CREDENTIAL_ENCRYPTION_KEY"]!, "base64");

const EXPIRES_AT = new Date(Date.now() + 3600_000).toISOString();
const REFRESH_TOKEN = "1//fake-refresh-token";

const fakeClient = (): GoogleOAuthClient => ({
  exchangeCode: async () => ({
    accessToken: "fake-access-token",
    refreshToken: REFRESH_TOKEN,
    expiresAt: EXPIRES_AT,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
  }),
  listProperties: async (): Promise<GoogleProperty[]> => [
    {
      externalPropertyId: "https://seed.example/",
      displayName: "seed.example",
    },
  ],
});

describeDb("connect select_property — full credential envelope (#4)", () => {
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
    const created = await createProject(
      { workspaceId: ws!.id },
      actor,
      randomUUID(),
      {
        clientName: "Env",
        projectName: "Env",
        siteUrl: "https://env.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    scope = { workspaceId: ws!.id, projectId: created.project.id };
    siteId = created.project.site.id;
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("stores the refresh token and the REAL access-token expiry (not null)", async () => {
    // Phase 1: seed an initiated intent, then run the callback (which now stores
    // the full envelope in token_cipher).
    const state = generateState();
    const intent = await new OAuthIntentsRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      initiatedBy: actor,
      provider: "gsc",
      stateHash: hashState(state),
      pkceVerifierCipher: encryptCredential(
        generateCodeVerifier(),
        credentialKey(),
      ),
      redirectPath: `/p/${scope.projectId}/sources`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client: fakeClient() },
    );

    // The intent's token_cipher is the encrypted full envelope.
    const ready = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intent.id,
    );
    const intentEnvelope = decodeCredentialEnvelope(
      decryptCredential(ready!.token_cipher!, credentialKey()).toString("utf8"),
    );
    expect(intentEnvelope.refreshToken).toBe(REFRESH_TOKEN);
    expect(intentEnvelope.expiresAt).toBe(EXPIRES_AT);

    // Phase 3: select the property → creates the connection + credential.
    const result = await connectProjectSource(
      scope,
      scope.projectId,
      "gsc",
      actor,
      {
        phase: "select_property",
        oauthIntentId: intent.id,
        externalPropertyId: "https://seed.example/",
      },
    );
    expect(result.phase).toBe("connected");

    // The persisted credential carries the real expiry AND the refresh token.
    const source = result.phase === "connected" ? result.source : undefined;
    expect(source?.id).toBeTruthy();
    const cred = await new SourceCredentialsRepository(
      handle.db,
    ).findByConnection(scope, source!.id!);
    expect(cred).not.toBeNull();
    expect(cred!.expires_at).not.toBeNull();
    expect(new Date(cred!.expires_at!).toISOString()).toBe(EXPIRES_AT);
    const credEnvelope = decodeCredentialEnvelope(
      decryptCredential(cred!.encrypted_payload, credentialKey()).toString(
        "utf8",
      ),
    );
    expect(credEnvelope.accessToken).toBe("fake-access-token");
    expect(credEnvelope.refreshToken).toBe(REFRESH_TOKEN);
  });
});
