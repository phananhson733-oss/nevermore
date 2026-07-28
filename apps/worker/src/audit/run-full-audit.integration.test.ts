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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  AuditRunsRepository,
  CapabilityRunsRepository,
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  FindingsRepository,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type CanonicalValue,
  type ObservationInsert,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import {
  findingKey,
  GOVERNANCE_PROJECTION_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import type { Logger } from "@sf/observability";
import {
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  LocalFsBlobStore,
  METRIC_CRAWL_PAGE,
  subjectUrlOf,
  type CrawlPageProjection,
} from "@sf/sources";
import { AuditModuleId } from "@sf/contracts";
import type { WorkerContext } from "../context.ts";
import { CRAWL_PAGE_EXTRACT_SCHEMA_VERSION } from "../collection/materialize-crawl-pages.ts";
import { runDiagnostic } from "../diagnostic/run-diagnostic.ts";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const OBSERVED_AT = new Date().toISOString();

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface AuditSeed {
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly runId: string;
  readonly auditRunId: string;
  readonly snapshotId: string;
}

function page404(fetchUrl: string): CrawlPageProjection {
  return {
    fetchUrl,
    status: 404,
    finalStatus: 404,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: false,
    robotsDirectives: ["noindex"],
    title: null,
    metaDescription: null,
    h1: [],
    headings: [],
    wordCount: 100,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 10,
    contentType: "text/html",
  };
}

/**
 * Seed one project whose confirmed Crawl snapshot contains a single 404 page
 * (which the deterministic pipeline turns into a TECH-HTTP-001 finding), then
 * anchor a canonical Growth Audit projection over that queued diagnostic run.
 */
async function seedAuditRun(handle: DbHandle): Promise<AuditSeed> {
  const actor = randomUUID();
  const [ws] = await handle.db
    .insert(workspaces)
    .values({ name: `Audit-${randomUUID()}` })
    .returning();
  const workspaceId = ws!.id;
  const project = await new ProjectsRepository(handle.db).insert({
    workspaceId,
    clientName: "Audit",
    projectName: "Audit",
    defaultDeliveryLocale: "en",
    createdBy: actor,
  });
  const scope: ProjectScope = { workspaceId, projectId: project.id };
  const host = `audit-${randomUUID().slice(0, 8)}.example`;
  const origin = `https://${host}`;
  const site = await new SitesRepository(handle.db).insertPrimary({
    workspaceId,
    projectId: project.id,
    origin,
    host,
    marketCodes: ["US"],
    languageCodes: ["en"],
  });

  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: workspaceId,
      project_id: project.id,
      version: 1,
      status: "complete",
      profile: { productName: "Audit", oneLineDescription: "Widgets." },
      content_hash: contentHash({ icp: randomUUID() }),
      created_by: actor,
    })
    .returning();

  // Immutable Crawl collection run + snapshot with a single 404 page.
  const crawlSource = await new SourceConnectionsRepository(
    handle.db,
  ).insertDefaultCrawl({
    workspaceId,
    projectId: project.id,
    siteId: site.id,
    createdBy: actor,
  });
  const collectionRunId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: workspaceId,
    project_id: project.id,
    kind: "collection",
    status: "completed",
    initiated_by: actor,
    started_at: OBSERVED_AT,
    completed_at: OBSERVED_AT,
  });
  await new CollectionRunsRepository(handle.db).insertPlaceholder({
    runId: collectionRunId,
    workspaceId,
    projectId: project.id,
    siteId: site.id,
    sourceConnectionId: crawlSource.id,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ c: collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId,
    projectId: project.id,
    siteId: site.id,
    collectionRunId,
    sourceConnectionId: crawlSource.id,
    provider: "crawl",
    datasetKey: CRAWL_DATASET_KEY,
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt: OBSERVED_AT,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "audit crawl fixture",
    rawObjectKey: null,
    rowCount: 1,
    checksum: contentHash({ s: collectionRunId }),
  });

  const fetchUrl = `${origin}/broken`;
  const subjectRef = subjectUrlOf(fetchUrl)!;
  const projection = page404(fetchUrl);
  const sitePage = await new SitePagesRepository(handle.db).upsertNormalizedUrl(
    {
      workspaceId,
      projectId: project.id,
      siteId: site.id,
      normalizedUrl: fetchUrl,
      templateKey: null,
    },
  );
  const extract = {
    schemaVersion: CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
    subjectUrl: subjectRef,
    depth: 0,
    projection,
  };
  await new PageSnapshotsRepository(handle.db).create({
    workspaceId,
    projectId: project.id,
    sitePageId: sitePage.id,
    dataSnapshotId: snapshot.id,
    contentHash: contentHash(extract as unknown as CanonicalValue),
    extract,
    capturedAt: snapshot.captured_at,
  });
  const observation: ObservationInsert = {
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef,
    observedAt: OBSERVED_AT,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: "direct_public",
    grade: "B",
    support: "supports",
    limitation: "public crawl fetch",
    sitePageId: sitePage.id,
  };
  await new ObservationsRepository(handle.db).insertMany(
    scope,
    snapshot.id,
    "crawl",
    [observation],
  );

  // Frozen diagnostic manifest anchored on that snapshot.
  const frozenManifest = {
    projectId: project.id,
    siteId: site.id,
    icp: { id: icp!.id, version: icp!.version, contentHash: icp!.content_hash },
    snapshots: [
      {
        snapshotId: snapshot.id,
        provider: snapshot.provider,
        datasetKey: snapshot.dataset_key,
        schemaVersion: snapshot.schema_version,
        methodVersion: snapshot.method_version,
        checksum: snapshot.checksum,
        availability: snapshot.availability,
        capturedAt: snapshot.captured_at,
        sourceWindow: snapshot.source_window,
      },
    ],
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en",
    governance: {
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [],
      competitors: [],
    },
  };
  const runId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: workspaceId,
    project_id: project.id,
    kind: "diagnostic",
    status: "queued",
    active_key: "growth_audit",
    initiated_by: actor,
  });
  await new DiagnosticRunsRepository(handle.db).insert({
    runId,
    workspaceId,
    projectId: project.id,
    siteId: site.id,
    icpProfileId: icp!.id,
    icpProfileVersion: 1,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: "en",
    inputManifest: frozenManifest,
    inputHash: contentHash(frozenManifest as unknown as CanonicalValue),
  });

  // Canonical audit projection: async_run -> diagnostic_run -> capability_run -> audit_run.
  await new CapabilityRunsRepository(handle.db).create({
    workspaceId,
    projectId: project.id,
    asyncRunId: runId,
    capabilityId: "growth-audit",
    capabilityVersion: "0.3.0",
    inputManifestHash: contentHash({ capability: runId }),
    mode: "production",
    sideEffectClass: "read_only",
  });
  const auditRun = await new AuditRunsRepository(handle.db).create({
    workspaceId,
    projectId: project.id,
    diagnosticRunId: runId,
    capabilityRunId: runId,
    scopeKind: "site",
    scopeKey: site.id,
    projectionVersion: "growth-audit.0.3.0",
  });

  return {
    scope,
    siteId: site.id,
    runId,
    auditRunId: auditRun.id,
    snapshotId: snapshot.id,
  };
}

