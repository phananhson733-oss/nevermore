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
  type MergedCandidate,
} from "./merge.ts";
import {
  deriveConfidence,
  autoReviewState,
  type Confidence,
} from "./confidence.ts";
import { buildSummary } from "./summaries.ts";

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
  readonly reviewState: "unreviewed" | "needs_more_data";
  readonly priorityRelevant: boolean;
  readonly evidence: readonly EvidenceDraft[];
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

const DOMAINS: readonly DiagnosticDomain[] = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
];

function safeEvaluate(
  rule: DiagnosticRule,
  ctx: DiagnosticContext,
): RuleResult {
  try {
    return rule.evaluate(ctx);
  } catch (error) {
    return {
      status: "inconclusive",
      reason: `rule_error:${error instanceof Error ? error.message : "unknown"}`,
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

export function runPipeline(input: {
  projectId: string;
  ctx: DiagnosticContext;
  rules: readonly DiagnosticRule[];
  deliveryLocale: string;
}): PipelineResult {
  const { projectId, ctx, rules, deliveryLocale } = input;

  const ruleResults: RuleResultRecord[] = [];
  const buckets: { ruleId: RuleId; candidates: FindingCandidate[] }[] = [];

  for (const rule of rules) {
    const start = performance.now();
    const result = safeEvaluate(rule, ctx);
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

  // Step 8: merge candidates within the run.
  const merged = mergeRunCandidates(buckets);

  // Step 10: derive confidence; build the run findings.
  const findings: RunFinding[] = merged
    .filter((c) => c.evidence.length > 0) // step 7: a finding must have evidence
    .map((c) => {
      const confidence = deriveConfidence(c.evidence);
      const meta = FINDING_REGISTRY[c.ruleId];
      const { summary, summaryLocale } = buildSummary(
        c.ruleId,
        c.titleArgs,
        deliveryLocale,
      );
      return {
        findingKey: findingKey(projectId, c.ruleId, c.subjectRefs),
        ruleId: c.ruleId,
        ruleVersion: 1,
        ruleFamily: meta.ruleFamily,
        intent: meta.intent,
        domain: meta.domain,
        subjectRefs: c.subjectRefs,
        severity: c.severity,
        confidence,
        titleKey: meta.titleKey,
        titleArgs: c.titleArgs,
        summary,
        summaryLocale,
        reviewState: autoReviewState(confidence),
        priorityRelevant: priorityRelevant(ctx, c),
        evidence: c.evidence,
      };
    });

  return {
    ruleResults,
    findings,
    coverage: buildCoverage(ruleResults, ctx),
  };
}

function buildCoverage(
  results: readonly RuleResultRecord[],
  ctx: DiagnosticContext,
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
  if (ctx.coverage.crawl === "partial")
    limitations.push(
      "Crawl was partial; some link-graph views are incomplete.",
    );
  if (ctx.coverage.gsc === "unavailable")
    limitations.push(
      "Search Console not connected; search rules were skipped.",
    );
  if (ctx.coverage.ga4 === "unavailable")
    limitations.push("GA4 not connected; landing conversion was skipped.");
  if (ctx.coverage.csv === "unavailable")
    limitations.push("No keyword-gap CSV; content gap was skipped.");
  return { overall, domains, limitations };
}
