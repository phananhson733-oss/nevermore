import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@sf/contracts";
import type { Db, PgBoss } from "./index.ts";
import { AsyncRunsRepository, type AsyncRunRow } from "./repositories/async-runs.ts";
import { KeywordGovernanceSuggestionGenerationRunsRepository } from "./repositories/keyword-governance-suggestion-generation-runs.ts";
import { KeywordReviewSuggestionsRepository } from "./repositories/keyword-review-suggestions.ts";
import {
  KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY,
  KEYWORD_GOVERNANCE_SUGGESTION_QUEUE,
  scheduleKeywordGovernanceSuggestions,
} from "./keyword-governance-suggestion-scheduler.ts";

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  actor: "00000000-0000-4000-8000-000000000003",
  run: "00000000-0000-4000-8000-000000000004",
  winner: "00000000-0000-4000-8000-000000000005",
  profile: "00000000-0000-4000-8000-000000000006",
  topicRevision: "00000000-0000-4000-8000-000000000007",
  topic: "00000000-0000-4000-8000-000000000008",
  keyword: "00000000-0000-4000-8000-000000000009",
  occurrence: "00000000-0000-4000-8000-00000000000a",
  completed: "00000000-0000-4000-8000-00000000000b",
} as const;

const scope = { workspaceId: IDS.workspace, projectId: IDS.project };
const INPUT_HASH = "c".repeat(64);
const RESULT_HASH = "d".repeat(64);

const queuedRun: AsyncRunRow = {
  id: IDS.run,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  kind: "keyword_governance_suggestion_generation",
  status: "queued",
  active_key: "keyword-governance-suggestion:generation",
  contract_version: CONTRACT_VERSION,
  request_payload: { inputHash: INPUT_HASH },
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: "keyword_governance_suggestion_generation_run",
  result_id: IDS.run,
  attempt_count: 0,
  initiated_by: IDS.actor,
  queued_at: "2026-08-10T00:00:00.000Z",
  started_at: null,
  completed_at: null,
};

const authority = {
  workspaceId: IDS.workspace,
  projectId: IDS.project,
  marketCode: "US",
  languageTag: "en-US",
  primaryMarketCode: "US",
  primaryLanguageTag: "en-US",
  confirmedProductProfile: {
    state: "confirmed" as const,
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
    state: "confirmed" as const,
    topicModelRevisionId: IDS.topicRevision,
    revision: 3,
    contentHash: "b".repeat(64),
    topics: [{ topicNodeId: IDS.topic, label: "Activation" }],
  },
  pages: [],
  keywords: [
    {
      keywordId: IDS.keyword,
      displayKeyword: "activation automation",
      normalizedKeyword: "activation automation",
      marketCode: "US",
      languageTag: "en-US",
      queryKind: "search_query" as const,
      status: "candidate" as const,
      reviewState: "unreviewed" as const,
      reviewOrigin: null,
      hasHumanDecision: false as const,
      governanceRevision: 0,
      topicNodeId: null,
      topicModelRevision: null,
      mappedSitePageId: null,
      occurrences: [
        {
          occurrenceId: IDS.occurrence,
          marketCode: "US",
          languageTag: "en-US",
          valid: true as const,
          sourceKind: "manual",
          providerSearchIntent: null,
        },
      ],
    },
  ],
};

function activeRun(id = IDS.winner): AsyncRunRow {
  return { ...queuedRun, id, result_id: id };
}

function harness(options: {
  readonly transactionError?: unknown;
  readonly runId?: string;
} = {}) {
  const execute = vi.fn(async () => []);
  const tx = { marker: "tx", execute };
  const db = {
    transaction: vi.fn(async (operation: (executor: unknown) => unknown) => {
      if (options.transactionError !== undefined) {
        throw options.transactionError;
      }
      return operation(tx);
    }),
  } as unknown as Db;
  const enqueue = vi.fn(async () => options.runId ?? IDS.run);
  return {
    ctx: { db, boss: { marker: "boss" } as unknown as PgBoss },
    db,
    tx,
    execute,
    enqueue,
    createRunId: vi.fn(() => options.runId ?? IDS.run),
  };
}

