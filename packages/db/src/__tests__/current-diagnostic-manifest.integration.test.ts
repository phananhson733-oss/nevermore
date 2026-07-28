import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash, type CanonicalValue } from "../hash.ts";
import { AsyncRunsRepository } from "../repositories/async-runs.ts";
import { CollectionRunsRepository } from "../repositories/collection-runs.ts";
import { DataSnapshotsRepository } from "../repositories/data-snapshots.ts";
import { DiagnosticRunsRepository } from "../repositories/diagnostic-runs.ts";
import { ImportPreviewsRepository } from "../repositories/import-previews.ts";
import { ObservationsRepository } from "../repositories/observations.ts";
import { ProjectsRepository } from "../repositories/projects.ts";
import { SitesRepository } from "../repositories/sites.ts";
import { SitePagesRepository } from "../repositories/site-pages.ts";
import { SourceConnectionsRepository } from "../repositories/source-connections.ts";
import { icpProfiles, workspaces } from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CAPTURED_AT = "2026-07-22T06:51:00.000Z";
const SOURCE_WINDOW = { start: null, end: null };

type Provider = "crawl" | "csv" | "dataforseo";

const PROVIDER_CONFIG = {
  crawl: {
    operation: "site_graph",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: "crawl.site_graph.v2",
    metricKey: "crawl.page.v1",
    origin: "direct_public",
    grade: "B",
  },
  csv: {
    operation: "keyword_gap_import",
    datasetKey: "csv.keyword_gap.v1",
    schemaVersion: "0.2.0",
    methodVersion: "csv.keyword_gap.v1",
    metricKey: "csv.keyword_gap.v1",
    origin: "user_provided",
    grade: "C",
  },
  dataforseo: {
    operation: "keyword_gap_import",
    datasetKey: "csv.keyword_gap.v1",
    schemaVersion: "dataforseo.ranked_keywords.v1",
    methodVersion: "dataforseo.ranked_keywords.v1",
    metricKey: "csv.keyword_gap.v1",
    origin: "vendor_observation",
    grade: "B",
  },
} as const;

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

interface Fixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly icpProfileId: string;
  readonly icpContentHash: string;
  readonly sourceConnectionIds: Readonly<Record<Provider, string>>;
}

interface FrozenSnapshot {
  readonly snapshotId: string;
  readonly provider: Provider;
  readonly datasetKey: string;
  readonly schemaVersion: string;
  readonly methodVersion: string;
  readonly checksum: string;
  readonly availability: "available";
  readonly sourceWindow: typeof SOURCE_WINDOW;
  readonly capturedAt: string;
}

