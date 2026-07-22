import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
// Point the worker blob store at the same dir the web services would use so the
// service ↔ worker split shares one on-disk store (spec §7.6, §13.3).
process.env["SF_BLOB_DIR"] ??= mkdtempSync(
  path.join(os.tmpdir(), "sf-full-chain-blob-"),
);

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { icpProfiles, asyncRuns, workspaces } from "@sf/db/schema";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  ExportBundlesRepository,
  ImportPreviewsRepository,
  ObservationsRepository,
  ProjectsRepository,
  SourceConnectionsRepository,
  contentHash,
  type ObservationInsert,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import {
  LocalFsBlobStore,
  CRAWL_METHOD_VERSION,
  METRIC_CRAWL_PAGE,
  METRIC_CRAWL_ROBOTS,
  METRIC_CSV_KEYWORD_GAP,
  METRIC_GA4_LANDING,
  METRIC_GSC_PAGE,
  subjectUrlOf,
  type CrawlLinkProjection,
  type CrawlPageProjection,
  type CrawlRobotsProjection,
  type CsvKeywordProjection,
  type Ga4LandingProjection,
  type GscPageProjection,
} from "@sf/sources";
import type { Logger } from "@sf/observability";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { createDiagnosticRun } from "@/lib/services/diagnostics";
import { listProjectFindings } from "@/lib/services/findings-list";
import { reviewProjectFinding } from "@/lib/services/finding-review";
import { listProjectActions } from "@/lib/services/actions-service";
import { createActionArtifact } from "@/lib/services/artifacts";
import { createProjectExport } from "@/lib/services/export-service";
import { getProjectReport } from "@/lib/services/report";
import { getBoss } from "@/lib/boss";
import type { WorkerContext } from "../../../../../worker/src/context.ts";
import { runDiagnostic } from "../../../../../worker/src/diagnostic/run-diagnostic.ts";
import { runArtifact } from "../../../../../worker/src/artifact/run-artifact.ts";
import { runExport } from "../../../../../worker/src/export/run-export.ts";

/**
 * Shared harness for the B2B + B2C full-vertical golden-fixture integration
 * tests (AC-044, AC-045, AC-022). A live crawl of a real 200-OK site yields no
 * confirmable findings, so both verticals run over a DETERMINISTIC golden crawl
 * snapshot and drive the REAL services (which enqueue via pg-boss) plus the REAL
 * worker runners (which process the run) end-to-end against a real local Postgres
 * — a reproducible, offline vertical E2E (browser responsive/a11y is covered
 * separately by Playwright and is intentionally untouched here).
 *
 * The golden snapshot is engineered so the 11-rule pipeline (spec §8.4) trips
 * findings across multiple domains with ZERO randomness:
 *  - a 404 page                       → TECH-HTTP-001   (technical_seo, spec §8.3)
 *  - a page canonicalizing to an
 *    uncrawled same-origin URL         → TECH-CANONICAL-002 (technical_seo)
 *  - a commercial priority page with
 *    < 2 internal inlinks              → TECH-LINKGRAPH-005 (technical_seo)
 *  - an ICP offer no page covers       → CONTENT-COVERAGE-001 (content_intent)
 * The common chain freezes AVAILABLE Crawl/GSC/GA4/CSV snapshots and therefore
 * proves complete five-domain coverage. `runMissingProviderDiagnostic` reuses
 * the same Crawl facts without the other providers to prove the separate honest
 * degradation path: unavailable is never relabeled as zero or as a defect.
 */

export const DATABASE_URL = process.env["DATABASE_URL"]!;
export const DB_AVAILABLE = Boolean(process.env["DATABASE_URL"]);

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

type FixtureVertical = "b2b" | "b2c";

