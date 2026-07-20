import { randomUUID } from "node:crypto";
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
import {
  asyncRuns,
  collectionRuns,
  icpProfiles,
  workspaces,
} from "@sf/db/schema";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  ObservationsRepository,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  contentHash,
  toRunAttempt,
  type CollectionRunRow,
  type ObservationInsert,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import { LocalFsBlobStore, type SourceWindow } from "@sf/sources";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import { runMigrations } from "../../../../../packages/db/src/migrate.ts";
import { persistCollectionResult } from "../persist.ts";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const CAPTURED_AT = "2026-07-18T08:00:00.000Z";
const WINDOW: SourceWindow = {
  start: "2026-06-01",
  end: "2026-06-28",
};

const NOOP = (): void => undefined;
const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface Seed {
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly actorId: string;
}

describeDb("provider discrepancy persistence (spec §7.6)", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    handle = createDbHandle(DATABASE_URL);
    ctx = {
      db: handle.db,
      boss: {} as PgBoss,
      blobStore: new LocalFsBlobStore(
        mkdtempSync(path.join(os.tmpdir(), "sf-discrepancy-test-")),
      ),
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "test-client", clientSecret: "test-secret" },
      openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
      findingSummariesEnabled: true,
      logger,
    };
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("records stable, de-duplicated pairs only for substantive numeric/text/json/null conflicts", async () => {
    const seed = await seedProject(handle);
    const baseline = [
      numericObservation("crawl.fixture.numeric", 1),
      textObservation("crawl.fixture.text", "left"),
      jsonObservation("crawl.fixture.json", { a: 1, b: [2, 3] }),
      unavailableObservation("crawl.fixture.null", "unavailable"),
      jsonObservation("crawl.fixture.same", { a: 1, b: [2, 3] }),
    ];
    const changed = [
      numericObservation("crawl.fixture.numeric", 2),
      textObservation("crawl.fixture.text", "right"),
      jsonObservation("crawl.fixture.json", { a: 1, b: [2, 4] }),
      unavailableObservation("crawl.fixture.null", "partial"),
      // JSON object key order is not a substantive value change.
      jsonObservation("crawl.fixture.same", { b: [2, 3], a: 1 }),
    ];

    const baselineSnapshotId = await persist(
      handle,
      ctx,
      seed,
      baseline,
      WINDOW,
    );
    const changedSnapshotId = await persist(
      handle,
      ctx,
      seed,
      changed,
      WINDOW,
    );

    const repo = new ProviderDiscrepanciesRepository(handle.db);
    const rows = await repo.listByProject(seed.scope);
    expect(rows.map((row) => row.metric_key).sort()).toEqual([
      "crawl.fixture.json",
      "crawl.fixture.null",
      "crawl.fixture.numeric",
      "crawl.fixture.text",
    ]);
    expect(
      rows.every(
        (row) => row.left_observation_id < row.right_observation_id,
      ),
    ).toBe(true);
    expect(
      new Set(
        rows.map(
          (row) => `${row.left_observation_id}:${row.right_observation_id}`,
        ),
      ).size,
    ).toBe(rows.length);

    // Replaying detection is conflict-safe and cannot duplicate a pair.
    await repo.detectForSnapshot(seed.scope, changedSnapshotId);
    await repo.detectForSnapshot(seed.scope, changedSnapshotId);
    expect(await repo.listByProject(seed.scope)).toHaveLength(4);

    // Both immutable source facts remain; no average or overwrite projection is
    // introduced in place of the conflict ledger.
    const observations = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(seed.scope, [baselineSnapshotId, changedSnapshotId]);
    expect(
      observations
        .filter((row) => row.metric_key === "crawl.fixture.numeric")
        .map((row) => row.value_numeric)
        .sort(),
    ).toEqual(["1", "2"]);
  });

  it("ignores exact duplicates, different windows, and observations from another project", async () => {
    const first = await seedProject(handle);
    const foreign = await seedProject(handle);
    const metricKey = "crawl.fixture.scope";

    const firstSnapshotId = await persist(
      handle,
      ctx,
      first,
      [textObservation(metricKey, "same")],
      WINDOW,
    );
    const foreignSnapshotId = await persist(
      handle,
      ctx,
      foreign,
      [textObservation(metricKey, "foreign-conflict")],
      WINDOW,
    );
    await persist(
      handle,
      ctx,
      first,
      [textObservation(metricKey, "same")],
      WINDOW,
    );
    await persist(
      handle,
      ctx,
      first,
      [textObservation(metricKey, "different-window")],
      { ...WINDOW, end: "2026-06-29" },
    );

    const firstObservation = (
      await new ObservationsRepository(handle.db).listBySnapshotIds(
        first.scope,
        [firstSnapshotId],
      )
    )[0]!;
    const foreignObservation = (
      await new ObservationsRepository(handle.db).listBySnapshotIds(
        foreign.scope,
        [foreignSnapshotId],
      )
    )[0]!;
    await expect(
      new ProviderDiscrepanciesRepository(handle.db).insert(first.scope, {
        metricKey,
        subjectType: "url",
        subjectRef: firstObservation.subject_ref,
        leftObservationId: firstObservation.id,
        rightObservationId: foreignObservation.id,
      }),
    ).rejects.toThrow(/scope/i);

    expect(
      await new ProviderDiscrepanciesRepository(handle.db).listByProject(
        first.scope,
      ),
    ).toEqual([]);
  });

  it("rolls a newly detected discrepancy back with the snapshot transaction", async () => {
    const seed = await seedProject(handle);
    await persist(
      handle,
      ctx,
      seed,
      [numericObservation("crawl.fixture.rollback", 1)],
      WINDOW,
    );

    const beforeSnapshots = await snapshotCount(handle, seed.scope);
    const run = await seedCollectionRun(handle, seed);
    await expect(
      persistCollectionResult(ctx, {
        collectionRun: run,
        datasetKey: "crawl.site_graph.v1",
        schemaVersion: "0.2.0",
        actorId: seed.actorId,
        startedAtMs: Date.now(),
        attempt: {
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
          runId: run.id,
          attemptCount: 1,
        },
        outcome: {
          availability: "available",
          capturedAt: CAPTURED_AT,
          sourceWindow: WINDOW,
          rowCount: 1,
          stopReason: null,
          // This deliberately violates collection_runs' JSON-object CHECK
          // after discrepancy detection, proving every canonical row rolls back.
          providerUsage: [] as unknown as Record<string, number>,
          limitation: "rollback fixture",
          raw: { fixture: "rollback" },
        },
        observations: [numericObservation("crawl.fixture.rollback", 2)],
      }),
    ).rejects.toThrow();

    expect(await snapshotCount(handle, seed.scope)).toBe(beforeSnapshots);
    expect(
      await new ProviderDiscrepanciesRepository(handle.db).listByProject(
        seed.scope,
      ),
    ).toEqual([]);
  });

  it("rolls a resumed attempt 1 back after attempt 2 commits the canonical snapshot", async () => {
    const seed = await seedProject(handle);
    const collectionRun = await seedCollectionRun(handle, seed);
    const runs = new AsyncRunsRepository(handle.db);
    const attempt1 = {
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      runId: collectionRun.id,
      attemptCount: 1,
    };

    expect(
      await runs.prepareDelivery(seed.scope, collectionRun.id, 1),
    ).not.toBeNull();
    const claimed2 = await runs.claim(seed.scope, collectionRun.id);
    expect(claimed2).not.toBeNull();
    const attempt2 = toRunAttempt(claimed2!);

    const input = {
      collectionRun,
      datasetKey: "crawl.site_graph.v1",
      schemaVersion: "0.2.0",
      actorId: seed.actorId,
      startedAtMs: Date.now(),
      outcome: {
        availability: "available" as const,
        capturedAt: CAPTURED_AT,
        sourceWindow: WINDOW,
        rowCount: 1,
        stopReason: null,
        providerUsage: {},
        limitation: "attempt-fencing fixture",
        raw: { fixture: "attempt-fencing" },
      },
      observations: [numericObservation("crawl.fixture.attempt-fencing", 1)],
    };

    const winnerSnapshotId = await persistCollectionResult(ctx, {
      ...input,
      attempt: attempt2,
    });
    expect(winnerSnapshotId).not.toBeNull();

    // Attempt 1 was paused before persistence. Once it resumes, the run row is
    // already terminal at epoch 2, so it must not reach any canonical insert.
    await expect(
      persistCollectionResult(ctx, { ...input, attempt: attempt1 }),
    ).resolves.toBeNull();

    expect(await snapshotCount(handle, seed.scope)).toBe(1);
    expect(await runs.findById(seed.scope, collectionRun.id)).toMatchObject({
      status: "completed",
      attempt_count: 2,
      result_type: "collection_run",
      result_id: collectionRun.id,
    });
    const rawObjects = await ctx.blobStore.list({
      kind: "snapshot-raw",
      cursor: null,
      limit: 100,
    });
    expect(
      rawObjects.objects.filter((object) =>
        object.key.startsWith(`snapshot-raw/${seed.scope.projectId}/`),
      ),
    ).toHaveLength(1);
  });

  it("finishes an accepted collection after archive without changing project or source projections", async () => {
    const seed = await seedProject(handle);
    const projects = new ProjectsRepository(handle.db);
    const sources = new SourceConnectionsRepository(handle.db);
    const [profile] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: seed.scope.workspaceId,
        project_id: seed.scope.projectId,
        version: 1,
        status: "complete",
        profile: { productName: "Archived collection fixture" },
        content_hash: contentHash({ fixture: randomUUID() }),
        created_by: seed.actorId,
      })
      .returning();
    await projects.setCurrentIcpProfile(
      { workspaceId: seed.scope.workspaceId },
      seed.scope.projectId,
      profile!.id,
    );
    await projects.setStage(
      { workspaceId: seed.scope.workspaceId },
      seed.scope.projectId,
      "collecting",
    );
    const source = await sources.insertDefaultCrawl({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      siteId: seed.siteId,
      createdBy: seed.actorId,
    });
    await sources.updateState(
      seed.scope,
      source.id,
      "syncing",
      "Accepted crawl remains frozen after archive.",
    );
    const collectionRun = await seedCollectionRun(handle, seed, source.id);

    const archiveClient = await handle.pool.connect();
    await archiveClient.query("begin");
    await archiveClient.query(
      `update app.client_projects
          set archived_at = now()
        where workspace_id = $1
          and id = $2`,
      [seed.scope.workspaceId, seed.scope.projectId],
    );
    const sourceBefore = await sources.findById(seed.scope, source.id);

    const originalProjectLock = ProjectsRepository.prototype.findByIdForUpdate;
    const originalSourceLock =
      SourceConnectionsRepository.prototype.findActiveByIdForUpdate;
    let projectLockResolve!: (path: "project") => void;
    const projectLockAttempted = new Promise<"project">((resolve) => {
      projectLockResolve = resolve;
    });
    let sourceLockResolve!: (path: "source") => void;
    const sourceLockAttempted = new Promise<"source">((resolve) => {
      sourceLockResolve = resolve;
    });
    const projectLockSpy = vi
      .spyOn(ProjectsRepository.prototype, "findByIdForUpdate")
      .mockImplementation(async function (
        this: ProjectsRepository,
        lookupScope,
        projectId,
      ) {
        if (projectId === seed.scope.projectId) {
          projectLockResolve("project");
        }
        return originalProjectLock.call(this, lookupScope, projectId);
      });
    const sourceLockSpy = vi
      .spyOn(SourceConnectionsRepository.prototype, "findActiveByIdForUpdate")
      .mockImplementation(async function (
        this: SourceConnectionsRepository,
        lookupScope,
        sourceId,
      ) {
        if (sourceId === source.id) {
          sourceLockResolve("source");
        }
        return originalSourceLock.call(this, lookupScope, sourceId);
      });

    let archiveCommitted = false;
    let firstLock: "project" | "source" | "timeout" | undefined;
    let sourceLockCalls: number | undefined;
    let snapshotId: string | null | undefined;
    try {
      const persistence = persistCollectionResult(ctx, {
        collectionRun,
        datasetKey: "crawl.site_graph.v1",
        schemaVersion: "0.2.0",
        actorId: seed.actorId,
        startedAtMs: Date.now(),
        attempt: {
          workspaceId: seed.scope.workspaceId,
          projectId: seed.scope.projectId,
          runId: collectionRun.id,
          attemptCount: 1,
        },
        outcome: {
          availability: "available",
          capturedAt: CAPTURED_AT,
          sourceWindow: WINDOW,
          rowCount: 1,
          stopReason: null,
          providerUsage: {},
          limitation: "Accepted collection completed after archive.",
          raw: { fixture: "archived-accepted-collection" },
        },
        observations: [numericObservation("crawl.fixture.archived", 1)],
      });
      firstLock = await Promise.race([
        projectLockAttempted,
        sourceLockAttempted,
        new Promise<"timeout">((resolve) => {
          setTimeout(() => resolve("timeout"), 500);
        }),
      ]);
      await archiveClient.query("commit");
      archiveCommitted = true;
      snapshotId = await persistence;
      sourceLockCalls = sourceLockSpy.mock.calls.length;
    } finally {
      if (!archiveCommitted) {
        await archiveClient.query("rollback").catch(() => undefined);
      }
      archiveClient.release();
      projectLockSpy.mockRestore();
      sourceLockSpy.mockRestore();
    }

    expect(firstLock).toBe("project");
    expect(sourceLockCalls).toBe(1);
    expect(snapshotId).not.toBeNull();
    expect(await snapshotCount(handle, seed.scope)).toBe(1);
    await expect(
      new CollectionRunsRepository(handle.db).findById(collectionRun.id),
    ).resolves.toMatchObject({ row_count: 1 });
    await expect(
      new AsyncRunsRepository(handle.db).findById(
        seed.scope,
        collectionRun.id,
      ),
    ).resolves.toMatchObject({
      status: "completed",
      result_type: "collection_run",
      result_id: collectionRun.id,
    });
    await expect(
      projects.findById(
        { workspaceId: seed.scope.workspaceId },
        seed.scope.projectId,
      ),
    ).resolves.toMatchObject({
      stage: "collecting",
      archived_at: expect.any(String),
    });
    await expect(sources.findById(seed.scope, source.id)).resolves.toEqual(
      sourceBefore,
    );
    await sources.updateState(
      seed.scope,
      source.id,
      "unavailable",
      "An archived source projection must remain frozen.",
    );
    await expect(sources.findById(seed.scope, source.id)).resolves.toEqual(
      sourceBefore,
    );
  });
});

