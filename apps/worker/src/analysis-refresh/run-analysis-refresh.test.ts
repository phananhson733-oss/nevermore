import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnalysisRefreshRunsRepository,
  analysisRefreshPlanHash,
  analysisRefreshPlanManifest,
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  CollectionRunsRepository,
  CompetitorsRepository,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  IcpProfilesRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  ObservationsRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type AnalysisRefreshStepRow,
  type AsyncRunRow,
  type CollectionRunRow,
  type DataSnapshotRow,
  type PgBoss,
  type ProjectRow,
  type SiteRow,
  type SourceConnectionRow,
} from "@sf/db";
import { CONTRACT_VERSION } from "@sf/contracts";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import {
  runAnalysisRefresh,
  type AnalysisRefreshJobPayload,
} from "./run-analysis-refresh.ts";

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  actor: "00000000-0000-4000-8000-000000000003",
  site: "00000000-0000-4000-8000-000000000004",
  profile: "00000000-0000-4000-8000-000000000005",
  crawlConnection: "00000000-0000-4000-8000-000000000006",
  page: "00000000-0000-4000-8000-000000000007",
  parent: "00000000-0000-4000-8000-000000000008",
  collectionChild: "00000000-0000-4000-8000-000000000009",
  auditChild: "00000000-0000-4000-8000-000000000010",
  crawlSnapshot: "00000000-0000-4000-8000-000000000011",
  external: "00000000-0000-4000-8000-000000000012",
  gscChild: "00000000-0000-4000-8000-000000000013",
  gscSnapshot: "00000000-0000-4000-8000-000000000014",
  dataForSeoSnapshot: "00000000-0000-4000-8000-000000000015",
} as const;

