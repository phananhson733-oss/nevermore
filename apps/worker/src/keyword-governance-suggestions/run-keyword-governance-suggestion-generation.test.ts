import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
  LLMError,
  prepareKeywordGovernanceSuggestionGeneration,
  type AnalysisInvocationRecord,
  type KeywordGovernanceSuggestionClientOptions,
  type KeywordGovernanceSuggestionGenerationResult,
} from "@sf/artifacts";
import type { KeywordGovernanceSuggestionInputManifest } from "@sf/contracts";
import {
  AsyncRunsRepository,
  KeywordGovernanceSuggestionGenerationRunsRepository,
  KeywordGovernanceSuggestionInvocationAttemptsRepository,
  KeywordReviewSuggestionsRepository,
  contentHash,
  toRunAttempt,
  type AsyncRunRow,
  type CanonicalValue,
  type KeywordGovernanceSuggestionGenerationRunRow,
  type KeywordGovernanceSuggestionInvocationAttemptRow,
} from "@sf/db";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import { runKeywordGovernanceSuggestionGeneration } from "./run-keyword-governance-suggestion-generation.ts";

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  run: "00000000-0000-4000-8000-000000000003",
  actor: "00000000-0000-4000-8000-000000000004",
  profile: "00000000-0000-4000-8000-000000000005",
  topicRevision: "00000000-0000-4000-8000-000000000006",
  topicA: "00000000-0000-4000-8000-000000000007",
  topicB: "00000000-0000-4000-8000-000000000008",
  pageA: "00000000-0000-4000-8000-000000000009",
  keywordA: "00000000-0000-4000-8000-00000000000a",
  keywordB: "00000000-0000-4000-8000-00000000000b",
  occurrenceA: "00000000-0000-4000-8000-00000000000c",
  occurrenceB: "00000000-0000-4000-8000-00000000000d",
  snapshot: "00000000-0000-4000-8000-00000000000e",
  observation: "00000000-0000-4000-8000-00000000000f",
  reservation: "00000000-0000-4000-8000-000000000010",
  invocation: "00000000-0000-4000-8000-000000000011",
  suggestionA: "00000000-0000-4000-8000-000000000012",
  suggestionB: "00000000-0000-4000-8000-000000000013",
} as const;

const GENERATED_AT = "2026-08-10T01:00:00.000Z";
const manifest: KeywordGovernanceSuggestionInputManifest = {
  schemaVersion: "keyword-governance-suggestion-input.v1",
  generationVersion: "keyword-governance-suggestion-generation.v1",
  promptSetVersion: KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
  workspaceId: IDS.workspace,
  projectId: IDS.project,
  marketCode: "US",
  languageTag: "en-US",
  confirmedProductProfile: {
    productProfileId: IDS.profile,
    version: 2,
    contentHash: "a".repeat(64),
    facts: {
      productName: "RelayOps",
      category: "Lifecycle automation",
      valueProposition: "Turn customer signals into actions.",
      targetAudience: "B2B SaaS teams",
      buyerRoles: ["VP Customer Success"],
      pains: ["Fragmented onboarding"],
      outcomes: ["Faster activation"],
    },
  },
  confirmedTopicModel: {
    topicModelRevisionId: IDS.topicRevision,
    revision: 7,
    contentHash: "b".repeat(64),
  },
  topicAllowlist: [
    {
      topicKey: "topic-1",
      topicNodeId: IDS.topicA,
      topicModelRevision: 7,
      label: "Activation",
    },
    {
      topicKey: "topic-2",
      topicNodeId: IDS.topicB,
      topicModelRevision: 7,
      label: "Retention",
    },
  ],
  pageAllowlist: [
    {
      pageKey: "page-1",
      sitePageId: IDS.pageA,
      normalizedUrl: "https://relayops.example/activation",
      title: "Activation",
    },
  ],
  candidates: [
    {
      ordinal: 1,
      keywordKey: "keyword-1",
      keywordId: IDS.keywordA,
      queryKind: "search_query",
      expectedGovernanceRevision: 4,
      displayKeyword: "activation automation",
      normalizedKeyword: "activation automation",
      deterministicEvidence: {
        sourceOccurrenceIds: [IDS.occurrenceA],
        providerSearchIntent: {
          value: "commercial",
          snapshotId: IDS.snapshot,
          observationId: IDS.observation,
          observedAt: "2026-08-10T00:30:00.000Z",
        },
        currentTopicKey: "topic-1",
        currentPageKey: "page-1",
      },
    },
    {
      ordinal: 2,
      keywordKey: "keyword-2",
      keywordId: IDS.keywordB,
      queryKind: "search_query",
      expectedGovernanceRevision: 0,
      displayKeyword: "reduce churn",
      normalizedKeyword: "reduce churn",
      deterministicEvidence: {
        sourceOccurrenceIds: [IDS.occurrenceB],
        providerSearchIntent: null,
        currentTopicKey: null,
        currentPageKey: null,
      },
    },
  ],
};

