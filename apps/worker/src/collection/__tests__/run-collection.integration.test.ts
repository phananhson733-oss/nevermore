import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
process.env["OPENAI_API_KEY"] ??= "sk-test";
process.env["OPENAI_MODEL"] ??= "gpt-4o-mini";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, collectionRuns, workspaces } from "@sf/db/schema";
import {
  AsyncRunsRepository,
  DataSnapshotsRepository,
  ImportPreviewsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  contentHash,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import { LocalFsBlobStore, encryptCredential } from "@sf/sources";
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
