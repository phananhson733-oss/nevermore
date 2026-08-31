// @input -- a complete V2 report or untrusted portable JSON
// @output -- validated evidence and question-paired comparison, never server ownership
// @pos -- shared report export/import trust boundary
import { codePointLength, hasLoneSurrogate } from "../agents/geo-canonical.ts";
import { GEO_MAX_MENTION_SNIPPET_CODE_POINTS } from "../agents/geo-alias-match.ts";
import { isNormalizedGeoCitationUrl, isNormalizedGeoHost, normalizeGeoHost } from "../agents/geo-url.ts";
import type { GeoQuestion } from "./kb-questions.ts";
import { VISIBILITY_ENGINE_CONFIG, parseVisibilityEngines } from "./visibility-engines.ts";
import { compareVisibility, MIN_PAIRED_QUESTIONS_FOR_TEST } from "./visibility-metrics.ts";
import { aggregateVisibilityV2, visibilitySovClusters } from "./visibility-v2.ts";
import { compareVisibilitySov, type VisibilitySovCluster } from "./visibility-sov.ts";
import { decodeVisibilityWire, encodeVisibilityWire, postgresJsonbTextBytes, VISIBILITY_WIRE_SCHEMA, VISIBILITY_MAX_WIRE_SLOTS } from "./visibility-wire.ts";
import { parseVisibilitySiteEvidence } from "./site-index-validate.ts";
import { classifyVisibilityGaps } from "./gap-classify.ts";
import { benjaminiHochberg, mcnemarExactP, wilson } from "./stats.ts";
import type { VisibilityProportion } from "./visibility-contract.ts";
import { GEO_VISIBILITY_V2, type VisibilityContextV2, type VisibilityEngine, type VisibilityReportV2, type VisibilitySampleV2, type VisibilityComparisonV2 } from "./visibility-v2-contract.ts";