interface VerticalFixture {
  readonly productName: string;
  readonly oneLineDescription: string;
  readonly customerModel: FixtureVertical;
  readonly businessProfile: "b2b_saas" | "b2c_ecommerce";
  readonly segment: string;
  readonly persona: {
    readonly name: string;
    readonly roleOrContext: string;
    readonly jobs: readonly string[];
    readonly painPoints: readonly string[];
  };
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

const VERTICAL_FIXTURES: Record<FixtureVertical, VerticalFixture> = {
  b2b: {
    productName: "Northstar Analytics",
    oneLineDescription: "B2B revenue analytics for growth and sales teams.",
    customerModel: "b2b",
    businessProfile: "b2b_saas",
    segment: "Mid-market revenue teams",
    persona: {
      name: "Revenue operations lead",
      roleOrContext: "Owns pipeline reporting and forecasting",
      jobs: ["Unify marketing and sales performance"],
      painPoints: ["Fragmented attribution data"],
    },
    useCase: "Automated revenue forecasting",
    offer: "Quantum cryptography residency compliance audit",
    differentiator: "Auditable first-party revenue models",
    conversionLabel: "Book a demo",
    conversionType: "demo",
    conversionPath: "/demo",
    priorityProduct: "Revenue analytics platform",
    keywordCluster: "revenue-forecasting-automation",
    keywordPhrase: "revenue forecasting automation",
  },
  b2c: {
    productName: "TrailGlow Commerce",
    oneLineDescription:
      "Direct-to-consumer trail footwear for everyday runners.",
    customerModel: "b2c",
    businessProfile: "b2c_ecommerce",
    segment: "US trail runners buying performance footwear online",
    persona: {
      name: "Weekend trail runner",
      roleOrContext: "Researches and buys running shoes for personal use",
      jobs: ["Choose durable shoes for mixed terrain"],
      painPoints: ["Unclear fit and durability claims"],
    },
    useCase: "Buy lightweight trail shoes online",
    offer: "Carbon trail running shoes",
    differentiator: "30-day outdoor fit guarantee",
    conversionLabel: "Complete purchase",
    conversionType: "purchase",
    conversionPath: "/checkout",
    priorityProduct: "Trail running shoes",
    keywordCluster: "luxury-running-shoes",
    keywordPhrase: "luxury running shoes",
  },
};

function verticalFor(label: string): FixtureVertical {
  return label.startsWith("b2c") ? "b2c" : "b2b";
}

/** The exact crawl-only degradation strings the pipeline emits (pipeline.ts). */
export const DEGRADATION_LIMITATIONS: readonly string[] = [
  "Search Console not connected; search rules were skipped.",
  "GA4 not connected; landing conversion was skipped.",
  "No keyword-gap CSV or DataForSEO snapshot; content gap was skipped.",
];

// --- worker-context harness (mirrors run-collection.integration.test.ts) -----

export function buildCtx(handle: DbHandle): WorkerContext {
  return {
    db: handle.db,
    boss: {} as unknown as PgBoss, // the runners under test never enqueue
    blobStore: new LocalFsBlobStore(process.env["SF_BLOB_DIR"]!),
    credentialKey: Buffer.alloc(32),
    appOrigin: "http://localhost:3000",
    googleOAuth: { clientId: "test-client", clientSecret: "test-secret" },
    openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
    findingSummariesEnabled: false,
    logger: testLogger,
  };
}

// --- golden crawl fixture builders ------------------------------------------

function su(url: string): string {
  const subject = subjectUrlOf(url);
  if (!subject) throw new Error(`unparseable url: ${url}`);
  return subject;
}

function mkPage(o: {
  fetchUrl: string;
  status?: number;
  finalStatus?: number;
  robotsIndexable?: boolean;
  title?: string | null;
  h1?: readonly string[];
  canonicalTarget?: string | null;
  internalOutlinks?: readonly CrawlLinkProjection[];
}): CrawlPageProjection {
  return {
    fetchUrl: o.fetchUrl,
    status: o.status ?? 200,
    finalStatus: o.finalStatus ?? 200,
    redirectChain: [],
    canonicalTarget: o.canonicalTarget ?? null,
    robotsIndexable: o.robotsIndexable ?? true,
    robotsDirectives: o.robotsIndexable === false ? ["noindex"] : [],
    title: o.title ?? null,
    metaDescription: null,
    h1: o.h1 ?? [],
    headings: [],
    wordCount: 120,
    internalOutlinks: o.internalOutlinks ?? [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 11,
    contentType: "text/html",
  };
}

function crawlObs(
  subjectRef: string,
  projection: CrawlPageProjection,
  capturedAt: string,
): ObservationInsert {
  return {
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef,
    observedAt: capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: "direct_public",
    grade: "B",
    support: "supports",
    limitation: "current public response",
  };
}

/**
 * The golden pages: home (indexable, no inlinks to /product), a commercial
 * priority /product page (0 inlinks + a broken same-origin canonical), and a 404
 * page. Deterministically trips HTTP / CANONICAL / LINKGRAPH / COVERAGE.
 */
function goldenObservations(
  origin: string,
  capturedAt: string,
  fixture: VerticalFixture,
): ObservationInsert[] {
  const home = `${origin}/`;
  const product = `${origin}/product`;
  const gone = `${origin}/gone`;
  return [
    crawlRobotsObs(origin, capturedAt),
    crawlObs(
      su(home),
      mkPage({
        fetchUrl: home,
        title: `${fixture.productName} - Home`,
        h1: [`Welcome to ${fixture.productName}`],
        internalOutlinks: [],
      }),
      capturedAt,
    ),
    crawlObs(
      su(product),
      mkPage({
        fetchUrl: product,
        title: "Product Overview",
        h1: ["Product"],
        // Same-origin canonical to an uncrawled URL → TECH-CANONICAL-002.
        canonicalTarget: `${origin}/legacy-product`,
        internalOutlinks: [],
      }),
      capturedAt,
    ),
    crawlObs(
      su(gone),
      mkPage({
        fetchUrl: gone,
        status: 404,
        finalStatus: 404,
        robotsIndexable: false,
        title: null,
      }),
      capturedAt,
    ),
  ];
}

function crawlRobotsObs(
  subjectRef: string,
  capturedAt: string,
): ObservationInsert {
  return {
    metricKey: METRIC_CRAWL_ROBOTS,
    subjectType: "site",
    subjectRef,
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
    limitation: "deterministic public robots.txt fixture",
  };
}

// --- persistence seeding ----------------------------------------------------

/** Seed a COMPLETE ICP and point the project at it (createDiagnosticRun gate). */
async function seedCompleteIcp(
  handle: DbHandle,
  scope: ProjectScope,
  origin: string,
  actor: string,
  fixture: VerticalFixture,
): Promise<void> {
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: {
        productName: fixture.productName,
        oneLineDescription: fixture.oneLineDescription,
        customerModel: fixture.customerModel,
        businessProfile: fixture.businessProfile,
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
        marketCodes: ["US"],
        segments: [fixture.segment],
        personas: [fixture.persona],
        offers: [fixture.offer],
        useCases: [fixture.useCase],
        differentiators: [fixture.differentiator],
        // Marks /product priority + commercial (TECH-LINKGRAPH-005 high severity).
        priorityUrls: [`${origin}/product`],
        primaryConversion: {
          label: fixture.conversionLabel,
          type: fixture.conversionType,
          targetUrl: `${origin}${fixture.conversionPath}`,
        },
        priorityProductsOrServices: [fixture.priorityProduct],
        competitors: [],
        brandConstraints: [],
        complianceConstraints: [],
        technicalConstraints: [],
        resourceConstraints: [],
        growthQuestions: ["Which organic opportunities should we prioritize?"],
        ninetyDayGoals: ["Ship the highest-impact organic growth fixes."],
      },
      content_hash: contentHash({ icp: randomUUID() }),
      created_by: actor,
    })
    .returning();
  await new ProjectsRepository(handle.db).setCurrentIcpProfile(
    scope,
    scope.projectId,
    icp!.id,
  );
  await new ProjectsRepository(handle.db).setConfirmedIcpProfile(
    scope,
    scope.projectId,
    icp!.id,
  );
}