describeDb("current diagnostic manifest snapshot selection", () => {
  let handle: DbHandle;
  let fixture: Fixture;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL!);
    const actorId = randomUUID();
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Current manifest ${randomUUID()}` })
      .returning();
    const workspaceId = workspace!.id;
    const project = await new ProjectsRepository(handle.db).insert({
      workspaceId,
      clientName: "Current manifest client",
      projectName: "CSV and DataForSEO coexistence",
      defaultDeliveryLocale: "en",
      createdBy: actorId,
    });
    const projectId = project.id;
    const site = await new SitesRepository(handle.db).insertPrimary({
      workspaceId,
      projectId,
      origin: "https://current-manifest.example",
      host: "current-manifest.example",
      marketCodes: ["US"],
      languageCodes: ["en"],
    });
    const siteId = site.id;
    const icpProfileId = randomUUID();
    const icpProfile = { productName: "Current manifest fixture" };
    const icpContentHash = contentHash(icpProfile);
    await handle.db.insert(icpProfiles).values({
      id: icpProfileId,
      workspace_id: workspaceId,
      project_id: projectId,
      version: 1,
      status: "complete",
      profile: icpProfile,
      content_hash: icpContentHash,
      created_by: actorId,
    });

    const sources = new SourceConnectionsRepository(handle.db);
    const crawlSource = await sources.insertDefaultCrawl({
      workspaceId,
      projectId,
      siteId,
      createdBy: actorId,
    });
    const csvSource = await sources.insertConnection({
      workspaceId,
      projectId,
      siteId,
      provider: "csv",
      connectionType: "file_import",
      state: "connected",
      config: { templateId: "keyword_gap_v1" },
      limitation: "Disposable keyword-gap CSV source.",
      connectedAt: true,
      createdBy: actorId,
    });
    const dataforseoSource = await sources.insertConnection({
      workspaceId,
      projectId,
      siteId,
      provider: "dataforseo",
      connectionType: "api_key_stub",
      state: "connected",
      config: { locationCode: 2840, languageCode: "en" },
      limitation: "Disposable DataForSEO source.",
      connectedAt: true,
      createdBy: actorId,
    });

    fixture = {
      actorId,
      workspaceId,
      projectId,
      siteId,
      icpProfileId,
      icpContentHash,
      sourceConnectionIds: {
        crawl: crawlSource.id,
        csv: csvSource.id,
        dataforseo: dataforseoSource.id,
      },
    };
  });

  afterAll(async () => {
    await handle?.end();
  });

  async function insertSnapshot(provider: Provider): Promise<FrozenSnapshot> {
    const config = PROVIDER_CONFIG[provider];
    const crawlFetchUrl = "https://current-manifest.example/";
    const crawlSitePage =
      provider === "crawl"
        ? await new SitePagesRepository(handle.db).upsertNormalizedUrl({
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
            siteId: fixture.siteId,
            normalizedUrl: crawlFetchUrl,
            templateKey: null,
          })
        : null;
    const run = await new AsyncRunsRepository(handle.db).insertQueued({
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      kind: "collection",
      activeKey: `current-manifest:${provider}:${randomUUID()}`,
      initiatedBy: fixture.actorId,
      contractVersion: "2026-07-21",
    });
    const importPreview =
      provider === "csv"
        ? await new ImportPreviewsRepository(handle.db).insert({
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
            siteId: fixture.siteId,
            createdBy: fixture.actorId,
            tokenHash: Buffer.from(contentHash({ runId: run.id }), "hex"),
            templateId: "keyword_gap_v1",
            rawObjectKey: `raw-import/${fixture.projectId}/${run.id}/preview.csv`,
            fileChecksum: contentHash({ csv: run.id }),
            rowCount: 1,
            detectedColumns: ["keyword"],
            suggestedMapping: { keyword: "keyword" },
            previewRows: [{ keyword: "growth audit" }],
            validationErrors: [],
            validationWarnings: [],
            expiresAt: "2026-07-22T07:51:00.000Z",
          })
        : null;
    const collectionRuns = new CollectionRunsRepository(handle.db);
    await collectionRuns.insertPlaceholder({
      runId: run.id,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      siteId: fixture.siteId,
      sourceConnectionId: fixture.sourceConnectionIds[provider],
      importPreviewId: importPreview?.id ?? null,
      provider,
      operation: config.operation,
      methodVersion: config.methodVersion,
      parametersHash: contentHash({ provider, runId: run.id }),
    });
    const snapshot = await new DataSnapshotsRepository(handle.db).insert({
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      siteId: fixture.siteId,
      collectionRunId: run.id,
      sourceConnectionId: fixture.sourceConnectionIds[provider],
      provider,
      datasetKey: config.datasetKey,
      schemaVersion: config.schemaVersion,
      methodVersion: config.methodVersion,
      capturedAt: CAPTURED_AT,
      sourceWindow: SOURCE_WINDOW,
      availability: "available",
      limitation: `Disposable ${provider} snapshot.`,
      rawObjectKey: null,
      rowCount: 1,
      checksum: contentHash({ provider, snapshot: run.id }),
    });
    await new ObservationsRepository(handle.db).insertMany(
      {
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
      },
      snapshot.id,
      provider,
      [
        {
          metricKey: config.metricKey,
          sitePageId: crawlSitePage?.id ?? null,
          subjectType: provider === "crawl" ? "url" : "keyword_cluster",
          subjectRef:
            provider === "crawl" ? crawlFetchUrl : "growth-audit",
          observedAt: CAPTURED_AT,
          availability: "available",
          valueNumeric: null,
          valueText: null,
          valueJson:
            provider === "crawl"
              ? { provider, fetchUrl: crawlFetchUrl }
              : { provider },
          unit: null,
          origin: config.origin,
          grade: config.grade,
          support: "context",
          limitation: `Disposable ${provider} observation.`,
        },
      ],
    );
    await collectionRuns.finalize(run.id, {
      rowCount: 1,
      sourceWindow: SOURCE_WINDOW,
      providerUsage: {},
      stopReason: null,
    });
    return {
      snapshotId: snapshot.id,
      provider,
      datasetKey: snapshot.dataset_key,
      schemaVersion: snapshot.schema_version,
      methodVersion: snapshot.method_version,
      checksum: snapshot.checksum,
      availability: "available",
      sourceWindow: SOURCE_WINDOW,
      capturedAt: snapshot.captured_at,
    };
  }

  async function insertDiagnostic(
    snapshots: readonly FrozenSnapshot[],
    options: {
      readonly ruleSetVersion?: "mvp.rules.0.2.1" | "mvp.rules.0.2.2";
      readonly governance?: CanonicalValue;
    } = {},
  ) {
    const ruleSetVersion =
      options.ruleSetVersion ?? "mvp.rules.0.2.1";
    const run = await new AsyncRunsRepository(handle.db).insertQueued({
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      kind: "diagnostic",
      activeKey: `current-manifest:diagnostic:${randomUUID()}`,
      initiatedBy: fixture.actorId,
      contractVersion: "2026-07-21",
    });
    const frozenSnapshots: readonly CanonicalValue[] = snapshots.map(
      (snapshot) => ({
        snapshotId: snapshot.snapshotId,
        provider: snapshot.provider,
        datasetKey: snapshot.datasetKey,
        schemaVersion: snapshot.schemaVersion,
        methodVersion: snapshot.methodVersion,
        checksum: snapshot.checksum,
        availability: snapshot.availability,
        sourceWindow: snapshot.sourceWindow,
        capturedAt: snapshot.capturedAt,
      }),
    );
    const inputManifest: { readonly [key: string]: CanonicalValue } = {
      projectId: fixture.projectId,
      siteId: fixture.siteId,
      ruleSetVersion,
      promptSetVersion: "mvp.prompts.0.2.0",
      deliveryLocale: "en",
      icp: {
        id: fixture.icpProfileId,
        version: 1,
        contentHash: fixture.icpContentHash,
      },
      snapshots: frozenSnapshots,
      ...(options.governance === undefined
        ? {}
        : { governance: options.governance }),
    };
    return new DiagnosticRunsRepository(handle.db).insert({
      runId: run.id,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      siteId: fixture.siteId,
      icpProfileId: fixture.icpProfileId,
      icpProfileVersion: 1,
      ruleSetVersion,
      promptSetVersion: "mvp.prompts.0.2.0",
      outputLocale: "en",
      inputManifest,
      inputHash: contentHash(inputManifest),
    });
  }

  it("freezes CSV and DataForSEO together while rejecting duplicate providers", async () => {
    const crawl = await insertSnapshot("crawl");
    const csv = await insertSnapshot("csv");
    const dataforseo = await insertSnapshot("dataforseo");

    await expect(
      insertDiagnostic([crawl, csv, dataforseo]),
    ).resolves.toMatchObject({
      rule_set_version: "mvp.rules.0.2.1",
      input_manifest: {
        snapshots: expect.arrayContaining([
          expect.objectContaining({ provider: "csv" }),
          expect.objectContaining({ provider: "dataforseo" }),
        ]),
      },
    });

    const secondCsv = await insertSnapshot("csv");
    await expect(
      insertDiagnostic([crawl, csv, secondCsv, dataforseo]),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
  });

  it("requires a canonical governance envelope for 0.2.2 and maps only CONTENT-GAP-011 to v2", async () => {
    const crawl = await insertSnapshot("crawl");
    const governance = {
      projectionVersion: "growth-governance.1.0.0",
      keywordClusters: [],
      competitors: [],
    } as const satisfies CanonicalValue;

    await expect(
      insertDiagnostic([crawl], {
        ruleSetVersion: "mvp.rules.0.2.2",
      }),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
    await expect(
      insertDiagnostic([crawl], {
        ruleSetVersion: "mvp.rules.0.2.2",
        governance: {
          ...governance,
          projectionVersion: "growth-governance.2.0.0",
        },
      }),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
    await expect(
      insertDiagnostic([crawl], {
        ruleSetVersion: "mvp.rules.0.2.2",
        governance: {
          ...governance,
          liveDatabaseFallback: true,
        },
      }),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");

    const diagnostic = await insertDiagnostic([crawl], {
      ruleSetVersion: "mvp.rules.0.2.2",
      governance,
    });
    expect(diagnostic).toMatchObject({
      rule_set_version: "mvp.rules.0.2.2",
      input_manifest: { governance },
    });

    await expect(
      handle.pool.query(
        `INSERT INTO app.diagnostic_run_rules (
           diagnostic_run_id, rule_id, rule_version, domain,
           status, reason, metrics, duration_ms
         ) VALUES ($1, 'CONTENT-GAP-011', 1, 'content_intent',
                   'candidate', NULL, '{}'::jsonb, 1)`,
        [diagnostic.id],
      ),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");

    await expect(
      handle.pool.query(
        `INSERT INTO app.diagnostic_run_rules (
           diagnostic_run_id, rule_id, rule_version, domain,
           status, reason, metrics, duration_ms
         ) VALUES
           ($1, 'CONTENT-GAP-011', 2, 'content_intent',
            'candidate', NULL, '{}'::jsonb, 1),
           ($1, 'TECH-LINKGRAPH-005', 2, 'technical_seo',
            'candidate', NULL, '{}'::jsonb, 1),
           ($1, 'SEARCH-CTR-004', 1, 'search_performance',
            'candidate', NULL, '{}'::jsonb, 1)`,
        [diagnostic.id],
      ),
    ).resolves.toMatchObject({ rowCount: 3 });
  });
});
