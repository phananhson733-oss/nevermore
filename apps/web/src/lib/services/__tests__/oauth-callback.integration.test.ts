import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
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
import { clientProjects, oauthIntents, workspaces } from "@sf/db/schema";
import {
  OAuthIntentsRepository,
  type OAuthIntentRow,
  type ProjectScope,
} from "@sf/db";
import { encryptCredential } from "@sf/sources";
import { ProblemError } from "@sf/observability";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { archiveWinsProjectRace } from "./project-archive-race";
import { seedConfirmedSourceProfile } from "./confirmed-source-profile-fixture";

const callbackOperator = vi.hoisted(() => ({
  current: null as { userId: string; workspaceId: string } | null,
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: async () => callbackOperator.current,
}));

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

const credentialKey = () =>
  Buffer.from(process.env["CREDENTIAL_ENCRYPTION_KEY"]!, "base64");

/** An offline OAuth client that never touches the network. */
const fakeClient = (): GoogleOAuthClient => ({
  exchangeCode: async () => ({
    accessToken: "fake-access-token",
    refreshToken: "fake-refresh-token",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
  }),
  listProperties: async (): Promise<GoogleProperty[]> => [
    {
      externalPropertyId: "https://seed.example/",
      displayName: "seed.example",
    },
  ],
});

