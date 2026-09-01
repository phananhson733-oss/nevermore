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
import { readCompleteGeoKnowledgeBase } from "./kb-complete-read.ts";
import { projectFrozenGeoQuestions } from "./kb-consumer-projection.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { isDenseGeoName } from "../agents/geo-alias-match.ts";
import {
  GEO_VISIBILITY_SCHEMA_VERSION,
  VISIBILITY_LIMITS,
  type VisibilityErrorCode,
  type VisibilityReport,
  type VisibilitySample,
} from "./visibility-contract.ts";
import type { GeoKbCompetitor } from "./kb-contract.ts";
import type { GeoQuestion } from "./kb-questions.ts";
import { parseVisibilityEngines } from "./visibility-engines.ts";
import { buildVisibilityPlan, createVisibilityReportV2 } from "./visibility-v2.ts";
import { observeVisibilityV2 } from "./visibility-sampling-v2.ts";
import { isVisibilityReportV2, type AnyVisibilityReport, type VisibilityEngine, type VisibilitySampleV2 } from "./visibility-v2-contract.ts";
import { readPreviousVisibilityRunV2, recordVisibilityRunV2 } from "./visibility-store-v2.ts";
import { compareVisibilityReportsV2 } from "./visibility-export.ts";
import { visibilityPlanFitsWireBudget } from "./visibility-wire.ts";
import { enrichVisibilityReportV2 } from "./visibility-enrich.ts";
import type { GeoSitePriorityHints } from "./site-index-contract.ts";

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
  readonly engines?: readonly VisibilityEngine[];
  readonly recordRunId?: string;
}

export type GeoVisibilityWorkflowOutput =
  | { readonly kind: "completed"; readonly report: AnyVisibilityReport }
  | { readonly kind: "failed"; readonly code: VisibilityErrorCode };

export interface VisibilitySamplePlanItem {
  readonly question: GeoQuestion;
  readonly sampleIndex: number;
  readonly engine?: VisibilityEngine;
  readonly slotId?: string;
}

/** What every sample needs and no sample changes. */
export interface VisibilityRunContext {
  readonly officialName: string;
  readonly aliases: readonly string[];
  readonly competitors: readonly GeoKbCompetitor[];
  readonly targetHost: string;
  readonly marketCode: string;
  readonly language?: string;
}

export type VisibilityPrepareResult =
  | {
      readonly status: "ready";
      readonly context: VisibilityRunContext;
      readonly questions: readonly GeoQuestion[];
      readonly plan: readonly VisibilitySamplePlanItem[];
      readonly questionSetHash: string;
      readonly snapshotRevision: number;
      readonly priorityHints: GeoSitePriorityHints | null;
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
    if (opened.engines !== undefined && (parseVisibilityEngines(opened.engines) === null || typeof opened.recordRunId !== "string" || !/^[a-f0-9-]{36}$/.test(opened.recordRunId))) return null;
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

  const knowledge = await readCompleteGeoKnowledgeBase({
    userId: request.sub,
    kbId: request.kbId,
    snapshotId: request.snapshotId,
  });
  if (knowledge.kind !== "ok") {
    return {
      status: "failed",
      code: knowledge.kind === "missing" ? "not_found" : "store_unavailable",
    };
  }
  // The read is keyed on the revision, so this asserts the row that came back
  // is the version the visitor chose rather than trusting two identifiers to
  // agree on their own.
  const frozen = knowledge.value.snapshot;
  if (frozen.snapshotId !== request.snapshotId || frozen.kbId !== request.kbId || frozen.revision !== request.revision) {
    return { status: "failed", code: "not_found" };
  }

  const payload = frozen.payload;
  let questions: readonly GeoQuestion[];
  try { questions = projectFrozenGeoQuestions(frozen.questionSet); }
  catch { return { status: "failed", code: "store_unavailable" }; }
  const plan: VisibilitySamplePlanItem[] = [];
  for (const question of questions) {
    for (let index = 1; index <= request.samplesPerQuestion; index += 1) {
      plan.push({ question, sampleIndex: index });
    }
  }
  const finalPlan = request.engines === undefined ? plan : buildVisibilityPlan(questions, request.engines, request.samplesPerQuestion);

  // `normalizeGeoHost`, not `new URL(...).host`. The citation side canonicalizes
  // every host through that function - it lowercases, strips a leading `www.`
  // and rejects a port - and comparing its output against a raw `URL.host` is
  // an equality check between two different spellings of the same site. For a
  // knowledge base whose target is `https://www.acme.com/`, every citation of
  // acme.com would have been judged "not us" and the run would have reported a
  // permanent zero citation rate, while the domain table beside it listed
  // acme.com as the site's own. This repo has shipped that mismatch twice
  // before; the fix is to have one canonical form and no second opinion.
  const targetHost = normalizeGeoHost(payload.targetUrl) ?? "";
  const competitors = payload.competitors.map((entry) => ({ ...entry, domain: entry.domain === "" ? "" : normalizeGeoHost(entry.domain) }));
  if (request.engines !== undefined && (targetHost === "" || competitors.some((entry) => entry.domain === null))) return { status: "failed", code: "invalid_request" };
  let priorityHints: GeoSitePriorityHints | null = null;
  if (request.engines !== undefined) {
    if (knowledge.value.context !== null) {
      const context = knowledge.value.context;
      if (context.kbId !== request.kbId || context.targetHost !== targetHost || context.questionSetHash !== frozen.questionSetHash) return { status: "failed", code: "store_unavailable" };
      if (context.profile !== null) priorityHints = { snapshotId: request.snapshotId, contextHash: context.contentHash, coreFeatures: context.profile.coreFeatures };
    }
  }

  const context = {
      officialName: payload.officialName,
      aliases: payload.aliases,
      // Passed whole. The sampling layer drops the unconfirmed ones itself,
      // which keeps that rule in one place rather than in every caller.
      competitors: request.engines === undefined ? payload.competitors : [...new Map(competitors.map((entry) => [`${entry.domain ?? ""}|${entry.brandName}`, { ...entry, domain: entry.domain ?? "" }])).values()],
      targetHost,
      marketCode: payload.market.country,
      language: frozen.questionSet.language,
    };
  if (request.engines !== undefined && !visibilityPlanFitsWireBudget({ context, questions, engines: request.engines, samplesPerQuestion: request.samplesPerQuestion })) return { status: "failed", code: "invalid_request" };
  return {
    status: "ready",
    context,
    questions,
    plan: finalPlan,
    questionSetHash: frozen.questionSetHash,
    snapshotRevision: frozen.revision,
    priorityHints,
  };
}

