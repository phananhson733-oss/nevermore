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
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, collectionRuns, workspaces } from "@sf/db/schema";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  ImportPreviewsRepository,
  ObservationsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  contentHash,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import {
  BlobObjectAlreadyExistsError,
  CRAWL_BUDGET,
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
      logger: testLogger,
    };
  });
  afterAll(async () => {
    await handle?.end();
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
      methodVersion: "crawl.site_graph.v1",
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
    const offlineCtx = {
      ...ctx,
      crawl: { fetcher, engineOptions },
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
    const first = await runs.claim(runId);
    const second = await runs.claim(runId);
    expect(first?.status).toBe("running");
    expect(second).toBeNull();
  });

  it("AC-041: a permanent adapter error terminates the run `failed` with no reset-to-queued", async () => {
    const seed = await seedProject(handle);
    const runId = randomUUID();
    // A GSC run with no source connection cannot be configured — INVALID_CONFIGURATION.
    await seedCollectionRun(handle, seed, runId, {
      provider: "gsc",
      operation: "search_analytics",
      methodVersion: "gsc.search_analytics.v1",
      sourceConnectionId: null,
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
    expect(run?.last_error_code).toBe("INVALID_CONFIGURATION");
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

    await withMockedGlobalFetch(fetchMock, () =>
      runCollection(oauthContext(ctx, fetchMock), {
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

    await expect(
      withMockedGlobalFetch(fetchMock, () =>
        runCollection(oauthContext(ctx, fetchMock), {
          runId,
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
        }),
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });

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
    const worker = oauthContext(ctx, fetchMock);

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
