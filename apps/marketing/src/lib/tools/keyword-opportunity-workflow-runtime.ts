// @input  -- one serializable keyword stage plus an injected provider, model, or GSC seam
// @output -- bounded serializable snapshots with explicit failure, cost, usage, and timing facts
// @pos    -- paid-step runtime behind the durable Workflow; no Request, cookies, gates, or orchestration directives
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  keywordCoverageProperty,
  KEYWORD_STAGE_GSC_COVERAGE,
  KEYWORD_STAGE_GSC_COVERAGE_TRUNCATED,
  type KeywordCoverageRead,
  type KeywordOpportunityErrorCode,
  type KeywordOpportunityProviderRow,
} from "@sf/public-tools/keyword-opportunity";
import { SourceError } from "@sf/sources/adapter";
import type { DomainRegistrationEvidence } from "@sf/sources/rdap/domain-registration";
import {
  snapshotKeywordCosts,
  type KeywordCostAccumulator,
  type KeywordCostSnapshot,
} from "./keyword-cost-guard.ts";
import {
  keywordCandidatePlan,
  keywordCoverageSnapshots,
  keywordInterpretationEntries,
  normalizeKeywordSerpSamples,
  unavailableKeywordSerpSample,
  type KeywordCoverageSnapshot,
} from "./keyword-opportunity-stages.ts";
import {
  EMPTY_KEYWORD_LLM_USAGE,
  KeywordLlmError,
  type KeywordLlmUsage,
} from "./keyword-llm-client.ts";
import type {
  KeywordSerpInterpretation,
  KeywordSerpInterpretationInput,
} from "./keyword-prompts.ts";
import type {
  KeywordCandidateDraft,
  KeywordContextToken,
  KeywordSerpSampleResult,
} from "./keyword-opportunity-handler.ts";
import type { KeywordWorkflowGrantSnapshot } from "./keyword-workflow-contract.ts";

interface TimedDependencies {
  readonly now: () => Date;
}

export interface KeywordCandidateStageDependencies extends TimedDependencies {
  readonly expandCandidates: (input: {
    readonly propositions: KeywordContextToken["propositions"];
    readonly pages: KeywordContextToken["pages"];
    readonly seeds: readonly string[];
    readonly languageCode: string;
    readonly cap: number;
  }) => Promise<readonly KeywordCandidateDraft[]>;
  readonly llmUsage: () => KeywordLlmUsage;
}

export type KeywordCandidateStageResult =
  | {
      readonly status: "ok";
      readonly generated: number;
      readonly candidates: readonly KeywordCandidateDraft[];
      readonly llm: KeywordLlmUsage;
      readonly startedAt: number;
      readonly durationMs: number;
    }
  | {
      readonly status: "failed";
      readonly code: KeywordOpportunityErrorCode;
      readonly llm: KeywordLlmUsage;
      readonly startedAt: number;
      readonly durationMs: number;
    };

export interface KeywordValidationStageDependencies extends TimedDependencies {
  readonly validateVolumes: (input: {
    readonly keywords: readonly string[];
    readonly marketCode: string;
    readonly languageCode: string;
  }) => Promise<readonly KeywordOpportunityProviderRow[]>;
  readonly costs: KeywordCostAccumulator;
}

export type KeywordValidationStageResult =
  | {
      readonly status: "ok";
      readonly providerRows: readonly KeywordOpportunityProviderRow[];
      readonly costs: KeywordCostSnapshot;
      readonly durationMs: number;
    }
  | {
      readonly status: "failed";
      readonly code: "keyword_source_unavailable";
      readonly costs: KeywordCostSnapshot;
      readonly durationMs: number;
    };

export interface KeywordCoverageStageDependencies extends TimedDependencies {
  readonly readCoverageQueries: (input: {
    readonly property: string;
    readonly accessToken: string;
  }) => Promise<KeywordCoverageRead>;
}

export interface KeywordCoverageStageResult {
  readonly coverage: readonly KeywordCoverageSnapshot[];
  readonly unavailableStages: readonly string[];
  readonly durationMs: number;
}

export interface KeywordSerpStageDependencies extends TimedDependencies {
  readonly sampleSerp: (input: {
    readonly keywords: readonly string[];
    readonly marketCode: string;
    readonly languageCode: string;
  }) => Promise<readonly KeywordSerpSampleResult[]>;
  readonly costs: KeywordCostAccumulator;
}

export interface KeywordSerpStageResult {
  readonly sample: KeywordSerpSampleResult;
  readonly costs: KeywordCostSnapshot;
  readonly durationMs: number;
}

export interface KeywordInterpretationStageDependencies
  extends TimedDependencies {
  readonly interpretSerpEvidence: (
    inputs: readonly KeywordSerpInterpretationInput[],
  ) => Promise<readonly KeywordSerpInterpretation[]>;
  readonly llmUsage: () => KeywordLlmUsage;
}