const NOW = new Date("2026-07-29T04:00:00.000Z");
const JOB: AnalysisRefreshJobPayload = {
  runId: IDS.parent,
  workspaceId: IDS.workspace,
  projectId: IDS.project,
  contractVersion: CONTRACT_VERSION,
};
const REQUEST_PAYLOAD = {
  siteId: IDS.site,
  icpProfile: {
    id: IDS.profile,
    version: 3,
    contentHash: "a".repeat(64),
  },
  outputLocale: "en-US",
  sourceConnectionIds: {
    crawl: IDS.crawlConnection,
    gsc: null,
    ga4: null,
  },
  dataForSeo: {
    enabled: false,
    maxKeywords: 100,
    maxCompetitors: 100,
  },
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAnalysisRefresh", () => {
  it("starts a legacy-profile Crawl without a deep seed and never duplicates the child on a continuation", async () => {
    const harness = createHarness();

    await runAnalysisRefresh(harness.ctx, JOB, {
      now: () => NOW,
      continuationDelayMs: 2_500,
    });

    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        siteId: IDS.site,
        provider: "crawl",
        operation: "site_graph",
        crawlSeedSitePageId: null,
        crawlSeedUrl: null,
      }),
    );
    expect(
      SitePagesRepository.prototype.findExactNormalizedUrl,
    ).not.toHaveBeenCalled();
    const childSend = harness.send.mock.calls.find(
      (call) => call[0] === "collect.crawl",
    );
    const continuationSend = harness.send.mock.calls.find(
      (call) => call[0] === "refresh.analysis",
    );
    expect(childSend?.[2]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      }),
    );
    expect(continuationSend?.[2]).toEqual(
      expect.objectContaining({
        startAfter: new Date("2026-07-29T04:00:02.500Z"),
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      }),
    );
    expect(continuationSend?.[2]).not.toHaveProperty("id");
    expect(harness.state.steps[0]).toMatchObject({
      step_key: "crawl",
      state: "running",
      child_async_run_id: expect.any(String),
    });
    expect(
      AsyncRunsRepository.prototype.setProgress,
    ).toHaveBeenCalledBefore(
      vi.mocked(AsyncRunsRepository.prototype.resetToQueued),
    );

    await runAnalysisRefresh(harness.ctx, JOB, {
      now: () => NOW,
      continuationDelayMs: 2_500,
    });

    expect(
      AsyncRunsRepository.prototype.insertQueued,
    ).toHaveBeenCalledTimes(1);
    expect(harness.state.children.size).toBe(1);
  });

  it("waits on an unrelated active child key without adopting or creating it", async () => {
    const harness = createHarness({
      activeForKey: (activeKey) =>
        activeKey === "collect:crawl:site_graph"
          ? asyncRun({
              id: IDS.external,
              kind: "collection",
              activeKey,
              status: "running",
            })
          : null,
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(
      AsyncRunsRepository.prototype.insertQueued,
    ).not.toHaveBeenCalled();
    expect(
      AnalysisRefreshRunsRepository.prototype.startStep,
    ).not.toHaveBeenCalled();
    expect(harness.state.steps[0]?.state).toBe("pending");
    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.send).toHaveBeenCalledWith(
      "refresh.analysis",
      expect.objectContaining({ runId: IDS.parent }),
      expect.not.objectContaining({ id: expect.anything() }),
    );
  });

  it("rolls back child, projection, step, and parent scheduling state when continuation enqueue fails", async () => {
    const harness = createHarness({ failFirstContinuation: true });

    await expect(
      runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW }),
    ).rejects.toThrow(/continuation/i);

    expect(harness.state.steps[0]).toMatchObject({
      step_key: "crawl",
      state: "pending",
      child_async_run_id: null,
    });
    expect(harness.state.children.size).toBe(0);
    expect(harness.state.collections.size).toBe(0);

    await expect(
      runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW }),
    ).resolves.toBeUndefined();
    expect(harness.state.children.size).toBe(1);
    expect(harness.state.collections.size).toBe(1);
    expect(harness.state.steps[0]?.state).toBe("running");
  });

  it("skips only one missing optional source step per claim", async () => {
    const harness = createHarness();
    harness.state.steps[0] = step("crawl", 1, true, {
      state: "completed",
      childId: IDS.collectionChild,
      snapshotId: IDS.crawlSnapshot,
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[1]).toMatchObject({
      step_key: "gsc",
      state: "skipped",
      skip_reason: "source_not_connected",
    });
    expect(harness.state.steps[2]?.state).toBe("pending");
    expect(
      AnalysisRefreshRunsRepository.prototype.skipStep,
    ).toHaveBeenCalledTimes(1);
  });

  it("starts one composite DataForSEO child, placeholder, and enqueue with both frozen caps", async () => {
    const requestPayload = {
      ...REQUEST_PAYLOAD,
      dataForSeo: {
        enabled: true,
        maxKeywords: 87,
        maxCompetitors: 31,
      },
    };
    const harness = createHarness({
      requestPayload,
      dataForSeo: {
        enabled: true,
        login: "provider-login",
        password: "provider-password",
        maxKeywords: 200,
        maxCompetitors: 100,
      },
    });
    prepareDataForSeoStep(harness);

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    const collectionChildren = [...harness.state.children.values()].filter(
      (child) => child.kind === "collection",
    );
    expect(collectionChildren).toHaveLength(1);
    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledTimes(1);
    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "dataforseo",
        operation: "search_landscape",
        methodVersion: "dataforseo.search_landscape.v2",
      }),
    );
    expect(collectionChildren[0]?.request_payload).toEqual({
      provider: "dataforseo",
      operation: "search_landscape",
      sourceConnectionId: sourceConnection("dataforseo").id,
      collectionScope: expect.objectContaining({
        schemaVersion: "dataforseo.search-landscape-scope.v2",
        queryKind: "search_landscape",
        target: "example.test",
        rankedKeywords: expect.objectContaining({ limit: 87 }),
        competitorsDomain: expect.objectContaining({
          limit: 31,
          maxRankGroup: 100,
          excludeDomains: ["example.test"],
        }),
        serpCompetitors: expect.objectContaining({
          limit: 31,
          fallbackWhenDomainOverlapEmpty: true,
          seeds: [],
        }),
      }),
    });
    expect(
      harness.send.mock.calls.filter(
        ([queue]) => queue === "collect.dataforseo",
      ),
    ).toHaveLength(1);
    expect(
      SourceConnectionsRepository.prototype.insertConnection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "dataforseo",
        config: expect.objectContaining({
          maxKeywords: 87,
          maxCompetitors: 31,
          maxSerpCompetitors: 31,
        }),
        limitation: expect.stringContaining(
          "positions 1–100",
        ),
      }),
    );
    expect(harness.state.steps[3]).toMatchObject({
      step_key: "dataforseo",
      state: "running",
      child_async_run_id: collectionChildren[0]?.id,
    });

    const child = collectionChildren[0]!;
    const collection = harness.state.collections.get(child.id)!;
    harness.state.children.set(child.id, {
      ...child,
      status: "completed",
      result_type: "collection_run",
      result_id: child.id,
      completed_at: NOW.toISOString(),
    });
    if (!collection.source_connection_id) {
      throw new Error("DataForSEO fixture requires an exact source connection");
    }
    harness.state.snapshots.set(
      IDS.dataForSeoSnapshot,
      dataForSeoSnapshot(child.id, collection.source_connection_id),
    );

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[3]).toMatchObject({
      step_key: "dataforseo",
      state: "completed",
      child_async_run_id: child.id,
      result_snapshot_id: IDS.dataForSeoSnapshot,
    });
    expect(harness.state.children.size).toBe(1);
    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.send.mock.calls.filter(
        ([queue]) => queue === "collect.dataforseo",
      ),
    ).toHaveLength(1);
  });

  it.each([
    {
      name: "ranked-keyword cap",
      maxKeywords: 201,
      maxCompetitors: 31,
    },
    {
      name: "competitor-domain cap",
      maxKeywords: 87,
      maxCompetitors: 101,
    },
  ])(
    "fails closed before enqueue when the frozen $name exceeds worker policy",
    async ({ maxKeywords, maxCompetitors }) => {
      const harness = createHarness({
        requestPayload: {
          ...REQUEST_PAYLOAD,
          dataForSeo: {
            enabled: true,
            maxKeywords,
            maxCompetitors,
          },
        },
        dataForSeo: {
          enabled: true,
          login: "provider-login",
          password: "provider-password",
          maxKeywords: 200,
          maxCompetitors: 100,
        },
      });
      prepareDataForSeoStep(harness);

      await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

      expect(harness.state.steps[3]).toMatchObject({
        step_key: "dataforseo",
        state: "skipped",
        skip_reason: "worker_credentials_unavailable",
      });
      expect(
        AsyncRunsRepository.prototype.insertQueued,
      ).not.toHaveBeenCalled();
      expect(
        CollectionRunsRepository.prototype.insertPlaceholder,
      ).not.toHaveBeenCalled();
      expect(
        harness.send.mock.calls.filter(
          ([queue]) => queue === "collect.dataforseo",
        ),
      ).toHaveLength(0);
    },
  );

  it("fails closed when the exact child Snapshot disagrees with collection lineage", async () => {
    const harness = createHarness();
    installRunningCollection(harness, {
      snapshot: {
        ...crawlSnapshot(),
        dataset_key: "crawl.unrelated.v9",
      },
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[0]).toMatchObject({
      state: "failed",
      error: {
        code: "ANALYSIS_REFRESH_SNAPSHOT_INVALID",
      },
    });
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ runId: IDS.parent }),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "ANALYSIS_REFRESH_SNAPSHOT_INVALID",
      }),
    );
  });

  it("marks an optional provider failed instead of promoting its unavailable Snapshot into the audit", async () => {
    const harness = createHarness();
    harness.state.steps = [
      step("crawl", 1, true, {
        state: "completed",
        childId: IDS.collectionChild,
        snapshotId: IDS.crawlSnapshot,
      }),
      step("gsc", 2, false, {
        state: "running",
        childId: IDS.gscChild,
      }),
      step("ga4", 3, false),
      step("dataforseo", 4, false),
      step("growth_audit", 5, true),
    ];
    harness.state.snapshots.set(IDS.crawlSnapshot, crawlSnapshot());
    harness.state.children.set(
      IDS.gscChild,
      asyncRun({
        id: IDS.gscChild,
        kind: "collection",
        activeKey: "collect:gsc:search_analytics",
        status: "completed",
        resultType: "collection_run",
        resultId: IDS.gscChild,
      }),
    );
    harness.state.collections.set(IDS.gscChild, {
      ...collectionRun(IDS.gscChild),
      source_connection_id: sourceConnection("gsc").id,
      provider: "gsc",
      operation: "search_analytics",
      method_version: "gsc.page_query_daily.v1",
    });
    harness.state.snapshots.set(IDS.gscSnapshot, {
      ...crawlSnapshot(),
      id: IDS.gscSnapshot,
      collection_run_id: IDS.gscChild,
      source_connection_id: sourceConnection("gsc").id,
      provider: "gsc",
      dataset_key: "gsc.page_query_daily.v1",
      schema_version: "gsc.page.v1",
      method_version: "gsc.page_query_daily.v1",
      availability: "unavailable",
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[1]).toMatchObject({
      state: "failed",
      child_async_run_id: IDS.gscChild,
      result_snapshot_id: null,
      error: {
        code: "ANALYSIS_REFRESH_SOURCE_UNAVAILABLE",
      },
    });
    expect(harness.state.steps[4]?.state).toBe("pending");
    expect(DiagnosticRunsRepository.prototype.insert).not.toHaveBeenCalled();
    expect(harness.send).toHaveBeenCalledWith(
      "refresh.analysis",
      expect.objectContaining({ runId: IDS.parent }),
      expect.objectContaining({ startAfter: expect.any(Date) }),
    );
  });

  it("creates the Growth Audit child with the exact Snapshot manifest and governance projection", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(DiagnosticRunsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        siteId: IDS.site,
        icpProfileId: IDS.profile,
        icpProfileVersion: 3,
        outputLocale: "en-US",
        inputManifest: expect.objectContaining({
          projectId: IDS.project,
          siteId: IDS.site,
          icp: REQUEST_PAYLOAD.icpProfile,
          snapshots: [
            expect.objectContaining({
              snapshotId: IDS.crawlSnapshot,
              provider: "crawl",
              availability: "available",
            }),
          ],
          governance: {
            projectionVersion: "growth-governance.1.0.0",
            keywordClusters: [],
            competitors: [],
          },
        }),
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(CapabilityRunsRepository.prototype.create).toHaveBeenCalledWith(
      expect.objectContaining({
        asyncRunId: expect.any(String),
        capabilityId: "growth-audit",
        capabilityVersion: "0.3.0",
        mode: "production",
        sideEffectClass: "read_only",
      }),
    );
    expect(AuditRunsRepository.prototype.create).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnosticRunId: expect.any(String),
        capabilityRunId: expect.any(String),
        scopeKind: "site",
        scopeKey: IDS.site,
        projectionVersion: "growth-audit.0.3.0",
      }),
    );
    expect(harness.send).toHaveBeenCalledWith(
      "diagnose",
      expect.objectContaining({
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      }),
      expect.objectContaining({ id: expect.any(String) }),
    );
    expect(harness.state.steps[4]).toMatchObject({
      state: "running",
      child_async_run_id: expect.any(String),
    });
  });

  it("refuses a completed step whose frozen Snapshot belongs to another collection child", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    harness.state.snapshots.set(IDS.crawlSnapshot, {
      ...crawlSnapshot(),
      collection_run_id: "00000000-0000-4000-8000-000000000098",
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[4]).toMatchObject({
      state: "failed",
      error: {
        code: "ANALYSIS_REFRESH_AUDIT_UNUSABLE",
      },
    });
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ runId: IDS.parent }),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "ANALYSIS_REFRESH_AUDIT_UNUSABLE",
      }),
    );
    expect(DiagnosticRunsRepository.prototype.insert).not.toHaveBeenCalled();
  });

  it("terminalizes partial when the required audit succeeds partially and optional inputs were skipped", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    harness.state.steps[4] = step("growth_audit", 5, true, {
      state: "running",
      childId: IDS.auditChild,
    });
    harness.state.children.set(
      IDS.auditChild,
      asyncRun({
        id: IDS.auditChild,
        kind: "diagnostic",
        activeKey: "growth_audit",
        status: "partial",
        resultType: "diagnostic_run",
        resultId: IDS.auditChild,
      }),
    );
    harness.state.auditChildren.set(IDS.auditChild, {
      id: IDS.auditChild,
      workspace_id: IDS.workspace,
      project_id: IDS.project,
      diagnostic_run_id: IDS.auditChild,
      capability_run_id: IDS.auditChild,
      scope_kind: "site",
      scope_key: IDS.site,
      projection_version: "growth-audit.0.3.0",
      created_at: NOW.toISOString(),
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[4]?.state).toBe("completed");
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ runId: IDS.parent }),
      expect.objectContaining({
        status: "partial",
        resultType: "analysis_refresh_run",
        resultId: IDS.parent,
      }),
    );
    const continuationCalls = harness.send.mock.calls.filter(
      (call) => call[0] === "refresh.analysis",
    );
    expect(continuationCalls).toHaveLength(0);
  });
});

