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
 * defect. Version 2 additionally intersects demand with the manifest-frozen
 * Keyword Library when governance is present; manifests that predate governance
 * retain the exact version-1 evaluation path.
 */

import type { CsvKeywordProjection } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type { GovernanceKeywordClusterV1 } from "../governance.ts";
import type { DiagnosticRule, EvidenceDraft, FindingCandidate } from "../rule.ts";
import { findingTarget } from "../target.ts";
import { matchIntent, pageFieldBag } from "../util/intent-match.ts";

const MIN_KEYWORDS = 10;
const MIN_TOTAL_VOLUME = 500;
const CSV_LIMITATION =
  "Search volume is user-provided CSV data; clustering is a heuristic over the imported rows.";
const DATAFORSEO_LIMITATION =
  "Search volume and ranking are DataForSEO vendor observations over the configured market, language, rank filter, and row cap; clustering is heuristic.";
const INTENT_LIMITATION =
  "Intent match is an English-only heuristic over URL/title/H1 tokens.";
const CONTENT_GAP_COMPETITOR_SCOPES: ReadonlySet<string> = new Set([
  "keyword_gap",
  "content",
  "serp_visibility",
]);

export const contentGapRule = {
  id: "CONTENT-GAP-011",
  version: 2,
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
    for (const [clusterKey, legacyKeywords] of ctx.csvClusters) {
      const governedCluster =
        ctx.governance === null
          ? null
          : ctx.governedKeywordCluster(clusterKey);
      const keywords =
        ctx.governance === null
          ? legacyKeywords
          : ctx.governedKeywordGapKeywords(clusterKey);
      // Once governance is frozen into the manifest, absence of reviewed
      // intersection is a deliberate "not eligible", never permission to fall
      // back to every imported row.
      if (ctx.governance !== null && keywords.length === 0) continue;

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
        buildCandidate(
          ctx,
          clusterKey,
          keywords,
          totalVolume,
          governedCluster,
        ),
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

/**
 * One unioned token bag per canonical subject. Any healthy exact variant can
 * establish subject-level coverage; absence is not inferred from one arbitrary
 * transport response.
 */
function buildPageBags(ctx: DiagnosticContext): ReadonlySet<string>[] {
  const bags: ReadonlySet<string>[] = [];
  for (const [subjectUrl, variants] of ctx.indexablePages()) {
    let urlPath: string;
    try {
      urlPath = new URL(subjectUrl).pathname;
    } catch {
      continue;
    }
    const subjectBag = new Set<string>();
    let hasSearchableVariant = false;
    for (const page of variants) {
      const variantBag = pageFieldBag({
        urlPath,
        title: page.title,
        h1: page.h1,
      });
      if (!variantBag) continue;
      hasSearchableVariant = true;
      for (const token of variantBag) subjectBag.add(token);
    }
    if (hasSearchableVariant) bags.push(subjectBag);
  }
  return bags;
}

function buildCandidate(
  ctx: DiagnosticContext,
  clusterKey: string,
  keywords: readonly CsvKeywordProjection[],
  totalVolume: number,
  governedCluster: GovernanceKeywordClusterV1 | null,
): FindingCandidate {
  const keywordCount = keywords.length;
  const subjectRef = `keyword_cluster:${clusterKey}`;
  const crawlPartial = ctx.datasetAvailability("crawl") === "partial";
  const keywordGapEvidence = ctx
    .keywordGapContributions(
      clusterKey,
      ctx.governance === null ? undefined : keywords,
    )
    .map(({ provider, keywords }): EvidenceDraft => {
      const availability = ctx.providerAvailability(provider);
      const partial = availability === "partial";
      const isDataForSeo = provider === "dataforseo";
      const sourceLimitation = isDataForSeo
        ? DATAFORSEO_LIMITATION
        : CSV_LIMITATION;
      const availableVolume = totalAvailableVolume(keywords);
      const reportedVolumeRows = keywords.filter(
        (keyword) => keyword.searchVolume !== null,
      ).length;
      const volumeClaim =
        reportedVolumeRows > 0
          ? ` with ${availableVolume} combined available monthly search volume`
          : "; none of those retained source rows reports monthly search volume";
      const keywordLabel = keywords.length === 1 ? "keyword" : "keywords";
      return {
        sourceProvider: provider,
        origin: isDataForSeo ? "vendor_observation" : "user_provided",
        method: "observed",
        grade: isDataForSeo ? "B" : "C",
        availability,
        support: "supports",
        subjectRefs: [subjectRef],
        claim: `After semantic demand de-duplication, the ${isDataForSeo ? "DataForSEO source" : "user-provided CSV source"} contributes ${keywords.length} ${keywordLabel}${volumeClaim} to cluster "${clusterKey}".`,
        observedAt: ctx.observedAt(provider),
        limitation: `${sourceLimitation} Rows without reported search volume are excluded from this provider's volume sum.${partial ? " The selected keyword-gap snapshot is partial, so omitted rows may affect completeness." : ""}`,
      };
    });
  const governanceEvidence =
    governedCluster === null
      ? []
      : [
          buildKeywordGovernanceEvidence(
            ctx,
            subjectRef,
            governedCluster,
            keywordCount,
          ),
        ];
  const competitorSupport = buildCompetitorSupport(
    ctx,
    subjectRef,
    governedCluster === null
      ? ctx.observedAt("governance")
      : latestEligibleKeywordSeenAt(ctx, governedCluster),
  );
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
  const metrics: Record<string, number | string | null> = {
    clusterKey,
    keywordCount,
    totalVolume,
    ...competitorSupport.metrics,
  };
  return {
    subjectRefs: [subjectRef],
    severity: "high",
    titleArgs: { clusterKey, keywordCount, totalVolume },
    metrics,
    evidence: [
      ...keywordGapEvidence,
      ...governanceEvidence,
      ...competitorSupport.evidence,
      contentEvidence,
    ],
    target: findingTarget(
      {
        relation: "affected_by_keyword_cluster",
        targetKind: "keyword_cluster",
      },
      clusterKey,
      [],
      "target_definition",
    ),
  };
}

function buildKeywordGovernanceEvidence(
  ctx: DiagnosticContext,
  subjectRef: string,
  cluster: GovernanceKeywordClusterV1,
  intersectedKeywordCount: number,
): EvidenceDraft {
  const eligibleFactCount = cluster.keywords.filter(
    (keyword) =>
      keyword.status === "approved" &&
      keyword.mappingReviewState === "confirmed" &&
      keyword.clusterKey === cluster.clusterKey,
  ).length;
  return {
    sourceProvider: "system",
    origin: "derived",
    method: "computed",
    grade: "B",
    availability: "available",
    support: "supports",
    subjectRefs: [subjectRef],
    claim: `The frozen Keyword Library contains ${eligibleFactCount} approved, confirmed facts for cluster "${cluster.clusterKey}"; ${intersectedKeywordCount} intersect the frozen demand observations used by this finding.`,
    observedAt: latestEligibleKeywordSeenAt(ctx, cluster),
    limitation:
      "Keyword eligibility is the reviewed state frozen into this diagnostic manifest; later Library edits are intentionally excluded from replay.",
  };
}

function buildCompetitorSupport(
  ctx: DiagnosticContext,
  subjectRef: string,
  observedAt: string,
): {
  readonly metrics: Readonly<Record<string, number | string>>;
  readonly evidence: readonly EvidenceDraft[];
} {
  const competitors = ctx.approvedCompetitorEvidence.filter((competitor) =>
    competitor.analysisScopes.some((scope) =>
      CONTENT_GAP_COMPETITOR_SCOPES.has(scope),
    ),
  );
  if (competitors.length === 0) {
    return { metrics: {}, evidence: [] };
  }
  const ids = competitors
    .map((competitor) => competitor.competitorEntityId)
    .sort(compareAscii);
  const scopes = [
    ...new Set(
      competitors.flatMap((competitor) =>
        competitor.analysisScopes.filter((scope) =>
          CONTENT_GAP_COMPETITOR_SCOPES.has(scope),
        ),
      ),
    ),
  ].sort(compareAscii);
  return {
    metrics: {
      approvedCompetitorCount: ids.length,
      approvedCompetitorIds: ids.join(","),
      approvedCompetitorScopes: scopes.join(","),
    },
    evidence: [
      {
        sourceProvider: "system",
        origin: "derived",
        method: "computed",
        grade: "B",
        availability: "available",
        support: "context",
        subjectRefs: [subjectRef],
        claim: `Approved Competitor Library context includes entity IDs ${ids.join(", ")} across analysis scopes ${scopes.join(", ")}.`,
        observedAt,
        limitation:
          "Approved competitor governance is supporting context only; it does not establish keyword demand, page absence, or a competitor finding target. Its frozen origin refs carry no independent timestamp in GovernanceProjectionV1, so observedAt is the latest eligible Keyword fact used by this finding.",
      },
    ],
  };
}

function latestEligibleKeywordSeenAt(
  ctx: DiagnosticContext,
  cluster: GovernanceKeywordClusterV1,
): string {
  const instants = cluster.keywords
    .filter(
      (keyword) =>
        keyword.status === "approved" &&
        keyword.mappingReviewState === "confirmed" &&
        keyword.clusterKey === cluster.clusterKey,
    )
    .map((keyword) => keyword.lastSeenAt)
    .sort(compareAscii);
  return instants.at(-1) ?? ctx.observedAt("governance");
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
