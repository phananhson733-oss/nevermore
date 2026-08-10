import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  CollectionRunsRepository,
  CompetitorsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  IcpProfilesRepository,
  KeywordGovernanceIntegrityError,
  KeywordGovernanceRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  ObservationsRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  TopicModelGenerationRunsRepository,
  TopicModelsRepository,
  type AnalysisRefreshStepRow,
  type AsyncRunRow,
  type CollectionRunRow,
  type DataSnapshotRow,
  type KeywordEntityRow,
  type KeywordOccurrenceForEntityRow,
  type ObservationRow,
  type PgBoss,
  type ProjectRow,
  type SiteRow,
  type SourceConnectionRow,
  type TopicModelGenerationRunRow,
} from "@sf/db";
import {
  CONTRACT_VERSION,
  parseTopicModelGenerationInputManifest,
  type TopicModelGenerationInputManifest,
} from "@sf/contracts";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import { DiagnosticGovernanceCapacityError } from "./governance.ts";
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
  dataForSeoBacklinksSnapshot: "00000000-0000-4000-8000-000000000016",
  keyword: "00000000-0000-4000-8000-000000000017",
  topicGenerationChild: "00000000-0000-4000-8000-000000000018",
  providerObservation: "00000000-0000-4000-8000-000000000019",
  topicModelRevision: "00000000-0000-4000-8000-000000000020",
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
  dataForSeoBacklinks: {
    enabled: false,
    maxBacklinks: 500,
    maxReferringDomains: 100,
    maxBacklinkPages: 500,
    maxSourceVerifications: 20,
  },
} as const;
const LEGACY_REQUEST_PAYLOAD = {
  siteId: REQUEST_PAYLOAD.siteId,
  icpProfile: REQUEST_PAYLOAD.icpProfile,
  outputLocale: REQUEST_PAYLOAD.outputLocale,
  sourceConnectionIds: REQUEST_PAYLOAD.sourceConnectionIds,
  dataForSeo: REQUEST_PAYLOAD.dataForSeo,
} as const;
const LEGACY_PLAN_MANIFEST = {
  version: "analysis-refresh.plan.v1",
  steps: [
    { ordinal: 1, stepKey: "crawl", required: true },
    { ordinal: 2, stepKey: "gsc", required: false },
    { ordinal: 3, stepKey: "ga4", required: false },
    { ordinal: 4, stepKey: "dataforseo", required: false },
    { ordinal: 5, stepKey: "growth_audit", required: true },
  ],
} as const;
const LEGACY_PLAN_HASH =
  "d725c90b76edf0bd7747a8d3dcf18754dfa9c5356f66ca765acbaa4145e405af";
const CURRENT_PLAN_MANIFEST = {
  version: "analysis-refresh.plan.v2",
  steps: [
    { ordinal: 1, stepKey: "crawl", required: true },
    { ordinal: 2, stepKey: "gsc", required: false },
    { ordinal: 3, stepKey: "ga4", required: false },
    { ordinal: 4, stepKey: "dataforseo", required: false },
    {
      ordinal: 5,
      stepKey: "dataforseo_backlinks",
      required: false,
    },
    { ordinal: 6, stepKey: "growth_audit", required: true },
  ],
} as const;
const CURRENT_PLAN_HASH =
  "3049a718f77263f766e47d0d7318a9414520d07c8ab92960f50c85b864977c65";
const V3_PLAN_MANIFEST = {
  version: "analysis-refresh.plan.v3",
  steps: [
    { ordinal: 1, stepKey: "crawl", required: true },
    { ordinal: 2, stepKey: "gsc", required: false },
    { ordinal: 3, stepKey: "ga4", required: false },
    { ordinal: 4, stepKey: "dataforseo", required: false },
    { ordinal: 5, stepKey: "dataforseo_backlinks", required: false },
    { ordinal: 6, stepKey: "topic_model", required: false },
    { ordinal: 7, stepKey: "growth_audit", required: true },
  ],
} as const;
const V3_PLAN_HASH =
  "fc527bb7203d61ce126625a0b2bb4bffb59fe5999d9f6b78e5aa05409918368b";