interface HarnessState {
  steps: AnalysisRefreshStepRow[];
  children: Map<string, AsyncRunRow>;
  collections: Map<string, CollectionRunRow>;
  snapshots: Map<string, DataSnapshotRow>;
  auditChildren: Map<string, Awaited<ReturnType<AuditRunsRepository["findByDiagnosticRunId"]>>>;
  stage: string;
}

interface Harness {
  readonly ctx: WorkerContext;
  readonly state: HarnessState;
  readonly send: ReturnType<typeof vi.fn>;
}

function createHarness(options: {
  readonly activeForKey?: (activeKey: string) => AsyncRunRow | null;
  readonly failFirstContinuation?: boolean;
  readonly requestPayload?: Record<string, unknown>;
  readonly dataForSeo?: NonNullable<WorkerContext["dataForSeo"]>;
} = {}): Harness {
  const state: HarnessState = {
    steps: [
      step("crawl", 1, true),
      step("gsc", 2, false),
      step("ga4", 3, false),
      step("dataforseo", 4, false),
      step("growth_audit", 5, true),
    ],
    children: new Map(),
    collections: new Map(),
    snapshots: new Map(),
    auditChildren: new Map(),
    stage: "setup",
  };
  const parentRun = asyncRun({
    id: IDS.parent,
    kind: "analysis_refresh",
    activeKey: "analysis_refresh",
    status: "running",
    requestPayload: options.requestPayload ?? REQUEST_PAYLOAD,
    resultType: "analysis_refresh_run",
    resultId: IDS.parent,
  });
  const parentProjection = {
    id: IDS.parent,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    site_id: IDS.site,
    icp_profile_id: IDS.profile,
    plan_manifest: analysisRefreshPlanManifest(),
    plan_hash: analysisRefreshPlanHash(analysisRefreshPlanManifest()),
    created_at: NOW.toISOString(),
  };
  const site = siteRow();
  const crawlConnection = sourceConnection();
  const project = projectRow();

  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(parentRun);
  vi.spyOn(
    AsyncRunsRepository.prototype,
    "lockAttemptForUpdate",
  ).mockResolvedValue(parentRun);
  vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockImplementation(
    async (_scope, activeKey) => options.activeForKey?.(activeKey) ?? null,
  );
  vi.spyOn(AsyncRunsRepository.prototype, "insertQueued").mockImplementation(
    async (values) => {
      const id = values.runId ?? crypto.randomUUID();
      const child = asyncRun({
        id,
        kind: values.kind,
        activeKey: values.activeKey,
        status: "queued",
        requestPayload: values.requestPayload ?? {},
      });
      state.children.set(id, child);
      return child;
    },
  );
  vi.spyOn(AsyncRunsRepository.prototype, "findById").mockImplementation(
    async (_scope, id) => state.children.get(id) ?? null,
  );
  vi.spyOn(AsyncRunsRepository.prototype, "setProgress").mockResolvedValue(true);
  vi.spyOn(AsyncRunsRepository.prototype, "resetToQueued").mockResolvedValue(
    true,
  );
  vi.spyOn(AsyncRunsRepository.prototype, "setTerminal").mockResolvedValue(true);

  vi.spyOn(
    AnalysisRefreshRunsRepository.prototype,
    "findById",
  ).mockResolvedValue(parentProjection);
  vi.spyOn(
    AnalysisRefreshRunsRepository.prototype,
    "listSteps",
  ).mockImplementation(async () => structuredClone(state.steps));
  vi.spyOn(
    AnalysisRefreshRunsRepository.prototype,
    "startStep",
  ).mockImplementation(async (_scope, _runId, stepKey, childId) => {
    const current = state.steps.find((candidate) => candidate.step_key === stepKey);
    if (!current || current.state !== "pending") return null;
    const next = {
      ...current,
      state: "running" as const,
      child_async_run_id: childId,
      started_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    };
    replaceStep(state, next);
    return structuredClone(next);
  });
  vi.spyOn(
    AnalysisRefreshRunsRepository.prototype,
    "completeStep",
  ).mockImplementation(async (_scope, _runId, stepKey, values) => {
    const current = state.steps.find((candidate) => candidate.step_key === stepKey);
    if (
      !current ||
      current.state !== "running" ||
      current.child_async_run_id !== values.childAsyncRunId
    ) {
      return false;
    }
    replaceStep(state, {
      ...current,
      state: "completed",
      result_snapshot_id: values.resultSnapshotId,
      completed_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    return true;
  });
  vi.spyOn(
    AnalysisRefreshRunsRepository.prototype,
    "skipStep",
  ).mockImplementation(async (_scope, _runId, stepKey, reason) => {
    const current = state.steps.find((candidate) => candidate.step_key === stepKey);
    if (!current || current.state !== "pending" || current.required) return false;
    replaceStep(state, {
      ...current,
      state: "skipped",
      skip_reason: reason,
      completed_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    return true;
  });
  vi.spyOn(
    AnalysisRefreshRunsRepository.prototype,
    "failStep",
  ).mockImplementation(async (_scope, _runId, stepKey, values) => {
    const current = state.steps.find((candidate) => candidate.step_key === stepKey);
    if (!current || (current.state !== "pending" && current.state !== "running")) {
      return false;
    }
    replaceStep(state, {
      ...current,
      state: "failed",
      error: values.error,
      child_async_run_id:
        values.childAsyncRunId ?? current.child_async_run_id,
      completed_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    return true;
  });

  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue(
    project,
  );
  vi.spyOn(
    ProjectsRepository.prototype,
    "findConfirmedIcpProfile",
  ).mockResolvedValue(null);
  vi.spyOn(
    ObservationsRepository.prototype,
    "listBySnapshotIds",
  ).mockResolvedValue([]);
  vi.spyOn(ProjectsRepository.prototype, "setStage").mockImplementation(
    async (_scope, _projectId, stage) => {
      state.stage = stage;
      return true;
    },
  );
  vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue(site);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "findConnectedByIdForUpdate",
  ).mockResolvedValue(crawlConnection);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "findConnectedByProviderForUpdate",
  ).mockResolvedValue(null);
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "insertConnection",
  ).mockResolvedValue(sourceConnection("dataforseo"));
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
    id: IDS.profile,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    version: 3,
    status: "complete",
    profile: { legacyIcpVersion: "0.2" },
    content_hash: "a".repeat(64),
    created_by: IDS.actor,
    created_at: NOW.toISOString(),
  });
  vi.spyOn(
    SitePagesRepository.prototype,
    "findExactNormalizedUrl",
  ).mockResolvedValue({
    id: IDS.page,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    site_id: IDS.site,
    normalized_url: "https://example.test/product",
    normalized_url_hash: "f".repeat(64),
    template_key: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  });

  vi.spyOn(
    CollectionRunsRepository.prototype,
    "insertPlaceholder",
  ).mockImplementation(async (values) => {
    const row: CollectionRunRow = {
      id: values.runId,
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      site_id: values.siteId,
      source_connection_id: values.sourceConnectionId,
      import_preview_id: values.importPreviewId ?? null,
      crawl_seed_site_page_id: values.crawlSeedSitePageId ?? null,
      crawl_seed_url: values.crawlSeedUrl ?? null,
      provider: values.provider,
      operation: values.operation,
      method_version: values.methodVersion,
      parameters_hash: values.parametersHash,
      row_count: null,
      stop_reason: null,
      created_at: NOW.toISOString(),
    };
    state.collections.set(row.id, row);
    return row;
  });
  vi.spyOn(CollectionRunsRepository.prototype, "findById").mockImplementation(
    async (id) => state.collections.get(id) ?? null,
  );
  vi.spyOn(
    DataSnapshotsRepository.prototype,
    "findByCollectionRunId",
  ).mockImplementation(
    async (_scope, childId) =>
      [...state.snapshots.values()].find(
        (snapshot) => snapshot.collection_run_id === childId,
      ) ?? null,
  );
  vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockImplementation(
    async (_scope, ids) =>
      ids.flatMap((id) => {
        const found = state.snapshots.get(id);
        return found ? [found] : [];
      }),
  );

  vi.spyOn(KeywordsRepository.prototype, "listDiagnosticEligible").mockResolvedValue(
    [],
  );
  vi.spyOn(
    KeywordOccurrencesRepository.prototype,
    "listForEntityIds",
  ).mockResolvedValue([]);
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue([]);
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listOriginsForCompetitorIds",
  ).mockResolvedValue([]);
  vi.spyOn(DiagnosticRunsRepository.prototype, "insert").mockImplementation(
    async (values) =>
      ({
        id: values.runId,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        icp_profile_id: values.icpProfileId,
        icp_profile_version: values.icpProfileVersion,
        rule_set_version: values.ruleSetVersion,
        prompt_set_version: values.promptSetVersion,
        output_locale: values.outputLocale,
        input_manifest: values.inputManifest,
        input_hash: values.inputHash,
        coverage: {},
        created_at: NOW.toISOString(),
      }) as never,
  );
  vi.spyOn(CapabilityRunsRepository.prototype, "create").mockResolvedValue(
    {} as never,
  );
  vi.spyOn(AuditRunsRepository.prototype, "create").mockResolvedValue(
    {} as never,
  );
  vi.spyOn(
    AuditRunsRepository.prototype,
    "findByDiagnosticRunId",
  ).mockImplementation(
    async (_scope, id) => state.auditChildren.get(id) ?? null,
  );

  let failContinuation = options.failFirstContinuation === true;
  let continuationIndex = 0;
  const send = vi.fn(
    async (
      queue: string,
      payload: { readonly runId: string },
      _sendOptions: unknown,
    ): Promise<string | null> => {
      if (queue !== "refresh.analysis") return payload.runId;
      if (failContinuation) {
        failContinuation = false;
        return null;
      }
      continuationIndex += 1;
      return `10000000-0000-4000-8000-${String(continuationIndex).padStart(12, "0")}`;
    },
  );
  const db = {
    transaction: async <T>(
      callback: (tx: WorkerContext["db"]) => Promise<T>,
    ): Promise<T> => {
      const before = cloneState(state);
      try {
        return await callback({} as WorkerContext["db"]);
      } catch (error) {
        restoreState(state, before);
        throw error;
      }
    },
  } as WorkerContext["db"];
  const ctx: WorkerContext = {
    db,
    boss: { send } as unknown as PgBoss,
    blobStore: {} as WorkerContext["blobStore"],
    credentialKey: Buffer.alloc(32),
    appOrigin: "http://localhost:3000",
    googleOAuth: { clientId: "id", clientSecret: "secret" },
    ...(options.dataForSeo ? { dataForSeo: options.dataForSeo } : {}),
    openai: { apiKey: "key", model: "model" },
    findingSummariesEnabled: true,
    logger: testLogger,
  };
  return { ctx, state, send };
}

