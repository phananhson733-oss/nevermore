// @input  -- encrypted caller-bound snapshots and serializable outputs from prior keyword steps
// @output -- no-retry Workflow steps for providers, models, GSC, summaries, and terminal assembly
// @pos    -- Node-capable effect boundary called only by the deterministic keyword Workflow orchestrator
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { getStepMetadata } from "workflow";
import type {
  KeywordOpportunityEnvelope,
  KeywordOpportunityErrorCode,
} from "@sf/public-tools/keyword-opportunity";
import {
  KEYWORD_STAGE_SERP_SAMPLE,
  KEYWORD_STAGE_SERP_INTERPRETATION,
  KEYWORD_STAGE_SERP_SAMPLE_PARTIAL,
} from "@sf/public-tools/keyword-opportunity";
import {
  createKeywordCostAccumulator,
  mergeKeywordCostSnapshots,
  reportKeywordWorkflowCost,
  type KeywordCostSnapshot,
} from "./keyword-cost-guard.ts";
import { createKeywordCoverageReader } from "./keyword-coverage-reader.ts";
import {
  EMPTY_KEYWORD_LLM_USAGE,
  mergeKeywordLlmUsage,
  type KeywordLlmUsage,
} from "./keyword-llm-client.ts";
import { createKeywordLlmUsageSink } from "./keyword-llm-usage-sink.ts";
import { assembleKeywordOpportunityPayload } from "./keyword-opportunity-assembly.ts";
import {
  keywordEnrichmentTargets,
  keywordPricedCandidates,
  keywordSerpTargets,
  type KeywordCoverageSnapshot,
  type KeywordPricedCandidate,
} from "./keyword-opportunity-stages.ts";
import {
  runKeywordCandidateStage,
  runKeywordCoverageStage,
  runKeywordInterpretationStage,
  runKeywordRankStage,
  runKeywordRegistrationStage,
  runKeywordSerpStage,
  runKeywordTrafficStage,
  runKeywordValidationStage,
  type KeywordCandidateStageResult,
  type KeywordInterpretationStageResult,
  type KeywordRankStageResult,
  type KeywordRegistrationStageResult,
  type KeywordSerpStageResult,
  type KeywordTrafficStageResult,
} from "./keyword-opportunity-workflow-runtime.ts";
import { createKeywordProviderSeams } from "./keyword-providers.ts";
import { createKeywordLlmSeams } from "./keyword-prompts.ts";
import type {
  KeywordCandidateDraft,
  KeywordContextToken,
  KeywordSerpSampleResult,
} from "./keyword-opportunity-handler.ts";
import {
  openKeywordWorkflowSnapshots,
  type KeywordWorkflowGrantSnapshot,
} from "./keyword-workflow-contract.ts";

export interface KeywordOpportunityWorkflowInput {
  readonly inputToken: string;
  readonly grantToken: string;
  readonly dedupeKey: string;
}

export type KeywordOpportunityWorkflowOutput =
  | {
      readonly kind: "completed";
      readonly payload: KeywordOpportunityEnvelope;
    }
  | {
      readonly kind: "failed";
      readonly code: KeywordOpportunityErrorCode;
    }
  | {
      readonly kind: "redirect";
      readonly ownerRunId: string;
    };

interface OpenedWorkflowSnapshots {
  readonly token: KeywordContextToken;
  readonly grant: KeywordWorkflowGrantSnapshot;
}

interface PreparedKeywordPlan {
  readonly status: "ok";
  readonly priced: readonly KeywordPricedCandidate[];
  readonly sampleTargets: readonly string[];
}

interface FailedKeywordPlan {
  readonly status: "failed";
  readonly code: "keyword_source_unavailable";
}

interface SerpSummary {
  readonly attemptedSamples: readonly KeywordSerpSampleResult[];
  readonly completeSamples: readonly KeywordSerpSampleResult[];
  readonly unavailableStages: readonly string[];
  readonly costs: KeywordCostSnapshot;
  readonly durationMs: number | null;
}

interface InterpretationSummary {
  readonly entries: KeywordInterpretationStageResult["entries"];
  readonly unavailableStages: readonly string[];
  readonly llm: KeywordLlmUsage;
  readonly durationMs: number | null;
}

