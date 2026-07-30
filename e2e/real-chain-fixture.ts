import { randomUUID } from "node:crypto";
import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  ObservationsRepository,
  schemaTables,
  SourceConnectionsRepository,
  contentHash,
  type CanonicalValue,
  type DbHandle,
  type ObservationInsert,
  type ProjectScope,
} from "../packages/db/src/index.ts";
import {
  CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
  materializePreparedCrawlPages,
  parseCrawlPageExtract,
  type PreparedCrawlPage,
} from "../apps/worker/src/collection/materialize-crawl-pages.ts";
import { resolveObservationSitePageLineage } from "../apps/worker/src/collection/observation-site-page-lineage.ts";
import {
  CRAWL_METHOD_VERSION,
  METRIC_CRAWL_PAGE,
  METRIC_CRAWL_ROBOTS,
  METRIC_GA4_LANDING,
  METRIC_GSC_PAGE,
  subjectUrlOf,
  type CrawlLinkProjection,
  type CrawlPageProjection,
  type CrawlRobotsProjection,
  type Ga4LandingProjection,
  type GscPageProjection,
} from "../packages/sources/src/index.ts";

/**
 * Deterministic provider seam for the real-browser local app-chain tests.
 *
 * The browser still creates the project/context and queues the diagnostic,
 * Artifact, and export through the real Next routes; a real worker consumes
 * those pg-boss jobs and the real local BlobStore persists raw CSV/export bytes.
 * Crawl/GSC/GA4 are intentionally NOT provider end-to-end evidence: snapshots
 * that would require live customer Google and crawl access are installed here.
 * They use the same canonical repositories and PostgreSQL constraints as worker
 * persistence, but deliberately make no network request. Those provider paths
 * are covered separately by adapter/worker integration tests and remain subject
 * to the hosted live-provider gate. CSV is not installed here: the spec drives
 * preview -> confirm -> real
 * collect.csv worker separately so at least one provider ingestion crosses the
 * complete HTTP/queue/worker/blob boundary.
 */

export type RealVertical = "b2b" | "b2c";

export interface VerticalDefinition {
  readonly vertical: RealVertical;
  readonly clientName: string;
  readonly projectName: string;
  readonly siteUrl: string;
  readonly productName: string;
  readonly oneLineDescription: string;
  readonly customerModel: RealVertical;
  readonly businessProfile: "b2b_saas" | "b2c_ecommerce";
  readonly segment: string;
  readonly personaName: string;
  readonly personaContext: string;
  readonly personaJob: string;
  readonly personaPain: string;
  readonly useCase: string;
  readonly offer: string;
  readonly differentiator: string;
  readonly conversionLabel: string;
  readonly conversionType: "demo" | "purchase";
  readonly conversionPath: "/demo" | "/checkout";
  readonly priorityProduct: string;
  readonly keywordCluster: string;
  readonly keywordPhrase: string;
}