/** Seed an `initiated` GSC oauth_intent with a known state; return the raw state. */
async function seedIntent(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  actor: string,
  expiresAt: string,
  redirectPath = `/p/${scope.projectId}/sources`,
): Promise<{ state: string; intentId: string }> {
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
    redirectPath,
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
    await seedConfirmedSourceProfile(handle, scope, actor);
  });
  afterAll(async () => {
    await handle?.end();
  });

  async function requestCallback(params: {
    code?: string;
    state: string;
    error?: string;
  }) {
    const previousOperator = callbackOperator.current;
    callbackOperator.current = {
      userId: actor,
      workspaceId: scope.workspaceId,
    };
    try {
      const { GET } = await import(
        "@/app/api/mvp/oauth/google/callback/route"
      );
      const url = new URL(
        "/api/mvp/oauth/google/callback",
        process.env["APP_ORIGIN"],
      );
      if (params.code) url.searchParams.set("code", params.code);
      url.searchParams.set("state", params.state);
      if (params.error) url.searchParams.set("error", params.error);
      return await GET(new NextRequest(url));
    } finally {
      callbackOperator.current = previousOperator;
    }
  }

  it("rejects a replay without poisoning the ready intent, which remains selectable", async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      expiresAt,
    );
    const repo = new OAuthIntentsRepository(handle.db);

    // First callback succeeds: state consumed → intent advances to properties_ready.
    const first = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client: fakeClient() },
    );
    // The success redirect carries BOTH oauthIntentId and provider so the Sources
    // screen can open the property picker (source-connect.ts, fix 3aaffbe).
    expect(first).toBe(
      `/p/${scope.projectId}/sources?oauthIntentId=${intentId}&provider=gsc`,
    );
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
    const afterReplay = (await repo.findById(
      scope,
      intentId,
    )) as OAuthIntentRow;
    expect(afterReplay.status).toBe("properties_ready");
    expect(afterReplay.failure_code).toBeNull();

    const selected = await connectProjectSource(
      scope,
      scope.projectId,
      "gsc",
      actor,
      {
        phase: "select_property",
        oauthIntentId: intentId,
        externalPropertyId: "https://seed.example/",
      },
    );
    expect(selected.phase).toBe("connected");
    const afterSelection = (await repo.findById(scope, intentId)) as OAuthIntentRow;
    expect(afterSelection.status).toBe("consumed");
  });

  it("serializes concurrent callbacks so exactly one exchanges the code", async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      expiresAt,
    );
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let releaseExchange: (() => void) | undefined;
    const exchangeGate = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    const exchangeCode = vi.fn(async () => {
      markStarted?.();
      await exchangeGate;
      return {
        accessToken: "concurrent-access-token",
        refreshToken: "concurrent-refresh-token",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scope: "https://www.googleapis.com/auth/webmasters.readonly",
      };
    });
    const listProperties = vi.fn(async (): Promise<GoogleProperty[]> => [
      {
        externalPropertyId: "https://concurrent.example/",
        displayName: "concurrent.example",
      },
    ]);
    const client: GoogleOAuthClient = { exchangeCode, listProperties };

    const first = handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client },
    );
    await started;
    const second = handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    releaseExchange?.();

    const locations = await Promise.all([first, second]);
    expect(
      locations.filter((location) => location.includes(`oauthIntentId=${intentId}`)),
    ).toHaveLength(1);
    expect(
      locations.filter((location) => location.includes("error=OAUTH_STATE_REPLAYED")),
    ).toHaveLength(1);
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(listProperties).toHaveBeenCalledTimes(1);
    const ready = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intentId,
    );
    expect(ready).toMatchObject({
      status: "properties_ready",
      failure_code: null,
    });
  });

  it("derives the callback location from the intent project even for a legacy mismatched redirect row", async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const foreignProjectId = randomUUID();
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      expiresAt,
      `/p/${foreignProjectId}/sources`,
    );

    const location = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client: fakeClient() },
    );

    expect(location).toBe(
      `/p/${scope.projectId}/sources?oauthIntentId=${intentId}&provider=gsc`,
    );
    expect(location).not.toContain(foreignProjectId);
  });

  it.each([
    {
      label: "consent denial",
      params: { code: null, error: "access_denied" },
      expectedCode: "OAUTH_CONSENT_DENIED",
    },
    {
      label: "missing code",
      params: { code: null, error: null },
      expectedCode: "OAUTH_STATE_INVALID",
    },
  ])("scrubs an initiated intent after $label", async ({ params, expectedCode }) => {
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      new Date(Date.now() + 600_000).toISOString(),
    );

    const location = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { state, ...params },
      { client: fakeClient() },
    );

    expect(location).toContain(`error=${expectedCode}`);
    const failed = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intentId,
    );
    expect(failed).toMatchObject({
      status: "failed",
      failure_code: expectedCode,
      token_cipher: null,
      candidate_properties: null,
    });
    expect(failed?.pkce_verifier_cipher).toEqual(Buffer.alloc(32));
  });

  it("keeps an initiated intent retryable after a transient token-exchange failure", async () => {
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      new Date(Date.now() + 600_000).toISOString(),
    );
    let exchangeAttempts = 0;
    const client: GoogleOAuthClient = {
      exchangeCode: async () => {
        exchangeAttempts += 1;
        if (exchangeAttempts === 1) {
          throw new ProblemError(
            "DEPENDENCY_UNAVAILABLE",
            "token exchange: provider request timed out.",
          );
        }
        return {
          accessToken: "retryable-access-token",
          refreshToken: "retryable-refresh-token",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          scope: "https://www.googleapis.com/auth/webmasters.readonly",
        };
      },
      listProperties: async () => [
        {
          externalPropertyId: "https://retryable.example/",
          displayName: "retryable.example",
        },
      ],
    };

    const first = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client },
    );
    expect(first).toContain("error=OAUTH_EXCHANGE_FAILED");
    const afterFirst = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intentId,
    );
    expect(afterFirst).toMatchObject({
      status: "initiated",
      failure_code: null,
      token_cipher: null,
      candidate_properties: null,
    });
    expect(afterFirst?.pkce_verifier_cipher).not.toEqual(Buffer.alloc(32));

    const second = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client },
    );
    expect(second).toBe(
      `/p/${scope.projectId}/sources?oauthIntentId=${intentId}&provider=gsc`,
    );
    expect(exchangeAttempts).toBe(2);
    const ready = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intentId,
    );
    expect(ready).toMatchObject({
      status: "properties_ready",
      failure_code: null,
    });
  });

  it("fails and scrubs an initiated intent whose PKCE verifier cannot be decrypted", async () => {
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      new Date(Date.now() + 600_000).toISOString(),
    );
    await handle.db
      .update(oauthIntents)
      .set({ pkce_verifier_cipher: Buffer.alloc(32, 0xa5) })
      .where(eq(oauthIntents.id, intentId));

    const response = await requestCallback({ code: "auth-code", state });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/p/${scope.projectId}/sources?error=OAUTH_EXCHANGE_FAILED`,
    );
    const failed = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intentId,
    );
    expect(failed).toMatchObject({
      status: "failed",
      failure_code: "OAUTH_EXCHANGE_FAILED",
      token_cipher: null,
      candidate_properties: null,
    });
    expect(failed?.pkce_verifier_cipher).toEqual(Buffer.alloc(32));
  });

  it("waits behind archival and returns a stable 303 without mutating the initiated intent", async () => {
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      new Date(Date.now() + 600_000).toISOString(),
    );
    const repo = new OAuthIntentsRepository(handle.db);
    const before = await repo.findById(scope, intentId);

    try {
      const result = await archiveWinsProjectRace(
        handle,
        scope.projectId,
        () => requestCallback({ state, error: "access_denied" }),
      );

      expect(result.status).toBe("fulfilled");
      if (result.status !== "fulfilled") throw result.reason;
      const response = result.value;
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        `/p/${scope.projectId}/sources?error=PROJECT_ARCHIVED`,
      );
      await expect(repo.findById(scope, intentId)).resolves.toEqual(before);
    } finally {
      await handle.db
        .update(clientProjects)
        .set({ archived_at: null })
        .where(eq(clientProjects.id, scope.projectId));
    }
  });

  it("persists the temporary token across a transient property-list failure and retries without re-exchanging", async () => {
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      new Date(Date.now() + 600_000).toISOString(),
    );
    const exchangeCode = vi.fn(async () => ({
      accessToken: "staged-access-token",
      refreshToken: "staged-refresh-token",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
    }));
    let listAttempts = 0;
    const listProperties = vi.fn(async (): Promise<GoogleProperty[]> => {
      listAttempts += 1;
      if (listAttempts === 1) {
        throw new ProblemError(
          "RATE_LIMITED",
          "list GSC sites: rate limited.",
        );
      }
      return [
        {
          externalPropertyId: "https://staged.example/",
          displayName: "staged.example",
        },
      ];
    });
    const client: GoogleOAuthClient = { exchangeCode, listProperties };

    const first = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client },
    );
    expect(first).toContain("error=OAUTH_EXCHANGE_FAILED");
    const staged = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intentId,
    );
    expect(staged).toMatchObject({
      status: "initiated",
      failure_code: null,
      candidate_properties: null,
    });
    expect(staged?.token_cipher).not.toBeNull();
    expect(staged?.pkce_verifier_cipher).not.toEqual(Buffer.alloc(32));
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(listProperties).toHaveBeenCalledTimes(1);

    const second = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      {
        code: "different-code-is-ignored-on-retry",
        state,
        error: null,
      },
      { client },
    );
    expect(second).toBe(
      `/p/${scope.projectId}/sources?oauthIntentId=${intentId}&provider=gsc`,
    );
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(listProperties).toHaveBeenCalledTimes(2);
    const ready = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intentId,
    );
    expect(ready).toMatchObject({
      status: "properties_ready",
      failure_code: null,
    });
    expect(ready?.token_cipher).not.toBeNull();
  });

  it("still scrubs an intent on a permanent property-candidate failure", async () => {
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      new Date(Date.now() + 600_000).toISOString(),
    );
    const client: GoogleOAuthClient = {
      ...fakeClient(),
      listProperties: async () =>
        Array.from({ length: 501 }, (_, index) => ({
          externalPropertyId: `sc-domain:site-${index}.example`,
          displayName: `site-${index}.example`,
        })),
    };

    const location = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client },
    );

    expect(location).toContain("error=OAUTH_EXCHANGE_FAILED");
    const failed = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intentId,
    );
    expect(failed).toMatchObject({
      status: "failed",
      failure_code: "OAUTH_EXCHANGE_FAILED",
      token_cipher: null,
      candidate_properties: null,
    });
    expect(failed?.pkce_verifier_cipher).toEqual(Buffer.alloc(32));
  });

  it("rejects an expired state as OAUTH_STATE_EXPIRED", async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const { state, intentId } = await seedIntent(
      handle,
      scope,
      siteId,
      actor,
      expiresAt,
    );
    // A clock past the intent TTL trips the expiry guard before any exchange.
    const result = await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { now: () => Date.parse(expiresAt) + 1_000 },
    );
    expect(result).toContain("error=OAUTH_STATE_EXPIRED");
    const expired = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intentId,
    );
    expect(expired).toMatchObject({
      status: "expired",
      failure_code: "OAUTH_STATE_EXPIRED",
      token_cipher: null,
      candidate_properties: null,
    });
    expect(expired?.pkce_verifier_cipher).toEqual(Buffer.alloc(32));
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
