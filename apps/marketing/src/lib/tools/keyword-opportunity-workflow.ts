// @input  -- encrypted caller-bound context/grant snapshots plus one deterministic duplicate key
// @output -- a completed v3 envelope, a typed failure, or an internal redirect to the owning run
// @pos    -- deterministic Vercel Workflow orchestrator; all Node and external work is delegated to steps
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createHook } from "workflow";
import {
  keywordAssemblyStep,
  keywordCandidateStep,
  keywordCoverageStep,
  keywordEnrichmentTargetsStep,
  keywordFailureStep,
  keywordInterpretationStep,
  keywordInterpretationSummaryStep,
  keywordPreparePlanStep,
  keywordRankStep,
  keywordRegistrationStep,
  keywordSerpStep,
  keywordSerpSummaryStep,
  keywordTrafficStep,
  keywordValidationStep,
  type KeywordOpportunityWorkflowInput,
  type KeywordOpportunityWorkflowOutput,
} from "./keyword-opportunity-workflow-steps.ts";
import type {
  KeywordInterpretationStageResult,
  KeywordSerpStageResult,
} from "./keyword-opportunity-workflow-runtime.ts";

export type {
  KeywordOpportunityWorkflowInput,
  KeywordOpportunityWorkflowOutput,
} from "./keyword-opportunity-workflow-steps.ts";

function chunks<T>(
  items: readonly T[],
  width: number,
): readonly (readonly T[])[] {
  const result: (readonly T[])[] = [];
  for (let index = 0; index < items.length; index += width) {
    result.push(items.slice(index, index + width));
  }
  return result;
}

export async function keywordOpportunityWorkflow(
  input: KeywordOpportunityWorkflowInput,
): Promise<KeywordOpportunityWorkflowOutput> {
  "use workflow";
  if (!/^[a-f0-9]{64}$/.test(input.dedupeKey)) {
    return { kind: "failed", code: "invalid_input" };
  }

  using hook = createHook({ token: `keyword:${input.dedupeKey}` });
  const conflict = await hook.getConflict();
  if (conflict !== null) {
    return { kind: "redirect", ownerRunId: conflict.runId };
  }

  const candidate = await keywordCandidateStep(input);
  if (candidate.status === "failed") {
    return keywordFailureStep({
      code: candidate.code,
      costs: [],
      llm: [candidate.llm],
      candidateCount: 0,
      serpSampled: 0,
    });
  }

  const [validation, coverage] = await Promise.all([
    keywordValidationStep(input, candidate.candidates),
    keywordCoverageStep(input, candidate.candidates),
  ]);
  if (validation.status === "failed") {
    return keywordFailureStep({
      code: validation.code,
      costs: [validation.costs],
      llm: [candidate.llm],
      candidateCount: candidate.candidates.length,
      serpSampled: 0,
    });
  }

  const prepared = await keywordPreparePlanStep(
    candidate.candidates,
    validation.providerRows,
    coverage.coverage,
  );
  if (prepared.status === "failed") {
    return keywordFailureStep({
      code: prepared.code,
      costs: [validation.costs],
      llm: [candidate.llm],
      candidateCount: candidate.candidates.length,
      serpSampled: 0,
    });
  }

  const serpWaves: KeywordSerpStageResult[][] = [];
  for (const wave of chunks(prepared.sampleTargets, 10)) {
    serpWaves.push(
      await Promise.all(wave.map((keyword) => keywordSerpStep(input, keyword))),
    );
  }
  const serp = await keywordSerpSummaryStep(serpWaves);

  const interpretationGroups: KeywordInterpretationStageResult[][] = [];
  const interpretationChunks = chunks(serp.completeSamples, 10);
  for (const group of chunks(interpretationChunks, 4)) {
    interpretationGroups.push(
      await Promise.all(group.map((chunk) => keywordInterpretationStep(chunk))),
    );
  }
  const interpretation = await keywordInterpretationSummaryStep(
    interpretationGroups,
  );

  const targets = await keywordEnrichmentTargetsStep(
    input,
    serp.completeSamples,
  );
  const [ranks, traffic, registrations] = await Promise.all([
    keywordRankStep(targets.rankTargets),
    keywordTrafficStep(input, targets.trafficDomains),
    keywordRegistrationStep(targets.registrationDomains),
  ]);

  return keywordAssemblyStep({
    workflow: input,
    generated: candidate.generated,
    priced: prepared.priced,
    serp,
    interpretation,
    ranks,
    traffic,
    registrations,
    candidateLlm: candidate.llm,
    validationCosts: validation.costs,
    validationDurationMs: validation.durationMs,
    coverageDurationMs: coverage.durationMs,
    totalStartedAt: candidate.startedAt,
    unavailableStages: [
      ...coverage.unavailableStages,
      ...serp.unavailableStages,
      ...interpretation.unavailableStages,
    ],
  });
}
