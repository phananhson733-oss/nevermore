import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "offline-google-client";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "offline-google-secret";
process.env["OPENAI_API_KEY"] ??= "sk-test";
process.env["OPENAI_MODEL"] ??= "gpt-test";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AsyncRunsRepository,
  DataSnapshotsRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  ObservationsRepository,
  OAuthIntentsRepository,
  SourceConnectionsRepository,
  type DbHandle,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import { createDbHandle } from "@sf/db/client";
import { oauthIntents, workspaces } from "@sf/db/schema";
import { and, eq } from "drizzle-orm";
import type { Logger } from "@sf/observability";
import {
  MemoryBlobStore,
  computeGa4Window,
  computeGscWindow,
} from "@sf/sources";
import { createCollectionRun } from "@/lib/services/collection";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import {
  connectProjectSource,
  handleGoogleCallback,
} from "@/lib/services/source-connect";
import {
  hashState,
  type GoogleOAuthClient,
  type GoogleProperty,
  type GoogleProvider,
} from "@/lib/oauth/google";
import { seedConfirmedSourceProfile } from "./confirmed-source-profile-fixture";
import {
  runCollection,
  type CollectionWorkerContext,
} from "../../../../../worker/src/collection/run-collection.ts";

/**
 * AC-014/AC-015 acceptance chain. Every canonical write uses a real, disposable
 * PostgreSQL database. Google is represented only by injected deterministic
 * clients/fetch responses; global fetch is blocked so a test can never fall
 * through to live credentials or the public network.
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const FIXED_NOW = new Date("2026-04-15T12:00:00.000Z");
const FIXED_NOW_MS = FIXED_NOW.getTime();
const DAY_MS = 86_400_000;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

const NOOP = (): void => undefined;
const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface ProjectFixture {
  readonly scope: ProjectScope;
  readonly actorId: string;
  readonly siteId: string;
  readonly siteOrigin: string;
}

interface ReadyIntent {
  readonly intentId: string;
  readonly state: string;
  readonly properties: readonly { id: string; displayName: string }[];
}

interface ConnectedSource extends ReadyIntent {
  readonly sourceId: string;
}

type ProviderFetch = typeof globalThis.fetch;

describe("offline Google provider chains against real PostgreSQL (AC-014/AC-015)", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let blockedGlobalFetch: ReturnType<typeof vi.fn<ProviderFetch>>;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Google-chain-${randomUUID()}`, plan_tier: "internal" })
      .returning();
    workspaceId = workspace!.id;
  });

  beforeEach(() => {
    blockedGlobalFetch = vi.fn<ProviderFetch>(async () => {
      throw new Error("live network is disabled in provider-chain tests");
    });
    vi.stubGlobal("fetch", blockedGlobalFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("AC-014 runs authorize → callback → property selection → GSC sync with a 56-day snapshot", async () => {
    const project = await seedProject("gsc-chain");
    const propertyUrl = `${project.siteOrigin}/`;
    const connected = await connectSource(project, "gsc", {
      externalPropertyId: propertyUrl,
      displayName: "GSC chain property",
    });
    const expectedWindow = computeGscWindow(FIXED_NOW);
    const providerFetch = vi.fn<ProviderFetch>(async (input, init) => {
      const url = String(input);
      expect(url).toContain("/searchAnalytics/query");
      expect(readAuthorization(init)).toBe("Bearer gsc-access-fixture");
      const request = JSON.parse(String(init?.body)) as {
        startDate: string;
        endDate: string;
        dimensions: string[];
        dataState: string;
      };
      expect(request).toMatchObject({
        startDate: expectedWindow.startDate,
        endDate: expectedWindow.endDate,
        dimensions: ["date", "page", "query"],
        dataState: "final",
      });
      return Response.json({
        rows: [
          {
            keys: [
              expectedWindow.endDate,
              `${project.siteOrigin}/pricing`,
              "enterprise analytics",
            ],
            clicks: 7,
            impressions: 140,
            position: 2.5,
          },
        ],
      });
    });
    const { context, blobStore } = workerContext(providerFetch);

    const accepted = await createCollectionRun(
      { workspaceId },
      project.scope.projectId,
      project.actorId,
      randomUUID(),
      { provider: "gsc", sourceConnectionId: connected.sourceId },
    );
    await runCollection(context, {
      runId: accepted.run.id,
      workspaceId,
      projectId: project.scope.projectId,
    });

    const snapshot = await snapshotFor(project.scope, connected.sourceId);
    expect(snapshot).toMatchObject({
      provider: "gsc",
      dataset_key: "gsc.page_query_daily.v1",
      availability: "available",
      source_window: {
        start: expectedWindow.startDate,
        end: expectedWindow.endDate,
      },
      row_count: 1,
      summary: {
        keywordLibraryContext: {
          basis: "project_context",
          marketCode: "US",
          languageTag: "en",
        },
      },
    });
    assertInclusive56Days(snapshot.source_window);
    expect(snapshot.limitation).toMatch(/top rows/i);

    const observations = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(project.scope, [snapshot.id]);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      provider: "gsc",
      metric_key: "gsc.page.v1",
      subject_ref: `${project.siteOrigin}/pricing`,
      availability: "available",
      value_json: {
        current28d: { clicks: 7, impressions: 140, position: 2.5 },
      },
    });
    const keywords = await new KeywordsRepository(handle.db).listByProject(
      project.scope,
      { limit: 10, cursor: null },
    );
    expect(keywords.rows).toEqual([
      expect.objectContaining({
        display_keyword: "enterprise analytics",
        normalized_keyword: "enterprise analytics",
        market: "US",
        language_tag: "en",
      }),
    ]);
    await expect(
      new KeywordOccurrencesRepository(handle.db).listForEntity(
        project.scope,
        keywords.rows[0]!.id,
        { limit: 10, cursor: null },
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          data_snapshot_id: snapshot.id,
          normalized_observation_id: observations[0]!.id,
          source_kind: "gsc_top_query",
          scope_basis: "project_context",
          source_pointer: "/valueJson/topQueries/0/query",
        }),
      ],
    });
    await expectRunAndSourceTerminal(
      project.scope,
      accepted.run.id,
      connected.sourceId,
      snapshot.id,
      "completed",
      "available",
    );
    const raw = await readRaw(blobStore, snapshot.raw_object_key);
    expect(raw).toMatchObject({
      propertyUrl,
      window: expectedWindow,
      rowCount: 1,
    });
    expect(JSON.stringify(raw)).not.toContain("gsc-access-fixture");
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(blockedGlobalFetch).not.toHaveBeenCalled();
  });

  it("AC-014 rejects replayed, expired, and wrong-project OAuth state/intent use", async () => {
    const owner = await seedProject("oauth-owner");
    const foreign = await seedProject("oauth-foreign");
    const property: GoogleProperty = {
      externalPropertyId: `${owner.siteOrigin}/`,
      displayName: "Owner GSC property",
    };

    const replayReady = await authorizeToProperties(owner, "gsc", property);
    const replay = await handleGoogleCallback(
      { workspaceId },
      { code: "offline-code", state: replayReady.state, error: null },
      { client: oauthClient("gsc", property), now: () => FIXED_NOW_MS },
    );
    expect(replay).toContain("error=OAUTH_STATE_REPLAYED");

    const expiredAuth = await authorizeOnly(owner, "gsc");
    const expired = await handleGoogleCallback(
      { workspaceId },
      { code: "offline-code", state: expiredAuth.state, error: null },
      {
        client: oauthClient("gsc", property),
        now: () => FIXED_NOW_MS + 10 * 60 * 1000 + 1,
      },
    );
    expect(expired).toContain("error=OAUTH_STATE_EXPIRED");

    const ownerReady = await authorizeToProperties(owner, "gsc", property);
    await expect(
      connectProjectSource(
        foreign.scope,
        foreign.scope.projectId,
        "gsc",
        foreign.actorId,
        {
          phase: "property_selection",
          oauthIntentId: ownerReady.intentId,
        },
        { now: () => FIXED_NOW_MS },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      connectProjectSource(
        foreign.scope,
        foreign.scope.projectId,
        "gsc",
        foreign.actorId,
        {
          phase: "select_property",
          oauthIntentId: ownerReady.intentId,
          externalPropertyId: property.externalPropertyId,
        },
        { now: () => FIXED_NOW_MS },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const foreignSources = await new SourceConnectionsRepository(
      handle.db,
    ).listByProject(foreign.scope);
    expect(foreignSources.filter((source) => source.provider === "gsc")).toEqual(
      [],
    );
    expect(blockedGlobalFetch).not.toHaveBeenCalled();
  });

  it("rejects authorize return paths for foreign or nonexistent projects before creating an intent", async () => {
    const owner = await seedProject("return-path-owner");
    const foreign = await seedProject("return-path-foreign");
    const countOwnerIntents = async (): Promise<number> => {
      const rows = await handle.db
        .select({ id: oauthIntents.id })
        .from(oauthIntents)
        .where(
          and(
            eq(oauthIntents.workspace_id, owner.scope.workspaceId),
            eq(oauthIntents.project_id, owner.scope.projectId),
          ),
        );
      return rows.length;
    };
    const before = await countOwnerIntents();

    for (const returnProjectId of [foreign.scope.projectId, randomUUID()]) {
      await expect(
        connectProjectSource(
          owner.scope,
          owner.scope.projectId,
          "gsc",
          owner.actorId,
          {
            phase: "authorize",
            returnPath: `/p/${returnProjectId}/sources`,
          },
          { now: () => FIXED_NOW_MS },
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        fieldErrors: [
          expect.objectContaining({ pointer: "/returnPath" }),
        ],
      });
    }

    await expect(countOwnerIntents()).resolves.toBe(before);
    expect(blockedGlobalFetch).not.toHaveBeenCalled();
  });

  it("AC-015 persists a mapped GA4 key-event snapshot over the property-timezone 56-day window", async () => {
    const project = await seedProject("ga4-mapped");
    const property: GoogleProperty = {
      externalPropertyId: "24680",
      displayName: "Mapped GA4 property",
      propertyTimeZone: "America/New_York",
    };
    const connected = await connectSource(project, "ga4", property, [
      "purchase",
    ]);
    const expectedWindow = computeGa4Window(
      FIXED_NOW,
      property.propertyTimeZone!,
    );
    const providerFetch = ga4Fetch(project, expectedWindow, true);
    const { context, blobStore } = workerContext(providerFetch);

    const accepted = await createCollectionRun(
      { workspaceId },
      project.scope.projectId,
      project.actorId,
      randomUUID(),
      { provider: "ga4", sourceConnectionId: connected.sourceId },
    );
    await runCollection(context, {
      runId: accepted.run.id,
      workspaceId,
      projectId: project.scope.projectId,
    });

    const snapshot = await snapshotFor(project.scope, connected.sourceId);
    const hostname = new URL(project.siteOrigin).hostname;
    expect(snapshot).toMatchObject({
      provider: "ga4",
      dataset_key: "ga4.organic_landing_daily.v1",
      availability: "available",
      limitation: `GA4 organic landing metrics include only Organic Search traffic on ${hostname} and the selected key events: purchase.`,
      source_window: {
        start: expectedWindow.startDate,
        end: expectedWindow.endDate,
      },
      row_count: 2,
    });
    assertInclusive56Days(snapshot.source_window);
    const [observation] = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(project.scope, [snapshot.id]);
    expect(observation).toMatchObject({
      metric_key: "ga4.landing.v1",
      subject_ref: `${project.siteOrigin}/pricing`,
      availability: "available",
      value_json: {
        sessions: 10,
        engagedSessions: 8,
        engagementRate: 0.8,
        keyEvents: 3,
        keyEventUnavailableReason: null,
      },
    });
    const raw = await readRaw(blobStore, snapshot.raw_object_key);
    expect(raw).toMatchObject({
      propertyId: "properties/24680",
      propertyTimeZone: "America/New_York",
      window: expectedWindow,
      keyEventStatus: { state: "available" },
    });
    await expectRunAndSourceTerminal(
      project.scope,
      accepted.run.id,
      connected.sourceId,
      snapshot.id,
      "completed",
      "available",
    );
    expect(providerFetch).toHaveBeenCalledTimes(3);
    expect(blockedGlobalFetch).not.toHaveBeenCalled();
  });

  it("AC-015 collects every property key event by default and records a real zero when none occur", async () => {
    const project = await seedProject("ga4-unmapped");
    const property: GoogleProperty = {
      externalPropertyId: "13579",
      displayName: "Unmapped GA4 property",
      propertyTimeZone: "Pacific/Auckland",
    };
    const connected = await connectSource(project, "ga4", property, []);
    const expectedWindow = computeGa4Window(
      FIXED_NOW,
      property.propertyTimeZone!,
    );
    const providerFetch = ga4Fetch(project, expectedWindow, false);
    const { context, blobStore } = workerContext(providerFetch);

    const accepted = await createCollectionRun(
      { workspaceId },
      project.scope.projectId,
      project.actorId,
      randomUUID(),
      { provider: "ga4", sourceConnectionId: connected.sourceId },
    );
    await runCollection(context, {
      runId: accepted.run.id,
      workspaceId,
      projectId: project.scope.projectId,
    });

    const snapshot = await snapshotFor(project.scope, connected.sourceId);
    const hostname = new URL(project.siteOrigin).hostname;
    const limitation = `GA4 organic landing metrics include only Organic Search traffic on ${hostname} and all key events defined by the GA4 property.`;
    expect(snapshot).toMatchObject({
      availability: "available",
      limitation,
      source_window: {
        start: expectedWindow.startDate,
        end: expectedWindow.endDate,
      },
      row_count: 1,
    });
    assertInclusive56Days(snapshot.source_window);
    const [observation] = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(project.scope, [snapshot.id]);
    expect(observation).toMatchObject({
      metric_key: "ga4.landing.v1",
      availability: "available",
      value_numeric: null,
      value_text: null,
      value_json: {
        sessions: 10,
        keyEvents: 0,
        keyEventUnavailableReason: null,
      },
      limitation,
    });
    expect(
      (observation!.value_json as { keyEvents: number | null }).keyEvents,
    ).toBe(0);
    const raw = await readRaw(blobStore, snapshot.raw_object_key);
    expect(raw).toMatchObject({
      propertyTimeZone: "Pacific/Auckland",
      window: expectedWindow,
      keyEventRows: [],
      keyEventStatus: { state: "available" },
    });
    await expectRunAndSourceTerminal(
      project.scope,
      accepted.run.id,
      connected.sourceId,
      snapshot.id,
      "completed",
      "available",
    );
    expect(providerFetch).toHaveBeenCalledTimes(3);
    expect(blockedGlobalFetch).not.toHaveBeenCalled();
  });

  async function seedProject(label: string): Promise<ProjectFixture> {
    const actorId = randomUUID();
    const host = `${label}-${randomUUID()}.example`;
    const siteOrigin = `https://${host}`;
    const created = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        clientName: label,
        projectName: label,
        siteUrl: siteOrigin,
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const scope = { workspaceId, projectId: created.project.id };
    await seedConfirmedSourceProfile(handle, scope, actorId);
    return {
      scope,
      actorId,
      siteId: created.project.site.id,
      siteOrigin,
    };
  }

  async function authorizeOnly(
    project: ProjectFixture,
    provider: GoogleProvider,
  ): Promise<{ state: string; intentId: string }> {
    const authorization = await connectProjectSource(
      project.scope,
      project.scope.projectId,
      provider,
      project.actorId,
      {
        phase: "authorize",
        returnPath: `/p/${project.scope.projectId}/sources`,
      },
      { now: () => FIXED_NOW_MS },
    );
    expect(authorization.phase).toBe("authorization");
    if (authorization.phase !== "authorization") {
      throw new Error("authorize did not return an authorization URL");
    }
    const state = new URL(authorization.authorizationUrl).searchParams.get(
      "state",
    );
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (!state) throw new Error("authorization URL did not contain state");
    const intent = await new OAuthIntentsRepository(
      handle.db,
    ).findLiveByStateHash(workspaceId, provider, hashState(state));
    expect(intent).toMatchObject({
      project_id: project.scope.projectId,
      provider,
      status: "initiated",
    });
    expect(intent!.state_hash.equals(Buffer.from(state, "utf8"))).toBe(false);
    return { state, intentId: intent!.id };
  }

  async function authorizeToProperties(
    project: ProjectFixture,
    provider: GoogleProvider,
    property: GoogleProperty,
  ): Promise<ReadyIntent> {
    const authorization = await authorizeOnly(project, provider);
    const location = await handleGoogleCallback(
      { workspaceId },
      { code: "offline-code", state: authorization.state, error: null },
      { client: oauthClient(provider, property), now: () => FIXED_NOW_MS },
    );
    const redirect = new URL(location, process.env["APP_ORIGIN"]);
    expect(redirect.pathname).toBe(`/p/${project.scope.projectId}/sources`);
    expect(redirect.searchParams.get("provider")).toBe(provider);
    expect(redirect.searchParams.get("oauthIntentId")).toBe(
      authorization.intentId,
    );
    const selection = await connectProjectSource(
      project.scope,
      project.scope.projectId,
      provider,
      project.actorId,
      {
        phase: "property_selection",
        oauthIntentId: authorization.intentId,
      },
      { now: () => FIXED_NOW_MS },
    );
    expect(selection.phase).toBe("property_selection");
    if (selection.phase !== "property_selection") {
      throw new Error("callback did not produce property candidates");
    }
    expect(selection.properties).toEqual([
      { id: property.externalPropertyId, displayName: property.displayName },
    ]);
    return {
      ...authorization,
      properties: selection.properties,
    };
  }

  async function connectSource(
    project: ProjectFixture,
    provider: GoogleProvider,
    property: GoogleProperty,
    keyEventNames: readonly string[] = [],
  ): Promise<ConnectedSource> {
    const ready = await authorizeToProperties(project, provider, property);
    const connected = await connectProjectSource(
      project.scope,
      project.scope.projectId,
      provider,
      project.actorId,
      {
        phase: "select_property",
        oauthIntentId: ready.intentId,
        externalPropertyId: property.externalPropertyId,
        ...(provider === "ga4" ? { keyEventNames: [...keyEventNames] } : {}),
      },
      { now: () => FIXED_NOW_MS },
    );
    expect(connected.phase).toBe("connected");
    if (connected.phase !== "connected") {
      throw new Error("property selection did not create a source");
    }
    const consumed = await new OAuthIntentsRepository(handle.db).findById(
      project.scope,
      ready.intentId,
    );
    expect(consumed?.status).toBe("consumed");
    const sourceId = connected.source.id;
    expect(sourceId).not.toBeNull();
    if (!sourceId) throw new Error("connected source did not return an id");
    return { ...ready, sourceId };
  }

  function oauthClient(
    provider: GoogleProvider,
    property: GoogleProperty,
  ): GoogleOAuthClient {
    return {
      exchangeCode: vi.fn(async (input) => {
        expect(input.code).toBe("offline-code");
        expect(input.codeVerifier.length).toBeGreaterThanOrEqual(43);
        return {
          accessToken: `${provider}-access-fixture`,
          refreshToken: `${provider}-refresh-fixture`,
          expiresAt: new Date(FIXED_NOW_MS + 60 * 60 * 1000).toISOString(),
          scope:
            provider === "gsc"
              ? "https://www.googleapis.com/auth/webmasters.readonly"
              : "https://www.googleapis.com/auth/analytics.readonly",
        };
      }),
      listProperties: vi.fn(async (requestedProvider, accessToken) => {
        expect(requestedProvider).toBe(provider);
        expect(accessToken).toBe(`${provider}-access-fixture`);
        return [property];
      }),
    };
  }

  function workerContext(fetch: ProviderFetch): {
    readonly context: CollectionWorkerContext;
    readonly blobStore: MemoryBlobStore;
  } {
    const blobStore = new MemoryBlobStore();
    return {
      blobStore,
      context: {
        db: handle.db,
        boss: {} as PgBoss,
        blobStore,
        credentialKey: Buffer.alloc(32),
        appOrigin: "http://localhost:3000",
        googleOAuth: {
          clientId: "offline-google-client",
          clientSecret: "offline-google-secret",
          fetch,
          now: () => FIXED_NOW,
        },
        openai: { apiKey: "sk-test", model: "gpt-test" },
        findingSummariesEnabled: false,
        logger,
      },
    };
  }

  function ga4Fetch(
    project: ProjectFixture,
    window: { readonly startDate: string; readonly endDate: string },
    hasKeyEventRows: boolean,
  ): ReturnType<typeof vi.fn<ProviderFetch>> {
    return vi.fn<ProviderFetch>(async (input, init) => {
      const url = String(input);
      expect(readAuthorization(init)).toBe("Bearer ga4-access-fixture");
      const request = JSON.parse(String(init?.body)) as {
        dateRanges?: { startDate: string; endDate: string }[];
        dimensions?: { name: string }[];
        metrics?: { name: string }[];
      };
      if (url.endsWith(":checkCompatibility")) {
        return Response.json({});
      }
      expect(url).toContain(":runReport");
      expect(request.dateRanges).toEqual([
        { startDate: window.startDate, endDate: window.endDate },
      ]);
      const dimensions = request.dimensions?.map((dimension) => dimension.name);
      const metrics = request.metrics?.map((metric) => metric.name);
      if (metrics?.includes("keyEvents")) {
        if (!hasKeyEventRows) return Response.json({});
        return Response.json({
          rowCount: 1,
          rows: [
            {
              dimensionValues: [
                { value: window.endDate.replaceAll("-", "") },
                { value: "/pricing" },
              ],
              metricValues: [{ value: "3" }],
            },
          ],
        });
      }
      expect(dimensions).toEqual(["date", "landingPage"]);
      expect(metrics).toEqual([
        "sessions",
        "engagedSessions",
        "engagementRate",
      ]);
      return Response.json({
        rowCount: 1,
        rows: [
          {
            dimensionValues: [
              { value: window.endDate.replaceAll("-", "") },
              { value: "/pricing" },
            ],
            metricValues: [
              { value: "10" },
              { value: "8" },
              { value: "0.8" },
            ],
          },
        ],
      });
    });
  }

  async function snapshotFor(
    scope: ProjectScope,
    sourceId: string,
  ): Promise<NonNullable<Awaited<ReturnType<DataSnapshotsRepository["findLatestByConnection"]>>>> {
    const snapshot = await new DataSnapshotsRepository(
      handle.db,
    ).findLatestByConnection(scope, sourceId);
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("collection did not persist a snapshot");
    return snapshot;
  }

  async function expectRunAndSourceTerminal(
    scope: ProjectScope,
    runId: string,
    sourceId: string,
    snapshotId: string,
    runStatus: string,
    sourceState: string,
  ): Promise<void> {
    await expect(
      new AsyncRunsRepository(handle.db).findById(scope, runId),
    ).resolves.toMatchObject({ status: runStatus });
    await expect(
      new SourceConnectionsRepository(handle.db).findById(scope, sourceId),
    ).resolves.toMatchObject({
      state: sourceState,
      last_successful_snapshot_id: snapshotId,
    });
  }

  async function readRaw(
    blobStore: MemoryBlobStore,
    key: string | null,
  ): Promise<Record<string, unknown>> {
    expect(key).not.toBeNull();
    const raw = key ? await blobStore.get(key) : null;
    expect(raw).not.toBeNull();
    return JSON.parse(raw!.toString("utf8")) as Record<string, unknown>;
  }
});

function readAuthorization(init: RequestInit | undefined): string {
  const headers = init?.headers;
  if (headers instanceof Headers) {
    return headers.get("authorization") ?? "";
  }
  if (Array.isArray(headers)) {
    return (
      headers.find(([name]) => name.toLowerCase() === "authorization")?.[1] ??
      ""
    );
  }
  if (headers && typeof headers === "object") {
    const record = headers as Record<string, string>;
    return record["authorization"] ?? record["Authorization"] ?? "";
  }
  return "";
}

function assertInclusive56Days(window: Record<string, unknown>): void {
  const start = window["start"];
  const end = window["end"];
  expect(typeof start).toBe("string");
  expect(typeof end).toBe("string");
  const days =
    (Date.parse(`${String(end)}T00:00:00.000Z`) -
      Date.parse(`${String(start)}T00:00:00.000Z`)) /
      DAY_MS +
    1;
  expect(days).toBe(56);
}
