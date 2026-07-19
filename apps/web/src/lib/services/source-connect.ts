import {
  OAuthIntentsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  type OAuthIntentRow,
  type SourceConnectionRow,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import {
  encryptCredential,
  decryptCredential,
  encodeCredentialEnvelope,
  decodeCredentialEnvelope,
} from "@sf/sources";
import type { ConnectSourceRequest, OAuthProvider } from "@sf/contracts";
import { getDb } from "@/lib/db";
import { getEnv } from "@/env";
import {
  buildAuthUrl,
  codeChallengeS256,
  generateCodeVerifier,
  generateState,
  GOOGLE_OAUTH_MAX_CANDIDATES,
  googleRedirectUri,
  hashState,
  HttpGoogleOAuthClient,
  type GoogleOAuthClient,
  type GoogleProperty,
  type GoogleProvider,
} from "@/lib/oauth/google";
import {
  toSourceConnectionDto,
  type SourceConnectionDto,
} from "./source-mappers";
import { isPostgresUniqueViolation } from "./db-errors";

/**
 * Google OAuth connect flow (spec §7.4). One endpoint, three phases. The DB
 * stores only a state hash + encrypted PKCE verifier (and, after callback, an
 * encrypted temporary token). A SourceConnection + SourceCredential are created
 * ONLY on successful property selection — never a half-connected row.
 */

const INTENT_TTL_MS = 10 * 60 * 1000;
const KEY_VERSION = "v1";

export type ConnectResult =
  | { phase: "authorization"; authorizationUrl: string; expiresAt: string }
  | {
      phase: "property_selection";
      oauthIntentId: string;
      provider: OAuthProvider;
      properties: { id: string; displayName: string }[];
      expiresAt: string;
    }
  | { phase: "connected"; source: SourceConnectionDto };

export interface ConnectDeps {
  readonly client?: GoogleOAuthClient;
  readonly now?: () => number;
}

function credentialKey(): Buffer {
  return Buffer.from(getEnv().CREDENTIAL_ENCRYPTION_KEY, "base64");
}

function defaultClient(): GoogleOAuthClient {
  const env = getEnv();
  return new HttpGoogleOAuthClient({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
}

function isExpired(row: { expires_at: string }, now: number): boolean {
  return Date.parse(row.expires_at) <= now;
}

/** POST /projects/{projectId}/sources/{provider}/connect — dispatch by phase. */
export async function connectProjectSource(
  scope: WorkspaceScope,
  projectId: string,
  provider: OAuthProvider,
  actorId: string,
  body: ConnectSourceRequest,
  deps: ConnectDeps = {},
): Promise<ConnectResult> {
  switch (body.phase) {
    case "authorize":
      return authorize(
        scope,
        projectId,
        provider,
        actorId,
        body.returnPath,
        deps,
      );
    case "property_selection":
      return propertySelection(
        scope,
        projectId,
        provider,
        body.oauthIntentId,
        deps,
      );
    case "select_property":
      return selectProperty(scope, projectId, provider, actorId, body, deps);
  }
}

async function authorize(
  scope: WorkspaceScope,
  projectId: string,
  provider: OAuthProvider,
  actorId: string,
  returnPath: string,
  deps: ConnectDeps,
): Promise<ConnectResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const now = deps.now ? deps.now() : Date.now();

  if (returnPath !== `/p/${projectId}/sources`) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "OAuth returnPath must target the current project.",
      {
        errors: [
          {
            pointer: "/returnPath",
            code: "project_mismatch",
            message: "returnPath must target the current project.",
          },
        ],
      },
    );
  }

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at)
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
  const site = await new SitesRepository(db).findPrimary(projectScope);
  if (!site)
    throw new ProblemError("NOT_FOUND", "Project has no primary site.");

  const state = generateState();
  const verifier = generateCodeVerifier();
  const challenge = codeChallengeS256(verifier);
  const expiresAt = new Date(now + INTENT_TTL_MS).toISOString();

  const intent = await new OAuthIntentsRepository(db).insert({
    workspaceId: scope.workspaceId,
    projectId,
    siteId: site.id,
    initiatedBy: actorId,
    provider,
    stateHash: hashState(state),
    pkceVerifierCipher: encryptCredential(verifier, credentialKey()),
    redirectPath: returnPath,
    expiresAt,
  });
  void intent;

  const env = getEnv();
  const authorizationUrl = buildAuthUrl({
    provider: provider as GoogleProvider,
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    redirectUri: googleRedirectUri(env.APP_ORIGIN),
    state,
    codeChallenge: challenge,
  });
  return { phase: "authorization", authorizationUrl, expiresAt };
}