function prepareDataForSeoStep(harness: Harness): void {
  harness.state.steps = [
    step("crawl", 1, true, {
      state: "completed",
      childId: IDS.collectionChild,
      snapshotId: IDS.crawlSnapshot,
    }),
    step("gsc", 2, false, {
      state: "skipped",
      skipReason: "source_not_connected",
    }),
    step("ga4", 3, false, {
      state: "skipped",
      skipReason: "source_not_connected",
    }),
    step("dataforseo", 4, false),
    step("growth_audit", 5, true),
  ];
  harness.state.snapshots.set(IDS.crawlSnapshot, crawlSnapshot());
}

function installRunningCollection(
  harness: Harness,
  input: { readonly snapshot: DataSnapshotRow },
): void {
  harness.state.steps[0] = step("crawl", 1, true, {
    state: "running",
    childId: IDS.collectionChild,
  });
  harness.state.children.set(
    IDS.collectionChild,
    asyncRun({
      id: IDS.collectionChild,
      kind: "collection",
      activeKey: "collect:crawl:site_graph",
      status: "completed",
      resultType: "collection_run",
      resultId: IDS.collectionChild,
    }),
  );
  harness.state.collections.set(
    IDS.collectionChild,
    collectionRun(IDS.collectionChild),
  );
  harness.state.snapshots.set(input.snapshot.id, input.snapshot);
}

