import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
  CompetitorsRepository,
  contentHash,
  IcpProfilesRepository,
  IdempotencyRepository,
  KeywordsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
} from "@sf/db";
import { createInitialProductProfileDraft } from "@sf/contracts";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  actor: "00000000-0000-4000-8000-000000000003",
  site: "00000000-0000-4000-8000-000000000004",
  profile: "00000000-0000-4000-8000-000000000005",
  crawl: "00000000-0000-4000-8000-000000000006",
  gsc: "00000000-0000-4000-8000-000000000007",
  ga4: "00000000-0000-4000-8000-000000000008",
  idem: "00000000-0000-4000-8000-000000000009",
  winner: "00000000-0000-4000-8000-000000000010",
} as const;

const mocks = vi.hoisted(() => {
  const tx = {};
  const db = {
    transaction: vi.fn(async (callback: (executor: object) => unknown) =>
      callback(tx),
    ),
  };
  return {
    db,
    tx,
    enqueueRunInTx: vi.fn(async () => "queue-job"),
    getBoss: vi.fn(async () => ({ name: "boss" })),
    getEnv: vi.fn(() => ({
      DATAFORSEO_ENABLED: "true" as "true" | "false",
      DATAFORSEO_BACKLINKS_ENABLED: "true" as "true" | "false",
      DATAFORSEO_AI_CITATIONS_ENABLED: "false" as "true" | "false",
      DATAFORSEO_AI_CITATION_MODEL: undefined as string | undefined,
      DATAFORSEO_MAX_KEYWORDS: 350,
      DATAFORSEO_MAX_COMPETITORS: 75,
      DATAFORSEO_MAX_BACKLINKS: 500,
      DATAFORSEO_MAX_REFERRING_DOMAINS: 100,
      DATAFORSEO_MAX_BACKLINK_PAGES: 500,
      DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: 20,
    })),
  };
});

vi.mock("@sf/db", async () => {
  const actual = await vi.importActual<typeof import("@sf/db")>("@sf/db");
  return { ...actual, enqueueRunInTx: mocks.enqueueRunInTx };
});
vi.mock("@/lib/db", () => ({ getDb: () => ({ db: mocks.db }) }));
vi.mock("@/lib/boss", () => ({ getBoss: mocks.getBoss }));
vi.mock("@/env", () => ({ getEnv: mocks.getEnv }));

const {
  createAnalysisRefreshRun,
  freezeDataForSeoAiCitationPolicy,
  parseAnalysisRefreshRequestPayload,
} = await import("../analysis-refresh.ts");

const project = {
  id: ids.project,
  workspace_id: ids.workspace,
  archived_at: null,
  confirmed_icp_profile_id: ids.profile,
  default_delivery_locale: "zh-CN",
};
const profile = {
  id: ids.profile,
  version: 7,
  content_hash: "a".repeat(64),
  status: "complete",
  profile: {},
};
const site = {
  id: ids.site,
  market_codes: [],
  // Analysis Refresh must not require an operator-declared Site language.
  language_codes: [],
};
const connections = {
  crawl: { id: ids.crawl, provider: "crawl", site_id: ids.site },
  gsc: { id: ids.gsc, provider: "gsc", site_id: ids.site },
  ga4: { id: ids.ga4, provider: "ga4", site_id: ids.site },
} as const;

function queuedRun(runId: string) {
  return {
    id: runId,
    workspace_id: ids.workspace,
    project_id: ids.project,
    kind: "analysis_refresh",
    status: "queued",
    active_key: "analysis_refresh",
    contract_version: "2026-07-21",
    request_payload: {},
    progress: {},
    last_error_code: null,
    last_error_summary: null,
    result_type: "analysis_refresh_run",
    result_id: runId,
    attempt_count: 0,
    initiated_by: ids.actor,
    queued_at: "2026-07-29T00:00:00.000Z",
    started_at: null,
    completed_at: null,
  };
}

