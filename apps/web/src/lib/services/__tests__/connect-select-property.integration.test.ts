import { randomUUID } from "node:crypto";

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
import { and, eq, sql } from "drizzle-orm";
import {
  clientProjects,
  oauthIntents,
  sourceCredentials,
  workspaces,
} from "@sf/db/schema";
import {
  OAuthIntentsRepository,
  ProjectsRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  type OAuthIntentRow,
  type ProjectScope,
} from "@sf/db";
import {
  encryptCredential,
  decryptCredential,
  decodeCredentialEnvelope,
  encodeCredentialEnvelope,
} from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import {
  connectProjectSource,
  getOnboardingGoogleSourceState,
  handleGoogleCallback,
} from "@/lib/services/source-connect";
import { disconnectProjectSource } from "@/lib/services/sources";
import {
  generateState,
  hashState,
  generateCodeVerifier,
  type GoogleOAuthClient,
  type GoogleProperty,
} from "@/lib/oauth/google";
import { archiveWinsProjectRace } from "./project-archive-race";
import { seedConfirmedSourceProfile } from "./confirmed-source-profile-fixture";

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
const FAKE_REFRESH_VALUE = "1//fake-refresh-token";

const fakeClient = (): GoogleOAuthClient => ({
  exchangeCode: async () => ({
    accessToken: "fake-access-token",
    refreshToken: FAKE_REFRESH_VALUE,
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
      .values({ name: `WS-${randomUUID()}`, plan_tier: "internal" })
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
    await seedConfirmedSourceProfile(handle, scope, actor);
  });
  afterAll(async () => {
    await handle?.end();
  });

  async function isolatedProject(
    label: string,
    options: { readonly confirmed?: boolean } = {},
  ): Promise<{
    scope: ProjectScope;
    siteId: string;
    actorId: string;
  }> {
    const actorId = randomUUID();
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `${label}-${randomUUID()}`, plan_tier: "internal" })
      .returning();
    const created = await createProject(
      { workspaceId: workspace!.id },
      actorId,
      randomUUID(),
      {
        clientName: label,
        projectName: label,
        siteUrl: `https://${label}-${randomUUID()}.example`,
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const projectScope = {
      workspaceId: workspace!.id,
      projectId: created.project.id,
    };
    if (options.confirmed !== false) {
      await seedConfirmedSourceProfile(handle, projectScope, actorId);
    }
    return {
      scope: projectScope,
      siteId: created.project.site.id,
      actorId,
    };
  }

  async function readyGscIntent(project: {
    scope: ProjectScope;
    siteId: string;
    actorId: string;
  }, expiresAt = new Date(Date.now() + 600_000).toISOString()): Promise<string> {
    const state = generateState();
    const intent = await new OAuthIntentsRepository(handle.db).insert({
      workspaceId: project.scope.workspaceId,
      projectId: project.scope.projectId,
      siteId: project.siteId,
      initiatedBy: project.actorId,
      provider: "gsc",
      stateHash: hashState(state),
      pkceVerifierCipher: encryptCredential(
        generateCodeVerifier(),
        credentialKey(),
      ),
      redirectPath: `/p/${project.scope.projectId}/sources`,
      expiresAt,
    });
    await handleGoogleCallback(
      { workspaceId: project.scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client: fakeClient() },
    );
    return intent.id;
  }

  function expectScrubbed(
    intent: OAuthIntentRow | null,
    status: "consumed" | "expired" | "failed",
  ): void {
    expect(intent).toMatchObject({
      status,
      token_cipher: null,
      candidate_properties: null,
    });
    expect(intent?.pkce_verifier_cipher).toEqual(Buffer.alloc(32));
    expect(() =>
      decryptCredential(intent!.pkce_verifier_cipher, credentialKey()),
    ).toThrow();
  }

  async function connectedGscFixture(label: string) {
    const project = await isolatedProject(label);
    const connectedIntentId = await readyGscIntent(project);
    const connected = await connectProjectSource(
      project.scope,
      project.scope.projectId,
      "gsc",
      project.actorId,
      {
        phase: "select_property",
        oauthIntentId: connectedIntentId,
        externalPropertyId: "https://seed.example/",
      },
    );
    if (connected.phase !== "connected" || !connected.source.id) {
      throw new Error("GSC connection was not created");
    }
    const pendingIntentId = await readyGscIntent(project);
    return {
      ...project,
      sourceId: connected.source.id,
      intentIds: [connectedIntentId, pendingIntentId] as const,
    };
  }

  async function disconnectState(fixture: {
    scope: ProjectScope;
    sourceId: string;
    intentIds: readonly string[];
  }) {
    return {
      source: await new SourceConnectionsRepository(handle.db).findById(
        fixture.scope,
        fixture.sourceId,
      ),
      credential: await new SourceCredentialsRepository(
        handle.db,
      ).findByConnection(fixture.scope, fixture.sourceId),
      intents: await Promise.all(
        fixture.intentIds.map((id) =>
          new OAuthIntentsRepository(handle.db).findById(fixture.scope, id),
        ),
      ),
    };
  }

  async function archiveProject(projectScope: ProjectScope): Promise<void> {
    await handle.db
      .update(clientProjects)
      .set({ archived_at: sql`now()` })
      .where(
        and(
          eq(clientProjects.workspace_id, projectScope.workspaceId),
          eq(clientProjects.id, projectScope.projectId),
        ),
      );
  }

  async function projectIntentCount(projectScope: ProjectScope): Promise<number> {
    const rows = await handle.db
      .select({ id: oauthIntents.id })
      .from(oauthIntents)
      .where(
        and(
          eq(oauthIntents.workspace_id, projectScope.workspaceId),
          eq(oauthIntents.project_id, projectScope.projectId),
        ),
      );
    return rows.length;
  }

  async function readyUnconfirmedGscIntent(project: {
    scope: ProjectScope;
    siteId: string;
    actorId: string;
  }): Promise<string> {
    const repo = new OAuthIntentsRepository(handle.db);
    const intent = await repo.insert({
      workspaceId: project.scope.workspaceId,
      projectId: project.scope.projectId,
      siteId: project.siteId,
      initiatedBy: project.actorId,
      provider: "gsc",
      stateHash: hashState(generateState()),
      pkceVerifierCipher: encryptCredential(
        generateCodeVerifier(),
        credentialKey(),
      ),
      redirectPath: `/p/${project.scope.projectId}/sources`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    await repo.setPropertiesReady(intent.id, {
      tokenCipher: encryptCredential(
        encodeCredentialEnvelope({
          accessToken: "unconfirmed-access-token",
          refreshToken: "unconfirmed-refresh-token",
          expiresAt: EXPIRES_AT,
          scope: "https://www.googleapis.com/auth/webmasters.readonly",
        }),
        credentialKey(),
      ),
      candidateProperties: [
        {
          externalPropertyId: "https://seed.example/",
          displayName: "seed.example",
        },
      ],
    });
    return intent.id;
  }

  it("rejects authorize before Product Profile / ICP confirmation and creates no OAuth intent", async () => {
    const project = await isolatedProject("authorize-unconfirmed", {
      confirmed: false,
    });

    await expect(
      connectProjectSource(
        project.scope,
        project.scope.projectId,
        "gsc",
        project.actorId,
        {
          phase: "authorize",
          returnPath: `/p/${project.scope.projectId}/sources`,
        },
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
    await expect(projectIntentCount(project.scope)).resolves.toBe(0);
  });

  it("completes OAuth through the exact optional setup path for a new Product Profile draft", async () => {
    const actorId = randomUUID();
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `onboarding-source-${randomUUID()}`, plan_tier: "internal" })
      .returning();
    const created = await createProject(
      { workspaceId: workspace!.id },
      actorId,
      randomUUID(),
      {
        mode: "product_profile",
        productName: "Optional source product",
        productUrl: "https://optional-source.example.com/product",
        customerModel: "b2b",
        primaryMarket: "US",
        growthObjectives: ["increase_organic_traffic"],
      },
      safeGuard,
      { defaultDeliveryLocale: "en" },
    );
    const projectScope = {
      workspaceId: workspace!.id,
      projectId: created.project.id,
    };
    const returnPath = `/p/${created.project.id}/setup-sources`;

    const authorization = await connectProjectSource(
      projectScope,
      created.project.id,
      "gsc",
      actorId,
      { phase: "authorize", returnPath },
    );
    expect(authorization.phase).toBe("authorization");
    if (authorization.phase !== "authorization") {
      throw new Error("authorization phase missing");
    }
    const state = new URL(authorization.authorizationUrl).searchParams.get(
      "state",
    );
    expect(state).toBeTruthy();

    const callbackLocation = await handleGoogleCallback(
      { workspaceId: workspace!.id },
      { code: "onboarding-code", state, error: null },
      { client: fakeClient() },
    );
    const callbackUrl = new URL(callbackLocation, "https://app.example");
    expect(callbackUrl.pathname).toBe(returnPath);
    expect(callbackUrl.searchParams.get("provider")).toBe("gsc");
    const oauthIntentId = callbackUrl.searchParams.get("oauthIntentId");
    expect(oauthIntentId).toBeTruthy();

    const selection = await connectProjectSource(
      projectScope,
      created.project.id,
      "gsc",
      actorId,
      { phase: "property_selection", oauthIntentId: oauthIntentId! },
    );
    expect(selection).toMatchObject({
      phase: "property_selection",
      provider: "gsc",
    });

    const connected = await connectProjectSource(
      projectScope,
      created.project.id,
      "gsc",
      actorId,
      {
        phase: "select_property",
        oauthIntentId: oauthIntentId!,
        externalPropertyId: "https://seed.example/",
      },
    );
    expect(connected).toMatchObject({
      phase: "connected",
      source: { provider: "gsc" },
    });
    await expect(
      getOnboardingGoogleSourceState(
        { workspaceId: workspace!.id },
        created.project.id,
      ),
    ).resolves.toEqual({ connectedProviders: ["gsc"] });
  });

  it.each(["property_selection", "select_property"] as const)(
    "rejects %s before Product Profile / ICP confirmation without mutating the ready intent",
    async (phase) => {
      const project = await isolatedProject(`unconfirmed-${phase}`, {
        confirmed: false,
      });
      const intentId = await readyUnconfirmedGscIntent(project);
      const repo = new OAuthIntentsRepository(handle.db);
      const before = await repo.findById(project.scope, intentId);

      await expect(
        connectProjectSource(
          project.scope,
          project.scope.projectId,
          "gsc",
          project.actorId,
          phase === "property_selection"
            ? { phase, oauthIntentId: intentId }
            : {
                phase,
                oauthIntentId: intentId,
                externalPropertyId: "https://seed.example/",
              },
        ),
      ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });

      await expect(repo.findById(project.scope, intentId)).resolves.toEqual(
        before,
      );
      const sources = await new SourceConnectionsRepository(
        handle.db,
      ).listByProject(project.scope);
      expect(sources.filter((source) => source.provider === "gsc")).toHaveLength(
        0,
      );
    },
  );

  it("fails and scrubs a legacy callback without contacting Google when Product / ICP is unconfirmed", async () => {
    const project = await isolatedProject("callback-unconfirmed", {
      confirmed: false,
    });
    const state = generateState();
    const repo = new OAuthIntentsRepository(handle.db);
    const intent = await repo.insert({
      workspaceId: project.scope.workspaceId,
      projectId: project.scope.projectId,
      siteId: project.siteId,
      initiatedBy: project.actorId,
      provider: "gsc",
      stateHash: hashState(state),
      pkceVerifierCipher: encryptCredential(
        generateCodeVerifier(),
        credentialKey(),
      ),
      redirectPath: `/p/${project.scope.projectId}/sources`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const client: GoogleOAuthClient = {
      exchangeCode: vi.fn(fakeClient().exchangeCode),
      listProperties: vi.fn(fakeClient().listProperties),
    };

    await expect(
      handleGoogleCallback(
        { workspaceId: project.scope.workspaceId },
        { code: "must-not-be-exchanged", state, error: null },
        { client },
      ),
    ).resolves.toBe(
      `/p/${project.scope.projectId}/sources?error=CONTEXT_INCOMPLETE`,
    );
    expect(client.exchangeCode).not.toHaveBeenCalled();
    expect(client.listProperties).not.toHaveBeenCalled();
    const failed = await repo.findById(project.scope, intent.id);
    expect(failed?.failure_code).toBe("CONTEXT_INCOMPLETE");
    expectScrubbed(failed, "failed");
  });

  it("rejects authorize on an archived project without creating an OAuth intent", async () => {
    const project = await isolatedProject("authorize-archived");
    await archiveProject(project.scope);

    await expect(
      connectProjectSource(
        project.scope,
        project.scope.projectId,
        "gsc",
        project.actorId,
        {
          phase: "authorize",
          returnPath: `/p/${project.scope.projectId}/sources`,
        },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED", status: 422 });
    await expect(projectIntentCount(project.scope)).resolves.toBe(0);
  });

  it("waits behind a concurrent archive and creates no OAuth intent when archival wins", async () => {
    const project = await isolatedProject("authorize-archive-race");
    const result = await archiveWinsProjectRace(
      handle,
      project.scope.projectId,
      () =>
        connectProjectSource(
          project.scope,
          project.scope.projectId,
          "gsc",
          project.actorId,
          {
            phase: "authorize",
            returnPath: `/p/${project.scope.projectId}/sources`,
          },
        ),
    );

    expect(result).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "PROJECT_ARCHIVED" }),
    });
    await expect(projectIntentCount(project.scope)).resolves.toBe(0);
  });

  it("keeps property selection read-only when the project is archived", async () => {
    const project = await isolatedProject("property-selection-archived");
    const expiresAtMs = Date.now() + 60_000;
    const intentId = await readyGscIntent(
      project,
      new Date(expiresAtMs).toISOString(),
    );
    const repo = new OAuthIntentsRepository(handle.db);
    const before = await repo.findById(project.scope, intentId);
    await archiveProject(project.scope);

    await expect(
      connectProjectSource(
        project.scope,
        project.scope.projectId,
        "gsc",
        project.actorId,
        { phase: "property_selection", oauthIntentId: intentId },
        { now: () => expiresAtMs + 1 },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED", status: 422 });
    await expect(repo.findById(project.scope, intentId)).resolves.toEqual(before);
  });

  it("creates no source or credential when selecting on an archived project", async () => {
    const project = await isolatedProject("select-archived");
    const intentId = await readyGscIntent(project);
    const repo = new OAuthIntentsRepository(handle.db);
    const before = await repo.findById(project.scope, intentId);
    await archiveProject(project.scope);

    await expect(
      connectProjectSource(
        project.scope,
        project.scope.projectId,
        "gsc",
        project.actorId,
        {
          phase: "select_property",
          oauthIntentId: intentId,
          externalPropertyId: "https://seed.example/",
        },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED", status: 422 });
    const sources = await new SourceConnectionsRepository(handle.db).listByProject(
      project.scope,
    );
    expect(sources.filter((source) => source.provider === "gsc")).toHaveLength(0);
    const credentials = await handle.db
      .select({ id: sourceCredentials.id })
      .from(sourceCredentials)
      .where(
        and(
          eq(sourceCredentials.workspace_id, project.scope.workspaceId),
          eq(sourceCredentials.project_id, project.scope.projectId),
        ),
      );
    expect(credentials).toHaveLength(0);
    await expect(repo.findById(project.scope, intentId)).resolves.toEqual(before);
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
    expect(intentEnvelope.refreshToken).toBe(FAKE_REFRESH_VALUE);
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
    expect(credEnvelope.refreshToken).toBe(FAKE_REFRESH_VALUE);
    const consumedIntent = await new OAuthIntentsRepository(handle.db).findById(
      scope,
      intent.id,
    );
    expectScrubbed(consumedIntent, "consumed");
  });

  it("persists GA4 timezone and defaults to every property key event without an event picker", async () => {
    const state = generateState();
    const intent = await new OAuthIntentsRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      initiatedBy: actor,
      provider: "ga4",
      stateHash: hashState(state),
      pkceVerifierCipher: encryptCredential(
        generateCodeVerifier(),
        credentialKey(),
      ),
      redirectPath: `/p/${scope.projectId}/sources`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const client: GoogleOAuthClient = {
      exchangeCode: async () => ({
        accessToken: "fake-ga4-access",
        refreshToken: FAKE_REFRESH_VALUE,
        expiresAt: EXPIRES_AT,
        scope: "https://www.googleapis.com/auth/analytics.readonly",
      }),
      listProperties: async () => [
        {
          externalPropertyId: "123456789",
          displayName: "GA4 Shop",
          propertyTimeZone: "Asia/Shanghai",
        },
      ],
    };
    await handleGoogleCallback(
      { workspaceId: scope.workspaceId },
      { code: "auth-code", state, error: null },
      { client },
    );

    const result = await connectProjectSource(
      scope,
      scope.projectId,
      "ga4",
      actor,
      {
        phase: "select_property",
        oauthIntentId: intent.id,
        externalPropertyId: "123456789",
      },
    );
    expect(result.phase).toBe("connected");
    const sourceId = result.phase === "connected" ? result.source.id : null;
    expect(sourceId).toBeTruthy();
    if (!sourceId) throw new Error("GA4 source id was not returned");
    const stored = await new SourceConnectionsRepository(handle.db).findById(
      scope,
      sourceId,
    );
    expect(stored?.config).toMatchObject({
      propertyId: "123456789",
      propertyTimeZone: "Asia/Shanghai",
      keyEventNames: [],
    });
    expect(stored?.limitation).toBe(
      "GA4 organic landing data includes all key events defined by the property.",
    );
  });

  it("serializes concurrent selection so one connection wins and the replay is a stable 409", async () => {
    const project = await isolatedProject("select-race");
    const intentId = await readyGscIntent(project);
    const select = () =>
      connectProjectSource(
        project.scope,
        project.scope.projectId,
        "gsc",
        project.actorId,
        {
          phase: "select_property",
          oauthIntentId: intentId,
          externalPropertyId: "https://seed.example/",
        },
      );

    const results = await Promise.allSettled([select(), select()]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof select>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]!.value.phase).toBe("connected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({
      code: "OAUTH_STATE_REPLAYED",
      status: 409,
    });

    const sources = await new SourceConnectionsRepository(handle.db).listByProject(
      project.scope,
    );
    const gscSources = sources.filter((source) => source.provider === "gsc");
    expect(gscSources).toHaveLength(1);
    await expect(
      new SourceCredentialsRepository(handle.db).findByConnection(
        project.scope,
        gscSources[0]!.id,
      ),
    ).resolves.not.toBeNull();
    await expect(
      new OAuthIntentsRepository(handle.db).findById(project.scope, intentId),
    ).resolves.toMatchObject({ status: "consumed" });
  });

  it("returns a stable OAuth problem when a different intent targets an already-active provider", async () => {
    const project = await isolatedProject("active-provider");
    const firstIntentId = await readyGscIntent(project);
    await connectProjectSource(
      project.scope,
      project.scope.projectId,
      "gsc",
      project.actorId,
      {
        phase: "select_property",
        oauthIntentId: firstIntentId,
        externalPropertyId: "https://seed.example/",
      },
    );
    const competingIntentId = await readyGscIntent(project);

    await expect(
      connectProjectSource(
        project.scope,
        project.scope.projectId,
        "gsc",
        project.actorId,
        {
          phase: "select_property",
          oauthIntentId: competingIntentId,
          externalPropertyId: "https://seed.example/",
        },
      ),
    ).rejects.toMatchObject({
      code: "OAUTH_PROPERTY_INVALID",
      status: 422,
    });

    const sources = await new SourceConnectionsRepository(handle.db).listByProject(
      project.scope,
    );
    expect(sources.filter((source) => source.provider === "gsc")).toHaveLength(1);
    await expect(
      new OAuthIntentsRepository(handle.db).findById(
        project.scope,
        competingIntentId,
      ),
    ).resolves.toMatchObject({ status: "properties_ready" });
  });

  it.each(["property_selection", "select_property"] as const)(
    "atomically expires and scrubs a ready intent touched through %s",
    async (phase) => {
      const project = await isolatedProject(`expired-${phase}`);
      const expiresAtMs = Date.now() + 60_000;
      const intentId = await readyGscIntent(
        project,
        new Date(expiresAtMs).toISOString(),
      );
      const request =
        phase === "property_selection"
          ? ({ phase, oauthIntentId: intentId } as const)
          : ({
              phase,
              oauthIntentId: intentId,
              externalPropertyId: "https://seed.example/",
            } as const);

      await expect(
        connectProjectSource(
          project.scope,
          project.scope.projectId,
          "gsc",
          project.actorId,
          request,
          { now: () => expiresAtMs + 1 },
        ),
      ).rejects.toMatchObject({ code: "OAUTH_STATE_EXPIRED", status: 400 });
      const expired = await new OAuthIntentsRepository(handle.db).findById(
        project.scope,
        intentId,
      );
      expectScrubbed(expired, "expired");
      expect(expired?.failure_code).toBe("OAUTH_STATE_EXPIRED");
    },
  );

  it("batch-scrubs expired ready credentials while leaving a live intent untouched", async () => {
    const expiredProject = await isolatedProject("sweep-expired");
    const activeProject = await isolatedProject("sweep-active");
    const now = Date.now();
    const expiredIntentId = await readyGscIntent(
      expiredProject,
      new Date(now + 60_000).toISOString(),
    );
    const activeIntentId = await readyGscIntent(
      activeProject,
      new Date(now + 3_600_000).toISOString(),
    );

    const scrubbedCount = await new OAuthIntentsRepository(handle.db).scrubExpired(
      new Date(now + 120_000),
    );
    expect(scrubbedCount).toBeGreaterThanOrEqual(1);
    expectScrubbed(
      await new OAuthIntentsRepository(handle.db).findById(
        expiredProject.scope,
        expiredIntentId,
      ),
      "expired",
    );
    const active = await new OAuthIntentsRepository(handle.db).findById(
      activeProject.scope,
      activeIntentId,
    );
    expect(active).toMatchObject({
      status: "properties_ready",
      failure_code: null,
    });
    expect(active?.token_cipher).not.toBeNull();
    expect(active?.candidate_properties).not.toBeNull();
  });

  it("disconnect deletes the credential and scrubs all historical intents for the provider", async () => {
    const project = await isolatedProject("disconnect-scrub");
    const connectedIntentId = await readyGscIntent(project);
    const connected = await connectProjectSource(
      project.scope,
      project.scope.projectId,
      "gsc",
      project.actorId,
      {
        phase: "select_property",
        oauthIntentId: connectedIntentId,
        externalPropertyId: "https://seed.example/",
      },
    );
    if (connected.phase !== "connected" || !connected.source.id) {
      throw new Error("GSC connection was not created");
    }
    const sourceId = connected.source.id;
    const pendingIntentId = await readyGscIntent(project);

    await disconnectProjectSource(
      { workspaceId: project.scope.workspaceId },
      project.scope.projectId,
      sourceId,
    );

    await expect(
      new SourceCredentialsRepository(handle.db).findByConnection(
        project.scope,
        sourceId,
      ),
    ).resolves.toBeNull();
    expectScrubbed(
      await new OAuthIntentsRepository(handle.db).findById(
        project.scope,
        connectedIntentId,
      ),
      "consumed",
    );
    const pending = await new OAuthIntentsRepository(handle.db).findById(
      project.scope,
      pendingIntentId,
    );
    expectScrubbed(pending, "failed");
    expect(pending?.failure_code).toBe("OAUTH_SOURCE_DISCONNECTED");
  });

  it("keeps the default crawl source connected when disconnect is rejected", async () => {
    const project = await isolatedProject("disconnect-crawl");
    const crawl = (
      await new SourceConnectionsRepository(handle.db).listByProject(
        project.scope,
      )
    ).find((source) => source.provider === "crawl");
    if (!crawl) throw new Error("default crawl source missing");

    await expect(
      disconnectProjectSource(
        { workspaceId: project.scope.workspaceId },
        project.scope.projectId,
        crawl.id,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      new SourceConnectionsRepository(handle.db).findById(
        project.scope,
        crawl.id,
      ),
    ).resolves.toEqual(crawl);
  });

  it("returns scoped not-found without changing the project when the source is absent", async () => {
    const project = await isolatedProject("disconnect-missing-source");
    const before = await new SourceConnectionsRepository(
      handle.db,
    ).listByProject(project.scope);

    await expect(
      disconnectProjectSource(
        { workspaceId: project.scope.workspaceId },
        project.scope.projectId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      new SourceConnectionsRepository(handle.db).listByProject(project.scope),
    ).resolves.toEqual(before);
  });

  it("rejects disconnect for an archived project without changing source, credential, or OAuth intents", async () => {
    const fixture = await connectedGscFixture("disconnect-archived");
    const before = await disconnectState(fixture);
    await handle.db
      .update(clientProjects)
      .set({ archived_at: sql`now()` })
      .where(
        and(
          eq(clientProjects.workspace_id, fixture.scope.workspaceId),
          eq(clientProjects.id, fixture.scope.projectId),
        ),
      );

    await expect(
      disconnectProjectSource(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.sourceId,
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });

    await expect(disconnectState(fixture)).resolves.toEqual(before);
  });

  it("waits behind project archival and performs zero disconnect writes when archive commits first", async () => {
    const fixture = await connectedGscFixture("disconnect-archive-race");
    const before = await disconnectState(fixture);
    let archiveLockedResolve!: () => void;
    const archiveLocked = new Promise<void>((resolve) => {
      archiveLockedResolve = resolve;
    });
    let releaseArchiveResolve!: () => void;
    const releaseArchive = new Promise<void>((resolve) => {
      releaseArchiveResolve = resolve;
    });
    const archivePromise = handle.db.transaction(async (tx) => {
      const project = await new ProjectsRepository(tx).findByIdForUpdate(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
      );
      if (!project) throw new Error("archive race project missing");
      archiveLockedResolve();
      await releaseArchive;
      await tx
        .update(clientProjects)
        .set({ archived_at: sql`now()` })
        .where(
          and(
            eq(clientProjects.workspace_id, fixture.scope.workspaceId),
            eq(clientProjects.id, fixture.scope.projectId),
          ),
        );
    });
    await archiveLocked;

    const originalProjectLock = ProjectsRepository.prototype.findByIdForUpdate;
    const originalDisconnect = SourceConnectionsRepository.prototype.disconnect;
    let projectLockAttemptedResolve!: (path: "project") => void;
    const projectLockAttempted = new Promise<"project">((resolve) => {
      projectLockAttemptedResolve = resolve;
    });
    let sourceWriteAttemptedResolve!: (path: "source") => void;
    const sourceWriteAttempted = new Promise<"source">((resolve) => {
      sourceWriteAttemptedResolve = resolve;
    });
    const projectLockSpy = vi
      .spyOn(ProjectsRepository.prototype, "findByIdForUpdate")
      .mockImplementation(async function (
        this: ProjectsRepository,
        lookupScope,
        lookupProjectId,
      ) {
        if (lookupProjectId === fixture.scope.projectId) {
          projectLockAttemptedResolve("project");
        }
        return originalProjectLock.call(this, lookupScope, lookupProjectId);
      });
    const sourceWriteSpy = vi
      .spyOn(SourceConnectionsRepository.prototype, "disconnect")
      .mockImplementation(async function (
        this: SourceConnectionsRepository,
        lookupScope,
        sourceId,
      ) {
        if (sourceId === fixture.sourceId) {
          sourceWriteAttemptedResolve("source");
        }
        return originalDisconnect.call(this, lookupScope, sourceId);
      });

    let firstPath: "project" | "source" | undefined;
    let disconnectResult: PromiseSettledResult<void> | undefined;
    let sourceWriteCalls: number | undefined;
    try {
      const disconnectPromise = disconnectProjectSource(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.sourceId,
      );
      firstPath = await Promise.race([
        projectLockAttempted,
        sourceWriteAttempted,
      ]);
      releaseArchiveResolve();
      await archivePromise;
      [disconnectResult] = await Promise.allSettled([disconnectPromise]);
      sourceWriteCalls = sourceWriteSpy.mock.calls.length;
    } finally {
      releaseArchiveResolve();
      await archivePromise.catch(() => undefined);
      projectLockSpy.mockRestore();
      sourceWriteSpy.mockRestore();
    }

    expect(firstPath).toBe("project");
    expect(sourceWriteCalls).toBe(0);
    expect(disconnectResult).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "PROJECT_ARCHIVED" }),
    });
    await expect(disconnectState(fixture)).resolves.toEqual(before);
  });
});
