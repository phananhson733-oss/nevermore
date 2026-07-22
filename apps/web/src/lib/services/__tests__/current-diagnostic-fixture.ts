import { randomUUID } from "node:crypto";
import {
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  ObservationsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type DataSnapshotRow,
  type ProjectScope,
} from "@sf/db";
import type { DbHandle } from "@sf/db/client";
import { asyncRuns } from "@sf/db/schema";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import {
  CRAWL_METHOD_VERSION,
  METRIC_CRAWL_PAGE,
  type CrawlPageProjection,
} from "@sf/sources";
import { buildDiagnosticFrozenInput } from "../diagnostics.ts";

export interface CurrentDiagnosticFixture {
  readonly runId: string;
  readonly collectionRunId: string;
  readonly snapshot: DataSnapshotRow;
  readonly capturedAt: string;
  readonly evidenceSubjectRef: string;
}

/**
 * Seed the minimum honest source chain required by a current DiagnosticRun:
 * connected Crawl source → CollectionRun → immutable DataSnapshot → complete
 * frozen manifest. Callers attach source-backed Evidence to the returned exact
 * snapshot/collection ids and reuse `capturedAt` as `observedAt`.
 */
export async function seedCurrentCrawlDiagnostic(
  handle: DbHandle,
  input: {
    readonly scope: ProjectScope;
    readonly siteId: string;
    readonly actorId: string;
    readonly icp: {
      readonly id: string;
      readonly version: number;
      readonly contentHash: string;
    };
    readonly outputLocale?: string;
  },
): Promise<CurrentDiagnosticFixture> {
  const source = await new SourceConnectionsRepository(
    handle.db,
  ).findConnectedByProvider(input.scope, "crawl");
  if (!source || source.site_id !== input.siteId) {
    throw new Error("fixture requires the exact Site's connected Crawl source");
  }
  const site = await new SitesRepository(handle.db).findById(
    input.scope,
    input.siteId,
  );
  if (!site) throw new Error("fixture Site is missing");

  const capturedAt = new Date().toISOString();
  const collectionRunId = randomUUID();
  const evidenceSubjectRef = `${site.origin}/fixture-not-found-${collectionRunId}`;
  const page: CrawlPageProjection = {
    fetchUrl: evidenceSubjectRef,
    status: 404,
    finalStatus: 404,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: false,
    robotsDirectives: [],
    title: null,
    metaDescription: null,
    h1: [],
    headings: [],
    wordCount: 0,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 1,
    contentType: "text/html",
  };
  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: input.scope.workspaceId,
    project_id: input.scope.projectId,
    kind: "collection",
    status: "completed",
    active_key: null,
    initiated_by: input.actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const collections = new CollectionRunsRepository(handle.db);
  await collections.insertPlaceholder({
    runId: collectionRunId,
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    siteId: input.siteId,
    sourceConnectionId: source.id,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ fixture: collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    siteId: input.siteId,
    collectionRunId,
    sourceConnectionId: source.id,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Deterministic public Crawl integration fixture.",
    rawObjectKey: null,
    rowCount: 1,
    checksum: contentHash(
      { page } as unknown as Parameters<typeof contentHash>[0],
    ),
  });
  await new ObservationsRepository(handle.db).insertMany(
    input.scope,
    snapshot.id,
    "crawl",
    [
      {
        metricKey: METRIC_CRAWL_PAGE,
        subjectType: "url",
        subjectRef: evidenceSubjectRef,
        observedAt: capturedAt,
        availability: "available",
        valueNumeric: null,
        valueText: null,
        valueJson: page,
        unit: null,
        origin: "direct_public",
        grade: "B",
        support: "supports",
        limitation: "Deterministic public Crawl integration fixture.",
      },
    ],
  );
  await collections.finalize(collectionRunId, {
    rowCount: snapshot.row_count,
    sourceWindow: snapshot.source_window,
    providerUsage: { urlsFetched: 1, pagesCollected: 1 },
    stopReason: null,
  });
  await new SourceConnectionsRepository(handle.db).setLastSnapshot(
    source.id,
    snapshot.id,
    snapshot.availability,
    snapshot.limitation,
  );

  const runId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: input.scope.workspaceId,
    project_id: input.scope.projectId,
    kind: "diagnostic",
    status: "completed",
    active_key: null,
    initiated_by: input.actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const frozen = buildDiagnosticFrozenInput({
    projectId: input.scope.projectId,
    siteId: input.siteId,
    icp: input.icp,
    snapshots: [snapshot],
    deliveryLocale: input.outputLocale ?? "en",
  });
  await new DiagnosticRunsRepository(handle.db).insert({
    runId,
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    siteId: input.siteId,
    icpProfileId: input.icp.id,
    icpProfileVersion: input.icp.version,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: input.outputLocale ?? "en",
    inputManifest: frozen.manifest,
    inputHash: frozen.inputHash,
  });

  return {
    runId,
    collectionRunId,
    snapshot,
    capturedAt,
    evidenceSubjectRef,
  };
}