/** Seed one AVAILABLE crawl snapshot holding the golden observations. */
async function seedCrawlSnapshot(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  origin: string,
  actor: string,
  fixture: VerticalFixture,
): Promise<string> {
  const capturedAt = new Date().toISOString();
  const collectionRunId = randomUUID();
  const connection = await new SourceConnectionsRepository(
    handle.db,
  ).findConnectedByProvider(scope, "crawl");
  if (!connection) throw new Error("fixture Crawl connection missing");
  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "collection",
    status: "completed",
    initiated_by: actor,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const collections = new CollectionRunsRepository(handle.db);
  await collections.insertPlaceholder({
    runId: collectionRunId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: connection.id,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ c: collectionRunId }),
  });
  const observations = goldenObservations(origin, capturedAt, fixture);
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    collectionRunId,
    sourceConnectionId: connection.id,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "static golden crawl fixture",
    rawObjectKey: null,
    rowCount: observations.length,
    checksum: contentHash({ s: collectionRunId }),
  });
  await new ObservationsRepository(handle.db).insertMany(
    scope,
    snapshot.id,
    "crawl",
    observations,
  );
  const pageCount = observations.filter(
    (observation) => observation.metricKey === METRIC_CRAWL_PAGE,
  ).length;
  await collections.finalize(collectionRunId, {
    rowCount: snapshot.row_count,
    sourceWindow: snapshot.source_window,
    providerUsage: {
      urlsFetched: pageCount,
      pagesCollected: pageCount,
    },
    stopReason: null,
  });
  await new SourceConnectionsRepository(handle.db).setLastSnapshot(
    connection.id,
    snapshot.id,
    "available",
    snapshot.limitation,
  );
  return snapshot.id;
}