function installCompletedCollectionPlan(harness: Harness): void {
  harness.state.steps = [
    step("crawl", 1, true, {
      state: "completed",
      childId: IDS.collectionChild,
      snapshotId: IDS.crawlSnapshot,
    }),
    step("gsc", 2, false, { state: "skipped", skipReason: "not_connected" }),
    step("ga4", 3, false, { state: "skipped", skipReason: "not_connected" }),
    step("dataforseo", 4, false, {
      state: "skipped",
      skipReason: "feature_disabled",
    }),
    step("growth_audit", 5, true),
  ];
  harness.state.snapshots.set(IDS.crawlSnapshot, crawlSnapshot());
}

function cloneState(state: HarnessState): HarnessState {
  return {
    steps: structuredClone(state.steps),
    children: new Map(
      [...state.children].map(([id, row]) => [id, structuredClone(row)]),
    ),
    collections: new Map(
      [...state.collections].map(([id, row]) => [id, structuredClone(row)]),
    ),
    snapshots: new Map(
      [...state.snapshots].map(([id, row]) => [id, structuredClone(row)]),
    ),
    auditChildren: new Map(
      [...state.auditChildren].map(([id, row]) => [id, structuredClone(row)]),
    ),
    stage: state.stage,
  };
}

function restoreState(target: HarnessState, source: HarnessState): void {
  target.steps = source.steps;
  target.children = source.children;
  target.collections = source.collections;
  target.snapshots = source.snapshots;
  target.auditChildren = source.auditChildren;
  target.stage = source.stage;
}

