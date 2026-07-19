import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BLOB_DIR = mkdtempSync(path.join(os.tmpdir(), "sf-csv-chain-"));

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";
process.env["SF_BLOB_BACKEND"] = "local";
process.env["SF_BLOB_DIR"] = BLOB_DIR;

import { and, eq } from "drizzle-orm";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  collectionRuns,
  importPreviews,
  normalizedObservations,
  workspaces,
} from "@sf/db/schema";
import {
  AsyncRunsRepository,
  DataSnapshotsRepository,
  IdempotencyRepository,
  ImportPreviewsRepository,
  ObservationsRepository,
  type ImportPreviewRow,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import type { ImportConfirmRequest } from "@sf/contracts";
import { ProblemError, type Logger } from "@sf/observability";
import { LocalFsBlobStore } from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "../../../../../worker/src/context.ts";
import { runCollection } from "../../../../../worker/src/collection/run-collection.ts";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { confirmImport, previewImport } from "@/lib/services/csv-import";

const queueFixture = vi.hoisted(() => {
  const jobs: Array<{
    queue: string;
    payload: { runId: string; workspaceId: string; projectId: string };
  }> = [];
  const send = vi.fn(
    async (
      queue: string,
      payload: { runId: string; workspaceId: string; projectId: string },
    ) => {
      jobs.push({ queue, payload });
      return payload.runId;
    },
  );
  return { jobs, send };
});

vi.mock("@/lib/boss", () => ({
  getBoss: async () => ({ send: queueFixture.send }),
}));

/**
 * AC-016 (spec §7.5, §11.1): the CSV import token is single-use. `confirm`
 * validates the token's project/TTL/UNCONSUMED state, and a replay of an
 * already-consumed token is rejected as 409 `IMPORT_TOKEN_REPLAYED` (the frozen
 * code) — it must NOT create a (duplicate) collection run. An unissued token is
 * `IMPORT_TOKEN_INVALID` and an expired one `IMPORT_TOKEN_EXPIRED` (both 422).
 *
 * The primary proof drives the real preview -> confirm -> worker -> immutable
 * snapshot path against local Postgres and a shared private LocalFS store. The
 * pre-consumed/invalid/expired fixtures retain focused guards for error codes.
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

const HEADERS = ["keyword", "search_volume", "market", "language"] as const;

const confirmBody = (importToken: string): ImportConfirmRequest => ({
  mode: "confirm",
  importToken,
  mapping: {
    keyword: "keyword",
    searchVolume: "search_volume",
    marketCode: "market",
    languageCode: "language",
  },
});

const tokenHashOf = (token: string) => createHash("sha256").update(token).digest();

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

/** Seed an `import_previews` row; returns the raw token + the inserted row. */
async function seedPreview(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  actor: string,
  expiresAt: string,
): Promise<{ token: string; row: ImportPreviewRow }> {
  const token = randomBytes(32).toString("base64url");
  const row = await new ImportPreviewsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    createdBy: actor,
    tokenHash: tokenHashOf(token),
    templateId: "keyword_gap_v1",
    rawObjectKey: `raw-imports/${scope.projectId}/${randomUUID()}.csv`,
    fileChecksum: createHash("sha256").update("seed").digest("hex"),
    rowCount: 3,
    detectedColumns: [...HEADERS],
    suggestedMapping: {
      keyword: "keyword",
      searchVolume: "search_volume",
      marketCode: "market",
      languageCode: "language",
    },
    previewRows: [{ keyword: "shoes", search_volume: "100", market: "US", language: "en" }],
    validationErrors: [],
    validationWarnings: [],
    expiresAt,
  });
  return { token, row };
}

async function countCollectionRuns(handle: DbHandle, projectId: string): Promise<number> {
  const rows = await handle.db
    .select({ id: collectionRuns.id })
    .from(collectionRuns)
    .where(eq(collectionRuns.project_id, projectId));
  return rows.length;
}