function mockConnectionReads(
  values: {
    readonly crawl:
      | { readonly id: string; readonly provider: string; readonly site_id: string }
      | null;
    readonly gsc:
      | { readonly id: string; readonly provider: string; readonly site_id: string }
      | null;
    readonly ga4:
      | { readonly id: string; readonly provider: string; readonly site_id: string }
      | null;
  } = connections,
) {
  const resolve = async (_scope: unknown, provider: string) =>
    values[provider as keyof typeof values] ?? null;
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "findConnectedByProvider",
  ).mockImplementation(resolve as never);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "findConnectedByProviderForUpdate",
  ).mockImplementation(resolve as never);
}

function mockHappyPath(
  connectionValues: {
    readonly crawl:
      | { readonly id: string; readonly provider: string; readonly site_id: string }
      | null;
    readonly gsc:
      | { readonly id: string; readonly provider: string; readonly site_id: string }
      | null;
    readonly ga4:
      | { readonly id: string; readonly provider: string; readonly site_id: string }
      | null;
  } = connections,
) {
  vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue({
    id: ids.idem,
  } as never);
  vi.spyOn(IdempotencyRepository.prototype, "complete").mockResolvedValue(
    undefined as never,
  );
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
    project as never,
  );
  vi.spyOn(
    ProjectsRepository.prototype,
    "findByIdForUpdate",
  ).mockResolvedValue(project as never);
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(
    profile as never,
  );
  vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue(
    site as never,
  );
  mockConnectionReads(connectionValues);
  vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(null);
  vi.spyOn(AsyncRunsRepository.prototype, "insertQueued").mockImplementation(
    async (values) => queuedRun(values.runId!) as never,
  );
  vi.spyOn(AnalysisRefreshRunsRepository.prototype, "create").mockResolvedValue({
    run: { id: "projection" },
    steps: [],
  } as never);
  vi.spyOn(AnalysisRefreshRunsRepository.prototype, "skipStep").mockResolvedValue(
    true,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.db.transaction.mockImplementation(
    async (callback: (executor: object) => unknown) => callback(mocks.tx),
  );
  mocks.getEnv.mockReturnValue({
    DATAFORSEO_ENABLED: "true",
    DATAFORSEO_BACKLINKS_ENABLED: "true",
    DATAFORSEO_AI_CITATIONS_ENABLED: "false",
    DATAFORSEO_AI_CITATION_MODEL: undefined,
    DATAFORSEO_MAX_KEYWORDS: 350,
    DATAFORSEO_MAX_COMPETITORS: 75,
    DATAFORSEO_MAX_BACKLINKS: 500,
    DATAFORSEO_MAX_REFERRING_DOMAINS: 100,
    DATAFORSEO_MAX_BACKLINK_PAGES: 500,
    DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: 20,
  });
});

