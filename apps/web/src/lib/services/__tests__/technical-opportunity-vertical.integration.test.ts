import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RULE_OPPORTUNITY_PROJECTION } from "@sf/contracts";
import { asyncRuns } from "@sf/db/schema";
import {
  ActionsRepository,
  AuditRunsRepository,
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingTargetsRepository,
  ObservationsRepository,
  PageSnapshotsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type CanonicalValue,
  type ProjectScope,
} from "@sf/db";
import {
  CRAWL_METHOD_VERSION,
  METRIC_CRAWL_PAGE,
  subjectUrlOf,
  type CrawlPageProjection,
} from "@sf/sources";
import { reviewProjectFinding } from "@/lib/services/finding-review";
import {
  createActionArtifact,
  listProjectArtifacts,
} from "@/lib/services/artifacts";
import { getProjectOpportunity } from "@/lib/services/opportunities";
import { getProjectAuditUrl } from "@/lib/services/growth-map";
import { createDiagnosticRun } from "@/lib/services/diagnostics";
import type { ArtifactDto } from "@/lib/services/artifact-mappers";
import {
  buildCtx,
  createDbHandle,
  DATABASE_URL,
  DB_AVAILABLE,
  listProjectFindings,
  runArtifact,
  runMissingProviderDiagnostic,
  stopSharedBoss,
  type DbHandle,
  type WorkerContext,
} from "./full-chain-harness.ts";
import { publishDiagnosticGeneration } from "./published-growth-map-fixture.ts";
import {
  CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
  type CrawlPageExtract,
} from "../../../../../worker/src/collection/materialize-crawl-pages.ts";
import { runDiagnostic } from "../../../../../worker/src/diagnostic/run-diagnostic.ts";

/**
 * Vertical proof of the Slice 1 technical delivery chain (Task 7): one measured
 * Finding -> one canonical Action -> one template-fixed Artifact. The chain is
 * driven through the REAL services (finding review, artifact create) and the
 * REAL worker runner, then observed through the canonical read models — no
 * bespoke fixtures, no writes from the read layer. The Execution aggregate view
 * that once mirrored this join was retired with stop gate §19.4; the Artifact
 * list projection is the canonical delivery read model now.
 */

const describeDb = DB_AVAILABLE ? describe : describe.skip;

const READ_SCOPE = (scope: ProjectScope) => ({
  workspaceId: scope.workspaceId,
  uiLocale: "en" as const,
});