const manifestInputHash = contentHash(manifest as unknown as CanonicalValue);
const promptInputHash =
  prepareKeywordGovernanceSuggestionGeneration(manifest).inputHash;
const run = {
  id: IDS.run,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  kind: "keyword_governance_suggestion_generation",
  status: "running",
  active_key: "keyword-governance-suggestion:generation",
  contract_version: "2026-08-10",
  request_payload: {},
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: "keyword_governance_suggestion_generation_run",
  result_id: IDS.run,
  attempt_count: 1,
  initiated_by: IDS.actor,
  queued_at: GENERATED_AT,
  started_at: GENERATED_AT,
  completed_at: null,
} satisfies AsyncRunRow;
const attempt = toRunAttempt(run);
const ledger = {
  id: IDS.run,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  generation_version: "keyword-governance-suggestion-generation.v1",
  prompt_set_version: KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
  input_manifest: manifest,
  input_hash: manifestInputHash,
  prompt_input_hash: null,
  result_output_hash: null,
  created_at: GENERATED_AT,
} satisfies KeywordGovernanceSuggestionGenerationRunRow;

const invocation = {
  task: "keyword_governance_suggestion_generation",
  provider: "openai",
  model: "gpt-test",
  promptSetVersion: KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
  inputHash: promptInputHash,
  outputHash: "c".repeat(64),
  status: "succeeded",
  inputTokens: 100,
  outputTokens: 40,
  costUsd: null,
  latencyMs: 25,
  errorCode: null,
} satisfies AnalysisInvocationRecord;

const modelResult = {
  output: {
    schemaVersion: "keyword-governance-suggestion-output.v1",
    suggestions: [
      {
        keywordKey: "keyword-2",
        status: "approved",
        intent: "informational",
        buyerStage: "awareness",
        topicKey: "topic-2",
        mappingDecision: "new_asset",
        pageKey: null,
        reason: "A dedicated retention asset fits the confirmed Topic.",
      },
      {
        keywordKey: "keyword-1",
        status: "approved",
        intent: null,
        buyerStage: "decision",
        topicKey: "topic-2",
        mappingDecision: "existing_page",
        pageKey: "page-1",
        reason: "Existing owned Page authority is already exact.",
      },
    ],
  },
  invocation,
} satisfies KeywordGovernanceSuggestionGenerationResult;

const reservation = {
  id: IDS.reservation,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  generation_run_id: IDS.run,
  ordinal: 1,
  async_attempt_count: 1,
  provider: "openai",
  model: "gpt-test",
  prompt_set_version: KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
  input_hash: promptInputHash,
  planned_analysis_invocation_id: IDS.invocation,
  status: "reserved",
  analysis_invocation_id: null,
  terminal_error_code: null,
  reserved_at: GENERATED_AT,
  provider_returned_at: null,
  finalized_at: null,
} satisfies KeywordGovernanceSuggestionInvocationAttemptRow;
const finalizedReservation = {
  ...reservation,
  status: "succeeded",
  analysis_invocation_id: IDS.invocation,
  provider_returned_at: GENERATED_AT,
  finalized_at: GENERATED_AT,
} satisfies KeywordGovernanceSuggestionInvocationAttemptRow;

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

const generateKeywordGovernanceSuggestions = vi.fn(
  async (
    _manifest: KeywordGovernanceSuggestionInputManifest,
  ): Promise<KeywordGovernanceSuggestionGenerationResult> => modelResult,
);
const dependencies = {
  createClient: vi.fn((_options: KeywordGovernanceSuggestionClientOptions) => ({
    generateKeywordGovernanceSuggestions,
  })),
  createSuggestionId: vi
    .fn()
    .mockReturnValueOnce(IDS.suggestionA)
    .mockReturnValueOnce(IDS.suggestionB),
};

