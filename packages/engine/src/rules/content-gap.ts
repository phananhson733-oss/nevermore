/**
 * CONTENT-GAP-011 (spec §8.3 / §8.4, domain `content_intent`). Detects imported
 * keyword-gap clusters (CSV) that carry meaningful demand yet have no related
 * indexable page. PURE logic: no DB, no network, no LLM, no clock.
 *
 * A cluster QUALIFIES when it has >= 10 keywords AND >= 500 combined available
 * search volume (null volumes are skipped, never counted as 0 — spec §1.3). For a
 * qualifying cluster the representative demand (its highest-volume keyword, else
 * the cluster key as words) is matched against crawled pages via `intent_match.v1`
 * (English only). Only a confident `uncovered` verdict is a defect.
 */

import type { CsvKeywordProjection } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type { DiagnosticRule, EvidenceDraft, FindingCandidate } from "../rule.ts";
import { matchIntent, pageFieldBag } from "../util/intent-match.ts";

const MIN_KEYWORDS = 10;
const MIN_TOTAL_VOLUME = 500;

export const contentGapRule = {
  id: "CONTENT-GAP-011",
  version: 1,
  domain: "content_intent",
  requiredDatasets: [
    { dataset: "crawl", required: true },
    { dataset: "icp", required: true },
    { dataset: "csv", required: true },
  ],
  evaluate(ctx) {
    // CSV is the demand side of this rule; without it there is nothing to check.
    if (!ctx.hasDataset("csv")) {
      return { status: "skipped", reason: "missing_dataset" };
    }
    // Crawl is the supply side (the pages we match demand against).
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }
    // `intent_match.v1` is an English-only heuristic (spec §8.4).
    if (!ctx.isEnglish()) {
      return { status: "skipped", reason: "unsupported_language" };
    }

    const bags = buildPageBags(ctx);

    const candidates: FindingCandidate[] = [];
    let qualifyingClusters = 0;
    for (const [clusterKey, keywords] of ctx.csvClusters) {
      const summary = summarizeCluster(keywords);
      const qualifies =
        keywords.length >= MIN_KEYWORDS && summary.totalVolume >= MIN_TOTAL_VOLUME;
      if (!qualifies) continue;
      qualifyingClusters += 1;

      const target = summary.topKeyword ?? clusterKey.replace(/-/g, " ");
      const outcome = matchIntent(target, bags);
      // "covered" / "inconclusive" → not a defect.
      if (outcome !== "uncovered") continue;

      candidates.push(
        buildCandidate(ctx, clusterKey, keywords.length, summary.totalVolume),
      );
    }

    if (candidates.length > 0) {
      return { status: "candidate", candidates };
    }
    return { status: "pass", metrics: { qualifyingClusters } };
  },
} satisfies DiagnosticRule;

interface ClusterSummary {
  readonly totalVolume: number;
  readonly topKeyword: string | null;
}

/** Sum available volume (skip nulls) and pick the highest-volume keyword text. */
function summarizeCluster(keywords: readonly CsvKeywordProjection[]): ClusterSummary {
  let totalVolume = 0;
  let topKeyword: string | null = null;
  let topVolume = -1;
  for (const kw of keywords) {
    if (kw.searchVolume === null) continue;
    totalVolume += kw.searchVolume;
    if (kw.searchVolume > topVolume) {
      topVolume = kw.searchVolume;
      topKeyword = kw.keyword;
    }
  }
  return { totalVolume, topKeyword };
}

/** Token field bags for every eligible indexable page (dropping null bags). */
function buildPageBags(ctx: DiagnosticContext): ReadonlySet<string>[] {
  const bags: ReadonlySet<string>[] = [];
  for (const [subjectUrl, page] of ctx.indexablePages()) {
    let urlPath: string;
    try {
      urlPath = new URL(subjectUrl).pathname;
    } catch {
      continue;
    }
    const bag = pageFieldBag({ urlPath, title: page.title, h1: page.h1 });
    if (bag) bags.push(bag);
  }
  return bags;
}

function buildCandidate(
  ctx: DiagnosticContext,
  clusterKey: string,
  keywordCount: number,
  totalVolume: number,
): FindingCandidate {
  const subjectRef = `keyword_cluster:${clusterKey}`;
  const csvEvidence: EvidenceDraft = {
    sourceProvider: "csv",
    origin: "user_provided",
    method: "observed",
    grade: "C",
    availability: "available",
    support: "supports",
    subjectRefs: [subjectRef],
    claim: `Imported keyword cluster "${clusterKey}" carries ${keywordCount} keywords with ${totalVolume} combined monthly search volume.`,
    observedAt: ctx.observedAt("csv"),
    limitation:
      "Search volume is user-provided CSV data; clustering is a heuristic over the imported rows.",
  };
  const contentEvidence: EvidenceDraft = {
    sourceProvider: "crawl",
    origin: "derived",
    method: "inferred",
    grade: "C",
    availability: "available",
    support: "supports",
    subjectRefs: [subjectRef],
    claim: `No indexable page relates to the "${clusterKey}" keyword cluster.`,
    observedAt: ctx.observedAt("crawl"),
    limitation: "Intent match is an English-only heuristic over URL/title/H1 tokens.",
  };
  return {
    subjectRefs: [subjectRef],
    severity: "high",
    titleArgs: { clusterKey, keywordCount, totalVolume },
    metrics: { clusterKey, keywordCount, totalVolume },
    evidence: [csvEvidence, contentEvidence],
  };
}
