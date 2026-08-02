import {
  IsoDateTime,
  ProductProfileCompetitorDomain,
  Uuid,
  type ProductProfileCompetitorAnalysisScope,
  type ProductProfileCompetitorRelationship,
  type ProductProfileConfidence,
} from "@sf/contracts";

/** One canonical DataForSEO competitor-domain Observation frozen for synthesis. */
export interface ProductProfileCompetitorDiscoveryObservation {
  readonly observationId: string;
  readonly domain: string;
  /** DataForSEO keyword-intersection count. This is never treated as a ratio. */
  readonly intersections: number;
  readonly organicEstimatedTrafficVolume: number;
  readonly observedAt: string;
}

export interface ProductProfileDiscoveredCompetitor {
  readonly observationId: string;
  readonly name: string;
  readonly domain: string;
  readonly relationship: ProductProfileCompetitorRelationship;
  readonly analysisScope: readonly ProductProfileCompetitorAnalysisScope[];
  readonly similarity: null;
  readonly reason: string;
  readonly confidence: ProductProfileConfidence;
  readonly observedAt: string;
}

const MAX_PROFILE_COMPETITORS = 8;

/**
 * Search/social/community/marketplace domains can overlap almost any site in
 * organic SERPs but are not product competitors. Exact-or-subdomain matching
 * keeps this bounded and explainable instead of using an opaque popularity
 * score. Product ecosystems are deliberately not blocked: e.g. Shopify or
 * HubSpot can be a real direct or indirect competitor for some products.
 */
const NON_COMPETITOR_DOMAINS = [
  "google.com",
  "youtube.com",
  "wikipedia.org",
  "reddit.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "pinterest.com",
  "amazon.com",
  "medium.com",
] as const;

function isBlockedDomain(domain: string): boolean {
  return NON_COMPETITOR_DOMAINS.some(
    (blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
  );
}

function brandName(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reasonFor(input: {
  readonly locale: string;
  readonly relationship: ProductProfileCompetitorRelationship;
  readonly intersections: number;
  readonly marketCode: string;
}): string {
  const { locale, relationship, intersections, marketCode } = input;
  if (locale.toLowerCase().startsWith("zh")) {
    return relationship === "direct"
      ? `DataForSEO 在 ${marketCode} 市场观测到 ${intersections} 个自然搜索关键词交集；按同类搜索需求的高重合规则列为直接竞品草稿，待用户复核。`
      : `DataForSEO 在 ${marketCode} 市场观测到 ${intersections} 个自然搜索关键词交集；重合度低于直接替代阈值，按相邻需求列为间接竞品草稿，待用户复核。`;
  }
  return relationship === "direct"
    ? `DataForSEO observed ${intersections} shared organic-search keywords in ${marketCode}; the high-overlap rule classifies this as a direct-competitor draft pending review.`
    : `DataForSEO observed ${intersections} shared organic-search keywords in ${marketCode}; overlap is below the direct-substitution threshold, so this is an indirect-competitor draft pending review.`;
}

function compareObservation(
  left: ProductProfileCompetitorDiscoveryObservation,
  right: ProductProfileCompetitorDiscoveryObservation,
): number {
  return (
    right.intersections - left.intersections ||
    right.organicEstimatedTrafficVolume -
      left.organicEstimatedTrafficVolume ||
    left.domain.localeCompare(right.domain)
  );
}

/**
 * Deterministic initial competitor rules:
 *
 * 1. validate canonical observations and remove self/search/social/community;
 * 2. de-duplicate by domain, keeping the strongest immutable observation;
 * 3. rank by intersections, organic ETV, then domain and cap the Draft at 8;
 * 4. mark the strongest overlap cohort direct (>=35% of the best retained
 *    domain, minimum 2 intersections); the rest are indirect;
 * 5. never manufacture a similarity percentage from intersection counts.
 *
 * The crawler remains responsible for product/category/ICP semantics and any
 * explicitly cited competitor. These provider candidates extend that pool;
 * crawler-grounded candidates win on duplicate domains during draft merge.
 */
export function discoverProductProfileCompetitors(input: {
  readonly targetDomain: string;
  readonly marketCode: string;
  readonly outputLocale: string;
  readonly observations: readonly ProductProfileCompetitorDiscoveryObservation[];
  readonly maxCandidates?: number;
}): ProductProfileDiscoveredCompetitor[] {
  const targetDomain = ProductProfileCompetitorDomain.parse(
    input.targetDomain.toLowerCase().replace(/^www\./u, ""),
  );
  const maxCandidates = input.maxCandidates ?? MAX_PROFILE_COMPETITORS;
  if (
    !Number.isSafeInteger(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > MAX_PROFILE_COMPETITORS
  ) {
    throw new RangeError(
      `maxCandidates must be between 1 and ${MAX_PROFILE_COMPETITORS}`,
    );
  }

  const byDomain = new Map<
    string,
    ProductProfileCompetitorDiscoveryObservation
  >();
  for (const observation of input.observations) {
    const parsed = {
      observationId: Uuid.parse(observation.observationId),
      domain: ProductProfileCompetitorDomain.parse(observation.domain),
      intersections: observation.intersections,
      organicEstimatedTrafficVolume:
        observation.organicEstimatedTrafficVolume,
      observedAt: IsoDateTime.parse(observation.observedAt),
    };
    if (
      !Number.isSafeInteger(parsed.intersections) ||
      parsed.intersections < 1 ||
      !Number.isFinite(parsed.organicEstimatedTrafficVolume) ||
      parsed.organicEstimatedTrafficVolume < 0 ||
      parsed.domain === targetDomain ||
      parsed.domain.endsWith(`.${targetDomain}`) ||
      isBlockedDomain(parsed.domain)
    ) {
      continue;
    }
    const previous = byDomain.get(parsed.domain);
    if (!previous || compareObservation(parsed, previous) < 0) {
      byDomain.set(parsed.domain, parsed);
    }
  }

  const ranked = [...byDomain.values()]
    .sort(compareObservation)
    .slice(0, maxCandidates);
  const strongest = ranked[0]?.intersections ?? 0;
  const directThreshold = Math.max(2, Math.ceil(strongest * 0.35));

  return ranked.map((observation) => {
    const relationship: ProductProfileCompetitorRelationship =
      observation.intersections >= directThreshold ? "direct" : "indirect";
    const analysisScope: readonly ProductProfileCompetitorAnalysisScope[] =
      relationship === "direct"
        ? [
            "positioning",
            "product_capability",
            "keyword_gap",
            "serp_visibility",
          ]
        : ["keyword_gap", "content", "serp_visibility"];
    return {
      observationId: observation.observationId,
      name: brandName(observation.domain),
      domain: observation.domain,
      relationship,
      analysisScope,
      similarity: null,
      reason: reasonFor({
        locale: input.outputLocale,
        relationship,
        intersections: observation.intersections,
        marketCode: input.marketCode,
      }),
      confidence:
        relationship === "direct" && observation.intersections >= 5
          ? "medium"
          : "low",
      observedAt: observation.observedAt,
    };
  });
}