describeDb("confirmImport — single-use import token (AC-016)", () => {
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
        clientName: "Csv",
        projectName: "Csv",
        siteUrl: "https://csv.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    scope = { workspaceId, projectId: created.project.id };
    siteId = created.project.site.id;
  });
  afterAll(async () => {
    await handle?.end();
    rmSync(BLOB_DIR, { recursive: true, force: true });
  });

  it("replaying a consumed token returns 409 IMPORT_TOKEN_REPLAYED and writes no collection run", async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const { token, row } = await seedPreview(handle, scope, siteId, actor, future);

    // Represent the post-first-confirm state: the token has been consumed.
    await new ImportPreviewsRepository(handle.db).consume(scope, row.id);

    await expect(
      confirmImport({ workspaceId: scope.workspaceId }, scope.projectId, actor, randomUUID(), confirmBody(token)),
    ).rejects.toMatchObject({ code: "IMPORT_TOKEN_REPLAYED", status: 409 });

    // The replay must not create a (duplicate) collection run.
    expect(await countCollectionRuns(handle, scope.projectId)).toBe(0);

    // The preview stays consumed (single-use, append-only status).
    const after = await new ImportPreviewsRepository(handle.db).findByTokenHash(scope, tokenHashOf(token));
    expect(after?.status).toBe("consumed");
  });

  it("rejects a token that was never issued as IMPORT_TOKEN_INVALID (422)", async () => {
    await expect(
      confirmImport(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        actor,
        randomUUID(),
        confirmBody(randomBytes(32).toString("base64url")),
      ),
    ).rejects.toMatchObject({ code: "IMPORT_TOKEN_INVALID", status: 422 });
  });

  it("rejects an expired token as IMPORT_TOKEN_EXPIRED (422)", async () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    const { token } = await seedPreview(handle, scope, siteId, actor, past);
    await expect(
      confirmImport({ workspaceId: scope.workspaceId }, scope.projectId, actor, randomUUID(), confirmBody(token)),
    ).rejects.toMatchObject({ code: "IMPORT_TOKEN_EXPIRED", status: 422 });
    expect(await countCollectionRuns(handle, scope.projectId)).toBe(0);
  });

  it("uses the database clock as the authoritative token TTL", async () => {
    queueFixture.jobs.length = 0;
    queueFixture.send.mockClear();
    const [clockWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `CSV-clock-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: clockWorkspace!.id },
      actor,
      randomUUID(),
      {
        clientName: "CSV DB clock",
        projectName: "CSV DB clock",
        siteUrl: "https://csv-db-clock.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const clockScope: ProjectScope = {
      workspaceId: clockWorkspace!.id,
      projectId: created.project.id,
    };
    const realNow = Date.now();
    const { token } = await seedPreview(
      handle,
      clockScope,
      created.project.site.id,
      actor,
      new Date(realNow + 30 * 60_000).toISOString(),
    );
    const appClock = vi
      .spyOn(Date, "now")
      .mockReturnValue(realNow + 60 * 60_000);

    try {
      await expect(
        confirmImport(
          { workspaceId: clockScope.workspaceId },
          clockScope.projectId,
          actor,
          randomUUID(),
          confirmBody(token),
        ),
      ).resolves.toMatchObject({ status: 202, replayed: false });
    } finally {
      appClock.mockRestore();
    }
    expect(await countCollectionRuns(handle, clockScope.projectId)).toBe(1);
  });

  it("serializes concurrent exact retries so the token creates only one run", async () => {
    queueFixture.jobs.length = 0;
    queueFixture.send.mockClear();
    const [concurrentWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `CSV-idem-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: concurrentWorkspace!.id },
      actor,
      randomUUID(),
      {
        clientName: "CSV concurrent idempotency",
        projectName: "CSV concurrent idempotency",
        siteUrl: "https://csv-concurrent-idem.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const concurrentScope: ProjectScope = {
      workspaceId: concurrentWorkspace!.id,
      projectId: created.project.id,
    };
    const { token } = await seedPreview(
      handle,
      concurrentScope,
      created.project.site.id,
      actor,
      new Date(Date.now() + 30 * 60_000).toISOString(),
    );
    const key = randomUUID();
    const args = [
      { workspaceId: concurrentScope.workspaceId },
      concurrentScope.projectId,
      actor,
      key,
      confirmBody(token),
    ] as const;

    const [left, right] = await Promise.all([
      confirmImport(...args),
      confirmImport(...args),
    ]);
    expect(left.run.id).toBe(right.run.id);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
    expect(await countCollectionRuns(handle, concurrentScope.projectId)).toBe(1);
  });

  it("maps a real different-key CSV active race to the winning run", async () => {
    queueFixture.jobs.length = 0;
    queueFixture.send.mockClear();
    const [raceWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `CSV-active-race-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: raceWorkspace!.id },
      actor,
      randomUUID(),
      {
        clientName: "CSV active race",
        projectName: "CSV active race",
        siteUrl: "https://csv-active-race.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const raceScope: ProjectScope = {
      workspaceId: raceWorkspace!.id,
      projectId: created.project.id,
    };
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const [leftPreview, rightPreview] = await Promise.all([
      seedPreview(
        handle,
        raceScope,
        created.project.site.id,
        actor,
        expiresAt,
      ),
      seedPreview(
        handle,
        raceScope,
        created.project.site.id,
        actor,
        expiresAt,
      ),
    ]);
    const results = await Promise.allSettled([
      confirmImport(
        { workspaceId: raceScope.workspaceId },
        raceScope.projectId,
        actor,
        randomUUID(),
        confirmBody(leftPreview.token),
      ),
      confirmImport(
        { workspaceId: raceScope.workspaceId },
        raceScope.projectId,
        actor,
        randomUUID(),
        confirmBody(rightPreview.token),
      ),
    ]);
    const fulfilled = results.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof confirmImport>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toBeDefined();
    expect(rejected?.reason).toBeInstanceOf(ProblemError);
    expect(rejected?.reason).toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      extraHeaders: { Location: fulfilled!.value.statusUrl },
    });
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
    expect(await countCollectionRuns(handle, raceScope.projectId)).toBe(1);
  });

  it("AC-016: exact lost-response retry replays 202, while another key cannot consume the token again", async () => {
    queueFixture.jobs.length = 0;
    queueFixture.send.mockClear();

    const chainActor = randomUUID();
    const [chainWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `CSV-chain-${randomUUID()}` })
      .returning();
    const chainWorkspaceId = chainWorkspace!.id;
    const created = await createProject(
      { workspaceId: chainWorkspaceId },
      chainActor,
      randomUUID(),
      {
        clientName: "CSV chain",
        projectName: "CSV chain",
        siteUrl: "https://csv-chain.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const chainScope: ProjectScope = {
      workspaceId: chainWorkspaceId,
      projectId: created.project.id,
    };
    const csv = [
      "keyword,search_volume,market,language",
      ...Array.from(
        { length: 25 },
        (_, index) => `fixture keyword ${index + 1},${1000 + index},US,en`,
      ),
    ].join("\n");

    expect(await observationCount(handle, chainScope)).toBe(0);
    const preview = await previewImport(
      { workspaceId: chainWorkspaceId },
      chainScope.projectId,
      chainActor,
      { bytes: Buffer.from(csv, "utf8"), templateId: "keyword_gap_v1" },
    );
    expect(preview).toMatchObject({ rowCount: 25, errors: [] });
    expect(preview.previewRows).toHaveLength(20);
    expect(preview.importToken).toEqual(expect.any(String));
    expect(await observationCount(handle, chainScope)).toBe(0);
    expect(await snapshotRows(handle, chainScope)).toHaveLength(0);
    expect(await countCollectionRuns(handle, chainScope.projectId)).toBe(0);

    const storedPreview = await new ImportPreviewsRepository(
      handle.db,
    ).findByTokenHash(chainScope, tokenHashOf(preview.importToken));
    expect(storedPreview).toMatchObject({
      status: "previewed",
      row_count: 25,
    });
    expect(storedPreview?.preview_rows).toHaveLength(20);

    const idempotencyKey = randomUUID();
    const command = confirmBody(preview.importToken);
    const confirmed = await confirmImport(
      { workspaceId: chainWorkspaceId },
      chainScope.projectId,
      chainActor,
      idempotencyKey,
      command,
    );
    expect(confirmed).toMatchObject({
      status: 202,
      replayed: false,
      run: { status: "queued" },
      resourceRef: { type: "collection_run" },
    });
    expect(queueFixture.jobs).toEqual([
      {
        queue: "collect.csv",
        payload: expect.objectContaining({
          runId: confirmed.run.id,
          workspaceId: chainWorkspaceId,
          projectId: chainScope.projectId,
        }),
      },
    ]);

    const lostResponseRetry = await confirmImport(
      { workspaceId: chainWorkspaceId },
      chainScope.projectId,
      chainActor,
      idempotencyKey,
      command,
    );
    expect(lostResponseRetry).toMatchObject({
      status: 202,
      replayed: true,
      statusUrl: confirmed.statusUrl,
      run: { id: confirmed.run.id },
      resourceRef: confirmed.resourceRef,
    });
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
    expect(await countCollectionRuns(handle, chainScope.projectId)).toBe(1);

    const racedFastPath = vi
      .spyOn(IdempotencyRepository.prototype, "find")
      .mockResolvedValueOnce(null);
    try {
      const replayAfterInitialMiss = await confirmImport(
        { workspaceId: chainWorkspaceId },
        chainScope.projectId,
        chainActor,
        idempotencyKey,
        command,
      );
      expect(replayAfterInitialMiss).toMatchObject({
        replayed: true,
        statusUrl: confirmed.statusUrl,
        run: { id: confirmed.run.id },
      });
    } finally {
      racedFastPath.mockRestore();
    }

    await expect(
      confirmImport(
        { workspaceId: chainWorkspaceId },
        chainScope.projectId,
        chainActor,
        idempotencyKey,
        {
          ...command,
          mapping: { ...command.mapping, cluster: "keyword" },
        },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });

    const otherProject = await createProject(
      { workspaceId: chainWorkspaceId },
      chainActor,
      randomUUID(),
      {
        clientName: "CSV other project",
        projectName: "CSV other project",
        siteUrl: "https://csv-other-project.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    await expect(
      confirmImport(
        { workspaceId: chainWorkspaceId },
        otherProject.project.id,
        chainActor,
        idempotencyKey,
        command,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });

    const [foreignWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `CSV-foreign-${randomUUID()}` })
      .returning();
    await expect(
      confirmImport(
        { workspaceId: foreignWorkspace!.id },
        chainScope.projectId,
        chainActor,
        idempotencyKey,
        command,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    await expect(
      confirmImport(
        { workspaceId: chainWorkspaceId },
        chainScope.projectId,
        chainActor,
        randomUUID(),
        command,
      ),
    ).rejects.toMatchObject({ code: "IMPORT_TOKEN_REPLAYED", status: 409 });

    const workerContext: WorkerContext = {
      db: handle.db,
      boss: { send: queueFixture.send } as unknown as PgBoss,
      blobStore: new LocalFsBlobStore(BLOB_DIR),
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "test", clientSecret: "test" },
      openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
      logger: testLogger,
    };
    await runCollection(workerContext, {
      runId: confirmed.run.id,
      workspaceId: chainWorkspaceId,
      projectId: chainScope.projectId,
    });

    const terminal = await new AsyncRunsRepository(handle.db).findById(
      chainScope,
      confirmed.run.id,
    );
    expect(terminal?.status).toBe("completed");
    const snapshots = await snapshotRows(handle, chainScope);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      collection_run_id: confirmed.run.id,
      provider: "csv",
      dataset_key: "csv.keyword_gap.v1",
      availability: "available",
      row_count: 25,
    });
    expect(snapshots[0]!.limitation.trim()).not.toBe("");
    const observations = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(chainScope, [snapshots[0]!.id]);
    expect(observations).toHaveLength(25);
    expect(
      observations.every(
        (row) =>
          row.metric_key === "csv.keyword_gap.v1" &&
          row.limitation.trim() !== "",
      ),
    ).toBe(true);
    expect(observations[0]?.value_json).toMatchObject({
      marketCode: "US",
      languageCode: "en",
    });

    expect(queueFixture.send).toHaveBeenCalledTimes(1);
    expect(await countCollectionRuns(handle, chainScope.projectId)).toBe(1);
    expect(await observationCount(handle, chainScope)).toBe(25);
  });

  it("rejects a stale preview read when another transaction consumes the token before confirm CAS", async () => {
    queueFixture.jobs.length = 0;
    queueFixture.send.mockClear();
    const raceActor = randomUUID();
    const [raceWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `CSV-CAS-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: raceWorkspace!.id },
      raceActor,
      randomUUID(),
      {
        clientName: "CSV CAS",
        projectName: "CSV CAS",
        siteUrl: "https://csv-cas.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const raceScope: ProjectScope = {
      workspaceId: raceWorkspace!.id,
      projectId: created.project.id,
    };
    const { token, row } = await seedPreview(
      handle,
      raceScope,
      created.project.site.id,
      raceActor,
      new Date(Date.now() + 30 * 60_000).toISOString(),
    );
    const originalFind = ImportPreviewsRepository.prototype.findByTokenHash;
    const staleRead = vi
      .spyOn(ImportPreviewsRepository.prototype, "findByTokenHash")
      .mockImplementationOnce(async function (this: ImportPreviewsRepository, lookupScope, hash) {
        const preview = await originalFind.call(this, lookupScope, hash);
        await handle.db
          .update(importPreviews)
          .set({ status: "consumed", consumed_at: new Date().toISOString() })
          .where(eq(importPreviews.id, row.id));
        return preview;
      });

    try {
      await expect(
        confirmImport(
          { workspaceId: raceScope.workspaceId },
          raceScope.projectId,
          raceActor,
          randomUUID(),
          confirmBody(token),
        ),
      ).rejects.toMatchObject({ code: "IMPORT_TOKEN_REPLAYED", status: 409 });
    } finally {
      staleRead.mockRestore();
    }
    expect(queueFixture.send).not.toHaveBeenCalled();
    expect(await countCollectionRuns(handle, raceScope.projectId)).toBe(0);
  });

  it("rolls token consumption back when a later enqueue step fails", async () => {
    queueFixture.jobs.length = 0;
    queueFixture.send.mockClear();
    const rollbackActor = randomUUID();
    const [rollbackWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `CSV-rollback-${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: rollbackWorkspace!.id },
      rollbackActor,
      randomUUID(),
      {
        clientName: "CSV rollback",
        projectName: "CSV rollback",
        siteUrl: "https://csv-rollback.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const rollbackScope: ProjectScope = {
      workspaceId: rollbackWorkspace!.id,
      projectId: created.project.id,
    };
    const { token } = await seedPreview(
      handle,
      rollbackScope,
      created.project.site.id,
      rollbackActor,
      new Date(Date.now() + 30 * 60_000).toISOString(),
    );
    const key = randomUUID();
    queueFixture.send.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      confirmImport(
        { workspaceId: rollbackScope.workspaceId },
        rollbackScope.projectId,
        rollbackActor,
        key,
        confirmBody(token),
      ),
    ).rejects.toThrow("queue unavailable");
    expect(await countCollectionRuns(handle, rollbackScope.projectId)).toBe(0);
    const afterRollback = await new ImportPreviewsRepository(
      handle.db,
    ).findByTokenHash(rollbackScope, tokenHashOf(token));
    expect(afterRollback?.status).toBe("previewed");

    const retried = await confirmImport(
      { workspaceId: rollbackScope.workspaceId },
      rollbackScope.projectId,
      rollbackActor,
      key,
      confirmBody(token),
    );
    expect(retried).toMatchObject({ status: 202, replayed: false });
    expect(await countCollectionRuns(handle, rollbackScope.projectId)).toBe(1);
  });
});

async function observationCount(
  handle: DbHandle,
  scope: ProjectScope,
): Promise<number> {
  const rows = await handle.db
    .select({ id: normalizedObservations.id })
    .from(normalizedObservations)
    .where(
      and(
        eq(normalizedObservations.workspace_id, scope.workspaceId),
        eq(normalizedObservations.project_id, scope.projectId),
      ),
    );
  return rows.length;
}

async function snapshotRows(handle: DbHandle, scope: ProjectScope) {
  const page = await new DataSnapshotsRepository(handle.db).listByProject(
    scope,
    { limit: 100, cursor: null },
  );
  return page.rows;
}