export function verticalDefinition(
  vertical: RealVertical,
  suffix: string,
): VerticalDefinition {
  const octets = [0, 2, 4].map((offset) => {
    const parsed = Number.parseInt(suffix.slice(offset, offset + 2), 16);
    return (Number.isFinite(parsed) ? parsed % 254 : 0) + 1;
  });
  // 11/8 and 12/8 are public address space. A literal address exercises the
  // production URL classifier without DNS, and the UUID-derived host prevents
  // a previous failed/repeated local run from colliding with the site-origin
  // uniqueness constraint in an otherwise reusable disposable database.
  const fixtureOrigin = `https://${vertical === "b2b" ? 11 : 12}.${octets.join(".")}`;
  if (vertical === "b2b") {
    return {
      vertical,
      clientName: `RelayOps ${suffix}`,
      projectName: `RelayOps growth workspace ${suffix}`,
      // Public address literals avoid both DNS and outbound HTTP in this suite.
      siteUrl: fixtureOrigin,
      productName: "RelayOps",
      oneLineDescription:
        "A B2B revenue operations workspace that turns first-party evidence into accountable growth workflows.",
      customerModel: "b2b",
      businessProfile: "b2b_saas",
      segment: "Mid-market B2B software companies with distributed revenue teams",
      personaName: "Revenue operations director",
      personaContext:
        "Owns pipeline quality, lifecycle reporting, and the handoff between marketing and sales",
      personaJob: "Turn fragmented growth signals into an execution-ready operating plan",
      personaPain:
        "Qualified demand is hidden across disconnected analytics, content, and conversion workflows",
      useCase: "Prioritize and ship evidence-backed organic growth work",
      offer: "A 90-day connected growth program for revenue operations teams",
      differentiator:
        "Every recommendation is traceable to immutable first-party evidence and an accountable owner",
      conversionLabel: "Book a demo",
      conversionType: "demo",
      conversionPath: "/demo",
      priorityProduct: "Revenue operations workflow platform",
      keywordCluster: "revenue-operations-workflow",
      keywordPhrase: "revenue operations workflow",
    };
  }
  return {
    vertical,
    clientName: `TrailGlow ${suffix}`,
    projectName: `TrailGlow B2C acceptance ${suffix}`,
    siteUrl: fixtureOrigin,
    productName: "TrailGlow Commerce",
    oneLineDescription:
      "Direct-to-consumer trail footwear for everyday runners.",
    customerModel: "b2c",
    businessProfile: "b2c_ecommerce",
    segment: "US trail runners buying performance footwear online",
    personaName: "Weekend trail runner",
    personaContext: "Researches and buys running shoes for personal use",
    personaJob: "Choose durable shoes for mixed terrain",
    personaPain: "Unclear fit and durability claims",
    useCase: "Buy lightweight trail shoes online",
    offer: "Carbon trail running shoes",
    differentiator: "30-day outdoor fit guarantee",
    conversionLabel: "Complete purchase",
    conversionType: "purchase",
    conversionPath: "/checkout",
    priorityProduct: "Trail running shoes",
    keywordCluster: "luxury-running-shoes",
    keywordPhrase: "luxury running shoes",
  };
}

export function completeContextBody(definition: VerticalDefinition) {
  const origin = definition.siteUrl;
  return {
    mode: "complete" as const,
    baseVersion: 0,
    profile: {
      productName: definition.productName,
      oneLineDescription: definition.oneLineDescription,
      customerModel: definition.customerModel,
      businessProfile: definition.businessProfile,
      businessProfileNote: null,
      marketCodes: ["US"],
      siteLanguageCodes: ["en"],
      defaultDeliveryLocale: "en",
      segments: [definition.segment],
      personas: [
        {
          name: definition.personaName,
          roleOrContext: definition.personaContext,
          jobs: [definition.personaJob],
          painPoints: [definition.personaPain],
        },
      ],
      useCases: [definition.useCase],
      offers: [definition.offer],
      differentiators: [definition.differentiator],
      primaryConversion: {
        label: definition.conversionLabel,
        type: definition.conversionType,
        targetUrl: `${origin}${definition.conversionPath}`,
      },
      priorityProductsOrServices: [definition.priorityProduct],
      priorityUrls: [`${origin}/product`],
      competitors: [],
      brandConstraints: [],
      complianceConstraints: [],
      technicalConstraints: [],
      resourceConstraints: [],
      growthQuestions: ["Which organic opportunities should we prioritize?"],
      ninetyDayGoals: ["Ship the highest-impact organic growth fixes."],
    },
  };
}