async function persist(
  handle: DbHandle,
  ctx: WorkerContext,
  seed: Seed,
  observations: readonly ObservationInsert[],
  sourceWindow: SourceWindow,
): Promise<string> {
  const run = await seedCollectionRun(handle, seed);
  const snapshotId = await persistCollectionResult(ctx, {
    collectionRun: run,
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    actorId: seed.actorId,
    startedAtMs: Date.now(),
    attempt: {
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      runId: run.id,
      attemptCount: 1,
    },
    outcome: {
      availability: "available",
      capturedAt: CAPTURED_AT,
      sourceWindow,
      rowCount: observations.length,
      stopReason: null,
      providerUsage: {},
      limitation: "provider discrepancy fixture",
      raw: { runId: run.id },
    },
    observations,
  });
  if (snapshotId === null) throw new Error("collection fixture lost its attempt");
  return snapshotId;
}

async function seedProject(handle: DbHandle): Promise<Seed> {
  const actorId = randomUUID();
  const [workspace] = await handle.db
    .insert(workspaces)
    .values({ name: `Discrepancy ${randomUUID()}` })
    .returning();
  const project = await new ProjectsRepository(handle.db).insert({
    workspaceId: workspace!.id,
    clientName: "Discrepancy fixture",
    projectName: "Discrepancy fixture",
    defaultDeliveryLocale: "en",
    createdBy: actorId,
  });
  const host = `discrepancy-${randomUUID().slice(0, 8)}.example`;
  const site = await new SitesRepository(handle.db).insertPrimary({
    workspaceId: workspace!.id,
    projectId: project.id,
    origin: `https://${host}`,
    host,
    marketCodes: ["US"],
    languageCodes: ["en"],
  });
  return {
    scope: { workspaceId: workspace!.id, projectId: project.id },
    siteId: site.id,
    actorId,
  };
}