async function seedIndexabilitySnapshot(
  handle: DbHandle,
  scope: ProjectScope,
  actor: string,
): Promise<{
  readonly snapshotId: string;
  readonly collectionRunId: string;
  readonly sitePageId: string;
  readonly pageSnapshotId: string;
  readonly observationId: string;
  readonly fetchUrl: string;
}> {
  const site = await new SitesRepository(handle.db).findPrimary(scope);
  if (!site) throw new Error("indexability vertical Site is missing");
  const source = await new SourceConnectionsRepository(
    handle.db,
  ).findConnectedByProvider(scope, "crawl");
  if (!source || source.site_id !== site.id) {
    throw new Error("indexability vertical Crawl source is missing");
  }
  const capturedAt = new Date().toISOString();
  const collectionRunId = randomUUID();
  const fetchUrl = `${site.origin}/pricing`;
  const subjectRef = subjectUrlOf(fetchUrl);
  if (subjectRef !== fetchUrl) {
    throw new Error("indexability vertical URL is not an exact subject URL");
  }
  const page: CrawlPageProjection = {
    fetchUrl,
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: fetchUrl,
    robotsIndexable: false,
    robotsDirectives: ["noindex"],
    title: "Pricing",
    metaDescription: "Pricing for the deterministic integration fixture.",
    h1: ["Pricing"],
    headings: ["Pricing"],
    wordCount: 200,
    internalOutlinks: [],
    jsonLd: { types: ["WebPage"], errorCount: 0 },
    sitemapMember: true,
    bodyExcerpt: "Pricing",
    paragraphs: ["Pricing for growth teams."],
    responseMs: 10,
    contentType: "text/html",
  };

  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "collection",
    status: "completed",
    result_type: "collection_run",
    result_id: collectionRunId,
    initiated_by: actor,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const collections = new CollectionRunsRepository(handle.db);
  await collections.insertPlaceholder({
    runId: collectionRunId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    sourceConnectionId: source.id,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ fixture: collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    collectionRunId,
    sourceConnectionId: source.id,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Deterministic exact Crawl indexability fixture.",
    rawObjectKey: null,
    rowCount: 1,
    checksum: contentHash({ page } as unknown as CanonicalValue),
  });
  const sitePage = await new SitePagesRepository(
    handle.db,
  ).upsertNormalizedUrl({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    normalizedUrl: fetchUrl,
    templateKey: null,
  });
  const extract: CrawlPageExtract = {
    schemaVersion: CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
    subjectUrl: subjectRef,
    depth: 0,
    projection: page,
  };
  const pageSnapshot = await new PageSnapshotsRepository(handle.db).create({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    sitePageId: sitePage.id,
    dataSnapshotId: snapshot.id,
    contentHash: contentHash(extract as CanonicalValue),
    extract,
    capturedAt,
  });
  await new ObservationsRepository(handle.db).insertMany(
    scope,
    snapshot.id,
    "crawl",
    [
      {
        sitePageId: sitePage.id,
        metricKey: METRIC_CRAWL_PAGE,
        subjectType: "url",
        subjectRef,
        observedAt: capturedAt,
        availability: "available",
        valueNumeric: null,
        valueText: null,
        valueJson: page,
        unit: null,
        origin: "direct_public",
        grade: "B",
        support: "supports",
        limitation: "Deterministic exact Crawl indexability fixture.",
      },
    ],
  );
  await collections.finalize(collectionRunId, {
    rowCount: 1,
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
  const observation = (
    await new ObservationsRepository(handle.db).listBySnapshotIds(scope, [
      snapshot.id,
    ])
  ).find((row) => row.subject_ref === fetchUrl);
  if (!observation) {
    throw new Error("indexability vertical Observation is missing");
  }
  return {
    snapshotId: snapshot.id,
    collectionRunId,
    sitePageId: sitePage.id,
    pageSnapshotId: pageSnapshot.id,
    observationId: observation.id,
    fetchUrl,
  };
}

describeDb("technical opportunity vertical single chain", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;
  let scope: ProjectScope;
  let actor: string;
  let primaryFindingId: string;
  let diagnosticRunId: string;
  let manifestKeys: string[];
  let manifestRuleSetVersion: string;
  let manifestContextProjection: unknown;
  let auditProjectionVersion: string;
  let observedIndexabilityFacts: unknown;
  let exactLineage: unknown;
  let expectedExactLineage: unknown;
  let exactEvidenceLineage: unknown;
  let expectedEvidenceLineage: unknown;
  let reviewableReadiness: string;
  let reviewablePreview: unknown;
  let growthMapPreview: unknown;
  let confirmedPreview: unknown;
  let firstActionId: string;
  let replayActionId: string;
  let confirmedArtifactType: string;
  let preConfirmationActionCount: number;
  let preConfirmationArtifactCount: number;
  let postReviewActionCount: number;
  let postReviewArtifactCount: number;
  let confirmedExecutionRef: unknown;
  let deliveredExecutionRef: unknown;
  let deliveredArtifacts: ArtifactDto[];

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    ctx = buildCtx(handle);

    // Reuse the shared project + confirmed ICP fixture, then freeze a new exact
    // Crawl generation whose /pricing response is 200 + sitemap + noindex.
    const base = await runMissingProviderDiagnostic(
      handle,
      ctx,
      "tech-vertical",
    );
    scope = base.scope;
    actor = base.actor;
    const indexability = await seedIndexabilitySnapshot(handle, scope, actor);
    const exactObservation = (
      await new ObservationsRepository(handle.db).listBySnapshotIds(scope, [
        indexability.snapshotId,
      ])
    ).find((row) => row.id === indexability.observationId);
    if (!exactObservation) {
      throw new Error("indexability vertical lost its exact Observation");
    }
    const observedPage = exactObservation.value_json as CrawlPageProjection;
    observedIndexabilityFacts = {
      subjectRef: exactObservation.subject_ref,
      fetchUrl: observedPage.fetchUrl,
      status: observedPage.status,
      finalStatus: observedPage.finalStatus,
      sitemapMember: observedPage.sitemapMember,
      robotsIndexable: observedPage.robotsIndexable,
    };
    expectedExactLineage = {
      relation: "direct_url",
      targetKind: "url",
      targetRef: indexability.fetchUrl,
      resolutionState: "resolved",
      basisKind: "crawl_exact_fetch",
      sitePageId: indexability.sitePageId,
      pageSnapshotId: indexability.pageSnapshotId,
      sourceObservationId: indexability.observationId,
      memberRef: indexability.fetchUrl,
      limitation: null,
    };
    expectedEvidenceLineage = [
      {
        sourceProvider: "crawl",
        snapshotId: indexability.snapshotId,
        collectionRunId: indexability.collectionRunId,
        subjectRefs: [indexability.fetchUrl],
      },
    ];
    const diagnostic = await createDiagnosticRun(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      actor,
      randomUUID(),
      { snapshotIds: [indexability.snapshotId], outputLocale: "en" },
    );
    diagnosticRunId = diagnostic.run.id;
    await runDiagnostic(ctx, {
      runId: diagnosticRunId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });
    const published = await publishDiagnosticGeneration(handle.db, {
      scope,
      diagnosticRunId,
      actorId: actor,
      completedAt: new Date().toISOString(),
    });
    const frozenRun = await new DiagnosticRunsRepository(handle.db).findById(
      scope,
      diagnosticRunId,
    );
    if (!frozenRun) throw new Error("indexability DiagnosticRun is missing");
    manifestKeys = Object.keys(frozenRun.input_manifest).sort();
    manifestRuleSetVersion = frozenRun.rule_set_version;
    manifestContextProjection = frozenRun.input_manifest["contextProjection"];
    const audit = await new AuditRunsRepository(handle.db).findById(
      scope,
      published.auditRunId,
    );
    if (!audit) throw new Error("indexability Growth Audit is missing");
    auditProjectionVersion = audit.projection_version;

    const findings = await listProjectFindings(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      { limit: 100, cursor: null, activeOnly: false },
    );
    const indexabilityFinding = findings.data.find(
      (finding) =>
        finding.ruleId === "TECH-INDEXABILITY-006" &&
        finding.ruleVersion === 1,
    );
    if (!indexabilityFinding) {
      throw new Error("exact sitemap/noindex fixture did not trip indexability");
    }
    primaryFindingId = indexabilityFinding.id;

    const target = (
      await new FindingTargetsRepository(handle.db).listForFindings(
        scope,
        diagnosticRunId,
        [primaryFindingId],
      )
    )[0];
    exactLineage = target
      ? {
          relation: target.relation,
          targetKind: target.target_kind,
          targetRef: target.target_ref,
          resolutionState: target.resolution_state,
          basisKind: target.basis_kind,
          sitePageId: target.site_page_id,
          pageSnapshotId: target.page_snapshot_id,
          sourceObservationId: target.source_observation_id,
          memberRef: target.member_ref,
          limitation: target.limitation,
        }
      : null;
    const evidenceRepository = new EvidenceRepository(handle.db);
    const links = await evidenceRepository.listForFindings(
      scope,
      [primaryFindingId],
      { diagnosticRunId },
    );
    const evidence = await evidenceRepository.findByIds(
      scope,
      links.map((link) => link.evidence_id),
    );
    exactEvidenceLineage = evidence.map((row) => ({
      sourceProvider: row.source_provider,
      snapshotId: row.snapshot_id,
      collectionRunId: row.collection_run_id,
      subjectRefs: row.subject_refs,
    }));

    // Both current read models expose the same non-authoritative preview before
    // confirmation, while Action and Artifact authorities remain empty.
    const reviewable = await getProjectOpportunity(
      READ_SCOPE(scope),
      scope.projectId,
      primaryFindingId,
      handle.db,
    );
    reviewableReadiness = reviewable.data.readiness;
    if (reviewable.data.readiness !== "reviewable") {
      throw new Error("indexability Opportunity was not reviewable");
    }
    reviewablePreview = reviewable.data.executionPreview;
    const growthBefore = await getProjectAuditUrl(
      READ_SCOPE(scope),
      scope.projectId,
      indexability.sitePageId,
      handle.db,
    );
    const growthFindingBefore = growthBefore.data.findings.find(
      (finding) => finding.findingId === primaryFindingId,
    );
    if (!growthFindingBefore) {
      throw new Error("Growth Map omitted the indexability Finding");
    }
    growthMapPreview = growthFindingBefore.executionPreview;
    const actionsRepo = new ActionsRepository(handle.db);
    preConfirmationActionCount = await actionsRepo.countActionsForFinding(
      scope,
      primaryFindingId,
    );
    preConfirmationArtifactCount = (
      await listProjectArtifacts(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        { limit: 100, cursor: null },
      )
    ).data.length;

    // Confirm from the unreviewed base revision (0), then replay from the
    // revision the first confirm produced — idempotent same-Action upsert.
    const firstReview = await reviewProjectFinding(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      primaryFindingId,
      actor,
      {
        reviewState: "confirmed",
        baseRevision: indexabilityFinding.reviewRevision,
      },
    );
    if (!firstReview.action)
      throw new Error("confirm did not create an Action");
    firstActionId = firstReview.action.id;

    const replay = await reviewProjectFinding(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      primaryFindingId,
      actor,
      {
        reviewState: "confirmed",
        baseRevision: firstReview.finding.reviewRevision,
      },
    );
    if (!replay.action) throw new Error("replay did not return the Action");
    replayActionId = replay.action.id;

    const confirmed = await getProjectOpportunity(
      READ_SCOPE(scope),
      scope.projectId,
      primaryFindingId,
      handle.db,
    );
    if (confirmed.data.readiness !== "confirmed") {
      throw new Error("confirmed indexability Opportunity lost its Action");
    }
    confirmedArtifactType = confirmed.data.action.artifactType;
    confirmedPreview = confirmed.data.executionPreview;
    postReviewActionCount = await actionsRepo.countActionsForFinding(
      scope,
      primaryFindingId,
    );
    postReviewArtifactCount = (
      await listProjectArtifacts(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        { limit: 100, cursor: null },
      )
    ).data.length;
    const growthConfirmed = await getProjectAuditUrl(
      READ_SCOPE(scope),
      scope.projectId,
      indexability.sitePageId,
      handle.db,
    );
    confirmedExecutionRef = growthConfirmed.data.findings.find(
      (finding) => finding.findingId === primaryFindingId,
    )?.executionRef;

    // Create and run the one technical ticket the confirmed Action fixes.
    const artifact = await createActionArtifact(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      firstActionId,
      actor,
      randomUUID(),
      {
        artifactType: "technical_ticket",
        generationMode: "template",
        outputLocale: "en",
        operatorInstructions: null,
      },
    );
    await runArtifact(ctx, {
      runId: artifact.run.id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });

    const growthDelivered = await getProjectAuditUrl(
      READ_SCOPE(scope),
      scope.projectId,
      indexability.sitePageId,
      handle.db,
    );
    deliveredExecutionRef = growthDelivered.data.findings.find(
      (finding) => finding.findingId === primaryFindingId,
    )?.executionRef;

    const artifactPage = await listProjectArtifacts(
      { workspaceId: scope.workspaceId },
      scope.projectId,
      { limit: 100, cursor: null },
    );
    deliveredArtifacts = artifactPage.data;
  }, 120_000);

  afterAll(async () => {
    await stopSharedBoss();
    await handle?.end();
  });

  it("freezes current contextual authority and publishes only growth-audit.0.3.1", () => {
    expect(manifestRuleSetVersion).toBe("mvp.rules.0.2.4");
    expect(manifestKeys).toEqual([
      "contextProjection",
      "deliveryLocale",
      "governance",
      "icp",
      "projectId",
      "promptSetVersion",
      "ruleSetVersion",
      "siteId",
      "snapshots",
    ]);
    expect(manifestContextProjection).toMatchObject({
      schemaVersion: "context-projection.v1",
      compilerVersion: "context-projection.compiler.1.0.0",
      siteLanguage: {
        sourceKind: "site",
        state: "declared_non_empty",
        languageCodes: ["en"],
      },
    });
    expect(auditProjectionVersion).toBe("growth-audit.0.3.1");
  });

  it("persists one TECH-INDEXABILITY-006 exact evidence, snapshot, observation, and direct-URL target lineage", () => {
    expect(observedIndexabilityFacts).toEqual({
      subjectRef: expect.stringMatching(/\/pricing$/u),
      fetchUrl: expect.stringMatching(/\/pricing$/u),
      status: 200,
      finalStatus: 200,
      sitemapMember: true,
      robotsIndexable: false,
    });
    expect(exactLineage).toEqual(expectedExactLineage);
    expect(exactEvidenceLineage).toEqual(expectedEvidenceLineage);
  });

  it("surfaces the canonical Finding as reviewable with zero Action and Artifact before confirm", () => {
    expect(reviewableReadiness).toBe("reviewable");
    expect(preConfirmationActionCount).toBe(0);
    expect(preConfirmationArtifactCount).toBe(0);
    expect(reviewablePreview).toEqual(growthMapPreview);
  });

  it("confirm then replay return the same canonical Action and technical ticket type", () => {
    expect(replayActionId).toBe(firstActionId);
    expect(confirmedArtifactType).toBe("technical_ticket");
    // The Artifact type is rule-fixed, never recomputed by the projection.
    expect(
      RULE_OPPORTUNITY_PROJECTION["TECH-INDEXABILITY-006"].artifactType,
    ).toBe("technical_ticket");
  });

  it("keeps preview presentation-only while review atomically creates exactly one canonical Action", () => {
    expect(postReviewActionCount).toBe(1);
    expect(postReviewArtifactCount).toBe(0);
    expect(confirmedPreview).toEqual(reviewablePreview);
    expect(confirmedExecutionRef).toEqual({
      actionId: firstActionId,
      artifactIds: [],
    });
    expect(confirmedPreview).not.toHaveProperty("actionId");
    expect(confirmedPreview).not.toHaveProperty("findingId");
    expect(confirmedPreview).not.toHaveProperty("executionRef");
  });

  it("delivers exactly one template-fixed technical ticket on the canonical Artifact read model", () => {
    expect(deliveredArtifacts).toHaveLength(1);
    const delivered = deliveredArtifacts[0]!;
    expect(delivered.actionId).toBe(firstActionId);
    expect(delivered.artifactType).toBe("technical_ticket");
    expect(delivered.currentRevision).toBe(1);
    expect(delivered.status).not.toBe("archived");
    expect(deliveredExecutionRef).toEqual({
      actionId: firstActionId,
      artifactIds: [delivered.id],
    });
  });
});