function openedSnapshots(
  input: KeywordOpportunityWorkflowInput,
): OpenedWorkflowSnapshots | null {
  const opened = openKeywordWorkflowSnapshots<KeywordContextToken>(
    input.inputToken,
    input.grantToken,
  );
  const token = opened?.input;
  return opened !== null &&
    token !== undefined &&
    token.sub === opened.sub &&
    typeof token.siteUrl === "string" &&
    typeof token.marketCode === "string" &&
    typeof token.languageCode === "string" &&
    Array.isArray(token.propositions) &&
    Array.isArray(token.pages) &&
    Array.isArray(token.seeds)
    ? { token, grant: opened.grant }
    : null;
}

function maxDuration(
  values: readonly (number | null)[],
): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0 ? null : Math.max(...measured);
}

function sumDurations(
  values: readonly (number | null)[],
): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0
    ? null
    : measured.reduce((sum, value) => sum + value, 0);
}

export async function keywordCandidateStep(
  input: KeywordOpportunityWorkflowInput,
): Promise<KeywordCandidateStageResult> {
  "use step";
  const opened = openedSnapshots(input);
  if (opened === null) {
    return {
      status: "failed",
      code: "context_token_invalid",
      llm: EMPTY_KEYWORD_LLM_USAGE,
      startedAt: Date.now(),
      durationMs: 0,
    };
  }
  const usage = createKeywordLlmUsageSink();
  const llm = createKeywordLlmSeams({ onUsage: usage.add });
  return runKeywordCandidateStage(
    { token: opened.token, cap: 150 },
    { now: () => new Date(), expandCandidates: llm.expandCandidates, llmUsage: usage.total },
  );
}
keywordCandidateStep.maxRetries = 0;

export async function keywordValidationStep(
  input: KeywordOpportunityWorkflowInput,
  candidates: readonly KeywordCandidateDraft[],
) {
  "use step";
  const opened = openedSnapshots(input);
  if (opened === null) {
    return {
      status: "failed" as const,
      code: "keyword_source_unavailable" as const,
      costs: mergeKeywordCostSnapshots([]),
      durationMs: 0,
    };
  }
  const costs = createKeywordCostAccumulator();
  const providers = createKeywordProviderSeams({ costs });
  return runKeywordValidationStage(
    { token: opened.token, candidates },
    { now: () => new Date(), validateVolumes: providers.validateVolumes, costs },
  );
}
keywordValidationStep.maxRetries = 0;

export async function keywordCoverageStep(
  input: KeywordOpportunityWorkflowInput,
  candidates: readonly KeywordCandidateDraft[],
) {
  "use step";
  const opened = openedSnapshots(input);
  if (opened === null) {
    return {
      coverage: [] as readonly KeywordCoverageSnapshot[],
      unavailableStages: ["gsc_coverage"],
      durationMs: 0,
    };
  }
  return runKeywordCoverageStage(
    { token: opened.token, grant: opened.grant, candidates },
    { now: () => new Date(), readCoverageQueries: createKeywordCoverageReader({}) },
  );
}
keywordCoverageStep.maxRetries = 0;

export async function keywordPreparePlanStep(
  candidates: readonly KeywordCandidateDraft[],
  providerRows: Parameters<typeof keywordPricedCandidates>[1],
  coverage: readonly KeywordCoverageSnapshot[],
): Promise<PreparedKeywordPlan | FailedKeywordPlan> {
  "use step";
  try {
    const priced = keywordPricedCandidates(candidates, providerRows, coverage);
    return { status: "ok", priced, sampleTargets: keywordSerpTargets(priced) };
  } catch {
    return { status: "failed", code: "keyword_source_unavailable" };
  }
}
keywordPreparePlanStep.maxRetries = 0;

export async function keywordSerpStep(
  input: KeywordOpportunityWorkflowInput,
  keyword: string,
): Promise<KeywordSerpStageResult> {
  "use step";
  const opened = openedSnapshots(input);
  const costs = createKeywordCostAccumulator();
  if (opened === null) {
    return runKeywordSerpStage(
      { keyword, marketCode: "", languageCode: "" },
      {
        now: () => new Date(),
        costs,
        sampleSerp: async () => {
          throw new Error("workflow snapshots unavailable");
        },
      },
    );
  }
  const providers = createKeywordProviderSeams({ costs });
  return runKeywordSerpStage(
    {
      keyword,
      marketCode: opened.token.marketCode,
      languageCode: opened.token.languageCode,
    },
    { now: () => new Date(), sampleSerp: providers.sampleSerp, costs },
  );
}
keywordSerpStep.maxRetries = 0;

