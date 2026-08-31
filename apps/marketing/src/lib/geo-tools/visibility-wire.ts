// @input -- a full report or its normalized portable/store wire representation
// @output -- one sample copy on wire with deterministic explicit evidence omissions
// @pos -- client-pure codec and preflight size budget; no paid work
import type { GeoQuestion } from "./kb-questions.ts";
import { buildVisibilityPlan, createVisibilityReportV2 } from "./visibility-v2.ts";
import { VISIBILITY_ENGINE_CONFIG } from "./visibility-engines.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { parseVisibilityReportV2, VISIBILITY_EXPORT_MAX_BYTES } from "./visibility-export.ts";
import { VISIBILITY_MAX_PLAN_SLOTS, type VisibilityContextV2, type VisibilityEngine, type VisibilityReportV2, type VisibilitySampleV2 } from "./visibility-v2-contract.ts";
export const VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES = 128 * 1024;
export const VISIBILITY_WIRE_SCHEMA = "marketing-geo-visibility-file.v2";
export const VISIBILITY_MAX_WIRE_SLOTS = VISIBILITY_MAX_PLAN_SLOTS;
const OMITTED_LIMITS = ["citationEvidenceTruncated", "topicEvidenceTruncated", "answerEvidenceTruncated"] as const;
type Tuple = readonly unknown[];
export interface VisibilityWire {
  readonly wireSchema: typeof VISIBILITY_WIRE_SCHEMA;
  readonly manifest: VisibilityReportV2["manifest"];
  readonly context: VisibilityContextV2;
  readonly questions: readonly GeoQuestion[];
  readonly samples: readonly Tuple[];
  readonly limits: readonly string[];
  readonly comparison: VisibilityReportV2["comparison"];
  readonly siteEvidence: VisibilityReportV2["siteEvidence"];
  readonly gaps: VisibilityReportV2["gaps"];
}
/** Budget the representation PostgreSQL's jsonb::text check actually measures.
 * jsonb adds spaces after every comma/colon and expands decimal exponents.
 * Key ordering cannot change byte length. Normalize through JSON first so
 * toJSON/undefined/negative-zero semantics match the actual HTTP/RPC payload.
 * This is a size calculation, not a replacement for the strict wire validator.
 * Function-only work avoids executing across the codec/parser import cycle. */