async function seedCollectionRun(
  handle: DbHandle,
  seed: Seed,
  sourceConnectionId: string | null = null,
): Promise<CollectionRunRow> {
  const runId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: seed.scope.workspaceId,
    project_id: seed.scope.projectId,
    kind: "collection",
    status: "running",
    attempt_count: 1,
    initiated_by: seed.actorId,
    started_at: CAPTURED_AT,
  });
  await handle.db.insert(collectionRuns).values({
    id: runId,
    workspace_id: seed.scope.workspaceId,
    project_id: seed.scope.projectId,
    site_id: seed.siteId,
    source_connection_id: sourceConnectionId,
    import_preview_id: null,
    provider: "crawl",
    operation: "site_graph",
    method_version: "crawl.site_graph.v1",
    parameters_hash: contentHash({ runId }),
  });
  const run = await new CollectionRunsRepository(handle.db).findById(runId);
  if (!run) throw new Error("collection fixture missing");
  return run;
}

async function snapshotCount(
  handle: DbHandle,
  scope: ProjectScope,
): Promise<number> {
  const page = await new DataSnapshotsRepository(handle.db).listByProject(
    scope,
    { limit: 100, cursor: null },
  );
  return page.rows.length;
}

function baseObservation(
  metricKey: string,
): Omit<ObservationInsert, "availability" | "valueNumeric" | "valueText" | "valueJson"> {
  return {
    metricKey,
    subjectType: "url",
    subjectRef: `https://fixture.test/${metricKey}`,
    observedAt: CAPTURED_AT,
    unit: null,
    origin: "direct_public",
    grade: "B",
    support: "supports",
    limitation: "discrepancy test observation",
  };
}

function numericObservation(
  metricKey: string,
  value: number,
): ObservationInsert {
  return {
    ...baseObservation(metricKey),
    availability: "available",
    valueNumeric: value,
    valueText: null,
    valueJson: null,
  };
}

function textObservation(metricKey: string, value: string): ObservationInsert {
  return {
    ...baseObservation(metricKey),
    availability: "available",
    valueNumeric: null,
    valueText: value,
    valueJson: null,
  };
}

function jsonObservation(metricKey: string, value: unknown): ObservationInsert {
  return {
    ...baseObservation(metricKey),
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: value,
  };
}

function unavailableObservation(
  metricKey: string,
  availability: "partial" | "unavailable",
): ObservationInsert {
  return {
    ...baseObservation(metricKey),
    availability,
    valueNumeric: null,
    valueText: null,
    valueJson: null,
  };
}
