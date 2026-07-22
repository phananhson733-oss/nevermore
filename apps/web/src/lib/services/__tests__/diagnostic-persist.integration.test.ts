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
import { asyncRuns, workspaces } from "@sf/db/schema";
import {
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingsRepository,
  ObservationsRepository,
  PageSnapshotsRepository,
  SitePagesRepository,
  SourceConnectionsRepository,
  type CanonicalValue,
  type ProjectScope,
} from "@sf/db";
import {
  ALL_RULES,
  DiagnosticContext,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
  parseIcp,
  runPipeline,
  type ObservationView,
} from "@sf/engine";
import {
  CRAWL_METHOD_VERSION,
  METRIC_CRAWL_PAGE,
  type CrawlPageProjection,
} from "@sf/sources";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

function page404(url: string): CrawlPageProjection {
  return {
    fetchUrl: url,
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
    responseMs: 12,
    contentType: "text/html",
  };
}

/**
 * End-to-end DIAGNOSTIC persistence: seed a crawl snapshot with a 404 page,
 * run the real 11-rule pipeline, and persist findings + evidence exactly the way
 * the worker does — asserting the schema CHECK constraints (finding_observations
 * role, append-only) hold and the finding is queryable. Regression guard for the
 * evidence-role and confidence fixes.
 */