async function propertySelection(
  scope: WorkspaceScope,
  projectId: string,
  provider: OAuthProvider,
  oauthIntentId: string,
  deps: ConnectDeps,
): Promise<ConnectResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const now = deps.now ? deps.now() : Date.now();

  const outcome = await db.transaction(async (tx) => {
    const intents = new OAuthIntentsRepository(tx);
    const intent = await intents.findByIdForUpdate(projectScope, oauthIntentId);
    if (!intent || intent.provider !== provider) {
      throw new ProblemError("NOT_FOUND", "OAuth intent not found.");
    }
    if (intent.status === "expired") return { kind: "expired" as const };
    if (intent.status !== "properties_ready") {
      throw new ProblemError(
        "OAUTH_PROPERTY_INVALID",
        "OAuth intent is not ready for selection.",
      );
    }
    if (isExpired(intent, now)) {
      await intents.expireAndScrub(intent.id);
      return { kind: "expired" as const };
    }
    return { kind: "ready" as const, intent };
  });
  if (outcome.kind === "expired") {
    throw new ProblemError("OAUTH_STATE_EXPIRED", "OAuth intent expired.");
  }
  const intent = outcome.intent;

  const properties = (intent.candidate_properties ?? []) as GoogleProperty[];
  return {
    phase: "property_selection",
    oauthIntentId: intent.id,
    provider,
    properties: properties.map((p) => ({
      id: p.externalPropertyId,
      displayName: p.displayName,
    })),
    expiresAt: intent.expires_at,
  };
}