function structuredObservation(input: {
  readonly metricKey: string;
  readonly subjectType: "url" | "keyword_cluster";
  readonly subjectRef: string;
  readonly capturedAt: string;
  readonly valueJson: GscPageProjection | Ga4LandingProjection | CsvKeywordProjection;
  readonly provider: "gsc" | "ga4" | "csv";
  readonly limitation: string;
}): ObservationInsert {
  const firstParty = input.provider === "gsc" || input.provider === "ga4";
  return {
    metricKey: input.metricKey,
    subjectType: input.subjectType,
    subjectRef: input.subjectRef,
    observedAt: input.capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: input.valueJson,
    unit: null,
    origin: firstParty ? "first_party" : "user_provided",
    grade: firstParty ? "A" : "C",
    support: "supports",
    limitation: input.limitation,
  };
}

function gscObservations(
  origin: string,
  capturedAt: string,
): ObservationInsert[] {
  return [
    structuredObservation({
      provider: "gsc",
      metricKey: METRIC_GSC_PAGE,
      subjectType: "url",
      subjectRef: su(`${origin}/product`),
      capturedAt,
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
      limitation:
        "Search Console returns top rows by clicks, not the full query universe.",
    }),
  ];
}

function ga4Observations(
  origin: string,
  capturedAt: string,
): ObservationInsert[] {
  const limitation =
    "GA4 organic landing sessions use the fixture's selected purchase/demo key event.";
  return [
    structuredObservation({
      provider: "ga4",
      metricKey: METRIC_GA4_LANDING,
      subjectType: "url",
      subjectRef: su(`${origin}/product`),
      capturedAt,
      valueJson: {
        sessions: 1_000,
        engagedSessions: 650,
        engagementRate: 0.65,
        keyEvents: 10,
        keyEventUnavailableReason: null,
      },
      limitation,
    }),
    structuredObservation({
      provider: "ga4",
      metricKey: METRIC_GA4_LANDING,
      subjectType: "url",
      subjectRef: su(`${origin}/`),
      capturedAt,
      valueJson: {
        sessions: 1_000,
        engagedSessions: 700,
        engagementRate: 0.7,
        keyEvents: 100,
        keyEventUnavailableReason: null,
      },
      limitation,
    }),
  ];
}

function csvObservations(
  fixture: VerticalFixture,
  capturedAt: string,
): ObservationInsert[] {
  return Array.from({ length: 10 }, (_, index) =>
    structuredObservation({
      provider: "csv",
      metricKey: METRIC_CSV_KEYWORD_GAP,
      subjectType: "keyword_cluster",
      subjectRef: fixture.keywordCluster,
      capturedAt,
      valueJson: {
        keyword: `${fixture.keywordPhrase} ${index + 1}`,
        clusterKey: fixture.keywordCluster,
        searchVolume: 100,
        currentUrl: null,
        currentRank: null,
        competitorDomain: "fixture-competitor.example",
        competitorRank: 3 + index,
        marketCode: "US",
        languageCode: "en",
      },
      limitation: "Keyword demand is supplied by a deterministic CSV fixture.",
    }),
  );
}

interface ProviderFixture {
  readonly provider: "gsc" | "ga4" | "csv";
  readonly connectionType: "oauth" | "file_import";
  readonly datasetKey: string;
  readonly operation: string;
  readonly methodVersion: string;
  readonly observations: readonly ObservationInsert[];
  readonly limitation: string;
}