describeDb("diagnostic pipeline → persistence (spec §8)", () => {
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
        clientName: "Diag2",
        projectName: "Diag2",
        siteUrl: "https://diag2.example",
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
  });

  it("runs the pipeline over a 404-page snapshot and persists a TECH-HTTP-001 finding + evidence", async () => {
    const capturedAt = new Date().toISOString();
    const crawlSource = await new SourceConnectionsRepository(
      handle.db,
    ).findConnectedByProvider(scope, "crawl");
    if (!crawlSource) throw new Error("fixture Crawl connection missing");

    // Seed a crawl collection run + snapshot + one 404-page observation.
    const [run] = await handle.db
      .insert(asyncRuns)
      .values({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        kind: "collection",
        status: "completed",
        initiated_by: actor,
        started_at: capturedAt,
        completed_at: capturedAt,
      })
      .returning();
    const collections = new CollectionRunsRepository(handle.db);
    await collections.insertPlaceholder({
      runId: run!.id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      sourceConnectionId: crawlSource.id,
      provider: "crawl",
      operation: "site_graph",
      methodVersion: CRAWL_METHOD_VERSION,
      parametersHash: contentHash({ x: 1 }),
    });
    const snapshot = await new DataSnapshotsRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      collectionRunId: run!.id,
      sourceConnectionId: crawlSource.id,
      provider: "crawl",
      datasetKey: "crawl.site_graph.v1",
      schemaVersion: "0.2.0",
      methodVersion: CRAWL_METHOD_VERSION,
      capturedAt,
      sourceWindow: { start: null, end: null },
      availability: "available",
      limitation: "static crawl",
      rawObjectKey: null,
      rowCount: 1,
      checksum: contentHash({ s: 1 }).padEnd(64, "0").slice(0, 64),
    });
    const gonePage = page404("https://diag2.example/gone");
    const sitePage = await new SitePagesRepository(
      handle.db,
    ).upsertNormalizedUrl({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: gonePage.fetchUrl,
      templateKey: null,
    });
    const pageExtract = {
      schemaVersion: "crawl.page-extract.v1",
      subjectUrl: gonePage.fetchUrl,
      depth: 0,
      projection: gonePage,
    };
    const pageSnapshot = await new PageSnapshotsRepository(handle.db).create({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      sitePageId: sitePage.id,
      dataSnapshotId: snapshot.id,
      contentHash: contentHash(pageExtract as unknown as CanonicalValue),
      extract: pageExtract,
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
          subjectRef: "https://diag2.example/gone",
          observedAt: capturedAt,
          availability: "available",
          valueNumeric: null,
          valueText: null,
          valueJson: gonePage,
          unit: null,
          origin: "direct_public",
          grade: "B",
          support: "supports",
          limitation: "current public response",
        },
      ],
    );
    await collections.finalize(run!.id, {
      rowCount: snapshot.row_count,
      sourceWindow: snapshot.source_window,
      providerUsage: { urlsFetched: 1, pagesCollected: 1 },
      stopReason: null,
    });
    await new SourceConnectionsRepository(handle.db).setLastSnapshot(
      crawlSource.id,
      snapshot.id,
      snapshot.availability,
      snapshot.limitation,
    );

    // Build the frozen context + run the real pipeline.
    const observationRows = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(scope, [snapshot.id]);
    const observations: ObservationView[] = observationRows.map((o) => {
      if (
        o.snapshot_id !== snapshot.id ||
        o.site_page_id !== sitePage.id ||
        o.subject_ref !== gonePage.fetchUrl
      ) {
        throw new Error(
          "diagnostic persistence fixture crawl lineage does not match its page",
        );
      }
      return {
        observationId: o.id,
        snapshotId: o.snapshot_id,
        sitePageId: o.site_page_id,
        sitePageUrl: gonePage.fetchUrl,
        pageSnapshotId: pageSnapshot.id,
        metricKey: o.metric_key,
        subjectType: o.subject_type,
        subjectRef: o.subject_ref,
        provider: o.provider,
        availability: o.availability,
        valueJson: o.value_json,
        observedAt: o.observed_at,
      };
    });
    const ctx = DiagnosticContext.build({
      icp: parseIcp({
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
        priorityUrls: [],
      }),
      deliveryLocale: "en",
      observations,
      coverage: {
        crawl: "available",
        gsc: "unavailable",
        ga4: "unavailable",
        csv: "unavailable",
      },
      capturedAt: { crawl: capturedAt },
    });
    const result = await runPipeline({
      projectId: scope.projectId,
      ctx,
      rules: ALL_RULES,
      deliveryLocale: "en",
    });

    const httpFinding = result.findings.find(
      (f) => f.ruleId === "TECH-HTTP-001",
    );
    expect(
      httpFinding,
      "the 404 page should trigger TECH-HTTP-001",
    ).toBeDefined();
    expect(httpFinding!.ruleVersion).toBe(2);
    expect(httpFinding!.evidence.length).toBeGreaterThan(0);

    // Persist a diagnostic run + the finding + its evidence, the way the worker does.
    const [diagAsync] = await handle.db
      .insert(asyncRuns)
      .values({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        kind: "diagnostic",
        status: "completed",
        initiated_by: actor,
        started_at: capturedAt,
        completed_at: capturedAt,
      })
      .returning();
    const frozenIcp = await seedIcp(handle, scope, actor);
    const inputManifest = {
      projectId: scope.projectId,
      siteId,
      icp: frozenIcp,
      snapshots: [
        {
          snapshotId: snapshot.id,
          provider: snapshot.provider,
          datasetKey: snapshot.dataset_key,
          schemaVersion: snapshot.schema_version,
          methodVersion: snapshot.method_version,
          checksum: snapshot.checksum,
          capturedAt: snapshot.captured_at,
          sourceWindow: snapshot.source_window,
          availability: snapshot.availability,
        },
      ],
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      deliveryLocale: "en",
    };
    await new DiagnosticRunsRepository(handle.db).insert({
      runId: diagAsync!.id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      icpProfileId: frozenIcp.id,
      icpProfileVersion: frozenIcp.version,
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      outputLocale: "en",
      inputManifest,
      inputHash: contentHash(
        inputManifest as Parameters<typeof contentHash>[0],
      ),
    });

    const findingsRepo = new FindingsRepository(handle.db);
    const findingRow = await findingsRepo.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      findingKey: httpFinding!.findingKey,
      ruleId: httpFinding!.ruleId,
      ruleVersion: httpFinding!.ruleVersion,
      ruleFamily: httpFinding!.ruleFamily,
      intent: httpFinding!.intent,
      domain: httpFinding!.domain,
      titleKey: httpFinding!.titleKey,
      titleArgs: {
        ...httpFinding!.titleArgs,
        __priorityRelevant: httpFinding!.priorityRelevant,
      },
      summary: httpFinding!.summary,
      summaryLocale: httpFinding!.summaryLocale,
      subjectRefs: [...httpFinding!.subjectRefs],
      severity: httpFinding!.severity,
      confidence: httpFinding!.confidence,
      reviewState: httpFinding!.reviewState,
      runId: diagAsync!.id,
      seenAt: capturedAt,
    });

    const evidenceRepo = new EvidenceRepository(handle.db);
    const evidenceIds = await evidenceRepo.insertMany(
      {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        diagnosticRunId: diagAsync!.id,
      },
      httpFinding!.evidence.map((e) => ({
        sourceProvider: e.sourceProvider,
        origin: e.origin,
        method: e.method,
        grade: e.grade,
        availability: e.availability,
        support: e.support,
        subjectRefs: [...e.subjectRefs],
        claim: e.claim,
        observedAt: e.observedAt,
        limitation: e.limitation,
        ...(e.sourceProvider === "crawl"
          ? {
              snapshotId: snapshot.id,
              collectionRunId: run!.id,
            }
          : {}),
      })),
    );
    // Uses the valid finding_observations.role ('primary'|'supporting'|...); a bad
    // value (the earlier "support" bug) would raise a CHECK violation here.
    await evidenceRepo.linkObservations(
      {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        diagnosticRunId: diagAsync!.id,
      },
      evidenceIds.map((evidenceId, i) => ({
        findingId: findingRow.id,
        evidenceId,
        role: i === 0 ? "primary" : "supporting",
      })),
    );

    // The finding is queryable and carries its evidence.
    const persisted = await findingsRepo.findByKey(
      scope,
      httpFinding!.findingKey,
    );
    expect(persisted?.rule_id).toBe("TECH-HTTP-001");
    const links = await evidenceRepo.listForFindings(scope, [findingRow.id]);
    expect(links.length).toBe(evidenceIds.length);
  });
});

async function seedIcp(
  handle: DbHandle,
  scope: ProjectScope,
  actor: string,
): Promise<{ id: string; version: number; contentHash: string }> {
  const mod = await import("@sf/db/schema");
  const [icp] = await handle.db
    .insert(mod.icpProfiles)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: { productName: "x", siteLanguageCodes: ["en"] },
      content_hash: contentHash({ icp: randomUUID() })
        .padEnd(64, "0")
        .slice(0, 64),
      created_by: actor,
    })
    .returning();
  return {
    id: icp!.id,
    version: icp!.version,
    contentHash: icp!.content_hash,
  };
}