describeDb("growth audit materialization end-to-end", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
    ctx = {
      db: handle.db,
      boss: {} as unknown as PgBoss,
      blobStore: new LocalFsBlobStore(
        mkdtempSync(path.join(os.tmpdir(), "sf-audit-test-")),
      ),
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "test-client", clientSecret: "test-secret" },
      openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
      findingSummariesEnabled: false,
      logger: testLogger,
    };
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("materializes eight audit modules and diagnostic findings for one audit run", async () => {
    const seed = await seedAuditRun(handle);

    await runDiagnostic(ctx, {
      runId: seed.runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    // Diagnostic findings are persisted (a crawl-only run is `partial`).
    const finding = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "TECH-HTTP-001", ["http_status:404"]),
    );
    expect(finding).not.toBeNull();

    // All eight audit modules are materialized; empty modules stay no_data.
    const modules = await new AuditRunsRepository(handle.db).listModuleResults(
      seed.scope,
      seed.auditRunId,
    );
    expect(modules).toHaveLength(AuditModuleId.options.length);
    const byId = new Map(
      modules.map((row) => [row.module_id, row.coverage_state]),
    );
    for (const moduleId of AuditModuleId.options) {
      expect(byId.has(moduleId)).toBe(true);
    }
    for (const emptyModule of [
      "performance",
      "accessibility",
      "best_practices_security",
      "compliance_measurement",
    ]) {
      expect(byId.get(emptyModule)).toBe("no_data");
    }
    // The 404 finding routes to technical_search, which therefore carries data.
    expect(byId.get("technical_search")).not.toBe("no_data");
  });
});
