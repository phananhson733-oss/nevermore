/**
 * GEO-ENTITY-001 (spec §8.3, §8.4). On the priority/commercial page set, flags
 * missing structured entity coverage (JSON-LD types) and thin proof coverage
 * (named + numeric "proof blocks"). Both are English-only inferred heuristics
 * (grade C); on non-English sites the rule is `inconclusive` rather than
 * manufacturing a defect. PURE: reads only the frozen `DiagnosticContext` — no
 * DB, network, LLM, or clock.
 */

import type { CrawlPageProjection } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";
import { hasProofBlock } from "../util/proof-block.ts";

/** Max priority/commercial pages inspected per run (spec §8.4). */
const MAX_PAGES = 20;

/** Proof-block coverage below this fraction is a defect. */
const MIN_PROOF_COVERAGE = 0.5;

/** The subject key for the aggregated priority/commercial page set. */
const PAGE_SET_REF = "page_set:priority_commercial";

const ENTITY_PROOF_LIMITATION = "Entity/proof detection is an English-only heuristic.";

type PageEntry = readonly [string, readonly CrawlPageProjection[]];

/** Up to MAX_PAGES indexable priority/commercial subjects, in stable URL order. */
function selectPages(ctx: DiagnosticContext): readonly PageEntry[] {
  return ctx
    .indexablePages()
    .filter(([url]) => ctx.isCommercial(url))
    .slice(0, MAX_PAGES);
}

function buildEvidence(
  ctx: DiagnosticContext,
  urls: readonly string[],
  claim: string,
): EvidenceDraft {
  return {
    sourceProvider: "crawl",
    origin: "derived",
    method: "inferred",
    grade: "C",
    availability: "available",
    support: "supports",
    subjectRefs: urls,
    claim,
    observedAt: ctx.observedAt("crawl"),
    limitation: ENTITY_PROOF_LIMITATION,
  };
}

function evaluate(ctx: DiagnosticContext): RuleResult {
  if (!ctx.hasDataset("crawl")) {
    return { status: "skipped", reason: "missing_dataset" };
  }
  if (!ctx.isEnglish()) {
    return { status: "inconclusive", reason: "proof_detector_english_only" };
  }

  const selected = selectPages(ctx);
  if (selected.length === 0) {
    return { status: "skipped", reason: "not_applicable" };
  }

  // These are negative subject-level facts: every healthy exact variant must
  // lack the feature before the canonical subject is counted as missing it.
  const entityMissingCount = selected.filter(([, variants]) =>
    variants.every((page) => page.jsonLd.types.length === 0),
  ).length;
  const proofCount = selected.filter(([, variants]) =>
    variants.some((page) => hasProofBlock(page.paragraphs)),
  ).length;
  const proofCoverageRatio = proofCount / selected.length;

  const entityGap = entityMissingCount === selected.length;
  const proofGap = proofCoverageRatio < MIN_PROOF_COVERAGE;

  const metrics: Record<string, number | string | null> = {
    selectedCount: selected.length,
    entityMissingCount,
    proofCoverageRatio,
  };

  if (!entityGap && !proofGap) {
    return { status: "pass", metrics };
  }

  const urls = selected.map(([url]) => url);
  const anyPriority = selected.some(([url]) => ctx.isPriority(url));
  const severity: Severity = entityGap && proofGap && anyPriority ? "high" : "medium";

  const claim =
    entityMissingCount === 0
      ? `Of ${selected.length} priority/commercial page(s), all expose at least one ` +
        `structured entity type; ${proofCount} contain a proof block ` +
        `(proof coverage ${Math.round(proofCoverageRatio * 100)}%).`
      : `Of ${selected.length} priority/commercial page(s), ${entityMissingCount} expose no ` +
        `structured entity types and ${proofCount} contain a proof block ` +
        `(proof coverage ${Math.round(proofCoverageRatio * 100)}%).`;

  const candidate: FindingCandidate = {
    subjectRefs: [PAGE_SET_REF],
    severity,
    titleArgs: {
      selectedCount: selected.length,
      entityMissingCount,
      proofCoveragePercent: Math.round(proofCoverageRatio * 100),
    },
    metrics,
    evidence: [buildEvidence(ctx, urls, claim)],
  };

  return { status: "candidate", candidates: [candidate] };
}

export const geoEntityRule = {
  id: "GEO-ENTITY-001",
  version: 1,
  domain: "geo_ai",
  requiredDatasets: [
    { dataset: "crawl", required: true },
    { dataset: "icp", required: true },
  ],
  evaluate,
} satisfies DiagnosticRule;
