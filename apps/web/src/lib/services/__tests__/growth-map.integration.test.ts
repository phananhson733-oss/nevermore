import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  asyncRuns,
  diagnosticRuns,
  icpProfiles,
  workspaces,
} from "@sf/db/schema";
import {
  ActionsRepository,
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingTargetsRepository,
  FindingsRepository,
  IcpProfilesRepository,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProjectsRepository,
  SitePagesRepository,
  SourceConnectionsRepository,
  type CanonicalValue,
  type DataSnapshotRow,
  type ObservationRow,
  type ProjectScope,
  type SourceConnectionRow,
} from "@sf/db";
import {
  FINDING_REGISTRY,
  GOVERNANCE_PROJECTION_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import {
  CRAWL_METHOD_VERSION,
  METRIC_CRAWL_PAGE,
  METRIC_GA4_LANDING,
  METRIC_GSC_PAGE,
  type CrawlPageProjection,
} from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDiagnosticFrozenInput } from "@/lib/services/diagnostics";
import {
  getProjectAuditUrl,
  listProjectAuditUrls,
} from "@/lib/services/growth-map";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { publishDiagnosticGeneration } from "./published-growth-map-fixture.ts";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const CAPTURED_AT = "2026-07-22T02:00:00.000Z";
const PROJECTED_AT = new Date("2026-07-22T12:00:00.000Z");

function growthMapScope(scope: ProjectScope, uiLocale: "en" | "zh-CN" = "zh-CN") {
  return { workspaceId: scope.workspaceId, uiLocale };
}

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

interface SeededPage {
  readonly id: string;
  readonly normalizedUrl: string;
}

interface Fixture {
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly runId: string;
  readonly crawlSnapshotId: string;
  readonly pricing: SeededPage;
  readonly docs: SeededPage;
  readonly analyticsOnly: SeededPage;
  readonly outsideFrozenRun: SeededPage;
  readonly pricingPageSnapshotId: string;
  readonly aggregateFindingId: string;
  readonly directFindingId: string;
  readonly excludedFindingIds: readonly string[];
  readonly aggregateEvidenceId: string;
  readonly directEvidenceId: string;
  readonly actionId: string;
  readonly artifactId: string;
}

function crawlPage(fetchUrl: string, title: string): CrawlPageProjection {
  return {
    fetchUrl,
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: fetchUrl,
    robotsIndexable: true,
    robotsDirectives: [],
    title,
    metaDescription: `${title} meta description`,
    h1: [title],
    headings: [title],
    wordCount: 850,
    internalOutlinks: [],
    jsonLd: { types: ["WebPage"], errorCount: 0 },
    sitemapMember: true,
    bodyExcerpt: `${title} body excerpt`,
    paragraphs: [`${title} first paragraph`],
    responseMs: 125,
    contentType: "text/html",
  };
}

async function seedSnapshot(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  actor: string,
  source: SourceConnectionRow,
  input: {
    readonly provider: "crawl" | "gsc" | "ga4";
    readonly datasetKey: string;
    readonly methodVersion: string;
    readonly operation: string;
    readonly rowCount: number;
  },
): Promise<DataSnapshotRow> {
  const collectionRunId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "collection",
    status: "completed",
    result_type: "collection_run",
    result_id: collectionRunId,
    active_key: null,
    initiated_by: actor,
    started_at: CAPTURED_AT,
    completed_at: CAPTURED_AT,
  });
  const runs = new CollectionRunsRepository(handle.db);
  await runs.insertPlaceholder({
    runId: collectionRunId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: source.id,
    provider: input.provider,
    operation: input.operation,
    methodVersion: input.methodVersion,
    parametersHash: contentHash({ provider: input.provider, fixture: true }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    collectionRunId,
    sourceConnectionId: source.id,
    provider: input.provider,
    datasetKey: input.datasetKey,
    schemaVersion: "0.3.0",
    methodVersion: input.methodVersion,
    capturedAt: CAPTURED_AT,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: `${input.provider.toUpperCase()} fixture snapshot.`,
    rawObjectKey: null,
    rowCount: input.rowCount,
    checksum: contentHash({
      provider: input.provider,
      capturedAt: CAPTURED_AT,
      nonce: randomUUID(),
    }),
  });
  await runs.finalize(collectionRunId, {
    rowCount: input.rowCount,
    sourceWindow: snapshot.source_window,
    providerUsage: { rowsCollected: input.rowCount },
    stopReason: null,
  });
  await new SourceConnectionsRepository(handle.db).setLastSnapshot(
    source.id,
    snapshot.id,
    "available",
    snapshot.limitation,
  );
  return snapshot;
}

async function observationBy(
  handle: DbHandle,
  scope: ProjectScope,
  snapshotId: string,
  predicate: (row: ObservationRow) => boolean,
): Promise<ObservationRow> {
  const row = (
    await new ObservationsRepository(handle.db).listBySnapshotIds(scope, [
      snapshotId,
    ])
  ).find(predicate);
  if (!row) throw new Error("Growth Map integration Observation was not seeded");
  return row;
}

