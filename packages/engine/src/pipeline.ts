import { isBcp47LanguageTag } from "@sf/contracts";
import type { DiagnosticContext } from "./context.ts";
import type {
  DiagnosticDomain,
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleId,
  RuleResult,
  Severity,
} from "./rule.ts";
import { FINDING_REGISTRY } from "./registry.ts";
import {
  mergeRunCandidates,
  findingKey,
  DivergentFindingTargetError,
  type MergedCandidate,
} from "./merge.ts";
import {
  deriveConfidence,
  autoReviewState,
  type Confidence,
} from "./confidence.ts";
import { buildSummary } from "./summaries.ts";
import type { FindingTargetDraft } from "./target.ts";

/**
 * The fixed diagnostic pipeline (spec §8.2). Deterministic rules run in registry
 * order (LLM summaries — step 6 — are an optional later overlay, never before the
 * rules). Candidates are validated, merged within the run, and assigned confidence
 * from evidence. Cross-run resolution (step 9) and persistence happen in the
 * worker, which uses the `findingKey` computed here. A rule exception makes only
 * that rule `inconclusive`; the pipeline never throws for a single bad rule.
 */

export type DatasetAvailability = "available" | "partial" | "unavailable";

export interface RuleResultRecord {
  readonly ruleId: RuleId;
  readonly ruleVersion: number;
  readonly domain: DiagnosticDomain;
  readonly status: "pass" | "candidate" | "skipped" | "inconclusive";
  readonly reason: string | null;
  readonly metrics: Record<string, number | string | null>;
  readonly durationMs: number;
}

export interface RunFinding {
  readonly findingKey: string;
  readonly ruleId: RuleId;
  readonly ruleVersion: number;
  readonly ruleFamily: string;
  readonly intent: string;
  readonly domain: DiagnosticDomain;
  readonly subjectRefs: readonly string[];
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly titleKey: string;
  readonly titleArgs: Record<string, string | number>;
  readonly summary: string;
  readonly summaryLocale: string;
  readonly summaryInvocationId: string | null;
  readonly reviewState: "unreviewed" | "needs_more_data";
  readonly priorityRelevant: boolean;
  readonly evidence: readonly EvidenceDraft[];
  readonly target: FindingTargetDraft;
}

export interface DiagnosticCoverage {
  readonly overall: DatasetAvailability;
  readonly domains: Record<DiagnosticDomain, DatasetAvailability>;
  readonly limitations: readonly string[];
}

export interface PipelineResult {
  readonly ruleResults: readonly RuleResultRecord[];
  readonly findings: readonly RunFinding[];
  readonly coverage: DiagnosticCoverage;
}

export interface FindingSummaryGenerationInput {
  readonly projectId: string;
  readonly findingKey: string;
  readonly ruleId: RuleId;
  readonly subjectRefs: readonly string[];
  readonly titleArgs: Readonly<Record<string, string | number>>;
  readonly evidence: readonly EvidenceDraft[];
  readonly outputLocale: string;
  readonly fallbackSummary: string;
  readonly fallbackLocale: string;
}

export interface GeneratedFindingSummary {
  readonly summary: string;
  readonly summaryLocale: string;
  readonly invocationId: string;
}

/** Optional, caller-owned LLM stage. Omit it to keep diagnosis deterministic. */
export type FindingSummaryGenerator = (
  input: FindingSummaryGenerationInput,
) => Promise<GeneratedFindingSummary | null>;

const DOMAINS: readonly DiagnosticDomain[] = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
];

async function safeEvaluate(
  rule: DiagnosticRule,
  ctx: DiagnosticContext,
): Promise<RuleResult> {
  try {
    return await rule.evaluate(ctx);
  } catch {
    return {
      status: "inconclusive",
      reason: "rule_error",
    };
  }
}

function priorityRelevant(
  ctx: DiagnosticContext,
  candidate: MergedCandidate,
): boolean {
  const refs = new Set<string>(candidate.subjectRefs);
  for (const e of candidate.evidence)
    for (const r of e.subjectRefs) refs.add(r);
  for (const ref of refs) if (ctx.isPriority(ref)) return true;
  return false;
}