export async function keywordSerpSummaryStep(
  waves: readonly (readonly KeywordSerpStageResult[])[],
): Promise<SerpSummary> {
  "use step";
  const results = waves.flat();
  const attemptedSamples = results.map((result) => result.sample);
  const completeSamples = attemptedSamples.filter(
    (sample) => sample.status === "complete",
  );
  const unavailableStages: string[] = [];
  if (attemptedSamples.length > 0 && completeSamples.length === 0) {
    unavailableStages.push(KEYWORD_STAGE_SERP_SAMPLE);
  } else if (completeSamples.length < attemptedSamples.length) {
    unavailableStages.push(KEYWORD_STAGE_SERP_SAMPLE_PARTIAL);
  }
  return {
    attemptedSamples,
    completeSamples,
    unavailableStages,
    costs: mergeKeywordCostSnapshots(results.map((result) => result.costs)),
    durationMs: sumDurations(
      waves.map((wave) => maxDuration(wave.map((result) => result.durationMs))),
    ),
  };
}
keywordSerpSummaryStep.maxRetries = 0;

export async function keywordInterpretationStep(
  samples: readonly KeywordSerpSampleResult[],
): Promise<KeywordInterpretationStageResult> {
  "use step";
  const usage = createKeywordLlmUsageSink();
  const llm = createKeywordLlmSeams({ onUsage: usage.add });
  return runKeywordInterpretationStage(
    { samples },
    { now: () => new Date(), interpretSerpEvidence: llm.interpretSerpEvidence, llmUsage: usage.total },
  );
}
keywordInterpretationStep.maxRetries = 0;

export async function keywordInterpretationSummaryStep(
  groups: readonly (readonly KeywordInterpretationStageResult[])[],
): Promise<InterpretationSummary> {
  "use step";
  const results = groups.flat();
  return {
    entries: results.flatMap((result) => result.entries),
    unavailableStages: results.some(
      (result) => result.availability === "unavailable",
    )
      ? [KEYWORD_STAGE_SERP_INTERPRETATION]
      : [],
    llm: results.reduce(
      (total, result) => mergeKeywordLlmUsage(total, result.llm),
      EMPTY_KEYWORD_LLM_USAGE,
    ),
    durationMs: sumDurations(
      groups.map((group) => maxDuration(group.map((result) => result.durationMs))),
    ),
  };
}
keywordInterpretationSummaryStep.maxRetries = 0;

export async function keywordEnrichmentTargetsStep(
  input: KeywordOpportunityWorkflowInput,
  samples: readonly KeywordSerpSampleResult[],
) {
  "use step";
  const opened = openedSnapshots(input);
  return opened === null
    ? {
        organicDomains: [],
        trafficDomains: [],
        registrationDomains: [],
        siteDomain: null,
        rankTargets: [],
      }
    : keywordEnrichmentTargets(samples, opened.token.siteUrl);
}
keywordEnrichmentTargetsStep.maxRetries = 0;

export async function keywordRankStep(
  domains: readonly string[],
): Promise<KeywordRankStageResult> {
  "use step";
  const costs = createKeywordCostAccumulator();
  const providers = createKeywordProviderSeams({ costs });
  return runKeywordRankStage(domains, {
    now: () => new Date(),
    resolveDomainRanks: providers.resolveDomainRanks,
    costs,
  });
}
keywordRankStep.maxRetries = 0;

export async function keywordTrafficStep(
  input: KeywordOpportunityWorkflowInput,
  domains: readonly string[],
): Promise<KeywordTrafficStageResult> {
  "use step";
  const opened = openedSnapshots(input);
  const costs = createKeywordCostAccumulator();
  if (opened === null) return { entries: null, costs: mergeKeywordCostSnapshots([]), durationMs: 0 };
  const providers = createKeywordProviderSeams({ costs });
  return runKeywordTrafficStage(
    { domains, marketCode: opened.token.marketCode },
    { now: () => new Date(), resolveDomainTraffic: providers.resolveDomainTraffic, costs },
  );
}
keywordTrafficStep.maxRetries = 0;

export async function keywordRegistrationStep(
  domains: readonly string[],
): Promise<KeywordRegistrationStageResult> {
  "use step";
  const costs = createKeywordCostAccumulator();
  const providers = createKeywordProviderSeams({ costs });
  return runKeywordRegistrationStage(domains, {
    now: () => new Date(),
    resolveDomainRegistrations: providers.resolveDomainRegistrations,
  });
}
keywordRegistrationStep.maxRetries = 0;

