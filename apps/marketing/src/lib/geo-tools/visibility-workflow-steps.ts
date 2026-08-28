// @input  -- one sealed run request, and per step either the whole plan or a single sample
// @output -- serializable stage results: the plan, one judged sample, or the finished report
// @pos    -- the paid and stateful half of the visibility run; the orchestrator holds no Node access

import { open } from "../auth/sealed-cookie.ts";
import { aggregateVisibility, compareVisibility } from "./visibility-metrics.ts";
import { observeVisibilitySample } from "./visibility-sampling.ts";
import {
  readPreviousVisibilityRun,
  recordVisibilityRun,
} from "./visibility-store.ts";
import { readFrozenGeoKb } from "./kb-store.ts";
import {
  GEO_VISIBILITY_SCHEMA_VERSION,
  VISIBILITY_LIMITS,
  type VisibilityErrorCode,
  type VisibilityReport,
  type VisibilitySample,
} from "./visibility-contract.ts";
import type { GeoKbCompetitor } from "./kb-contract.ts";
import type { GeoQuestion } from "./kb-questions.ts";

/** The model the calibrated question wording was measured against. */
const VISIBILITY_MODEL = "gpt-5-2025-08-07";
/** The one surface this tool observes, named in the report rather than implied. */
const VISIBILITY_SURFACE = "dataforseo_chat_gpt_llm_responses_api";

export interface GeoVisibilityWorkflowInput {
  /** Sealed by the start route; the workflow never receives a raw identity. */
  readonly inputToken: string;
}

export interface GeoVisibilityRunRequest {
  readonly sub: string;
  readonly kbId: string;
  /** Both, so the read can prove it returned the version that was chosen. */
  readonly snapshotId: string;
  readonly revision: number;
  readonly samplesPerQuestion: number;
  readonly startedAt: string;
}

export type GeoVisibilityWorkflowOutput =
  | { readonly kind: "completed"; readonly report: VisibilityReport }
  | { readonly kind: "failed"; readonly code: VisibilityErrorCode };

export interface VisibilitySamplePlanItem {
  readonly question: GeoQuestion;
  readonly sampleIndex: number;
}

/** What every sample needs and no sample changes. */
export interface VisibilityRunContext {
  readonly officialName: string;
  readonly aliases: readonly string[];
  readonly competitors: readonly GeoKbCompetitor[];
  readonly targetHost: string;
  readonly marketCode: string;
}

export type VisibilityPrepareResult =
  | {
      readonly status: "ready";
      readonly context: VisibilityRunContext;
      readonly questions: readonly GeoQuestion[];
      readonly plan: readonly VisibilitySamplePlanItem[];
      readonly questionSetHash: string;
      readonly snapshotRevision: number;
    }
  | { readonly status: "failed"; readonly code: VisibilityErrorCode };

function openRequest(
  input: GeoVisibilityWorkflowInput,
): GeoVisibilityRunRequest | null {
  try {
    const opened = open<GeoVisibilityRunRequest>(
      "gg_geo_visibility_input",
      input.inputToken,
    );
    if (opened === null) return null;
    return typeof opened.sub === "string" &&
      typeof opened.kbId === "string" &&
      typeof opened.snapshotId === "string" &&
      Number.isSafeInteger(opened.revision) &&
      Number.isSafeInteger(opened.samplesPerQuestion)
      ? opened
      : null;
  } catch {
    return null;
  }
}

/**
 * Read the frozen version and lay out every call the run will make.
 *
 * The plan is built once and carried, so a resumed run asks exactly what the
 * first attempt asked. Rebuilding it per wave would let a knowledge base edited
 * mid-run change what the second half of the report is about, and the frozen
 * snapshot exists precisely so that cannot happen.
 */
export async function visibilityPrepareStep(
  input: GeoVisibilityWorkflowInput,
): Promise<VisibilityPrepareResult> {
  "use step";
  const request = openRequest(input);
  if (request === null) return { status: "failed", code: "run_unavailable" };

  const frozen = await readFrozenGeoKb({
    userId: request.sub,
    kbId: request.kbId,
    revision: request.revision,
  });
  if (frozen.kind !== "ok") {
    return {
      status: "failed",
      code: frozen.kind === "missing" ? "not_found" : "store_unavailable",
    };
  }
  // The read is keyed on the revision, so this asserts the row that came back
  // is the version the visitor chose rather than trusting two identifiers to
  // agree on their own.
  if (frozen.value.snapshotId !== request.snapshotId) {
    return { status: "failed", code: "not_found" };
  }

  const payload = frozen.value.payload;
  const questions = frozen.value.questionSet.questions;
  const plan: VisibilitySamplePlanItem[] = [];
  for (const question of questions) {
    for (let index = 1; index <= request.samplesPerQuestion; index += 1) {
      plan.push({ question, sampleIndex: index });
    }
  }

  let targetHost = "";
  try {
    targetHost = new URL(payload.targetUrl).host.toLowerCase();
  } catch {
    targetHost = "";
  }

  return {
    status: "ready",
    context: {
      officialName: payload.officialName,
      aliases: payload.aliases,
      // Passed whole. The sampling layer drops the unconfirmed ones itself,
      // which keeps that rule in one place rather than in every caller.
      competitors: payload.competitors,
      targetHost,
      marketCode: payload.market.country,
    },
    questions,
    plan,
    questionSetHash: frozen.value.questionSetHash,
    snapshotRevision: frozen.value.revision,
  };
}

