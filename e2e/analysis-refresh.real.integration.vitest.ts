import { randomUUID } from "node:crypto";

const ORIGINAL_DATAFORSEO_ENABLED = process.env["DATAFORSEO_ENABLED"];
const ORIGINAL_DATAFORSEO_LOGIN = process.env["DATAFORSEO_LOGIN"];
const ORIGINAL_DATAFORSEO_PASSWORD = process.env["DATAFORSEO_PASSWORD"];
const ORIGINAL_DATAFORSEO_MAX_KEYWORDS =
  process.env["DATAFORSEO_MAX_KEYWORDS"];
const ORIGINAL_DATAFORSEO_MAX_COMPETITORS =
  process.env["DATAFORSEO_MAX_COMPETITORS"];
const ORIGINAL_DATAFORSEO_BACKLINKS_ENABLED =
  process.env["DATAFORSEO_BACKLINKS_ENABLED"];

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "offline-google-client";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "offline-google-secret";
process.env["OPENAI_API_KEY"] ??= "sk-test";
process.env["OPENAI_MODEL"] ??= "gpt-test";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";
process.env["DATAFORSEO_ENABLED"] = "true";
process.env["DATAFORSEO_LOGIN"] = "offline-dataforseo-login";
process.env["DATAFORSEO_PASSWORD"] = "offline-dataforseo-password";
process.env["DATAFORSEO_MAX_KEYWORDS"] = "50";
process.env["DATAFORSEO_MAX_COMPETITORS"] = "25";
process.env["DATAFORSEO_BACKLINKS_ENABLED"] = "false";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
  CompetitorsRepository,
  contentHash,
  DataSnapshotsRepository,
  KeywordGovernanceRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  ObservationsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  TopicModelsRepository,
  type DbHandle,
  type PgBoss,
  type ProjectScope,
} from "../packages/db/src/index.ts";
import { createDbHandle } from "../packages/db/src/client.ts";
import {
  icpProfiles,
  workspaces,
} from "../packages/db/src/schema.ts";
import { CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
import type { Logger } from "../packages/observability/src/index.ts";
import {
  CRAWL_BUDGET,
  DATAFORSEO_COMPETITORS_DOMAIN_LIVE_URL,
  DATAFORSEO_RANKED_KEYWORDS_LIVE_URL,
  encodeCredentialEnvelope,
  encryptCredential,
  MemoryBlobStore,
  type CrawlFetcher,
  type OAuthCredentialEnvelope,
} from "../packages/sources/src/index.ts";
import {
  getProjectAuditCompetitor,
  listProjectAuditCompetitors,
} from "../apps/web/src/lib/services/growth-map-competitors.ts";
import {
  getProjectAuditKeyword,
  listProjectAuditKeywords,
} from "../apps/web/src/lib/services/growth-map-keywords.ts";
import {
  getProjectAuditUrl,
  listProjectAuditUrls,
} from "../apps/web/src/lib/services/growth-map.ts";
import {
  runCollection,
  type CollectionWorkerContext,
} from "../apps/worker/src/collection/run-collection.ts";
import { runDiagnostic } from "../apps/worker/src/diagnostic/run-diagnostic.ts";
import { runAnalysisRefresh } from "../apps/worker/src/analysis-refresh/run-analysis-refresh.ts";

const webQueue = vi.hoisted(() => ({
  send: vi.fn(async () => randomUUID()),
}));
vi.mock("@/lib/boss", () => ({ getBoss: async () => webQueue }));

const { createAnalysisRefreshRun } = await import(
  "../apps/web/src/lib/services/analysis-refresh.ts"
);

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const FIXED_NOW = new Date("2026-07-29T12:00:00.000Z");
const NOOP = (): void => undefined;
const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface Fixture {
  readonly scope: ProjectScope;
  readonly actorId: string;
  readonly siteId: string;
  readonly siteOrigin: string;
}

type ProviderFetch = typeof globalThis.fetch;

describeDb("Analysis Refresh real vertical chain", () => {
  let handle: DbHandle;
  let blockedGlobalFetch: ReturnType<typeof vi.fn<ProviderFetch>>;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
  });

  beforeEach(() => {
    webQueue.send.mockReset();
    webQueue.send.mockImplementation(async () => randomUUID());
    blockedGlobalFetch = vi.fn<ProviderFetch>(async () => {
      throw new Error("live network is disabled in Analysis Refresh tests");
    });
    vi.stubGlobal("fetch", blockedGlobalFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await handle?.end();
    restoreEnv("DATAFORSEO_ENABLED", ORIGINAL_DATAFORSEO_ENABLED);
    restoreEnv("DATAFORSEO_LOGIN", ORIGINAL_DATAFORSEO_LOGIN);
    restoreEnv("DATAFORSEO_PASSWORD", ORIGINAL_DATAFORSEO_PASSWORD);
    restoreEnv(
      "DATAFORSEO_MAX_KEYWORDS",
      ORIGINAL_DATAFORSEO_MAX_KEYWORDS,
    );
    restoreEnv(
      "DATAFORSEO_MAX_COMPETITORS",
      ORIGINAL_DATAFORSEO_MAX_COMPETITORS,
    );
    restoreEnv(
      "DATAFORSEO_BACKLINKS_ENABLED",
      ORIGINAL_DATAFORSEO_BACKLINKS_ENABLED,
    );
  });

  it("runs the server-owned Crawl → GSC → GA4 → composite DFS → Growth Audit plan and publishes one coherent generation", async () => {
    const fixture = await seedProject(handle);
    const context = workerContext(handle, fixture);
    const accepted = await createAnalysisRefreshRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      {},
    );
    const parentJob = {
      runId: accepted.run.id,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
      contractVersion: CONTRACT_VERSION,
    };
    await expect(
      stepByKey(
        handle,
        fixture.scope,
        accepted.run.id,
        "dataforseo_backlinks",
      ),
    ).resolves.toMatchObject({
      state: "skipped",
      skip_reason: "feature_disabled",
    });

    for (const stepKey of ["crawl", "gsc", "ga4", "dataforseo"] as const) {
      await runAnalysisRefresh(context, parentJob, {
        now: () => FIXED_NOW,
        continuationDelayMs: 0,
      });
      const started = await stepByKey(
        handle,
        fixture.scope,
        accepted.run.id,
        stepKey,
      );
      expect(started).toMatchObject({
        state: "running",
        child_async_run_id: expect.any(String),
      });
      await runCollection(context, {
        runId: started.child_async_run_id!,
        workspaceId: fixture.scope.workspaceId,
        projectId: fixture.scope.projectId,
      });
      if (stepKey === "dataforseo") {
        await approveProjectedGovernance(handle, fixture);
      }
      await runAnalysisRefresh(context, parentJob, {
        now: () => FIXED_NOW,
        continuationDelayMs: 0,
      });
      await expect(
        stepByKey(handle, fixture.scope, accepted.run.id, stepKey),
      ).resolves.toMatchObject({
        state: "completed",
        child_async_run_id: started.child_async_run_id,
        result_snapshot_id: expect.any(String),
      });
    }

    await runAnalysisRefresh(context, parentJob, {
      now: () => FIXED_NOW,
      continuationDelayMs: 0,
    });
    const auditStep = await stepByKey(
      handle,
      fixture.scope,
      accepted.run.id,
      "growth_audit",
    );
    expect(auditStep).toMatchObject({
      state: "running",
      child_async_run_id: expect.any(String),
    });
    const diagnosticRunId = auditStep.child_async_run_id!;
    await runDiagnostic(context, {
      runId: diagnosticRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });
    await expect(
      new AsyncRunsRepository(handle.db).findById(
        fixture.scope,
        diagnosticRunId,
      ),
    ).resolves.toMatchObject({
      status: expect.stringMatching(/^(completed|partial)$/u),
      result_type: "diagnostic_run",
      result_id: diagnosticRunId,
    });

    await runAnalysisRefresh(context, parentJob, {
      now: () => FIXED_NOW,
      continuationDelayMs: 0,
    });
    await expect(
      new AsyncRunsRepository(handle.db).findById(
        fixture.scope,
        accepted.run.id,
      ),
    ).resolves.toMatchObject({
      // The full provider plan completed. The audit is still honestly partial
      // when one or more deterministic rules have no applicable subject data;
      // the parent must preserve that terminal truth instead of upgrading it.
      status: "partial",
      result_type: "analysis_refresh_run",
      result_id: accepted.run.id,
    });
    await expect(
      stepByKey(handle, fixture.scope, accepted.run.id, "growth_audit"),
    ).resolves.toMatchObject({
      state: "completed",
      child_async_run_id: diagnosticRunId,
    });

    const snapshots = await new DataSnapshotsRepository(
      handle.db,
    ).listByProject(fixture.scope, { limit: 20, cursor: null });
    const dataForSeoSnapshots = snapshots.rows.filter(
      (snapshot) => snapshot.provider === "dataforseo",
    );
    expect(dataForSeoSnapshots).toEqual([
      expect.objectContaining({
        dataset_key: "dataforseo.search_landscape.v2",
        method_version: "dataforseo.search_landscape.v2",
        availability: "available",
        row_count: 3,
      }),
    ]);
    const dataForSeoSnapshot = dataForSeoSnapshots[0]!;
    const dataForSeoObservations = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(fixture.scope, [dataForSeoSnapshot.id]);
    expect(
      dataForSeoObservations.filter(
        (row) => row.metric_key === "csv.keyword_gap.v1",
      ),
    ).toHaveLength(1);
    expect(
      dataForSeoObservations.filter(
        (row) => row.metric_key === "dataforseo.competitor_domain.v1",
      ),
    ).toHaveLength(2);

    const keywordPage = await new KeywordsRepository(handle.db).listByProject(
      fixture.scope,
      { limit: 20, cursor: null },
    );
    const dataForSeoKeyword = keywordPage.rows.find(
      (keyword) => keyword.normalized_keyword === "enterprise seo platform",
    );
    expect(dataForSeoKeyword).toBeDefined();
    await expect(
      new KeywordOccurrencesRepository(handle.db).listForEntity(
        fixture.scope,
        dataForSeoKeyword!.id,
        { limit: 20, cursor: null },
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          data_snapshot_id: dataForSeoSnapshot.id,
          source_kind: "dataforseo_ranked",
          source_pointer: "/valueJson/keyword",
        }),
      ],
    });

    const competitorPage = await new CompetitorsRepository(
      handle.db,
    ).listByProject(fixture.scope, { limit: 20, cursor: null });
    expect(competitorPage.rows.map((row) => row.domain).sort()).toEqual([
      "rival-one.example",
      "rival-two.example",
    ]);
    for (const competitor of competitorPage.rows) {
      await expect(
        new CompetitorsRepository(handle.db).listOrigins(
          fixture.scope,
          competitor.id,
          20,
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          origin_kind: "serp_overlap",
          data_snapshot_id: dataForSeoSnapshot.id,
          normalized_observation_id: expect.any(String),
          source_pointer: "/valueJson/competitorDomain",
        }),
      ]);
    }

    const urlRead = await listProjectAuditUrls(
      { workspaceId: fixture.scope.workspaceId, uiLocale: "zh-CN" },
      fixture.scope.projectId,
      {
        limit: 50,
        cursor: null,
        diagnosticRunId,
        now: FIXED_NOW,
      },
      handle.db,
    );
    const keywordRead = await listProjectAuditKeywords(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      {
        limit: 50,
        cursor: null,
        diagnosticRunId,
        now: FIXED_NOW,
      },
      handle.db,
    );
    const competitorRead = await listProjectAuditCompetitors(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      { limit: 50, cursor: null, diagnosticRunId },
      handle.db,
    );

    expect(urlRead.diagnosticRunId).toBe(diagnosticRunId);
    expect(urlRead.data).not.toHaveLength(0);
    expect(
      urlRead.data.every((row) => row.diagnosticRunId === diagnosticRunId),
    ).toBe(true);
    expect(
      keywordRead.data.find(
        (row) => row.normalizedKeyword === "enterprise seo platform",
      )?.sourceOccurrences,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshotId: dataForSeoSnapshot.id,
          sourceKind: "dataforseo_ranked",
        }),
      ]),
    );
    expect(
      competitorRead.data.flatMap((row) => row.originOccurrences),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originKind: "serp_overlap",
          snapshotId: dataForSeoSnapshot.id,
        }),
      ]),
    );

    const selectedUrl = urlRead.data[0]!;
    const selectedKeyword = keywordRead.data.find(
      (row) => row.normalizedKeyword === "enterprise seo platform",
    )!;
    const selectedCompetitor = competitorRead.data.find(
      (row) => row.domain === "rival-one.example",
    )!;
    const [urlDetail, keywordDetail, competitorDetail] = await Promise.all([
      getProjectAuditUrl(
        { workspaceId: fixture.scope.workspaceId, uiLocale: "zh-CN" },
        fixture.scope.projectId,
        selectedUrl.sitePageId,
        { diagnosticRunId },
        handle.db,
      ),
      getProjectAuditKeyword(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        selectedKeyword.keywordId,
        diagnosticRunId,
        handle.db,
      ),
      getProjectAuditCompetitor(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        selectedCompetitor.competitorId,
        { diagnosticRunId },
        handle.db,
      ),
    ]);
    expect(urlDetail.diagnosticRunId).toBe(diagnosticRunId);
    expect(keywordDetail.data.keywordId).toBe(selectedKeyword.keywordId);
    expect(competitorDetail.data.competitorId).toBe(
      selectedCompetitor.competitorId,
    );
    expect(blockedGlobalFetch).not.toHaveBeenCalled();
  });

  it("publishes a truthful partial generation when every optional source is unavailable", async () => {
    const fixture = await seedProject(handle, { googleConnections: false });
    const context = workerContext(handle, fixture, {
      dataForSeoAvailable: false,
    });
    const accepted = await createAnalysisRefreshRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      {},
    );
    const parentJob = {
      runId: accepted.run.id,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
      contractVersion: CONTRACT_VERSION,
    };

    await expect(
      stepByKey(handle, fixture.scope, accepted.run.id, "gsc"),
    ).resolves.toMatchObject({
      state: "skipped",
      skip_reason: "source_not_connected",
    });
    await expect(
      stepByKey(handle, fixture.scope, accepted.run.id, "ga4"),
    ).resolves.toMatchObject({
      state: "skipped",
      skip_reason: "source_not_connected",
    });

    await runAnalysisRefresh(context, parentJob, {
      now: () => FIXED_NOW,
      continuationDelayMs: 0,
    });
    const crawlStep = await stepByKey(
      handle,
      fixture.scope,
      accepted.run.id,
      "crawl",
    );
    await runCollection(context, {
      runId: crawlStep.child_async_run_id!,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });
    await runAnalysisRefresh(context, parentJob, {
      now: () => FIXED_NOW,
      continuationDelayMs: 0,
    });

    await runAnalysisRefresh(context, parentJob, {
      now: () => FIXED_NOW,
      continuationDelayMs: 0,
    });
    await expect(
      stepByKey(handle, fixture.scope, accepted.run.id, "dataforseo"),
    ).resolves.toMatchObject({
      state: "skipped",
      skip_reason: "worker_credentials_unavailable",
      child_async_run_id: null,
      result_snapshot_id: null,
    });

    await runAnalysisRefresh(context, parentJob, {
      now: () => FIXED_NOW,
      continuationDelayMs: 0,
    });
    const auditStep = await stepByKey(
      handle,
      fixture.scope,
      accepted.run.id,
      "growth_audit",
    );
    const diagnosticRunId = auditStep.child_async_run_id!;
    await runDiagnostic(context, {
      runId: diagnosticRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });
    await runAnalysisRefresh(context, parentJob, {
      now: () => FIXED_NOW,
      continuationDelayMs: 0,
    });

    await expect(
      new AsyncRunsRepository(handle.db).findById(
        fixture.scope,
        accepted.run.id,
      ),
    ).resolves.toMatchObject({
      status: "partial",
      result_type: "analysis_refresh_run",
      result_id: accepted.run.id,
    });
    const snapshots = await new DataSnapshotsRepository(
      handle.db,
    ).listByProject(fixture.scope, { limit: 20, cursor: null });
    expect(snapshots.rows).toEqual([
      expect.objectContaining({
        provider: "crawl",
        availability: "available",
      }),
    ]);

    const [urlRead, keywordRead, competitorRead] = await Promise.all([
      listProjectAuditUrls(
        { workspaceId: fixture.scope.workspaceId, uiLocale: "zh-CN" },
        fixture.scope.projectId,
        {
          limit: 50,
          cursor: null,
          diagnosticRunId,
          now: FIXED_NOW,
        },
        handle.db,
      ),
      listProjectAuditKeywords(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        {
          limit: 50,
          cursor: null,
          diagnosticRunId,
          now: FIXED_NOW,
        },
        handle.db,
      ),
      listProjectAuditCompetitors(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        { limit: 50, cursor: null, diagnosticRunId },
        handle.db,
      ),
    ]);
    expect(urlRead.data).not.toHaveLength(0);
    expect(
      new Set(
        urlRead.data.flatMap((row) =>
          row.metricObservations.map((observation) => observation.provider),
        ),
      ),
    ).toEqual(new Set(["crawl"]));
    expect(urlRead.meta.coverage).toMatchObject({
      availability: "partial",
      limitations: expect.arrayContaining([
        expect.stringMatching(/GSC/u),
        expect.stringMatching(/GA4/u),
      ]),
    });
    expect(keywordRead.data).toEqual([]);
    expect(keywordRead.meta.coverage.availability).toBe("unavailable");
    expect(competitorRead.data).toEqual([]);
    expect(blockedGlobalFetch).not.toHaveBeenCalled();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function approveProjectedGovernance(
  handle: DbHandle,
  fixture: Fixture,
): Promise<void> {
  const keywordPage = await new KeywordsRepository(handle.db).listByProject(
    fixture.scope,
    { limit: 20, cursor: null },
  );
  const dataForSeoKeyword = keywordPage.rows.find(
    (keyword) => keyword.normalized_keyword === "enterprise seo platform",
  );
  if (!dataForSeoKeyword) {
    throw new Error("DataForSEO Keyword projection was not available to review");
  }

  const topics = new TopicModelsRepository(handle.db);
  const draft = await topics.beginDraftFromLatestConfirmed(
    fixture.scope,
    fixture.actorId,
    {
      expectedLatestConfirmedRevision: 0,
      reason: "Create the reviewed Topic for the Analysis Refresh fixture.",
    },
  );
  const edited = await topics.patchDraft(fixture.scope, fixture.actorId, {
    topicModelRevision: draft.topicModelRevision,
    expectedEditRevision: draft.editRevision,
    reason: "Add the projected DataForSEO Keyword to a governed Topic.",
    intents: [
      {
        kind: "create",
        parentTopicNodeId: null,
        label: "Enterprise SEO",
        description:
          "Confirmed Topic for the Analysis Refresh vertical integration.",
        intentEnvelope: ["Commercial"],
      },
    ],
  });
  const confirmed = await topics.confirmDraft(
    fixture.scope,
    fixture.actorId,
    {
      topicModelRevision: edited.topicModelRevision,
      expectedEditRevision: edited.editRevision,
      reason: "Confirm the Topic before freezing the Growth Audit generation.",
    },
  );
  if (confirmed.rootTopicNodeId === null) {
    throw new Error("Analysis Refresh fixture did not produce a Topic root");
  }
  await new KeywordGovernanceRepository(handle.db).reviewKeyword(
    fixture.scope,
    dataForSeoKeyword.id,
    fixture.actorId,
    {
      expectedGovernanceRevision: 0,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: confirmed.rootTopicNodeId,
      topicModelRevision: confirmed.topicModelRevision,
      mappingDecision: "new_asset",
      mappedSitePageId: null,
      reason:
        "Approve the projected Keyword before freezing this diagnostic generation.",
    },
  );

  const competitors = new CompetitorsRepository(handle.db);
  const competitorPage = await competitors.listByProject(fixture.scope, {
    limit: 20,
    cursor: null,
  });
  expect(competitorPage.rows).toHaveLength(2);
  for (const competitor of competitorPage.rows) {
    const reviewed = await competitors.review(
      fixture.scope,
      competitor.id,
      {
        expectedRevision: competitor.revision,
        name: competitor.name,
        reviewStatus: "approved",
        relationship: "direct",
        analysisScope: ["keyword_gap", "serp_visibility"],
      },
    );
    expect(reviewed).toMatchObject({
      id: competitor.id,
      review_status: "approved",
      revision: competitor.revision + 1,
    });
  }
}

async function seedProject(
  handle: DbHandle,
  options: { readonly googleConnections?: boolean } = {},
): Promise<Fixture> {
  const actorId = randomUUID();
  const [workspace] = await handle.db
    .insert(workspaces)
    .values({ name: `Analysis Refresh vertical ${randomUUID()}` })
    .returning();
  const workspaceId = workspace!.id;
  const project = await new ProjectsRepository(handle.db).insert({
    workspaceId,
    clientName: "Real vertical fixture",
    projectName: "Real vertical fixture",
    defaultDeliveryLocale: "en-US",
    createdBy: actorId,
  });
  const host = `analysis-refresh-${randomUUID().slice(0, 8)}.example`;
  const siteOrigin = `https://${host}`;
  const site = await new SitesRepository(handle.db).insertPrimary({
    workspaceId,
    projectId: project.id,
    origin: siteOrigin,
    host,
    marketCodes: ["US"],
    languageCodes: ["en-US"],
  });
  await new SourceConnectionsRepository(handle.db).insertDefaultCrawl({
    workspaceId,
    projectId: project.id,
    siteId: site.id,
    createdBy: actorId,
  });

  const profileHash = contentHash({
    projectId: project.id,
    version: 1,
    fixture: "analysis-refresh-real-vertical",
  });
  const [profile] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: workspaceId,
      project_id: project.id,
      version: 1,
      status: "complete",
      profile: {
        productName: "Real Vertical Platform",
        oneLineDescription:
          "Deterministic SEO analysis for mid-market growth teams.",
        category: "B2B SaaS",
        marketCodes: ["US"],
        segments: ["SEO leaders at mid-market companies"],
      },
      content_hash: profileHash,
      created_by: actorId,
    })
    .returning();
  const projects = new ProjectsRepository(handle.db);
  expect(
    await projects.setCurrentIcpProfile(
      { workspaceId },
      project.id,
      profile!.id,
    ),
  ).toBe(true);
  expect(
    await projects.setConfirmedIcpProfile(
      { workspaceId },
      project.id,
      profile!.id,
    ),
  ).toBe(true);

  if (options.googleConnections !== false) {
    await seedGoogleConnection(handle, {
      scope: { workspaceId, projectId: project.id },
      actorId,
      siteId: site.id,
      provider: "gsc",
      externalRef: `${siteOrigin}/`,
      config: { propertyUrl: `${siteOrigin}/` },
      scopeName: "https://www.googleapis.com/auth/webmasters.readonly",
      accessToken: "offline-gsc-access",
    });
    await seedGoogleConnection(handle, {
      scope: { workspaceId, projectId: project.id },
      actorId,
      siteId: site.id,
      provider: "ga4",
      externalRef: "123456789",
      config: {
        propertyId: "123456789",
        propertyTimeZone: "UTC",
        keyEventNames: ["generate_lead"],
      },
      scopeName: "https://www.googleapis.com/auth/analytics.readonly",
      accessToken: "offline-ga4-access",
    });
  }

  return {
    scope: { workspaceId, projectId: project.id },
    actorId,
    siteId: site.id,
    siteOrigin,
  };
}