beforeEach(() => {
  vi.restoreAllMocks();
  transaction.mockClear();
  transactionDepth = 0;
  generateKeywordGovernanceSuggestions.mockReset().mockResolvedValue(modelResult);
  dependencies.createClient.mockClear();
  dependencies.createSuggestionId.mockReset();
  dependencies.createSuggestionId
    .mockReturnValueOnce(IDS.suggestionA)
    .mockReturnValueOnce(IDS.suggestionB);
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();

  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
  vi.spyOn(AsyncRunsRepository.prototype, "lockAttemptForUpdate").mockResolvedValue(
    run,
  );
  vi.spyOn(AsyncRunsRepository.prototype, "setProgress").mockResolvedValue(true);
  vi.spyOn(AsyncRunsRepository.prototype, "resetToQueued").mockResolvedValue(true);
  vi.spyOn(
    KeywordGovernanceSuggestionGenerationRunsRepository.prototype,
    "findById",
  ).mockResolvedValue(ledger);
  vi.spyOn(
    KeywordGovernanceSuggestionGenerationRunsRepository.prototype,
    "terminalize",
  ).mockResolvedValue({
    kind: "terminalized",
    run: { ...ledger, result_output_hash: invocation.outputHash },
  });
  vi.spyOn(
    KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype,
    "reserve",
  ).mockResolvedValue({ kind: "reserved", reservation });
  vi.spyOn(
    KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype,
    "finalizeWithInvocation",
  ).mockResolvedValue({
    kind: "finalized",
    reservation: finalizedReservation,
    invocationId: IDS.invocation,
  });
  vi.spyOn(
    KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype,
    "markOutcomeUnknown",
  ).mockResolvedValue({
    kind: "marked",
    reservation: {
      ...reservation,
      status: "outcome_unknown",
      terminal_error_code: "PROVIDER_OUTCOME_UNKNOWN",
      provider_returned_at: GENERATED_AT,
      finalized_at: GENERATED_AT,
    },
  });
  vi.spyOn(
    KeywordReviewSuggestionsRepository.prototype,
    "insertBatch",
  ).mockResolvedValue({ kind: "inserted", suggestions: [] });
});