const LEGACY_PROFILE = {
  productName: "Acme",
  oneLineDescription: "Ship faster",
  productType: "saas",
  businessModels: ["subscription"],
  marketCodes: ["US"],
  segments: ["Growth teams"],
  primaryConversion: {
    label: "Book a demo",
    type: "contact",
    targetUrl: "https://example.test/demo",
  },
  priorityUrls: ["https://example.test/pricing"],
  technicalConstraints: ["Legacy CMS"],
  resourceConstraints: ["One engineer"],
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAnalysisRefresh", () => {
  it("continues an existing five-step v1 parent whose frozen payload predates backlink policy", async () => {
    const harness = createHarness({ legacyPlan: true });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "crawl",
        operation: "site_graph",
      }),
    );
    expect(harness.state.steps).toHaveLength(5);
    expect(harness.state.steps[0]).toMatchObject({
      step_key: "crawl",
      state: "running",
    });
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
  });

  it("fails closed when a six-step v2 parent omits its frozen backlink policy", async () => {
    const harness = createHarness({ requestPayload: LEGACY_REQUEST_PAYLOAD });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ runId: IDS.parent }),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "ANALYSIS_REFRESH_PROJECTION_INVALID",
      }),
    );
  });

  it("skips the exact v3 Topic step without creating a child when a confirmed model exists", async () => {
    const harness = createHarness({ v3Plan: true });
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
      step("dataforseo", 4, false, {
        state: "skipped",
        skipReason: "feature_disabled",
      }),
      step("dataforseo_backlinks", 5, false, {
        state: "skipped",
        skipReason: "feature_disabled",
      }),
      step("topic_model", 6, false),
      step("growth_audit", 7, true),
    ];
    vi.spyOn(
      TopicModelsRepository.prototype,
      "getLatestConfirmed",
    ).mockResolvedValue({ state: "confirmed" } as never);

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      step_key: "topic_model",
      state: "skipped",
      skip_reason: "existing_confirmed_model",
      child_async_run_id: null,
    });
    expect(harness.state.steps[6]?.state).toBe("pending");
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
  });

  it("skips the exact v3 Topic step without creating a child when a draft exists", async () => {
    const harness = createHarness({ v3Plan: true });
    installReadyTopicPlan(harness);
    vi.mocked(TopicModelsRepository.prototype.getDraft).mockResolvedValue({
      state: "draft",
    } as never);

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      step_key: "topic_model",
      state: "skipped",
      skip_reason: "existing_draft",
      child_async_run_id: null,
    });
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
  });

  it("keeps Topic unavailable without creating a child when no eligible keyword evidence exists", async () => {
    const harness = createHarness({ v3Plan: true });
    installReadyTopicPlan(harness);

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      step_key: "topic_model",
      state: "skipped",
      skip_reason: "insufficient_keyword_evidence",
      child_async_run_id: null,
    });
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
    expect(
      TopicModelGenerationRunsRepository.prototype.insertPlaceholder,
    ).not.toHaveBeenCalled();
  });

  it("freezes one strict manifest and atomically enqueues one typed Topic generation child", async () => {
    const harness = createHarness({ v3Plan: true });
    installReadyTopicPlan(harness, { dataForSeoCompleted: true });
    vi.mocked(
      KeywordsRepository.prototype.listDiagnosticEligible,
    ).mockResolvedValue([topicKeyword()]);
    vi.mocked(
      KeywordOccurrencesRepository.prototype.listForEntityIds,
    ).mockResolvedValue([topicOccurrence()]);
    vi.mocked(ObservationsRepository.prototype.listBySnapshotIds).mockResolvedValue([
      {
        ...topicObservation(),
        observed_at: "2026-07-29 12:00:00+08",
      },
    ]);

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    const child = [...harness.state.children.values()].find(
      (candidate) => candidate.kind === "topic_model_generation",
    );
    expect(child).toMatchObject({
      status: "queued",
      result_type: "topic_model_generation_run",
      result_id: expect.any(String),
      request_payload: {
        analysisRefreshRunId: IDS.parent,
        inputSchemaVersion: "topic-model-generation-input.v1",
      },
    });
    expect(child?.result_id).toBe(child?.id);
    expect(child?.request_payload).not.toHaveProperty("provider");
    expect(child?.request_payload).not.toHaveProperty("model");
    expect(child?.request_payload).not.toHaveProperty("temperature");

    const insert = vi.mocked(
      TopicModelGenerationRunsRepository.prototype.insertPlaceholder,
    );
    expect(insert).toHaveBeenCalledTimes(1);
    const frozen = insert.mock.calls[0]?.[0];
    expect(frozen).toMatchObject({
      runId: child?.id,
      workspaceId: IDS.workspace,
      projectId: IDS.project,
      analysisRefreshRunId: IDS.parent,
      generationVersion: "topic-model-generation.v1",
      promptSetVersion: "topic-model.prompt.v1",
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const manifest = parseTopicModelGenerationInputManifest(
      frozen?.inputManifest,
    );
    expect(manifest).toEqual({
      schemaVersion: "topic-model-generation-input.v1",
      analysisRefreshRunId: IDS.parent,
      projectId: IDS.project,
      market: "US",
      language: "en-US",
      groups: [
        {
          groupKey: "group-001",
          representativeKeywords: ["customer onboarding software"],
          keywordCount: 1,
          aggregateSearchVolume: 720,
          providerIntentDistribution: {
            informational: 0,
            navigational: 0,
            commercial: 1,
            transactional: 0,
          },
          urls: ["https://example.test/customer-onboarding"],
        },
      ],
      productProfile: null,
      icp: null,
      keywords: [
        {
          keywordId: IDS.keyword,
          expectedGovernanceRevision: 1,
          groupKey: "group-001",
          providerSearchIntent: {
            value: "commercial",
            snapshotId: IDS.dataForSeoSnapshot,
            observationId: IDS.providerObservation,
            observedAt: NOW.toISOString(),
          },
        },
      ],
    } satisfies TopicModelGenerationInputManifest);
    expect(frozen?.inputHash).toBe(contentHash(manifest));
    expect(harness.send).toHaveBeenCalledWith(
      "topic-model.generate",
      expect.objectContaining({ runId: child?.id }),
      expect.objectContaining({ id: child?.id }),
    );
    expect(harness.state.steps[5]).toMatchObject({
      step_key: "topic_model",
      state: "running",
      child_async_run_id: child?.id,
    });
    expect(harness.state.steps[6]?.state).toBe("pending");
  });

  it("completes Topic only from the exact successful typed child lineage", async () => {
    const harness = createHarness({ v3Plan: true });
    installRunningTopicChild(harness, "completed");

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      step_key: "topic_model",
      state: "completed",
      child_async_run_id: IDS.topicGenerationChild,
      result_snapshot_id: null,
    });
    expect(harness.state.steps[6]?.state).toBe("pending");
  });

  it("fails an outcome-unknown Topic child as an optional limitation and still starts Growth Audit", async () => {
    const harness = createHarness({ v3Plan: true });
    installRunningTopicChild(harness, "failed");
    harness.state.children.set(IDS.topicGenerationChild, {
      ...harness.state.children.get(IDS.topicGenerationChild)!,
      last_error_code: "TOPIC_MODEL_GENERATION_INVOCATION_OUTCOME_UNKNOWN",
      last_error_summary:
        "Topic Model generation stopped because provider outcome is unknown.",
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      step_key: "topic_model",
      state: "failed",
      child_async_run_id: IDS.topicGenerationChild,
      error: {
        code: "ANALYSIS_REFRESH_TOPIC_MODEL_OUTCOME_UNKNOWN",
      },
    });
    expect(harness.state.steps[6]?.state).toBe("pending");

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(DiagnosticRunsRepository.prototype.insert).toHaveBeenCalledTimes(1);
    expect(harness.state.steps[6]).toMatchObject({
      step_key: "growth_audit",
      state: "running",
      child_async_run_id: expect.any(String),
    });
    const auditChildId = harness.state.steps[6]!.child_async_run_id!;
    harness.state.children.set(auditChildId, {
      ...harness.state.children.get(auditChildId)!,
      status: "completed",
      result_type: "diagnostic_run",
      result_id: auditChildId,
      completed_at: NOW.toISOString(),
    });
    harness.state.auditChildren.set(auditChildId, {
      id: auditChildId,
      workspace_id: IDS.workspace,
      project_id: IDS.project,
      diagnostic_run_id: auditChildId,
      capability_run_id: auditChildId,
      scope_kind: "site",
      scope_key: IDS.site,
      projection_version: "growth-audit.0.3.1",
      created_at: NOW.toISOString(),
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[6]?.state).toBe("completed");
    expect(harness.state.parentStatus).toBe("partial");
  });

  it("records an exact superseded Topic limitation without overwriting the concurrent model and still starts Growth Audit", async () => {
    const harness = createHarness({ v3Plan: true });
    const materialize = vi.spyOn(
      TopicModelsRepository.prototype,
      "materializeSystemConfirmedFirstRevision",
    );
    installRunningTopicChild(harness, "cancelled");
    harness.state.children.set(IDS.topicGenerationChild, {
      ...harness.state.children.get(IDS.topicGenerationChild)!,
      last_error_code: "TOPIC_MODEL_GENERATION_SUPERSEDED",
      last_error_summary: "Topic Model generation was superseded.",
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      step_key: "topic_model",
      state: "failed",
      child_async_run_id: IDS.topicGenerationChild,
      error: {
        code: "ANALYSIS_REFRESH_TOPIC_MODEL_SUPERSEDED",
      },
    });
    expect(materialize).not.toHaveBeenCalled();
    expect(harness.state.steps[6]?.state).toBe("pending");

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(DiagnosticRunsRepository.prototype.insert).toHaveBeenCalledTimes(1);
    expect(harness.state.steps[6]).toMatchObject({
      step_key: "growth_audit",
      state: "running",
      child_async_run_id: expect.any(String),
    });
  });

  it("fails closed when a completed Topic child points at another parent lineage", async () => {
    const harness = createHarness({ v3Plan: true });
    installRunningTopicChild(harness, "completed");
    harness.state.generationRuns.set(IDS.topicGenerationChild, {
      ...harness.state.generationRuns.get(IDS.topicGenerationChild)!,
      analysis_refresh_run_id: IDS.external,
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      state: "failed",
      error: { code: "ANALYSIS_REFRESH_TOPIC_MODEL_RESULT_INVALID" },
    });
    expect(harness.state.steps[6]?.state).toBe("pending");
  });

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

  it("rolls the claim back with the transaction so a redelivery replays the tick", async () => {
    const harness = createHarness({ failFirstContinuation: true });

    await expect(
      runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW }),
    ).rejects.toThrow(/continuation/i);

    // The claim participates in the tick transaction: a mid-tick death must
    // leave the parent `queued`, not pinned `running`. Before this held, a
    // died tick left `running` and the pg-boss redelivery was swallowed by
    // prepareDelivery's rescue clause (attempt_count can never be <= the
    // pg-boss retry count on a continuation chain), orphaning the whole run.
    expect(harness.state.parentStatus).toBe("queued");

    // The redelivery replays the tick from the start and hands off normally.
    await expect(
      runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW }),
    ).resolves.toBeUndefined();
    expect(harness.state.steps[0]?.state).toBe("running");
    expect(harness.state.parentStatus).toBe("queued");
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
        backlinksEnabled: true,
        maxBacklinks: 500,
        maxReferringDomains: 100,
        maxBacklinkPages: 500,
        maxSourceVerifications: 20,
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
        methodVersion: "dataforseo.search_landscape.v3",
      }),
    );
    expect(collectionChildren[0]?.request_payload).toEqual({
      provider: "dataforseo",
      operation: "search_landscape",
      sourceConnectionId: sourceConnection("dataforseo").id,
      collectionScope: expect.objectContaining({
        schemaVersion: "dataforseo.search-landscape-scope.v3",
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
        aiCitations: {
          state: "disabled",
          attemptedQueries: 0,
        },
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
      dataForSeoSnapshot(
        child.id,
        collection.source_connection_id,
        collection.method_version,
      ),
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

  it("resumes an exact historical DataForSEO Search Landscape v1 collection child", async () => {
    const harness = createHarness({ legacyPlan: true });
    const connection = sourceConnection("dataforseo");
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
      step("dataforseo", 4, false, {
        state: "running",
        childId: IDS.gscChild,
      }),
      step("growth_audit", 5, true),
    ];
    harness.state.children.set(
      IDS.gscChild,
      asyncRun({
        id: IDS.gscChild,
        kind: "collection",
        activeKey: "collect:dataforseo:search_landscape",
        status: "completed",
        resultType: "collection_run",
        resultId: IDS.gscChild,
      }),
    );
    harness.state.collections.set(
      IDS.gscChild,
      dataForSeoCollectionRun(
        IDS.gscChild,
        connection.id,
        "dataforseo.search_landscape.v1",
      ),
    );
    harness.state.snapshots.set(IDS.crawlSnapshot, crawlSnapshot());
    harness.state.snapshots.set(
      IDS.dataForSeoSnapshot,
      dataForSeoSnapshot(
        IDS.gscChild,
        connection.id,
        "dataforseo.search_landscape.v1",
      ),
    );

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[3]).toMatchObject({
      step_key: "dataforseo",
      state: "completed",
      child_async_run_id: IDS.gscChild,
      result_snapshot_id: IDS.dataForSeoSnapshot,
    });
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("rejects a mixed DataForSEO Search Landscape identity while resuming a child", async () => {
    const harness = createHarness({ legacyPlan: true });
    const connection = sourceConnection("dataforseo");
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
      step("dataforseo", 4, false, {
        state: "running",
        childId: IDS.gscChild,
      }),
      step("growth_audit", 5, true),
    ];
    harness.state.children.set(
      IDS.gscChild,
      asyncRun({
        id: IDS.gscChild,
        kind: "collection",
        activeKey: "collect:dataforseo:search_landscape",
        status: "completed",
        resultType: "collection_run",
        resultId: IDS.gscChild,
      }),
    );
    harness.state.collections.set(
      IDS.gscChild,
      dataForSeoCollectionRun(
        IDS.gscChild,
        connection.id,
        "dataforseo.search_landscape.v2",
      ),
    );
    harness.state.snapshots.set(IDS.crawlSnapshot, crawlSnapshot());
    harness.state.snapshots.set(IDS.dataForSeoSnapshot, {
      ...dataForSeoSnapshot(
        IDS.gscChild,
        connection.id,
        "dataforseo.search_landscape.v2",
      ),
      schema_version: "dataforseo.search_landscape.v1",
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[3]).toMatchObject({
      step_key: "dataforseo",
      state: "failed",
      error: { code: "ANALYSIS_REFRESH_SNAPSHOT_INVALID" },
    });
  });

  it("starts and completes the optional DataForSEO backlink collection with exact provider lineage", async () => {
    const requestPayload = {
      ...REQUEST_PAYLOAD,
      dataForSeo: {
        enabled: true,
        maxKeywords: 87,
        maxCompetitors: 31,
      },
      dataForSeoBacklinks: {
        enabled: true,
        maxBacklinks: 321,
        maxReferringDomains: 67,
        maxBacklinkPages: 234,
        maxSourceVerifications: 9,
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
        backlinksEnabled: true,
        maxBacklinks: 500,
        maxReferringDomains: 100,
        maxBacklinkPages: 500,
        maxSourceVerifications: 20,
      },
    });
    const connection = sourceConnection("dataforseo");
    vi.mocked(
      SourceConnectionsRepository.prototype.findConnectedByProviderForUpdate,
    ).mockResolvedValue(connection);
    prepareDataForSeoBacklinksStep(harness);

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    const collectionChildren = [...harness.state.children.values()].filter(
      (child) => child.kind === "collection",
    );
    expect(collectionChildren).toHaveLength(1);
    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "dataforseo",
        operation: "backlinks",
        methodVersion: "dataforseo.backlinks.v1",
        sourceConnectionId: connection.id,
      }),
    );
    expect(collectionChildren[0]?.request_payload).toEqual({
      provider: "dataforseo",
      operation: "backlinks",
      sourceConnectionId: connection.id,
      collectionScope: {
        schemaVersion: "dataforseo.backlinks-scope.v1",
        queryKind: "backlinks",
        target: "example.test",
        includeSubdomains: true,
        indirectLinksPolicy: {
          summary: "included",
          backlinks: "not_configurable",
          referringDomains: "included",
          domainPages: "not_configurable",
        },
        excludeInternalBacklinks: true,
        backlinksStatusType: "live",
        rankScale: "one_hundred",
        maxBacklinks: 321,
        maxReferringDomains: 67,
        maxBacklinkPages: 234,
        maxSourceVerifications: 9,
      },
    });
    expect(
      harness.send.mock.calls.filter(
        ([queue]) => queue === "collect.dataforseo",
      ),
    ).toHaveLength(1);
    expect(
      SourceConnectionsRepository.prototype.insertConnection,
    ).not.toHaveBeenCalled();
    expect(harness.state.steps[4]).toMatchObject({
      step_key: "dataforseo_backlinks",
      state: "running",
      child_async_run_id: collectionChildren[0]?.id,
    });

    const child = collectionChildren[0]!;
    harness.state.children.set(child.id, {
      ...child,
      status: "completed",
      result_type: "collection_run",
      result_id: child.id,
      completed_at: NOW.toISOString(),
    });
    harness.state.snapshots.set(
      IDS.dataForSeoBacklinksSnapshot,
      dataForSeoBacklinksSnapshot(child.id, connection.id),
    );

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[4]).toMatchObject({
      step_key: "dataforseo_backlinks",
      state: "completed",
      child_async_run_id: child.id,
      result_snapshot_id: IDS.dataForSeoBacklinksSnapshot,
    });
    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledTimes(1);
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
          backlinksEnabled: true,
          maxBacklinks: 500,
          maxReferringDomains: 100,
          maxBacklinkPages: 500,
          maxSourceVerifications: 20,
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
      step("dataforseo_backlinks", 5, false),
      step("growth_audit", 6, true),
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
    expect(harness.state.steps[5]?.state).toBe("pending");
    expect(DiagnosticRunsRepository.prototype.insert).not.toHaveBeenCalled();
    // A failed optional step is durable progress, so its continuation is an
    // immediate "advance" delivery — no poll delay.
    const continuation = harness.send.mock.calls.find(
      (call) => call[0] === "refresh.analysis",
    );
    expect(continuation?.[1]).toMatchObject({ runId: IDS.parent });
    expect(continuation?.[2]).not.toHaveProperty("startAfter");
  });

  it("creates the Growth Audit child with the exact Snapshot manifest and governance projection", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    const exactSite = { ...siteRow(), language_codes: ["fr-CA"] };
    const siteRead = vi.mocked(SitesRepository.prototype.findById);
    siteRead.mockResolvedValue(exactSite);
    const profileRead = vi.mocked(IcpProfilesRepository.prototype.findById);

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    const diagnosticInsert = vi.mocked(
      DiagnosticRunsRepository.prototype.insert,
    );
    expect(diagnosticInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        siteId: IDS.site,
        icpProfileId: IDS.profile,
        icpProfileVersion: 3,
        outputLocale: "en-US",
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const inputManifest = diagnosticInsert.mock.calls[0]?.[0]
      .inputManifest as Record<string, unknown>;
    expect(Object.keys(inputManifest).sort()).toEqual([
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
    expect(inputManifest).toMatchObject({
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
      contextProjection: {
        profileGeneration: "legacy-icp.v1",
        siteLanguage: {
          sourceKind: "site",
          state: "declared_non_empty",
          languageCodes: ["fr-CA"],
        },
      },
    });
    expect(profileRead).toHaveBeenCalledWith(
      { workspaceId: IDS.workspace, projectId: IDS.project },
      IDS.profile,
    );
    expect(siteRead).toHaveBeenCalledWith(
      { workspaceId: IDS.workspace, projectId: IDS.project },
      IDS.site,
    );
    expect(profileRead).toHaveBeenCalledBefore(diagnosticInsert);
    expect(siteRead).toHaveBeenCalledBefore(diagnosticInsert);
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
        projectionVersion: "growth-audit.0.3.1",
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
    expect(harness.state.steps[5]).toMatchObject({
      state: "running",
      child_async_run_id: expect.any(String),
    });
  });

  it("auto-governs evidence-bearing candidate keywords before it freezes the library", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    const candidates = vi.mocked(
      KeywordsRepository.prototype.listAutoGovernanceCandidates,
    );
    candidates.mockResolvedValue([
      {
        id: IDS.keyword,
        workspace_id: IDS.workspace,
        project_id: IDS.project,
        display_keyword: "Customer Onboarding Software",
        normalized_keyword: "customer onboarding software",
        market: "US",
        language_tag: "en-US",
        query_kind: "search_query",
        mapping_revision: 0,
        dataforseo_ranked_evidence: 3,
        gsc_impression_evidence: 0,
        gsc_attributed_site_page_count: 0,
        gsc_attributed_site_page_id: null,
        occurrence_count: 2,
      },
    ]);
    const approvals = vi
      .spyOn(KeywordGovernanceRepository.prototype, "applySystemApprovals")
      .mockResolvedValue([
        {
          keywordId: IDS.keyword,
          applied: true,
          skipped: null,
          governanceRevision: 1,
        },
      ]);
    const frozenRead = vi.mocked(
      KeywordsRepository.prototype.listDiagnosticEligible,
    );

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(candidates).toHaveBeenCalledWith(
      { workspaceId: IDS.workspace, projectId: IDS.project },
      { limit: expect.any(Number) },
    );
    expect(approvals).toHaveBeenCalledWith(
      { workspaceId: IDS.workspace, projectId: IDS.project },
      [
        {
          keywordId: IDS.keyword,
          expectedGovernanceRevision: 0,
          clusterKey: "customer onboarding",
          mappingDecision: "unassigned",
          mappedSitePageId: null,
          reason: expect.stringContaining("auto_keyword_governance.v1"),
        },
      ],
    );
    // The freeze must observe the approvals this run just produced.
    expect(approvals).toHaveBeenCalledBefore(frozenRead);
  });

  it("still freezes and creates the Growth Audit when automated governance throws", async () => {
    // Governance is a supplement, not a precondition. Every other failure in
    // this step takes the safe path, so a governance defect must not be the one
    // way an entire diagnostic is destroyed: the library simply stays at the
    // governance it already had.
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    const logged = vi.spyOn(harness.ctx.logger, "error");
    vi.mocked(
      KeywordsRepository.prototype.listAutoGovernanceCandidates,
    ).mockRejectedValue(
      new KeywordGovernanceIntegrityError("CURRENT_DECISION_MISSING"),
    );
    const frozenRead = vi.mocked(
      KeywordsRepository.prototype.listDiagnosticEligible,
    );

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(frozenRead).toHaveBeenCalled();
    expect(DiagnosticRunsRepository.prototype.insert).toHaveBeenCalledTimes(1);
    expect(AuditRunsRepository.prototype.create).toHaveBeenCalledTimes(1);
    expect(harness.state.steps[5]).toMatchObject({ state: "running" });
    // The failure is reported, never swallowed.
    expect(logged).toHaveBeenCalledWith(
      "analysis_refresh_auto_keyword_governance_failed",
      expect.objectContaining({
        code: "AUTO_KEYWORD_GOVERNANCE_CURRENT_DECISION_MISSING",
        limitation: expect.stringContaining("no decision"),
      }),
    );
  });

  it("terminalizes once when the bounded governance freeze is unusable after the optional Topic step", async () => {
    const harness = createHarness({ v3Plan: true });
    installReadyTopicPlan(harness);
    vi.mocked(
      KeywordsRepository.prototype.listDiagnosticEligible,
    ).mockRejectedValue(
      new DiagnosticGovernanceCapacityError("more than 10000 refs"),
    );

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      step_key: "topic_model",
      state: "failed",
      error: { code: "ANALYSIS_REFRESH_TOPIC_MODEL_INPUT_INVALID" },
    });
    expect(harness.state.steps[6]).toMatchObject({
      step_key: "growth_audit",
      state: "pending",
    });
    expect(harness.state.parentStatus).toBe("queued");
    const continuationCount = harness.send.mock.calls.filter(
      ([queue]) => queue === "refresh.analysis",
    ).length;
    expect(continuationCount).toBe(1);

    await expect(
      runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW }),
    ).resolves.toBeUndefined();

    expect(harness.state.steps[6]).toMatchObject({
      step_key: "growth_audit",
      state: "failed",
      error: { code: "ANALYSIS_REFRESH_AUDIT_UNUSABLE" },
    });
    expect(harness.state.parentStatus).toBe("failed");
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ runId: IDS.parent }),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "ANALYSIS_REFRESH_AUDIT_UNUSABLE",
      }),
    );
    expect(DiagnosticRunsRepository.prototype.insert).not.toHaveBeenCalled();
    expect(AuditRunsRepository.prototype.create).not.toHaveBeenCalled();
    expect(
      harness.send.mock.calls.filter(
        ([queue]) => queue === "refresh.analysis",
      ),
    ).toHaveLength(continuationCount);
  });

  it("keeps non-cap governance read failures retryable", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    vi.mocked(
      KeywordsRepository.prototype.listDiagnosticEligible,
    ).mockRejectedValue(new Error("database read unavailable"));

    await expect(
      runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW }),
    ).rejects.toThrow("database read unavailable");

    expect(harness.state.steps[5]).toMatchObject({
      step_key: "growth_audit",
      state: "pending",
    });
    expect(harness.state.parentStatus).toBe("queued");
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(DiagnosticRunsRepository.prototype.insert).not.toHaveBeenCalled();
  });

  it("keeps unrelated governance RangeErrors retryable", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    vi.mocked(
      KeywordsRepository.prototype.listDiagnosticEligible,
    ).mockRejectedValue(new RangeError("repository argument is malformed"));

    await expect(
      runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW }),
    ).rejects.toThrow("repository argument is malformed");

    expect(harness.state.steps[5]).toMatchObject({
      step_key: "growth_audit",
      state: "pending",
    });
    expect(harness.state.parentStatus).toBe("queued");
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(DiagnosticRunsRepository.prototype.insert).not.toHaveBeenCalled();
  });

  it("writes no automated keyword decision when the rollout flag is off", async () => {
    vi.stubEnv("KEYWORD_AUTO_GOVERNANCE_ENABLED", "false");
    try {
      const harness = createHarness();
      installCompletedCollectionPlan(harness);
      const approvals = vi.spyOn(
        KeywordGovernanceRepository.prototype,
        "applySystemApprovals",
      );

      await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

      expect(
        KeywordsRepository.prototype.listAutoGovernanceCandidates,
      ).not.toHaveBeenCalled();
      expect(approvals).not.toHaveBeenCalled();
      expect(
        DiagnosticRunsRepository.prototype.insert,
      ).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("resumes a completed historical DataForSEO Search Landscape v1 step into Growth Audit", async () => {
    const harness = createHarness({ legacyPlan: true });
    const connection = sourceConnection("dataforseo");
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
      step("dataforseo", 4, false, {
        state: "completed",
        childId: IDS.gscChild,
        snapshotId: IDS.dataForSeoSnapshot,
      }),
      step("growth_audit", 5, true),
    ];
    harness.state.snapshots.set(IDS.crawlSnapshot, crawlSnapshot());
    harness.state.snapshots.set(
      IDS.dataForSeoSnapshot,
      dataForSeoSnapshot(
        IDS.gscChild,
        connection.id,
        "dataforseo.search_landscape.v1",
      ),
    );

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    const diagnosticInsert = vi.mocked(
      DiagnosticRunsRepository.prototype.insert,
    );
    expect(diagnosticInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        inputManifest: expect.objectContaining({
          snapshots: [
            expect.objectContaining({ snapshotId: IDS.crawlSnapshot }),
            expect.objectContaining({ snapshotId: IDS.dataForSeoSnapshot }),
          ],
        }),
      }),
    );
    expect(harness.state.steps[4]).toMatchObject({
      step_key: "growth_audit",
      state: "running",
      child_async_run_id: expect.any(String),
    });
  });

  it("keeps the dedicated backlink Snapshot out of the Growth Audit diagnostic input", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    const backlinkConnection = sourceConnection("dataforseo");
    harness.state.steps[4] = step("dataforseo_backlinks", 5, false, {
      state: "completed",
      childId: IDS.external,
      snapshotId: IDS.dataForSeoBacklinksSnapshot,
    });
    harness.state.snapshots.set(
      IDS.dataForSeoBacklinksSnapshot,
      dataForSeoBacklinksSnapshot(IDS.external, backlinkConnection.id),
    );

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    const diagnosticInsert = vi.mocked(
      DiagnosticRunsRepository.prototype.insert,
    );
    const inputManifest = diagnosticInsert.mock.calls[0]?.[0]
      .inputManifest as { readonly snapshots?: readonly { readonly snapshotId: string }[] };
    expect(inputManifest.snapshots).toEqual([
      expect.objectContaining({ snapshotId: IDS.crawlSnapshot }),
    ]);
  });

  it("fails closed when the exact pinned Profile id no longer matches the parent payload", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    vi.mocked(IcpProfilesRepository.prototype.findById).mockResolvedValue(
      profileRow({ id: IDS.external }),
    );

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      state: "failed",
      error: { code: "ANALYSIS_REFRESH_AUDIT_UNUSABLE" },
    });
    expect(DiagnosticRunsRepository.prototype.insert).not.toHaveBeenCalled();
  });

  it("fails closed instead of substituting another Site for the pinned Site", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    vi.mocked(SitesRepository.prototype.findById).mockResolvedValue({
      ...siteRow(),
      id: IDS.external,
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
      state: "failed",
      error: { code: "ANALYSIS_REFRESH_AUDIT_UNUSABLE" },
    });
    expect(DiagnosticRunsRepository.prototype.insert).not.toHaveBeenCalled();
  });

  it("refuses a completed step whose frozen Snapshot belongs to another collection child", async () => {
    const harness = createHarness();
    installCompletedCollectionPlan(harness);
    harness.state.snapshots.set(IDS.crawlSnapshot, {
      ...crawlSnapshot(),
      collection_run_id: "00000000-0000-4000-8000-000000000098",
    });

    await runAnalysisRefresh(harness.ctx, JOB, { now: () => NOW });

    expect(harness.state.steps[5]).toMatchObject({
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
    const scheduleSuggestions = vi.fn(async () => {
      throw new Error("suggestion scheduler unavailable");
    });
    installCompletedCollectionPlan(harness);
    harness.state.steps[5] = step("growth_audit", 6, true, {
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
      projection_version: "growth-audit.0.3.1",
      created_at: NOW.toISOString(),
    });

    await expect(
      runAnalysisRefresh(harness.ctx, JOB, {
        now: () => NOW,
        scheduleKeywordGovernanceSuggestions: scheduleSuggestions,
      }),
    ).resolves.toBeUndefined();

    expect(harness.state.steps[5]?.state).toBe("completed");
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
    expect(scheduleSuggestions).toHaveBeenCalledWith(
      { db: harness.ctx.db, boss: harness.ctx.boss },
      {
        scope: { workspaceId: IDS.workspace, projectId: IDS.project },
        initiatedBy: IDS.actor,
      },
    );
  });

  it("does not resignal suggestions when a terminal parent was not claimed by this delivery", async () => {
    const harness = createHarness();
    harness.state.parentStatus = "partial";
    const scheduleSuggestions = vi.fn();

    await expect(
      runAnalysisRefresh(harness.ctx, JOB, {
        now: () => NOW,
        scheduleKeywordGovernanceSuggestions: scheduleSuggestions,
      }),
    ).resolves.toBeUndefined();

    expect(scheduleSuggestions).not.toHaveBeenCalled();
  });
});