/**
 * One paid provider call, judged.
 *
 * `maxRetries = 0`: a timeout means the provider may already have charged for
 * an answer nobody read, and repeating it buys a second charge for the same
 * question rather than a second opinion. The sampling layer retries only the
 * one class where the request never left.
 */
export async function visibilitySampleStep(
  context: VisibilityRunContext,
  item: VisibilitySamplePlanItem,
): Promise<VisibilitySample> {
  "use step";
  return observeVisibilitySample(
    {
      question: item.question,
      sampleIndex: item.sampleIndex,
      targetHost: context.targetHost,
      officialName: context.officialName,
      aliases: context.aliases,
      competitors: context.competitors,
    },
    { model: VISIBILITY_MODEL, marketCode: context.marketCode },
  );
}
visibilitySampleStep.maxRetries = 0;

/**
 * Aggregate, compare against the last run of the same question set, and record.
 *
 * The comparison is keyed on the question-set hash rather than the knowledge
 * base: a re-frozen knowledge base asks different questions, and putting those
 * side by side would report a new baseline as a change.
 */
export async function visibilityAssembleStep(
  input: GeoVisibilityWorkflowInput,
  prepared: Extract<VisibilityPrepareResult, { status: "ready" }>,
  samples: readonly VisibilitySample[],
): Promise<GeoVisibilityWorkflowOutput> {
  "use step";
  const request = openRequest(input);
  if (request === null) return { kind: "failed", code: "run_unavailable" };

  const aggregate = aggregateVisibility(prepared.questions, samples, {
    ownHost: prepared.context.targetHost,
    competitors: prepared.context.competitors,
    samplesPerQuestion: request.samplesPerQuestion,
  });

  const finishedAt = new Date().toISOString();
  const costUsd = samples.reduce<number | null>((total, sample) => {
    if (sample.costUsd === null) return total;
    return (total ?? 0) + sample.costUsd;
  }, null);

  const manifest = {
    schemaVersion: GEO_VISIBILITY_SCHEMA_VERSION,
    kbId: request.kbId,
    snapshotId: request.snapshotId,
    snapshotRevision: prepared.snapshotRevision,
    questionSetHash: prepared.questionSetHash,
    questionCount: prepared.questions.length,
    samplesPerQuestion: request.samplesPerQuestion,
    marketCode: prepared.context.marketCode,
    model: VISIBILITY_SURFACE,
    startedAt: request.startedAt,
    finishedAt,
    calls: aggregate.calls,
    answered: aggregate.answered,
    successRatio: aggregate.successRatio,
    costUsd: costUsd === null ? null : Math.round(costUsd * 1_000) / 1_000,
    status: aggregate.status,
  } as const;

  const previous = await readPreviousVisibilityRun({
    userId: request.sub,
    kbId: request.kbId,
    questionSetHash: prepared.questionSetHash,
  });
  const comparison =
    previous.kind === "ok"
      ? compareVisibility(
          {
            runId: previous.value.runId,
            finishedAt: previous.value.manifest.finishedAt,
            metrics: previous.value.metrics,
            questions: previous.value.perQuestion.map((entry) => ({
              questionId: entry.questionId,
              text: entry.text,
              answered: entry.answered,
              mentioned: entry.mentioned,
            })),
          },
          {
            runId: "current",
            finishedAt,
            metrics: aggregate.metrics,
            questions: aggregate.questions.map((entry) => ({
              questionId: entry.questionId,
              text: entry.text,
              answered: entry.answered,
              mentioned: entry.mentioned,
            })),
          },
        )
      : null;

  const report: VisibilityReport = {
    manifest,
    metrics: aggregate.metrics,
    questions: aggregate.questions,
    citedDomains: aggregate.citedDomains,
    limits: [...VISIBILITY_LIMITS],
    comparison,
  };

  // Recorded whatever the outcome, because a run that mostly failed is still
  // something the visitor paid for and may want to see again. Whether it can
  // serve as a baseline is the store's call, made on the manifest's status.
  await recordVisibilityRun({ userId: request.sub, report });

  return { kind: "completed", report };
}