export function postgresJsonbTextBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Visibility wire must be JSON");
  const utf8 = (text: string) => new TextEncoder().encode(text).byteLength;
  const numberBytes = (number: number): number => {
    const text = JSON.stringify(number);
    const exponentAt = text.indexOf("e");
    if (exponentAt < 0) return text.length;
    const coefficient = text.slice(0, exponentAt), exponent = Number(text.slice(exponentAt + 1));
    const negative = coefficient.startsWith("-") ? 1 : 0;
    const [integer = "", fraction = ""] = coefficient.slice(negative).split(".");
    const digits = integer.length + fraction.length, point = integer.length + exponent;
    return negative + (point <= 0 ? 2 - point + digits : point >= digits ? point : digits + 1);
  };
  const measure = (node: unknown): number => {
    if (node === null) return 4;
    if (typeof node === "string") return utf8(JSON.stringify(node));
    if (typeof node === "number") return numberBytes(node);
    if (typeof node === "boolean") return node ? 4 : 5;
    if (Array.isArray(node)) return 2 + node.reduce<number>((total, child) => total + measure(child), 0) + Math.max(0, node.length - 1) * 2;
    const entries = Object.entries(node as Record<string, unknown>);
    return 2 + entries.reduce((total, [key, child]) => total + utf8(JSON.stringify(key)) + 2 + measure(child), 0) + Math.max(0, entries.length - 1) * 2;
  };
  return measure(JSON.parse(serialized));
}
const byteLength = postgresJsonbTextBytes;
function tuple(sample: VisibilitySampleV2, engine: number, question: number, context: VisibilityContextV2): Tuple {
  const rival = (name: string) => context.competitors.findIndex((entry) => entry.brandName === name);
  // Fixed positional schema v2, 24 entries. Engine/question/model-requested/slot
  // identity is reconstructed from the frozen manifest and question registry.
  return [engine, question, sample.sampleIndex, sample.status, sample.webSearchPerformed, sample.mentioned, sample.cited, sample.costUsd, sample.observedAt, sample.modelObserved, sample.providerTaskId, sample.listPosition,
    sample.competitorsMentioned.map(rival), sample.citedDomains, sample.citedUrls, sample.excerpt,
    sample.answerExcerpt, sample.answerExcerptTruncated, sample.subtopics, sample.subtopicsOmitted,
    sample.competitorPositions?.map((entry) => [rival(entry.brandName), entry.position]) ?? null,
    sample.citedDomainsOmitted, sample.citedUrlsOmitted, sample.excerptOmitted];
}
/** Typed encoder only; the store/export boundary validates the full report first. */
export function encodeVisibilityWire(report: VisibilityReportV2): VisibilityWire {
  return { wireSchema: VISIBILITY_WIRE_SCHEMA, manifest: report.manifest, context: report.context,
    questions: report.questions.map((question) => question.definition),
    samples: report.questions.flatMap((question, index) => question.samples.map((sample) => tuple(sample, report.manifest.engines.findIndex((entry) => entry.engine === sample.engine), index, report.context))),
    limits: report.limits, comparison: report.comparison, siteEvidence: report.siteEvidence, gaps: report.gaps };
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid wire");
  return value as Record<string, unknown>;
}
function at<T>(items: readonly T[], index: unknown): T {
  if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= items.length) throw new Error("Invalid wire reference");
  return items[index as number]!;
}
function sampleFromTuple(value: unknown, wire: VisibilityWire): VisibilitySampleV2 {
  if (!Array.isArray(value) || value.length !== 24 || !Array.isArray(value[12])) throw new Error("Invalid wire sample");
  const t = value as Tuple;
  const config = at(wire.manifest.engines, t[0]), question = at(wire.questions, t[1]);
  const brand = (index: unknown) => at(wire.context.competitors, index).brandName;
  const positions = t[20] === null ? null : (Array.isArray(t[20]) ? t[20].map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error("Invalid rank reference");
    return { brandName: brand(entry[0]), position: entry[1] };
  }) : (() => { throw new Error("Invalid ranks"); })());
  return { engine: config.engine, questionId: question.id, sampleIndex: t[2], slotId: `${config.engine}:${question.id}:${String(t[2])}`, modelRequested: config.modelRequested,
    status: t[3], webSearchPerformed: t[4], mentioned: t[5], cited: t[6], costUsd: t[7], observedAt: t[8], modelObserved: t[9], providerTaskId: t[10], listPosition: t[11],
    competitorsMentioned: (t[12] as unknown[]).map(brand), citedDomains: t[13], citedUrls: t[14], excerpt: t[15], answerExcerpt: t[16], answerExcerptTruncated: t[17], subtopics: t[18], subtopicsOmitted: t[19], competitorPositions: positions, citedDomainsOmitted: t[21], citedUrlsOmitted: t[22], excerptOmitted: t[23] } as VisibilitySampleV2;
}
function rebuild(wire: VisibilityWire, samples: readonly VisibilitySampleV2[]): VisibilityReportV2 {
  const report = createVisibilityReportV2({ ...wire.manifest, context: wire.context, questions: wire.questions, samples, engines: wire.manifest.engines.map((entry) => entry.engine) });
  return { ...report, manifest: wire.manifest, limits: wire.limits, comparison: wire.comparison, siteEvidence: wire.siteEvidence, gaps: wire.gaps };
}
/** No provenance grant: every decoded scalar and recomputed projection is checked. */
export function decodeVisibilityWire(value: unknown): VisibilityReportV2 | null {
  try {
    const candidate = object(value);
    const keys = ["wireSchema", "manifest", "context", "questions", "samples", "limits", "comparison", "siteEvidence", "gaps"];
    if (Object.keys(candidate).length !== keys.length || keys.some((key) => !Object.hasOwn(candidate, key)) || candidate.wireSchema !== VISIBILITY_WIRE_SCHEMA || !Array.isArray(candidate.questions) || candidate.questions.length > 200 || !Array.isArray(candidate.samples) || candidate.samples.length > VISIBILITY_MAX_WIRE_SLOTS || byteLength(value) > VISIBILITY_EXPORT_MAX_BYTES) return null;
    const wire = candidate as unknown as VisibilityWire;
    return parseVisibilityReportV2(rebuild(wire, wire.samples.map((sample) => sampleFromTuple(sample, wire))));
  } catch { return null; }
}
function limitsFor(report: VisibilityReportV2, samples: readonly VisibilitySampleV2[]): readonly string[] {
  return [...report.limits.filter((limit) => !OMITTED_LIMITS.some((known) => known === limit)),
    ...(samples.some((s) => (s.citedDomainsOmitted ?? 0) > 0 || (s.citedUrlsOmitted ?? 0) > 0) ? ["citationEvidenceTruncated"] : []),
    ...(samples.some((s) => (s.subtopicsOmitted ?? 0) > 0) ? ["topicEvidenceTruncated"] : []),
    ...(samples.some((s) => s.answerExcerptTruncated === true || s.excerptOmitted) ? ["answerEvidenceTruncated"] : []),
  ];
}
/**
 * Fit evidence, never observations. Scalars/slots, source counts, competitor
 * ranks and one actual own URL survive; the retained domain table is a lower
 * bound whenever citationEvidenceTruncated is present. Omission counters grow
 * monotonically and make the projection idempotent and auditable.
 */