interface HarnessState {
  steps: AnalysisRefreshStepRow[];
  children: Map<string, AsyncRunRow>;
  generationRuns: Map<string, TopicModelGenerationRunRow>;
  collections: Map<string, CollectionRunRow>;
  snapshots: Map<string, DataSnapshotRow>;
  auditChildren: Map<string, Awaited<ReturnType<AuditRunsRepository["findByDiagnosticRunId"]>>>;
  stage: string;
  /** Parent canonical run status; the claim mutates it so rollback is observable. */
  parentStatus: "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
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
  readonly legacyPlan?: boolean;
  readonly v3Plan?: boolean;
} = {}): Harness {
  const state: HarnessState = {
    steps: options.legacyPlan
      ? [
          step("crawl", 1, true),
          step("gsc", 2, false),
          step("ga4", 3, false),
          step("dataforseo", 4, false),
          step("growth_audit", 5, true),
        ]
      : options.v3Plan
        ? [
            step("crawl", 1, true),
            step("gsc", 2, false),
            step("ga4", 3, false),
            step("dataforseo", 4, false),
            step("dataforseo_backlinks", 5, false),
            step("topic_model", 6, false),
            step("growth_audit", 7, true),
          ]
        : [
          step("crawl", 1, true),
          step("gsc", 2, false),
          step("ga4", 3, false),
          step("dataforseo", 4, false),
          step("dataforseo_backlinks", 5, false),
          step("growth_audit", 6, true),
        ],
    parentStatus: "queued",
    children: new Map(),
    generationRuns: new Map(),
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
    requestPayload:
      options.requestPayload ??
      (options.legacyPlan ? LEGACY_REQUEST_PAYLOAD : REQUEST_PAYLOAD),
    resultType: "analysis_refresh_run",
    resultId: IDS.parent,
  });
  const parentProjection = {
    id: IDS.parent,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    site_id: IDS.site,
    icp_profile_id: IDS.profile,
    plan_manifest: options.legacyPlan
      ? LEGACY_PLAN_MANIFEST
      : options.v3Plan
        ? V3_PLAN_MANIFEST
        : CURRENT_PLAN_MANIFEST,
    plan_hash: options.legacyPlan
      ? LEGACY_PLAN_HASH
      : options.v3Plan
        ? V3_PLAN_HASH
        : CURRENT_PLAN_HASH,
    created_at: NOW.toISOString(),
  };
  const site = siteRow();
  const crawlConnection = sourceConnection();
  const project = projectRow();

  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockImplementation(
    async () => {
      if (state.parentStatus !== "queued") return null;
      state.parentStatus = "running";
      return parentRun;
    },
  );
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
        ...(values.resultType === undefined
          ? {}
          : { resultType: values.resultType }),
        ...(values.resultId === undefined ? {} : { resultId: values.resultId }),
      });
      state.children.set(id, child);
      return child;
    },
  );
  vi.spyOn(AsyncRunsRepository.prototype, "findById").mockImplementation(
    async (_scope, id) =>
      id === IDS.parent
        ? {
            ...parentRun,
            status: state.parentStatus,
            completed_at:
              state.parentStatus === "queued" || state.parentStatus === "running"
                ? null
                : NOW.toISOString(),
          }
        : state.children.get(id) ?? null,
  );
  vi.spyOn(AsyncRunsRepository.prototype, "setProgress").mockResolvedValue(true);
  vi.spyOn(AsyncRunsRepository.prototype, "resetToQueued").mockImplementation(
    async () => {
      state.parentStatus = "queued";
      return true;
    },
  );
  vi.spyOn(AsyncRunsRepository.prototype, "setTerminal").mockImplementation(
    async (_attempt, values) => {
      state.parentStatus = values.status;
      return true;
    },
  );

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
  vi.spyOn(TopicModelsRepository.prototype, "getLatestConfirmed").mockResolvedValue(
    null,
  );
  vi.spyOn(TopicModelsRepository.prototype, "getDraft").mockResolvedValue(null);
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
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(
    profileRow(),
  );
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
  vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([]);

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

  vi.spyOn(
    TopicModelGenerationRunsRepository.prototype,
    "insertPlaceholder",
  ).mockImplementation(async (values) => {
    const manifest = parseTopicModelGenerationInputManifest(
      values.inputManifest,
    );
    const row: TopicModelGenerationRunRow = {
      id: values.runId,
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      analysis_refresh_run_id: values.analysisRefreshRunId,
      generation_version: values.generationVersion,
      prompt_set_version: values.promptSetVersion,
      input_manifest: manifest,
      input_hash: values.inputHash,
      prompt_input_hash: null,
      result_topic_model_revision_id: null,
      created_at: NOW.toISOString(),
    };
    state.generationRuns.set(row.id, row);
    return row;
  });
  vi.spyOn(
    TopicModelGenerationRunsRepository.prototype,
    "findById",
  ).mockImplementation(
    async (_scope, id) => state.generationRuns.get(id) ?? null,
  );

  vi.spyOn(KeywordsRepository.prototype, "listDiagnosticEligible").mockResolvedValue(
    [],
  );
  vi.spyOn(
    KeywordsRepository.prototype,
    "listAutoGovernanceCandidates",
  ).mockResolvedValue([]);
  vi.spyOn(
    KeywordsRepository.prototype,
    "readDiagnosticGovernanceLoad",
  ).mockResolvedValue({ eligibleEntities: 0, occurrenceRefs: 0 });
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
    step("dataforseo_backlinks", 5, false),
    step("growth_audit", 6, true),
  ];
  harness.state.snapshots.set(IDS.crawlSnapshot, crawlSnapshot());
}