async function seedGoogleConnection(
  handle: DbHandle,
  input: {
    readonly scope: ProjectScope;
    readonly actorId: string;
    readonly siteId: string;
    readonly provider: "gsc" | "ga4";
    readonly externalRef: string;
    readonly config: Record<string, unknown>;
    readonly scopeName: string;
    readonly accessToken: string;
  },
): Promise<void> {
  const connection = await new SourceConnectionsRepository(
    handle.db,
  ).insertConnection({
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    siteId: input.siteId,
    provider: input.provider,
    connectionType: "oauth",
    state: "connected",
    externalRef: input.externalRef,
    scopes: [input.scopeName],
    config: input.config,
    limitation: `Deterministic offline ${input.provider} fixture.`,
    connectedAt: true,
    createdBy: input.actorId,
  });
  const envelope: OAuthCredentialEnvelope = {
    accessToken: input.accessToken,
    refreshToken: `offline-${input.provider}-refresh`,
    expiresAt: "2030-01-01T00:00:00.000Z",
    scope: input.scopeName,
  };
  await new SourceCredentialsRepository(handle.db).replace({
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    sourceConnectionId: connection.id,
    encryptedPayload: encryptCredential(
      encodeCredentialEnvelope(envelope),
      Buffer.alloc(32),
    ),
    keyVersion: "v1",
    expiresAt: envelope.expiresAt,
  });
}