export function budgetVisibilityReportV2(report: VisibilityReportV2): VisibilityReportV2 {
  const wire = encodeVisibilityWire(report);
  const samples = report.questions.flatMap((q) => q.samples);
  if (samples.length > VISIBILITY_MAX_WIRE_SLOTS) throw new RangeError("Visibility plan exceeds wire capacity");
  const tuples = [...wire.samples];
  const sizes = tuples.map(byteLength);
  // Reserve maximum optional limits up front: trimming can make those appear.
  const overhead = byteLength({ ...wire, limits: [...report.limits.filter((limit) => !OMITTED_LIMITS.some((known) => known === limit)), ...OMITTED_LIMITS], samples: [], siteEvidence: null, gaps: [] }) + Math.max(0, samples.length - 1) * 2;
  let total = overhead + sizes.reduce((a, b) => a + b, 0);
  const available = VISIBILITY_EXPORT_MAX_BYTES - VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES;
  const replace = (index: number, sample: VisibilitySampleV2): void => {
    const oldTuple = tuples[index]!;
    const nextTuple = tuple(sample, oldTuple[0] as number, oldTuple[1] as number, report.context);
    const size = byteLength(nextTuple);
    total += size - sizes[index]!; sizes[index] = size; tuples[index] = nextTuple;
    samples[index] = sample;
  };
  const pass = (change: (s: VisibilitySampleV2) => VisibilitySampleV2): void => {
    for (let i = samples.length - 1; i >= 0 && total > available; i--) replace(i, change(samples[i]!));
  };
  pass((s) => s.excerpt === null ? s : { ...s, excerpt: null, excerptOmitted: true });
  pass((s) => {
    if (s.cited === null) return s;
    const own = s.cited ? s.citedUrls.find((url) => normalizeGeoHost(url) === report.context.targetHost) : undefined;
    if (s.cited && own === undefined) throw new Error("A cited observation requires its own URL");
    const urls = own === undefined ? [] : [own];
    return { ...s, citedUrls: urls, citedUrlsOmitted: (s.citedUrlsOmitted ?? 0) + s.citedUrls.length - urls.length };
  });
  pass((s) => s.answerExcerpt === null ? s : { ...s, answerExcerpt: null, answerExcerptTruncated: true });
  pass((s) => s.subtopics === null || s.subtopics.length === 0 ? s : { ...s, subtopics: [], subtopicsOmitted: (s.subtopicsOmitted ?? 0) + s.subtopics.length });
  pass((s) => {
    if (s.cited === null) return s;
    const domains = s.cited ? [report.context.targetHost] : [];
    const urls = s.citedUrls.filter((url) => domains.includes(normalizeGeoHost(url)!));
    return { ...s, citedDomains: domains, citedDomainsOmitted: (s.citedDomainsOmitted ?? 0) + s.citedDomains.length - domains.length, citedUrls: urls, citedUrlsOmitted: (s.citedUrlsOmitted ?? 0) + s.citedUrls.length - urls.length };
  });
  if (total > available) throw new RangeError("Minimum visibility evidence exceeds wire capacity");
  const result = rebuild({ ...wire, limits: limitsFor(report, samples) }, samples);
  if (byteLength(encodeVisibilityWire(result)) > VISIBILITY_EXPORT_MAX_BYTES) throw new RangeError("Visibility evidence exceeds wire capacity");
  return result;
}
export interface VisibilityWirePlan {
  readonly context: VisibilityContextV2;
  readonly questions: readonly GeoQuestion[];
  readonly engines: readonly VisibilityEngine[];
  readonly samplesPerQuestion: number;
}
/** Actual frozen metadata plus the worst minimal tuple, before provider spending. */
export function visibilityPlanFitsWireBudget(input: VisibilityWirePlan): boolean {
  try {
    const plan = buildVisibilityPlan(input.questions, input.engines, input.samplesPerQuestion);
    if (plan.length > VISIBILITY_MAX_WIRE_SLOTS) return false;
    const id = "ffffffff-ffff-4fff-8fff-ffffffffffff", time = "9999-12-31T23:59:59.999Z";
    // Positive finite costs can expand to 326 bytes (MIN_VALUE), not just
    // MAX_VALUE's 309 bytes. Both cost fields must reserve that longer form.
    const manifest = { schemaVersion: "marketing-geo-visibility.v2", runId: id, kbId: id, snapshotId: id, snapshotRevision: Number.MAX_SAFE_INTEGER, questionSetHash: "f".repeat(64), questionCount: input.questions.length, samplesPerQuestion: input.samplesPerQuestion, marketCode: input.context.marketCode, language: input.context.language, engines: input.engines.map((e) => VISIBILITY_ENGINE_CONFIG[e]), startedAt: time, finishedAt: time, calls: 1000, answered: 1000, successRatio: 0.9999999999999999, costUsd: Number.MIN_VALUE, status: "insufficient", discardedSlots: 0, costKnownCalls: 1000 };
    const ownPrefix = `https://${input.context.targetHost}/`;
    const url = ownPrefix + "x".repeat(Math.max(0, 2048 - ownPrefix.length));
    const worst: Tuple = [1,199,10,"timeout",false,false,false,Number.MIN_VALUE,time,"ࠀ".repeat(200),"ࠀ".repeat(120),30,[0,1,2,3,4],[input.context.targetHost],[url],null,null,false,[],1_000_000,[[0,30],[1,30],[2,30],[3,30],[4,30]],40,40,false];
    const metadata = { wireSchema: VISIBILITY_WIRE_SCHEMA, manifest, context: input.context, questions: input.questions, samples: [], limits: ["sampledNotCensus", "demandQuestions", "notAttribution", "confirmedSubset", "rankObservedOnly", "perplexityWordingUncalibrated", "notStored", "denseScriptMatching", ...OMITTED_LIMITS], comparison: null, siteEvidence: null, gaps: [] };
    // Existing paired comparison duplicates only changed question labels, not
    // samples. Reserve all labels plus its two small aggregate-stat records.
    const comparisonReserve = byteLength(input.questions.map((q) => ({ questionId: q.id, text: q.text, baseMentioned: 20, currentMentioned: 20, of: 20, direction: "gained" }))) + byteLength(input.questions.map((q) => ({ questionId: q.id, own: 20, anyBrand: 20, answered: 20, planned: 20 }))) + byteLength(input.questions.map((q) => q.id)) + 4096;
    return byteLength(metadata) + plan.length * (byteLength(worst) + 2) + comparisonReserve + VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES <= VISIBILITY_EXPORT_MAX_BYTES;
  } catch { return false; }
}