export interface KeywordInterpretationStageResult {
  readonly availability: "complete" | "unavailable" | "not_attempted";
  readonly entries: readonly (
    readonly [string, KeywordSerpInterpretation | null]
  )[];
  readonly llm: KeywordLlmUsage;
  readonly durationMs: number | null;
}

function thrownSerpFailureReason(
  error: unknown,
): "transport_outcome_unknown" | "provider_unavailable" {
  return error instanceof SourceError && error.code !== "TIMEOUT"
    ? "provider_unavailable"
    : "transport_outcome_unknown";
}

export interface KeywordRankStageDependencies extends TimedDependencies {
  readonly resolveDomainRanks: (
    domains: readonly string[],
  ) => Promise<ReadonlyMap<string, number>>;
  readonly costs: KeywordCostAccumulator;
}

export interface KeywordTrafficStageDependencies extends TimedDependencies {
  readonly resolveDomainTraffic: (input: {
    readonly domains: readonly string[];
    readonly marketCode: string;
  }) => Promise<ReadonlyMap<string, number | null> | null>;
  readonly costs: KeywordCostAccumulator;
}

export interface KeywordRegistrationStageDependencies
  extends TimedDependencies {
  readonly resolveDomainRegistrations: (
    domains: readonly string[],
  ) => Promise<ReadonlyMap<string, DomainRegistrationEvidence>>;
}

export interface KeywordRankStageResult {
  readonly entries: readonly (readonly [string, number])[] | null;
  readonly costs: KeywordCostSnapshot;
  readonly durationMs: number | null;
}

export interface KeywordTrafficStageResult {
  readonly entries: readonly (readonly [string, number | null])[] | null;
  readonly costs: KeywordCostSnapshot;
  readonly durationMs: number | null;
}

export interface KeywordRegistrationStageResult {
  readonly entries:
    | readonly (readonly [string, DomainRegistrationEvidence])[]
    | null;
  readonly durationMs: number | null;
}

function elapsed(startedAt: number, now: () => Date): number {
  return Math.max(0, now().getTime() - startedAt);
}

export async function runKeywordCandidateStage(
  input: { readonly token: KeywordContextToken; readonly cap: number },
  dependencies: KeywordCandidateStageDependencies,
): Promise<KeywordCandidateStageResult> {
  const startedAt = dependencies.now().getTime();
  try {
    const drafts = await dependencies.expandCandidates({
      propositions: input.token.propositions,
      pages: input.token.pages,
      seeds: input.token.seeds,
      languageCode: input.token.languageCode,
      cap: input.cap,
    });
    const plan = keywordCandidatePlan(drafts, input.cap);
    return {
      status: "ok",
      generated: plan.generated,
      candidates: Object.freeze([...plan.candidates]),
      llm: dependencies.llmUsage(),
      startedAt,
      durationMs: elapsed(startedAt, dependencies.now),
    };
  } catch (error) {
    return {
      status: "failed",
      code:
        error instanceof KeywordLlmError
          ? error.code
          : "keyword_generation_unavailable",
      llm: dependencies.llmUsage(),
      startedAt,
      durationMs: elapsed(startedAt, dependencies.now),
    };
  }
}