function installReadyDefaults(): void {
  vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(null);
  vi.spyOn(
    KeywordGovernanceSuggestionGenerationRunsRepository.prototype,
    "readPrimaryFreezeAuthority",
  ).mockResolvedValue({ kind: "ready", authority, hasMore: false });
  vi.spyOn(
    KeywordReviewSuggestionsRepository.prototype,
    "findReusableCompletedBatch",
  ).mockResolvedValue({ kind: "not_found" });
  vi.spyOn(
    KeywordReviewSuggestionsRepository.prototype,
    "findCurrentReusableCompletedBatch",
  ).mockResolvedValue({ kind: "not_found" });
  vi.spyOn(AsyncRunsRepository.prototype, "insertQueued").mockResolvedValue(
    queuedRun,
  );
  vi.spyOn(
    KeywordGovernanceSuggestionGenerationRunsRepository.prototype,
    "insertPlaceholder",
  ).mockResolvedValue({
    id: IDS.run,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    generation_version: "keyword-governance-suggestion-generation.v1",
    prompt_set_version: "keyword-governance-suggestion.prompt.v1",
    input_manifest: {} as never,
    input_hash: INPUT_HASH,
    prompt_input_hash: null,
    result_output_hash: null,
    created_at: "2026-08-10T00:00:00.000Z",
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Keyword governance suggestion scheduler", () => {
  it("freezes queue and active-key literals", () => {
    expect(KEYWORD_GOVERNANCE_SUGGESTION_QUEUE).toBe(
      "keyword-governance-suggestion.generate",
    );
    expect(KEYWORD_GOVERNANCE_SUGGESTION_ACTIVE_KEY).toBe(
      "keyword-governance-suggestion:generation",
    );
  });

  it("atomically creates the async run, typed extension, and pg-boss job", async () => {
    installReadyDefaults();
    const h = harness();

    const result = await scheduleKeywordGovernanceSuggestions(
      h.ctx,
      { scope, initiatedBy: IDS.actor },
      { createRunId: h.createRunId, enqueueRunInTx: h.enqueue },
    );

    expect(result).toMatchObject({
      kind: "queued",
      runId: IDS.run,
      candidateCount: 1,
      hasMore: false,
    });
    expect(result).toHaveProperty("inputHash");
    expect(AsyncRunsRepository.prototype.insertQueued).toHaveBeenCalledWith({
      runId: IDS.run,
      workspaceId: IDS.workspace,
      projectId: IDS.project,
      kind: "keyword_governance_suggestion_generation",
      activeKey: "keyword-governance-suggestion:generation",
      initiatedBy: IDS.actor,
      contractVersion: CONTRACT_VERSION,
      requestPayload: { inputHash: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      resultType: "keyword_governance_suggestion_generation_run",
      resultId: IDS.run,
    });
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype
        .insertPlaceholder,
    ).toHaveBeenCalledWith({
      runId: IDS.run,
      workspaceId: IDS.workspace,
      projectId: IDS.project,
      inputManifest: expect.objectContaining({
        schemaVersion: "keyword-governance-suggestion-input.v1",
        projectId: IDS.project,
      }),
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(h.enqueue).toHaveBeenCalledWith(
      h.ctx.boss,
      h.tx,
      "keyword-governance-suggestion.generate",
      {
        runId: IDS.run,
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        contractVersion: CONTRACT_VERSION,
      },
    );
  });

  it("serializes each project scheduler transaction before probing active or reusable work", async () => {
    installReadyDefaults();
    const order: string[] = [];
    const h = harness();
    h.execute.mockImplementationOnce(async () => {
      order.push("lock");
      return [];
    });
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockImplementationOnce(
      async () => {
        order.push("active");
        return null;
      },
    );

    await scheduleKeywordGovernanceSuggestions(
      h.ctx,
      { scope, initiatedBy: IDS.actor },
      { createRunId: h.createRunId, enqueueRunInTx: h.enqueue },
    );

    expect(h.execute).toHaveBeenCalledOnce();
    expect(order).toEqual(["lock", "active"]);
  });

  it("returns the active owner for caller ACK without freezing another batch", async () => {
    installReadyDefaults();
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockResolvedValueOnce(
      activeRun(),
    );
    const h = harness();

    await expect(
      scheduleKeywordGovernanceSuggestions(h.ctx, {
        scope,
        initiatedBy: IDS.actor,
      }),
    ).resolves.toEqual({ kind: "active", runId: IDS.winner });
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype
        .readPrimaryFreezeAuthority,
    ).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
  });

  it("fails closed when the fixed active key is occupied by an unrelated run", async () => {
    installReadyDefaults();
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockResolvedValueOnce({
      ...activeRun(),
      kind: "diagnostic",
      result_type: "diagnostic_run",
    });
    const h = harness();

    await expect(
      scheduleKeywordGovernanceSuggestions(h.ctx, {
        scope,
        initiatedBy: IDS.actor,
      }),
    ).rejects.toThrow(/active run projection/u);
    expect(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype
        .readPrimaryFreezeAuthority,
    ).not.toHaveBeenCalled();
  });

  it("reuses a current completed pending batch only after no unsuggested candidates remain", async () => {
    installReadyDefaults();
    vi.mocked(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype
        .readPrimaryFreezeAuthority,
    ).mockResolvedValueOnce({ kind: "no_candidates" });
    vi.mocked(
      KeywordReviewSuggestionsRepository.prototype
        .findCurrentReusableCompletedBatch,
    ).mockResolvedValueOnce({
      kind: "reusable",
      generationRunId: IDS.completed,
      inputHash: INPUT_HASH,
      resultOutputHash: RESULT_HASH,
      suggestions: [{} as never],
    });
    const h = harness();

    await expect(
      scheduleKeywordGovernanceSuggestions(h.ctx, {
        scope,
        initiatedBy: IDS.actor,
      }),
    ).resolves.toEqual({
      kind: "exact_pending_reused",
      generationRunId: IDS.completed,
      inputHash: INPUT_HASH,
      suggestionCount: 1,
    });
    expect(
      KeywordReviewSuggestionsRepository.prototype
        .findCurrentReusableCompletedBatch,
    ).toHaveBeenCalledWith(scope);
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
  });

  it("distinguishes an ACKable stable authority gap from no candidates", async () => {
    installReadyDefaults();
    vi.mocked(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype
        .readPrimaryFreezeAuthority,
    ).mockResolvedValueOnce({ kind: "no_candidates" });
    const first = harness();
    await expect(
      scheduleKeywordGovernanceSuggestions(first.ctx, {
        scope,
        initiatedBy: IDS.actor,
      }),
    ).resolves.toEqual({ kind: "no_candidates" });

    vi.mocked(
      KeywordGovernanceSuggestionGenerationRunsRepository.prototype
        .readPrimaryFreezeAuthority,
    ).mockResolvedValueOnce({ kind: "unavailable" });
    const second = harness();
    await expect(
      scheduleKeywordGovernanceSuggestions(second.ctx, {
        scope,
        initiatedBy: IDS.actor,
      }),
    ).resolves.toEqual({ kind: "authority_unavailable" });
  });

  it("reuses an exact completed pending batch discovered after freezing", async () => {
    installReadyDefaults();
    vi.mocked(
      KeywordReviewSuggestionsRepository.prototype.findReusableCompletedBatch,
    ).mockImplementationOnce(async (_scope, inputHash) => ({
      kind: "reusable",
      generationRunId: IDS.completed,
      inputHash,
      resultOutputHash: RESULT_HASH,
      suggestions: [{} as never],
    }));
    const h = harness();

    const result = await scheduleKeywordGovernanceSuggestions(h.ctx, {
      scope,
      initiatedBy: IDS.actor,
    });

    expect(result).toMatchObject({
      kind: "exact_pending_reused",
      generationRunId: IDS.completed,
      suggestionCount: 1,
    });
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
  });

  it("maps the active-key insert race to the committed winner", async () => {
    installReadyDefaults();
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockResolvedValueOnce(
      activeRun(),
    );
    const h = harness({
      transactionError: {
        cause: {
          code: "23505",
          constraint: "async_runs_one_active_key_idx",
        },
      },
    });

    await expect(
      scheduleKeywordGovernanceSuggestions(h.ctx, {
        scope,
        initiatedBy: IDS.actor,
      }),
    ).resolves.toEqual({ kind: "active", runId: IDS.winner });
  });
});