describeDb("Growth Map frozen URL portfolio and detail service", () => {
  let handle: DbHandle;
  let fixture: Fixture;
  const actor = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Growth Map ${randomUUID()}` })
      .returning();
    const created = await createProject(
      { workspaceId: workspace!.id },
      actor,
      randomUUID(),
      {
        clientName: "Growth Map Customer",
        projectName: "Frozen URL Portfolio",
        siteUrl: `https://growth-map-${randomUUID()}.example`,
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "zh-CN",
      },
      safeGuard,
    );
    const scope = {
      workspaceId: workspace!.id,
      projectId: created.project.id,
    };
    const siteId = created.project.site.id;
    const origin = created.project.site.origin;

    const [icp] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        version: 2,
        status: "complete",
        profile: {
          productName: "RelayOps",
          siteLanguageCodes: ["en"],
          primaryMarket: "US",
        },
        content_hash: contentHash({ profile: "growth-map-fixture" }),
        created_by: actor,
      })
      .returning();
    const projects = new ProjectsRepository(handle.db);
    if (
      !(await projects.setCurrentIcpProfile(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        icp!.id,
      )) ||
      !(await projects.setConfirmedIcpProfile(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        icp!.id,
      ))
    ) {
      throw new Error("Growth Map fixture could not confirm its Product Profile");
    }

    const sources = new SourceConnectionsRepository(handle.db);
    const crawlSource = await sources.findConnectedByProvider(scope, "crawl");
    if (!crawlSource) throw new Error("Default Crawl source was not created");
    const gscSource = await sources.insertConnection({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      provider: "gsc",
      connectionType: "oauth",
      state: "connected",
      externalRef: "sc-domain:growth-map.example",
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
      config: { propertyType: "domain" },
      limitation: "Search Console fixture connection.",
      connectedAt: true,
      createdBy: actor,
    });
    const ga4Source = await sources.insertConnection({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      provider: "ga4",
      connectionType: "oauth",
      state: "connected",
      externalRef: "properties/123456",
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      config: { propertyId: "123456" },
      limitation: "GA4 fixture connection.",
      connectedAt: true,
      createdBy: actor,
    });

    const crawlSnapshot = await seedSnapshot(
      handle,
      scope,
      siteId,
      actor,
      crawlSource,
      {
        provider: "crawl",
        datasetKey: "crawl.site_graph.v1",
        methodVersion: CRAWL_METHOD_VERSION,
        operation: "site_graph",
        rowCount: 2,
      },
    );
    const gscSnapshot = await seedSnapshot(
      handle,
      scope,
      siteId,
      actor,
      gscSource,
      {
        provider: "gsc",
        datasetKey: "gsc.page_query_daily.v1",
        methodVersion: "gsc.page_query_daily.v1",
        operation: "search_analytics",
        rowCount: 3,
      },
    );
    const ga4Snapshot = await seedSnapshot(
      handle,
      scope,
      siteId,
      actor,
      ga4Source,
      {
        provider: "ga4",
        datasetKey: "ga4.organic_landing_daily.v1",
        methodVersion: "ga4.organic_landing_daily.v1",
        operation: "organic_landing",
        rowCount: 1,
      },
    );

    const sitePages = new SitePagesRepository(handle.db);
    const pricingRow = await sitePages.upsertNormalizedUrl({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: `${origin}/pricing/`,
      templateKey: null,
    });
    const docsRow = await sitePages.upsertNormalizedUrl({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: `${origin}/docs/`,
      templateKey: null,
    });
    const analyticsRow = await sitePages.upsertNormalizedUrl({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: `${origin}/analytics-only/`,
      templateKey: null,
    });
    // Two exact slash variants make the later GSC row genuinely ambiguous;
    // the immutable Observation therefore cannot claim either SitePage.
    const unresolvedSubject = `${origin}/ambiguous-search-row`;
    await sitePages.upsertNormalizedUrl({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: unresolvedSubject,
      templateKey: null,
    });
    await sitePages.upsertNormalizedUrl({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: `${unresolvedSubject}/`,
      templateKey: null,
    });
    const pricing: SeededPage = {
      id: pricingRow.id,
      normalizedUrl: pricingRow.normalized_url,
    };
    const docs: SeededPage = {
      id: docsRow.id,
      normalizedUrl: docsRow.normalized_url,
    };
    const analyticsOnly: SeededPage = {
      id: analyticsRow.id,
      normalizedUrl: analyticsRow.normalized_url,
    };

    const pageSnapshots = new PageSnapshotsRepository(handle.db);
    const crawlObservations = new ObservationsRepository(handle.db);
    const crawlInputs = [
      { page: pricing, projection: crawlPage(pricing.normalizedUrl, "Pricing for B2B Teams") },
      { page: docs, projection: crawlPage(docs.normalizedUrl, "Implementation Docs") },
    ] as const;
    const pageSnapshotBySitePage = new Map<string, string>();
    for (const input of crawlInputs) {
      const subjectUrl = input.page.normalizedUrl.slice(0, -1);
      const extract = {
        schemaVersion: "crawl.page-extract.v1",
        subjectUrl,
        depth: 1,
        projection: input.projection,
      };
      const pageSnapshot = await pageSnapshots.create({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        sitePageId: input.page.id,
        dataSnapshotId: crawlSnapshot.id,
        contentHash: contentHash(extract as unknown as CanonicalValue),
        extract,
        capturedAt: CAPTURED_AT,
      });
      pageSnapshotBySitePage.set(input.page.id, pageSnapshot.id);
    }
    await crawlObservations.insertMany(
      scope,
      crawlSnapshot.id,
      "crawl",
      crawlInputs.map((input) => ({
        sitePageId: input.page.id,
        metricKey: METRIC_CRAWL_PAGE,
        subjectType: "url",
        subjectRef: input.page.normalizedUrl.slice(0, -1),
        observedAt: CAPTURED_AT,
        availability: "available",
        valueNumeric: null,
        valueText: null,
        valueJson: input.projection,
        unit: null,
        origin: "direct_public",
        grade: "B",
        support: "supports",
        limitation: "Exact public Crawl response.",
      })),
    );

    const pricingSubject = pricing.normalizedUrl.slice(0, -1);
    const analyticsSubject = analyticsOnly.normalizedUrl.slice(0, -1);
    await new ObservationsRepository(handle.db).insertMany(
      scope,
      gscSnapshot.id,
      "gsc",
      [
        {
          sitePageId: pricing.id,
          metricKey: METRIC_GSC_PAGE,
          subjectType: "url",
          subjectRef: pricingSubject,
          observedAt: CAPTURED_AT,
          availability: "available",
          valueNumeric: null,
          valueText: null,
          valueJson: {
            current28d: { clicks: 0, impressions: 1_200, position: 4.2 },
            previous28d: { clicks: 32, impressions: 1_100, position: 4.1 },
          },
          unit: null,
          origin: "first_party",
          grade: "A",
          support: "supports",
          limitation: "Search Console page aggregation.",
        },
        {
          sitePageId: analyticsOnly.id,
          metricKey: METRIC_GSC_PAGE,
          subjectType: "url",
          subjectRef: analyticsSubject,
          observedAt: CAPTURED_AT,
          availability: "available",
          valueNumeric: null,
          valueText: null,
          valueJson: {
            current28d: { clicks: 7, impressions: 280, position: 9.1 },
            previous28d: { clicks: 5, impressions: 240, position: 10.2 },
          },
          unit: null,
          origin: "first_party",
          grade: "A",
          support: "supports",
          limitation: "Search Console page aggregation.",
        },
        {
          sitePageId: null,
          metricKey: METRIC_GSC_PAGE,
          subjectType: "url",
          subjectRef: unresolvedSubject,
          observedAt: CAPTURED_AT,
          availability: "available",
          valueNumeric: null,
          valueText: null,
          valueJson: {
            current28d: { clicks: 2, impressions: 250, position: 8.8 },
            previous28d: { clicks: 12, impressions: 300, position: 7.9 },
          },
          unit: null,
          origin: "first_party",
          grade: "A",
          support: "supports",
          limitation: "Canonical SitePage resolution is ambiguous.",
        },
      ],
    );
    await new ObservationsRepository(handle.db).insertMany(
      scope,
      ga4Snapshot.id,
      "ga4",
      [
        {
          sitePageId: pricing.id,
          metricKey: METRIC_GA4_LANDING,
          subjectType: "url",
          subjectRef: pricingSubject,
          observedAt: CAPTURED_AT,
          availability: "available",
          valueNumeric: null,
          valueText: null,
          valueJson: {
            sessions: 145,
            engagedSessions: 101,
            engagementRate: 0.6965,
            keyEvents: 9,
          },
          unit: null,
          origin: "first_party",
          grade: "A",
          support: "supports",
          limitation: "GA4 organic landing-page aggregation.",
        },
      ],
    );

    const frozen = buildDiagnosticFrozenInput({
      projectId: scope.projectId,
      siteId,
      icp: {
        id: icp!.id,
        version: icp!.version,
        contentHash: icp!.content_hash,
      },
      snapshots: [crawlSnapshot, gscSnapshot, ga4Snapshot],
      deliveryLocale: "en-US",
      governance: {
        projectionVersion: GOVERNANCE_PROJECTION_VERSION,
        keywordClusters: [],
        competitors: [],
      },
    });
    const runId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: runId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "completed",
      result_type: "diagnostic_run",
      result_id: runId,
      active_key: null,
      initiated_by: actor,
      started_at: CAPTURED_AT,
      completed_at: CAPTURED_AT,
    });
    await new DiagnosticRunsRepository(handle.db).insert({
      runId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      icpProfileId: icp!.id,
      icpProfileVersion: icp!.version,
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      outputLocale: "en-US",
      inputManifest: frozen.manifest,
      inputHash: frozen.inputHash,
    });
    await publishDiagnosticGeneration(handle.db, {
      scope,
      diagnosticRunId: runId,
      actorId: actor,
      completedAt: CAPTURED_AT,
    });

    const findingRepo = new FindingsRepository(handle.db);
    const insertFinding = async (input: {
      readonly name: string;
      readonly ruleId:
        | "TECH-LINKGRAPH-005"
        | "SEARCH-CTR-004"
        | "SEARCH-DECAY-002"
        | "CONTENT-GAP-011";
      readonly ruleVersion: number;
      readonly summary: string;
      readonly severity: "high" | "medium";
      readonly reviewState: "confirmed" | "unreviewed";
      readonly subjectRefs: readonly string[];
    }) => {
      const meta = FINDING_REGISTRY[input.ruleId];
      return findingRepo.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        findingKey: contentHash({ finding: input.name, runId }),
        ruleId: input.ruleId,
        ruleVersion: input.ruleVersion,
        ruleFamily: meta.ruleFamily,
        intent: meta.intent,
        domain: meta.domain,
        titleKey: meta.titleKey,
        titleArgs: {},
        summary: input.summary,
        summaryLocale: "en",
        subjectRefs: [...input.subjectRefs],
        severity: input.severity,
        confidence: "high",
        reviewState: input.reviewState,
        runId,
        seenAt: CAPTURED_AT,
      });
    };
    const aggregateFinding = await insertFinding({
      name: "aggregate",
      ruleId: "TECH-LINKGRAPH-005",
      ruleVersion: 3,
      summary: "Two commercial pages have insufficient internal-link support.",
      severity: "medium",
      reviewState: "unreviewed",
      subjectRefs: ["private-subject-ref-must-not-drive-membership"],
    });
    const directFinding = await insertFinding({
      name: "direct",
      ruleId: "SEARCH-CTR-004",
      ruleVersion: 1,
      summary: "The pricing page has impressions but a low organic click-through rate.",
      severity: "high",
      reviewState: "confirmed",
      subjectRefs: ["https://private.invalid/not-the-target"],
    });
    const unresolvedFinding = await insertFinding({
      name: "unresolved",
      ruleId: "SEARCH-DECAY-002",
      ruleVersion: 1,
      summary: "A search-decay signal cannot be safely mapped to a SitePage.",
      severity: "high",
      reviewState: "unreviewed",
      subjectRefs: [unresolvedSubject],
    });
    const definitionFinding = await insertFinding({
      name: "definition",
      ruleId: "CONTENT-GAP-011",
      ruleVersion: 2,
      summary: "The keyword cluster has no corresponding content.",
      severity: "medium",
      reviewState: "unreviewed",
      subjectRefs: ["keyword_cluster:customer_onboarding"],
    });

    const pricingCrawlObservation = await observationBy(
      handle,
      scope,
      crawlSnapshot.id,
      (row) => row.site_page_id === pricing.id,
    );
    const docsCrawlObservation = await observationBy(
      handle,
      scope,
      crawlSnapshot.id,
      (row) => row.site_page_id === docs.id,
    );
    const pricingGscObservation = await observationBy(
      handle,
      scope,
      gscSnapshot.id,
      (row) => row.site_page_id === pricing.id,
    );
    const unresolvedGscObservation = await observationBy(
      handle,
      scope,
      gscSnapshot.id,
      (row) => row.subject_ref === unresolvedSubject,
    );
    const pricingPageSnapshotId = pageSnapshotBySitePage.get(pricing.id);
    const docsPageSnapshotId = pageSnapshotBySitePage.get(docs.id);
    if (!pricingPageSnapshotId || !docsPageSnapshotId) {
      throw new Error("Growth Map PageSnapshot fixture is incomplete");
    }
    await new FindingTargetsRepository(handle.db).insertMany(scope, [
      {
        siteId,
        findingId: aggregateFinding.id,
        diagnosticRunId: runId,
        relation: "affected_by_page_set",
        targetKind: "page_set",
        targetRef: "commercial_pages_with_low_internal_inlinks",
        resolutionState: "resolved",
        basisKind: "crawl_exact_fetch",
        sitePageId: pricing.id,
        pageSnapshotId: pricingPageSnapshotId,
        sourceObservationId: pricingCrawlObservation.id,
        memberRef: pricing.normalizedUrl,
        limitation: null,
      },
      {
        siteId,
        findingId: aggregateFinding.id,
        diagnosticRunId: runId,
        relation: "affected_by_page_set",
        targetKind: "page_set",
        targetRef: "commercial_pages_with_low_internal_inlinks",
        resolutionState: "resolved",
        basisKind: "crawl_exact_fetch",
        sitePageId: docs.id,
        pageSnapshotId: docsPageSnapshotId,
        sourceObservationId: docsCrawlObservation.id,
        memberRef: docs.normalizedUrl,
        limitation: null,
      },
      {
        siteId,
        findingId: directFinding.id,
        diagnosticRunId: runId,
        relation: "direct_url",
        targetKind: "url",
        targetRef: pricing.normalizedUrl,
        resolutionState: "resolved",
        basisKind: "observation_site_page",
        sitePageId: pricing.id,
        pageSnapshotId: pricingPageSnapshotId,
        sourceObservationId: pricingGscObservation.id,
        memberRef: pricingSubject,
        limitation: null,
      },
      {
        siteId,
        findingId: unresolvedFinding.id,
        diagnosticRunId: runId,
        relation: "direct_url",
        targetKind: "url",
        targetRef: unresolvedSubject,
        resolutionState: "unresolved",
        basisKind: "unresolved_observation",
        sitePageId: null,
        pageSnapshotId: null,
        sourceObservationId: unresolvedGscObservation.id,
        memberRef: unresolvedSubject,
        limitation: "Canonical SitePage resolution is ambiguous.",
      },
      {
        siteId,
        findingId: definitionFinding.id,
        diagnosticRunId: runId,
        relation: "affected_by_keyword_cluster",
        targetKind: "keyword_cluster",
        targetRef: "customer_onboarding",
        resolutionState: "definition_only",
        basisKind: "target_definition",
        sitePageId: null,
        pageSnapshotId: null,
        sourceObservationId: null,
        memberRef: null,
        limitation: null,
      },
    ]);

    const evidence = new EvidenceRepository(handle.db);
    const [aggregateEvidenceId, directEvidenceId] = await evidence.insertMany(
      {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        diagnosticRunId: runId,
      },
      [
        {
          sourceProvider: "crawl",
          origin: "direct_public",
          method: "observed",
          grade: "B",
          availability: "available",
          support: "supports",
          subjectRefs: [pricing.normalizedUrl, docs.normalizedUrl],
          claim: "The two pages have insufficient internal-link support.",
          observedAt: CAPTURED_AT,
          limitation: "Bounded public crawl.",
          snapshotId: crawlSnapshot.id,
          collectionRunId: crawlSnapshot.collection_run_id,
        },
        {
          sourceProvider: "gsc",
          origin: "first_party",
          method: "observed",
          grade: "A",
          availability: "available",
          support: "supports",
          subjectRefs: [pricingSubject],
          claim: "The pricing page has impressions and zero observed clicks.",
          observedAt: CAPTURED_AT,
          limitation: "Search Console page aggregation.",
          snapshotId: gscSnapshot.id,
          collectionRunId: gscSnapshot.collection_run_id,
        },
      ],
    );
    if (!aggregateEvidenceId || !directEvidenceId) {
      throw new Error("Growth Map Evidence fixture is incomplete");
    }
    await evidence.linkObservations(
      {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        diagnosticRunId: runId,
      },
      [
        {
          findingId: aggregateFinding.id,
          evidenceId: aggregateEvidenceId,
          role: "primary",
        },
        {
          findingId: directFinding.id,
          evidenceId: directEvidenceId,
          role: "primary",
        },
      ],
    );

    const action = await new ActionsRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      sourceFindingId: directFinding.id,
      sourceDiagnosticRunId: runId,
      actionKey: contentHash({ action: directFinding.id }),
      templateId: "rewrite_search_metadata.v1",
      templateVersion: 1,
      title: "Rewrite pricing search metadata",
      description: "Rewrite customer-facing title and description copy.",
      contentLocale: "en",
      priorityBand: "high",
      roadmapLane: "now",
      status: "planned",
      effort: "small",
      risk: "low",
      expectedOutcome: "Earn more qualified organic clicks.",
      evidenceRefs: [directEvidenceId],
      createdBy: actor,
    });
    const artifactId = randomUUID();
    const artifactRunId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: artifactRunId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "artifact_generation",
      status: "queued",
      active_key: null,
      initiated_by: actor,
      request_payload: {
        artifactId,
        actionId: action.id,
        artifactType: "metadata_rewrite",
        generationMode: "template",
        outputLocale: "en",
        operatorInstructions: null,
        sourceDiagnosticRunId: runId,
        sourceIcpProfileId: icp!.id,
      },
    });
    await new ExecutionArtifactsRepository(handle.db).insert({
      id: artifactId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actionId: action.id,
      artifactType: "metadata_rewrite",
      generationMode: "template",
      outputLocale: "en",
      latestGenerationRunId: artifactRunId,
      createdBy: actor,
    });

    const outsideRow = await sitePages.upsertNormalizedUrl({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: `${origin}/created-after-audit/`,
      templateKey: null,
    });

    // A newer non-terminal run must not replace the latest readable audit.
    const runningRunId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: runningRunId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "running",
      active_key: null,
      initiated_by: actor,
      started_at: CAPTURED_AT,
    });
    await new DiagnosticRunsRepository(handle.db).insert({
      runId: runningRunId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      icpProfileId: icp!.id,
      icpProfileVersion: icp!.version,
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      outputLocale: "en-US",
      inputManifest: frozen.manifest,
      inputHash: frozen.inputHash,
    });

    fixture = {
      scope,
      siteId,
      runId,
      crawlSnapshotId: crawlSnapshot.id,
      pricing,
      docs,
      analyticsOnly,
      outsideFrozenRun: {
        id: outsideRow.id,
        normalizedUrl: outsideRow.normalized_url,
      },
      pricingPageSnapshotId,
      aggregateFindingId: aggregateFinding.id,
      directFindingId: directFinding.id,
      excludedFindingIds: [unresolvedFinding.id, definitionFinding.id],
      aggregateEvidenceId,
      directEvidenceId,
      actionId: action.id,
      artifactId,
    };
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("projects only frozen URLs with Opportunities without manufacturing missing values", async () => {
    const result = await listProjectAuditUrls(
      growthMapScope(fixture.scope),
      fixture.scope.projectId,
      { limit: 100, cursor: null, now: PROJECTED_AT },
      handle.db,
    );

    expect(result).toMatchObject({
      projectId: fixture.scope.projectId,
      siteId: fixture.siteId,
      diagnosticRunId: fixture.runId,
      crawlSnapshotId: fixture.crawlSnapshotId,
      meta: { hasNext: false, nextCursor: null, limit: 100 },
    });
    expect(result.data).toHaveLength(2);
    const byId = new Map(result.data.map((row) => [row.sitePageId, row]));
    const pricing = byId.get(fixture.pricing.id)!;
    const docs = byId.get(fixture.docs.id)!;
    expect(byId.has(fixture.analyticsOnly.id)).toBe(false);
    expect(result.data.map((row) => row.sitePageId)).toEqual([
      fixture.pricing.id,
      fixture.docs.id,
    ]);

    expect(pricing).toMatchObject({
      normalizedUrl: fixture.pricing.normalizedUrl,
      title: "Pricing for B2B Teams",
      pageSnapshotId: fixture.pricingPageSnapshotId,
      coverage: { availability: "available", limitations: [] },
      priority: { availability: "available", value: "high" },
      delta: { availability: "unavailable", value: null },
    });
    expect(pricing.delta.limitation).toBe(
      "该 URL 尚无两个不可变复查锚点，无法计算变化。",
    );
    expect(new Set(pricing.findingIds)).toEqual(
      new Set([fixture.aggregateFindingId, fixture.directFindingId]),
    );
    expect(
      pricing.metricObservations.find(
        (metric) =>
          metric.provider === "gsc" &&
          metric.valueSource.kind === "value_json" &&
          metric.valueSource.pointer === "/current28d/clicks",
      ),
    ).toMatchObject({ value: 0, availability: "available" });

    expect(docs).toMatchObject({
      normalizedUrl: fixture.docs.normalizedUrl,
      title: "Implementation Docs",
      coverage: { availability: "partial" },
      findingIds: [fixture.aggregateFindingId],
      priority: { availability: "available", value: "medium" },
    });
    expect(docs.metricObservations.every((metric) => metric.provider === "crawl"))
      .toBe(true);
    expect(JSON.stringify(docs.metricObservations)).not.toContain('"value":0');
    expect(docs.coverage.limitations).toEqual([
      "该页面没有可用的冻结 GSC URL Observation。",
      "该页面没有可用的冻结 GA4 URL Observation。",
    ]);

    const serialized = JSON.stringify(result);
    for (const findingId of fixture.excludedFindingIds) {
      expect(serialized).not.toContain(findingId);
    }
    expect(serialized).not.toContain("private-subject-ref-must-not-drive-membership");
    expect(serialized).not.toContain("https://private.invalid/not-the-target");
  });

  it("paginates the multi-URL inventory with its canonical keyset", async () => {
    const first = await listProjectAuditUrls(
      growthMapScope(fixture.scope),
      fixture.scope.projectId,
      { limit: 1, cursor: null, now: PROJECTED_AT },
      handle.db,
    );
    expect(first.data).toHaveLength(1);
    expect(first.meta).toMatchObject({ hasNext: true });
    expect(first.meta.nextCursor).not.toBeNull();

    const second = await listProjectAuditUrls(
      growthMapScope(fixture.scope),
      fixture.scope.projectId,
      { limit: 1, cursor: first.meta.nextCursor, now: PROJECTED_AT },
      handle.db,
    );
    expect(second.data).toHaveLength(1);
    expect(second.meta).toMatchObject({ hasNext: false, nextCursor: null });
    expect(
      new Set([...first.data, ...second.data].map((row) => row.sitePageId)),
    ).toEqual(
      new Set([
        fixture.pricing.id,
        fixture.docs.id,
      ]),
    );
  });

  it("returns exact target, Evidence, Action, and Artifact IDs in URL detail", async () => {
    const result = await getProjectAuditUrl(
      growthMapScope(fixture.scope),
      fixture.scope.projectId,
      fixture.pricing.id,
      handle.db,
    );
    expect(result).toMatchObject({
      projectId: fixture.scope.projectId,
      siteId: fixture.siteId,
      diagnosticRunId: fixture.runId,
      data: {
        sitePageId: fixture.pricing.id,
        normalizedUrl: fixture.pricing.normalizedUrl,
      },
    });
    const findings = new Map(
      result.data.findings.map((finding) => [finding.findingId, finding]),
    );
    const aggregate = findings.get(fixture.aggregateFindingId)!;
    const direct = findings.get(fixture.directFindingId)!;
    expect(aggregate).toMatchObject({
      title: "Two commercial pages have insufficient internal-link support.",
      reviewRevision: 0,
      evidenceIds: [fixture.aggregateEvidenceId],
      targetRelation: {
        relation: "affected_by_page_set",
        targetKind: "page_set",
        targetRef: "commercial_pages_with_low_internal_inlinks",
      },
      executionRef: null,
    });
    expect(direct).toMatchObject({
      title:
        "The pricing page has impressions but a low organic click-through rate.",
      reviewRevision: 0,
      evidenceIds: [fixture.directEvidenceId],
      targetRelation: {
        relation: "direct_url",
        targetKind: "url",
        targetRef: fixture.pricing.normalizedUrl,
        sitePageId: fixture.pricing.id,
        pageSnapshotId: fixture.pricingPageSnapshotId,
      },
      executionRef: {
        actionId: fixture.actionId,
        artifactIds: [fixture.artifactId],
      },
    });
    expect(Object.keys(direct.executionRef!).sort()).toEqual([
      "actionId",
      "artifactIds",
    ]);
    for (const findingId of fixture.excludedFindingIds) {
      expect(findings.has(findingId)).toBe(false);
    }

    const docsResult = await getProjectAuditUrl(
      growthMapScope(fixture.scope),
      fixture.scope.projectId,
      fixture.docs.id,
      handle.db,
    );
    expect(docsResult.data).toMatchObject({
      sitePageId: fixture.docs.id,
      normalizedUrl: fixture.docs.normalizedUrl,
      title: "Implementation Docs",
      findingIds: [fixture.aggregateFindingId],
    });
    expect(docsResult.data.findings.map((finding) => finding.findingId)).toEqual([
      fixture.aggregateFindingId,
    ]);
    expect(docsResult.data.sitePageId).not.toBe(result.data.sitePageId);
    expect(docsResult.data.normalizedUrl).not.toBe(result.data.normalizedUrl);
    expect(docsResult.data.title).not.toBe(result.data.title);
  });

  it("rejects a current mutable SitePage that was not frozen into the audit", async () => {
    await expect(
      getProjectAuditUrl(
        growthMapScope(fixture.scope),
        fixture.scope.projectId,
        fixture.outsideFrozenRun.id,
        handle.db,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("uses zh-CN chrome copy with the latest en-US audit while preserving persisted English Finding content", async () => {
    const zhList = await listProjectAuditUrls(
      growthMapScope(fixture.scope, "zh-CN"),
      fixture.scope.projectId,
      { limit: 100, cursor: null, now: PROJECTED_AT },
      handle.db,
    );
    expect(zhList.diagnosticRunId).toBe(fixture.runId);

    const zhDetail = await getProjectAuditUrl(
      growthMapScope(fixture.scope, "zh-CN"),
      fixture.scope.projectId,
      fixture.pricing.id,
      handle.db,
    );
    expect(zhDetail.diagnosticRunId).toBe(fixture.runId);

    const enList = await listProjectAuditUrls(
      growthMapScope(fixture.scope, "en"),
      fixture.scope.projectId,
      { limit: 100, cursor: null, now: PROJECTED_AT },
      handle.db,
    );
    const enDetail = await getProjectAuditUrl(
      growthMapScope(fixture.scope, "en"),
      fixture.scope.projectId,
      fixture.pricing.id,
      handle.db,
    );

    expect(enList.diagnosticRunId).toBe(fixture.runId);
    expect(enDetail.diagnosticRunId).toBe(fixture.runId);
    expect(zhDetail.data.findings.map((finding) => finding.title)).toEqual(
      enDetail.data.findings.map((finding) => finding.title),
    );
    expect(
      zhDetail.data.findings.map((finding) => finding.title).sort(),
    ).toEqual(
      [
        "Two commercial pages have insufficient internal-link support.",
        "The pricing page has impressions but a low organic click-through rate.",
      ].sort(),
    );
    expect(
      zhDetail.data.metricObservations.map((metric) => metric.limitation),
    ).toEqual(
      enDetail.data.metricObservations.map((metric) => metric.limitation),
    );
    expect(
      zhDetail.data.metricObservations.some(
        (metric) =>
          metric.provider === "gsc" &&
          metric.limitation === "Search Console page aggregation.",
      ),
    ).toBe(true);

    const zhDocs = zhList.data.find((row) => row.sitePageId === fixture.docs.id);
    const enDocs = enList.data.find((row) => row.sitePageId === fixture.docs.id);
    expect(zhDocs?.coverage.limitations).toEqual([
      "该页面没有可用的冻结 GSC URL Observation。",
      "该页面没有可用的冻结 GA4 URL Observation。",
    ]);
    expect(enDocs?.coverage.limitations).toEqual([
      "No frozen GSC URL Observation is available for this page.",
      "No frozen GA4 URL Observation is available for this page.",
    ]);
  });

  it.each(["zh-CN", "en-us"])(
    "fails closed when an en-US run points at non-identical Finding locale %j",
    async (mismatchedSummaryLocale) => {
      const crawlObservation = await observationBy(
        handle,
        fixture.scope,
        fixture.crawlSnapshotId,
        (row) => row.site_page_id === fixture.pricing.id,
      );
      const rollback = new Error("rollback mismatched Finding locale fixture");

      await expect(
        handle.db.transaction(async (tx) => {
          const meta = FINDING_REGISTRY["TECH-CANONICAL-002"];
          const finding = await new FindingsRepository(tx).insert({
            workspaceId: fixture.scope.workspaceId,
            projectId: fixture.scope.projectId,
            findingKey: contentHash({
              legacySummary: randomUUID(),
              mismatchedSummaryLocale,
            }),
            ruleId: "TECH-CANONICAL-002",
            ruleVersion: 2,
            ruleFamily: meta.ruleFamily,
            intent: meta.intent,
            domain: meta.domain,
            titleKey: meta.titleKey,
            titleArgs: {},
            summary: "Persisted Finding locale must match the frozen run exactly.",
            summaryLocale: mismatchedSummaryLocale,
            subjectRefs: [fixture.pricing.normalizedUrl],
            severity: "medium",
            confidence: "high",
            reviewState: "unreviewed",
            runId: fixture.runId,
            seenAt: CAPTURED_AT,
          });
          await new FindingTargetsRepository(tx).insertMany(fixture.scope, [
            {
              siteId: fixture.siteId,
              findingId: finding.id,
              diagnosticRunId: fixture.runId,
              relation: "affected_by_canonical_issue",
              targetKind: "canonical_issue",
              targetRef: "broken_target",
              resolutionState: "resolved",
              basisKind: "crawl_exact_fetch",
              sitePageId: fixture.pricing.id,
              pageSnapshotId: fixture.pricingPageSnapshotId,
              sourceObservationId: crawlObservation.id,
              memberRef: fixture.pricing.normalizedUrl,
              limitation: null,
            },
          ]);

          await expect(
            listProjectAuditUrls(
              growthMapScope(fixture.scope),
              fixture.scope.projectId,
              { limit: 100, cursor: null, now: PROJECTED_AT },
              tx,
            ),
          ).rejects.toMatchObject({
            code: "DEPENDENCY_UNAVAILABLE",
            status: 503,
          });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
  );

  it("rejects a whitespace-padded Finding locale at the persistence boundary", async () => {
    const meta = FINDING_REGISTRY["TECH-CANONICAL-002"];
    await expect(
      new FindingsRepository(handle.db).insert({
        workspaceId: fixture.scope.workspaceId,
        projectId: fixture.scope.projectId,
        findingKey: contentHash({ paddedSummaryLocale: randomUUID() }),
        ruleId: "TECH-CANONICAL-002",
        ruleVersion: 2,
        ruleFamily: meta.ruleFamily,
        intent: meta.intent,
        domain: meta.domain,
        titleKey: meta.titleKey,
        titleArgs: {},
        summary: "Whitespace-padded locale must not persist.",
        summaryLocale: "en-US ",
        subjectRefs: [fixture.pricing.normalizedUrl],
        severity: "medium",
        confidence: "high",
        reviewState: "unreviewed",
        runId: fixture.runId,
        seenAt: CAPTURED_AT,
      }),
    ).rejects.toBeDefined();
  });

  it("fails closed on a newer completed diagnostic with a corrupt frozen hash", async () => {
    const source = await new DiagnosticRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.runId,
    );
    if (!source) throw new Error("Current diagnostic fixture is missing");
    const profile = await new IcpProfilesRepository(handle.db).findById(
      fixture.scope,
      source.icp_profile_id,
    );
    if (!profile) throw new Error("Current Product Profile fixture is missing");
    const sources = new SourceConnectionsRepository(handle.db);
    const [crawlSource, gscSource, ga4Source] = await Promise.all([
      sources.findConnectedByProvider(fixture.scope, "crawl"),
      sources.findConnectedByProvider(fixture.scope, "gsc"),
      sources.findConnectedByProvider(fixture.scope, "ga4"),
    ]);
    if (!crawlSource || !gscSource || !ga4Source) {
      throw new Error("Current collection sources are missing");
    }
    const corruptSnapshots = [
      await seedSnapshot(
        handle,
        fixture.scope,
        fixture.siteId,
        actor,
        crawlSource,
        {
          provider: "crawl",
          datasetKey: "crawl.site_graph.v1",
          methodVersion: CRAWL_METHOD_VERSION,
          operation: "site_graph",
          rowCount: 0,
        },
      ),
      await seedSnapshot(
        handle,
        fixture.scope,
        fixture.siteId,
        actor,
        gscSource,
        {
          provider: "gsc",
          datasetKey: "gsc.page_query_daily.v1",
          methodVersion: "gsc.page_query_daily.v1",
          operation: "search_analytics",
          rowCount: 0,
        },
      ),
      await seedSnapshot(
        handle,
        fixture.scope,
        fixture.siteId,
        actor,
        ga4Source,
        {
          provider: "ga4",
          datasetKey: "ga4.organic_landing_daily.v1",
          methodVersion: "ga4.organic_landing_daily.v1",
          operation: "organic_landing",
          rowCount: 0,
        },
      ),
    ];
    const corruptFrozen = buildDiagnosticFrozenInput({
      projectId: fixture.scope.projectId,
      siteId: fixture.siteId,
      icp: {
        id: profile.id,
        version: profile.version,
        contentHash: profile.content_hash,
      },
      snapshots: corruptSnapshots,
      deliveryLocale: source.output_locale,
      governance: {
        projectionVersion: GOVERNANCE_PROJECTION_VERSION,
        keywordClusters: [],
        competitors: [],
      },
    });
    const corruptRunId = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id: corruptRunId,
      workspace_id: fixture.scope.workspaceId,
      project_id: fixture.scope.projectId,
      kind: "diagnostic",
      status: "completed",
      result_type: "diagnostic_run",
      result_id: corruptRunId,
      active_key: null,
      initiated_by: actor,
      started_at: "2026-07-22T03:00:00.000Z",
      completed_at: "2026-07-22T03:00:00.000Z",
    });
    // Bypass the repository's command-side hash guard to simulate corrupted
    // persisted dependency state; this appends a new row and mutates no truth.
    await handle.db.insert(diagnosticRuns).values({
      id: corruptRunId,
      workspace_id: fixture.scope.workspaceId,
      project_id: fixture.scope.projectId,
      site_id: source.site_id,
      icp_profile_id: source.icp_profile_id,
      icp_profile_version: source.icp_profile_version,
      rule_set_version: source.rule_set_version,
      prompt_set_version: source.prompt_set_version,
      output_locale: source.output_locale,
      input_manifest: corruptFrozen.manifest,
      input_hash: "0".repeat(64),
    });
    await publishDiagnosticGeneration(handle.db, {
      scope: fixture.scope,
      diagnosticRunId: corruptRunId,
      actorId: actor,
      completedAt: "2026-07-22T03:00:00.000Z",
    });

    await expect(
      listProjectAuditUrls(
        growthMapScope(fixture.scope),
        fixture.scope.projectId,
        { limit: 100, cursor: null, now: PROJECTED_AT },
        handle.db,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 });
  });
});
