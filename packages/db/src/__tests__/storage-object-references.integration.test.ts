import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import { StorageObjectReferencesRepository } from "../repositories/storage-object-references.ts";
import {
  asyncRuns,
  clientProjects,
  collectionRuns,
  dataSnapshots,
  exportBundles,
  importPreviews,
  sites,
  sourceConnections,
  workspaces,
} from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const HASH = "a".repeat(64);

describeDb("canonical storage object references", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("uses DB now and resolves the exact three-table union across real SQL chunks", async () => {
    const dbNowStartedAt = Date.now();
    const databaseNow = await new StorageObjectReferencesRepository(
      handle.db,
    ).databaseNow();
    const dbNowFinishedAt = Date.now();
    expect(Number.isFinite(databaseNow.getTime())).toBe(true);
    expect(databaseNow.getTime()).toBeGreaterThanOrEqual(
      dbNowStartedAt - 5_000,
    );
    expect(databaseNow.getTime()).toBeLessThanOrEqual(
      dbNowFinishedAt + 5_000,
    );

    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const siteId = randomUUID();
    const sourceConnectionId = randomUUID();
    const actorId = randomUUID();
    const importPreviewId = randomUUID();
    const collectionRunId = randomUUID();
    const snapshotId = randomUUID();
    const exportRunId = randomUUID();
    const exportBundleId = randomUUID();
    const exportCompletedAt = "2026-07-19T12:00:00.000Z";
    const snapshotKey = `snapshot-raw/${projectId}/${collectionRunId}/snapshot.json`;
    const previewKey = `raw-import/${projectId}/${importPreviewId}/preview.csv`;
    const exportKey = `export/${projectId}/${exportRunId}/bundle.zip`;
    const orphanKey = `raw/${projectId}/${randomUUID()}/orphan.json`;
    const rollback = new Error("rollback storage reference fixtures");
    let assertionsCompleted = false;

    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(workspaces).values({
          id: workspaceId,
          name: `Storage references ${workspaceId}`,
        });
        await tx.insert(clientProjects).values({
          id: projectId,
          workspace_id: workspaceId,
          client_name: "Storage reference fixture",
          project_name: "Storage reference fixture",
          default_delivery_locale: "en",
          created_by: actorId,
        });
        await tx.insert(sites).values({
          id: siteId,
          workspace_id: workspaceId,
          project_id: projectId,
          origin: `https://${projectId}.example.test`,
          host: `${projectId}.example.test`,
          market_codes: ["US"],
          language_codes: ["en"],
        });
        await tx.insert(sourceConnections).values({
          id: sourceConnectionId,
          workspace_id: workspaceId,
          project_id: projectId,
          site_id: siteId,
          provider: "crawl",
          connection_type: "public",
          state: "connected",
          limitation: "Disposable storage reference crawl source.",
          connected_at: new Date().toISOString(),
          created_by: actorId,
        });
        await tx.insert(importPreviews).values({
          id: importPreviewId,
          workspace_id: workspaceId,
          project_id: projectId,
          site_id: siteId,
          created_by: actorId,
          token_hash: randomBytes(32),
          template_id: "keyword_gap_v1",
          raw_object_key: previewKey,
          file_checksum: HASH,
          row_count: 1,
          detected_columns: ["keyword"],
          suggested_mapping: { keyword: "keyword" },
          preview_rows: [{ keyword: "fixture" }],
          expires_at: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
        });
        await tx.insert(asyncRuns).values([
          {
            id: collectionRunId,
            workspace_id: workspaceId,
            project_id: projectId,
            kind: "collection",
            initiated_by: actorId,
          },
          {
            id: exportRunId,
            workspace_id: workspaceId,
            project_id: projectId,
            kind: "export",
            initiated_by: actorId,
          },
        ]);
        await tx.insert(collectionRuns).values({
          id: collectionRunId,
          workspace_id: workspaceId,
          project_id: projectId,
          site_id: siteId,
          source_connection_id: sourceConnectionId,
          provider: "crawl",
          operation: "site_graph",
          method_version: "crawl.site_graph.v2",
          parameters_hash: HASH,
        });
        await tx.insert(dataSnapshots).values({
          id: snapshotId,
          workspace_id: workspaceId,
          project_id: projectId,
          site_id: siteId,
          collection_run_id: collectionRunId,
          source_connection_id: sourceConnectionId,
          provider: "crawl",
          dataset_key: "crawl.site_graph.v1",
          schema_version: "0.2.0",
          method_version: "crawl.site_graph.v2",
          captured_at: new Date().toISOString(),
          source_window: { start: null, end: null },
          availability: "available",
          limitation: "Integration fixture only.",
          raw_object_key: snapshotKey,
          row_count: 1,
          checksum: HASH,
        });
        await tx.insert(exportBundles).values({
          id: exportBundleId,
          workspace_id: workspaceId,
          project_id: projectId,
          async_run_id: exportRunId,
          kind: "service_bundle",
          output_locale: "en",
          created_by: actorId,
        });
        await tx
          .update(exportBundles)
          .set({
            object_key: exportKey,
            checksum: HASH,
            byte_size: 1,
            item_counts: {},
            manifest: {},
          })
          .where(eq(exportBundles.id, exportBundleId));
        await tx
          .update(asyncRuns)
          .set({ status: "completed", completed_at: exportCompletedAt })
          .where(eq(asyncRuns.id, exportRunId));

        const repository = new StorageObjectReferencesRepository(tx);
        await expect(repository.findReferencedKeys([])).resolves.toEqual(
          new Set(),
        );
        const firstChunkOrphans = Array.from(
          { length: 499 },
          (_value, index) =>
            `raw/${projectId}/orphan-run-${index}/nonce-${index}`,
        );
        const candidates = [
          snapshotKey,
          ...firstChunkOrphans,
          previewKey,
          exportKey,
          orphanKey,
          snapshotKey,
          previewKey,
          exportKey,
        ];

        await expect(
          repository.findReferencedKeys(candidates),
        ).resolves.toEqual(new Set([snapshotKey, previewKey, exportKey]));
        await expect(
          repository.findExportDeletionFences([
            {
              key: exportKey,
              projectId,
              runId: exportRunId,
            },
            {
              key: "export/not-a-uuid/not-a-uuid/orphan.zip",
              projectId: "not-a-uuid",
              runId: "not-a-uuid",
            },
          ]),
        ).resolves.toEqual(
          new Map([
            [
              exportKey,
              { referenced: true, completedAt: exportCompletedAt },
            ],
          ]),
        );
        assertionsCompleted = true;
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    expect(assertionsCompleted).toBe(true);
    await expect(
      handle.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId)),
    ).resolves.toEqual([]);
  });
});
