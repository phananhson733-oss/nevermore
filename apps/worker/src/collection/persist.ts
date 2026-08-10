import { randomBytes } from "node:crypto";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  KeywordGovernanceScheduleRequestsRepository,
  ObservationsRepository,
  projectDataForSeoBacklinkSnapshot,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  StorageObjectReferencesRepository,
  TelemetryRepository,
  type CollectionRunRow,
  type ObservationInsert,
  type RunAttempt,
} from "@sf/db";
import {
  DATAFORSEO_BACKLINKS_DATASET_KEY,
  DATAFORSEO_BACKLINKS_METHOD_VERSION,
  DATAFORSEO_BACKLINKS_OPERATION,
  objectKey,
  parseCrawlSiteLanguageSnapshotSummary,
  projectableSiteLanguageTag,
  SourceError,
  type Availability,
  type BlobPutResult,
  type SourceWindow,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import {
  materializePreparedCrawlPages,
  prepareCrawlPageMaterialization,
} from "./materialize-crawl-pages.ts";
import { resolveObservationSitePageLineage } from "./observation-site-page-lineage.ts";
import { projectCollectionSnapshotKeywords } from "./keyword-library-projection.ts";
import { projectCollectionSnapshotCompetitors } from "./competitor-library-projection.ts";
import { projectCompetitorMonitorSnapshot } from "../competitor-monitor/project-snapshot.ts";

/**
 * Adapter-agnostic collection persistence (spec §7.6, §13.3). The raw payload is
 * uploaded to a final, unguessable Storage key BEFORE the transaction; then, in
 * ONE transaction, the immutable snapshot + observations are written, the run is
 * finalized, the source connection's state/last-snapshot are updated, the async
 * run is set terminal, and a `source_snapshot_ready` event is emitted. The
 * monotonic claim epoch fences a resumed older attempt before canonical writes.
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
    attempt: RunAttempt;
    outcome: CollectionOutcome;
    observations: readonly ObservationInsert[];
    /** Receives the committed durable request id for low-latency dispatch. */
    onKeywordGovernanceScheduleRequest?: (requestId: string) => void;
  },
): Promise<string | null> {
  const { collectionRun: run, outcome } = input;
  const scope = { workspaceId: run.workspace_id, projectId: run.project_id };
  const canonicalSite = await new SitesRepository(ctx.db).findById(
    scope,
    run.site_id,
  );
  if (!canonicalSite) {
    throw new Error("collection Site disappeared before result persistence");
  }
  // Fail closed before Storage/SQL writes if a crawl result is malformed or if
  // its raw facts drift from either the CollectionOutcome or the exact Site row
  // named by this collection run. The expected origin is never taken from raw.
  const crawlPages = prepareCrawlPageMaterialization({
    provider: run.provider,
    outcome,
    ...(run.provider === "crawl"
      ? {
          expectedSite: {
            origin: canonicalSite.origin,
            host: canonicalSite.host,
          },
        }
      : {}),
  });
  const crawlSiteLanguage =
    run.provider === "crawl"
      ? parseCrawlSiteLanguageSnapshotSummary(outcome.summary ?? {})
      : null;
  if (crawlSiteLanguage !== null) {
    const crawlPageUrls = new Set(
      crawlPages.map((page) => page.normalizedUrl),
    );
    if (
      crawlSiteLanguage.pagesAnalyzed !== crawlPages.length ||
      crawlSiteLanguage.evidence.some(
        (sample) => !crawlPageUrls.has(sample.fetchUrl),
      )
    ) {
      throw new SourceError(
        "INVALID_RESPONSE",
        "Crawl site-language snapshot summary is invalid.",
      );
    }
  }

  // The key is known before either side touches Storage, so the writer and
  // orphan cleanup can serialize their final decisions on the same advisory
  // lock. Storage still does not participate in the SQL transaction: upload is
  // external, then canonical writes commit only after the complete bytes exist.
  const nonce = randomBytes(12).toString("hex");
  const key = objectKey({
    projectId: run.project_id,
    runId: run.id,
    kind: "snapshot-raw",
    nonce,
  });
  let put: BlobPutResult | undefined;

  // One transaction-scoped key lock spans external upload and canonical commit.
  // Cleanup takes the same lock around final recheck + delete, so neither side
  // can create a dangling reference even if a project/run lock is contended.
  // On rollback, best-effort delete the just-uploaded orphan object (spec §13.3);
  // the daily orphan cleanup is the backstop.
  let transactionCallbackCompleted = false;
  let keywordGovernanceScheduleRequestId: string | null = null;
  try {
    const snapshotId = await ctx.db.transaction(async (tx) => {
      await new StorageObjectReferencesRepository(
        tx,
      ).lockObjectKeysForTransaction([key]);
      put = await ctx.blobStore.put({
        key,
        body: Buffer.from(JSON.stringify(outcome.raw), "utf8"),
        contentType: "application/json",
      });
      const uploaded = put;

      const asyncRunsRepo = new AsyncRunsRepository(tx);
      if (!(await asyncRunsRepo.lockAttemptForUpdate(input.attempt))) {
        transactionCallbackCompleted = true;
        return null;
      }

      // Worker terminal transactions take the accepted run first, then the
      // project, then mutable child projections. Archival therefore either
      // commits first and freezes those projections, or waits for this accepted
      // completion; immutable snapshot/history and the canonical run still
      // converge in both cases.
      const projects = new ProjectsRepository(tx);
      const project = await projects.findByIdForUpdate(
        { workspaceId: run.workspace_id },
        run.project_id,
      );
      if (!project) {
        throw new Error("collection project disappeared while terminalizing");
      }
      const projectionsMutable = project.archived_at === null;

      const sources = new SourceConnectionsRepository(tx);
      if (run.source_connection_id) {
        const activeSource = await sources.findActiveByIdForUpdate(
          scope,
          run.source_connection_id,
        );
        if (!activeSource) {
          throw new SourceError(
            "AUTH_REQUIRED",
            "Source was disconnected before the collection result could be saved.",
          );
        }
      }

      const discrepancies = new ProviderDiscrepanciesRepository(tx);
      // Equal-window collections must not race past one another's uncommitted
      // observations, otherwise both could miss a real conflict.
      await discrepancies.lockCollectionWindow(
        scope,
        run.provider,
        outcome.sourceWindow as unknown as Record<string, unknown>,
      );

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
        sourceWindow: outcome.sourceWindow as unknown as Record<
          string,
          unknown
        >,
        availability: outcome.availability,
        limitation: outcome.limitation,
        rawObjectKey: uploaded.key,
        rowCount: outcome.rowCount,
        checksum: uploaded.sha256,
        ...(outcome.summary ? { summary: outcome.summary } : {}),
      });

      const crawlExactSitePageIds = await materializePreparedCrawlPages(tx, {
        workspaceId: run.workspace_id,
        projectId: run.project_id,
        siteId: run.site_id,
        dataSnapshotId: snapshot.id,
        capturedAt: outcome.capturedAt,
        pages: crawlPages,
      });

      const observationsWithPageLineage =
        await resolveObservationSitePageLineage({
          tx,
          scope,
          siteId: run.site_id,
          siteOrigin: canonicalSite.origin,
          provider: run.provider,
          observations: input.observations,
          crawlExactSitePageIds,
        });

      await new ObservationsRepository(tx).insertMany(
        scope,
        snapshot.id,
        run.provider,
        observationsWithPageLineage,
      );
      // A multilingual site keeps `conflicting` status, but the crawl still
      // counted which language most of its pages declare, and that plurality
      // is the site's own statement. Without this the project language stays
      // empty forever and every language-scoped provider step skips itself.
      const observedSiteLanguage =
        crawlSiteLanguage === null
          ? null
          : projectableSiteLanguageTag(crawlSiteLanguage);
      if (
        projectionsMutable &&
        canonicalSite.is_primary &&
        outcome.availability === "available" &&
        observedSiteLanguage !== null
      ) {
        await new SitesRepository(tx).projectPrimaryLanguageIfEmpty(
          scope,
          run.site_id,
          observedSiteLanguage,
        );
      }
      const monitorProjection = await projectCompetitorMonitorSnapshot(
        tx,
        scope,
        run.id,
        snapshot.id,
      );
      const isDataForSeoBacklinksSnapshot =
        run.provider === "dataforseo" &&
        run.operation === DATAFORSEO_BACKLINKS_OPERATION &&
        run.method_version === DATAFORSEO_BACKLINKS_METHOD_VERSION &&
        input.datasetKey === DATAFORSEO_BACKLINKS_DATASET_KEY &&
        input.schemaVersion === DATAFORSEO_BACKLINKS_METHOD_VERSION;
      if (
        projectionsMutable &&
        !monitorProjection.isCompetitorMonitor &&
        isDataForSeoBacklinksSnapshot
      ) {
        await projectDataForSeoBacklinkSnapshot(tx, {
          scope,
          siteId: run.site_id,
          dataSnapshot: {
            id: snapshot.id,
            provider: run.provider,
            datasetKey: input.datasetKey,
            methodVersion: run.method_version,
            capturedAt: outcome.capturedAt,
            availability: outcome.availability,
            checksum: uploaded.sha256,
            rowCount: outcome.rowCount,
          },
          observations: observationsWithPageLineage,
        });
      }
      if (
        projectionsMutable &&
        !monitorProjection.isCompetitorMonitor &&
        !isDataForSeoBacklinksSnapshot
      ) {
        await projectCollectionSnapshotKeywords(tx, scope, snapshot);
        await projectCollectionSnapshotCompetitors(tx, scope, snapshot);
      }
      // Backlinks are a live, bounded multi-row index. Many distinct links
      // intentionally share one target subject, so scalar equal-window
      // comparison would turn repeat snapshots into a Cartesian conflict set.
      if (
        !monitorProjection.isCompetitorMonitor &&
        !isDataForSeoBacklinksSnapshot
      ) {
        await discrepancies.detectForSnapshot(scope, snapshot.id);
      }

      await new CollectionRunsRepository(tx).finalize(run.id, {
        rowCount: outcome.rowCount,
        sourceWindow: outcome.sourceWindow as unknown as Record<
          string,
          unknown
        >,
        providerUsage: outcome.providerUsage,
        stopReason: outcome.stopReason,
      });

      if (
        projectionsMutable &&
        !monitorProjection.isCompetitorMonitor &&
        run.source_connection_id
      ) {
        await sources.setLastSnapshot(
          run.source_connection_id,
          snapshot.id,
          outcome.availability,
          outcome.limitation,
        );
      }

      const terminalized = await asyncRunsRepo.setTerminal(input.attempt, {
        status: RUN_STATUS[outcome.availability],
        // result_type CHECK: one of collection_run/diagnostic_run/artifact/export.
        resultType: "collection_run",
        resultId: run.id,
      });
      if (!terminalized) {
        throw new Error("collection attempt ownership changed while locked");
      }
      if (projectionsMutable && !monitorProjection.isCompetitorMonitor) {
        await projects.setReadyToDiagnoseIfEligible(
          { workspaceId: run.workspace_id },
          run.project_id,
        );
      }

      if (
        run.provider === "csv" &&
        run.operation === "keyword_gap_import"
      ) {
        const recorded =
          await new KeywordGovernanceScheduleRequestsRepository(
            tx,
          ).insertRequest(scope, {
            sourceKind: "csv_keyword_gap_import",
            sourceRef: run.id,
            initiatedBy: input.actorId,
          });
        keywordGovernanceScheduleRequestId = recorded.request.id;
      }

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
          competitorMonitor: monitorProjection.isCompetitorMonitor,
        },
      });

      // Drizzle invokes this callback before issuing COMMIT. A later transport
      // error makes the commit result unknowable, so cleanup must not delete an
      // object that the database may now reference.
      transactionCallbackCompleted = true;
      return snapshot.id;
    });
    if (snapshotId === null) {
      // This attempt lost ownership before any canonical write. Its nonce-keyed
      // upload cannot be referenced by another attempt and is safe to remove.
      if (put !== undefined) {
        await ctx.blobStore.delete(put.key).catch(() => {});
      }
    } else if (keywordGovernanceScheduleRequestId !== null) {
      try {
        input.onKeywordGovernanceScheduleRequest?.(
          keywordGovernanceScheduleRequestId,
        );
      } catch {
        // The request is durable; callback failure cannot falsify the source.
      }
    }
    return snapshotId;
  } catch (error) {
    if (!transactionCallbackCompleted && put !== undefined) {
      await ctx.blobStore.delete(put.key).catch(() => {});
    }
    throw error;
  }
}
