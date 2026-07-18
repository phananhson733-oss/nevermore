import {
  OAuthIntentsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  type OAuthIntentRow,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { encryptCredential, decryptCredential } from "@sf/sources";
import type { ConnectSourceRequest, OAuthProvider } from "@sf/contracts";
import { getDb } from "@/lib/db";
import { getEnv } from "@/env";
import {
  buildAuthUrl,
  codeChallengeS256,
  generateCodeVerifier,
  generateState,
  googleRedirectUri,
  hashState,
  HttpGoogleOAuthClient,
  type GoogleOAuthClient,
  type GoogleProperty,
  type GoogleProvider,
} from "@/lib/oauth/google";
import { toSourceConnectionDto, type SourceConnectionDto } from "./source-mappers";

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
      return authorize(scope, projectId, provider, actorId, body.returnPath, deps);
    case "property_selection":
      return propertySelection(scope, projectId, provider, body.oauthIntentId, deps);
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

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
  const site = await new SitesRepository(db).findPrimary(projectScope);
  if (!site) throw new ProblemError("NOT_FOUND", "Project has no primary site.");

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

  const intent = await new OAuthIntentsRepository(db).findById(projectScope, oauthIntentId);
  if (!intent || intent.provider !== provider) {
    throw new ProblemError("NOT_FOUND", "OAuth intent not found.");
  }
  if (intent.status !== "properties_ready") {
    throw new ProblemError("OAUTH_PROPERTY_INVALID", "OAuth intent is not ready for selection.");
  }
  if (isExpired(intent, now)) throw new ProblemError("OAUTH_STATE_EXPIRED", "OAuth intent expired.");

  const properties = (intent.candidate_properties ?? []) as GoogleProperty[];
  return {
    phase: "property_selection",
    oauthIntentId: intent.id,
    provider,
    properties: properties.map((p) => ({ id: p.externalPropertyId, displayName: p.displayName })),
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

  const intentsRepo = new OAuthIntentsRepository(db);
  const intent = await intentsRepo.findById(projectScope, body.oauthIntentId);
  if (!intent || intent.provider !== provider) {
    throw new ProblemError("NOT_FOUND", "OAuth intent not found.");
  }
  if (intent.status !== "properties_ready" || !intent.token_cipher) {
    throw new ProblemError("OAUTH_PROPERTY_INVALID", "OAuth intent is not ready for selection.");
  }
  if (isExpired(intent, now)) throw new ProblemError("OAUTH_STATE_EXPIRED", "OAuth intent expired.");

  const candidates = (intent.candidate_properties ?? []) as GoogleProperty[];
  const chosen = candidates.find((c) => c.externalPropertyId === body.externalPropertyId);
  if (!chosen) {
    throw new ProblemError("OAUTH_PROPERTY_INVALID", "Selected property is not in the candidate list.");
  }

  // Re-encrypt the token for the connection (the intent cipher is disposable).
  const key = credentialKey();
  const tokenPlaintext = decryptCredential(intent.token_cipher, key);
  const config: Record<string, unknown> =
    provider === "gsc"
      ? { propertyUrl: chosen.externalPropertyId }
      : { propertyId: chosen.externalPropertyId, keyEventNames: body.keyEventNames ?? [] };
  const scopes = [provider === "gsc" ? "webmasters.readonly" : "analytics.readonly"];
  const limitation =
    provider === "gsc"
      ? "Search Console returns top rows by clicks, not the full query universe."
      : body.keyEventNames && body.keyEventNames.length > 0
        ? "GA4 organic landing data for the selected key events."
        : "GA4 connected without key events; conversion metrics will be unavailable.";

  const connection = await db.transaction(async (tx) => {
    const created = await new SourceConnectionsRepository(tx).insertConnection({
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
      encryptedPayload: encryptCredential(tokenPlaintext, key),
      keyVersion: KEY_VERSION,
      expiresAt: null,
    });
    await new OAuthIntentsRepository(tx).consume(intent.id);
    return created;
  });

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

  if (!params.state) throw new ProblemError("OAUTH_STATE_INVALID", "Missing OAuth state.");
  const stateHash = hashState(params.state);

  // The callback is workspace-scoped by session; providers share one endpoint so
  // we try both provider values against the state hash.
  const intentsRepo = new OAuthIntentsRepository(db);
  let intent: OAuthIntentRow | null = null;
  for (const provider of ["gsc", "ga4"] as const) {
    intent = await intentsRepo.findLiveByStateHash(scope.workspaceId, provider, stateHash);
    if (intent) break;
  }
  if (!intent) throw new ProblemError("OAUTH_STATE_INVALID", "Unknown OAuth state.");

  const sourcesPath = intent.redirect_path;
  const fail = async (code: string): Promise<string> => {
    await intentsRepo.fail(intent!.id, code);
    return `${sourcesPath}?error=${encodeURIComponent(code)}`;
  };

  if (intent.status !== "initiated") return fail("OAUTH_STATE_REPLAYED");
  if (isExpired(intent, now)) return fail("OAUTH_STATE_EXPIRED");
  if (params.error) return fail("OAUTH_CONSENT_DENIED");
  if (!params.code) return fail("OAUTH_STATE_INVALID");

  try {
    const key = credentialKey();
    const verifier = decryptCredential(intent.pkce_verifier_cipher, key).toString("utf8");
    const client = deps.client ?? defaultClient();
    const env = getEnv();
    const tokenSet = await client.exchangeCode({
      code: params.code,
      codeVerifier: verifier,
      redirectUri: googleRedirectUri(env.APP_ORIGIN),
    });
    const properties = await client.listProperties(
      intent.provider as GoogleProvider,
      tokenSet.accessToken,
    );
    await intentsRepo.setPropertiesReady(intent.id, {
      tokenCipher: encryptCredential(tokenSet.accessToken, key),
      candidateProperties: properties,
    });
    return `${sourcesPath}?oauthIntentId=${intent.id}`;
  } catch {
    return fail("OAUTH_EXCHANGE_FAILED");
  }
}