function installReadyTopicPlan(
  harness: Harness,
  options: { readonly dataForSeoCompleted?: boolean } = {},
): void {
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
    options.dataForSeoCompleted
      ? step("dataforseo", 4, false, {
          state: "completed",
          childId: IDS.gscChild,
          snapshotId: IDS.dataForSeoSnapshot,
        })
      : step("dataforseo", 4, false, {
          state: "skipped",
          skipReason: "feature_disabled",
        }),
    step("dataforseo_backlinks", 5, false, {
      state: "skipped",
      skipReason: "feature_disabled",
    }),
    step("topic_model", 6, false),
    step("growth_audit", 7, true),
  ];
  harness.state.snapshots.set(IDS.crawlSnapshot, crawlSnapshot());
  if (options.dataForSeoCompleted) {
    harness.state.snapshots.set(
      IDS.dataForSeoSnapshot,
      dataForSeoSnapshot(
        IDS.gscChild,
        sourceConnection("dataforseo").id,
      ),
    );
  }
}

function installRunningTopicChild(
  harness: Harness,
  status: "completed" | "failed" | "cancelled",
): void {
  installReadyTopicPlan(harness);
  harness.state.steps[5] = step("topic_model", 6, false, {
    state: "running",
    childId: IDS.topicGenerationChild,
  });
  harness.state.children.set(
    IDS.topicGenerationChild,
    asyncRun({
      id: IDS.topicGenerationChild,
      kind: "topic_model_generation",
      activeKey: "topic-model:generation",
      status,
      resultType: "topic_model_generation_run",
      resultId: IDS.topicGenerationChild,
    }),
  );
  const manifest = topicGenerationManifest();
  harness.state.generationRuns.set(IDS.topicGenerationChild, {
    id: IDS.topicGenerationChild,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    analysis_refresh_run_id: IDS.parent,
    generation_version: "topic-model-generation.v1",
    prompt_set_version: "topic-model.prompt.v1",
    input_manifest: manifest,
    input_hash: contentHash(manifest),
    prompt_input_hash: "b".repeat(64),
    result_topic_model_revision_id:
      status === "completed" ? IDS.topicModelRevision : null,
    created_at: NOW.toISOString(),
  });
}