function workerContext(
  handle: DbHandle,
  fixture: Fixture,
  options: { readonly dataForSeoAvailable?: boolean } = {},
): CollectionWorkerContext {
  const blobStore = new MemoryBlobStore();
  const crawlFetcher: CrawlFetcher = {
    async fetch(url) {
      if (url === `${fixture.siteOrigin}/robots.txt`) {
        return new Response("User-agent: *\nAllow: /", {
          headers: { "content-type": "text/plain" },
        });
      }
      if (url === `${fixture.siteOrigin}/sitemap.xml`) {
        return new Response("missing", { status: 404 });
      }
      if (url === `${fixture.siteOrigin}/`) {
        return new Response(
          `<html lang="en"><head><title>Real Vertical Platform</title><link rel="canonical" href="${fixture.siteOrigin}/"></head><body><h1>Real Vertical Platform</h1><a href="/pricing">Pricing</a></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url === `${fixture.siteOrigin}/pricing`) {
        return new Response(
          `<html lang="en"><head><title>Pricing</title><link rel="canonical" href="${fixture.siteOrigin}/pricing"></head><body><h1>Pricing</h1></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      return new Response("not found", { status: 404 });
    },
  };
  const googleFetch = vi.fn<ProviderFetch>(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      readonly dimensions?: readonly { readonly name?: string }[];
      readonly endDate?: string;
    };
    if (url.includes("/searchAnalytics/query")) {
      return Response.json({
        rows: [
          {
            keys: [
              body.endDate ?? "2026-07-28",
              `${fixture.siteOrigin}/pricing`,
              "pricing analytics",
            ],
            clicks: 7,
            impressions: 140,
            position: 2.5,
          },
        ],
      });
    }
    if (url.endsWith(":checkCompatibility")) {
      return Response.json({});
    }
    if (url.includes("analyticsdata.googleapis.com") && url.endsWith(":runReport")) {
      const dimensions = body.dimensions?.map((value) => value.name);
      if (dimensions?.includes("eventName")) {
        return Response.json({
          rowCount: 1,
          rows: [
            {
              dimensionValues: [
                { value: "20260728" },
                { value: "/pricing" },
                { value: "generate_lead" },
              ],
              metricValues: [{ value: "3" }],
            },
          ],
        });
      }
      return Response.json({
        rowCount: 1,
        rows: [
          {
            dimensionValues: [
              { value: "20260728" },
              { value: "/pricing" },
            ],
            metricValues: [
              { value: "10" },
              { value: "8" },
              { value: "0.8" },
            ],
          },
        ],
      });
    }
    throw new Error(`unexpected Google fixture URL ${url}`);
  });
  const dataForSeoFetch = vi.fn<ProviderFetch>(async (input) => {
    const url = String(input);
    if (url === DATAFORSEO_RANKED_KEYWORDS_LIVE_URL) {
      return Response.json({
        status_code: 20_000,
        cost: 0.01,
        tasks: [
          {
            status_code: 20_000,
            cost: 0.01,
            result_count: 1,
            result: [
              {
                total_count: 1,
                items_count: 1,
                items: [
                  {
                    keyword_data: {
                      keyword: "enterprise seo platform",
                      keyword_info: { search_volume: 720 },
                    },
                    ranked_serp_element: {
                      serp_item: {
                        url: `${fixture.siteOrigin}/`,
                        rank_group: 7,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
    }
    if (url === DATAFORSEO_COMPETITORS_DOMAIN_LIVE_URL) {
      return Response.json({
        status_code: 20_000,
        cost: 0.02,
        tasks: [
          {
            status_code: 20_000,
            cost: 0.02,
            result_count: 1,
            result: [
              {
                total_count: 2,
                items_count: 2,
                items: [
                  {
                    domain: "rival-one.example",
                    avg_position: 12.25,
                    sum_position: 49,
                    intersections: 4,
                    competitor_metrics: {
                      organic: { etv: 1_850.75 },
                    },
                  },
                  {
                    domain: "rival-two.example",
                    avg_position: 8,
                    sum_position: 8,
                    intersections: 1,
                    competitor_metrics: {
                      organic: { etv: 700 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
    }
    throw new Error(`unexpected DataForSEO fixture URL ${url}`);
  });
  const boss = { send: webQueue.send } as unknown as PgBoss;
  return {
    db: handle.db,
    boss,
    blobStore,
    credentialKey: Buffer.alloc(32),
    appOrigin: "http://localhost:3000",
    googleOAuth: {
      clientId: "offline-google-client",
      clientSecret: "offline-google-secret",
      fetch: googleFetch,
      now: () => FIXED_NOW,
    },
    dataForSeo: {
      enabled: options.dataForSeoAvailable !== false,
      login:
        options.dataForSeoAvailable === false
          ? null
          : "offline-dataforseo-login",
      password:
        options.dataForSeoAvailable === false
          ? null
          : "offline-dataforseo-password",
      maxKeywords: 50,
      maxCompetitors: 25,
      fetch: dataForSeoFetch,
    },
    openai: { apiKey: "sk-test", model: "gpt-test" },
    findingSummariesEnabled: false,
    logger,
    crawl: {
      fetcher: crawlFetcher,
      engineOptions: {
        guard: async (url: string) => ({
          safe: true as const,
          normalizedUrl: new URL(url).href,
          pinnedIp: "93.184.216.34",
          reason: null,
        }),
        budget: {
          ...CRAWL_BUDGET,
          maxUrls: 2,
          perHostConcurrency: 1,
          minHostDelayMs: 0,
        },
      },
    },
  };
}

async function stepByKey(
  handle: DbHandle,
  scope: ProjectScope,
  runId: string,
  stepKey:
    | "crawl"
    | "gsc"
    | "ga4"
    | "dataforseo"
    | "dataforseo_backlinks"
    | "growth_audit",
) {
  const steps = await new AnalysisRefreshRunsRepository(handle.db).listSteps(
    scope,
    runId,
  );
  const step = steps.find((candidate) => candidate.step_key === stepKey);
  if (!step) throw new Error(`missing Analysis Refresh step ${stepKey}`);
  return step;
}