export async function keywordFailureStep(input: {
  readonly code: KeywordOpportunityErrorCode;
  readonly costs: readonly KeywordCostSnapshot[];
  readonly llm: readonly KeywordLlmUsage[];
  readonly candidateCount: number;
  readonly serpSampled: number;
}): Promise<KeywordOpportunityWorkflowOutput> {
  "use step";
  const { stepId } = getStepMetadata();
  reportKeywordWorkflowCost({
    workflowStepId: stepId,
    costs: mergeKeywordCostSnapshots(input.costs),
    candidateCount: input.candidateCount,
    serpSampled: input.serpSampled,
    reportProduced: false,
    llm: input.llm.reduce(
      (total, usage) => mergeKeywordLlmUsage(total, usage),
      EMPTY_KEYWORD_LLM_USAGE,
    ),
  });
  return { kind: "failed", code: input.code };
}
keywordFailureStep.maxRetries = 0;

export async function keywordAssemblyStep(input: {
  readonly workflow: KeywordOpportunityWorkflowInput;
  readonly generated: number;
  readonly priced: readonly KeywordPricedCandidate[];
  readonly serp: SerpSummary;
  readonly interpretation: InterpretationSummary;
  readonly ranks: KeywordRankStageResult;
  readonly traffic: KeywordTrafficStageResult;
  readonly registrations: KeywordRegistrationStageResult;
  readonly candidateLlm: KeywordLlmUsage;
  readonly validationCosts: KeywordCostSnapshot;
  readonly validationDurationMs: number | null;
  readonly coverageDurationMs: number | null;
  readonly totalStartedAt: number;
  readonly unavailableStages: readonly string[];
}): Promise<KeywordOpportunityWorkflowOutput> {
  "use step";
  const { stepId } = getStepMetadata();
  const opened = openedSnapshots(input.workflow);
  const costs = mergeKeywordCostSnapshots([
    input.validationCosts,
    input.serp.costs,
    input.ranks.costs,
    input.traffic.costs,
  ]);
  const llm = mergeKeywordLlmUsage(
    input.candidateLlm,
    input.interpretation.llm,
  );
  if (opened === null) {
    reportKeywordWorkflowCost({
      workflowStepId: stepId,
      costs,
      candidateCount: input.priced.length,
      serpSampled: input.serp.completeSamples.length,
      reportProduced: false,
      llm,
    });
    return { kind: "failed", code: "context_token_invalid" };
  }
  try {
    const payload = assembleKeywordOpportunityPayload(
      {
        token: opened.token,
        generated: input.generated,
        priced: input.priced,
        attemptedSamples: input.serp.attemptedSamples,
        interpretationEntries: input.interpretation.entries,
        domainRankEntries: input.ranks.entries,
        domainTrafficEntries: input.traffic.entries,
        domainRegistrationEntries: input.registrations.entries,
        unavailableStages: input.unavailableStages,
        completedAt: new Date().toISOString(),
        totalStartedAt: input.totalStartedAt,
        durationsMs: {
          validation: input.validationDurationMs,
          coverage: input.coverageDurationMs,
          serpSampling: input.serp.durationMs,
          serpInterpretation: input.interpretation.durationMs,
          domainEnrichment: maxDuration([
            input.ranks.durationMs,
            input.traffic.durationMs,
            input.registrations.durationMs,
          ]),
        },
      },
      { persistence: "workflow_managed" },
    );
    reportKeywordWorkflowCost({
      workflowStepId: stepId,
      costs,
      candidateCount: input.priced.length,
      serpSampled: input.serp.completeSamples.length,
      reportProduced: true,
      llm,
    });
    console.info(
      JSON.stringify({
        tool: "keyword_opportunity",
        stage: "process_ledger",
        process: payload.result.process,
      }),
    );
    return { kind: "completed", payload };
  } catch {
    reportKeywordWorkflowCost({
      workflowStepId: stepId,
      costs,
      candidateCount: input.priced.length,
      serpSampled: input.serp.completeSamples.length,
      reportProduced: false,
      llm,
    });
    return { kind: "failed", code: "keyword_source_unavailable" };
  }
}
keywordAssemblyStep.maxRetries = 0;