describe("createAnalysisRefreshRun", () => {
  it("atomically freezes the server-owned inputs and enqueues one parent", async () => {
    mockHappyPath();
    const begin = vi.spyOn(IdempotencyRepository.prototype, "begin");
    const insertQueued = vi.spyOn(
      AsyncRunsRepository.prototype,
      "insertQueued",
    );
    const createPlan = vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "create",
    );
    const skipStep = vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "skipStep",
    );
    const complete = vi.spyOn(IdempotencyRepository.prototype, "complete");

    const accepted = await createAnalysisRefreshRun(
      { workspaceId: ids.workspace },
      ids.project,
      ids.actor,
      "refresh-key",
      {},
    );

    expect(accepted).toMatchObject({
      status: 202,
      replayed: false,
      resourceRef: {
        type: "analysis_refresh_run",
        id: accepted.run.id,
      },
      location: `/api/mvp/projects/${ids.project}/runs/${accepted.run.id}`,
    });
    expect(begin).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      scope: "createAnalysisRefreshRun",
      key: "refresh-key",
      requestHash: contentHash({ projectId: ids.project }),
      expiresAt: expect.any(String),
    });
    const inserted = insertQueued.mock.calls[0]?.[0];
    expect(inserted).toEqual({
      runId: accepted.run.id,
      workspaceId: ids.workspace,
      projectId: ids.project,
      kind: "analysis_refresh",
      activeKey: "analysis_refresh",
      initiatedBy: ids.actor,
      contractVersion: expect.any(String),
      resultType: "analysis_refresh_run",
      resultId: accepted.run.id,
      requestPayload: {
        siteId: ids.site,
        icpProfile: {
          id: ids.profile,
          version: 7,
          contentHash: "a".repeat(64),
        },
        outputLocale: "zh-CN",
        sourceConnectionIds: {
          crawl: ids.crawl,
          gsc: ids.gsc,
          ga4: ids.ga4,
        },
        dataForSeo: {
          enabled: true,
          maxKeywords: 350,
          maxCompetitors: 75,
          aiCitations: { state: "disabled" },
        },
        dataForSeoBacklinks: {
          enabled: true,
          maxBacklinks: 500,
          maxReferringDomains: 100,
          maxBacklinkPages: 500,
          maxSourceVerifications: 20,
        },
      },
    });
    expect(createPlan).toHaveBeenCalledWith({
      runId: accepted.run.id,
      workspaceId: ids.workspace,
      projectId: ids.project,
      siteId: ids.site,
      icpProfileId: ids.profile,
    });
    expect(skipStep).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      mocks.tx,
      "refresh.analysis",
      {
        runId: accepted.run.id,
        workspaceId: ids.workspace,
        projectId: ids.project,
        contractVersion: expect.any(String),
      },
    );
    expect(complete).toHaveBeenCalledWith(ids.idem, {
      responseStatus: 202,
      responseBody: {
        run: accepted.run,
        statusUrl: accepted.statusUrl,
        resourceRef: accepted.resourceRef,
      },
      resourceType: "analysis_refresh_run",
      resourceId: accepted.run.id,
    });

    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(
      insertQueued.mock.invocationCallOrder[0]!,
    );
    expect(insertQueued.mock.invocationCallOrder[0]).toBeLessThan(
      createPlan.mock.invocationCallOrder[0]!,
    );
    expect(createPlan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueueRunInTx.mock.invocationCallOrder[0]!,
    );
    expect(mocks.enqueueRunInTx.mock.invocationCallOrder[0]).toBeLessThan(
      complete.mock.invocationCallOrder[0]!,
    );
  });

  it("skips unavailable optional sources and both DataForSEO steps when the global feature is disabled", async () => {
    mocks.getEnv.mockReturnValue({
      DATAFORSEO_ENABLED: "false",
      DATAFORSEO_BACKLINKS_ENABLED: "true",
      DATAFORSEO_AI_CITATIONS_ENABLED: "false",
      DATAFORSEO_AI_CITATION_MODEL: undefined,
      DATAFORSEO_MAX_KEYWORDS: 200,
      DATAFORSEO_MAX_COMPETITORS: 100,
      DATAFORSEO_MAX_BACKLINKS: 300,
      DATAFORSEO_MAX_REFERRING_DOMAINS: 80,
      DATAFORSEO_MAX_BACKLINK_PAGES: 250,
      DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: 12,
    });
    mockHappyPath({ crawl: connections.crawl, gsc: null, ga4: null });
    const insertQueued = vi.spyOn(
      AsyncRunsRepository.prototype,
      "insertQueued",
    );
    const skipStep = vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "skipStep",
    );

    await createAnalysisRefreshRun(
      { workspaceId: ids.workspace },
      ids.project,
      ids.actor,
      "refresh-skip-key",
      {},
    );

    expect(insertQueued.mock.calls[0]?.[0].requestPayload).toMatchObject({
      sourceConnectionIds: {
        crawl: ids.crawl,
        gsc: null,
        ga4: null,
      },
      dataForSeo: {
        enabled: false,
        maxKeywords: 200,
        maxCompetitors: 100,
        aiCitations: { state: "disabled" },
      },
      dataForSeoBacklinks: {
        enabled: false,
        maxBacklinks: 300,
        maxReferringDomains: 80,
        maxBacklinkPages: 250,
        maxSourceVerifications: 12,
      },
    });
    expect(skipStep.mock.calls.map((call) => call.slice(2))).toEqual([
      ["gsc", "source_not_connected"],
      ["ga4", "source_not_connected"],
      ["dataforseo", "feature_disabled"],
      ["dataforseo_backlinks", "feature_disabled"],
    ]);
  });

  it("freezes and pre-skips only the backlink step when its independent rollout flag is disabled", async () => {
    mocks.getEnv.mockReturnValue({
      DATAFORSEO_ENABLED: "true",
      DATAFORSEO_BACKLINKS_ENABLED: "false",
      DATAFORSEO_AI_CITATIONS_ENABLED: "false",
      DATAFORSEO_AI_CITATION_MODEL: undefined,
      DATAFORSEO_MAX_KEYWORDS: 200,
      DATAFORSEO_MAX_COMPETITORS: 100,
      DATAFORSEO_MAX_BACKLINKS: 300,
      DATAFORSEO_MAX_REFERRING_DOMAINS: 80,
      DATAFORSEO_MAX_BACKLINK_PAGES: 250,
      DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: 12,
    });
    mockHappyPath();
    const insertQueued = vi.spyOn(
      AsyncRunsRepository.prototype,
      "insertQueued",
    );
    const skipStep = vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "skipStep",
    );

    await createAnalysisRefreshRun(
      { workspaceId: ids.workspace },
      ids.project,
      ids.actor,
      "refresh-backlinks-disabled",
      {},
    );

    expect(insertQueued.mock.calls[0]?.[0].requestPayload).toMatchObject({
      dataForSeo: { enabled: true },
      dataForSeoBacklinks: {
        enabled: false,
        maxBacklinks: 300,
        maxReferringDomains: 80,
        maxBacklinkPages: 250,
        maxSourceVerifications: 12,
      },
    });
    expect(skipStep.mock.calls.map((call) => call.slice(2))).toEqual([
      ["dataforseo_backlinks", "feature_disabled"],
    ]);
  });

  it("admits exactly 20 current approved and mapping-confirmed GenerativeQueries into the v3 payload", async () => {
    mocks.getEnv.mockReturnValue({
      DATAFORSEO_ENABLED: "true",
      DATAFORSEO_BACKLINKS_ENABLED: "false",
      DATAFORSEO_AI_CITATIONS_ENABLED: "true",
      DATAFORSEO_AI_CITATION_MODEL: "gpt-5",
      DATAFORSEO_MAX_KEYWORDS: 200,
      DATAFORSEO_MAX_COMPETITORS: 100,
      DATAFORSEO_MAX_BACKLINKS: 500,
      DATAFORSEO_MAX_REFERRING_DOMAINS: 100,
      DATAFORSEO_MAX_BACKLINK_PAGES: 500,
      DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: 20,
    });
    mockHappyPath();
    vi.mocked(SitesRepository.prototype.findPrimary).mockResolvedValue({
      ...site,
      market_codes: ["US"],
      language_codes: ["en-US"],
    } as never);
    const queryRows = generativeQueryRows(20);
    vi.spyOn(
      KeywordsRepository.prototype,
      "listAiCitationCohortCandidates",
    ).mockResolvedValue(queryRows);
    vi.spyOn(
      CompetitorsRepository.prototype,
      "listAiCitationTrackedDomains",
    ).mockResolvedValue([
      { id: ids.winner, domain: "semrush.com" },
      { id: ids.idem, domain: "ahrefs.com" },
    ]);
    const insertQueued = vi.spyOn(
      AsyncRunsRepository.prototype,
      "insertQueued",
    );

    await createAnalysisRefreshRun(
      { workspaceId: ids.workspace },
      ids.project,
      ids.actor,
      "refresh-ai-enabled",
      {},
    );

    expect(
      KeywordsRepository.prototype.listAiCitationCohortCandidates,
    ).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      { market: "US", languageTag: "en-US", limit: 21 },
    );
    expect(
      CompetitorsRepository.prototype.listAiCitationTrackedDomains,
    ).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      { limit: 501 },
    );
    expect(insertQueued.mock.calls[0]?.[0].requestPayload).toMatchObject({
      dataForSeo: {
        aiCitations: {
          state: "enabled",
          platform: "chat_gpt",
          requestedModel: "gpt-5",
          attemptedQueries: 20,
          querySetHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
          queries: queryRows,
          trackedCompetitorDomains: ["ahrefs.com", "semrush.com"],
        },
      },
    });
  });

  it.each([19, 21])(
    "freezes %s eligible GenerativeQueries as skipped and never reads paid target domains",
    async (eligibleQueryCount) => {
      mocks.getEnv.mockReturnValue({
        DATAFORSEO_ENABLED: "true",
        DATAFORSEO_BACKLINKS_ENABLED: "false",
        DATAFORSEO_AI_CITATIONS_ENABLED: "true",
        DATAFORSEO_AI_CITATION_MODEL: "gpt-5",
        DATAFORSEO_MAX_KEYWORDS: 200,
        DATAFORSEO_MAX_COMPETITORS: 100,
        DATAFORSEO_MAX_BACKLINKS: 500,
        DATAFORSEO_MAX_REFERRING_DOMAINS: 100,
        DATAFORSEO_MAX_BACKLINK_PAGES: 500,
        DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: 20,
      });
      mockHappyPath();
      vi.mocked(SitesRepository.prototype.findPrimary).mockResolvedValue({
        ...site,
        market_codes: ["US"],
        language_codes: ["en-US"],
      } as never);
      vi.spyOn(
        KeywordsRepository.prototype,
        "listAiCitationCohortCandidates",
      ).mockResolvedValue(generativeQueryRows(eligibleQueryCount));
      const domains = vi.spyOn(
        CompetitorsRepository.prototype,
        "listAiCitationTrackedDomains",
      );
      const insertQueued = vi.spyOn(
        AsyncRunsRepository.prototype,
        "insertQueued",
      );

      await createAnalysisRefreshRun(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        `refresh-ai-skip-${eligibleQueryCount}`,
        {},
      );

      expect(domains).not.toHaveBeenCalled();
      expect(insertQueued.mock.calls[0]?.[0].requestPayload).toMatchObject({
        dataForSeo: {
          aiCitations: {
            state: "skipped_insufficient_query_cohort",
            eligibleQueryCount,
          },
        },
      });
    },
  );

  it("does not freeze optional connections that belong to another Site", async () => {
    mockHappyPath({
      crawl: connections.crawl,
      gsc: { ...connections.gsc, site_id: ids.winner },
      ga4: { ...connections.ga4, site_id: ids.winner },
    });
    const insertQueued = vi.spyOn(
      AsyncRunsRepository.prototype,
      "insertQueued",
    );
    const skipStep = vi.spyOn(
      AnalysisRefreshRunsRepository.prototype,
      "skipStep",
    );

    await createAnalysisRefreshRun(
      { workspaceId: ids.workspace },
      ids.project,
      ids.actor,
      "refresh-cross-site-optionals",
      {},
    );

    expect(insertQueued.mock.calls[0]?.[0].requestPayload).toMatchObject({
      sourceConnectionIds: {
        crawl: ids.crawl,
        gsc: null,
        ga4: null,
      },
    });
    expect(skipStep.mock.calls.map((call) => call.slice(2))).toEqual([
      ["gsc", "source_not_connected"],
      ["ga4", "source_not_connected"],
    ]);
  });

  it.each([
    {
      name: "missing project",
      setup: () =>
        vi
          .spyOn(ProjectsRepository.prototype, "findById")
          .mockResolvedValue(null),
      expected: { code: "NOT_FOUND", status: 404 },
    },
    {
      name: "archived project",
      setup: () =>
        vi
          .spyOn(ProjectsRepository.prototype, "findById")
          .mockResolvedValue({ ...project, archived_at: "2026-07-01" } as never),
      expected: { code: "PROJECT_ARCHIVED", status: 422 },
    },
    {
      name: "missing confirmed ICP pointer",
      setup: () =>
        vi
          .spyOn(ProjectsRepository.prototype, "findById")
          .mockResolvedValue({
            ...project,
            confirmed_icp_profile_id: null,
          } as never),
      expected: { code: "CONTEXT_INCOMPLETE", status: 422 },
    },
    {
      name: "non-complete confirmed ICP",
      setup: () =>
        vi
          .spyOn(IcpProfilesRepository.prototype, "findById")
          .mockResolvedValue({ ...profile, status: "draft" } as never),
      expected: { code: "CONTEXT_INCOMPLETE", status: 422 },
    },
    {
      name: "missing primary Site",
      setup: () =>
        vi
          .spyOn(SitesRepository.prototype, "findPrimary")
          .mockResolvedValue(null),
      expected: { code: "CONTEXT_INCOMPLETE", status: 422 },
    },
    {
      name: "Product Profile belonging to another Site",
      setup: () =>
        vi
          .spyOn(IcpProfilesRepository.prototype, "findById")
          .mockResolvedValue({
            ...profile,
            profile: createInitialProductProfileDraft({
              sourceSiteId: ids.winner,
              sourcePageUrl: "https://example.com/product",
            }),
          } as never),
      expected: { code: "CONTEXT_INCOMPLETE", status: 422 },
    },
    {
      name: "missing required Crawl connection",
      setup: () =>
        vi
          .spyOn(
            SourceConnectionsRepository.prototype,
            "findConnectedByProvider",
          )
          .mockImplementation(
            (async (_scope: unknown, provider: string) =>
              provider === "crawl"
                ? null
                : connections[provider as "gsc" | "ga4"]) as never,
          ),
      expected: { code: "SOURCE_NOT_CONNECTED", status: 422 },
    },
    {
      name: "required Crawl connection belonging to another Site",
      setup: () =>
        vi
          .spyOn(
            SourceConnectionsRepository.prototype,
            "findConnectedByProvider",
          )
          .mockImplementation(
            (async (_scope: unknown, provider: string) =>
              provider === "crawl"
                ? { ...connections.crawl, site_id: ids.winner }
                : connections[provider as "gsc" | "ga4"]) as never,
          ),
      expected: { code: "SOURCE_NOT_CONNECTED", status: 422 },
    },
  ])("rejects $name before creating a parent", async ({ setup, expected }) => {
    mockHappyPath();
    setup();

    await expect(
      createAnalysisRefreshRun(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        "refresh-gate-key",
        {},
      ),
    ).rejects.toMatchObject(expected);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("revalidates every mutable hard gate after locking the project", async () => {
    mockHappyPath();
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue({
      ...project,
      archived_at: "2026-07-29T00:00:00.000Z",
    } as never);

    await expect(
      createAnalysisRefreshRun(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        "refresh-locked-gate-key",
        {},
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED", status: 422 });
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
    expect(AnalysisRefreshRunsRepository.prototype.create).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("fails closed when required Crawl moves off the primary Site after preflight", async () => {
    mockHappyPath();
    vi.spyOn(
      SourceConnectionsRepository.prototype,
      "findConnectedByProviderForUpdate",
    ).mockImplementation(
      (async (_scope: unknown, provider: string) =>
        provider === "crawl"
          ? { ...connections.crawl, site_id: ids.winner }
          : connections[provider as "gsc" | "ga4"]) as never,
    );

    await expect(
      createAnalysisRefreshRun(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        "refresh-locked-crawl-key",
        {},
      ),
    ).rejects.toMatchObject({
      code: "SOURCE_NOT_CONNECTED",
      status: 422,
    });
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
    expect(AnalysisRefreshRunsRepository.prototype.create).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("replays a completed command before reading mutable project state", async () => {
    const run = queuedRun(ids.winner);
    const statusUrl = `/api/mvp/projects/${ids.project}/runs/${ids.winner}`;
    const findProject = vi.spyOn(ProjectsRepository.prototype, "findById");
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue({
      request_hash: contentHash({ projectId: ids.project }),
      status: "completed",
      resource_id: ids.winner,
      response_body: {
        run: {
          ...run,
          id: ids.winner,
          projectId: ids.project,
          queuedAt: run.queued_at,
        },
        statusUrl,
        resourceRef: { type: "analysis_refresh_run", id: ids.winner },
      },
    } as never);

    await expect(
      createAnalysisRefreshRun(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        "refresh-replay-key",
        {},
      ),
    ).resolves.toMatchObject({
      replayed: true,
      resourceRef: { type: "analysis_refresh_run", id: ids.winner },
      location: statusUrl,
    });
    expect(findProject).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("rejects a workspace-level key reused for another project command", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue({
      request_hash: contentHash({ projectId: ids.winner }),
      status: "completed",
      resource_id: ids.winner,
      response_body: {},
    } as never);

    await expect(
      createAnalysisRefreshRun(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        "refresh-reused-key",
        {},
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("returns a locatable conflict for an already-active parent", async () => {
    mockHappyPath();
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue({
      id: ids.winner,
    } as never);

    const error = await createAnalysisRefreshRun(
      { workspaceId: ids.workspace },
      ids.project,
      ids.actor,
      "refresh-active-key",
      {},
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      current: {
        runId: ids.winner,
        statusUrl: `/api/mvp/projects/${ids.project}/runs/${ids.winner}`,
      },
      extraHeaders: {
        Location: `/api/mvp/projects/${ids.project}/runs/${ids.winner}`,
      },
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("maps the active-key unique race to the observable winner", async () => {
    mockHappyPath();
    vi.spyOn(AsyncRunsRepository.prototype, "findActive")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: ids.winner } as never);
    mocks.db.transaction.mockRejectedValueOnce({
      code: "23505",
      constraint: "async_runs_one_active_key_idx",
    });

    await expect(
      createAnalysisRefreshRun(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        "refresh-race-key",
        {},
      ),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      current: { runId: ids.winner },
      extraHeaders: {
        Location: `/api/mvp/projects/${ids.project}/runs/${ids.winner}`,
      },
    });
  });

  it("does not complete idempotency when the transactional enqueue fails", async () => {
    mockHappyPath();
    mocks.enqueueRunInTx.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      createAnalysisRefreshRun(
        { workspaceId: ids.workspace },
        ids.project,
        ids.actor,
        "refresh-queue-key",
        {},
      ),
    ).rejects.toThrow("queue unavailable");
    expect(AnalysisRefreshRunsRepository.prototype.create).toHaveBeenCalled();
    expect(IdempotencyRepository.prototype.complete).not.toHaveBeenCalled();
  });
});

describe("parseAnalysisRefreshRequestPayload", () => {
  const payload = {
    siteId: ids.site,
    icpProfile: {
      id: ids.profile,
      version: 7,
      contentHash: "a".repeat(64),
    },
    outputLocale: "zh-CN",
    sourceConnectionIds: {
      crawl: ids.crawl,
      gsc: null,
      ga4: ids.ga4,
    },
    dataForSeo: {
      enabled: false,
      maxKeywords: 200,
      maxCompetitors: 100,
      aiCitations: { state: "disabled" },
    },
    dataForSeoBacklinks: {
      enabled: false,
      maxBacklinks: 500,
      maxReferringDomains: 100,
      maxBacklinkPages: 500,
      maxSourceVerifications: 20,
    },
  };

  it("accepts the exact secret-free frozen payload", () => {
    expect(parseAnalysisRefreshRequestPayload(payload)).toEqual(payload);
  });

  it("requires the v2 backlink policy to be frozen by the web producer", () => {
    const { dataForSeoBacklinks: _missing, ...legacyPayload } = payload;

    expect(() => parseAnalysisRefreshRequestPayload(legacyPayload)).toThrow();
  });

  it("rejects a frozen source-page verification cap above the collector ceiling", () => {
    expect(() =>
      parseAnalysisRefreshRequestPayload({
        ...payload,
        dataForSeoBacklinks: {
          ...payload.dataForSeoBacklinks,
          maxSourceVerifications: 21,
        },
      }),
    ).toThrow();
  });

  it("rejects unknown fields so provider secrets cannot be smuggled in", () => {
    expect(() =>
      parseAnalysisRefreshRequestPayload({
        ...payload,
        providerCredential: "redacted",
      }),
    ).toThrow();
  });
});

function generativeQueryRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    entityId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    revision: index + 1,
    query: `Which onboarding platform is best for team ${index + 1}?`,
    normalizedQuery: `which onboarding platform is best for team ${String(index + 1).padStart(2, "0")}?`,
    marketCode: "US",
    languageTag: "en-US",
  }));
}

describe("freezeDataForSeoAiCitationPolicy", () => {
  it("freezes an exact deterministic 20-query cohort and current non-excluded domains", () => {
    const rows = generativeQueryRows(20);
    const input = {
      enabled: true,
      requestedModel: "gpt-5",
      marketCode: "US",
      languageTag: "en-US",
      queries: [...rows].reverse(),
      trackedCompetitorDomains: ["semrush.com", "ahrefs.com"],
    } as const;

    const frozen = freezeDataForSeoAiCitationPolicy(input);
    const repeated = freezeDataForSeoAiCitationPolicy({
      ...input,
      queries: rows,
      trackedCompetitorDomains: ["ahrefs.com", "semrush.com"],
    });

    expect(frozen).toEqual({
      state: "enabled",
      platform: "chat_gpt",
      requestedModel: "gpt-5",
      attemptedQueries: 20,
      maxOutputTokens: 1_024,
      webSearch: true,
      querySetHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      queries: rows.map((row) => ({
        entityId: row.entityId,
        revision: row.revision,
        query: row.query,
        normalizedQuery: row.normalizedQuery,
        marketCode: "US",
        languageTag: "en-US",
      })),
      trackedCompetitorDomains: ["ahrefs.com", "semrush.com"],
    });
    expect(repeated).toEqual(frozen);
    expect(frozen.state === "enabled" ? frozen.querySetHash : null).toBe(
      contentHash({
        schemaVersion: "dataforseo.ai-citation-query-set.v1",
        platform: "chat_gpt",
        model: "gpt-5",
        marketCode: "US",
        languageTag: "en-US",
        queries: rows.map(
          ({ entityId, revision, query, normalizedQuery }) => ({
            entityId,
            revision,
            query,
            normalizedQuery,
          }),
        ),
      }),
    );
  });

  it("rejects a query over the provider user_prompt limit without truncating it", () => {
    const [first, ...rest] = generativeQueryRows(20);
    expect(() =>
      freezeDataForSeoAiCitationPolicy({
        enabled: true,
        requestedModel: "gpt-5",
        marketCode: "US",
        languageTag: "en-US",
        queries: [{ ...first!, query: "q".repeat(501) }, ...rest],
        trackedCompetitorDomains: [],
      }),
    ).toThrow();
  });

  it("rejects revision zero before freezing a cohort the source cannot collect", () => {
    const [first, ...rest] = generativeQueryRows(20);
    expect(() =>
      freezeDataForSeoAiCitationPolicy({
        enabled: true,
        requestedModel: "gpt-5",
        marketCode: "US",
        languageTag: "en-US",
        queries: [{ ...first!, revision: 0 }, ...rest],
        trackedCompetitorDomains: [],
      }),
    ).toThrow();
  });

  it.each([" gpt-5", "gpt-5 ", "gpt 5", "x".repeat(101)])(
    "rejects the non-canonical server-pinned model %j",
    (requestedModel) => {
      expect(() =>
        freezeDataForSeoAiCitationPolicy({
          enabled: true,
          requestedModel,
          marketCode: "US",
          languageTag: "en-US",
          queries: generativeQueryRows(20),
          trackedCompetitorDomains: [],
        }),
      ).toThrow();
    },
  );

  it.each([19, 21])(
    "freezes %s eligible rows as a typed skip instead of selecting or synthesizing 20",
    (eligibleQueryCount) => {
      expect(
        freezeDataForSeoAiCitationPolicy({
          enabled: true,
          requestedModel: "gpt-5",
          marketCode: "US",
          languageTag: "en-US",
          queries: generativeQueryRows(eligibleQueryCount),
          trackedCompetitorDomains: ["ahrefs.com"],
        }),
      ).toEqual({
        state: "skipped_insufficient_query_cohort",
        eligibleQueryCount,
      });
    },
  );

  it("freezes disabled without retaining a provider model or query text", () => {
    expect(
      freezeDataForSeoAiCitationPolicy({
        enabled: false,
        requestedModel: null,
        marketCode: "US",
        languageTag: "en-US",
        queries: generativeQueryRows(20),
        trackedCompetitorDomains: ["ahrefs.com"],
      }),
    ).toEqual({ state: "disabled" });
  });

  it("rejects the 501st tracked competitor sentinel instead of truncating scope", () => {
    expect(() =>
      freezeDataForSeoAiCitationPolicy({
        enabled: true,
        requestedModel: "gpt-5",
        marketCode: "US",
        languageTag: "en-US",
        queries: generativeQueryRows(20),
        trackedCompetitorDomains: Array.from(
          { length: 501 },
          (_, index) => `rival-${index + 1}.example.com`,
        ),
      }),
    ).toThrow(/tracked competitor/i);
  });
});
