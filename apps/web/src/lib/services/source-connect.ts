import {
  OAuthIntentsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  type Executor,
  type OAuthIntentRow,
  type ProjectRow,
  type SourceConnectionRow,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import {
  encryptCredential,
  decryptCredential,
  encodeCredentialEnvelope,
  decodeCredentialEnvelope,
  type OAuthCredentialEnvelope,
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

function sourcesReturnPath(projectId: string): string {
  return `/p/${projectId}/sources`;
}

function onboardingReturnPath(projectId: string): string {
  return `/p/${projectId}/setup-sources`;
}

function oauthReturnPathKind(
  projectId: string,
  returnPath: string,
): "sources" | "onboarding" | null {
  if (returnPath === sourcesReturnPath(projectId)) return "sources";
  if (returnPath === onboardingReturnPath(projectId)) return "onboarding";
  return null;
}

function safeStoredReturnPath(projectId: string, returnPath: string): string {
  return oauthReturnPathKind(projectId, returnPath) === "onboarding"
    ? onboardingReturnPath(projectId)
    : sourcesReturnPath(projectId);
}

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

export type SourceConnectionGate =
  | "allowed"
  | "product_profile_required"
  | "not_found";

/**
 * Read-side gate for the customer Sources route. OAuth is setup work that uses
 * the customer's confirmed Product/ICP context; a working draft is not enough.
 * Archived projects may still render their existing source history, while every
 * write remains protected by the archived-project checks below.
 */
export async function getSourceConnectionGate(
  scope: WorkspaceScope,
  projectId: string,
): Promise<SourceConnectionGate> {
  const { db } = getDb();
  const projects = new ProjectsRepository(db);
  const project = await projects.findById(scope, projectId);
  if (!project) return "not_found";
  // Archival freezes writes but preserves the customer's historical evidence
  // view. Legacy archived projects may predate the confirmed Product Profile
  // pointer, so do not hide their retained source/snapshot history behind the
  // onboarding gate.
  if (project.archived_at) return "allowed";
  const confirmed = await projects.findConfirmedIcpProfile(scope, projectId);
  return confirmed ? "allowed" : "product_profile_required";
}

export interface OnboardingGoogleSourceState {
  readonly connectedProviders: readonly OAuthProvider[];
}

/**
 * Minimal server-only read model for the optional pre-synthesis connector step.
 * It deliberately exposes no property ids, scopes, credentials, snapshots or
 * retained history. The full Sources projection remains behind confirmation.
 */
export async function getOnboardingGoogleSourceState(
  scope: WorkspaceScope,
  projectId: string,
): Promise<OnboardingGoogleSourceState | null> {
  const { db } = getDb();
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (
    !project ||
    project.archived_at !== null ||
    project.current_icp_profile_id === null
  ) {
    return null;
  }
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const sources = new SourceConnectionsRepository(db);
  const connectedProviders: OAuthProvider[] = [];
  for (const provider of ["gsc", "ga4"] as const) {
    if (await sources.findConnectedByProvider(projectScope, provider)) {
      connectedProviders.push(provider);
    }
  }
  return { connectedProviders };
}

async function assertConfirmedProductProfile(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  project: ProjectRow,
): Promise<void> {
  if (!project.confirmed_icp_profile_id) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "Confirm the Product Profile and ICP before connecting GSC or GA4.",
    );
  }
  const confirmed = await new ProjectsRepository(
    exec,
  ).findConfirmedIcpProfile(scope, projectId);
  if (!confirmed) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The confirmed Product Profile must resolve to a complete immutable version before connecting GSC or GA4.",
    );
  }
}

/**
 * The regular Sources screen still requires confirmed Product/ICP authority.
 * The exact setup return path is the sole exception: a newly created product
 * already has a durable draft identity, so OAuth can be completed before the
 * customer enters the page that starts automatic synthesis.
 */
