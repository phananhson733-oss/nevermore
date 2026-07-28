import type { ActionRow, FindingRow } from "@sf/db";
import { competitorEntityIdFromSubjectRef } from "@sf/engine";

/**
 * Diagnostic-domain row → DTO mappers (spec §8, §9, §11). Shapes match the
 * OpenAPI `Finding`, `Evidence`, `SubjectRef`, `Action`, `Coverage`, and
 * `DiagnosticRuleResult` schemas exactly. `subjectRef` strings are parsed into
 * typed `{type, value}` pairs; engine coverage `available` maps to `complete`.
 */

const SUBJECT_TYPES = [
  "http_status",
  "canonical_issue",
  "page_set",
  "keyword_cluster",
  "competitor",
  "user_agent",
  "site",
] as const;

export interface SubjectRefDto {
  type: string;
  value: string;
}

/** Parse a raw subjectRef into a typed `{type, value}` (spec `SubjectRef`). */
export function parseSubjectRef(raw: string): SubjectRefDto {
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return { type: "url", value: raw };
  }
  const idx = raw.indexOf(":");
  if (idx > 0) {
    const prefix = raw.slice(0, idx);
    if (prefix === "competitor") {
      const competitorEntityId = competitorEntityIdFromSubjectRef(raw);
      if (competitorEntityId === null) {
        throw new TypeError("invalid competitor subject reference");
      }
      return { type: prefix, value: competitorEntityId };
    }
    if ((SUBJECT_TYPES as readonly string[]).includes(prefix)) {
      return { type: prefix, value: raw.slice(idx + 1) };
    }
    throw new TypeError("unsupported subject reference type");
  }
  return { type: "url", value: raw };
}

function subjectRefs(raw: unknown[]): SubjectRefDto[] {
  return raw.filter((r): r is string => typeof r === "string").map(parseSubjectRef);
}

export interface EvidenceDto {
  id: string;
  sourceProvider: string;
  origin: string;
  method: string;
  grade: string;
  availability: string;
  support: string;
  claim: string;
  subjectRefs: SubjectRefDto[];
  observedAt: string;
  limitation: string;
  snapshotId: string | null;
  collectionRunId: string | null;
  analysisInvocationId: string | null;
}

export interface EvidenceRowLike {
  id: string;
  source_provider: string;
  origin: string;
  method: string;
  grade: string;
  availability: string;
  support: string;
  subject_refs: unknown[];
  claim: string;
  observed_at: string;
  limitation: string;
  snapshot_id: string | null;
  /** Repository reads always provide this; optional only for legacy typed fixtures. */
  collection_run_id?: string | null;
  analysis_invocation_id: string | null;
}

export function toEvidenceDto(row: EvidenceRowLike): EvidenceDto {
  return {
    id: row.id,
    sourceProvider: row.source_provider,
    origin: row.origin,
    method: row.method,
    grade: row.grade,
    availability: row.availability,
    support: row.support,
    claim: row.claim,
    subjectRefs: subjectRefs(row.subject_refs),
    observedAt: row.observed_at,
    limitation: row.limitation,
    snapshotId: row.snapshot_id,
    collectionRunId: row.collection_run_id ?? null,
    analysisInvocationId: row.analysis_invocation_id,
  };
}

export interface FindingDto {
  id: string;
  ruleId: string;
  ruleVersion: number;
  domain: string;
  titleKey: string;
  titleArgs: Record<string, unknown>;
  summary: string;
  summaryLocale: string;
  severity: string;
  confidence: string;
  reviewState: string;
  reviewRevision: number;
  active: boolean;
  regressed: boolean;
  subjectRefs: SubjectRefDto[];
  evidence: EvidenceDto[];
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

/** Strip the reserved internal key so it never leaks into the API surface. */
function publicTitleArgs(titleArgs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(titleArgs)) {
    if (k === "__priorityRelevant") continue;
    out[k] = v;
  }
  return out;
}

export function toFindingDto(row: FindingRow, evidence: EvidenceDto[]): FindingDto {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    domain: row.domain,
    titleKey: row.title_key,
    titleArgs: publicTitleArgs(row.title_args),
    summary: row.summary,
    summaryLocale: row.summary_locale,
    severity: row.severity,
    confidence: row.confidence,
    reviewState: row.review_state,
    reviewRevision: row.review_revision,
    active: row.active,
    regressed: row.regressed,
    subjectRefs: subjectRefs(row.subject_refs),
    evidence,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
  };
}

export interface ActionDto {
  id: string;
  findingId: string;
  templateId: string;
  title: string;
  description: string;
  contentLocale: string;
  priorityBand: string;
  roadmapLane: string;
  status: string;
  effort: string;
  risk: string;
  expectedOutcome: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export function toActionDto(row: ActionRow): ActionDto {
  return {
    id: row.id,
    findingId: row.source_finding_id,
    templateId: row.template_id,
    title: row.title,
    description: row.description,
    contentLocale: row.content_locale,
    priorityBand: row.priority_band,
    roadmapLane: row.roadmap_lane,
    status: row.status,
    effort: row.effort,
    risk: row.risk,
    expectedOutcome: row.expected_outcome,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CoverageAvailability = "unavailable" | "qualitative" | "partial" | "complete";

export interface CoverageDto {
  overall: "unavailable" | "partial" | "complete";
  domains: Record<string, CoverageAvailability>;
  limitations: string[];
}

/** Map engine coverage (`available`) to the API's `complete`. */
function mapAvailability(a: string): CoverageAvailability {
  if (a === "available") return "complete";
  if (a === "partial") return "partial";
  if (a === "qualitative") return "qualitative";
  return "unavailable";
}

export function toCoverageDto(raw: Record<string, unknown>): CoverageDto {
  const overallRaw = typeof raw["overall"] === "string" ? raw["overall"] : "unavailable";
  const overall = overallRaw === "available" ? "complete" : overallRaw === "partial" ? "partial" : "unavailable";
  const domainsRaw = (raw["domains"] ?? {}) as Record<string, unknown>;
  const domains: Record<string, CoverageAvailability> = {};
  for (const [k, v] of Object.entries(domainsRaw)) {
    domains[k] = mapAvailability(typeof v === "string" ? v : "unavailable");
  }
  const limitations = Array.isArray(raw["limitations"])
    ? raw["limitations"].filter((x): x is string => typeof x === "string")
    : [];
  return { overall, domains, limitations };
}

export interface RuleResultDto {
  ruleId: string;
  ruleVersion: number;
  domain: string;
  status: string;
  reason: string | null;
  durationMs: number;
}

export interface RuleResultRowLike {
  rule_id: string;
  rule_version: number;
  domain: string;
  status: string;
  reason: string | null;
  duration_ms: number;
}

export function toRuleResultDto(row: RuleResultRowLike): RuleResultDto {
  return {
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    domain: row.domain,
    status: row.status,
    reason: row.reason,
    durationMs: row.duration_ms,
  };
}