function replaceStep(
  state: HarnessState,
  replacement: AnalysisRefreshStepRow,
): void {
  state.steps = state.steps.map((candidate) =>
    candidate.step_key === replacement.step_key ? replacement : candidate,
  );
}

function step(
  stepKey: AnalysisRefreshStepRow["step_key"],
  ordinal: number,
  required: boolean,
  input: {
    readonly state?: AnalysisRefreshStepRow["state"];
    readonly childId?: string;
    readonly snapshotId?: string;
    readonly skipReason?: string;
  } = {},
): AnalysisRefreshStepRow {
  const state = input.state ?? "pending";
  const terminal =
    state === "completed" || state === "skipped" || state === "failed";
  return {
    analysis_refresh_run_id: IDS.parent,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    ordinal,
    step_key: stepKey,
    required,
    state,
    child_async_run_id: input.childId ?? null,
    result_snapshot_id: input.snapshotId ?? null,
    skip_reason: input.skipReason ?? null,
    error: null,
    started_at: state === "running" || terminal ? NOW.toISOString() : null,
    completed_at: terminal ? NOW.toISOString() : null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

function asyncRun(input: {
  readonly id: string;
  readonly kind: string;
  readonly activeKey: string;
  readonly status: string;
  readonly requestPayload?: Record<string, unknown>;
  readonly resultType?: string;
  readonly resultId?: string;
}): AsyncRunRow {
  return {
    id: input.id,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    kind: input.kind,
    status: input.status,
    active_key: input.activeKey,
    contract_version: CONTRACT_VERSION,
    request_payload: input.requestPayload ?? {},
    progress: {},
    last_error_code: null,
    last_error_summary: null,
    result_type: input.resultType ?? null,
    result_id: input.resultId ?? null,
    attempt_count: 1,
    initiated_by: IDS.actor,
    queued_at: NOW.toISOString(),
    started_at: NOW.toISOString(),
    completed_at:
      input.status === "queued" || input.status === "running"
        ? null
        : NOW.toISOString(),
  };
}

function projectRow(): ProjectRow {
  return {
    id: IDS.project,
    workspace_id: IDS.workspace,
    client_name: "Fixture",
    project_name: "Analysis Refresh",
    stage: "setup",
    default_delivery_locale: "en-US",
    current_icp_profile_id: IDS.profile,
    confirmed_icp_profile_id: IDS.profile,
    archived_at: null,
    created_by: IDS.actor,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

function siteRow(): SiteRow {
  return {
    id: IDS.site,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    origin: "https://example.test",
    host: "example.test",
    market_codes: ["US"],
    language_codes: ["en-US"],
    is_primary: true,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

function sourceConnection(provider = "crawl"): SourceConnectionRow {
  return {
    id:
      provider === "crawl"
        ? IDS.crawlConnection
        : "00000000-0000-4000-8000-000000000099",
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    site_id: IDS.site,
    provider,
    connection_type: "public",
    state: "connected",
    external_ref: null,
    scopes: [],
    config: {},
    limitation: "fixture",
    connected_at: NOW.toISOString(),
    disconnected_at: null,
    last_successful_snapshot_id: null,
    created_by: IDS.actor,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

function collectionRun(id: string): CollectionRunRow {
  return {
    id,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    site_id: IDS.site,
    source_connection_id: IDS.crawlConnection,
    import_preview_id: null,
    crawl_seed_site_page_id: null,
    crawl_seed_url: null,
    provider: "crawl",
    operation: "site_graph",
    method_version: "crawl.site_graph.v2",
    parameters_hash: "c".repeat(64),
    row_count: 1,
    stop_reason: null,
    created_at: NOW.toISOString(),
  };
}

function crawlSnapshot(): DataSnapshotRow {
  return {
    id: IDS.crawlSnapshot,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    site_id: IDS.site,
    collection_run_id: IDS.collectionChild,
    source_connection_id: IDS.crawlConnection,
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    schema_version: "1.0.0",
    method_version: "crawl.site_graph.v2",
    captured_at: NOW.toISOString(),
    source_window: {},
    availability: "available",
    limitation: "fixture",
    raw_object_key: null,
    row_count: 1,
    checksum: "d".repeat(64),
    summary: {},
    created_at: NOW.toISOString(),
  };
}

function dataForSeoSnapshot(
  collectionRunId: string,
  sourceConnectionId: string,
): DataSnapshotRow {
  return {
    ...crawlSnapshot(),
    id: IDS.dataForSeoSnapshot,
    collection_run_id: collectionRunId,
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    dataset_key: "dataforseo.search_landscape.v2",
    schema_version: "dataforseo.search_landscape.v2",
    method_version: "dataforseo.search_landscape.v2",
    row_count: 118,
    limitation:
      "Weekly competitor refresh; exact dataset timestamps are unavailable.",
  };
}

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};
