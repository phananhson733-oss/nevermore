// @input -- frozen engine/question plan and one provider observation per slot
// @output -- engine-specific and mixed metrics without duplicate sampling or invented rank
// @pos -- deterministic v2 measurement pipeline; legacy v1 remains independently readable
import type { GeoQuestion } from "./kb-questions.ts";
import { containsGeoAlias, normalizeAliasForMatch } from "../agents/geo-alias-match.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { aggregateVisibility, visibilityMetricsFromQuestions } from "./visibility-metrics.ts";
import { parseVisibilityEngines, VISIBILITY_ENGINE_CONFIG } from "./visibility-engines.ts";
import { VISIBILITY_MIN_SUCCESS_RATIO, type VisibilityRunStatus } from "./visibility-contract.ts";
import { computeVisibilitySov, type VisibilitySovCluster } from "./visibility-sov.ts";
import { GEO_VISIBILITY_V2, VISIBILITY_MAX_PLAN_SLOTS, type VisibilityContextV2, type VisibilityEngine, type VisibilityEngineAggregate, type VisibilityEngineResult, type VisibilityPlanItemV2, type VisibilityReportV2, type VisibilitySampleV2 } from "./visibility-v2-contract.ts";

export function buildVisibilityPlan(questions: readonly GeoQuestion[], engines: readonly VisibilityEngine[], samples: number): readonly VisibilityPlanItemV2[] {
  const ordered = parseVisibilityEngines(engines);
  if (ordered === null || !Number.isSafeInteger(samples) || samples < 1 || samples > 10 || questions.length < 1 || questions.length > 200 || questions.length * ordered.length * samples > VISIBILITY_MAX_PLAN_SLOTS || new Set(questions.map((q) => q.id)).size !== questions.length || questions.some((q) => !/^[A-Za-z0-9_.:/-]{1,128}$/.test(q.id))) throw new RangeError("Invalid visibility sample plan");
  return ordered.flatMap((engine) => questions.flatMap((question) => Array.from({ length: samples }, (_, index) => ({ engine, question, sampleIndex: index + 1, slotId: `${engine}:${question.id}:${index + 1}` }))));
}

/** An explicit numbered entry heading, not an arbitrary number/mention in prose. */
export function readVisibilityListPosition(text: string, names: readonly string[]): number | null {
  const entries = text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(?:#{1,6}\s+)?(\d{1,2})[.)]\s+(.{1,400})$/.exec(line);
    if (match === null) return [];
    const value = match[2] ?? "";
    const bold = /^\*\*([^*]+)\*\*/.exec(value);
    const title = bold?.[1] ?? value.split(/\s[—–-]\s|:\s/)[0] ?? "";
    return [{ index: Number(match[1]), title }];
  });
  if (entries.length < 2 || entries.length > 30 || entries.some((entry, index) => entry.index !== index + 1)) return null;
  const aliases = new Set(names.map(normalizeAliasForMatch));
  const matches = entries.filter((entry) => aliases.has(normalizeAliasForMatch(entry.title)));
  return matches.length === 1 ? matches[0]?.index ?? null : null;
}

/** Confirmed aliases identify one rival; they never create additional brands. */
export function visibilityTrackedRivals(context: VisibilityContextV2): readonly { readonly brandName: string; readonly names: readonly string[] }[] {
  const ownNames = new Set([context.officialName, ...context.aliases].map(normalizeAliasForMatch));
  const rivals = new Map<string, { readonly brandName: string; readonly names: readonly string[] }>();
  for (const entry of context.competitors) {
    const key = normalizeAliasForMatch(entry.brandName);
    if (!entry.confirmed || key === "" || ownNames.has(key) || normalizeGeoHost(entry.domain) === context.targetHost) continue;
    const previous = rivals.get(key);
    const candidates = [...(previous?.names ?? []), entry.brandName, ...(entry.aliases ?? [])];
    const names = [...new Map(candidates.filter((name) => !ownNames.has(normalizeAliasForMatch(name))).map((name) => [normalizeAliasForMatch(name), name])).values()];
    rivals.set(key, { brandName: previous?.brandName ?? entry.brandName, names });
  }
  return [...rivals.values()];
}

