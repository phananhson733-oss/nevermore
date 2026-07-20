/**
 * CONTENT-GAP-011 (spec §8.3 / §8.4, domain `content_intent`). Detects imported
 * keyword-gap clusters (operator CSV or DataForSEO vendor observations) that
 * carry meaningful demand yet have no related
 * indexable page. PURE logic: no DB, no network, no LLM, no clock.
 *
 * A cluster QUALIFIES when it has >= 10 keywords AND >= 500 combined available
 * search volume (null volumes are skipped, never counted as 0 — spec §1.3). For a
 * qualifying cluster the frozen `cluster_key.v1` is matched against crawled pages
 * via `intent_match.v1` (English only). Only a confident `uncovered` verdict is a
 * defect.
 */

import type { CsvKeywordProjection } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type { DiagnosticRule, EvidenceDraft, FindingCandidate } from "../rule.ts";
import { matchIntent, pageFieldBag } from "../util/intent-match.ts";

const MIN_KEYWORDS = 10;
const MIN_TOTAL_VOLUME = 500;
const CSV_LIMITATION =
  "Search volume is user-provided CSV data; clustering is a heuristic over the imported rows.";
const DATAFORSEO_LIMITATION =
  "Search volume and ranking are DataForSEO vendor observations over the configured market, language, rank filter, and row cap; clustering is heuristic.";
const INTENT_LIMITATION =
  "Intent match is an English-only heuristic over URL/title/H1 tokens.";

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
    const csvAvailability = ctx.datasetAvailability("csv");
    // CSV is the demand side of this rule; without it there is nothing to check.
    if (csvAvailability === "unavailable") {
      return { status: "skipped", reason: "missing_dataset" };
    }
    // Crawl is the supply side (the pages we match demand against).
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }
    // `intent_match.v1` is an English-only heuristic (spec §8.4).
    if (!ctx.isEnglish()) {
      return { status: "inconclusive", reason: "unsupported_language" };
    }

    const bags = buildPageBags(ctx);

    const candidates: FindingCandidate[] = [];
    let qualifyingClusters = 0;
    let inconclusiveCount = 0;
    for (const [clusterKey, keywords] of ctx.csvClusters) {
      const totalVolume = totalAvailableVolume(keywords);
      const qualifies =
        keywords.length >= MIN_KEYWORDS && totalVolume >= MIN_TOTAL_VOLUME;
      if (!qualifies) continue;
      qualifyingClusters += 1;

      const outcome = matchIntent(clusterKey, bags);
      if (outcome === "covered") continue;
      if (outcome === "inconclusive") {
        inconclusiveCount += 1;
        continue;
      }

      candidates.push(
        buildCandidate(ctx, clusterKey, keywords.length, totalVolume),
      );
    }

    if (candidates.length > 0) {
      return { status: "candidate", candidates };
    }
    if (csvAvailability === "partial") {
      return { status: "inconclusive", reason: "partial_csv_snapshot" };
    }
    if (inconclusiveCount > 0) {
      return { status: "inconclusive", reason: "intent_match_unavailable" };
    }
    return { status: "pass", metrics: { qualifyingClusters } };
  },
} satisfies DiagnosticRule;

/** Sum available volume, skipping nulls rather than fabricating zero values. */
function totalAvailableVolume(keywords: readonly CsvKeywordProjection[]): number {
  let totalVolume = 0;
  for (const kw of keywords) {
    if (kw.searchVolume === null) continue;
    totalVolume += kw.searchVolume;
  }
  return totalVolume;
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
  const csvPartial = ctx.datasetAvailability("csv") === "partial";
  const crawlPartial = ctx.datasetAvailability("crawl") === "partial";
  const keywordGapProvider = ctx.keywordGapProvider(clusterKey);
  const isDataForSeo = keywordGapProvider === "dataforseo";
  const sourceLimitation = isDataForSeo
    ? DATAFORSEO_LIMITATION
    : CSV_LIMITATION;
  const keywordGapEvidence: EvidenceDraft = {
    sourceProvider: keywordGapProvider,
    origin: isDataForSeo ? "vendor_observation" : "user_provided",
    method: "observed",
    grade: isDataForSeo ? "B" : "C",
    availability: csvPartial ? "partial" : "available",
    support: "supports",
    subjectRefs: [subjectRef],
    claim: `${isDataForSeo ? "Observed" : "Imported"} keyword cluster "${clusterKey}" carries ${keywordCount} keywords with ${totalVolume} combined monthly search volume.`,
    observedAt: ctx.observedAt(keywordGapProvider),
    limitation: csvPartial
      ? `${sourceLimitation} The selected keyword-gap snapshot is partial, so omitted rows may affect completeness.`
      : sourceLimitation,
  };
  const contentEvidence: EvidenceDraft = {
    sourceProvider: "crawl",
    origin: "derived",
    method: "inferred",
    grade: "C",
    availability: crawlPartial ? "partial" : "available",
    support: "supports",
    subjectRefs: [subjectRef],
    claim: `No indexable page relates to the "${clusterKey}" keyword cluster.`,
    observedAt: ctx.observedAt("crawl"),
    limitation: crawlPartial
      ? `${INTENT_LIMITATION} The selected crawl snapshot is partial, so omitted pages may affect completeness.`
      : INTENT_LIMITATION,
  };
  return {
    subjectRefs: [subjectRef],
    severity: "high",
    titleArgs: { clusterKey, keywordCount, totalVolume },
    metrics: { clusterKey, keywordCount, totalVolume },
    evidence: [keywordGapEvidence, contentEvidence],
  };
}
