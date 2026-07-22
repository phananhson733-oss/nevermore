import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["OPENAI_API_KEY"] ??= "sk-test";
process.env["OPENAI_MODEL"] ??= "gpt-4o-mini";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@sf/contracts";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  asyncRuns,
  collectionRuns,
  normalizedObservations,
  pageSnapshots,
  workspaces,
} from "@sf/db/schema";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  ImportPreviewsRepository,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  contentHash,
  normalizedUrlHash,
  toRunAttempt,
  type CanonicalValue,
  type ObservationInsert,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import {
  BlobObjectAlreadyExistsError,
  CRAWL_BUDGET,
  CRAWL_METHOD_VERSION,
  DATAFORSEO_RANKED_KEYWORDS_LIVE_URL,
  InvalidBlobObjectKeyError,
  LocalFsBlobStore,
  SupabaseStorageError,
  decodeCredentialEnvelope,
  decryptCredential,
  encodeCredentialEnvelope,
  encryptCredential,
  type BlobStore,
  type CrawlEngineOptions,
  type CrawlFetcher,
  type OAuthCredentialEnvelope,
} from "@sf/sources";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import { registerCollectHandlers } from "../../handlers/collect.ts";
import {
  persistCollectionResult,
  type CollectionOutcome,
} from "../persist.ts";
import { runCollection } from "../run-collection.ts";