export function visibilitySovClusters(questions: readonly GeoQuestion[], samples: readonly VisibilitySampleV2[], context: VisibilityContextV2, plannedPerQuestion: number): readonly VisibilitySovCluster[] {
  const rivals = visibilityTrackedRivals(context);
  const trackedNames = [context.officialName, ...context.aliases, ...rivals.flatMap((rival) => rival.names)];
  const rivalKeys = new Set(rivals.map((rival) => normalizeAliasForMatch(rival.brandName)));
  return questions.filter((question) => question.layer !== "branded" && !containsGeoAlias(question.text, trackedNames)).map((question) => {
    const observed = samples.filter((sample) => sample.questionId === question.id && sample.status === "ok");
    return { questionId: question.id, own: observed.filter((sample) => sample.mentioned).length, anyBrand: observed.filter((sample) => sample.mentioned || sample.competitorsMentioned.some((name) => rivalKeys.has(normalizeAliasForMatch(name)))).length, answered: observed.length, planned: plannedPerQuestion };
  });
}

function buildAggregate(questions: readonly GeoQuestion[], samples: readonly VisibilitySampleV2[], options: VisibilityContextV2 & { readonly samplesPerQuestion: number; readonly engines: readonly VisibilityEngine[] }): VisibilityEngineAggregate {
  // V1 groups by question/sample; only its *working* index is remapped for
  // pooled arithmetic. The persisted and visible slot stays engine/q/index.
  const pooledSamples = samples.map((sample) => ({ ...sample, sampleIndex: options.engines.indexOf(sample.engine) * options.samplesPerQuestion + sample.sampleIndex }));
  const base = aggregateVisibility(questions, pooledSamples, { ownHost: options.targetHost, competitors: options.competitors, brandNames: [options.officialName, ...options.aliases], samplesPerQuestion: options.samplesPerQuestion * options.engines.length, citationUrls: samples.flatMap((sample) => sample.citedUrls) });
  const results = base.questions.map((entry) => ({ ...entry, prompted: entry.prompted || entry.layer === "branded", definition: questions.find((q) => q.id === entry.questionId)!, calibrated: options.engines.length === 1 && options.engines[0] === "chatgpt" && entry.calibrated, samples: samples.filter((sample) => sample.questionId === entry.questionId) }));
  const metrics = visibilityMetricsFromQuestions(results);
  const rivals = visibilityTrackedRivals(options);
  const trackedNames = [options.officialName, ...options.aliases, ...rivals.flatMap((rival) => rival.names)];
  const eligibleIds = new Set(questions.filter((q) => q.layer !== "branded" && !containsGeoAlias(q.text, trackedNames)).map((q) => q.id));
  const eligible = samples.filter((sample) => sample.status === "ok" && eligibleIds.has(sample.questionId));
  const sov = computeVisibilitySov(visibilitySovClusters(questions, samples, options, options.samplesPerQuestion * options.engines.length));
  const positions = eligible.flatMap((sample) => sample.listPosition === null ? [] : [sample.listPosition]);
  const covered = results.filter((question) => question.answered > 0).length;
  const byLayer = metrics.byLayer.map((row) => {
    const inLayer = results.filter((question) => question.layer === row.layer);
    const observed = inLayer.flatMap((question) => question.samples).filter((sample) => sample.status === "ok");
    const ranks = observed.flatMap((sample) => sample.listPosition === null ? [] : [sample.listPosition]);
    return { ...row, plannedSamples: inLayer.length * options.samplesPerQuestion * options.engines.length, answeredSamples: observed.length, meanPosition: { value: ranks.length === 0 ? null : ranks.reduce((a, b) => a + b, 0) / ranks.length, observations: ranks.length } };
  });
  return { questions: results, citedDomains: base.citedDomains, metrics: { ...metrics, byLayer, promptCoverage: { successes: covered, trials: questions.length, point: questions.length === 0 ? null : covered / questions.length, lo: null, hi: null },
    shareOfVoice: { ...sov, brandScope: "confirmed_brand_subset", confirmedCompetitorCount: rivals.length },
    meanPosition: { value: positions.length === 0 ? null : positions.reduce((a, b) => a + b, 0) / positions.length, observations: positions.length },
  } };
}