async function selectProperty(
  scope: WorkspaceScope,
  projectId: string,
  provider: OAuthProvider,
  actorId: string,
  body: Extract<ConnectSourceRequest, { phase: "select_property" }>,
  deps: ConnectDeps,
): Promise<ConnectResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const now = deps.now ? deps.now() : Date.now();
  let outcome:
    | { readonly kind: "connected"; readonly connection: SourceConnectionRow }
    | { readonly kind: "expired" };
  try {
    outcome = await db.transaction(async (tx) => {
      const intentsRepo = new OAuthIntentsRepository(tx);
      const intent = await intentsRepo.findByIdForUpdate(
        projectScope,
        body.oauthIntentId,
      );
      if (!intent || intent.provider !== provider) {
        throw new ProblemError("NOT_FOUND", "OAuth intent not found.");
      }
      if (intent.status === "consumed") {
        throw new ProblemError(
          "OAUTH_STATE_REPLAYED",
          "OAuth property selection was already consumed.",
        );
      }
      if (intent.status === "expired") return { kind: "expired" as const };
      if (intent.status !== "properties_ready" || !intent.token_cipher) {
        throw new ProblemError(
          "OAUTH_PROPERTY_INVALID",
          "OAuth intent is not ready for selection.",
        );
      }
      if (isExpired(intent, now)) {
        await intentsRepo.expireAndScrub(intent.id);
        return { kind: "expired" as const };
      }

      const candidates = (intent.candidate_properties ?? []) as GoogleProperty[];
      const chosen = candidates.find(
        (candidate) => candidate.externalPropertyId === body.externalPropertyId,
      );
      if (!chosen) {
        throw new ProblemError(
          "OAUTH_PROPERTY_INVALID",
          "Selected property is not in the candidate list.",
        );
      }

      // Re-encrypt the credential for the connection (the intent cipher is disposable).
      // The intent stored the FULL token envelope (access + refresh + expiry + scope);
      // carry it over verbatim, including the real access-token expiry.
      const key = credentialKey();
      const envelope = decodeCredentialEnvelope(
        decryptCredential(intent.token_cipher, key).toString("utf8"),
      );
      const config: Record<string, unknown> =
        provider === "gsc"
          ? { propertyUrl: chosen.externalPropertyId }
          : {
              propertyId: chosen.externalPropertyId,
              propertyTimeZone: requireGa4PropertyTimeZone(chosen),
              keyEventNames: body.keyEventNames ?? [],
            };
      const scopes = [
        provider === "gsc" ? "webmasters.readonly" : "analytics.readonly",
      ];
      const limitation =
        provider === "gsc"
          ? "Search Console returns top rows by clicks, not the full query universe."
          : body.keyEventNames && body.keyEventNames.length > 0
            ? "GA4 organic landing data for the selected key events."
            : "GA4 connected without key events; conversion metrics will be unavailable.";

      // Different ready intents for the same provider have different row locks.
      // Locking the parent project serializes their active-provider check + insert.
      const project = await new ProjectsRepository(tx).findByIdForUpdate(
        scope,
        projectId,
      );
      if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

      const connectionsRepo = new SourceConnectionsRepository(tx);
      const active = await connectionsRepo.findConnectedByProvider(
        projectScope,
        provider,
      );
      if (active) {
        throw new ProblemError(
          "OAUTH_PROPERTY_INVALID",
          "An active source connection already exists for this provider.",
        );
      }

      const created = await connectionsRepo.insertConnection({
        workspaceId: scope.workspaceId,
        projectId,
        siteId: intent.site_id,
        provider,
        connectionType: "oauth",
        state: "connected",
        externalRef: chosen.externalPropertyId,
        scopes,
        config,
        limitation,
        connectedAt: true,
        createdBy: actorId,
      });
      await new SourceCredentialsRepository(tx).replace({
        workspaceId: scope.workspaceId,
        projectId,
        sourceConnectionId: created.id,
        encryptedPayload: encryptCredential(
          encodeCredentialEnvelope(envelope),
          key,
        ),
        keyVersion: KEY_VERSION,
        expiresAt: envelope.expiresAt,
      });
      await intentsRepo.consume(intent.id);
      return { kind: "connected" as const, connection: created };
    });
  } catch (error) {
    if (isActiveProviderUniqueViolation(error)) {
      throw new ProblemError(
        "OAUTH_PROPERTY_INVALID",
        "An active source connection already exists for this provider.",
      );
    }
    throw error;
  }
  if (outcome.kind === "expired") {
    throw new ProblemError("OAUTH_STATE_EXPIRED", "OAuth intent expired.");
  }
  const connection = outcome.connection;

  return {
    phase: "connected",
    source: toSourceConnectionDto({
      projectId,
      provider,
      connection,
      latestSnapshot: null,
      activeRun: null,
      featureEnabled: true,
      now,
    }),
  };
}

function isActiveProviderUniqueViolation(error: unknown): boolean {
  return isPostgresUniqueViolation(
    error,
    "source_connections_one_active_provider_idx",
  );
}

function requireGa4PropertyTimeZone(property: GoogleProperty): string {
  if (!property.propertyTimeZone) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "GA4 property timezone is unavailable; reconnect the source.",
    );
  }
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: property.propertyTimeZone,
    }).format(0);
  } catch {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "GA4 property timezone is invalid; reconnect the source.",
    );
  }
  return property.propertyTimeZone;
}

// ---------------------------------------------------------------------------
// Callback (GET /oauth/google/callback) — the one GET that consumes external state.
// ---------------------------------------------------------------------------

export interface CallbackParams {
  readonly code: string | null;
  readonly state: string | null;
  readonly error: string | null;
}