export async function runKeywordValidationStage(
  input: {
    readonly token: KeywordContextToken;
    readonly candidates: readonly KeywordCandidateDraft[];
  },
  dependencies: KeywordValidationStageDependencies,
): Promise<KeywordValidationStageResult> {
  const startedAt = dependencies.now().getTime();
  try {
    const providerRows = await dependencies.validateVolumes({
      keywords: input.candidates.map((candidate) => candidate.keyword),
      marketCode: input.token.marketCode,
      languageCode: input.token.languageCode,
    });
    return {
      status: "ok",
      providerRows: Object.freeze([...providerRows]),
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  } catch {
    return {
      status: "failed",
      code: "keyword_source_unavailable",
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  }
}

export async function runKeywordCoverageStage(
  input: {
    readonly token: KeywordContextToken;
    readonly grant: KeywordWorkflowGrantSnapshot;
    readonly candidates: readonly KeywordCandidateDraft[];
  },
  dependencies: KeywordCoverageStageDependencies,
): Promise<KeywordCoverageStageResult> {
  const startedAt = dependencies.now().getTime();
  const unavailableStages: string[] = [];
  let coverageRead: KeywordCoverageRead | null = null;
  const property = keywordCoverageProperty(
    input.token.siteUrl,
    input.grant.properties,
  );
  if (property === null) {
    unavailableStages.push(KEYWORD_STAGE_GSC_COVERAGE);
  } else {
    try {
      coverageRead = await dependencies.readCoverageQueries({
        property,
        accessToken: input.grant.accessToken,
      });
      if (
        coverageRead.queryPaging.truncated ||
        coverageRead.queryPagePaging.truncated
      ) {
        unavailableStages.push(KEYWORD_STAGE_GSC_COVERAGE_TRUNCATED);
      }
    } catch {
      unavailableStages.push(KEYWORD_STAGE_GSC_COVERAGE);
    }
  }
  return {
    coverage: keywordCoverageSnapshots(
      input.token,
      input.candidates,
      coverageRead,
    ),
    unavailableStages,
    durationMs: elapsed(startedAt, dependencies.now),
  };
}

export async function runKeywordSerpStage(
  input: {
    readonly keyword: string;
    readonly marketCode: string;
    readonly languageCode: string;
  },
  dependencies: KeywordSerpStageDependencies,
): Promise<KeywordSerpStageResult> {
  const startedAt = dependencies.now().getTime();
  const observedAt = dependencies.now().toISOString();
  try {
    const returned = await dependencies.sampleSerp({
      keywords: [input.keyword],
      marketCode: input.marketCode,
      languageCode: input.languageCode,
    });
    return {
      sample:
        normalizeKeywordSerpSamples(
          [input.keyword],
          returned,
          observedAt,
        )[0] ??
        unavailableKeywordSerpSample(
          input.keyword,
          "provider_unavailable",
        ),
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  } catch (error) {
    return {
      sample: unavailableKeywordSerpSample(
        input.keyword,
        thrownSerpFailureReason(error),
      ),
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  }
}

export function keywordSerpWaves(
  keywords: readonly string[],
  width = 10,
): readonly (readonly string[])[] {
  if (!Number.isSafeInteger(width) || width < 1) {
    throw new Error("SERP wave width must be a positive safe integer");
  }
  const waves: (readonly string[])[] = [];
  for (let index = 0; index < keywords.length; index += width) {
    waves.push(Object.freeze(keywords.slice(index, index + width)));
  }
  return Object.freeze(waves);
}

export function keywordInterpretationInputs(
  samples: readonly KeywordSerpSampleResult[],
  observedAt: string,
): readonly KeywordSerpInterpretationInput[] {
  return samples.map((sample) => ({
    keyword: sample.keyword,
    observedAt: sample.observedAt ?? observedAt,
    organicResults: sample.results.map((result) => ({
      position: result.position,
      title: result.title ?? null,
      url: result.url ?? null,
    })),
    aiOverviewMarkdown: sample.aiOverview?.markdown ?? null,
  }));
}

export async function runKeywordInterpretationStage(
  input: { readonly samples: readonly KeywordSerpSampleResult[] },
  dependencies: KeywordInterpretationStageDependencies,
): Promise<KeywordInterpretationStageResult> {
  if (input.samples.length === 0) {
    return {
      availability: "not_attempted",
      entries: [],
      llm: EMPTY_KEYWORD_LLM_USAGE,
      durationMs: null,
    };
  }
  const startedAt = dependencies.now().getTime();
  const interpretationInputs = keywordInterpretationInputs(
    input.samples,
    dependencies.now().toISOString(),
  );
  try {
    const returned = await dependencies.interpretSerpEvidence(
      interpretationInputs,
    );
    const entries = keywordInterpretationEntries(
      interpretationInputs,
      returned,
    );
    return {
      availability:
        entries.length < interpretationInputs.length ||
        entries.some(
          ([, interpretation]) =>
            interpretation === null ||
            interpretation.availability === "unavailable",
        )
          ? "unavailable"
          : "complete",
      entries,
      llm: dependencies.llmUsage(),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  } catch {
    return {
      availability: "unavailable",
      entries: [],
      llm: dependencies.llmUsage(),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  }
}

export async function runKeywordRankStage(
  domains: readonly string[],
  dependencies: KeywordRankStageDependencies,
): Promise<KeywordRankStageResult> {
  if (domains.length === 0) {
    return {
      entries: [],
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: null,
    };
  }
  const startedAt = dependencies.now().getTime();
  try {
    const ranks = await dependencies.resolveDomainRanks(domains);
    return {
      entries: [...ranks.entries()],
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  } catch {
    return {
      entries: null,
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  }
}

export async function runKeywordTrafficStage(
  input: { readonly domains: readonly string[]; readonly marketCode: string },
  dependencies: KeywordTrafficStageDependencies,
): Promise<KeywordTrafficStageResult> {
  if (input.domains.length === 0) {
    return {
      entries: [],
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: null,
    };
  }
  const startedAt = dependencies.now().getTime();
  try {
    const traffic = await dependencies.resolveDomainTraffic(input);
    return {
      entries: traffic === null ? null : [...traffic.entries()],
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  } catch {
    return {
      entries: null,
      costs: snapshotKeywordCosts(dependencies.costs),
      durationMs: elapsed(startedAt, dependencies.now),
    };
  }
}

export async function runKeywordRegistrationStage(
  domains: readonly string[],
  dependencies: KeywordRegistrationStageDependencies,
): Promise<KeywordRegistrationStageResult> {
  if (domains.length === 0) return { entries: [], durationMs: null };
  const startedAt = dependencies.now().getTime();
  try {
    const registrations =
      await dependencies.resolveDomainRegistrations(domains);
    return {
      entries: [...registrations.entries()],
      durationMs: elapsed(startedAt, dependencies.now),
    };
  } catch {
    return {
      entries: null,
      durationMs: elapsed(startedAt, dependencies.now),
    };
  }
}