export async function runPipeline(input: {
  projectId: string;
  ctx: DiagnosticContext;
  rules: readonly DiagnosticRule[];
  deliveryLocale: string;
  /** Unresolved discrepancies already filtered to this frozen manifest. */
  discrepancySubjectRefs?: readonly string[];
  /**
   * Optional allowlisted finding-summary stage. It is invoked only for locales
   * outside the deterministic en/zh-CN registry, and only after every rule has
   * finished. Failures/invalid output fall back without failing diagnosis.
   */
  summaryGenerator?: FindingSummaryGenerator;
}): Promise<PipelineResult> {
  const {
    projectId,
    ctx,
    rules,
    deliveryLocale,
    discrepancySubjectRefs = [],
    summaryGenerator,
  } = input;

  const ruleResults: RuleResultRecord[] = [];
  const buckets: { ruleId: RuleId; candidates: FindingCandidate[] }[] = [];
  const ruleVersionById = new Map<RuleId, number>(
    rules.map((rule) => [rule.id, rule.version]),
  );

  for (const rule of rules) {
    const start = performance.now();
    // Rules are awaited serially to preserve the fixed registry order. Both a
    // synchronous throw and an asynchronous rejection are contained by
    // safeEvaluate and make only that rule inconclusive (spec §8.3).
    const result = await safeEvaluate(rule, ctx);
    const durationMs = Math.round(performance.now() - start);

    let metrics: Record<string, number | string | null> = {};
    let reason: string | null = null;
    if (result.status === "pass") metrics = result.metrics;
    else if (result.status === "candidate") {
      buckets.push({ ruleId: rule.id, candidates: [...result.candidates] });
    } else if (result.status === "skipped") reason = result.reason;
    else reason = result.reason;

    ruleResults.push({
      ruleId: rule.id,
      ruleVersion: rule.version,
      domain: rule.domain,
      status: result.status,
      reason,
      metrics,
      durationMs,
    });
  }

  // Step 8: merge candidates within the run. A divergent explicit target is a
  // rule contract failure, not permission to abort unrelated deterministic
  // rules. Remove every involved rule, label it inconclusive, and retry.
  let activeBuckets = [...buckets];
  let merged: MergedCandidate[];
  while (true) {
    try {
      merged = mergeRunCandidates(activeBuckets);
      break;
    } catch (error) {
      if (!(error instanceof DivergentFindingTargetError)) throw error;
      const failedRuleIds = new Set(error.ruleIds);
      activeBuckets = activeBuckets.filter(
        (bucket) => !failedRuleIds.has(bucket.ruleId),
      );
      for (let index = 0; index < ruleResults.length; index += 1) {
        const result = ruleResults[index];
        if (!result || !failedRuleIds.has(result.ruleId)) continue;
        ruleResults[index] = {
          ...result,
          status: "inconclusive",
          reason: "divergent_finding_target",
          metrics: {},
        };
      }
    }
  }
  const discrepancySubjects = new Set(discrepancySubjectRefs);

  const summaries = new Map<
    string,
    { summary: string; summaryLocale: string; summaryInvocationId: string | null }
  >();
  for (const candidate of merged) {
    const key = findingKey(projectId, candidate.ruleId, candidate.subjectRefs);
    const fallback = buildSummary(
      candidate.ruleId,
      candidate.titleArgs,
      deliveryLocale,
    );
    let selected: {
      summary: string;
      summaryLocale: string;
      summaryInvocationId: string | null;
    } = {
      summary: fallback.summary,
      summaryLocale: fallback.summaryLocale,
      summaryInvocationId: null as string | null,
    };
    if (summaryGenerator && needsGeneratedSummary(deliveryLocale)) {
      try {
        const generated = await summaryGenerator({
          projectId,
          findingKey: key,
          ruleId: candidate.ruleId,
          subjectRefs: candidate.subjectRefs,
          titleArgs: candidate.titleArgs,
          evidence: candidate.evidence,
          outputLocale: deliveryLocale,
          fallbackSummary: fallback.summary,
          fallbackLocale: fallback.summaryLocale,
        });
        if (isValidGeneratedSummary(generated)) {
          selected = {
            summary: generated.summary.trim(),
            summaryLocale: generated.summaryLocale,
            summaryInvocationId: generated.invocationId,
          };
        }
      } catch {
        // Finding summaries are optional. The deterministic fallback is part of
        // the contract and an LLM/provider failure must not fail diagnosis.
      }
    }
    summaries.set(key, selected);
  }

  // Step 10: derive confidence; build the run findings.
  const findings: RunFinding[] = merged
    .filter((c) => c.evidence.length > 0) // step 7: a finding must have evidence
    .map((c) => {
      const hasDiscrepancy =
        c.subjectRefs.some((ref) => discrepancySubjects.has(ref)) ||
        c.evidence.some((evidence) =>
          evidence.subjectRefs.some((ref) => discrepancySubjects.has(ref)),
        );
      const confidence = deriveConfidence(c.evidence, { hasDiscrepancy });
      const meta = FINDING_REGISTRY[c.ruleId];
      const key = findingKey(projectId, c.ruleId, c.subjectRefs);
      const summary = summaries.get(key) ?? {
        ...buildSummary(c.ruleId, c.titleArgs, deliveryLocale),
        summaryInvocationId: null,
      };
      return {
        findingKey: key,
        ruleId: c.ruleId,
        ruleVersion: requiredRuleVersion(ruleVersionById, c.ruleId),
        ruleFamily: meta.ruleFamily,
        intent: meta.intent,
        domain: meta.domain,
        subjectRefs: c.subjectRefs,
        severity: c.severity,
        confidence,
        titleKey: meta.titleKey,
        titleArgs: c.titleArgs,
        summary: summary.summary,
        summaryLocale: summary.summaryLocale,
        summaryInvocationId: summary.summaryInvocationId,
        reviewState: autoReviewState(confidence),
        priorityRelevant: priorityRelevant(ctx, c),
        evidence: c.evidence,
        target: c.target,
      };
    });

  return {
    ruleResults,
    findings,
    coverage: buildCoverage(ruleResults, ctx, deliveryLocale),
  };
}