describe("runKeywordGovernanceSuggestionGeneration", () => {
  it("calls the provider only after a durable reservation and atomically commits the complete result", async () => {
    const order: string[] = [];
    vi.mocked(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype.reserve,
    ).mockImplementation(async () => {
      expect(transactionDepth).toBe(0);
      order.push("reserve");
      return { kind: "reserved", reservation };
    });
    generateKeywordGovernanceSuggestions.mockImplementationOnce(async (input) => {
      expect(transactionDepth).toBe(0);
      expect(input).toEqual(manifest);
      order.push("provider");
      return modelResult;
    });
    vi.mocked(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
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
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).mockImplementation(async (_scope, input) => {
      expect(transactionDepth).toBe(1);
      order.push("suggestions");
      expect(input).toEqual({
        generationRunId: IDS.run,
        inputHash: manifestInputHash,
        outputHash: invocation.outputHash,
        analysisInvocationId: IDS.invocation,
        suggestions: [
          {
            suggestionId: IDS.suggestionA,
            ordinal: 1,
            keywordId: IDS.keywordA,
            expectedGovernanceRevision: 4,
            suggestionVersion: "keyword-governance-suggestion.v1",
            status: "approved",
            intent: "commercial",
            buyerStage: "decision",
            topicNodeId: IDS.topicA,
            topicModelRevision: 7,
            mappingDecision: "existing_page",
            mappedSitePageId: IDS.pageA,
            reason: "Existing owned Page authority is already exact.",
            intentAuthority: "provider_observed",
            intentSnapshotId: IDS.snapshot,
            intentObservationId: IDS.observation,
            intentObservedAt: "2026-08-10T00:30:00.000Z",
          },
          {
            suggestionId: IDS.suggestionB,
            ordinal: 2,
            keywordId: IDS.keywordB,
            expectedGovernanceRevision: 0,
            suggestionVersion: "keyword-governance-suggestion.v1",
            status: "approved",
            intent: "informational",
            buyerStage: "awareness",
            topicNodeId: IDS.topicB,
            topicModelRevision: 7,
            mappingDecision: "new_asset",
            mappedSitePageId: null,
            reason: "A dedicated retention asset fits the confirmed Topic.",
            intentAuthority: "llm_generated",
            intentSnapshotId: null,
            intentObservationId: null,
            intentObservedAt: null,
          },
        ],
      });
      return { kind: "inserted", suggestions: [] };
    });
    vi.mocked(AsyncRunsRepository.prototype.setProgress).mockImplementation(
      async (_attempt, progress) => {
        expect(transactionDepth).toBe(1);
        order.push("progress");
        expect(progress).toEqual({
          schemaVersion:
            "keyword-governance-suggestion-generation-outcome.v1",
          candidateCount: 2,
          suggestionCount: 2,
          limitations: [],
          terminalDisposition: {
            kind: "completed",
            requestNextBatch: true,
          },
        });
        return true;
      },
    );
    vi.mocked(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).mockImplementation(async (_attempt, input) => {
      expect(transactionDepth).toBe(1);
      order.push("terminalize");
      expect(input).toEqual({
        status: "completed",
        resultOutputHash: invocation.outputHash,
        lastErrorCode: null,
        lastErrorSummary: null,
      });
      return {
        kind: "terminalized",
        run: { ...ledger, result_output_hash: invocation.outputHash },
      };
    });

    const outcome = await runKeywordGovernanceSuggestionGeneration(
      ctx,
      { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
      dependencies,
    );

    expect(order).toEqual([
      "reserve",
      "provider",
      "finalize",
      "suggestions",
      "progress",
      "terminalize",
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: IDS.actor,
    });
  });

  it("recovers a completed durable next-batch disposition after claim returns null", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce(null);
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValueOnce({
      ...run,
      status: "completed",
      progress: {
        schemaVersion:
          "keyword-governance-suggestion-generation-outcome.v1",
        candidateCount: 2,
        suggestionCount: 2,
        limitations: [],
        terminalDisposition: {
          kind: "completed",
          requestNextBatch: true,
        },
      },
      completed_at: GENERATED_AT,
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: IDS.actor,
    });

    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype.reserve,
    ).not.toHaveBeenCalled();
  });

  it("recovers a cancelled durable reschedule disposition after claim returns null", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce(null);
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValueOnce({
      ...run,
      status: "cancelled",
      progress: {
        schemaVersion:
          "keyword-governance-suggestion-generation-outcome.v1",
        candidateCount: 2,
        suggestionCount: 0,
        limitations: [],
        terminalDisposition: {
          kind: "reschedule",
          reason: "concurrent_human",
          requestNextBatch: true,
        },
      },
      last_error_code: "KEYWORD_GOVERNANCE_SUGGESTION_CONCURRENT_HUMAN",
      last_error_summary:
        "Keyword governance suggestion generation was superseded.",
      completed_at: GENERATED_AT,
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({
      kind: "reschedule",
      reason: "concurrent_human",
      requestNextBatch: true,
      initiatedBy: IDS.actor,
    });

    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype.reserve,
    ).not.toHaveBeenCalled();
  });

  it("ignores a payload with extra authority fields before claiming or constructing a client", async () => {
    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        {
          runId: IDS.run,
          workspaceId: IDS.workspace,
          projectId: IDS.project,
          actorId: IDS.actor,
        },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(AsyncRunsRepository.prototype.claim).not.toHaveBeenCalled();
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
  });

  it("terminalizes a claimed run with the wrong typed identity before any paid work", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      result_type: "topic_model_generation_run",
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode: "KEYWORD_GOVERNANCE_SUGGESTION_RUN_INVALID",
      lastErrorSummary: "Keyword governance suggestion generation failed.",
    });
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
  });

  it("fails a claimed run whose immutable manifest hash no longer matches", async () => {
    vi.mocked(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.findById,
    ).mockResolvedValueOnce({ ...ledger, input_hash: "f".repeat(64) });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode: "KEYWORD_GOVERNANCE_SUGGESTION_INPUT_INVALID",
      lastErrorSummary: "Keyword governance suggestion generation failed.",
    });
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
  });

  it.each([
    ["stale", { kind: "stale" } as const, null],
    [
      "existing",
      { kind: "existing", reservation } as const,
      null,
    ],
    [
      "unresolved",
      { kind: "unresolved", reservation } as const,
      {
        status: "failed",
        resultOutputHash: null,
        lastErrorCode:
          "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
        lastErrorSummary:
          "The provider invocation outcome could not be safely recovered.",
      },
    ],
    [
      "budget exhausted",
      { kind: "budget_exhausted" } as const,
      {
        status: "failed",
        resultOutputHash: null,
        lastErrorCode:
          "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_BUDGET_EXHAUSTED",
        lastErrorSummary:
          "Keyword governance suggestion invocation budget was exhausted.",
      },
    ],
    [
      "configuration mismatch",
      { kind: "configuration_mismatch" } as const,
      {
        status: "failed",
        resultOutputHash: null,
        lastErrorCode:
          "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_CONFIGURATION_MISMATCH",
        lastErrorSummary: "Keyword governance suggestion generation failed.",
      },
    ],
  ])(
    "makes no provider call for a %s reservation result",
    async (_label, reservationResult, terminal) => {
      vi.mocked(
        KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype.reserve,
      ).mockResolvedValueOnce(reservationResult);

      const outcome = await runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      );

      expect(outcome).toEqual({ kind: "settled", requestNextBatch: false });
      expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
      if (terminal === null) {
        expect(
          KeywordGovernanceSuggestionGenerationRunsRepository.prototype
            .terminalize,
        ).not.toHaveBeenCalled();
      } else {
        expect(
          KeywordGovernanceSuggestionGenerationRunsRepository.prototype
            .terminalize,
        ).toHaveBeenCalledWith(attempt, terminal);
      }
    },
  );

  it("records a known HTTP transient invocation and resets the exact attempt in one short transaction", async () => {
    const failedInvocation = {
      ...invocation,
      outputHash: null,
      status: "failed",
      errorCode: "RATE_LIMITED",
    } satisfies AnalysisInvocationRecord;
    const providerError = new LLMError(
      "RATE_LIMITED",
      "raw provider response must not persist",
      failedInvocation,
    );
    const order: string[] = [];
    generateKeywordGovernanceSuggestions.mockRejectedValueOnce(providerError);
    vi.mocked(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).mockImplementationOnce(async (_attempt, _reservationId, metadata) => {
      expect(transactionDepth).toBe(1);
      order.push("finalize");
      expect(metadata).toMatchObject({
        status: "failed",
        outputHash: null,
        errorCode: "RATE_LIMITED",
      });
      return {
        kind: "finalized",
        reservation: {
          ...finalizedReservation,
          status: "failed",
          terminal_error_code: "RATE_LIMITED",
        },
        invocationId: IDS.invocation,
      };
    });
    vi.mocked(AsyncRunsRepository.prototype.resetToQueued).mockImplementationOnce(
      async (_attempt, failure) => {
        expect(transactionDepth).toBe(1);
        order.push("reset");
        expect(failure).toEqual({
          code: "RATE_LIMITED",
          summary:
            "Keyword governance suggestion generation will be retried.",
        });
        return true;
      },
    );

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).rejects.toBe(providerError);

    expect(order).toEqual(["finalize", "reset"]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).not.toHaveBeenCalled();
  });

  it.each(["TIMEOUT", "NETWORK_ERROR"] as const)(
    "marks an attached %s invocation outcome unknown and never resets it for paid replay",
    async (errorCode) => {
      const ambiguousInvocation = {
        ...invocation,
        outputHash: null,
        status: "failed",
        errorCode,
      } satisfies AnalysisInvocationRecord;
      generateKeywordGovernanceSuggestions.mockRejectedValueOnce(
        new LLMError(
          errorCode,
          "raw ambiguous transport failure must not persist",
          ambiguousInvocation,
        ),
      );

      await expect(
        runKeywordGovernanceSuggestionGeneration(
          ctx,
          { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
          dependencies,
        ),
      ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

      expect(AsyncRunsRepository.prototype.resetToQueued).not.toHaveBeenCalled();
      expect(
        KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
          .finalizeWithInvocation,
      ).not.toHaveBeenCalled();
      expect(
        KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
          .markOutcomeUnknown,
      ).toHaveBeenCalledWith(
        attempt,
        IDS.reservation,
        "PROVIDER_OUTCOME_UNKNOWN",
      );
      expect(
        KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
      ).toHaveBeenCalledWith(attempt, {
        status: "failed",
        resultOutputHash: null,
        lastErrorCode:
          "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
        lastErrorSummary:
          "The provider invocation outcome could not be safely recovered.",
      });
    },
  );

  it("does not retry when a typed transient error contradicts its invocation facts", async () => {
    const contradictoryInvocation = {
      ...invocation,
      outputHash: null,
      status: "rejected",
      errorCode: "SCHEMA_INVALID",
    } satisfies AnalysisInvocationRecord;
    generateKeywordGovernanceSuggestions.mockRejectedValueOnce(
      new LLMError(
        "RATE_LIMITED",
        "contradictory typed provider error",
        contradictoryInvocation,
      ),
    );

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(AsyncRunsRepository.prototype.resetToQueued).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "INVOCATION_IDENTITY_MISMATCH",
    );
  });

  it("persists a provider rejection and terminal failure without suggestions", async () => {
    const rejectedInvocation = {
      ...invocation,
      outputHash: null,
      status: "rejected",
      errorCode: "SCHEMA_INVALID",
    } satisfies AnalysisInvocationRecord;
    const rejected = new LLMError(
      "SCHEMA_INVALID",
      "raw provider output must not persist",
      rejectedInvocation,
      "suggestions.0:invalid_type",
    );
    const order: string[] = [];
    generateKeywordGovernanceSuggestions.mockRejectedValueOnce(rejected);
    vi.mocked(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).mockImplementationOnce(async (_attempt, _reservationId, metadata) => {
      expect(transactionDepth).toBe(1);
      order.push("finalize");
      expect(metadata).toMatchObject({
        status: "rejected",
        outputHash: null,
        errorCode: "SCHEMA_INVALID",
      });
      return {
        kind: "finalized",
        reservation: {
          ...finalizedReservation,
          status: "rejected",
          terminal_error_code: "SCHEMA_INVALID",
        },
        invocationId: IDS.invocation,
      };
    });
    vi.mocked(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).mockImplementationOnce(async (_attempt, terminal) => {
      expect(transactionDepth).toBe(1);
      order.push("terminalize");
      expect(terminal).toEqual({
        status: "failed",
        resultOutputHash: null,
        lastErrorCode: "SCHEMA_INVALID",
        lastErrorSummary: "Keyword governance suggestion generation failed.",
      });
      return { kind: "terminalized", run: ledger };
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(order).toEqual(["finalize", "terminalize"]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).not.toHaveBeenCalled();
  });

  it("converts a structurally invalid returned batch into a rejected invocation", async () => {
    generateKeywordGovernanceSuggestions.mockResolvedValueOnce({
      ...modelResult,
      output: {
        ...modelResult.output,
        suggestions: [modelResult.output.suggestions[0]!],
      },
    } as never);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      expect.objectContaining({
        status: "rejected",
        outputHash: null,
        errorCode: "REFERENCE_INTEGRITY",
      }),
    );
    expect(
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode: "REFERENCE_INTEGRITY",
      lastErrorSummary: "Keyword governance suggestion generation failed.",
    });
  });

  it("rejects the whole batch when a buyer stage is outside the contract vocabulary", async () => {
    generateKeywordGovernanceSuggestions.mockResolvedValueOnce({
      ...modelResult,
      output: {
        ...modelResult.output,
        suggestions: modelResult.output.suggestions.map((suggestion, index) =>
          index === 0 ? { ...suggestion, buyerStage: "evaluation" } : suggestion,
        ),
      },
    } as never);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      expect.objectContaining({
        status: "rejected",
        outputHash: null,
        errorCode: "SCHEMA_INVALID",
      }),
    );
    expect(
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode: "SCHEMA_INVALID",
      lastErrorSummary: "Keyword governance suggestion generation failed.",
    });
  });

  it("marks an opaque provider outcome unknown and never pays again on redelivery", async () => {
    generateKeywordGovernanceSuggestions.mockRejectedValueOnce(
      new Error("opaque provider failure"),
    );

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "PROVIDER_OUTCOME_UNKNOWN",
    );
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary:
        "The provider invocation outcome could not be safely recovered.",
    });
    expect(
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).not.toHaveBeenCalled();

    vi.mocked(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({
      kind: "existing",
      reservation: {
        ...reservation,
        status: "outcome_unknown",
        terminal_error_code: "PROVIDER_OUTCOME_UNKNOWN",
        provider_returned_at: GENERATED_AT,
        finalized_at: GENERATED_AT,
      },
    });
    await runKeywordGovernanceSuggestionGeneration(
      ctx,
      { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
      dependencies,
    );
    expect(generateKeywordGovernanceSuggestions).toHaveBeenCalledTimes(1);
  });

  it("marks the reservation unknown when Tx B cannot commit the successful provider result", async () => {
    vi.mocked(
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).mockRejectedValueOnce(new Error("Tx B insert failed"));

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(generateKeywordGovernanceSuggestions).toHaveBeenCalledOnce();
    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN",
    );
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenLastCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary:
        "The provider invocation outcome could not be safely recovered.",
    });
  });

  it("recovers the durable continuation when Tx B committed but its acknowledgement was lost", async () => {
    vi.mocked(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    )
      .mockResolvedValueOnce({
        kind: "terminalized",
        run: { ...ledger, result_output_hash: invocation.outputHash },
      })
      .mockResolvedValueOnce({ kind: "stale" });
    transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => {
        transactionDepth += 1;
        try {
          await callback({});
          throw new Error("commit acknowledgement lost");
        } finally {
          transactionDepth -= 1;
        }
      },
    );
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValueOnce({
      ...run,
      status: "completed",
      progress: {
        schemaVersion:
          "keyword-governance-suggestion-generation-outcome.v1",
        candidateCount: 2,
        suggestionCount: 2,
        limitations: [],
        terminalDisposition: {
          kind: "completed",
          requestNextBatch: true,
        },
      },
      completed_at: GENERATED_AT,
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: IDS.actor,
    });

    expect(generateKeywordGovernanceSuggestions).toHaveBeenCalledOnce();
    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN",
    );
  });

  it.each([
    ["stale_authority", "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE"],
    ["concurrent_human", "KEYWORD_GOVERNANCE_SUGGESTION_CONCURRENT_HUMAN"],
    ["conflict", "KEYWORD_GOVERNANCE_SUGGESTION_BATCH_CONFLICT"],
  ] as const)(
    "cancels a %s batch atomically and requests a fresh post-commit batch",
    async (reason, terminalCode) => {
      const order: string[] = [];
      vi.mocked(
        KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
          .finalizeWithInvocation,
      ).mockImplementationOnce(async () => {
        expect(transactionDepth).toBe(1);
        order.push("finalize");
        return {
          kind: "finalized",
          reservation: finalizedReservation,
          invocationId: IDS.invocation,
        };
      });
      vi.mocked(
        KeywordReviewSuggestionsRepository.prototype.insertBatch,
      ).mockImplementationOnce(async () => {
        expect(transactionDepth).toBe(1);
        order.push("suggestions");
        return { kind: reason };
      });
      vi.mocked(
        KeywordGovernanceSuggestionGenerationRunsRepository.prototype
          .terminalize,
      ).mockImplementationOnce(async (_attempt, terminal) => {
        expect(transactionDepth).toBe(1);
        order.push("terminalize");
        expect(terminal).toEqual({
          status: "cancelled",
          resultOutputHash: null,
          lastErrorCode: terminalCode,
          lastErrorSummary:
            "Keyword governance suggestion generation was superseded.",
        });
        return { kind: "terminalized", run: ledger };
      });
      vi.mocked(AsyncRunsRepository.prototype.setProgress).mockImplementationOnce(
        async (_attempt, progress) => {
          expect(transactionDepth).toBe(1);
          order.push("progress");
          expect(progress).toEqual({
            schemaVersion:
              "keyword-governance-suggestion-generation-outcome.v1",
            candidateCount: 2,
            suggestionCount: 0,
            limitations: [],
            terminalDisposition: {
              kind: "reschedule",
              reason,
              requestNextBatch: true,
            },
          });
          return true;
        },
      );

      const outcome = await runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      );

      expect(outcome).toEqual({
        kind: "reschedule",
        reason,
        requestNextBatch: true,
        initiatedBy: IDS.actor,
      });
      expect(order).toEqual([
        "finalize",
        "suggestions",
        "progress",
        "terminalize",
      ]);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(
        KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
          .markOutcomeUnknown,
      ).not.toHaveBeenCalled();
    },
  );

  it("fails a reservation identity mismatch before calling the provider", async () => {
    vi.mocked(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({
      kind: "reserved",
      reservation: { ...reservation, model: "wrong-model" },
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_CONFIGURATION_MISMATCH",
      lastErrorSummary: "Keyword governance suggestion generation failed.",
    });
  });

  it("marks a provider-returned invocation with mismatched identity outcome unknown", async () => {
    const rawMarker = "RAW_PROVIDER_OUTPUT_MUST_NOT_ESCAPE";
    generateKeywordGovernanceSuggestions.mockResolvedValueOnce({
      ...modelResult,
      invocation: {
        ...invocation,
        model: "wrong-model",
        rawProviderOutput: rawMarker,
      },
    } as never);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "INVOCATION_IDENTITY_MISMATCH",
    );
    expect(
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary:
        "The provider invocation outcome could not be safely recovered.",
    });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      rawMarker,
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      rawMarker,
    );
  });

  it("rejects undeclared invocation fields even when the visible identity matches", async () => {
    generateKeywordGovernanceSuggestions.mockResolvedValueOnce({
      ...modelResult,
      invocation: {
        ...invocation,
        rawProviderOutput: "RAW_PROVIDER_PAYLOAD_MUST_NOT_PERSIST",
      },
    } as never);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "INVOCATION_IDENTITY_MISMATCH",
    );
    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).not.toHaveBeenCalled();
    expect(
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).not.toHaveBeenCalled();
  });

  it("persists an undeclared generation-result field as a rejected structured result", async () => {
    generateKeywordGovernanceSuggestions.mockResolvedValueOnce({
      ...modelResult,
      actorId: IDS.actor,
    } as never);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      expect.objectContaining({
        status: "rejected",
        outputHash: null,
        errorCode: "SCHEMA_INVALID",
      }),
    );
    expect(
      KeywordReviewSuggestionsRepository.prototype.insertBatch,
    ).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode: "SCHEMA_INVALID",
      lastErrorSummary: "Keyword governance suggestion generation failed.",
    });
  });

  it("marks an invalid-output finalization ambiguity outcome unknown", async () => {
    generateKeywordGovernanceSuggestions.mockResolvedValueOnce({
      ...modelResult,
      output: {
        ...modelResult.output,
        suggestions: [modelResult.output.suggestions[0]!],
      },
    } as never);
    transaction.mockRejectedValueOnce(new Error("ambiguous rejection commit"));

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN",
    );
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenLastCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary:
        "The provider invocation outcome could not be safely recovered.",
    });
  });

  it("does not retry when committing a known transient invocation becomes ambiguous", async () => {
    const failedInvocation = {
      ...invocation,
      outputHash: null,
      status: "failed",
      errorCode: "SERVER_ERROR",
    } satisfies AnalysisInvocationRecord;
    const providerError = new LLMError(
      "SERVER_ERROR",
      "raw provider response must not persist",
      failedInvocation,
    );
    generateKeywordGovernanceSuggestions.mockRejectedValueOnce(providerError);
    vi.mocked(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .finalizeWithInvocation,
    ).mockRejectedValueOnce(new Error("commit acknowledgement lost"));

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(AsyncRunsRepository.prototype.resetToQueued).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype
        .markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      IDS.reservation,
      "POST_PROVIDER_COMMIT_OUTCOME_UNKNOWN",
    );
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary:
        "The provider invocation outcome could not be safely recovered.",
    });
  });

  it("resets and rethrows a transient frozen-ledger read before constructing a client", async () => {
    const transient = Object.assign(new Error("serialization failure"), {
      code: "40001",
    });
    vi.mocked(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.findById,
    ).mockRejectedValueOnce(transient);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).rejects.toBe(transient);

    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      attempt,
      {
        code: "40001",
        summary: "Keyword governance suggestion generation will be retried.",
      },
    );
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
  });

  it("resets and rethrows a transient reservation failure before calling the provider", async () => {
    const transient = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    vi.mocked(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype.reserve,
    ).mockRejectedValueOnce(transient);

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).rejects.toBe(transient);

    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      attempt,
      {
        code: "ECONNRESET",
        summary: "Keyword governance suggestion generation will be retried.",
      },
    );
    expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
  });

  it("terminalizes a client configuration failure before reserving paid work", async () => {
    const configurationFailure = new LLMError(
      "CONFIG_INVALID",
      "missing model configuration",
    );
    dependencies.createClient.mockImplementationOnce(() => {
      throw configurationFailure;
    });

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        ctx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({ kind: "settled", requestNextBatch: false });

    expect(
      KeywordGovernanceSuggestionInvocationAttemptsRepository.prototype.reserve,
    ).not.toHaveBeenCalled();
    expect(generateKeywordGovernanceSuggestions).not.toHaveBeenCalled();
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype.terminalize,
    ).toHaveBeenCalledWith(attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode: "CONFIG_INVALID",
      lastErrorSummary: "Keyword governance suggestion generation failed.",
    });
  });

  it("omits the default temperature when routing the suggestion client through Azure OpenAI", async () => {
    const azureCtx = {
      ...ctx,
      openai: {
        apiKey: "azure-key",
        model: "gpt-test",
        temperature: 0.2,
        baseUrl:
          "https://res.openai.azure.com/openai/deployments/gpt-test/chat/completions?api-version=2024-10-21",
        authScheme: "api-key" as const,
      },
    } as WorkerContext;

    await expect(
      runKeywordGovernanceSuggestionGeneration(
        azureCtx,
        { runId: IDS.run, workspaceId: IDS.workspace, projectId: IDS.project },
        dependencies,
      ),
    ).resolves.toEqual({
      kind: "completed",
      requestNextBatch: true,
      initiatedBy: IDS.actor,
    });

    expect(dependencies.createClient).toHaveBeenCalledOnce();
    const createClientCall = dependencies.createClient.mock.calls.at(0);
    expect(createClientCall).toBeDefined();
    if (!createClientCall) {
      throw new Error("Azure suggestion client call was missing");
    }
    const [options] = createClientCall;
    expect(options).toMatchObject({
      apiKey: "azure-key",
      model: "gpt-test",
      baseUrl:
        "https://res.openai.azure.com/openai/deployments/gpt-test/chat/completions?api-version=2024-10-21",
      authScheme: "api-key",
      timeoutMs: 45_000,
    });
    expect(options).not.toHaveProperty("temperature");
  });
});
