import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LLMError,
  TOPIC_MODEL_PROMPT_SET_VERSION,
  prepareTopicModelGeneration,
  type AnalysisInvocationRecord,
  type TopicModelGenerationInput,
  type TopicModelGenerationResult,
} from "@sf/artifacts";
import { parseTopicModelGenerationInputManifest } from "@sf/contracts";
import {
  AsyncRunsRepository,
  KeywordGovernanceRepository,
  TopicModelConflictError,
  TopicModelGenerationInvocationAttemptsRepository,
  TopicModelGenerationRunsRepository,
  TopicModelsRepository,
  contentHash,
  toRunAttempt,
  type AsyncRunRow,
  type CanonicalValue,
  type GeneratedTopicAssignmentReport,
  type TopicModelGenerationInvocationAttemptRow,
  type TopicModelGenerationRunRow,
} from "@sf/db";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import {
  buildTopicModelGenerationClientInput,
  runTopicModelGeneration,
} from "./run-topic-model-generation.ts";

const manifest = {
  schemaVersion: "topic-model-generation-input.v1",
  analysisRefreshRunId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  market: "US",
  language: "en",
  groups: [
    {
      groupKey: "group-a",
      representativeKeywords: ["revenue operations"],
      keywordCount: 2,
      aggregateSearchVolume: 100,
      providerIntentDistribution: {
        informational: 0,
        navigational: 0,
        commercial: 1,
        transactional: 0,
      },
      urls: ["https://example.test/revenue"],
    },
    {
      groupKey: "group-b",
      representativeKeywords: ["pipeline reporting"],
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
  productProfile: {
    productName: "Acme",
    oneLiner: "Revenue operations software",
    category: "Software",
    valueProposition: "Connect revenue workflows",
    coreFeatures: ["Workflow automation"],
  },
  icp: {
    targetCompanyOrAudience: "B2B revenue teams",
    buyerRoles: ["VP Revenue"],
    userRoles: ["Revenue operations"],
    useCases: ["Automate handoffs"],
    pains: ["Fragmented workflows"],
    outcomes: ["Faster handoffs"],
  },
  keywords: [
    {
      keywordId: "00000000-0000-4000-8000-000000000003",
      expectedGovernanceRevision: 0,
      groupKey: "group-a",
      providerSearchIntent: {
        value: "commercial",
        snapshotId: "00000000-0000-4000-8000-000000000004",
        observationId: "00000000-0000-4000-8000-000000000005",
        observedAt: "2026-08-09T00:00:00.000Z",
      },
    },
    {
      keywordId: "00000000-0000-4000-8000-000000000006",
      expectedGovernanceRevision: 2,
      groupKey: "group-a",
      providerSearchIntent: {
        value: null,
        snapshotId: "00000000-0000-4000-8000-000000000004",
        observationId: "00000000-0000-4000-8000-000000000007",
        observedAt: "2026-08-09T00:00:00.000Z",
      },
    },
    {
      keywordId: "00000000-0000-4000-8000-000000000008",
      expectedGovernanceRevision: 0,
      groupKey: "group-b",
      providerSearchIntent: null,
    },
  ],
} as const;

describe("Topic Model generation frozen manifest", () => {
  it("keeps an explicit provider null with lineage but excludes all keyword lineage from the prompt", () => {
    const parsed = parseTopicModelGenerationInputManifest(manifest);
    expect(parsed.keywords[1]?.providerSearchIntent).toEqual(
      manifest.keywords[1]?.providerSearchIntent,
    );
    expect(parsed.keywords[2]?.providerSearchIntent).toBeNull();
    expect(parsed.keywords[1]?.providerSearchIntent).not.toBeNull();

    const input = buildTopicModelGenerationClientInput(parsed);
    expect(input).toEqual({
      market: manifest.market,
      language: manifest.language,
      groups: manifest.groups,
      productProfile: manifest.productProfile,
      icp: manifest.icp,
    });
    expect(input).not.toHaveProperty("keywords");
    expect(JSON.stringify(input)).not.toContain(
      manifest.keywords[0]!.keywordId,
    );
    expect(JSON.stringify(input)).not.toContain(
      manifest.keywords[0]!.providerSearchIntent.observationId,
    );
  });

  it("fails closed on extra keys and group/keyword count drift", () => {
    expect(() =>
      parseTopicModelGenerationInputManifest({
        ...manifest,
        actorId: "00000000-0000-4000-8000-000000000008",
      }),
    ).toThrow();
    expect(() =>
      parseTopicModelGenerationInputManifest({
        ...manifest,
        groups: [{ ...manifest.groups[0], keywordCount: 1 }],
      }),
    ).toThrow();
    const keywordWithoutProviderProperty = {
      keywordId: manifest.keywords[2].keywordId,
      expectedGovernanceRevision: 0,
      groupKey: "group-b",
    };
    expect(() =>
      parseTopicModelGenerationInputManifest({
        ...manifest,
        keywords: [
          manifest.keywords[0],
          manifest.keywords[1],
          keywordWithoutProviderProperty,
        ],
      }),
    ).toThrow();
  });
});

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000009",
  run: "00000000-0000-4000-8000-000000000010",
  actor: "00000000-0000-4000-8000-000000000011",
  reservation: "00000000-0000-4000-8000-000000000012",
  invocation: "00000000-0000-4000-8000-000000000013",
  modelRevision: "00000000-0000-4000-8000-000000000014",
  rootTopic: "00000000-0000-4000-8000-000000000015",
  childTopic: "00000000-0000-4000-8000-000000000016",
} as const;
const scope = { workspaceId: IDS.workspace, projectId: manifest.projectId };
const generatedAt = "2026-08-09T01:00:00.000Z";
const parsedManifest = parseTopicModelGenerationInputManifest(manifest);
const providerInput = buildTopicModelGenerationClientInput(manifest);
const promptInputHash = prepareTopicModelGeneration(providerInput).inputHash;
const manifestInputHash = contentHash(manifest as unknown as CanonicalValue);

const run = {
  id: IDS.run,
  workspace_id: IDS.workspace,
  project_id: manifest.projectId,
  kind: "topic_model_generation",
  status: "running",
  active_key: `topic-model:${manifest.analysisRefreshRunId}`,
  contract_version: "2026-08-09",
  request_payload: {},
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: "topic_model_generation_run",
  result_id: IDS.run,
  attempt_count: 1,
  initiated_by: IDS.actor,
  queued_at: generatedAt,
  started_at: generatedAt,
  completed_at: null,
} satisfies AsyncRunRow;
const attempt = toRunAttempt(run);
const ledger = {
  id: IDS.run,
  workspace_id: IDS.workspace,
  project_id: manifest.projectId,
  analysis_refresh_run_id: manifest.analysisRefreshRunId,
  generation_version: "topic-model-generation.v1",
  prompt_set_version: TOPIC_MODEL_PROMPT_SET_VERSION,
  input_manifest: parsedManifest,
  input_hash: manifestInputHash,
  prompt_input_hash: null,
  result_topic_model_revision_id: null,
  created_at: generatedAt,
} satisfies TopicModelGenerationRunRow;

const invocation = {
  task: "topic_model_generation",
  provider: "openai",
  model: "gpt-test",
  promptSetVersion: TOPIC_MODEL_PROMPT_SET_VERSION,
  inputHash: promptInputHash,
  outputHash: "a".repeat(64),
  status: "succeeded",
  inputTokens: 100,
  outputTokens: 40,
  costUsd: null,
  latencyMs: 25,
  errorCode: null,
} satisfies AnalysisInvocationRecord;

const modelResult = {
  rootIntent: {
    kind: "create_root",
    topicKey: "growth",
    label: "Growth",
    description: "Revenue growth topics",
    intentEnvelope: [],
  },
  childIntents: [
    {
      kind: "create_child",
      topicKey: "revenue-operations",
      parentTopicKey: "growth",
      label: "Revenue Operations",
      description: null,
      intentEnvelope: ["informational"],
    },
  ],
  groupAssignments: [
    {
      groupKey: "group-a",
      topicKey: "revenue-operations",
      generatedIntent: "informational",
    },
  ],
  unassignedGroupKeys: ["group-b"],
  invocation,
} satisfies TopicModelGenerationResult;

const reservation = {
  id: IDS.reservation,
  workspace_id: IDS.workspace,
  project_id: manifest.projectId,
  topic_model_generation_run_id: IDS.run,
  ordinal: 1,
  async_attempt_count: 1,
  provider: "openai",
  model: "gpt-test",
  prompt_set_version: TOPIC_MODEL_PROMPT_SET_VERSION,
  input_hash: promptInputHash,
  planned_analysis_invocation_id: IDS.invocation,
  status: "reserved",
  analysis_invocation_id: null,
  terminal_error_code: null,
  reserved_at: generatedAt,
  provider_returned_at: null,
  finalized_at: null,
} satisfies TopicModelGenerationInvocationAttemptRow;
const finalizedReservation = {
  ...reservation,
  status: "succeeded",
  analysis_invocation_id: IDS.invocation,
  provider_returned_at: generatedAt,
  finalized_at: generatedAt,
} satisfies TopicModelGenerationInvocationAttemptRow;

const skipReasons = {
  unknown_group: 1,
  topic_revision_moved: 0,
  topic_node_absent: 0,
  intent_unavailable: 0,
  keyword_absent: 0,
  human_decision_exists: 0,
  revision_moved: 0,
  revision_exhausted: 0,
  ledger_unreadable: 0,
  conflict: 0,
} as const;
const assignmentReport = {
  assignedCount: 2,
  skippedCount: 1,
  skipped: skipReasons,
  outcomes: [
    {
      groupKey: "group-a",
      keywordId: manifest.keywords[0].keywordId,
      applied: true,
      skipped: null,
      governanceRevision: 1,
    },
    {
      groupKey: "group-a",
      keywordId: manifest.keywords[1].keywordId,
      applied: true,
      skipped: null,
      governanceRevision: 3,
    },
    {
      groupKey: "group-b",
      keywordId: manifest.keywords[2].keywordId,
      applied: false,
      skipped: "unknown_group",
      governanceRevision: null,
    },
  ],
} satisfies GeneratedTopicAssignmentReport;

const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
let transactionDepth = 0;
const transaction = vi.fn(
  async (callback: (tx: object) => Promise<unknown>) => {
    transactionDepth += 1;
    try {
      return await callback({});
    } finally {
      transactionDepth -= 1;
    }
  },
);
const ctx = {
  db: { transaction },
  boss: {},
  blobStore: {},
  credentialKey: Buffer.alloc(32),
  appOrigin: "https://app.example.test",
  googleOAuth: { clientId: "test", clientSecret: "test" },
  openai: { apiKey: "test-key", model: "gpt-test" },
  findingSummariesEnabled: false,
  logger,
} as unknown as WorkerContext;

const generateTopicModel = vi.fn(
  async (_input: TopicModelGenerationInput): Promise<TopicModelGenerationResult> =>
    modelResult,
);
const dependencies = {
  createClient: vi.fn(() => ({ generateTopicModel })),
};

beforeEach(() => {
  vi.restoreAllMocks();
  transaction.mockClear();
  transactionDepth = 0;
  generateTopicModel.mockReset().mockImplementation(async () => modelResult);
  dependencies.createClient.mockClear();
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();

  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
  vi.spyOn(
    AsyncRunsRepository.prototype,
    "lockAttemptForUpdate",
  ).mockResolvedValue(run);
  vi.spyOn(AsyncRunsRepository.prototype, "setProgress").mockResolvedValue(true);
  vi.spyOn(AsyncRunsRepository.prototype, "resetToQueued").mockResolvedValue(true);
  vi.spyOn(
    TopicModelGenerationRunsRepository.prototype,
    "findById",
  ).mockResolvedValue(ledger);
  vi.spyOn(
    TopicModelGenerationRunsRepository.prototype,
    "terminalize",
  ).mockResolvedValue({
    kind: "terminalized",
    run: { ...ledger, result_topic_model_revision_id: IDS.modelRevision },
  });
  vi.spyOn(
    TopicModelGenerationInvocationAttemptsRepository.prototype,
    "reserve",
  ).mockResolvedValue({ kind: "reserved", reservation });
  vi.spyOn(
    TopicModelGenerationInvocationAttemptsRepository.prototype,
    "finalizeWithInvocation",
  ).mockResolvedValue({
    kind: "finalized",
    reservation: finalizedReservation,
    invocationId: IDS.invocation,
  });
  vi.spyOn(
    TopicModelGenerationInvocationAttemptsRepository.prototype,
    "markOutcomeUnknown",
  ).mockResolvedValue({
    kind: "marked",
    reservation: {
      ...reservation,
      status: "outcome_unknown",
      terminal_error_code: "PROVIDER_OUTCOME_UNKNOWN",
      provider_returned_at: generatedAt,
      finalized_at: generatedAt,
    },
  });
  vi.spyOn(
    TopicModelsRepository.prototype,
    "materializeSystemConfirmedFirstRevision",
  ).mockResolvedValue({
    topicModelRevisionId: IDS.modelRevision,
    model: { topicModelRevision: 1 } as never,
    topicNodeIdsByKey: {
      growth: IDS.rootTopic,
      "revenue-operations": IDS.childTopic,
    },
  });
  vi.spyOn(
    KeywordGovernanceRepository.prototype,
    "applyGeneratedTopicAssignments",
  ).mockResolvedValue(assignmentReport);
});

describe("runTopicModelGeneration", () => {
  it("calls the provider outside transactions then atomically finalizes, materializes, assigns, records coverage, and terminalizes", async () => {
    const order: string[] = [];
    vi.mocked(
      TopicModelGenerationInvocationAttemptsRepository.prototype.reserve,
    ).mockImplementation(async () => {
      order.push("reserve");
      return { kind: "reserved", reservation };
    });
    generateTopicModel.mockImplementationOnce(async (input) => {
      expect(transactionDepth).toBe(0);
      expect(input).toEqual(providerInput);
      order.push("provider");
      return modelResult;
    });
    vi.mocked(
      TopicModelGenerationInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).mockImplementation(async () => {
      expect(transactionDepth).toBe(1);
      order.push("finalize");
      return {
        kind: "finalized",
        reservation: finalizedReservation,
        invocationId: IDS.invocation,
      };
    });
    vi.mocked(
      TopicModelsRepository.prototype.materializeSystemConfirmedFirstRevision,
    ).mockImplementation(async (_scope, input) => {
      order.push("materialize");
      expect(input).toMatchObject({
        initiatedBy: IDS.actor,
        generationVersion: "topic-model-generation.v1",
        promptSetVersion: TOPIC_MODEL_PROMPT_SET_VERSION,
        inputHash: manifestInputHash,
        analysisInvocationId: IDS.invocation,
        keywordGroupCount: 2,
        keywordCount: 3,
      });
      return {
        topicModelRevisionId: IDS.modelRevision,
        model: { topicModelRevision: 1 } as never,
        topicNodeIdsByKey: {
          growth: IDS.rootTopic,
          "revenue-operations": IDS.childTopic,
        },
      };
    });
    vi.mocked(
      KeywordGovernanceRepository.prototype.applyGeneratedTopicAssignments,
    ).mockImplementation(async (_scope, input) => {
      order.push("assign");
      expect(input.groups).toEqual([
        {
          groupKey: "group-a",
          topicNodeId: IDS.childTopic,
          topicModelRevision: 1,
        },
      ]);
      expect(input.assignments).toEqual([
        {
          groupKey: "group-a",
          keywordId: manifest.keywords[0].keywordId,
          expectedGovernanceRevision: 0,
          resolvedIntent: {
            authority: "provider_observed",
            value: "commercial",
            analysisInvocationId: null,
          },
        },
        {
          groupKey: "group-a",
          keywordId: manifest.keywords[1].keywordId,
          expectedGovernanceRevision: 2,
          resolvedIntent: {
            authority: "llm_generated",
            value: "informational",
            analysisInvocationId: IDS.invocation,
          },
        },
        {
          groupKey: "group-b",
          keywordId: manifest.keywords[2].keywordId,
          expectedGovernanceRevision: 0,
          resolvedIntent: null,
        },
      ]);
      return assignmentReport;
    });
    vi.mocked(AsyncRunsRepository.prototype.setProgress).mockImplementation(
      async (_attempt, progress) => {
        order.push("progress");
        expect(progress).toEqual({
          schemaVersion: "topic-model-generation-outcome.v1",
          keywordGroupCount: 2,
          keywordCount: 3,
          assignedCount: 2,
          skippedCount: 1,
          unassignedGroupCount: 1,
          skipReasons,
          limitations: [
            "keyword_assignments_skipped",
            "topic_groups_unassigned",
          ],
        });
        return true;
      },
    );
    vi.mocked(
      TopicModelGenerationRunsRepository.prototype.terminalize,
    ).mockImplementation(async (_attempt, input) => {
      order.push("terminalize");
      expect(input).toEqual({
        status: "completed",
        resultTopicModelRevisionId: IDS.modelRevision,
        lastErrorCode: null,
        lastErrorSummary: null,
      });
      return {
        kind: "terminalized",
        run: { ...ledger, result_topic_model_revision_id: IDS.modelRevision },
      };
    });

    await runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(order).toEqual([
      "reserve",
      "provider",
      "finalize",
      "materialize",
      "assign",
      "progress",
      "terminalize",
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("does not claim or call the provider for a payload with extra keys", async () => {
    await runTopicModelGeneration(
      ctx,
      { runId: IDS.run, ...scope, actorId: IDS.actor },
      dependencies,
    );
    expect(AsyncRunsRepository.prototype.claim).not.toHaveBeenCalled();
    expect(generateTopicModel).not.toHaveBeenCalled();
  });

  it("maps a late draft conflict to a committed safe no-op after recording the invocation", async () => {
    vi.mocked(
      TopicModelsRepository.prototype.materializeSystemConfirmedFirstRevision,
    ).mockRejectedValueOnce(new TopicModelConflictError("DRAFT_EXISTS", 0, 1));

    await runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(
      TopicModelGenerationInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).toHaveBeenCalledOnce();
    expect(
      KeywordGovernanceRepository.prototype.applyGeneratedTopicAssignments,
    ).not.toHaveBeenCalled();
    expect(
      TopicModelGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "cancelled",
      resultTopicModelRevisionId: null,
      lastErrorCode: "TOPIC_MODEL_GENERATION_SUPERSEDED",
      lastErrorSummary: "Topic Model generation was superseded.",
    });
    expect(
      TopicModelGenerationInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).not.toHaveBeenCalled();
  });

  it("marks an unknown provider outcome and never replays an existing reservation", async () => {
    generateTopicModel.mockRejectedValueOnce(new Error("opaque provider failure"));

    await runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(
      TopicModelGenerationInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "PROVIDER_OUTCOME_UNKNOWN",
    );
    expect(
      TopicModelGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultTopicModelRevisionId: null,
      lastErrorCode: "TOPIC_MODEL_GENERATION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary:
        "The provider invocation outcome could not be safely recovered.",
    });
    expect(
      TopicModelsRepository.prototype.materializeSystemConfirmedFirstRevision,
    ).not.toHaveBeenCalled();

    vi.mocked(
      TopicModelGenerationInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({
      kind: "existing",
      reservation: {
        ...reservation,
        status: "outcome_unknown",
        terminal_error_code: "PROVIDER_OUTCOME_UNKNOWN",
      },
    });
    await runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies);
    expect(generateTopicModel).toHaveBeenCalledTimes(1);
  });

  it("persists a rejected invocation but writes no Topic or assignments", async () => {
    const order: string[] = [];
    const rejectedInvocation = {
      ...invocation,
      outputHash: null,
      status: "rejected",
      errorCode: "SCHEMA_INVALID",
    } satisfies AnalysisInvocationRecord;
    generateTopicModel.mockRejectedValueOnce(
      new LLMError(
        "SCHEMA_INVALID",
        "rejected",
        rejectedInvocation,
        "root:invalid_type",
      ),
    );
    vi.mocked(
      TopicModelGenerationInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).mockImplementationOnce(async () => {
      expect(transactionDepth).toBe(1);
      order.push("finalize");
      return {
        kind: "finalized",
        reservation: { ...finalizedReservation, status: "rejected" },
        invocationId: IDS.invocation,
      };
    });
    vi.mocked(
      TopicModelGenerationRunsRepository.prototype.terminalize,
    ).mockImplementationOnce(async () => {
      expect(transactionDepth).toBe(1);
      order.push("terminalize");
      return { kind: "terminalized", run: ledger };
    });

    await runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(
      TopicModelGenerationInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      expect.objectContaining({ status: "rejected", outputHash: null }),
    );
    expect(
      TopicModelsRepository.prototype.materializeSystemConfirmedFirstRevision,
    ).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceRepository.prototype.applyGeneratedTopicAssignments,
    ).not.toHaveBeenCalled();
    expect(order).toEqual(["finalize", "terminalize"]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("rolls back a post-provider commit failure, marks the reservation unknown, and writes no success terminal", async () => {
    vi.mocked(
      KeywordGovernanceRepository.prototype.applyGeneratedTopicAssignments,
    ).mockRejectedValueOnce(new Error("assignment transaction failed"));

    await runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(
      TopicModelGenerationInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN",
    );
    expect(
      TopicModelGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenLastCalledWith(attempt, {
      status: "failed",
      resultTopicModelRevisionId: null,
      lastErrorCode: "TOPIC_MODEL_GENERATION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary:
        "The provider invocation outcome could not be safely recovered.",
    });
  });

  it("fails closed when a fake client returns no validated result envelope", async () => {
    generateTopicModel.mockResolvedValueOnce(null as never);

    await expect(
      runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies),
    ).resolves.toBeUndefined();

    expect(
      TopicModelGenerationInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "INVOCATION_IDENTITY_MISMATCH",
    );
    expect(
      TopicModelGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultTopicModelRevisionId: null,
      lastErrorCode: "TOPIC_MODEL_GENERATION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary:
        "The provider invocation outcome could not be safely recovered.",
    });
    expect(
      TopicModelsRepository.prototype.materializeSystemConfirmedFirstRevision,
    ).not.toHaveBeenCalled();
  });

  it("schema-validates a malformed candidate invocation without throwing or exposing it", async () => {
    const malformed = {
      ...modelResult,
      invocation: {
        ...invocation,
        model: "wrong-model",
        rawProviderOutput: "must-not-escape",
      },
    };
    generateTopicModel.mockResolvedValueOnce(malformed as never);

    await expect(
      runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies),
    ).resolves.toBeUndefined();

    expect(
      TopicModelGenerationInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "INVOCATION_IDENTITY_MISMATCH",
    );
    expect(
      TopicModelsRepository.prototype.materializeSystemConfirmedFirstRevision,
    ).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      "must-not-escape",
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      "must-not-escape",
    );
  });

  it("rejects a provider-authored initiator before Topic materialization", async () => {
    generateTopicModel.mockResolvedValueOnce({
      ...modelResult,
      initiatedBy: IDS.rootTopic,
    } as never);

    await runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(
      TopicModelsRepository.prototype.materializeSystemConfirmedFirstRevision,
    ).not.toHaveBeenCalled();
    expect(
      TopicModelGenerationInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(
      TopicModelGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultTopicModelRevisionId: null,
      lastErrorCode: "TOPIC_MODEL_GENERATION_RESULT_INVALID",
      lastErrorSummary: "Topic Model generation failed.",
    });
  });

  it("never calls the provider for an unresolved earlier attempt", async () => {
    vi.mocked(
      TopicModelGenerationInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({ kind: "unresolved", reservation });

    await runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(generateTopicModel).not.toHaveBeenCalled();
    expect(
      TopicModelGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultTopicModelRevisionId: null,
      lastErrorCode: "TOPIC_MODEL_GENERATION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary:
        "The provider invocation outcome could not be safely recovered.",
    });
  });

  it("records a typed transient failed invocation before resetting the exact attempt for retry", async () => {
    const order: string[] = [];
    const failedInvocation = {
      ...invocation,
      outputHash: null,
      status: "failed",
      errorCode: "TIMEOUT",
    } satisfies AnalysisInvocationRecord;
    const error = new LLMError("TIMEOUT", "provider timeout", failedInvocation);
    generateTopicModel.mockRejectedValueOnce(error);
    vi.mocked(
      TopicModelGenerationInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).mockImplementationOnce(async () => {
      expect(transactionDepth).toBe(1);
      order.push("finalize");
      return {
        kind: "finalized",
        reservation: { ...finalizedReservation, status: "failed" },
        invocationId: IDS.invocation,
      };
    });
    vi.mocked(AsyncRunsRepository.prototype.resetToQueued).mockImplementationOnce(
      async () => {
        expect(transactionDepth).toBe(1);
        order.push("reset");
        return true;
      },
    );

    await expect(
      runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies),
    ).rejects.toBe(error);

    expect(
      TopicModelGenerationInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      expect.objectContaining({ status: "failed", errorCode: "TIMEOUT" }),
    );
    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      attempt,
      {
        code: "TIMEOUT",
        summary: "Topic Model generation will be retried.",
      },
    );
    expect(
      TopicModelsRepository.prototype.materializeSystemConfirmedFirstRevision,
    ).not.toHaveBeenCalled();
    expect(order).toEqual(["finalize", "reset"]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a frozen manifest with extra authority fields before client construction", async () => {
    const malformed = { ...manifest, actorId: IDS.actor };
    vi.mocked(
      TopicModelGenerationRunsRepository.prototype.findById,
    ).mockResolvedValueOnce({
      ...ledger,
      input_manifest: malformed as never,
      input_hash: contentHash(malformed as unknown as CanonicalValue),
    });

    await runTopicModelGeneration(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(generateTopicModel).not.toHaveBeenCalled();
    expect(
      TopicModelGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultTopicModelRevisionId: null,
      lastErrorCode: "TOPIC_MODEL_GENERATION_INPUT_INVALID",
      lastErrorSummary: "Topic Model generation failed.",
    });
  });
});