export function keywordGapCsv(definition: VerticalDefinition): string {
  const header = [
    "keyword",
    "search_volume",
    "cluster",
    "current_url",
    "current_rank",
    "competitor_domain",
    "competitor_rank",
    "market",
    "language",
  ].join(",");
  const rows = Array.from({ length: 10 }, (_, index) =>
    [
      `${definition.keywordPhrase} ${index + 1}`,
      String(100 + index),
      definition.keywordCluster,
      "",
      "",
      "fixture-competitor.example",
      String(3 + index),
      "US",
      "en",
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

export const KEYWORD_GAP_MAPPING = {
  keyword: "keyword",
  searchVolume: "search_volume",
  cluster: "cluster",
  currentUrl: "current_url",
  currentRank: "current_rank",
  competitorDomain: "competitor_domain",
  competitorRank: "competitor_rank",
  marketCode: "market",
  languageCode: "language",
} as const;

interface ProjectFixtureScope {
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly origin: string;
}

async function fixtureScope(
  handle: DbHandle,
  projectId: string,
): Promise<ProjectFixtureScope> {
  const result = await handle.pool.query<{
    workspace_id: string;
    site_id: string;
    origin: string;
  }>(
    `SELECT p.workspace_id, s.id AS site_id, s.origin
       FROM app.client_projects AS p
       JOIN app.sites AS s
         ON s.project_id = p.id AND s.is_primary = true
      WHERE p.id = $1
      LIMIT 1`,
    [projectId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("real E2E project fixture scope was not found");
  return {
    scope: { workspaceId: row.workspace_id, projectId },
    siteId: row.site_id,
    origin: row.origin,
  };
}

function subject(url: string): string {
  const value = subjectUrlOf(url);
  if (!value) throw new Error("real E2E fixture URL could not be canonicalized");
  return value;
}

function crawlPage(input: {
  readonly fetchUrl: string;
  readonly status?: number;
  readonly robotsIndexable?: boolean;
  readonly title?: string | null;
  readonly h1?: readonly string[];
  readonly canonicalTarget?: string | null;
  readonly internalOutlinks?: readonly CrawlLinkProjection[];
}): CrawlPageProjection {
  const status = input.status ?? 200;
  const robotsIndexable = input.robotsIndexable ?? true;
  return {
    fetchUrl: input.fetchUrl,
    status,
    finalStatus: status,
    redirectChain: [],
    canonicalTarget: input.canonicalTarget ?? null,
    robotsIndexable,
    robotsDirectives: robotsIndexable ? [] : ["noindex"],
    title: input.title ?? null,
    metaDescription: null,
    h1: input.h1 ?? [],
    headings: [],
    wordCount: 120,
    internalOutlinks: input.internalOutlinks ?? [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 11,
    contentType: "text/html",
  };
}

function crawlObservations(
  origin: string,
  capturedAt: string,
  definition: VerticalDefinition,
): ObservationInsert[] {
  const page = (
    url: string,
    projection: CrawlPageProjection,
  ): ObservationInsert => ({
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef: subject(url),
    observedAt: capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: "direct_public",
    grade: "B",
    support: "supports",
    limitation: "Deterministic offline crawl fixture.",
  });
  const home = `${origin}/`;
  const product = `${origin}/product`;
  const gone = `${origin}/gone`;
  return [
    {
      metricKey: METRIC_CRAWL_ROBOTS,
      subjectType: "site",
      subjectRef: origin,
      observedAt: capturedAt,
      availability: "available",
      valueNumeric: null,
      valueText: null,
      valueJson: {
        fetched: true,
        groups: [{ userAgent: "*", disallow: [], allow: [] }],
        sitemaps: [],
      } satisfies CrawlRobotsProjection,
      unit: null,
      origin: "direct_public",
      grade: "B",
      support: "supports",
      limitation: "Deterministic offline robots.txt fixture.",
    },
    page(
      home,
      crawlPage({
        fetchUrl: home,
        title: `${definition.productName} - Home`,
        h1: [`Welcome to ${definition.productName}`],
      }),
    ),
    page(
      product,
      crawlPage({
        fetchUrl: product,
        title: "Product Overview",
        h1: ["Product"],
        canonicalTarget: `${origin}/legacy-product`,
      }),
    ),
    page(
      gone,
      crawlPage({
        fetchUrl: gone,
        status: 404,
        robotsIndexable: false,
        title: null,
      }),
    ),
  ];
}

function structuredObservation(input: {
  readonly metricKey: string;
  readonly subjectRef: string;
  readonly capturedAt: string;
  readonly valueJson: GscPageProjection | Ga4LandingProjection;
  readonly origin: "first_party";
  readonly limitation: string;
}): ObservationInsert {
  return {
    metricKey: input.metricKey,
    subjectType: "url",
    subjectRef: input.subjectRef,
    observedAt: input.capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: input.valueJson,
    unit: null,
    origin: input.origin,
    grade: "A",
    support: "supports",
    limitation: input.limitation,
  };
}

interface SnapshotFixture {
  readonly provider: "crawl" | "gsc" | "ga4";
  readonly connectionType: "public" | "oauth";
  readonly datasetKey: string;
  readonly operation: string;
  readonly methodVersion: string;
  readonly externalRef: string | null;
  readonly limitation: string;
  readonly observations: readonly ObservationInsert[];
}

/**
 * Build the same immutable Crawl PageSnapshot extract consumed by the worker.
 * The provider seam starts after network collection, so this helper must
 * materialize the durable exact-page lineage that real collection persistence
 * would have created from the retained raw Crawl pages. It never synthesizes a
 * page absent from the fixture's canonical crawl.page.v1 Observations.
 */
function preparedCrawlPages(
  observations: readonly ObservationInsert[],
): readonly PreparedCrawlPage[] {
  return observations
    .flatMap((observation): readonly PreparedCrawlPage[] => {
      if (observation.metricKey !== METRIC_CRAWL_PAGE) return [];
      const projection = observation.valueJson as CrawlPageProjection;
      const extract = parseCrawlPageExtract({
        schemaVersion: CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
        subjectUrl: observation.subjectRef,
        depth: new URL(projection.fetchUrl).pathname === "/" ? 0 : 1,
        projection,
      });
      return [
        {
          normalizedUrl: projection.fetchUrl,
          contentHash: contentHash(extract as CanonicalValue),
          extract,
        },
      ];
    })
    .sort((left, right) =>
      left.normalizedUrl < right.normalizedUrl
        ? -1
        : left.normalizedUrl > right.normalizedUrl
          ? 1
          : 0,
    );
}

async function persistSnapshot(
  handle: DbHandle,
  project: ProjectFixtureScope,
  actorId: string,
  fixture: SnapshotFixture,
): Promise<string> {
  const sources = new SourceConnectionsRepository(handle.db);
  const connection =
    fixture.provider === "crawl"
      ? await sources.findConnectedByProvider(project.scope, "crawl")
      : await sources.insertConnection({
          workspaceId: project.scope.workspaceId,
          projectId: project.scope.projectId,
          siteId: project.siteId,
          provider: fixture.provider,
          connectionType: fixture.connectionType,
          state: "available",
          externalRef: fixture.externalRef,
          config: {},
          limitation: fixture.limitation,
          connectedAt: true,
          createdBy: actorId,
        });
  if (!connection) throw new Error("default Crawl source was not found");

  const observedAt = [
    ...new Set(fixture.observations.map((observation) => observation.observedAt)),
  ];
  if (observedAt.length !== 1 || !observedAt[0]) {
    throw new Error(
      "real E2E snapshot fixture requires one immutable Observation capture time",
    );
  }
  const capturedAt = observedAt[0];
  const sourceWindow = {
    start: new Date(
      Date.parse(capturedAt) - 56 * 24 * 60 * 60 * 1_000,
    ).toISOString(),
    end: capturedAt,
  };
  const runId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.async_runs
       (id, workspace_id, project_id, kind, status, initiated_by,
        started_at, completed_at)
     VALUES ($1, $2, $3, 'collection', 'completed', $4, $5, $5)`,
    [
      runId,
      project.scope.workspaceId,
      project.scope.projectId,
      actorId,
      capturedAt,
    ],
  );
  const collectionRuns = new CollectionRunsRepository(handle.db);
  await collectionRuns.insertPlaceholder({
    runId,
    workspaceId: project.scope.workspaceId,
    projectId: project.scope.projectId,
    siteId: project.siteId,
    sourceConnectionId: connection.id,
    provider: fixture.provider,
    operation: fixture.operation,
    methodVersion: fixture.methodVersion,
    parametersHash: contentHash({ fixture: runId }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: project.scope.workspaceId,
    projectId: project.scope.projectId,
    siteId: project.siteId,
    collectionRunId: runId,
    sourceConnectionId: connection.id,
    provider: fixture.provider,
    datasetKey: fixture.datasetKey,
    schemaVersion: "0.2.0",
    methodVersion: fixture.methodVersion,
    capturedAt,
    sourceWindow,
    availability: "available",
    limitation: fixture.limitation,
    rawObjectKey: null,
    rowCount: fixture.observations.length,
    checksum: contentHash({ snapshot: runId }),
  });
  await handle.db.transaction(async (tx) => {
    const exactCrawlPageIds = await materializePreparedCrawlPages(tx, {
      workspaceId: project.scope.workspaceId,
      projectId: project.scope.projectId,
      siteId: project.siteId,
      dataSnapshotId: snapshot.id,
      capturedAt,
      pages:
        fixture.provider === "crawl"
          ? preparedCrawlPages(fixture.observations)
          : [],
    });
    const observationsWithPageLineage =
      await resolveObservationSitePageLineage({
        tx,
        scope: project.scope,
        siteId: project.siteId,
        siteOrigin: project.origin,
        provider: fixture.provider,
        observations: fixture.observations,
        crawlExactSitePageIds: exactCrawlPageIds,
      });
    await new ObservationsRepository(tx).insertMany(
      project.scope,
      snapshot.id,
      fixture.provider,
      observationsWithPageLineage,
    );
  });
  await collectionRuns.finalize(runId, {
    rowCount: fixture.observations.length,
    sourceWindow,
    providerUsage: { requestCount: 0 },
    stopReason: null,
  });
  await sources.setLastSnapshot(
    connection.id,
    snapshot.id,
    "available",
    fixture.limitation,
  );
  await handle.pool.query(
    `UPDATE app.async_runs
        SET result_type = 'collection_run',
            result_id = $2,
            progress = $3::jsonb
      WHERE id = $1`,
    [
      runId,
      runId,
      JSON.stringify({
        phase: "completed",
        current: fixture.observations.length,
        total: fixture.observations.length,
        messageKey: "run.completed",
      }),
    ],
  );
  return snapshot.id;
}

/** Install only the offline Crawl/GSC/GA4 provider boundary for one UI project. */
export async function seedOfflineProviderSnapshots(
  handle: DbHandle,
  projectId: string,
  definition: VerticalDefinition,
): Promise<readonly string[]> {
  const project = await fixtureScope(handle, projectId);
  const capturedAt = new Date().toISOString();
  const product = subject(`${project.origin}/product`);
  const limitation = "Deterministic offline provider fixture for real-browser acceptance.";
  const gsc: ObservationInsert[] = [
    structuredObservation({
      metricKey: METRIC_GSC_PAGE,
      subjectRef: product,
      capturedAt,
      origin: "first_party",
      limitation,
      valueJson: {
        current28d: { clicks: 30, impressions: 2_000, position: 5 },
        previous28d: { clicks: 120, impressions: 2_400, position: 5 },
        topQueries: [
          {
            query: "best product comparison",
            clicks: 20,
            impressions: 1_500,
            position: 5,
          },
        ],
      },
    }),
  ];
  const ga4: ObservationInsert[] = [
    structuredObservation({
      metricKey: METRIC_GA4_LANDING,
      subjectRef: product,
      capturedAt,
      origin: "first_party",
      limitation,
      valueJson: {
        sessions: 1_000,
        engagedSessions: 650,
        engagementRate: 0.65,
        keyEvents: 10,
        keyEventUnavailableReason: null,
      },
    }),
    structuredObservation({
      metricKey: METRIC_GA4_LANDING,
      subjectRef: subject(`${project.origin}/`),
      capturedAt,
      origin: "first_party",
      limitation,
      valueJson: {
        sessions: 1_000,
        engagedSessions: 700,
        engagementRate: 0.7,
        keyEvents: 100,
        keyEventUnavailableReason: null,
      },
    }),
  ];
  const actorId = randomUUID();
  // Crawl commits first because analytics may bind only to an already durable,
  // unambiguous SitePage identity. Parallelizing these fixture snapshots would
  // introduce a race that real collection persistence explicitly serializes.
  const crawlSnapshotId = await persistSnapshot(handle, project, actorId, {
    provider: "crawl",
    connectionType: "public",
    datasetKey: "crawl.site_graph.v1",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    externalRef: null,
    limitation,
    observations: crawlObservations(project.origin, capturedAt, definition),
  });
  const analyticsSnapshotIds = await Promise.all([
    persistSnapshot(handle, project, actorId, {
      provider: "gsc",
      connectionType: "oauth",
      datasetKey: "gsc.page_query_daily.v1",
      operation: "search_analytics",
      methodVersion: "gsc.page_query_daily.v1",
      externalRef: project.origin,
      limitation,
      observations: gsc,
    }),
    persistSnapshot(handle, project, actorId, {
      provider: "ga4",
      connectionType: "oauth",
      datasetKey: "ga4.organic_landing_daily.v1",
      operation: "organic_landing",
      methodVersion: "ga4.organic_landing_daily.v1",
      externalRef: "properties/offline-fixture",
      limitation,
      observations: ga4,
    }),
  ]);
  return [crawlSnapshotId, ...analyticsSnapshotIds];
}

/**
 * Publish one completed offline-seam Growth Audit through the same durable
 * Analysis Refresh lineage required by every customer Growth Map read.
 *
 * This is deliberately a browser-fixture seam, not a claim that live Crawl,
 * Google, or DataForSEO ran. A provider step is completed only when the
 * diagnostic froze the exact canonical offline Snapshot installed above;
 * providers absent from that diagnostic are recorded as explicitly skipped.
 * Provider adapters and the real orchestration worker are covered independently.
 */
export async function publishDiagnosticThroughAnalysisRefresh(
  db: DbHandle,
  projectId: string,
  diagnosticRunId: string,
): Promise<void> {
  const result = await db.pool.query<{
    workspace_id: string;
    project_id: string;
    site_id: string;
    icp_profile_id: string;
    initiated_by: string;
    diagnostic_status: "completed" | "partial";
    input_manifest: Record<string, unknown>;
  }>(
    `SELECT
       diagnostic.workspace_id,
       diagnostic.project_id,
       diagnostic.site_id,
       diagnostic.icp_profile_id,
       diagnostic.input_manifest,
       run.initiated_by,
       run.status AS diagnostic_status
     FROM app.diagnostic_runs AS diagnostic
     INNER JOIN app.async_runs AS run
       ON run.id = diagnostic.id
      AND run.workspace_id = diagnostic.workspace_id
      AND run.project_id = diagnostic.project_id
     WHERE diagnostic.id = $1
       AND diagnostic.project_id = $2
       AND run.kind = 'diagnostic'
       AND run.status IN ('completed', 'partial')
       AND run.result_type = 'diagnostic_run'
       AND run.result_id = diagnostic.id
     LIMIT 1`,
    [diagnosticRunId, projectId],
  );
  const diagnostic = result.rows[0];
  if (!diagnostic) {
    throw new Error(
      "terminal Growth Audit diagnostic was unavailable for Analysis Refresh publication",
    );
  }

  const analysisRefreshRunId = randomUUID();
  const scope = {
    workspaceId: diagnostic.workspace_id,
    projectId: diagnostic.project_id,
  };
  const manifestSnapshots = diagnostic.input_manifest["snapshots"];
  if (!Array.isArray(manifestSnapshots) || manifestSnapshots.length === 0) {
    throw new Error(
      "Growth Map fixture diagnostic has no frozen Snapshot publication inputs",
    );
  }
  const snapshotIds = manifestSnapshots.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>)["snapshotId"] !== "string"
    ) {
      throw new Error(
        "Growth Map fixture diagnostic has an invalid frozen Snapshot reference",
      );
    }
    return (entry as Record<string, string>)["snapshotId"]!;
  });
  if (new Set(snapshotIds).size !== snapshotIds.length) {
    throw new Error(
      "Growth Map fixture diagnostic has duplicate frozen Snapshot references",
    );
  }
  const snapshots = await new DataSnapshotsRepository(db.db).findByIds(
    scope,
    snapshotIds,
  );
  if (snapshots.length !== snapshotIds.length) {
    throw new Error(
      "Growth Map fixture diagnostic Snapshot lineage is incomplete",
    );
  }
  const collectionStepKeys = [
    "crawl",
    "gsc",
    "ga4",
    "dataforseo",
  ] as const;
  const snapshotByProvider = new Map<
    (typeof collectionStepKeys)[number],
    (typeof snapshots)[number]
  >();
  for (const snapshot of snapshots) {
    if (snapshot.site_id !== diagnostic.site_id) {
      throw new Error(
        "Growth Map fixture cannot publish a foreign-site Snapshot",
      );
    }
    const provider =
      snapshot.provider as (typeof collectionStepKeys)[number];
    if (!collectionStepKeys.includes(provider)) continue;
    if (snapshotByProvider.has(provider)) {
      throw new Error(`Growth Map fixture has duplicate ${provider} Snapshots`);
    }
    snapshotByProvider.set(provider, snapshot);
  }
  if (!snapshotByProvider.has("crawl")) {
    throw new Error(
      "Growth Map fixture requires one exact offline Crawl Snapshot",
    );
  }
  const optionalStepSkipped = collectionStepKeys
    .filter((stepKey) => stepKey !== "crawl")
    .some((stepKey) => !snapshotByProvider.has(stepKey));
  const parentStatus =
    diagnostic.diagnostic_status === "partial" || optionalStepSkipped
      ? "partial"
      : "completed";

  await db.db.transaction(async (tx) => {
    const completedAt = new Date().toISOString();
    await tx.insert(schemaTables.asyncRuns).values({
      id: analysisRefreshRunId,
      workspace_id: diagnostic.workspace_id,
      project_id: diagnostic.project_id,
      kind: "analysis_refresh",
      status: parentStatus,
      result_type: "analysis_refresh_run",
      result_id: analysisRefreshRunId,
      initiated_by: diagnostic.initiated_by,
      queued_at: completedAt,
      started_at: completedAt,
      completed_at: completedAt,
    });

    const plans = new AnalysisRefreshRunsRepository(tx);
    await plans.create({
      runId: analysisRefreshRunId,
      workspaceId: diagnostic.workspace_id,
      projectId: diagnostic.project_id,
      siteId: diagnostic.site_id,
      icpProfileId: diagnostic.icp_profile_id,
    });
    for (const stepKey of collectionStepKeys) {
      const snapshot = snapshotByProvider.get(stepKey);
      if (!snapshot) {
        if (stepKey === "crawl") {
          throw new Error(
            "Growth Map fixture lost its required offline Crawl Snapshot",
          );
        }
        if (
          !(await plans.skipStep(
            scope,
            analysisRefreshRunId,
            stepKey,
            "provider_not_collected_by_offline_fixture",
          ))
        ) {
          throw new Error(
            `Growth Map fixture could not record skipped ${stepKey} step`,
          );
        }
        continue;
      }
      const [child, collection] = await Promise.all([
        new AsyncRunsRepository(tx).findById(
          scope,
          snapshot.collection_run_id,
        ),
        new CollectionRunsRepository(tx).findById(
          snapshot.collection_run_id,
        ),
      ]);
      if (
        !child ||
        (child.status !== "completed" && child.status !== "partial") ||
        child.kind !== "collection" ||
        child.result_type !== "collection_run" ||
        child.result_id !== child.id ||
        !collection ||
        collection.workspace_id !== scope.workspaceId ||
        collection.project_id !== scope.projectId ||
        collection.site_id !== diagnostic.site_id ||
        collection.provider !== stepKey ||
        snapshot.collection_run_id !== child.id ||
        snapshot.provider !== stepKey ||
        snapshot.availability === "unavailable"
      ) {
        throw new Error(
          `Growth Map fixture ${stepKey} Snapshot is not a canonical completed collection`,
        );
      }
      if (
        !(await plans.startStep(
          scope,
          analysisRefreshRunId,
          stepKey,
          child.id,
        )) ||
        !(await plans.completeStep(
          scope,
          analysisRefreshRunId,
          stepKey,
          {
            childAsyncRunId: child.id,
            resultSnapshotId: snapshot.id,
          },
        ))
      ) {
        throw new Error(
          `Growth Map fixture could not complete ${stepKey} step`,
        );
      }
    }
    if (
      !(await plans.startStep(
        scope,
        analysisRefreshRunId,
        "growth_audit",
        diagnosticRunId,
      ))
    ) {
      throw new Error(
        "Growth Map fixture could not start its Analysis Refresh Growth Audit step",
      );
    }
    if (
      !(await plans.completeStep(scope, analysisRefreshRunId, "growth_audit", {
        childAsyncRunId: diagnosticRunId,
        resultSnapshotId: null,
      }))
    ) {
      throw new Error(
        "Growth Map fixture could not complete its Analysis Refresh Growth Audit step",
      );
    }
  });
}