export async function visibilitySiteEvidenceStep(prepared: Extract<VisibilityPrepareResult, { status: "ready" }>, output: GeoVisibilityWorkflowOutput): Promise<GeoVisibilityWorkflowOutput> {
  "use step";
  if (output.kind !== "completed" || !isVisibilityReportV2(output.report)) return output;
  return { kind: "completed", report: await enrichVisibilityReportV2(output.report, undefined, prepared.priorityHints) };
}
visibilitySiteEvidenceStep.maxRetries = 0;

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
  if (item.engine !== undefined && item.slotId !== undefined && context.language !== undefined) {
    return observeVisibilityV2({ ...context, language: context.language }, { ...item, engine: item.engine, slotId: item.slotId });
  }
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

  if (request.engines !== undefined && request.recordRunId !== undefined && prepared.context.language !== undefined) {
    const versioned = samples.filter((sample): sample is VisibilitySampleV2 => "engine" in sample && "slotId" in sample);
    if (versioned.length !== samples.length) return { kind: "failed", code: "internal_error" };
    const report = createVisibilityReportV2({ runId: request.recordRunId, kbId: request.kbId, snapshotId: request.snapshotId, snapshotRevision: prepared.snapshotRevision, questionSetHash: prepared.questionSetHash, startedAt: request.startedAt, finishedAt: new Date().toISOString(), context: { ...prepared.context, language: prepared.context.language }, questions: prepared.questions, samples: versioned, engines: request.engines, samplesPerQuestion: request.samplesPerQuestion });
    const previousV2 = await readPreviousVisibilityRunV2({ userId: request.sub, kbId: request.kbId, questionSetHash: prepared.questionSetHash, excludeRunId: request.recordRunId, before: request.startedAt });
    const comparisonV2 = previousV2.kind === "ok" ? compareVisibilityReportsV2(previousV2.value.report, report) : null;
    return { kind: "completed", report: comparisonV2?.compatible ? { ...report, comparison: comparisonV2.comparison } : report };
  }

  const aggregate = aggregateVisibility(prepared.questions, samples, {
    ownHost: prepared.context.targetHost,
    competitors: prepared.context.competitors,
    samplesPerQuestion: request.samplesPerQuestion,
    // Both of these were declared, tested, and never passed. Without the brand
    // names every question counts as unprompted, including the ones that name
    // the brand; without the URLs the domain table has no example links and the
    // page renders an empty evidence list under every row.
    brandNames: [
      prepared.context.officialName,
      ...prepared.context.aliases,
    ],
    citationUrls: samples.flatMap((sample) => sample.citedUrls),
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
    // The model, in the field named model. It used to hold the surface, so the
    // page printed "dataforseo_chat_gpt_llm_responses_api" where it said Model
    // and the actual model was recorded nowhere.
    model: VISIBILITY_MODEL,
    surface: VISIBILITY_SURFACE,
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
  // A run that did not draw conclusions about itself cannot serve as the
  // baseline another run is measured against. The store refuses to hand one
  // back; this is the second half of the same rule, kept here so a future
  // caller that reads a row by some other route still cannot compare to it.
  const comparable =
    previous.kind === "ok" && previous.value.manifest.status !== "insufficient"
      ? previous.value
      : null;
  const comparison =
    comparable !== null && aggregate.status !== "insufficient"
      ? compareVisibility(
          {
            runId: comparable.runId,
            finishedAt: comparable.manifest.finishedAt,
            metrics: comparable.metrics,
            questions: comparable.perQuestion.map((entry) => ({
              questionId: entry.questionId,
              text: entry.text,
              prompted: entry.prompted,
              mode: entry.mode,
              answered: entry.answered,
              mentioned: entry.mentioned,
              citationEvaluable: entry.citationEvaluable,
              cited: entry.cited,
            })),
          },
          {
            runId: "current",
            finishedAt,
            metrics: aggregate.metrics,
            questions: aggregate.questions.map((entry) => ({
              questionId: entry.questionId,
              text: entry.text,
              prompted: entry.prompted,
              mode: entry.mode,
              answered: entry.answered,
              mentioned: entry.mentioned,
              citationEvaluable: entry.citationEvaluable,
              cited: entry.cited,
            })),
          },
        )
      : null;

  // Disclosed rather than refused. The matcher can now find a brand written in
  // a script that has no spaces between words, which it could not before - but
  // the whole-word rule that stops "Acme" matching inside "AcmeCorp" has no
  // equivalent there, so a longer word containing the name counts as a mention.
  // The GEO Agent answers this by calling such alias sets out of scope and
  // reporting `unavailable`, which for a Chinese brand means the tool measures
  // nothing at all. Measuring and saying what the measurement cannot separate
  // is the better trade here; refusing to measure is not more honest, it is
  // just less useful.
  const denseScript = [
    prepared.context.officialName,
    ...prepared.context.aliases,
  ].some((name) => isDenseGeoName(name));

  const report: VisibilityReport = {
    manifest,
    metrics: aggregate.metrics,
    questions: aggregate.questions,
    citedDomains: aggregate.citedDomains,
    limits: denseScript
      ? [...VISIBILITY_LIMITS, "denseScriptMatching"]
      : [...VISIBILITY_LIMITS],
    comparison,
  };

  // Recorded whatever the outcome, because a run that mostly failed is still
  // something the visitor paid for and may want to see again. Whether it can
  // serve as a baseline is the store's call, made on the manifest's status.
  //
  // The outcome is read rather than discarded. A write that fails costs every
  // future run its baseline, and a report that says nothing about it looks
  // exactly like one that was stored - the visitor would find out weeks later,
  // when a comparison they were promised never appears.
  const recorded = await recordVisibilityRun({
    userId: request.sub,
    report,
  });

  return {
    kind: "completed",
    report:
      recorded.kind === "ok"
        ? report
        : { ...report, limits: [...report.limits, "notStored"] },
  };
}

/** A separate durable step receives the completed immutable report. Replaying
 * its RPC reuses the same run id AND bytes, including finishedAt, so an
 * ambiguous storage response cannot create a second row or a new report. */
export async function visibilityPersistStep(input: GeoVisibilityWorkflowInput, output: GeoVisibilityWorkflowOutput): Promise<GeoVisibilityWorkflowOutput> {
  "use step";
  if (output.kind !== "completed" || !isVisibilityReportV2(output.report)) return output;
  const request = openRequest(input);
  if (request === null || request.recordRunId !== output.report.manifest.runId) return { kind: "failed", code: "run_unavailable" };
  const recorded = await recordVisibilityRunV2({ userId: request.sub, report: output.report });
  return recorded.kind === "ok" ? output : { kind: "completed", report: { ...output.report, limits: [...output.report.limits, "notStored"] } };
}