function prepareDataForSeoBacklinksStep(harness: Harness): void {
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
    step("dataforseo", 4, false, {
      state: "skipped",
      skipReason: "feature_disabled",
    }),
    step("dataforseo_backlinks", 5, false),
    step("growth_audit", 6, true),
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
    step("dataforseo_backlinks", 5, false, {
      state: "skipped",
      skipReason: "feature_disabled",
    }),
    step("growth_audit", 6, true),
  ];
  harness.state.snapshots.set(IDS.crawlSnapshot, crawlSnapshot());
}

function cloneState(state: HarnessState): HarnessState {
  return {
    steps: structuredClone(state.steps),
    children: new Map(
      [...state.children].map(([id, row]) => [id, structuredClone(row)]),
    ),
    generationRuns: new Map(
      [...state.generationRuns].map(([id, row]) => [id, structuredClone(row)]),
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
    parentStatus: state.parentStatus,
  };
}

function restoreState(target: HarnessState, source: HarnessState): void {
  target.steps = source.steps;
  target.children = source.children;
  target.generationRuns = source.generationRuns;
  target.collections = source.collections;
  target.snapshots = source.snapshots;
  target.auditChildren = source.auditChildren;
  target.stage = source.stage;
  target.parentStatus = source.parentStatus;
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

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.profile,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    version: 3,
    status: "complete",
    profile: LEGACY_PROFILE,
    content_hash: "a".repeat(64),
    created_by: IDS.actor,
    created_at: NOW.toISOString(),
    ...overrides,
  } as never;
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
  version = "dataforseo.search_landscape.v2",
): DataSnapshotRow {
  return {
    ...crawlSnapshot(),
    id: IDS.dataForSeoSnapshot,
    collection_run_id: collectionRunId,
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    dataset_key: version,
    schema_version: version,
    method_version: version,
    row_count: 118,
    limitation:
      "Weekly competitor refresh; exact dataset timestamps are unavailable.",
  };
}