/**
 * AC-041 — collection runner error/retry + claim discipline (spec §13.1, §13.3).
 * These drive the REAL `runCollection` against a real local Postgres:
 *  - a transient adapter error resets the run to `queued` for pg-boss retry;
 *  - a permanent adapter error ends the run `failed` with a stable code;
 *  - `claim()` is a queued→running winner-only transition, so a redelivered
 *    (already-claimed) job is an idempotent ack and never double-writes.
 * The CSV path is IO-free, so a full success can be driven without the network;
 * the transient case simulates a network failure at the `fetch` boundary only,
 * which the GSC client maps to a transient `NETWORK_ERROR` (spec §7.4).
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface Seed {
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly siteOrigin: string;
  readonly actor: string;
}

type GoogleFetch = typeof globalThis.fetch;

type OAuthWorkerContext = WorkerContext & {
  readonly googleOAuth: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly fetch: GoogleFetch;
    readonly now: () => Date;
  };
};

const OAUTH_NOW = new Date("2026-07-18T08:00:00.000Z");

function oauthContext(
  base: WorkerContext,
  fetchImpl: GoogleFetch,
  logger: Logger = testLogger,
): OAuthWorkerContext {
  return {
    ...base,
    googleOAuth: {
      clientId: "worker-client-id-fixture",
      clientSecret: "worker-client-secret-fixture",
      fetch: fetchImpl,
      now: () => OAUTH_NOW,
    },
    logger,
  };
}

async function withMockedGlobalFetch<T>(
  fetchImpl: GoogleFetch,
  operation: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function overrideBlobStore(
  base: BlobStore,
  overrides: {
    readonly put?: BlobStore["put"];
    readonly get?: BlobStore["get"];
    readonly list?: BlobStore["list"];
  },
): BlobStore {
  return {
    put: (input) =>
      overrides.put ? overrides.put(input) : base.put(input),
    get: (key) => (overrides.get ? overrides.get(key) : base.get(key)),
    signedUrl: (key, ttlSeconds) => base.signedUrl(key, ttlSeconds),
    delete: (key) => base.delete(key),
    list: (input) =>
      overrides.list ? overrides.list(input) : base.list(input),
  };
}

function captureLogger(): { readonly logger: Logger; readonly lines: string[] } {
  const lines: string[] = [];
  const append = (event: string, fields?: Record<string, unknown>): void => {
    lines.push(JSON.stringify({ event, fields }));
  };
  const logger: Logger = {
    context: { service: "worker", environment: "test" },
    child: () => logger,
    debug: append,
    info: append,
    warn: append,
    error: append,
  };
  return { logger, lines };
}

function providerMetricLines(
  lines: readonly string[],
): readonly Record<string, unknown>[] {
  return lines
    .map(
      (line) =>
        JSON.parse(line) as {
          readonly event?: unknown;
          readonly fields?: Record<string, unknown>;
        },
    )
    .filter((line) => line.event === "provider_collection_metric")
    .map((line) => line.fields ?? {});
}

function capturedEventNames(lines: readonly string[]): readonly string[] {
  return lines.map(
    (line) =>
      (JSON.parse(line) as { readonly event?: unknown }).event,
  ).filter((event): event is string => typeof event === "string");
}

describeDb("collection runner (spec §13)", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
    ctx = {
      db: handle.db,
      boss: {} as unknown as PgBoss, // runners under test never enqueue
      blobStore: new LocalFsBlobStore(
        mkdtempSync(path.join(os.tmpdir(), "sf-collection-test-")),
      ),
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: {
        clientId: "worker-client-id-fixture",
        clientSecret: "worker-client-secret-fixture",
      },
      openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
      findingSummariesEnabled: true,
      logger: testLogger,
    };
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("fails closed before transport when a queued crawl run names an unsupported method version", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const crawlConnection = await new SourceConnectionsRepository(
      handle.db,
    ).insertDefaultCrawl({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      createdBy: seed.actor,
    });
    await seedCollectionRun(handle, seed, runId, {
      provider: "crawl",
      operation: "site_graph",
      methodVersion: "crawl.site_graph.v1",
      sourceConnectionId: crawlConnection.id,
      importPreviewId: null,
      requestPayload: {},
    });
    const fetch = vi.fn(async () =>
      new Response("legacy method must not reach transport", { status: 404 }),
    );

    await runCollection(
      {
        ...ctx,
        crawl: {
          fetcher: { fetch },
          engineOptions: {
            guard: async (url: string) => ({
              safe: true as const,
              normalizedUrl: new URL(url).href,
              pinnedIp: "93.184.216.34",
              reason: null,
            }),
          },
        },
      },
      {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
      },
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(await snapshotCount(handle, seed.scope)).toBe(0);
    await expect(
      new AsyncRunsRepository(handle.db).findById(seed.scope, runId),
    ).resolves.toMatchObject({
      status: "failed",
      last_error_code: "INVALID_CONFIGURATION",
    });
    await expect(
      new CollectionRunsRepository(handle.db).findById(runId),
    ).resolves.toMatchObject({ row_count: null });
  });

  it("AC-041: a successful CSV collection writes exactly one snapshot; a redelivered (already-claimed) job does not double-write", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();

    // Seed the raw CSV object + its import preview (the confirm-phase artifacts).
    const rawKey = `csv/${randomUUID()}.csv`;
    const csvText = "keyword,search_volume\nrunning shoes,1000\n";
    await ctx.blobStore.put({
      key: rawKey,
      body: Buffer.from(csvText, "utf8"),
      contentType: "text/csv",
    });
    const preview = await new ImportPreviewsRepository(handle.db).insert({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      createdBy: seed.actor,
      tokenHash: randomBytes(32),
      templateId: "keyword_gap_v1",
      rawObjectKey: rawKey,
      fileChecksum: contentHash({ csv: csvText }),
      rowCount: 1,
      detectedColumns: ["keyword", "search_volume"],
      suggestedMapping: {},
      previewRows: [],
      validationErrors: [],
      validationWarnings: [],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    await seedCollectionRun(handle, seed, runId, {
      provider: "csv",
      operation: "keyword_gap_import",
      methodVersion: "csv.keyword_gap.v1",
      sourceConnectionId: null,
      importPreviewId: preview.id,
      requestPayload: {
        mapping: { keyword: "keyword", searchVolume: "search_volume" },
        marketFallback: "US",
        languageFallback: "en",
      },
    });

    await runCollection(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const afterFirst = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(afterFirst?.status).toBe("completed");
    expect(await snapshotCount(handle, seed.scope)).toBe(1);

    // Redelivery: the run is terminal, so claim() loses and the runner acks
    // without persisting a second snapshot (spec §13.3).
    await runCollection(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });
    expect(await snapshotCount(handle, seed.scope)).toBe(1);
  });

  it("runs the DataForSEO queue through the real HTTP adapter into an immutable snapshot and canonical observations", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const connection = await new SourceConnectionsRepository(
      handle.db,
    ).insertConnection({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      provider: "dataforseo",
      connectionType: "api_key_stub",
      state: "connected",
      externalRef: "example.com",
      config: {
        target: "https://www.example.com/catalog?ignored=true",
        marketCode: "US",
        locationName: "United States",
        languageCode: "en-US",
        maxKeywords: 75,
      },
      limitation: "DataForSEO configured; no snapshot has been collected yet.",
      connectedAt: true,
      createdBy: seed.actor,
    });
    await seedCollectionRun(handle, seed, runId, {
      provider: "dataforseo",
      operation: "keyword_gap_import",
      methodVersion: "dataforseo.ranked_keywords.v1",
      sourceConnectionId: connection.id,
      importPreviewId: null,
      requestPayload: {
        provider: "dataforseo",
        sourceConnectionId: connection.id,
      },
    });

    const fixtureLogin = "dfs-worker-login-fixture";
    const fixturePassword = "dfs-worker-password-fixture";
    const requests: Array<{
      readonly url: string;
      readonly method: string | undefined;
      readonly authorization: string;
      readonly body: unknown;
    }> = [];
    const fetchMock = vi.fn<GoogleFetch>(async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        authorization:
          ((init?.headers ?? {}) as Record<string, string>)["Authorization"] ??
          "",
        body: JSON.parse(String(init?.body ?? "null")) as unknown,
      });
      return jsonResponse({
        status_code: 20_000,
        cost: 0.02,
        tasks: [
          {
            status_code: 20_000,
            cost: 0.02,
            result_count: 1,
            result: [
              {
                total_count: 2,
                items_count: 2,
                items: [
                  {
                    keyword_data: {
                      keyword: "enterprise seo platform",
                      keyword_info: { search_volume: 720 },
                    },
                    ranked_serp_element: {
                      serp_item: {
                        url: "https://example.com/enterprise-seo",
                        rank_group: 6,
                      },
                    },
                  },
                  {
                    keyword_data: {
                      keyword: "seo reporting software",
                      keyword_info: { search_volume: 390 },
                    },
                    ranked_serp_element: {
                      serp_item: {
                        url: "https://example.com/reporting",
                        rank_group: 11,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
    });
    type Delivery = {
      readonly data: {
        readonly runId: string;
        readonly workspaceId: string;
        readonly projectId: string;
        readonly contractVersion: string;
      };
      readonly retryCount: number;
      readonly retryLimit: number;
    };
    type DeliveryHandler = (jobs: Delivery[]) => Promise<void>;
    let dataForSeoHandler: DeliveryHandler | undefined;
    const boss = {
      work: vi.fn(
        async (
          queue: string,
          _options: unknown,
          handler: DeliveryHandler,
        ) => {
          if (queue === "collect.dataforseo") dataForSeoHandler = handler;
          return "worker-id";
        },
      ),
    } as unknown as PgBoss;
    const captured = captureLogger();
    const worker: WorkerContext = {
      ...ctx,
      boss,
      dataForSeo: {
        enabled: true,
        login: fixtureLogin,
        password: fixturePassword,
        maxKeywords: 50,
        fetch: fetchMock,
      },
      logger: captured.logger,
    };
    await registerCollectHandlers(worker);
    if (!dataForSeoHandler) {
      throw new Error("collect.dataforseo handler was not registered");
    }

    await dataForSeoHandler([
      {
        data: {
          runId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
          contractVersion: CONTRACT_VERSION,
        },
        retryCount: 0,
        retryLimit: 3,
      },
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: DATAFORSEO_RANKED_KEYWORDS_LIVE_URL,
      method: "POST",
      authorization: `Basic ${Buffer.from(
        `${fixtureLogin}:${fixturePassword}`,
        "utf8",
      ).toString("base64")}`,
      body: [
        expect.objectContaining({
          target: "example.com",
          location_name: "United States",
          language_code: "en",
          limit: 50,
        }),
      ],
    });
    expect(providerMetricLines(captured.lines)).toEqual([
      {
        provider: "dataforseo",
        outcome: "success",
        errorCode: "NONE",
        requestCount: 1,
        rateLimitCount: 0,
        quotaCount: 0,
        rowCount: 2,
        rowCountAvailable: true,
        urlCount: 0,
        urlCountAvailable: false,
      },
    ]);

    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).toMatchObject({ status: "completed", last_error_code: null });
    const snapshots = await new DataSnapshotsRepository(handle.db).listByProject(
      seed.scope,
      { limit: 10, cursor: null },
    );
    expect(snapshots.rows).toHaveLength(1);
    const snapshot = snapshots.rows[0]!;
    expect(snapshot).toMatchObject({
      collection_run_id: runId,
      provider: "dataforseo",
      dataset_key: "csv.keyword_gap.v1",
      method_version: "dataforseo.ranked_keywords.v1",
      availability: "available",
      row_count: 2,
    });
    expect(snapshot.limitation.trim()).not.toBe("");
    expect(snapshot.raw_object_key).not.toBeNull();
    const rawBytes = await worker.blobStore.get(snapshot.raw_object_key!);
    expect(rawBytes).not.toBeNull();
    const rawText = rawBytes!.toString("utf8");
    expect(rawText).not.toContain(fixtureLogin);
    expect(rawText).not.toContain(fixturePassword);
    expect(rawText.toLowerCase()).not.toContain("authorization");
    expect(JSON.parse(rawText)).toMatchObject({
      schemaVersion: "dataforseo.ranked_keywords.v1",
      request: {
        target: "example.com",
        locationName: "United States",
        languageCode: "en",
        limit: 50,
        marketCode: "US",
      },
      totalCount: 2,
      itemsCount: 2,
    });

    const observations = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(seed.scope, [snapshot.id]);
    expect(observations).toHaveLength(2);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "dataforseo",
          metric_key: "csv.keyword_gap.v1",
          subject_type: "keyword_cluster",
          origin: "vendor_observation",
          availability: "available",
        }),
      ]),
    );
    expect(
      observations.map((row) => row.value_json),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "enterprise seo platform",
          searchVolume: 720,
          currentRank: 6,
          marketCode: "US",
          languageCode: "en",
        }),
      ]),
    );
    await expect(
      new SourceConnectionsRepository(handle.db).findById(
        seed.scope,
        connection.id,
      ),
    ).resolves.toMatchObject({
      state: "available",
      last_successful_snapshot_id: snapshot.id,
    });
    expect(captured.lines.join("\n")).not.toContain(fixtureLogin);
    expect(captured.lines.join("\n")).not.toContain(fixturePassword);
  });

  it("AC-012: an offline crawl fixture flows adapter -> worker -> partial snapshot with pages, robots, sitemap, and link graph observations", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const crawlConnection = await new SourceConnectionsRepository(
      handle.db,
    ).insertDefaultCrawl({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      createdBy: seed.actor,
    });
    await seedCollectionRun(handle, seed, runId, {
      provider: "crawl",
      operation: "site_graph",
      methodVersion: CRAWL_METHOD_VERSION,
      sourceConnectionId: crawlConnection.id,
      importPreviewId: null,
      requestPayload: {},
    });

    const routes = new Map<string, () => Response>([
      [
        `${seed.siteOrigin}/robots.txt`,
        () =>
          new Response(
            [
              "User-agent: *",
              "Disallow: /private/",
              `Sitemap: ${seed.siteOrigin}/sitemap.xml`,
            ].join("\n"),
            { headers: { "content-type": "text/plain" } },
          ),
      ],
      [
        `${seed.siteOrigin}/sitemap.xml`,
        () =>
          new Response(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${seed.siteOrigin}/</loc></url><url><loc>${seed.siteOrigin}/about</loc></url></urlset>`,
            { headers: { "content-type": "application/xml" } },
          ),
      ],
      [
        `${seed.siteOrigin}/`,
        () =>
          new Response(
            `<html><head><title>Fixture home</title></head><body><h1>Home</h1><a href="/about">About us</a><a href="/pricing" rel="nofollow">Pricing</a></body></html>`,
            { headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ],
    ]);
    const calls: string[] = [];
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        calls.push(url);
        const route = routes.get(url);
        return route
          ? route()
          : new Response("fixture route missing", {
              status: 404,
              headers: { "content-type": "text/plain" },
            });
      },
    };
    const engineOptions: CrawlEngineOptions = {
      guard: async (url) => ({
        safe: true,
        normalizedUrl: new URL(url).href,
        pinnedIp: "93.184.216.34",
        reason: null,
      }),
      budget: {
        ...CRAWL_BUDGET,
        maxUrls: 1,
        perHostConcurrency: 1,
        minHostDelayMs: 0,
      },
    };
    const captured = captureLogger();
    const offlineCtx = {
      ...ctx,
      crawl: { fetcher, engineOptions },
      logger: captured.logger,
    };

    await runCollection(offlineCtx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(calls).toEqual([
      `${seed.siteOrigin}/robots.txt`,
      `${seed.siteOrigin}/sitemap.xml`,
      `${seed.siteOrigin}/`,
    ]);
    expect(providerMetricLines(captured.lines)).toEqual([
      {
        provider: "crawl",
        outcome: "success",
        errorCode: "NONE",
        requestCount: 3,
        rateLimitCount: 0,
        quotaCount: 0,
        rowCount: 1,
        rowCountAvailable: true,
        urlCount: 3,
        urlCountAvailable: true,
      },
    ]);
    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run?.status).toBe("partial");
    const collectionRun = await new CollectionRunsRepository(
      handle.db,
    ).findById(runId);
    expect(collectionRun?.stop_reason).toBe("max_urls");

    const snapshots = await new DataSnapshotsRepository(handle.db).listByProject(
      seed.scope,
      { limit: 10, cursor: null },
    );
    expect(snapshots.rows).toHaveLength(1);
    const snapshot = snapshots.rows[0]!;
    expect(snapshot).toMatchObject({
      collection_run_id: runId,
      provider: "crawl",
      dataset_key: "crawl.site_graph.v1",
      availability: "partial",
      row_count: 1,
    });
    expect(snapshot.limitation.trim()).not.toBe("");
    expect(snapshot.raw_object_key).not.toBeNull();
    await expect(
      new SourceConnectionsRepository(handle.db).findById(
        seed.scope,
        crawlConnection.id,
      ),
    ).resolves.toMatchObject({
      state: "partial",
      last_successful_snapshot_id: snapshot.id,
      limitation: snapshot.limitation,
    });

    const rawBytes = await ctx.blobStore.get(snapshot.raw_object_key!);
    expect(rawBytes).not.toBeNull();
    const raw = JSON.parse(rawBytes!.toString("utf8")) as {
      stopReason: string;
      limitation: string;
      pages: Array<{
        subjectUrl: string;
        projection: {
          fetchUrl: string;
          internalOutlinks: Array<{ targetSubjectUrl: string }>;
        };
      }>;
      robots: { fetched: boolean; sitemaps: string[] };
      sitemap: { fetched: boolean; subjectUrls: string[] };
    };
    expect(raw.stopReason).toBe("max_urls");
    expect(raw.limitation.trim()).not.toBe("");
    expect(raw.pages.map((page) => page.subjectUrl)).toEqual([
      `${seed.siteOrigin}/`,
    ]);
    expect(
      raw.pages[0]?.projection.internalOutlinks.map(
        (link) => link.targetSubjectUrl,
      ),
    ).toEqual([
      `${seed.siteOrigin}/about`,
      `${seed.siteOrigin}/pricing`,
    ]);
    expect(raw.robots).toMatchObject({
      fetched: true,
      sitemaps: [`${seed.siteOrigin}/sitemap.xml`],
    });
    expect(raw.sitemap).toMatchObject({
      fetched: true,
      subjectUrls: [`${seed.siteOrigin}/`, `${seed.siteOrigin}/about`],
    });

    // The provider-level raw object is not enough for URL-first review. Every
    // collected page must also have a durable project URL identity and an
    // immutable page extract tied to this exact DataSnapshot, even when the
    // crawl is partial. These rows are what Product Profile synthesis and the
    // Growth Map URL detail may consume without re-reading "latest" data.
    const sitePages = await new SitePagesRepository(handle.db).listByProject(
      seed.scope,
      { limit: 10, cursor: null },
    );
    expect(sitePages.rows).toHaveLength(1);
    const sitePage = sitePages.rows[0]!;
    expect(sitePage).toMatchObject({
      site_id: seed.siteId,
      normalized_url: raw.pages[0]!.projection.fetchUrl,
      normalized_url_hash: normalizedUrlHash(
        raw.pages[0]!.projection.fetchUrl,
      ),
    });

    const pageSnapshot = await new PageSnapshotsRepository(
      handle.db,
    ).findLatestByPage(seed.scope, sitePage.id);
    expect(pageSnapshot).not.toBeNull();
    expect(pageSnapshot).toMatchObject({
      data_snapshot_id: snapshot.id,
      captured_at: snapshot.captured_at,
      extract: {
        subjectUrl: raw.pages[0]!.subjectUrl,
        depth: 0,
        projection: raw.pages[0]!.projection,
      },
    });
    expect(pageSnapshot!.content_hash).toBe(
      contentHash(pageSnapshot!.extract as CanonicalValue),
    );

    const observations = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(seed.scope, [snapshot.id]);
    expect(observations.map((row) => row.metric_key).sort()).toEqual([
      "crawl.page.v1",
      "crawl.robots.v1",
      "crawl.sitemap.v1",
    ]);
    expect(observations.every((row) => row.limitation.trim() !== "")).toBe(
      true,
    );
    const pageObservation = observations.find(
      (row) => row.metric_key === "crawl.page.v1",
    );
    expect(pageObservation?.value_json).toMatchObject({
      internalOutlinks: [
        { targetSubjectUrl: `${seed.siteOrigin}/about` },
        { targetSubjectUrl: `${seed.siteOrigin}/pricing` },
      ],
    });
  });

  it("persists every exact slash variant and retains a cross-origin canonical as evidence without fetching it", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const crawlConnection = await new SourceConnectionsRepository(
      handle.db,
    ).insertDefaultCrawl({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      createdBy: seed.actor,
    });
    await seedCollectionRun(handle, seed, runId, {
      provider: "crawl",
      operation: "site_graph",
      methodVersion: CRAWL_METHOD_VERSION,
      sourceConnectionId: crawlConnection.id,
      importPreviewId: null,
      requestPayload: {},
    });

    const landing = `${seed.siteOrigin}/landing`;
    const landingSlash = `${landing}/`;
    const externalCanonical = "https://publisher.example/original-landing";
    const routes = new Map<string, () => Response>([
      [
        `${seed.siteOrigin}/robots.txt`,
        () =>
          new Response(`Sitemap: ${seed.siteOrigin}/sitemap.xml`, {
            headers: { "content-type": "text/plain" },
          }),
      ],
      [
        `${seed.siteOrigin}/sitemap.xml`,
        () =>
          new Response(
            `<urlset><url><loc>${seed.siteOrigin}/</loc></url><url><loc>${landing}</loc></url><url><loc>${landingSlash}</loc></url></urlset>`,
            { headers: { "content-type": "application/xml" } },
          ),
      ],
      [
        `${seed.siteOrigin}/`,
        () =>
          new Response("<html><head><title>Home</title></head></html>", {
            headers: { "content-type": "text/html" },
          }),
      ],
      [
        landing,
        () =>
          new Response(
            `<html><head><title>No slash</title><link rel="canonical" href="${externalCanonical}"></head></html>`,
            { headers: { "content-type": "text/html" } },
          ),
      ],
      [
        landingSlash,
        () =>
          new Response(
            '<html><head><title>Slash</title><link rel="canonical" href="/landing"></head></html>',
            { headers: { "content-type": "text/html" } },
          ),
      ],
    ]);
    const calls: string[] = [];
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        calls.push(url);
        const route = routes.get(url);
        return route
          ? route()
          : new Response("fixture route missing", { status: 404 });
      },
    };
    const offlineCtx = {
      ...ctx,
      crawl: {
        fetcher,
        engineOptions: {
          guard: async (url: string) => ({
            safe: true as const,
            normalizedUrl: new URL(url).href,
            pinnedIp: "93.184.216.34",
            reason: null,
          }),
          budget: {
            ...CRAWL_BUDGET,
            maxUrls: 3,
            perHostConcurrency: 1,
            minHostDelayMs: 0,
          },
        },
      },
    };

    await runCollection(offlineCtx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(calls).toEqual([
      `${seed.siteOrigin}/robots.txt`,
      `${seed.siteOrigin}/sitemap.xml`,
      `${seed.siteOrigin}/`,
      landing,
      landingSlash,
    ]);
    expect(calls).not.toContain(externalCanonical);

    const snapshots = await new DataSnapshotsRepository(handle.db).listByProject(
      seed.scope,
      { limit: 10, cursor: null },
    );
    expect(snapshots.rows).toHaveLength(1);
    const snapshot = snapshots.rows[0]!;
    expect(snapshot).toMatchObject({
      collection_run_id: runId,
      provider: "crawl",
      availability: "available",
      row_count: 3,
    });

    const rawBytes = await ctx.blobStore.get(snapshot.raw_object_key!);
    expect(rawBytes).not.toBeNull();
    const raw = JSON.parse(rawBytes!.toString("utf8")) as {
      pages: Array<{
        subjectUrl: string;
        projection: { fetchUrl: string; canonicalTarget: string | null };
      }>;
    };
    expect(raw.pages.map((page) => page.projection.fetchUrl)).toEqual([
      `${seed.siteOrigin}/`,
      landing,
      landingSlash,
    ]);
    expect(
      raw.pages.filter((page) => page.subjectUrl === landing),
    ).toHaveLength(2);
    expect(
      raw.pages.find((page) => page.projection.fetchUrl === landing)?.projection
        .canonicalTarget,
    ).toBe(externalCanonical);

    const sitePages = await new SitePagesRepository(handle.db).listByProject(
      seed.scope,
      { limit: 10, cursor: null },
    );
    expect(
      sitePages.rows.map((page) => page.normalized_url).sort(),
    ).toEqual([`${seed.siteOrigin}/`, landing, landingSlash].sort());
    for (const sitePage of sitePages.rows) {
      const pageSnapshot = await new PageSnapshotsRepository(
        handle.db,
      ).findLatestByPage(seed.scope, sitePage.id);
      expect(pageSnapshot).toMatchObject({
        data_snapshot_id: snapshot.id,
        captured_at: snapshot.captured_at,
      });
      expect(pageSnapshot?.canonical_extract).not.toBeNull();
      expect(
        (pageSnapshot?.extract["projection"] as { fetchUrl?: string })
          .fetchUrl,
      ).toBe(sitePage.normalized_url);
    }

    const observations = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(seed.scope, [snapshot.id]);
    const pageObservations = observations.filter(
      (row) => row.metric_key === "crawl.page.v1",
    );
    expect(pageObservations).toHaveLength(3);
    expect(
      pageObservations.filter((row) => row.subject_ref === landing),
    ).toHaveLength(2);
    expect(
      pageObservations.find(
        (row) =>
          (row.value_json as { fetchUrl?: string }).fetchUrl === landing,
      )?.value_json,
    ).toMatchObject({ canonicalTarget: externalCanonical });
  });

  it("rejects a self-consistent foreign-origin crawl before creating any canonical lineage", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const crawlConnection = await new SourceConnectionsRepository(
      handle.db,
    ).insertDefaultCrawl({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      createdBy: seed.actor,
    });
    await seedCollectionRun(handle, seed, runId, {
      provider: "crawl",
      operation: "site_graph",
      methodVersion: CRAWL_METHOD_VERSION,
      sourceConnectionId: crawlConnection.id,
      importPreviewId: null,
      requestPayload: {},
    });
    const claimed = await new AsyncRunsRepository(handle.db).claim(
      seed.scope,
      runId,
    );
    expect(claimed).not.toBeNull();
    const collectionRun = await new CollectionRunsRepository(
      handle.db,
    ).findById(runId);
    expect(collectionRun).not.toBeNull();

    const foreignOrigin = `https://foreign-${randomUUID().slice(0, 8)}.example`;
    const foreignPage = `${foreignOrigin}/pricing`;
    const foreignFetch = `${foreignPage}/`;
    const capturedAt = "2026-07-19T00:00:00.000Z";
    const sourceWindow = { start: capturedAt, end: capturedAt } as const;
    const providerUsage = {
      urlsFetched: 1,
      pagesCollected: 1,
      urlsSkipped: 0,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 0,
      redirectsFollowed: 0,
      bytesFetched: 512,
      robotsFetched: 1,
      sitemapUrlCount: 1,
    };
    const projection = {
      fetchUrl: foreignFetch,
      status: 200,
      finalStatus: 200,
      redirectChain: [],
      canonicalTarget: foreignPage,
      robotsIndexable: true,
      robotsDirectives: ["index", "follow"],
      title: "Foreign pricing",
      metaDescription: null,
      h1: ["Pricing"],
      headings: ["Pricing"],
      wordCount: 1,
      internalOutlinks: [],
      jsonLd: { types: [], errorCount: 0 },
      sitemapMember: true,
      bodyExcerpt: "Pricing",
      paragraphs: ["Pricing"],
      responseMs: 1,
      contentType: "text/html; charset=utf-8",
    } as const;
    const limitation = "foreign-origin persistence boundary fixture";
    const foreignOutcome: CollectionOutcome = {
      availability: "available",
      capturedAt,
      sourceWindow,
      rowCount: 1,
      stopReason: null,
      providerUsage,
      limitation,
      raw: {
        origin: foreignOrigin,
        host: new URL(foreignOrigin).hostname,
        pages: [{ subjectUrl: foreignPage, depth: 0, projection }],
        robots: { fetched: true, groups: [], sitemaps: [] },
        sitemap: {
          fetched: true,
          urlCount: 1,
          subjectUrls: [foreignPage],
        },
        availability: "available",
        capturedAt,
        sourceWindow,
        stopReason: null,
        providerUsage,
        limitation,
      },
    };
    const foreignObservation = {
      metricKey: "crawl.page.v1",
      subjectType: "url",
      subjectRef: foreignPage,
      observedAt: capturedAt,
      availability: "available",
      valueNumeric: null,
      valueText: null,
      valueJson: projection,
      unit: null,
      origin: "direct_public",
      method: "observed",
      grade: "B",
      support: "supports",
      limitation,
    } satisfies ObservationInsert;

    await expect(
      persistCollectionResult(ctx, {
        collectionRun: collectionRun!,
        datasetKey: "crawl.site_graph.v1",
        schemaVersion: "0.2.0",
        actorId: seed.actor,
        startedAtMs: Date.now(),
        attempt: toRunAttempt(claimed!),
        outcome: foreignOutcome,
        observations: [foreignObservation],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Crawl raw payload does not match its collection outcome.",
    });

    expect(await snapshotCount(handle, seed.scope)).toBe(0);
    const sitePages = await new SitePagesRepository(handle.db).listByProject(
      seed.scope,
      { limit: 10, cursor: null },
    );
    expect(sitePages.rows).toHaveLength(0);
    const allPageSnapshots = await handle.db
      .select({ id: pageSnapshots.id, projectId: pageSnapshots.project_id })
      .from(pageSnapshots);
    expect(
      allPageSnapshots.filter(
        (row) => row.projectId === seed.scope.projectId,
      ),
    ).toHaveLength(0);
    const allObservations = await handle.db
      .select({
        id: normalizedObservations.id,
        projectId: normalizedObservations.project_id,
      })
      .from(normalizedObservations);
    expect(
      allObservations.filter(
        (row) => row.projectId === seed.scope.projectId,
      ),
    ).toHaveLength(0);
    await expect(
      new AsyncRunsRepository(handle.db).findById(seed.scope, runId),
    ).resolves.toMatchObject({ status: "running" });
    await expect(
      new CollectionRunsRepository(handle.db).findById(runId),
    ).resolves.toMatchObject({ row_count: null });
  });

  it("AC-041: claim() is a queued→running winner-only transition", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: runId,
      workspace_id: seed.scope.workspaceId,
      project_id: seed.scope.projectId,
      kind: "collection",
      status: "queued",
      initiated_by: seed.actor,
    });

    const runs = new AsyncRunsRepository(handle.db);
    const first = await runs.claim(seed.scope, runId);
    const second = await runs.claim(seed.scope, runId);
    expect(first?.status).toBe("running");
    expect(second).toBeNull();
  });

  it("AC-041: a permanent adapter error terminates the run `failed` with no reset-to-queued", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const connection = await new SourceConnectionsRepository(
      handle.db,
    ).insertConnection({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      provider: "gsc",
      connectionType: "oauth",
      state: "connected",
      externalRef: seed.siteOrigin,
      scopes: ["webmasters.readonly"],
      config: { propertyUrl: seed.siteOrigin },
      limitation: "GSC OAuth connection awaiting credential fixture.",
      connectedAt: true,
      createdBy: seed.actor,
    });
    // The canonical GSC connection is real and provider-matched, but its
    // credential is intentionally absent. That reaches the permanent
    // AUTH_REQUIRED adapter boundary without violating collection provenance.
    await seedCollectionRun(handle, seed, runId, {
      provider: "gsc",
      operation: "search_analytics",
      methodVersion: "gsc.search_analytics.v1",
      sourceConnectionId: connection.id,
      importPreviewId: null,
      requestPayload: {},
    });

    // A permanent error is swallowed into a terminal state, not rethrown.
    await runCollection(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run?.status).toBe("failed");
    expect(run?.last_error_code).toBe("AUTH_REQUIRED");
    expect(await snapshotCount(handle, seed.scope)).toBe(0);
  });

  it("AC-041: a transient adapter error resets the run to `queued` for retry (not terminal-failed)", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const conn = await new SourceConnectionsRepository(
      handle.db,
    ).insertConnection({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      provider: "gsc",
      connectionType: "oauth",
      state: "connected",
      externalRef: seed.siteOrigin,
      config: { propertyUrl: seed.siteOrigin },
      limitation: "GSC OAuth connection (test).",
      connectedAt: true,
      createdBy: seed.actor,
    });
    await new SourceCredentialsRepository(handle.db).replace({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      sourceConnectionId: conn.id,
      encryptedPayload: encryptCredential("test-token", Buffer.alloc(32)),
      keyVersion: "v1",
      expiresAt: null,
    });
    await seedCollectionRun(handle, seed, runId, {
      provider: "gsc",
      operation: "search_analytics",
      methodVersion: "gsc.search_analytics.v1",
      sourceConnectionId: conn.id,
      importPreviewId: null,
      requestPayload: {},
    });

    // Simulate a network failure at the fetch boundary: the GSC client maps a
    // thrown fetch to a transient NETWORK_ERROR (spec §7.4), which the runner
    // must treat as retryable — reset to queued and rethrow for pg-boss.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("simulated network failure");
    }) as typeof globalThis.fetch;
    try {
      await expect(
        runCollection(ctx, {
          runId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
        }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }

    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run?.status).toBe("queued");
    expect(run?.started_at).toBeNull();
    expect(await snapshotCount(handle, seed.scope)).toBe(0);
  });

  it.each([
    ["transient", 429, "RATE_LIMITED"],
    ["permanent", 403, "PERMISSION_DENIED"],
  ] as const)(
    "classifies a resumed stale attempt's %s provider failure only as stale_attempt",
    async (_kind, status, expectedCode) => {
      const seed = await seedProject(handle);
      const runId = randomUUID();
      await seedGoogleCollection(handle, seed, runId, {
        provider: "gsc",
        envelope: {
          accessToken: "access-stale-failure-fixture",
          refreshToken: "refresh-stale-failure-fixture",
          expiresAt: "2026-07-18T10:00:00.000Z",
          scope: "scope.stale.failure.fixture",
        },
      });
      let markProviderStarted: (() => void) | undefined;
      const providerStarted = new Promise<void>((resolve) => {
        markProviderStarted = resolve;
      });
      let releaseProvider: (() => void) | undefined;
      const providerReleased = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      const fetchMock = vi.fn<GoogleFetch>(async () => {
        markProviderStarted?.();
        await providerReleased;
        return jsonResponse({ error: "customer provider error detail" }, status);
      });
      const captured = captureLogger();
      const pending = runCollection(
        oauthContext(ctx, fetchMock, captured.logger),
        {
          runId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
        },
      );
      await providerStarted;

      const runs = new AsyncRunsRepository(handle.db);
      expect(await runs.prepareDelivery(seed.scope, runId, 1)).not.toBeNull();
      const newerClaim = await runs.claim(seed.scope, runId);
      expect(newerClaim?.attempt_count).toBe(2);
      expect(
        await runs.setTerminal(toRunAttempt(newerClaim!), {
          status: "failed",
          lastErrorCode: "NEWER_ATTEMPT_RESULT",
          lastErrorSummary: "newer attempt won the fixture race",
        }),
      ).toBe(true);
      releaseProvider?.();

      await expect(pending).resolves.toBeUndefined();
      expect(providerMetricLines(captured.lines)).toEqual([
        expect.objectContaining({
          provider: "gsc",
          outcome: "stale_attempt",
          errorCode: expectedCode,
          requestCount: 1,
        }),
      ]);
      const events = capturedEventNames(captured.lines);
      expect(events).toContain("collection_skip_stale_attempt");
      expect(events).not.toContain("collection_transient_error");
      expect(events).not.toContain("collection_failed");
      expect(await runs.findById(seed.scope, runId)).toMatchObject({
        status: "failed",
        attempt_count: 2,
        last_error_code: "NEWER_ATTEMPT_RESULT",
      });
    },
  );

  it("labels a real registered handler's non-final pg-boss retry as retry_scheduled", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    await seedGoogleCollection(handle, seed, runId, {
      provider: "gsc",
      envelope: {
        accessToken: "access-handler-retry-fixture",
        refreshToken: "refresh-handler-retry-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.handler.retry.fixture",
      },
    });
    const runs = new AsyncRunsRepository(handle.db);
    expect(await runs.claim(seed.scope, runId)).not.toBeNull();

    type Delivery = {
      readonly data: {
        readonly runId: string;
        readonly workspaceId: string;
        readonly projectId: string;
        readonly contractVersion: string;
      };
      readonly retryCount: number;
      readonly retryLimit: number;
    };
    type DeliveryHandler = (jobs: Delivery[]) => Promise<void>;
    let gscHandler: DeliveryHandler | undefined;
    const boss = {
      work: vi.fn(
        async (
          queue: string,
          _options: unknown,
          handler: DeliveryHandler,
        ) => {
          if (queue === "collect.gsc") gscHandler = handler;
          return "worker-id";
        },
      ),
    } as unknown as PgBoss;
    const fetchMock = vi.fn<GoogleFetch>(async () =>
      jsonResponse({ error: "rate limited customer detail" }, 429),
    );
    const captured = captureLogger();
    const worker = oauthContext(
      { ...ctx, boss },
      fetchMock,
      captured.logger,
    );
    await registerCollectHandlers(worker);
    expect(gscHandler).toEqual(expect.any(Function));
    if (!gscHandler) throw new Error("collect.gsc handler was not registered");

    const job: Delivery = {
      data: {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
        contractVersion: CONTRACT_VERSION,
      },
      retryCount: 1,
      retryLimit: 3,
    };
    await expect(gscHandler([job])).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });

    expect(providerMetricLines(captured.lines)).toEqual([
      expect.objectContaining({
        provider: "gsc",
        outcome: "retry_scheduled",
        errorCode: "RATE_LIMITED",
        requestCount: 1,
        rateLimitCount: 1,
      }),
    ]);
    expect(await runs.findById(seed.scope, runId)).toMatchObject({
      status: "queued",
      attempt_count: 2,
      last_error_code: "RATE_LIMITED",
    });
  });

  it.each([
    ["network", undefined, "NETWORK_ERROR"],
    ["timeout", 408, "TIMEOUT"],
    ["rate limit", 429, "RATE_LIMITED"],
    ["5xx", 503, "UNAVAILABLE"],
  ] as const)(
    "requeues a transient snapshot-storage %s failure and rethrows it",
    async (_label, status, expectedCode) => {
      const seed = await seedProject(handle);
      const runId = randomUUID();
      const { connectionId } = await seedGoogleCollection(handle, seed, runId, {
        provider: "gsc",
        envelope: {
          accessToken: "access-storage-transient-fixture",
          refreshToken: "refresh-storage-transient-fixture",
          expiresAt: "2026-07-18T10:00:00.000Z",
          scope: "scope.storage.transient.fixture",
        },
      });
      const fetchMock = vi.fn<GoogleFetch>(async () =>
        jsonResponse({ rows: [] }),
      );
      let failPut = true;
      let putAttempts = 0;
      const blobStore = overrideBlobStore(ctx.blobStore, {
        async put(input) {
          putAttempts += 1;
          if (failPut) {
            throw new SupabaseStorageError(
              "put",
              input.key,
              status === undefined ? undefined : { status },
            );
          }
          return ctx.blobStore.put(input);
        },
      });
      const worker = oauthContext({ ...ctx, blobStore }, fetchMock);
      const payload = {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
      };

      await expect(runCollection(worker, payload)).rejects.toBeInstanceOf(
        SupabaseStorageError,
      );
      const afterFailure = await new AsyncRunsRepository(handle.db).findById(
        seed.scope,
        runId,
      );
      expect(afterFailure).toMatchObject({
        status: "queued",
        started_at: null,
        last_error_code: expectedCode,
      });
      await expect(
        new SourceConnectionsRepository(handle.db).findById(
          seed.scope,
          connectionId,
        ),
      ).resolves.toMatchObject({ state: "syncing" });
      expect(await snapshotCount(handle, seed.scope)).toBe(0);

      if (status === 503) {
        failPut = false;
        await runCollection(worker, payload);
        expect(putAttempts).toBe(2);
        expect(await snapshotCount(handle, seed.scope)).toBe(1);
        const afterRetry = await new AsyncRunsRepository(handle.db).findById(
          seed.scope,
          runId,
        );
        expect(afterRetry).toMatchObject({
          status: "completed",
          attempt_count: 2,
        });
      }
    },
  );

  it("requeues a transient CSV download failure and retries without duplicating a snapshot", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const rawKey = await seedCsvCollection(
      handle,
      ctx.blobStore,
      seed,
      runId,
    );
    let failGet = true;
    let getAttempts = 0;
    const blobStore = overrideBlobStore(ctx.blobStore, {
      async get(key) {
        if (key === rawKey) {
          getAttempts += 1;
          if (failGet) {
            throw new SupabaseStorageError("get", key, { status: 503 });
          }
        }
        return ctx.blobStore.get(key);
      },
    });
    const worker = { ...ctx, blobStore };
    const payload = {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    };

    await expect(runCollection(worker, payload)).rejects.toBeInstanceOf(
      SupabaseStorageError,
    );
    expect(await runStatus(handle, seed.scope, runId)).toBe("queued");
    expect(await snapshotCount(handle, seed.scope)).toBe(0);

    failGet = false;
    await runCollection(worker, payload);
    expect(getAttempts).toBe(2);
    expect(await runStatus(handle, seed.scope, runId)).toBe("completed");
    expect(await snapshotCount(handle, seed.scope)).toBe(1);
  });

  it.each([
    ["missing object", "missing", "INVALID_RESPONSE"],
    ["invalid object key", "invalid", "INVALID_CONFIGURATION"],
  ] as const)(
    "treats a CSV storage %s as permanent",
    async (_label, failure, expectedCode) => {
      const seed = await seedProject(handle);
      const runId = randomUUID();
      const rawKey = await seedCsvCollection(
        handle,
        ctx.blobStore,
        seed,
        runId,
      );
      const blobStore = overrideBlobStore(ctx.blobStore, {
        async get(key) {
          if (key !== rawKey) return ctx.blobStore.get(key);
          if (failure === "invalid") {
            throw new InvalidBlobObjectKeyError(key);
          }
          return null;
        },
      });

      await runCollection(
        { ...ctx, blobStore },
        {
          runId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
        },
      );

      const run = await new AsyncRunsRepository(handle.db).findById(
        seed.scope,
        runId,
      );
      expect(run).toMatchObject({
        status: "failed",
        last_error_code: expectedCode,
      });
      expect(await snapshotCount(handle, seed.scope)).toBe(0);
    },
  );

  it("treats an append-only snapshot key collision as permanent", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    await seedGoogleCollection(handle, seed, runId, {
      provider: "gsc",
      envelope: {
        accessToken: "access-storage-collision-fixture",
        refreshToken: "refresh-storage-collision-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.storage.collision.fixture",
      },
    });
    const fetchMock = vi.fn<GoogleFetch>(async () => jsonResponse({ rows: [] }));
    const blobStore = overrideBlobStore(ctx.blobStore, {
      async put(input) {
        throw new BlobObjectAlreadyExistsError(input.key);
      },
    });

    await runCollection(oauthContext({ ...ctx, blobStore }, fetchMock), {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "INVALID_RESPONSE",
    });
    expect(await snapshotCount(handle, seed.scope)).toBe(0);
  });

  it("AC-046: a provider permission failure persists a reconnect-required source state and never retries", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const { connectionId } = await seedGoogleCollection(handle, seed, runId, {
      provider: "gsc",
      envelope: {
        accessToken: "access-permission-denied-fixture",
        refreshToken: "refresh-permission-denied-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.permission.fixture",
      },
    });
    const fetchMock = vi.fn<GoogleFetch>(async (input) => {
      if (String(input).includes("/searchAnalytics/query")) {
        return jsonResponse({ error: "forbidden provider detail" }, 403);
      }
      throw new Error(`unexpected mocked URL: ${String(input)}`);
    });
    const attemptLockSpy = vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    );
    const projectLockSpy = vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    );
    const sourceUpdateSpy = vi.spyOn(
      SourceConnectionsRepository.prototype,
      "updateState",
    );
    const terminalSpy = vi.spyOn(
      AsyncRunsRepository.prototype,
      "setTerminal",
    );
    let failureOrder: readonly number[] = [];
    try {
      await withMockedGlobalFetch(fetchMock, () =>
        runCollection(oauthContext(ctx, fetchMock), {
          runId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
        }),
      );
      failureOrder = [
        attemptLockSpy.mock.invocationCallOrder.at(-1)!,
        projectLockSpy.mock.invocationCallOrder.at(-1)!,
        sourceUpdateSpy.mock.invocationCallOrder.at(-1)!,
        terminalSpy.mock.invocationCallOrder.at(-1)!,
      ];
    } finally {
      attemptLockSpy.mockRestore();
      projectLockSpy.mockRestore();
      sourceUpdateSpy.mockRestore();
      terminalSpy.mockRestore();
    }

    expect(failureOrder).toEqual([...failureOrder].sort((a, b) => a - b));

    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).toMatchObject({
      status: "failed",
      attempt_count: 1,
      last_error_code: "PERMISSION_DENIED",
      last_error_summary: "collection failed",
    });
    await expect(
      new SourceConnectionsRepository(handle.db).findById(
        seed.scope,
        connectionId,
      ),
    ).resolves.toMatchObject({
      state: "permission_denied",
      limitation:
        "Google provider permission was denied. Disconnect and reconnect a property you can access.",
    });
    expect(await snapshotCount(handle, seed.scope)).toBe(0);
  });

  it("terminalizes an accepted provider failure after archive without changing its source projection", async () => {
    const seed = await seedProject(handle);
    const projects = new ProjectsRepository(handle.db);
    await projects.setStage(
      { workspaceId: seed.scope.workspaceId },
      seed.scope.projectId,
      "collecting",
    );
    const runId = randomUUID();
    const { connectionId } = await seedGoogleCollection(handle, seed, runId, {
      provider: "gsc",
      envelope: {
        accessToken: "access-archived-permission-fixture",
        refreshToken: "refresh-archived-permission-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.archived.permission.fixture",
      },
    });
    await handle.pool.query(
      `update app.client_projects
          set archived_at = now()
        where workspace_id = $1
          and id = $2`,
      [seed.scope.workspaceId, seed.scope.projectId],
    );
    const sources = new SourceConnectionsRepository(handle.db);
    const sourceBefore = await sources.findById(seed.scope, connectionId);
    const fetchMock = vi.fn<GoogleFetch>(async (input) => {
      if (String(input).includes("/searchAnalytics/query")) {
        return jsonResponse({ error: "forbidden provider detail" }, 403);
      }
      throw new Error(`unexpected mocked URL: ${String(input)}`);
    });

    await withMockedGlobalFetch(fetchMock, () =>
      runCollection(oauthContext(ctx, fetchMock), {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
      }),
    );

    await expect(
      new AsyncRunsRepository(handle.db).findById(seed.scope, runId),
    ).resolves.toMatchObject({
      status: "failed",
      last_error_code: "PERMISSION_DENIED",
      completed_at: expect.any(String),
    });
    await expect(sources.findById(seed.scope, connectionId)).resolves.toEqual(
      sourceBefore,
    );
    await expect(
      projects.findById(
        { workspaceId: seed.scope.workspaceId },
        seed.scope.projectId,
      ),
    ).resolves.toMatchObject({
      stage: "collecting",
      archived_at: expect.any(String),
    });
    expect(await snapshotCount(handle, seed.scope)).toBe(0);
  });

  it("AC-046: a provider rate limit persists queued retry metadata and keeps the source syncing", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const { connectionId } = await seedGoogleCollection(handle, seed, runId, {
      provider: "gsc",
      envelope: {
        accessToken: "access-rate-limit-fixture",
        refreshToken: "refresh-rate-limit-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.rate.fixture",
      },
    });
    const fetchMock = vi.fn<GoogleFetch>(async (input) => {
      if (String(input).includes("/searchAnalytics/query")) {
        return jsonResponse({ error: "rate limited provider detail" }, 429);
      }
      throw new Error(`unexpected mocked URL: ${String(input)}`);
    });
    const captured = captureLogger();
    const attemptLockSpy = vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    );
    const projectLockSpy = vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    );
    const sourceUpdateSpy = vi.spyOn(
      SourceConnectionsRepository.prototype,
      "updateState",
    );
    const resetSpy = vi.spyOn(
      AsyncRunsRepository.prototype,
      "resetToQueued",
    );
    let retryOrder: readonly number[] = [];
    try {
      await expect(
        withMockedGlobalFetch(fetchMock, () =>
          runCollection(oauthContext(ctx, fetchMock, captured.logger), {
            runId,
            workspaceId: seed.scope.workspaceId,
            projectId: seed.scope.projectId,
          }),
        ),
      ).rejects.toMatchObject({ code: "RATE_LIMITED" });
      retryOrder = [
        attemptLockSpy.mock.invocationCallOrder.at(-1)!,
        projectLockSpy.mock.invocationCallOrder.at(-1)!,
        sourceUpdateSpy.mock.invocationCallOrder.at(-1)!,
        resetSpy.mock.invocationCallOrder.at(-1)!,
      ];
    } finally {
      attemptLockSpy.mockRestore();
      projectLockSpy.mockRestore();
      sourceUpdateSpy.mockRestore();
      resetSpy.mockRestore();
    }

    expect(retryOrder).toEqual([...retryOrder].sort((a, b) => a - b));

    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).toMatchObject({
      status: "queued",
      started_at: null,
      last_error_code: "RATE_LIMITED",
      last_error_summary:
        "Provider rate limit reached; automatic retry is scheduled.",
    });
    await expect(
      new SourceConnectionsRepository(handle.db).findById(
        seed.scope,
        connectionId,
      ),
    ).resolves.toMatchObject({
      state: "syncing",
      limitation: "Provider rate limit reached; automatic retry is scheduled.",
    });
    expect(await snapshotCount(handle, seed.scope)).toBe(0);
    expect(providerMetricLines(captured.lines)).toEqual([
      {
        provider: "gsc",
        outcome: "transient_failure",
        errorCode: "RATE_LIMITED",
        requestCount: 1,
        rateLimitCount: 1,
        quotaCount: 0,
        rowCount: 0,
        rowCountAvailable: false,
        urlCount: 0,
        urlCountAvailable: false,
      },
    ]);
  });

  it("marks a final provider rate-limit delivery as retry exhausted without persisting delivery metadata", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    await seedGoogleCollection(handle, seed, runId, {
      provider: "gsc",
      envelope: {
        accessToken: "access-rate-exhausted-fixture",
        refreshToken: "refresh-rate-exhausted-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.rate.exhausted.fixture",
      },
    });
    const fetchMock = vi.fn<GoogleFetch>(async () =>
      jsonResponse({ error: "rate exhausted customer detail" }, 429),
    );
    const captured = captureLogger();

    await expect(
      runCollection(
        oauthContext(ctx, fetchMock, captured.logger),
        {
          runId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
        },
        { retryCount: 3, retryLimit: 3 },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });

    expect(providerMetricLines(captured.lines)).toEqual([
      expect.objectContaining({
        provider: "gsc",
        outcome: "retry_exhausted",
        errorCode: "RATE_LIMITED",
        requestCount: 1,
        rateLimitCount: 1,
      }),
    ]);
    const canonical = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(canonical?.request_payload).not.toHaveProperty("retryCount");
    expect(canonical?.request_payload).not.toHaveProperty("retryLimit");
  });

  it("refreshes an access token inside the expiry window before calling GSC and persists the complete rotated envelope", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const originalEnvelope: OAuthCredentialEnvelope = {
      accessToken: "access-expiring-fixture",
      refreshToken: "refresh-before-fixture",
      expiresAt: "2026-07-18T08:01:00.000Z",
      scope: "scope.before.fixture",
    };
    const { connectionId } = await seedGoogleCollection(handle, seed, runId, {
      provider: "gsc",
      envelope: originalEnvelope,
    });

    const calls: Array<{ readonly url: string; readonly authorization: string }> =
      [];
    const fetchMock = vi.fn<GoogleFetch>(async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        authorization:
          ((init?.headers ?? {}) as Record<string, string>)["Authorization"] ??
          ((init?.headers ?? {}) as Record<string, string>)["authorization"] ??
          "",
      });
      if (url === "https://oauth2.googleapis.com/token") {
        return jsonResponse({
          access_token: "access-refreshed-fixture",
          refresh_token: "refresh-rotated-fixture",
          expires_in: 3_600,
          scope: "scope.rotated.fixture",
        });
      }
      if (url.includes("/searchAnalytics/query")) {
        return jsonResponse({ rows: [] });
      }
      throw new Error(`unexpected mocked URL: ${url}`);
    });
    const captured = captureLogger();
    const worker = oauthContext(ctx, fetchMock, captured.logger);

    await withMockedGlobalFetch(fetchMock, () =>
      runCollection(worker, {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
      }),
    );

    expect(calls.map((call) => call.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      expect.stringContaining("/searchAnalytics/query"),
    ]);
    expect(calls[1]?.authorization).toBe(
      "Bearer access-refreshed-fixture",
    );
    expect(await runStatus(handle, seed.scope, runId)).toBe("completed");
    const storedCredential = await new SourceCredentialsRepository(
      handle.db,
    ).findByConnection(seed.scope, connectionId);
    expect(storedCredential).toMatchObject({
      cipher_version: 1,
      key_version: "v1",
    });
    expect(new Date(storedCredential!.expires_at!).toISOString()).toBe(
      "2026-07-18T09:00:00.000Z",
    );
    expect(
      await loadStoredEnvelope(handle, seed.scope, connectionId),
    ).toEqual({
      accessToken: "access-refreshed-fixture",
      refreshToken: "refresh-rotated-fixture",
      expiresAt: "2026-07-18T09:00:00.000Z",
      scope: "scope.rotated.fixture",
    });
    expect(providerMetricLines(captured.lines)).toEqual([
      {
        provider: "gsc",
        outcome: "success",
        errorCode: "NONE",
        requestCount: 2,
        rateLimitCount: 0,
        quotaCount: 0,
        rowCount: 0,
        rowCountAvailable: true,
        urlCount: 0,
        urlCountAvailable: false,
      },
    ]);
  });

  it("does not persist an in-flight Google result after its source is disconnected", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const { connectionId } = await seedGoogleCollection(handle, seed, runId, {
      provider: "gsc",
      envelope: {
        accessToken: "access-in-flight-fixture",
        refreshToken: "refresh-in-flight-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.in-flight.fixture",
      },
    });

    let markProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    let releaseProvider: (() => void) | undefined;
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const fetchMock = vi.fn<GoogleFetch>(async (input) => {
      if (!String(input).includes("/searchAnalytics/query")) {
        throw new Error(`unexpected mocked URL: ${String(input)}`);
      }
      markProviderStarted?.();
      await providerReleased;
      return jsonResponse({ rows: [] });
    });
    const worker = oauthContext(ctx, fetchMock);

    const pendingCollection = withMockedGlobalFetch(fetchMock, () =>
      runCollection(worker, {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
      }),
    );
    await providerStarted;

    // The worker already decrypted the token. Commit the same credential erase +
    // disconnect mutation that the Sources API performs before the HTTP result returns.
    await handle.db.transaction(async (tx) => {
      await new SourceCredentialsRepository(tx).deleteByConnection(connectionId);
      await new SourceConnectionsRepository(tx).disconnect(
        seed.scope,
        connectionId,
      );
    });
    releaseProvider?.();

    await expect(pendingCollection).resolves.toBeUndefined();
    await expect(
      new SourceCredentialsRepository(handle.db).findByConnection(
        seed.scope,
        connectionId,
      ),
    ).resolves.toBeNull();
    await expect(
      new SourceConnectionsRepository(handle.db).findById(
        seed.scope,
        connectionId,
      ),
    ).resolves.toMatchObject({
      state: "disconnected",
      last_successful_snapshot_id: null,
    });
    const disconnected = await new SourceConnectionsRepository(
      handle.db,
    ).findById(seed.scope, connectionId);
    expect(disconnected?.disconnected_at).not.toBeNull();
    expect(await snapshotCount(handle, seed.scope)).toBe(0);
    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "AUTH_REQUIRED",
      last_error_summary: "collection failed",
    });
    expect(run?.completed_at).not.toBeNull();
    const detail = await new CollectionRunsRepository(handle.db).findById(runId);
    expect(detail?.row_count).toBeNull();
  });

  it("refreshes on a GA4 401, retries the API once, and preserves omitted refresh fields", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const { connectionId } = await seedGoogleCollection(handle, seed, runId, {
      provider: "ga4",
      envelope: {
        accessToken: "access-rejected-fixture",
        refreshToken: "refresh-preserved-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.preserved.fixture",
      },
    });
    const bearerCalls: string[] = [];
    let refreshCalls = 0;
    const fetchMock = vi.fn<GoogleFetch>(async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        refreshCalls += 1;
        return jsonResponse({
          access_token: "access-recovered-fixture",
          expires_in: 1_800,
        });
      }
      if (url.includes("analyticsdata.googleapis.com")) {
        const authorization =
          ((init?.headers ?? {}) as Record<string, string>)["authorization"] ??
          "";
        bearerCalls.push(authorization);
        return authorization === "Bearer access-rejected-fixture"
          ? jsonResponse({ error: "expired" }, 401)
          : jsonResponse({ rows: [], rowCount: 0 });
      }
      throw new Error(`unexpected mocked URL: ${url}`);
    });
    const worker = oauthContext(ctx, fetchMock);

    await withMockedGlobalFetch(fetchMock, () =>
      runCollection(worker, {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
      }),
    );

    expect(refreshCalls).toBe(1);
    expect(bearerCalls).toEqual([
      "Bearer access-rejected-fixture",
      "Bearer access-recovered-fixture",
    ]);
    expect(await runStatus(handle, seed.scope, runId)).toBe("partial");
    expect(
      await loadStoredEnvelope(handle, seed.scope, connectionId),
    ).toEqual({
      accessToken: "access-recovered-fixture",
      refreshToken: "refresh-preserved-fixture",
      expiresAt: "2026-07-18T08:30:00.000Z",
      scope: "scope.preserved.fixture",
    });
  });

  it("fails an old GA4 connection that has no property timezone instead of assuming one", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    await seedGoogleCollection(handle, seed, runId, {
      provider: "ga4",
      omitPropertyTimeZone: true,
      envelope: {
        accessToken: "access-timezone-fixture",
        refreshToken: "refresh-timezone-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.timezone.fixture",
      },
    });
    const fetchMock = vi.fn<GoogleFetch>(async () => {
      throw new Error("GA4 API must not run without a property timezone");
    });

    await runCollection(oauthContext(ctx, fetchMock), {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "INVALID_CONFIGURATION",
    });
  });

  it("serializes concurrent 401 refreshes for the same connection across collection runs", async () => {
    const seed = await seedProject(handle);
    const firstRunId = randomUUID();
    const secondRunId = randomUUID();
    const { connectionId } = await seedGoogleCollection(
      handle,
      seed,
      firstRunId,
      {
        provider: "gsc",
        envelope: {
          accessToken: "access-concurrent-old-fixture",
          refreshToken: "refresh-concurrent-fixture",
          expiresAt: "2026-07-18T10:00:00.000Z",
          scope: "scope.concurrent.fixture",
        },
      },
    );
    await seedCollectionRun(handle, seed, secondRunId, {
      provider: "gsc",
      operation: "search_analytics",
      methodVersion: "gsc.search_analytics.v1",
      sourceConnectionId: connectionId,
      importPreviewId: null,
      requestPayload: {},
    });

    let releaseRejectedCalls: (() => void) | undefined;
    const bothRejectedCallsStarted = new Promise<void>((resolve) => {
      releaseRejectedCalls = resolve;
    });
    let rejectedCalls = 0;
    let refreshCalls = 0;
    const apiTokens: string[] = [];
    const fetchMock = vi.fn<GoogleFetch>(async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        refreshCalls += 1;
        return jsonResponse({
          access_token: "access-concurrent-new-fixture",
          expires_in: 3_600,
        });
      }
      if (url.includes("/searchAnalytics/query")) {
        const authorization =
          ((init?.headers ?? {}) as Record<string, string>)["Authorization"] ??
          "";
        apiTokens.push(authorization);
        if (authorization === "Bearer access-concurrent-old-fixture") {
          rejectedCalls += 1;
          if (rejectedCalls === 2) releaseRejectedCalls?.();
          await bothRejectedCallsStarted;
          return jsonResponse({ error: "expired" }, 401);
        }
        return jsonResponse({ rows: [] });
      }
      throw new Error(`unexpected mocked URL: ${url}`);
    });
    const worker = oauthContext(ctx, fetchMock);

    await withMockedGlobalFetch(fetchMock, () =>
      Promise.all([
        runCollection(worker, {
          runId: firstRunId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
        }),
        runCollection(worker, {
          runId: secondRunId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
        }),
      ]).then(() => undefined),
    );

    expect(refreshCalls).toBe(1);
    expect(apiTokens).toHaveLength(4);
    expect(
      apiTokens.filter(
        (token) => token === "Bearer access-concurrent-old-fixture",
      ),
    ).toHaveLength(2);
    expect(
      apiTokens.filter(
        (token) => token === "Bearer access-concurrent-new-fixture",
      ),
    ).toHaveLength(2);
    expect(await runStatus(handle, seed.scope, firstRunId)).toBe("completed");
    expect(await runStatus(handle, seed.scope, secondRunId)).toBe("completed");
  });

  it("maps invalid_grant to terminal AUTH_REQUIRED, leaves ciphertext intact, and logs no secret material", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const { connectionId, encryptedPayload } = await seedGoogleCollection(
      handle,
      seed,
      runId,
      {
        provider: "gsc",
        envelope: {
          accessToken: "access-invalid-grant-fixture",
          refreshToken: "refresh-invalid-grant-fixture",
          expiresAt: "2026-07-18T08:00:01.000Z",
          scope: "scope.invalid.fixture",
        },
      },
    );
    const providerDescription =
      "revoked refresh-invalid-grant-fixture with worker-client-secret-fixture";
    const fetchMock = vi.fn<GoogleFetch>(async (input) => {
      if (String(input) !== "https://oauth2.googleapis.com/token") {
        throw new Error("provider API must not run after invalid_grant");
      }
      return jsonResponse(
        { error: "invalid_grant", error_description: providerDescription },
        400,
      );
    });
    const captured = captureLogger();
    const worker = oauthContext(ctx, fetchMock, captured.logger);

    await withMockedGlobalFetch(fetchMock, () =>
      runCollection(worker, {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
      }),
    );

    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "AUTH_REQUIRED",
      last_error_summary: "collection failed",
    });
    const stored = await new SourceCredentialsRepository(
      handle.db,
    ).findByConnection(seed.scope, connectionId);
    expect(stored?.encrypted_payload.equals(encryptedPayload)).toBe(true);
    const serializedLogs = captured.lines.join("\n");
    expect(serializedLogs).not.toContain(providerDescription);
    expect(serializedLogs).not.toContain("refresh-invalid-grant-fixture");
    expect(serializedLogs).not.toContain("worker-client-secret-fixture");
    expect(providerMetricLines(captured.lines)).toEqual([
      {
        provider: "gsc",
        outcome: "permanent_failure",
        errorCode: "AUTH_REQUIRED",
        requestCount: 1,
        rateLimitCount: 0,
        quotaCount: 0,
        rowCount: 0,
        rowCountAvailable: false,
        urlCount: 0,
        urlCountAvailable: false,
      },
    ]);
  });

  it("replays a provider request only once when the refreshed access token is also rejected", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const { connectionId } = await seedGoogleCollection(handle, seed, runId, {
      provider: "gsc",
      envelope: {
        accessToken: "access-double-rejected-old-fixture",
        refreshToken: "refresh-double-rejected-fixture",
        expiresAt: "2026-07-18T10:00:00.000Z",
        scope: "scope.double-rejected.fixture",
      },
    });
    let refreshCalls = 0;
    let providerCalls = 0;
    const fetchMock = vi.fn<GoogleFetch>(async (input) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        refreshCalls += 1;
        return jsonResponse({
          access_token: "access-double-rejected-new-fixture",
          expires_in: 3_600,
        });
      }
      if (url.includes("/searchAnalytics/query")) {
        providerCalls += 1;
        return jsonResponse({ error: "still-expired" }, 401);
      }
      throw new Error(`unexpected mocked URL: ${url}`);
    });
    const worker = oauthContext(ctx, fetchMock);

    await withMockedGlobalFetch(fetchMock, () =>
      runCollection(worker, {
        runId,
        workspaceId: seed.scope.workspaceId,
        projectId: seed.scope.projectId,
      }),
    );

    expect(refreshCalls).toBe(1);
    expect(providerCalls).toBe(2);
    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "AUTH_REQUIRED",
    });
    expect(
      await loadStoredEnvelope(handle, seed.scope, connectionId),
    ).toMatchObject({
      accessToken: "access-double-rejected-new-fixture",
      refreshToken: "refresh-double-rejected-fixture",
      scope: "scope.double-rejected.fixture",
    });
  });

  it("does not lock or update a credential through a foreign project scope", async () => {
    const owner = await seedProject(handle);
    const foreign = await seedProject(handle);
    const runId = randomUUID();
    const { connectionId, encryptedPayload } = await seedGoogleCollection(
      handle,
      owner,
      runId,
      {
        provider: "gsc",
        envelope: {
          accessToken: "access-owner-fixture",
          refreshToken: "refresh-owner-fixture",
          expiresAt: "2026-07-18T10:00:00.000Z",
          scope: "scope.owner.fixture",
        },
      },
    );
    const original = await new SourceCredentialsRepository(
      handle.db,
    ).findByConnection(owner.scope, connectionId);
    expect(original).not.toBeNull();
    const foreignCiphertext = encryptCredential(
      encodeCredentialEnvelope({
        accessToken: "access-foreign-fixture",
        refreshToken: "refresh-foreign-fixture",
        expiresAt: "2026-07-18T11:00:00.000Z",
        scope: "scope.foreign.fixture",
      }),
      Buffer.alloc(32),
    );

    const outcome = await handle.db.transaction(async (tx) => {
      const credentials = new SourceCredentialsRepository(tx);
      const locked = await credentials.findByConnectionForUpdate(
        foreign.scope,
        connectionId,
      );
      const updated = await credentials.updateAfterRefresh({
        scope: foreign.scope,
        credentialId: original!.id,
        sourceConnectionId: connectionId,
        encryptedPayload: foreignCiphertext,
        keyVersion: "foreign-key-version",
        cipherVersion: 1,
        expiresAt: "2026-07-18T11:00:00.000Z",
      });
      return { locked, updated };
    });

    expect(outcome).toEqual({ locked: null, updated: null });
    const after = await new SourceCredentialsRepository(
      handle.db,
    ).findByConnection(owner.scope, connectionId);
    expect(after?.encrypted_payload.equals(encryptedPayload)).toBe(true);
    expect(after?.key_version).toBe("v1");
  });

  it("returns a transient token-endpoint failure to queued so pg-boss can retry", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    const { connectionId, encryptedPayload } = await seedGoogleCollection(
      handle,
      seed,
      runId,
      {
        provider: "gsc",
        envelope: {
          accessToken: "access-transient-refresh-fixture",
          refreshToken: "refresh-transient-fixture",
          expiresAt: "2026-07-18T08:00:01.000Z",
          scope: "scope.transient.fixture",
        },
      },
    );
    const fetchMock = vi.fn<GoogleFetch>(async (input) => {
      if (String(input) !== "https://oauth2.googleapis.com/token") {
        throw new Error("provider API must not run after refresh failure");
      }
      return jsonResponse({ error: "temporarily_unavailable" }, 503);
    });
    const worker = oauthContext(ctx, fetchMock);

    await expect(
      withMockedGlobalFetch(fetchMock, () =>
        runCollection(worker, {
          runId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
        }),
      ),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    const run = await new AsyncRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run?.status).toBe("queued");
    expect(run?.started_at).toBeNull();
    const stored = await new SourceCredentialsRepository(
      handle.db,
    ).findByConnection(seed.scope, connectionId);
    expect(stored?.encrypted_payload.equals(encryptedPayload)).toBe(true);
  });
});

async function seedProject(handle: DbHandle): Promise<Seed> {
  const actor = randomUUID();
  const [ws] = await handle.db
    .insert(workspaces)
    .values({ name: `WS-${randomUUID()}` })
    .returning();
  const workspaceId = ws!.id;
  const project = await new ProjectsRepository(handle.db).insert({
    workspaceId,
    clientName: "Col",
    projectName: "Col",
    defaultDeliveryLocale: "en",
    createdBy: actor,
  });
  const host = `col-${randomUUID().slice(0, 8)}.example`;
  const origin = `https://${host}`;
  const site = await new SitesRepository(handle.db).insertPrimary({
    workspaceId,
    projectId: project.id,
    origin,
    host,
    marketCodes: ["US"],
    languageCodes: ["en"],
  });
  return {
    scope: { workspaceId, projectId: project.id },
    siteId: site.id,
    siteOrigin: origin,
    actor,
  };
}

async function seedGoogleCollection(
  handle: DbHandle,
  seed: Seed,
  runId: string,
  input: {
    readonly provider: "gsc" | "ga4";
    readonly envelope: OAuthCredentialEnvelope;
    readonly omitPropertyTimeZone?: boolean;
  },
): Promise<{ readonly connectionId: string; readonly encryptedPayload: Buffer }> {
  const isGsc = input.provider === "gsc";
  const connection = await new SourceConnectionsRepository(
    handle.db,
  ).insertConnection({
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    siteId: seed.siteId,
    provider: input.provider,
    connectionType: "oauth",
    state: "connected",
    externalRef: isGsc ? seed.siteOrigin : "123456789",
    scopes: [input.envelope.scope],
    config: isGsc
      ? { propertyUrl: seed.siteOrigin }
      : {
          propertyId: "123456789",
          ...(!input.omitPropertyTimeZone
            ? { propertyTimeZone: "UTC" }
            : {}),
          keyEventNames: [],
        },
    limitation: `${input.provider} OAuth connection (test).`,
    connectedAt: true,
    createdBy: seed.actor,
  });
  const encryptedPayload = encryptCredential(
    encodeCredentialEnvelope(input.envelope),
    Buffer.alloc(32),
  );
  await new SourceCredentialsRepository(handle.db).replace({
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    sourceConnectionId: connection.id,
    encryptedPayload,
    keyVersion: "v1",
    expiresAt: input.envelope.expiresAt,
  });
  await seedCollectionRun(handle, seed, runId, {
    provider: input.provider,
    operation: isGsc ? "search_analytics" : "organic_landing",
    methodVersion: isGsc
      ? "gsc.search_analytics.v1"
      : "ga4.organic_landing.v1",
    sourceConnectionId: connection.id,
    importPreviewId: null,
    requestPayload: {},
  });
  return { connectionId: connection.id, encryptedPayload };
}

async function seedCsvCollection(
  handle: DbHandle,
  blobStore: BlobStore,
  seed: Seed,
  runId: string,
): Promise<string> {
  const rawKey = `raw-import/${seed.scope.projectId}/${runId}/${randomUUID()}`;
  const csvText = "keyword,search_volume\nrunning shoes,1000\n";
  await blobStore.put({
    key: rawKey,
    body: Buffer.from(csvText, "utf8"),
    contentType: "text/csv",
  });
  const preview = await new ImportPreviewsRepository(handle.db).insert({
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    siteId: seed.siteId,
    createdBy: seed.actor,
    tokenHash: randomBytes(32),
    templateId: "keyword_gap_v1",
    rawObjectKey: rawKey,
    fileChecksum: contentHash({ csv: csvText }),
    rowCount: 1,
    detectedColumns: ["keyword", "search_volume"],
    suggestedMapping: {},
    previewRows: [],
    validationErrors: [],
    validationWarnings: [],
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  await seedCollectionRun(handle, seed, runId, {
    provider: "csv",
    operation: "keyword_gap_import",
    methodVersion: "csv.keyword_gap.v1",
    sourceConnectionId: null,
    importPreviewId: preview.id,
    requestPayload: {
      mapping: { keyword: "keyword", searchVolume: "search_volume" },
      marketFallback: "US",
      languageFallback: "en",
    },
  });
  return rawKey;
}

async function loadStoredEnvelope(
  handle: DbHandle,
  scope: ProjectScope,
  connectionId: string,
): Promise<OAuthCredentialEnvelope | null> {
  const credential = await new SourceCredentialsRepository(
    handle.db,
  ).findByConnection(scope, connectionId);
  if (!credential) return null;
  return decodeCredentialEnvelope(
    decryptCredential(credential.encrypted_payload, Buffer.alloc(32)).toString(
      "utf8",
    ),
  );
}

async function runStatus(
  handle: DbHandle,
  scope: ProjectScope,
  runId: string,
): Promise<string | null> {
  const run = await new AsyncRunsRepository(handle.db).findById(scope, runId);
  return run?.status ?? null;
}

async function seedCollectionRun(
  handle: DbHandle,
  seed: Seed,
  runId: string,
  input: {
    provider: string;
    operation: string;
    methodVersion: string;
    sourceConnectionId: string | null;
    importPreviewId: string | null;
    requestPayload: Record<string, unknown>;
  },
): Promise<void> {
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: seed.scope.workspaceId,
    project_id: seed.scope.projectId,
    kind: "collection",
    status: "queued",
    initiated_by: seed.actor,
    request_payload: input.requestPayload,
  });
  await handle.db.insert(collectionRuns).values({
    id: runId,
    workspace_id: seed.scope.workspaceId,
    project_id: seed.scope.projectId,
    site_id: seed.siteId,
    source_connection_id: input.sourceConnectionId,
    import_preview_id: input.importPreviewId,
    provider: input.provider,
    operation: input.operation,
    method_version: input.methodVersion,
    parameters_hash: contentHash({ run: runId }),
  });
}

async function snapshotCount(
  handle: DbHandle,
  scope: ProjectScope,
): Promise<number> {
  const page = await new DataSnapshotsRepository(handle.db).listByProject(
    scope,
    {
      limit: 100,
      cursor: null,
    },
  );
  return page.rows.length;
}