async function seedProviderSnapshot(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  origin: string,
  actor: string,
  capturedAt: string,
  fixture: ProviderFixture,
): Promise<string> {
  const connection = await new SourceConnectionsRepository(
    handle.db,
  ).insertConnection({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    provider: fixture.provider,
    connectionType: fixture.connectionType,
    state: "available",
    externalRef:
      fixture.provider === "gsc"
        ? origin
        : fixture.provider === "ga4"
          ? "properties/fixture"
          : null,
    config: {},
    limitation: fixture.limitation,
    connectedAt: true,
    createdBy: actor,
  });
  const collectionRunId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "collection",
    status: "completed",
    initiated_by: actor,
    started_at: capturedAt,
    completed_at: capturedAt,
  });

  let importPreviewId: string | null = null;
  if (fixture.provider === "csv") {
    const preview = await new ImportPreviewsRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      createdBy: actor,
      tokenHash: randomBytes(32),
      templateId: "keyword_gap_v1",
      rawObjectKey: `fixture/${collectionRunId}.csv`,
      fileChecksum: contentHash({ csv: collectionRunId }),
      rowCount: fixture.observations.length,
      detectedColumns: ["keyword", "search_volume", "market_code"],
      suggestedMapping: {},
      previewRows: [],
      validationErrors: [],
      validationWarnings: [],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    importPreviewId = preview.id;
  }

  const collections = new CollectionRunsRepository(handle.db);
  await collections.insertPlaceholder({
    runId: collectionRunId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: connection.id,
    importPreviewId,
    provider: fixture.provider,
    operation: fixture.operation,
    methodVersion: fixture.methodVersion,
    parametersHash: contentHash({ p: collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    collectionRunId,
    sourceConnectionId: connection.id,
    provider: fixture.provider,
    datasetKey: fixture.datasetKey,
    schemaVersion: "0.2.0",
    methodVersion: fixture.methodVersion,
    capturedAt,
    sourceWindow: {
      start: "2026-05-23T00:00:00.000Z",
      end: "2026-07-17T00:00:00.000Z",
    },
    availability: "available",
    limitation: fixture.limitation,
    rawObjectKey: null,
    rowCount: fixture.observations.length,
    checksum: contentHash({ s: collectionRunId }),
  });
  await new ObservationsRepository(handle.db).insertMany(
    scope,
    snapshot.id,
    fixture.provider,
    fixture.observations,
  );
  await collections.finalize(collectionRunId, {
    rowCount: snapshot.row_count,
    sourceWindow: snapshot.source_window,
    providerUsage: { rows: snapshot.row_count },
    stopReason: null,
  });
  await new SourceConnectionsRepository(handle.db).setLastSnapshot(
    connection.id,
    snapshot.id,
    "available",
    fixture.limitation,
  );
  return snapshot.id;
}

async function seedFullProviderSnapshots(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  origin: string,
  actor: string,
  fixture: VerticalFixture,
): Promise<string[]> {
  const capturedAt = new Date().toISOString();
  return Promise.all([
    seedProviderSnapshot(handle, scope, siteId, origin, actor, capturedAt, {
      provider: "gsc",
      connectionType: "oauth",
      datasetKey: "gsc.page_query_daily.v1",
      operation: "search_analytics",
      methodVersion: "gsc.page_query_daily.v1",
      observations: gscObservations(origin, capturedAt),
      limitation:
        "Search Console returns top rows by clicks, not the full query universe.",
    }),
    seedProviderSnapshot(handle, scope, siteId, origin, actor, capturedAt, {
      provider: "ga4",
      connectionType: "oauth",
      datasetKey: "ga4.organic_landing_daily.v1",
      operation: "organic_landing",
      methodVersion: "ga4.organic_landing_daily.v1",
      observations: ga4Observations(origin, capturedAt),
      limitation: "GA4 organic landing data with mapped fixture key events.",
    }),
    seedProviderSnapshot(handle, scope, siteId, origin, actor, capturedAt, {
      provider: "csv",
      connectionType: "file_import",
      datasetKey: "csv.keyword_gap.v1",
      operation: "keyword_gap_import",
      methodVersion: "csv.keyword_gap.v1",
      observations: csvObservations(fixture, capturedAt),
      limitation: "Keyword demand is supplied by a deterministic CSV fixture.",
    }),
  ]);
}

// --- the shared common chain: seed → diagnose → confirm → artifact ----------

export interface ChainResult {
  readonly scope: ProjectScope;
  readonly actor: string;
  readonly snapshotId: string;
  readonly snapshotIds: readonly string[];
  readonly diagRunId: string;
  readonly diagnosticIdempotencyKey: string;
  readonly httpFindingId: string;
  readonly actionId: string;
  readonly artifactId: string;
  readonly artifactRunId: string;
  readonly artifactIdempotencyKey: string;
}

/**
 * The value chain shared by both verticals: createProject → seed complete ICP →
 * seed golden crawl snapshot → createDiagnosticRun (service, enqueues) →
 * runDiagnostic (worker) → confirm the TECH-HTTP-001 finding (service; same-tx
 * Action upsert, spec §9.1) → createActionArtifact (service, TEMPLATE mode) →
 * runArtifact (worker, no network). Returns the ids each vertical then exports.
 */
export async function runCommonChain(
  handle: DbHandle,
  ctx: WorkerContext,
  label: string,
): Promise<ChainResult> {
  const actor = randomUUID();
  const [ws] = await handle.db
    .insert(workspaces)
    .values({ name: `WS-${randomUUID()}` })
    .returning();
  const workspaceId = ws!.id;
  const origin = `https://${label}-${randomUUID().slice(0, 8)}.example`;
  const fixture = VERTICAL_FIXTURES[verticalFor(label)];

  const created = await createProject(
    { workspaceId },
    actor,
    randomUUID(),
    {
      clientName: label,
      projectName: label,
      siteUrl: origin,
      marketCodes: ["US"],
      siteLanguageCodes: ["en"],
      defaultDeliveryLocale: "en",
    },
    safeGuard,
  );
  const scope: ProjectScope = { workspaceId, projectId: created.project.id };
  const siteId = created.project.site.id;

  await seedCompleteIcp(handle, scope, origin, actor, fixture);
  const snapshotId = await seedCrawlSnapshot(
    handle,
    scope,
    siteId,
    origin,
    actor,
    fixture,
  );
  const providerSnapshotIds = await seedFullProviderSnapshots(
    handle,
    scope,
    siteId,
    origin,
    actor,
    fixture,
  );
  const snapshotIds = [snapshotId, ...providerSnapshotIds];

  // createDiagnosticRun freezes the manifest + enqueues (spec §8.1, §13.2).
  const diagnosticIdempotencyKey = randomUUID();
  const diag = await createDiagnosticRun(
    { workspaceId },
    scope.projectId,
    actor,
    diagnosticIdempotencyKey,
    { snapshotIds, outputLocale: "en" },
  );
  await runDiagnostic(ctx, {
    runId: diag.run.id,
    workspaceId,
    projectId: scope.projectId,
  });
  const completedDiagnostic = await new AsyncRunsRepository(handle.db).findById(
    scope,
    diag.run.id,
  );
  if (
    completedDiagnostic?.status !== "completed" &&
    completedDiagnostic?.status !== "partial"
  ) {
    throw new Error(
      `golden diagnostic failed before rule assertions (${completedDiagnostic?.last_error_code ?? "missing run"})`,
    );
  }

  // Confirm the top technical finding → same-transaction Action (spec §9.1).
  const findings = await listProjectFindings({ workspaceId }, scope.projectId, {
    limit: 100,
    cursor: null,
    activeOnly: false,
  });
  const httpFinding = findings.data.find((f) => f.ruleId === "TECH-HTTP-001");
  if (!httpFinding)
    throw new Error("golden fixture did not trip TECH-HTTP-001");
  const review = await reviewProjectFinding(
    { workspaceId },
    scope.projectId,
    httpFinding.id,
    actor,
    { reviewState: "confirmed", baseRevision: httpFinding.reviewRevision },
  );
  if (!review.action) throw new Error("confirm did not create an Action");

  // Artifact create is ALWAYS async, even in TEMPLATE mode (spec §10.1); the
  // template path (generationMode: "template") never calls OpenAI.
  const artifactIdempotencyKey = randomUUID();
  const artifact = await createActionArtifact(
    { workspaceId },
    scope.projectId,
    review.action.id,
    actor,
    artifactIdempotencyKey,
    {
      artifactType: "technical_ticket", // fix_http_status.v1 → technical_ticket
      generationMode: "template",
      outputLocale: "en",
      operatorInstructions: null,
    },
  );
  await runArtifact(ctx, {
    runId: artifact.run.id,
    workspaceId,
    projectId: scope.projectId,
  });

  return {
    scope,
    actor,
    snapshotId,
    snapshotIds,
    diagRunId: diag.run.id,
    diagnosticIdempotencyKey,
    httpFindingId: httpFinding.id,
    actionId: review.action.id,
    artifactId: artifact.resourceRef.id,
    artifactRunId: artifact.run.id,
    artifactIdempotencyKey,
  };
}

export interface MissingProviderDiagnosticResult {
  readonly scope: ProjectScope;
  readonly actor: string;
  readonly snapshotId: string;
  readonly diagRunId: string;
}

/**
 * Independent crawl-only fixture for the precise missing-provider degradation
 * contract. Keeping it separate prevents a skipped rule from masquerading as the
 * AC-022 all-provider golden path.
 */
export async function runMissingProviderDiagnostic(
  handle: DbHandle,
  ctx: WorkerContext,
  label: string,
): Promise<MissingProviderDiagnosticResult> {
  const actor = randomUUID();
  const [ws] = await handle.db
    .insert(workspaces)
    .values({ name: `WS-${randomUUID()}` })
    .returning();
  const workspaceId = ws!.id;
  const origin = `https://${label}-${randomUUID().slice(0, 8)}.example`;
  const fixture = VERTICAL_FIXTURES[verticalFor(label)];
  const created = await createProject(
    { workspaceId },
    actor,
    randomUUID(),
    {
      clientName: label,
      projectName: label,
      siteUrl: origin,
      marketCodes: ["US"],
      siteLanguageCodes: ["en"],
      defaultDeliveryLocale: "en",
    },
    safeGuard,
  );
  const scope: ProjectScope = { workspaceId, projectId: created.project.id };
  await seedCompleteIcp(handle, scope, origin, actor, fixture);
  const snapshotId = await seedCrawlSnapshot(
    handle,
    scope,
    created.project.site.id,
    origin,
    actor,
    fixture,
  );
  const diag = await createDiagnosticRun(
    { workspaceId },
    scope.projectId,
    actor,
    randomUUID(),
    { snapshotIds: [snapshotId], outputLocale: "en" },
  );
  await runDiagnostic(ctx, {
    runId: diag.run.id,
    workspaceId,
    projectId: scope.projectId,
  });
  const completedDiagnostic = await new AsyncRunsRepository(handle.db).findById(
    scope,
    diag.run.id,
  );
  if (completedDiagnostic?.status !== "partial") {
    throw new Error(
      `crawl-only diagnostic did not finish partial (${completedDiagnostic?.last_error_code ?? completedDiagnostic?.status ?? "missing run"})`,
    );
  }
  return { scope, actor, snapshotId, diagRunId: diag.run.id };
}

export interface ExportChainResult {
  readonly manifest: Record<string, unknown>;
  readonly runStatus: string;
  readonly runId: string;
  readonly resourceRefType: string;
  readonly idempotencyKey: string;
  readonly row: NonNullable<
    Awaited<ReturnType<ExportBundlesRepository["findById"]>>
  >;
}

export async function runExportChain(
  handle: DbHandle,
  ctx: WorkerContext,
  scope: ProjectScope,
  actor: string,
  kind: "service_bundle" | "client_bundle",
): Promise<ExportChainResult> {
  const idempotencyKey = randomUUID();
  const created = await createProjectExport(
    { workspaceId: scope.workspaceId },
    scope.projectId,
    actor,
    idempotencyKey,
    { kind, outputLocale: "en" },
  );
  await runExport(ctx, {
    runId: created.run.id,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
  });
  const row = await new ExportBundlesRepository(handle.db).findById(
    scope,
    created.resourceRef.id,
  );
  if (!row) throw new Error("export bundle row missing after runExport");
  const asyncRun = await new AsyncRunsRepository(handle.db).findById(
    scope,
    created.run.id,
  );
  return {
    manifest: (row.manifest ?? {}) as Record<string, unknown>,
    runStatus: asyncRun?.status ?? "missing",
    runId: created.run.id,
    resourceRefType: created.resourceRef.type,
    idempotencyKey,
    row,
  };
}

// --- a faithful mini JSON-Schema validator for the manifest -----------------

type SchemaNode = Record<string, unknown>;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Load the manifest JSON-Schema authority (in-repo mirror, else the spec repo). */
function loadManifestSchema(): SchemaNode {
  const candidates = [
    path.join(process.cwd(), "schemas", "service-bundle-manifest.schema.json"),
    path.join(
      process.cwd(),
      "..",
      "signalframe-mvp",
      "implementation-spec-v0.2",
      "schemas",
      "service-bundle-manifest.schema.json",
    ),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return JSON.parse(readFileSync(c, "utf8")) as SchemaNode;
  }
  throw new Error("service-bundle-manifest.schema.json not found");
}

/**
 * Validate `value` against `node`, collecting human-readable errors. Interprets
 * exactly the JSON-Schema keywords the manifest schema uses ($ref/$defs, const,
 * enum, type, required, additionalProperties:false, properties, items, minItems,
 * uniqueItems, minimum, pattern, format uuid/date-time, min/maxLength) so the
 * test stays coupled to the real schema file rather than a hand-copied shape.
 */
function validateNode(
  node: SchemaNode,
  value: unknown,
  where: string,
  defs: SchemaNode,
  errors: string[],
): void {
  const ref = node["$ref"];
  if (typeof ref === "string") {
    const target = defs[ref.replace("#/$defs/", "")];
    if (isObject(target)) validateNode(target, value, where, defs, errors);
    return;
  }
  if ("const" in node && value !== node["const"]) {
    errors.push(`${where}: expected const ${JSON.stringify(node["const"])}`);
  }
  const enumVals = node["enum"];
  if (Array.isArray(enumVals) && !enumVals.includes(value)) {
    errors.push(`${where}: ${JSON.stringify(value)} not in enum`);
  }
  switch (node["type"]) {
    case "object": {
      if (!isObject(value)) {
        errors.push(`${where}: expected object`);
        return;
      }
      const props = isObject(node["properties"]) ? node["properties"] : {};
      const required = Array.isArray(node["required"]) ? node["required"] : [];
      for (const key of required) {
        if (typeof key === "string" && !(key in value)) {
          errors.push(`${where}/${key}: required property missing`);
        }
      }
      if (node["additionalProperties"] === false) {
        for (const key of Object.keys(value)) {
          if (!(key in props))
            errors.push(`${where}/${key}: additional property`);
        }
      }
      for (const [key, sub] of Object.entries(props)) {
        if (isObject(sub) && key in value) {
          validateNode(sub, value[key], `${where}/${key}`, defs, errors);
        }
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${where}: expected array`);
        return;
      }
      const minItems = node["minItems"];
      if (typeof minItems === "number" && value.length < minItems) {
        errors.push(`${where}: expected >= ${minItems} items`);
      }
      if (
        node["uniqueItems"] === true &&
        new Set(value.map((v) => JSON.stringify(v))).size !== value.length
      ) {
        errors.push(`${where}: items must be unique`);
      }
      if (isObject(node["items"])) {
        const itemSchema = node["items"];
        value.forEach((v, i) =>
          validateNode(itemSchema, v, `${where}/${i}`, defs, errors),
        );
      }
      return;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`${where}: expected integer`);
        return;
      }
      const min = node["minimum"];
      if (typeof min === "number" && value < min) {
        errors.push(`${where}: expected >= ${min}`);
      }
      return;
    }
    case "string": {
      if (typeof value !== "string") {
        errors.push(`${where}: expected string`);
        return;
      }
      const minLength = node["minLength"];
      if (typeof minLength === "number" && value.length < minLength) {
        errors.push(`${where}: shorter than ${minLength}`);
      }
      const maxLength = node["maxLength"];
      if (typeof maxLength === "number" && value.length > maxLength) {
        errors.push(`${where}: longer than ${maxLength}`);
      }
      const pattern = node["pattern"];
      if (typeof pattern === "string" && !new RegExp(pattern).test(value)) {
        errors.push(`${where}: does not match ${pattern}`);
      }
      if (node["format"] === "uuid" && !UUID_RE.test(value)) {
        errors.push(`${where}: not a uuid`);
      }
      if (node["format"] === "date-time" && Number.isNaN(Date.parse(value))) {
        errors.push(`${where}: not a date-time`);
      }
      return;
    }
    default:
      return;
  }
}

export function validateManifest(
  manifest: unknown,
  schema: SchemaNode,
): string[] {
  const defs = isObject(schema["$defs"]) ? schema["$defs"] : {};
  const errors: string[] = [];
  validateNode(schema, manifest, "#", defs, errors);
  return errors;
}

export function manifestFilePaths(
  manifest: Record<string, unknown>,
): string[] {
  const files = manifest["files"];
  if (!Array.isArray(files)) return [];
  return files
    .map((f) =>
      isObject(f) && typeof f["path"] === "string" ? f["path"] : null,
    )
    .filter((p): p is string => p !== null);
}

export function manifestItemCount(
  manifest: Record<string, unknown>,
  key: string,
): number {
  const counts = manifest["itemCounts"];
  if (!isObject(counts)) return -1;
  const v = counts[key];
  return typeof v === "number" ? v : -1;
}

export const MANIFEST_SCHEMA = loadManifestSchema();

/**
 * Stop the enqueue-only pg-boss the web services' getBoss() started, once per
 * test file, so the run does not leak a connection pool. Best-effort.
 */
export async function stopSharedBoss(): Promise<void> {
  if (!DB_AVAILABLE) return;
  try {
    const boss = await getBoss();
    await boss.stop({ graceful: false });
  } catch {
    // best-effort cleanup
  }
}

// Re-exports so each chain test imports everything from this one harness.
export {
  createDbHandle,
  getBoss,
  getProjectReport,
  listProjectActions,
  listProjectFindings,
  runArtifact,
};
export { ExecutionArtifactsRepository } from "@sf/db";
export type { DbHandle, ProjectScope, WorkerContext };