async function assertOAuthConnectionAuthority(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  project: ProjectRow,
  returnPath: string,
): Promise<void> {
  const kind = oauthReturnPathKind(projectId, returnPath);
  if (kind === "onboarding" && project.current_icp_profile_id !== null) return;
  await assertConfirmedProductProfile(exec, scope, projectId, project);
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

  if (oauthReturnPathKind(projectId, returnPath) === null) {
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

  const state = generateState();
  const verifier = generateCodeVerifier();
  const challenge = codeChallengeS256(verifier);
  const expiresAt = new Date(now + INTENT_TTL_MS).toISOString();
  const pkceVerifierCipher = encryptCredential(verifier, credentialKey());

  await db.transaction(async (tx) => {
    // OAuth writes share the project → child lock order with every other project
    // mutation, so an archive either wins first or waits for this intent to commit.
    const project = await new ProjectsRepository(tx).findByIdForUpdate(
      scope,
      projectId,
    );
    if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
    if (project.archived_at) {
      throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
    }
    await assertOAuthConnectionAuthority(
      tx,
      scope,
      projectId,
      project,
      returnPath,
    );
    const site = await new SitesRepository(tx).findPrimary(projectScope);
    if (!site) {
      throw new ProblemError("NOT_FOUND", "Project has no primary site.");
    }
    await new OAuthIntentsRepository(tx).insert({
      workspaceId: scope.workspaceId,
      projectId,
      siteId: site.id,
      initiatedBy: actorId,
      provider,
      stateHash: hashState(state),
      pkceVerifierCipher,
      redirectPath: returnPath,
      expiresAt,
    });
  });

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
    const project = await new ProjectsRepository(tx).findByIdForUpdate(
      scope,
      projectId,
    );
    if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
    if (project.archived_at) {
      throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
    }
    const intents = new OAuthIntentsRepository(tx);
    const intent = await intents.findByIdForUpdate(projectScope, oauthIntentId);
    if (!intent || intent.provider !== provider) {
      throw new ProblemError("NOT_FOUND", "OAuth intent not found.");
    }
    await assertOAuthConnectionAuthority(
      tx,
      scope,
      projectId,
      project,
      intent.redirect_path,
    );
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
      // Lock the project before any OAuth child. Besides enforcing archived
      // read-only semantics, this serializes active-provider selection.
      const project = await new ProjectsRepository(tx).findByIdForUpdate(
        scope,
        projectId,
      );
      if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
      if (project.archived_at) {
        throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
      }
      const intentsRepo = new OAuthIntentsRepository(tx);
      const intent = await intentsRepo.findByIdForUpdate(
        projectScope,
        body.oauthIntentId,
      );
      if (!intent || intent.provider !== provider) {
        throw new ProblemError("NOT_FOUND", "OAuth intent not found.");
      }
      await assertOAuthConnectionAuthority(
        tx,
        scope,
        projectId,
        project,
        intent.redirect_path,
      );
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
            : "GA4 organic landing data includes all key events defined by the property.";

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

function loadStoredCallbackToken(
  row: Pick<OAuthIntentRow, "token_cipher">,
): OAuthCredentialEnvelope | null {
  if (!row.token_cipher) return null;
  const key = credentialKey();
  return decodeCredentialEnvelope(
    decryptCredential(row.token_cipher, key).toString("utf8"),
  );
}

function isRetryableCallbackError(error: unknown): boolean {
  if (!(error instanceof ProblemError)) return false;
  if (error.code === "RATE_LIMITED") return true;
  if (error.code !== "DEPENDENCY_UNAVAILABLE") return false;
  return /provider request timed out|provider request failed|provider error/i.test(
    error.message,
  );
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

  // The state lookup is workspace-scoped, so its project id is the only redirect
  // target we mint even for legacy rows with a mismatched redirect_path.
  const returnPath = safeStoredReturnPath(
    intent.project_id,
    intent.redirect_path,
  );
  const failureLocation = (code: string): string =>
    `${returnPath}?error=${encodeURIComponent(code)}`;

  return db.transaction(async (tx) => {
    // All OAuth mutations lock project → intent. The project lock also prevents
    // archival from committing while this bounded callback advances the intent.
    const project = await new ProjectsRepository(tx).findByIdForUpdate(
      scope,
      intent.project_id,
    );
    if (!project) {
      throw new ProblemError("OAUTH_STATE_INVALID", "Unknown OAuth state.");
    }
    if (project.archived_at) {
      return failureLocation("PROJECT_ARCHIVED");
    }

    // The intent row lock is the callback claim. A concurrent callback waits,
    // re-reads the committed ready state, and becomes a harmless replay.
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
    try {
      await assertOAuthConnectionAuthority(
        tx,
        scope,
        intent.project_id,
        project,
        locked.redirect_path,
      );
    } catch (error) {
      if (
        error instanceof ProblemError &&
        error.code === "CONTEXT_INCOMPLETE"
      ) {
        // A legacy or concurrently-invalidated OAuth intent must not exchange
        // its authorization code or retain PKCE/token material after the
        // Product/ICP authority disappears.
        return failInitiated("CONTEXT_INCOMPLETE");
      }
      throw error;
    }
    let tokenCipher = locked.token_cipher;
    let tokenEnvelope: OAuthCredentialEnvelope | null;
    try {
      tokenEnvelope = loadStoredCallbackToken(locked);
    } catch {
      return failInitiated("OAUTH_EXCHANGE_FAILED");
    }
    if (tokenEnvelope === null) {
      if (params.error) return failInitiated("OAUTH_CONSENT_DENIED");
      if (!params.code) return failInitiated("OAUTH_STATE_INVALID");

      let key: Buffer;
      let verifier: string;
      try {
        key = credentialKey();
        verifier = decryptCredential(
          locked.pkce_verifier_cipher,
          key,
        ).toString("utf8");
      } catch {
        return failInitiated("OAUTH_EXCHANGE_FAILED");
      }
      const client = deps.client ?? defaultClient();
      const env = getEnv();
      try {
        const tokenSet = await client.exchangeCode({
          code: params.code,
          codeVerifier: verifier,
          redirectUri: googleRedirectUri(env.APP_ORIGIN),
        });
        tokenEnvelope = {
          accessToken: tokenSet.accessToken,
          refreshToken: tokenSet.refreshToken,
          expiresAt: tokenSet.expiresAt,
          scope: tokenSet.scope,
        };
        tokenCipher = encryptCredential(
          encodeCredentialEnvelope(tokenEnvelope),
          key,
        );
        await lockedRepo.setInitiatedToken(locked.id, tokenCipher);
      } catch (error) {
        if (isRetryableCallbackError(error)) {
          return failureLocation("OAUTH_EXCHANGE_FAILED");
        }
        return failInitiated("OAUTH_EXCHANGE_FAILED");
      }
    }

    const client = deps.client ?? defaultClient();
    try {
      const properties = await client.listProperties(
        locked.provider as GoogleProvider,
        tokenEnvelope.accessToken,
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
        tokenCipher: tokenCipher!,
        candidateProperties: properties,
      });
      // The Sources screen needs BOTH params to open the property picker
      // (it reads `oauthIntentId` + `provider` from the URL, spec §7.4).
      return `${returnPath}?oauthIntentId=${locked.id}&provider=${locked.provider}`;
    } catch (error) {
      if (isRetryableCallbackError(error)) {
        return failureLocation("OAUTH_EXCHANGE_FAILED");
      }
      return failInitiated("OAUTH_EXCHANGE_FAILED");
    }
  });
}