function dataForSeoCollectionRun(
  id: string,
  sourceConnectionId: string,
  methodVersion: string,
): CollectionRunRow {
  return {
    ...collectionRun(id),
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    operation: "search_landscape",
    method_version: methodVersion,
  };
}

function dataForSeoBacklinksSnapshot(
  collectionRunId: string,
  sourceConnectionId: string,
): DataSnapshotRow {
  return {
    ...crawlSnapshot(),
    id: IDS.dataForSeoBacklinksSnapshot,
    collection_run_id: collectionRunId,
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    dataset_key: "dataforseo.backlinks.v1",
    schema_version: "dataforseo.backlinks.v1",
    method_version: "dataforseo.backlinks.v1",
    row_count: 42,
    limitation:
      "DataForSEO live backlink index with bounded source-page verification.",
  };
}

function topicKeyword(): KeywordEntityRow {
  return {
    id: IDS.keyword,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    display_keyword: "customer onboarding software",
    normalized_keyword: "customer onboarding software",
    market: "US",
    language_tag: "en-US",
    query_kind: "search_query",
    status: "approved",
    intent: null,
    buyer_stage: null,
    cluster_key: "customer onboarding",
    mapping_decision: "unassigned",
    mapped_site_page_id: null,
    mapping_review_state: "confirmed",
    mapping_revision: 1,
    first_seen_at: NOW.toISOString(),
    last_seen_at: NOW.toISOString(),
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

function topicOccurrence(): KeywordOccurrenceForEntityRow {
  return {
    id: IDS.providerObservation,
    keyword_entity_id: IDS.keyword,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    data_snapshot_id: IDS.dataForSeoSnapshot,
    normalized_observation_id: IDS.providerObservation,
    product_profile_id: null,
    display_keyword: "customer onboarding software",
    normalized_keyword: "customer onboarding software",
    market: "US",
    language_tag: "en-US",
    query_kind: "search_query",
    source_kind: "dataforseo_ranked",
    scope_basis: "provider_collection_scope",
    source_pointer: "/valueJson/keyword",
    source_ref: `observation:${IDS.providerObservation}`,
    collected_at: NOW.toISOString(),
    provider_data_as_of: NOW.toISOString(),
    created_at: NOW.toISOString(),
  };
}

function topicObservation(): ObservationRow {
  return {
    id: IDS.providerObservation,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    snapshot_id: IDS.dataForSeoSnapshot,
    site_page_id: null,
    provider: "dataforseo",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    subject_ref: "customer onboarding",
    observed_at: NOW.toISOString(),
    availability: "available",
    value_numeric: null,
    value_text: null,
    value_json: {
      keyword: "customer onboarding software",
      clusterKey: "customer onboarding",
      searchVolume: 720,
      keywordDifficulty: 37,
      providerSearchIntent: "commercial",
      currentUrl: "https://example.test/customer-onboarding",
      currentRank: 4,
      competitorDomain: null,
      competitorRank: null,
      marketCode: "US",
      languageCode: "en-US",
    },
    unit: null,
    origin: "provider",
    method: "observed",
    grade: "A",
    support: "fixture",
    limitation: "fixture",
  };
}

function topicGenerationManifest(): TopicModelGenerationInputManifest {
  return parseTopicModelGenerationInputManifest({
    schemaVersion: "topic-model-generation-input.v1",
    analysisRefreshRunId: IDS.parent,
    projectId: IDS.project,
    market: "US",
    language: "en-US",
    groups: [
      {
        groupKey: "group-001",
        representativeKeywords: ["customer onboarding software"],
        keywordCount: 1,
        aggregateSearchVolume: null,
        providerIntentDistribution: {
          informational: 0,
          navigational: 0,
          commercial: 0,
          transactional: 0,
        },
        urls: [],
      },
    ],
    productProfile: null,
    icp: null,
    keywords: [
      {
        keywordId: IDS.keyword,
        expectedGovernanceRevision: 1,
        groupKey: "group-001",
        providerSearchIntent: null,
      },
    ],
  });
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