export const VISIBILITY_EXPORT_MAX_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const LAYERS = ["problem", "discovery", "comparison", "evaluation", "branded"];
const BASE_LIMITS = ["sampledNotCensus", "demandQuestions", "notAttribution", "confirmedSubset", "rankObservedOnly"];
const ALLOWED_LIMITS = [...BASE_LIMITS, "perplexityWordingUncalibrated", "notStored", "denseScriptMatching", "citationEvidenceTruncated", "topicEvidenceTruncated", "answerEvidenceTruncated", "siteEvidenceBudget", "siteEvidenceUnavailable"];
type Row = Record<string, unknown>;
function requireValue(condition: unknown): asserts condition { if (!condition) throw new Error("Invalid visibility report"); }
function row(value: unknown): Row {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  requireValue(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  return value as Row;
}
function exact(value: unknown, names: readonly string[]): Row {
  const object = row(value);
  requireValue(Object.keys(object).length === names.length && names.every((name) => Object.hasOwn(object, name)));
  return object;
}
function text(value: unknown, max: number, empty = false): value is string {
  // eslint-disable-next-line no-control-regex -- reject invisible data instead of repairing imported evidence.
  return typeof value === "string" && (empty || value.length > 0) && value.length <= max && value.trim() === value && value.normalize("NFC") === value && !/[\u0000-\u001f\u007f]/u.test(value) && !hasLoneSurrogate(value);
}
function count(value: unknown, max: number, min = 0): value is number { return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max; }
function amount(value: unknown): value is number | null { return value === null || typeof value === "number" && Number.isFinite(value) && value >= 0; }
function instant(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function list(value: unknown, max: number): unknown[] { requireValue(Array.isArray(value) && value.length <= max); return value; }
function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  const values = list(value, maxItems);
  requireValue(values.every((entry) => text(entry, maxLength)) && new Set(values).size === values.length);
  return values as string[];
}
/** Expected is already bounded: unknown extra nested structure never drives recursion. */
function same(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return actual === expected;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((entry, index) => same(actual[index], entry));
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
  const a = actual as Row, b = expected as Row;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(b).every((key) => Object.hasOwn(a, key) && same(a[key], b[key]));
}
function contextFrom(value: unknown): VisibilityContextV2 {
  const c = exact(value, ["officialName", "aliases", "competitors", "targetHost", "marketCode", "language"]);
  requireValue(text(c.officialName, 200) && isNormalizedGeoHost(c.targetHost));
  strings(c.aliases, 12, 200);
  requireValue(typeof c.marketCode === "string" && /^[A-Z]{2}$/u.test(c.marketCode) && text(c.language, 35));
  requireValue(Intl.getCanonicalLocales(c.language).length === 1);
  const competitors = list(c.competitors, 5).map((entry) => {
    const rival = exact(entry, ["domain", "brandName", "confirmed", ...(Object.hasOwn(row(entry), "aliases") ? ["aliases"] : [])]);
    requireValue(rival.domain === "" || isNormalizedGeoHost(rival.domain));
    requireValue(text(rival.brandName, 200, true) && typeof rival.confirmed === "boolean");
    requireValue(!rival.confirmed || rival.brandName.length > 0);
    if (Object.hasOwn(rival, "aliases")) strings(rival.aliases, 10, 200);
    return rival;
  });
  requireValue(new Set(competitors.map((entry) => `${String(entry.domain)}|${String(entry.brandName)}`)).size === competitors.length);
  return c as unknown as VisibilityContextV2;
}
function questionFrom(value: unknown): GeoQuestion {
  const q = exact(value, ["id", "text", "layer", "mode", "roleId", "requiredEntities", "templateId", "calibrated"]);
  requireValue(typeof q.id === "string" && /^[A-Za-z0-9_.-]{1,120}$/u.test(q.id));
  requireValue(text(q.text, 500) && typeof q.layer === "string" && LAYERS.includes(q.layer) && typeof q.mode === "string" && ["retrieval", "demand"].includes(q.mode));
  requireValue(q.roleId === null || text(q.roleId, 64));
  requireValue(q.templateId === null || text(q.templateId, 120));
  requireValue(typeof q.calibrated === "boolean");
  // The frozen v1 builder concatenates role/category entities without deduping.
  // Preserve that exact array; a portable reader must not rewrite its identity.
  requireValue(list(q.requiredEntities, 8).every((entity) => text(entity, 200, true)));
  return q as unknown as GeoQuestion;
}
function sampleFrom(value: unknown, question: GeoQuestion, context: VisibilityContextV2, engines: readonly VisibilityEngine[], n: number): VisibilitySampleV2 {
  const s = exact(value, ["engine", "slotId", "modelRequested", "modelObserved", "providerTaskId", "listPosition", "questionId", "sampleIndex", "status", "webSearchPerformed", "mentioned", "cited", "citedDomains", "citedUrls", "competitorsMentioned", "excerpt", "costUsd", "observedAt", "answerExcerpt", "answerExcerptTruncated", "subtopics", "subtopicsOmitted", "competitorPositions", "citedDomainsOmitted", "citedUrlsOmitted", "excerptOmitted"]);
  requireValue(engines.includes(s.engine as VisibilityEngine) && s.questionId === question.id && count(s.sampleIndex, n, 1));
  requireValue(s.slotId === `${String(s.engine)}:${question.id}:${String(s.sampleIndex)}`);
  requireValue(s.modelRequested === VISIBILITY_ENGINE_CONFIG[s.engine as VisibilityEngine].modelRequested);
  requireValue(s.modelObserved === null || text(s.modelObserved, 200));
  requireValue(s.providerTaskId === null || text(s.providerTaskId, 120));
  requireValue(s.listPosition === null || count(s.listPosition, 30, 1));
  requireValue(typeof s.status === "string" && ["ok", "timeout", "blocked", "error"].includes(s.status) && typeof s.mentioned === "boolean");
  requireValue(s.webSearchPerformed === null || typeof s.webSearchPerformed === "boolean");
  requireValue(s.cited === null || typeof s.cited === "boolean");
  requireValue(amount(s.costUsd) && (s.excerpt === null || text(s.excerpt, GEO_MAX_MENTION_SNIPPET_CODE_POINTS * 2) && codePointLength(s.excerpt) <= GEO_MAX_MENTION_SNIPPET_CODE_POINTS));
  const domains = strings(s.citedDomains, 40, 253), urls = strings(s.citedUrls, 10, 2048), rivals = strings(s.competitorsMentioned, 5, 200);
  requireValue(domains.every(isNormalizedGeoHost) && urls.every(isNormalizedGeoCitationUrl));
  requireValue(urls.every((url) => domains.includes(normalizeGeoHost(url)!)));
  const confirmedNames = context.competitors.filter((rival) => rival.confirmed).map((rival) => rival.brandName);
  requireValue(rivals.every((name) => confirmedNames.includes(name)));
  requireValue(typeof s.excerptOmitted === "boolean" && (!s.excerptOmitted || s.excerpt === null));
  requireValue(s.answerExcerpt === null || text(s.answerExcerpt, 600) && codePointLength(s.answerExcerpt) <= 300);
  requireValue(s.answerExcerptTruncated === null || typeof s.answerExcerptTruncated === "boolean");
  requireValue(s.subtopicsOmitted === null || count(s.subtopicsOmitted, 1_000_000));
  if (s.subtopics !== null) strings(s.subtopics, 50, 120);
  requireValue(s.citedDomainsOmitted === null || count(s.citedDomainsOmitted, 40 - domains.length));
  requireValue(s.citedUrlsOmitted === null || count(s.citedUrlsOmitted, 40 - urls.length));
  if (s.competitorPositions !== null) {
    const names = new Set<string>();
    for (const value of list(s.competitorPositions, 5)) {
      const position = exact(value, ["brandName", "position"]);
      requireValue(typeof position.brandName === "string" && confirmedNames.includes(position.brandName) && rivals.includes(position.brandName) && !names.has(position.brandName) && count(position.position, 30, 1));
      names.add(position.brandName);
    }
  }
  requireValue(s.cited === null ? s.citedDomainsOmitted === null && s.citedUrlsOmitted === null : s.citedDomainsOmitted !== null && s.citedUrlsOmitted !== null);
  requireValue(s.cited === null ? domains.length === 0 && urls.length === 0 : s.cited === domains.includes(context.targetHost));
  requireValue(s.cited !== true || urls.some((url) => normalizeGeoHost(url) === context.targetHost));
  requireValue(s.mentioned || s.excerpt === null);
  requireValue(s.listPosition === null || s.mentioned);
  if (s.status === "ok") requireValue(instant(s.observedAt) && s.subtopics !== null && s.subtopicsOmitted !== null && s.competitorPositions !== null && typeof s.answerExcerptTruncated === "boolean" && (s.answerExcerpt !== null || s.answerExcerptTruncated));
  else requireValue(s.observedAt === null && s.webSearchPerformed === null && !s.mentioned && s.cited === null && domains.length === 0 && urls.length === 0 && rivals.length === 0 && s.excerpt === null && s.listPosition === null && s.modelObserved === null && s.providerTaskId === null && s.answerExcerpt === null && s.answerExcerptTruncated === null && s.subtopics === null && s.subtopicsOmitted === null && s.competitorPositions === null && !s.excerptOmitted);
  return s as unknown as VisibilitySampleV2;
}
function proportionFrom(value: unknown, maxTrials: number): VisibilityProportion {
  const p = exact(value, ["successes", "trials", "point", "lo", "hi"]);
  requireValue(count(p.trials, maxTrials) && count(p.successes, p.trials));
  const { level: _level, ...expected } = wilson(p.successes, p.trials);
  requireValue(same(p, expected));
  return p as unknown as VisibilityProportion;
}
function comparisonValid(value: unknown, report: VisibilityReportV2): boolean {
  if (value === null) return true;
  const c = exact(value, ["baseRunId", "baseFinishedAt", "aggregates", "questions", "shareOfVoice"]);
  requireValue(typeof c.baseRunId === "string" && UUID.test(c.baseRunId) && c.baseRunId !== report.manifest.runId && instant(c.baseFinishedAt) && c.baseFinishedAt < report.manifest.finishedAt);
  const aggregates = list(c.aggregates, 2);
  requireValue(aggregates.length === 2);
  const results = aggregates.map((value, index) => {
    const a = exact(value, ["metric", "base", "current", "diff", "gained", "lost", "pairs", "lo", "hi", "changed", "testable"]);
    const metric = index === 0 ? "questionsMentioned" : "questionsCited";
    requireValue(a.metric === metric);
    const base = proportionFrom(a.base, report.questions.length), current = proportionFrom(a.current, report.questions.length);
    requireValue(same(current, report.metrics[metric]));
    requireValue(a.diff === (base.point === null || current.point === null ? null : current.point - base.point));
    requireValue(count(a.pairs, Math.min(base.trials, current.trials)) && count(a.gained, a.pairs) && count(a.lost, a.pairs - a.gained));
    const moved = a.gained + a.lost, direction = moved === 0 ? null : wilson(a.gained, moved);
    requireValue(a.lo === (direction?.lo ?? null) && a.hi === (direction?.hi ?? null));
    requireValue(typeof a.changed === "boolean" && a.testable === (a.pairs >= MIN_PAIRED_QUESTIONS_FOR_TEST));
    return { a, p: mcnemarExactP(a.gained, a.lost), excludesEvenSplit: direction !== null && direction.lo !== null && direction.hi !== null && (direction.lo > 0.5 || direction.hi < 0.5) };
  });
  const rejects = benjaminiHochberg(results.filter(({ a }) => a.testable).map(({ p }) => p));
  let tested = 0;
  results.forEach(({ a, excludesEvenSplit }) => requireValue(a.changed === (a.testable ? Boolean(rejects[tested++]) && excludesEvenSplit : false)));
  const seen = new Set<string>();
  for (const value of list(c.questions, report.questions.length)) {
    const q = exact(value, ["questionId", "text", "baseMentioned", "currentMentioned", "of", "direction"]);
    const current = report.questions.find((entry) => entry.questionId === q.questionId);
    requireValue(current !== undefined && !seen.has(current.questionId));
    seen.add(current.questionId);
    requireValue(q.text === current.text && q.currentMentioned === current.mentioned && q.of === current.answered && count(q.baseMentioned, current.answered) && q.baseMentioned !== q.currentMentioned);
    requireValue(q.direction === (current.mentioned > q.baseMentioned ? "gained" : "lost"));
  }
  const sov = exact(c.shareOfVoice, ["baseClusters", "comparison"]);
  const currentClusters = sovClustersForReport(report);
  const baseClusters = list(sov.baseClusters, report.questions.length).map((value): VisibilitySovCluster => {
    const cluster = exact(value, ["questionId", "own", "anyBrand", "answered", "planned"]);
    requireValue(typeof cluster.questionId === "string" && currentClusters.some((entry) => entry.questionId === cluster.questionId) && count(cluster.planned, 20, 1) && cluster.planned === report.manifest.samplesPerQuestion * report.manifest.engines.length && count(cluster.answered, cluster.planned) && count(cluster.anyBrand, cluster.answered) && count(cluster.own, cluster.anyBrand));
    return cluster as unknown as VisibilitySovCluster;
  });
  requireValue(same(baseClusters.map((entry) => entry.questionId), currentClusters.map((entry) => entry.questionId)));
  requireValue(same(sov.comparison, compareVisibilitySov(baseClusters, currentClusters)));
  return true;
}
function sovClustersForReport(report: VisibilityReportV2): readonly VisibilitySovCluster[] {
  return visibilitySovClusters(report.questions.map((question) => question.definition), report.questions.flatMap((question) => question.samples), report.context, report.manifest.samplesPerQuestion * report.manifest.engines.length);
}

/** Recomputing projections proves consistency, not authenticity of imported samples. */
export function parseVisibilityReportV2(value: unknown): VisibilityReportV2 | null {
  try {
    const source = exact(value, ["manifest", "context", "metrics", "questions", "citedDomains", "aggregate", "byEngine", "limits", "comparison", "siteEvidence", "gaps"]);
    const m = exact(source.manifest, ["schemaVersion", "runId", "kbId", "snapshotId", "snapshotRevision", "questionSetHash", "questionCount", "samplesPerQuestion", "marketCode", "language", "engines", "startedAt", "finishedAt", "calls", "answered", "successRatio", "costUsd", "status", "discardedSlots", "costKnownCalls"]);
    requireValue(m.schemaVersion === GEO_VISIBILITY_V2 && [m.runId, m.kbId, m.snapshotId].every((id) => typeof id === "string" && UUID.test(id)));
    requireValue(typeof m.questionSetHash === "string" && HASH.test(m.questionSetHash) && count(m.snapshotRevision, Number.MAX_SAFE_INTEGER, 1));
    requireValue(count(m.questionCount, 200, 1) && count(m.samplesPerQuestion, 10, 1));
    requireValue(amount(m.costUsd) && count(m.calls, VISIBILITY_MAX_WIRE_SLOTS));
    requireValue(instant(m.startedAt) && instant(m.finishedAt) && m.startedAt <= m.finishedAt);
    const context = contextFrom(source.context);
    requireValue(m.marketCode === context.marketCode && m.language === context.language);
    const configs = list(m.engines, 2), engines = parseVisibilityEngines(configs.map((config) => row(config).engine));
    requireValue(engines !== null && same(configs, engines.map((engine) => VISIBILITY_ENGINE_CONFIG[engine])));
    const questionRows = list(source.questions, 200);
    requireValue(questionRows.length === m.questionCount);
    const definitions: GeoQuestion[] = [], samples: VisibilitySampleV2[] = [], ids = new Set<string>(), slots = new Set<string>(), providerTasks = new Set<string>();
    for (const value of questionRows) {
      const q = row(value), definition = questionFrom(q.definition);
      requireValue(!ids.has(definition.id)); ids.add(definition.id); definitions.push(definition);
      for (const value of list(q.samples, engines.length * m.samplesPerQuestion)) {
        const sample = sampleFrom(value, definition, context, engines, m.samplesPerQuestion);
        requireValue(!slots.has(sample.slotId)); slots.add(sample.slotId); samples.push(sample);
        if (sample.providerTaskId !== null) {
          requireValue(!providerTasks.has(sample.providerTaskId));
          providerTasks.add(sample.providerTaskId);
        }
      }
    }
    const recomputed = aggregateVisibilityV2(definitions, samples, { ...context, engines, samplesPerQuestion: m.samplesPerQuestion });
    const aggregate = { metrics: source.metrics, questions: source.questions, citedDomains: source.citedDomains };
    requireValue(same(aggregate, recomputed.aggregate) && same(source.aggregate, recomputed.aggregate) && same(source.byEngine, recomputed.byEngine));
    for (const key of ["calls", "answered", "successRatio", "status", "discardedSlots", "costUsd", "costKnownCalls"] as const) requireValue(m[key] === recomputed[key]);
    const limits = strings(source.limits, ALLOWED_LIMITS.length, 80);
    requireValue(limits.every((limit) => ALLOWED_LIMITS.includes(limit)) && BASE_LIMITS.every((limit) => limits.includes(limit)) && limits.includes("perplexityWordingUncalibrated") === engines.includes("perplexity"));
    const report = source as unknown as VisibilityReportV2;
    requireValue(comparisonValid(report.comparison, report));
    if (report.siteEvidence === null) requireValue(same(report.gaps, []));
    else {
      const evidence = parseVisibilitySiteEvidence(report.siteEvidence, report);
      requireValue(evidence !== null && same(report.gaps, classifyVisibilityGaps(report, evidence)));
    }
    requireValue(postgresJsonbTextBytes(encodeVisibilityWire(report)) <= VISIBILITY_EXPORT_MAX_BYTES);
    return report;
  } catch { return null; }
}

export function exportVisibilityJson(report: VisibilityReportV2): string {
  const validated = parseVisibilityReportV2(report);
  if (validated === null) throw new Error("Invalid visibility report");
  // Compact output preserves the same 4 MiB contract at both boundaries.
  return JSON.stringify(encodeVisibilityWire(validated));
}
export function parseVisibilityImport(text: string): { readonly ok: true; readonly report: VisibilityReportV2; readonly provenance: "imported_untrusted" } | { readonly ok: false; readonly code: string } {
  if (typeof text !== "string" || text.length > VISIBILITY_EXPORT_MAX_BYTES || new TextEncoder().encode(text).byteLength > VISIBILITY_EXPORT_MAX_BYTES) return { ok: false, code: "too_large" };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, code: "invalid_json" }; }
  try { if (row(row(value).manifest).schemaVersion !== GEO_VISIBILITY_V2) return { ok: false, code: "unsupported_version" }; } catch { return { ok: false, code: "invalid_report" }; }
  const report = row(value).wireSchema === VISIBILITY_WIRE_SCHEMA ? decodeVisibilityWire(value) : parseVisibilityReportV2(value);
  return report === null ? { ok: false, code: "invalid_report" } : { ok: true, report, provenance: "imported_untrusted" };
}
export function compareVisibilityReportsV2(base: VisibilityReportV2, current: VisibilityReportV2): { readonly compatible: true; readonly comparison: VisibilityComparisonV2 } | { readonly compatible: false; readonly reason: string } {
  if (parseVisibilityReportV2(base) === null || parseVisibilityReportV2(current) === null) return { compatible: false, reason: "invalid_report" };
  if (base.manifest.status === "insufficient" || current.manifest.status === "insufficient") return { compatible: false, reason: "insufficient" };
  if (base.manifest.runId === current.manifest.runId || base.manifest.finishedAt >= current.manifest.finishedAt) return { compatible: false, reason: "invalid_baseline" };
  if (base.manifest.kbId !== current.manifest.kbId || base.manifest.questionSetHash !== current.manifest.questionSetHash || !same(base.context, current.context) || !same(base.manifest.engines, current.manifest.engines) || base.manifest.samplesPerQuestion !== current.manifest.samplesPerQuestion || !same(base.questions.map((q) => q.definition), current.questions.map((q) => q.definition))) return { compatible: false, reason: "incompatible_configuration" };
  const observedModels = (report: VisibilityReportV2) => report.byEngine.map((entry) => [...new Set(entry.questions.flatMap((q) => q.samples.filter((s) => s.status === "ok").map((s) => s.modelObserved)))].sort());
  if (!same(observedModels(base), observedModels(current))) return { compatible: false, reason: "incompatible_configuration" };
  const side = (report: VisibilityReportV2) => ({ runId: report.manifest.runId, finishedAt: report.manifest.finishedAt, metrics: report.aggregate.metrics, questions: report.aggregate.questions });
  const baseClusters = sovClustersForReport(base);
  return { compatible: true, comparison: { ...compareVisibility(side(base), side(current)), shareOfVoice: { baseClusters, comparison: compareVisibilitySov(baseClusters, sovClustersForReport(current)) } } };
}