/** Returns the same-origin Location to 303 back to (Sources page or error). */
export async function handleGoogleCallback(
  scope: WorkspaceScope,
  params: CallbackParams,
  deps: ConnectDeps = {},
): Promise<string> {
  const { db } = getDb();
  const now = deps.now ? deps.now() : Date.now();

  if (!params.state)
    throw new ProblemError("OAUTH_STATE_INVALID", "Missing OAuth state.");
  const stateHash = hashState(params.state);

  // The callback is workspace-scoped by session; providers share one endpoint so
  // we try both provider values against the state hash.
  const intentsRepo = new OAuthIntentsRepository(db);
  let intent: OAuthIntentRow | null = null;
  for (const provider of ["gsc", "ga4"] as const) {
    intent = await intentsRepo.findLiveByStateHash(
      scope.workspaceId,
      provider,
      stateHash,
    );
    if (intent) break;
  }
  if (!intent)
    throw new ProblemError("OAUTH_STATE_INVALID", "Unknown OAuth state.");

  return db.transaction(async (tx) => {
    // The row lock is the callback claim. It deliberately spans the bounded
    // exchange/list calls: a concurrent callback waits, re-reads the committed
    // ready state, and becomes a harmless replay without exchanging twice.
    const lockedRepo = new OAuthIntentsRepository(tx);
    const locked = await lockedRepo.findByIdForUpdate(
      {
        workspaceId: scope.workspaceId,
        projectId: intent.project_id,
      },
      intent.id,
    );
    if (!locked || locked.provider !== intent.provider) {
      throw new ProblemError("OAUTH_STATE_INVALID", "Unknown OAuth state.");
    }

    // Derive the only allowed same-project redirect instead of trusting legacy
    // rows created before authorize enforced returnPath/project equality.
    const sourcesPath = `/p/${locked.project_id}/sources`;
    const failureLocation = (code: string): string =>
      `${sourcesPath}?error=${encodeURIComponent(code)}`;
    const failInitiated = async (code: string): Promise<string> => {
      await lockedRepo.fail(locked.id, code);
      return failureLocation(code);
    };

    // Replays never mutate an already-ready/consumed/failed intent. In particular,
    // a duplicate callback cannot poison properties_ready before selection.
    if (locked.status === "expired") {
      return failureLocation("OAUTH_STATE_EXPIRED");
    }
    if (locked.status !== "initiated") {
      return failureLocation("OAUTH_STATE_REPLAYED");
    }
    if (isExpired(locked, now)) {
      await lockedRepo.expireAndScrub(locked.id);
      return failureLocation("OAUTH_STATE_EXPIRED");
    }
    if (params.error) return failInitiated("OAUTH_CONSENT_DENIED");
    if (!params.code) return failInitiated("OAUTH_STATE_INVALID");

    try {
      const key = credentialKey();
      const verifier = decryptCredential(
        locked.pkce_verifier_cipher,
        key,
      ).toString("utf8");
      const client = deps.client ?? defaultClient();
      const env = getEnv();
      const tokenSet = await client.exchangeCode({
        code: params.code,
        codeVerifier: verifier,
        redirectUri: googleRedirectUri(env.APP_ORIGIN),
      });
      const properties = await client.listProperties(
        locked.provider as GoogleProvider,
        tokenSet.accessToken,
      );
      if (properties.length > GOOGLE_OAUTH_MAX_CANDIDATES) {
        throw new ProblemError(
          "DEPENDENCY_UNAVAILABLE",
          "Google property candidate limit exceeded.",
        );
      }
      await lockedRepo.setPropertiesReady(locked.id, {
        // Persist the FULL token envelope, not just the access token: Google issues
        // the refresh token only once (first consent), so discarding it here would
        // strand the connection ~1h later (spec §14.3).
        tokenCipher: encryptCredential(
          encodeCredentialEnvelope({
            accessToken: tokenSet.accessToken,
            refreshToken: tokenSet.refreshToken,
            expiresAt: tokenSet.expiresAt,
            scope: tokenSet.scope,
          }),
          key,
        ),
        candidateProperties: properties,
      });
      // The Sources screen needs BOTH params to open the property picker
      // (it reads `oauthIntentId` + `provider` from the URL, spec §7.4).
      return `${sourcesPath}?oauthIntentId=${locked.id}&provider=${locked.provider}`;
    } catch {
      return failInitiated("OAUTH_EXCHANGE_FAILED");
    }
  });
}