export function aggregateVisibilityV2(questions: readonly GeoQuestion[], samples: readonly VisibilitySampleV2[], options: VisibilityContextV2 & { readonly samplesPerQuestion: number; readonly engines: readonly VisibilityEngine[] }): { readonly aggregate: VisibilityEngineAggregate; readonly byEngine: readonly VisibilityEngineResult[]; readonly calls: number; readonly answered: number; readonly successRatio: number; readonly status: VisibilityRunStatus; readonly discardedSlots: number; readonly costUsd: number | null; readonly costKnownCalls: number } {
  const plan = buildVisibilityPlan(questions, options.engines, options.samplesPerQuestion);
  const allowed = new Set(plan.map((item) => item.slotId));
  const seen = new Set<string>();
  const kept = samples.filter((sample) => {
    if (sample.slotId !== `${sample.engine}:${sample.questionId}:${sample.sampleIndex}` || !allowed.has(sample.slotId) || seen.has(sample.slotId)) return false;
    seen.add(sample.slotId);
    return true;
  });
  const answered = kept.filter((sample) => sample.status === "ok").length;
  const successRatio = answered / plan.length;
  const discardedSlots = samples.length - kept.length;
  const status = successRatio < VISIBILITY_MIN_SUCCESS_RATIO ? "insufficient" : answered < plan.length || kept.length !== plan.length || discardedSlots > 0 ? "partial" : "ok";
  const costKnownCalls = kept.filter((sample) => sample.costUsd !== null).length;
  // A partial sum is not the total price. Preserve per-slot costs, but leave
  // total unavailable if even one planned call has no observed billing value.
  const costUsd = costKnownCalls === plan.length ? Math.round(kept.reduce((sum, sample) => sum + (sample.costUsd ?? 0), 0) * 1e6) / 1e6 : null;
  const byEngine = options.engines.map((engine): VisibilityEngineResult => {
    const engineSamples = kept.filter((sample) => sample.engine === engine);
    const calls = questions.length * options.samplesPerQuestion;
    const answered = engineSamples.filter((sample) => sample.status === "ok").length;
    const successRatio = answered / calls;
    return { engine, calls, answered, successRatio, status: successRatio < VISIBILITY_MIN_SUCCESS_RATIO ? "insufficient" : answered < calls ? "partial" : "ok", ...buildAggregate(questions, engineSamples, { ...options, engines: [engine] }) };
  });
  return { aggregate: buildAggregate(questions, kept, options), byEngine, calls: plan.length, answered, successRatio, status, discardedSlots, costUsd, costKnownCalls };
}

export interface VisibilityReportInputV2 {
  readonly runId: string;
  readonly kbId: string;
  readonly snapshotId: string;
  readonly snapshotRevision: number;
  readonly questionSetHash: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly context: VisibilityContextV2;
  readonly questions: readonly GeoQuestion[];
  readonly samples: readonly VisibilitySampleV2[];
  readonly engines: readonly VisibilityEngine[];
  readonly samplesPerQuestion: number;
}
export function createVisibilityReportV2(input: VisibilityReportInputV2): VisibilityReportV2 {
  const engines = parseVisibilityEngines(input.engines);
  if (engines === null) throw new RangeError("Invalid visibility engines");
  const result = aggregateVisibilityV2(input.questions, input.samples, { ...input.context, engines, samplesPerQuestion: input.samplesPerQuestion });
  return {
    manifest: { schemaVersion: GEO_VISIBILITY_V2, runId: input.runId, kbId: input.kbId, snapshotId: input.snapshotId, snapshotRevision: input.snapshotRevision, questionSetHash: input.questionSetHash, questionCount: input.questions.length, samplesPerQuestion: input.samplesPerQuestion, marketCode: input.context.marketCode, language: input.context.language, engines: engines.map((engine) => VISIBILITY_ENGINE_CONFIG[engine]), startedAt: input.startedAt, finishedAt: input.finishedAt, calls: result.calls, answered: result.answered, successRatio: result.successRatio, status: result.status, discardedSlots: result.discardedSlots, costUsd: result.costUsd, costKnownCalls: result.costKnownCalls },
    context: input.context,
    siteEvidence: null,
    gaps: [],
    ...result.aggregate,
    aggregate: result.aggregate,
    byEngine: result.byEngine,
    limits: ["sampledNotCensus", "demandQuestions", "notAttribution", "confirmedSubset", "rankObservedOnly", ...(engines.includes("perplexity") ? ["perplexityWordingUncalibrated"] : [])],
    comparison: null,
  };
}
