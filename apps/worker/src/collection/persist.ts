import { randomBytes } from "node:crypto";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  ObservationsRepository,
  SourceConnectionsRepository,
  TelemetryRepository,
  type CollectionRunRow,
  type ObservationInsert,
} from "@sf/db";
import { objectKey, type Availability, type SourceWindow } from "@sf/sources";
import type { WorkerContext } from "../context.ts";

/**
 * Adapter-agnostic collection persistence (spec §7.6, §13.3). The raw payload is
 * uploaded to a final, unguessable Storage key BEFORE the transaction; then, in
 * ONE transaction, the immutable snapshot + observations are written, the run is
 * finalized, the source connection's state/last-snapshot are updated, the async
 * run is set terminal, and a `source_snapshot_ready` event is emitted. A retry
 * cannot duplicate the snapshot because the run is claimed (queued→running) once.
 */

export interface CollectionOutcome {
  readonly availability: Availability;
  readonly capturedAt: string;
  readonly sourceWindow: SourceWindow;
  readonly rowCount: number;
  readonly stopReason: string | null;
  readonly providerUsage: Record<string, number>;
  readonly limitation: string;
  readonly raw: unknown;
  readonly summary?: Record<string, unknown>;
}

const RUN_STATUS: Record<Availability, "completed" | "partial"> = {
  available: "completed",
  partial: "partial",
  unavailable: "completed",
};

function durationBucket(ms: number): string {
  if (ms < 5_000) return "under_5s";
  if (ms < 30_000) return "under_30s";
  if (ms < 120_000) return "under_2m";
  if (ms < 600_000) return "under_10m";
  return "over_10m";
}

export async function persistCollectionResult(
  ctx: WorkerContext,
  input: {
    collectionRun: CollectionRunRow;
    datasetKey: string;
    schemaVersion: string;
    actorId: string;
    startedAtMs: number;
    outcome: CollectionOutcome;
    observations: readonly ObservationInsert[];
  },
): Promise<string> {
  const { collectionRun: run, outcome } = input;
  const scope = { workspaceId: run.workspace_id, projectId: run.project_id };

  // 1. Upload raw to a final, non-overwritable key (spec §13.3) BEFORE the tx.
  const nonce = randomBytes(12).toString("hex");
  const key = objectKey({
    projectId: run.project_id,
    runId: run.id,
    kind: "snapshot-raw",
    nonce,
  });
  const put = await ctx.blobStore.put({
    key,
    body: Buffer.from(JSON.stringify(outcome.raw), "utf8"),
    contentType: "application/json",
  });

  // 2. One transaction: snapshot + observations + finalize + connection + terminal.
  return ctx.db.transaction(async (tx) => {
    const snapshot = await new DataSnapshotsRepository(tx).insert({
      workspaceId: run.workspace_id,
      projectId: run.project_id,
      siteId: run.site_id,
      collectionRunId: run.id,
      sourceConnectionId: run.source_connection_id,
      provider: run.provider,
      datasetKey: input.datasetKey,
      schemaVersion: input.schemaVersion,
      methodVersion: run.method_version,
      capturedAt: outcome.capturedAt,
      sourceWindow: outcome.sourceWindow as unknown as Record<string, unknown>,
      availability: outcome.availability,
      limitation: outcome.limitation,
      rawObjectKey: put.key,
      rowCount: outcome.rowCount,
      checksum: put.sha256,
      ...(outcome.summary ? { summary: outcome.summary } : {}),
    });

    await new ObservationsRepository(tx).insertMany(scope, snapshot.id, input.observations);

    await new CollectionRunsRepository(tx).finalize(run.id, {
      rowCount: outcome.rowCount,
      sourceWindow: outcome.sourceWindow as unknown as Record<string, unknown>,
      providerUsage: outcome.providerUsage,
      stopReason: outcome.stopReason,
    });

    if (run.source_connection_id) {
      await new SourceConnectionsRepository(tx).setLastSnapshot(
        run.source_connection_id,
        snapshot.id,
        outcome.availability,
      );
    }

    await new AsyncRunsRepository(tx).setTerminal(run.id, {
      status: RUN_STATUS[outcome.availability],
      resultType: "data_snapshot",
      resultId: snapshot.id,
    });

    await new TelemetryRepository(tx).emit({
      workspaceId: run.workspace_id,
      projectId: run.project_id,
      eventName: "source_snapshot_ready",
      actorId: input.actorId,
      properties: {
        provider: run.provider,
        availability: outcome.availability,
        rowCount: outcome.rowCount,
        durationBucket: durationBucket(Date.now() - input.startedAtMs),
      },
    });

    return snapshot.id;
  });
}
