// @input -- persisted visibility report identity and available evidence
// @output -- client-safe history list and explicit V1 summary/V2 report union
// @pos -- read-only history HTTP contract; never represents absent V1 evidence as zero
import { z } from "zod";
import { isNormalizedGeoHost } from "../agents/geo-url.ts";
import type { VisibilityRunStatus } from "./visibility-contract.ts";
import type { StoredVisibilityRun } from "./visibility-store.ts";
import type { VisibilityEngine } from "./visibility-v2-contract.ts";
import { decodeVisibilityWire, encodeVisibilityWire, type VisibilityWire } from "./visibility-wire.ts";

export const VISIBILITY_HISTORY_LIMIT = 50;

export interface VisibilityHistoryEntry {
  readonly runId: string;
  readonly schemaVersion: "marketing-geo-visibility.v1" | "marketing-geo-visibility.v2";
  readonly kbId: string;
  readonly snapshotId: string;
  readonly snapshotRevision: number;
  /** V1 did not persist a host. A current profile must not be silently substituted. */
  readonly host: string | null;
  readonly finishedAt: string;
  readonly createdAt: string;
  readonly status: VisibilityRunStatus;
  readonly questionCount: number;
  readonly samplesPerQuestion: number;
  readonly engines: readonly VisibilityEngine[];
  readonly costUsd: number | null;
  readonly evidenceAvailability: "summary_only" | "recorded";
}
export interface VisibilityHistoryList {
  readonly runs: readonly VisibilityHistoryEntry[];
  readonly hasMore: boolean;
}
export type VisibilityHistoryRead =
  | { readonly status: "completed"; readonly evidenceAvailability: "recorded"; readonly report: VisibilityWire }
  | { readonly status: "completed"; readonly evidenceAvailability: "summary_only"; readonly summary: StoredVisibilityRun };

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().max(40).refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
const status = z.enum(["ok", "partial", "insufficient"]);
const layer = z.enum(["problem", "discovery", "comparison", "evaluation", "branded"]);
const cost = z.number().finite().nonnegative().nullable();
const text = z.string().min(1).max(8192);
const proportion = z.object({ successes: count, trials: count, point: z.number().min(0).max(1).nullable(), lo: z.number().min(0).max(1).nullable(), hi: z.number().min(0).max(1).nullable() }).strict()
  .refine((value) => value.successes <= value.trials && (value.lo === null || value.hi === null || value.lo <= value.hi));
const entrySchema = z.object({
  runId: id, schemaVersion: z.enum(["marketing-geo-visibility.v1", "marketing-geo-visibility.v2"]), kbId: id, snapshotId: id,
  snapshotRevision: count, host: z.string().max(253).refine(isNormalizedGeoHost).nullable(), finishedAt: instant, createdAt: instant,
  status, questionCount: count, samplesPerQuestion: count.positive(), engines: z.array(z.enum(["chatgpt", "perplexity"])).max(2),
  costUsd: cost, evidenceAvailability: z.enum(["summary_only", "recorded"]),
}).strict().refine((value) => new Set(value.engines).size === value.engines.length &&
  (value.schemaVersion === "marketing-geo-visibility.v1" ? value.evidenceAvailability === "summary_only" && value.host === null : value.evidenceAvailability === "recorded" && value.host !== null && value.engines.length > 0));
const listSchema = z.object({ runs: z.array(entrySchema).max(VISIBILITY_HISTORY_LIMIT), hasMore: z.boolean() }).strict()
  .refine((value) => new Set(value.runs.map((run) => run.runId)).size === value.runs.length);

const legacySummarySchema = z.object({
  runId: id, kbId: id, snapshotId: id, questionSetHash: hash, samplesPerQuestion: count.positive(), createdAt: instant,
  manifest: z.object({ schemaVersion: z.literal("marketing-geo-visibility.v1"), kbId: id, snapshotId: id, snapshotRevision: count,
    questionSetHash: hash, questionCount: count, samplesPerQuestion: count.positive(), marketCode: text, model: text, surface: text,
    startedAt: instant, finishedAt: instant, calls: count, answered: count, successRatio: z.number().min(0).max(1), costUsd: cost, status,
  }).strict(),
  metrics: z.object({ unpromptedMention: proportion, promptedMention: proportion, citation: proportion, questionsMentioned: proportion, questionsCited: proportion,
    questionsAsked: count, questionsAnswered: count, byLayer: z.array(z.object({ layer, mention: proportion, citation: proportion }).strict()).max(5),
  }).strict(),
  perQuestion: z.array(z.object({ questionId: text, text, layer, mode: z.enum(["retrieval", "demand"]), prompted: z.boolean(), answered: count, mentioned: count, citationEvaluable: count, cited: count }).strict()
    .refine((q) => q.mentioned <= q.answered && q.citationEvaluable <= q.answered && q.cited <= q.citationEvaluable)).max(2000),
  citedDomains: z.array(z.object({ domain: text, answers: count, isOwn: z.boolean(), isCompetitor: z.boolean(), sampleUrls: z.array(text).max(100) }).strict()).max(2000),
}).strict().refine((value) => value.kbId === value.manifest.kbId && value.snapshotId === value.manifest.snapshotId && value.questionSetHash === value.manifest.questionSetHash && value.samplesPerQuestion === value.manifest.samplesPerQuestion &&
  new Set(value.perQuestion.map((q) => q.questionId)).size === value.perQuestion.length);

/** The argument is the response's data field, not the HTTP envelope. */
export function parseVisibilityHistoryList(value: unknown): VisibilityHistoryList | null {
  const result = listSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** V1 is a distinct persisted summary; no missing evidence fields are defaulted. */
export function parseVisibilityHistoryRead(value: unknown): VisibilityHistoryRead | null {
  try {
    const recorded = z.object({ status: z.literal("completed"), evidenceAvailability: z.literal("recorded"), report: z.unknown() }).strict().safeParse(value);
    if (recorded.success) {
      const report = decodeVisibilityWire(recorded.data.report);
      return report === null ? null : { status: "completed", evidenceAvailability: "recorded", report: encodeVisibilityWire(report) };
    }
    // V1's four columns have a combined 565,248-byte database budget.
    if (new TextEncoder().encode(JSON.stringify(value)).length > 600_000) return null;
    const legacy = z.object({ status: z.literal("completed"), evidenceAvailability: z.literal("summary_only"), summary: legacySummarySchema }).strict().safeParse(value);
    return legacy.success ? legacy.data : null;
  } catch { return null; }
}