function requiredRuleVersion(
  ruleVersionById: ReadonlyMap<RuleId, number>,
  ruleId: RuleId,
): number {
  const version = ruleVersionById.get(ruleId);
  if (version === undefined) {
    throw new Error(`Missing rule version for candidate-producing rule ${ruleId}`);
  }
  return version;
}

function needsGeneratedSummary(locale: string): boolean {
  const normalized = locale.toLowerCase();
  return normalized !== "en" && !normalized.startsWith("en-") && normalized !== "zh-cn";
}

function isValidGeneratedSummary(
  value: GeneratedFindingSummary | null,
): value is GeneratedFindingSummary {
  if (!value || value.summary.trim().length === 0) return false;
  if (!isBcp47LanguageTag(value.summaryLocale)) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.invocationId,
  );
}

function buildCoverage(
  results: readonly RuleResultRecord[],
  ctx: DiagnosticContext,
  deliveryLocale: string,
): DiagnosticCoverage {
  const domains = {} as Record<DiagnosticDomain, DatasetAvailability>;
  for (const domain of DOMAINS) {
    const domainResults = results.filter((r) => r.domain === domain);
    const ran = domainResults.some(
      (r) => r.status === "pass" || r.status === "candidate",
    );
    const inconclusive = domainResults.some((r) => r.status === "inconclusive");
    domains[domain] = ran
      ? "available"
      : inconclusive
        ? "partial"
        : "unavailable";
  }
  const availableCount = DOMAINS.filter(
    (d) => domains[d] === "available",
  ).length;
  const overall: DatasetAvailability =
    availableCount === DOMAINS.length
      ? "available"
      : availableCount > 0
        ? "partial"
        : "unavailable";

  const limitations: string[] = [];
  const zh = deliveryLocale.toLowerCase() === "zh-cn";
  if (ctx.coverage.crawl === "partial")
    limitations.push(
      zh
        ? "Crawl 采集不完整；部分链接图视图可能缺失。"
        : "Crawl was partial; some link-graph views are incomplete.",
    );
  if (ctx.coverage.gsc === "unavailable")
    limitations.push(
      zh
        ? "未连接 Google Search Console；搜索规则已跳过。"
        : "Search Console not connected; search rules were skipped.",
    );
  if (ctx.coverage.ga4 === "unavailable")
    limitations.push(
      zh
        ? "未连接 GA4；落地页转化规则已跳过。"
        : "GA4 not connected; landing conversion was skipped.",
    );
  // The engine sees only that no keyword-gap dataset reached this run's frozen
  // manifest. It cannot see WHY: the customer may never have imported a CSV, or
  // our own DataForSEO step may have skipped itself (for example when the
  // project language is still undetermined). Naming one of those as the cause
  // would be an accusation we cannot support, so the copy states the run fact
  // and both open possibilities. Attributing this precisely needs the Analysis
  // Refresh step's `skip_reason` carried into DiagnosticContext.coverage.
  if (ctx.coverage.csv === "unavailable")
    limitations.push(
      zh
        ? "本次诊断没有可用的关键词差距数据：未导入 CSV，或本轮未采集到 DataForSEO 快照；内容差距规则已跳过。"
        : "This run had no keyword-gap dataset: no CSV was imported, or no DataForSEO snapshot was collected for it; content gap was skipped.",
    );
  return { overall, domains, limitations };
}
