// @input  -- bounded DataForSEO profile-search evidence and local profile review actions
// @output -- deterministic competitor suggestions and one-group-only profile classification
// @pos    -- browser-safe adapter; provider evidence remains distinct from user confirmation

import {
  normalizeAgentProfileSearchDomain,
  type AgentProfileSearchData,
  type AgentProfileSearchOverlapRow,
  type AgentProfileSearchSerpRow,
} from "../../lib/agents/profile-search-contract";
import {
  updateAgentProfile,
  type AgentProfileDraft,
} from "./agent-profile";

export interface AgentCompetitorSuggestion {
  readonly domain: string;
  readonly reviewBucket:
    | "higher_overlap"
    | "adjacent_overlap"
    | "unclassified";
  readonly discoveryConfidence: "low" | "medium" | null;
  readonly evidenceKind:
    | "organic_search_overlap"
    | "target_query_serp";
  readonly observedAt: string;
  readonly metrics: {
    readonly intersections: number | null;
    readonly averagePosition: number | null;
    readonly summedPosition: number | null;
    readonly organicEstimatedTrafficVolume: number | null;
    readonly rank: number | null;
  };
}

const MAX_SUGGESTIONS = 8;

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

function isSelfDomain(domain: string, targetHost: string): boolean {
  return domain === targetHost || domain.endsWith(`.${targetHost}`);
}

function compareOverlapRows(
  left: AgentProfileSearchOverlapRow,
  right: AgentProfileSearchOverlapRow,
): number {
  return (
    right.intersections - left.intersections ||
    right.organicEstimatedTrafficVolume -
      left.organicEstimatedTrafficVolume ||
    left.domain.localeCompare(right.domain)
  );
}

function deriveOverlapSuggestions(
  data: Extract<
    AgentProfileSearchData,
    { method: "competitors_domain"; availability: "available" | "no_data" }
  >,
  targetHost: string,
): readonly AgentCompetitorSuggestion[] {
  const byDomain = new Map<string, AgentProfileSearchOverlapRow>();
  for (const row of data.rows) {
    const domain = normalizeAgentProfileSearchDomain(row.domain);
    if (
      domain === null ||
      isSelfDomain(domain, targetHost) ||
      isBlockedDomain(domain)
    ) {
      continue;
    }
    const normalized = { ...row, domain };
    const previous = byDomain.get(domain);
    if (previous === undefined || compareOverlapRows(normalized, previous) < 0) {
      byDomain.set(domain, normalized);
    }
  }

  const ranked = [...byDomain.values()]
    .sort(compareOverlapRows)
    .slice(0, MAX_SUGGESTIONS);
  if (ranked.length === 0) return [];

  const higherOverlapThreshold = Math.max(
    2,
    Math.ceil(ranked[0].intersections * 0.35),
  );
  return ranked.map((row) => {
    const reviewBucket =
      row.intersections >= higherOverlapThreshold
        ? "higher_overlap"
        : "adjacent_overlap";
    return {
      domain: row.domain,
      reviewBucket,
      discoveryConfidence:
        reviewBucket === "higher_overlap" && row.intersections >= 5
          ? "medium"
          : "low",
      evidenceKind: row.kind,
      observedAt: data.observedAt,
      metrics: {
        intersections: row.intersections,
        averagePosition: row.averagePosition,
        summedPosition: row.summedPosition,
        organicEstimatedTrafficVolume:
          row.organicEstimatedTrafficVolume,
        rank: null,
      },
    };
  });
}

function deriveSerpSuggestions(
  data: Extract<
    AgentProfileSearchData,
    { method: "target_query_serp"; availability: "available" | "no_data" }
  >,
  targetHost: string,
): readonly AgentCompetitorSuggestion[] {
  const byDomain = new Map<string, AgentProfileSearchSerpRow>();
  for (const row of data.rows) {
    const domain = normalizeAgentProfileSearchDomain(row.domain);
    if (
      domain === null ||
      isSelfDomain(domain, targetHost) ||
      isBlockedDomain(domain)
    ) {
      continue;
    }
    const normalized = { ...row, domain };
    const previous = byDomain.get(domain);
    if (previous === undefined || normalized.rank < previous.rank) {
      byDomain.set(domain, normalized);
    }
  }

  return [...byDomain.values()]
    .sort((left, right) =>
      left.rank === right.rank
        ? left.domain.localeCompare(right.domain)
        : left.rank - right.rank,
    )
    .slice(0, MAX_SUGGESTIONS)
    .map((row) => ({
      domain: row.domain,
      reviewBucket: "unclassified" as const,
      discoveryConfidence: null,
      evidenceKind: row.kind,
      observedAt: data.observedAt,
      metrics: {
        intersections: null,
        averagePosition: null,
        summedPosition: null,
        organicEstimatedTrafficVolume: null,
        rank: row.rank,
      },
    }));
}

/** Project bounded provider observations without claiming a confirmed competitor. */
export function deriveAgentCompetitorSuggestions(
  data: AgentProfileSearchData,
  targetHost: string,
): readonly AgentCompetitorSuggestion[] {
  const normalizedTarget = normalizeAgentProfileSearchDomain(targetHost);
  if (
    normalizedTarget === null ||
    data.observedAt === null ||
    data.rows.length === 0
  ) {
    return [];
  }
  return data.method === "competitors_domain"
    ? deriveOverlapSuggestions(data, normalizedTarget)
    : deriveSerpSuggestions(data, normalizedTarget);
}

function withoutDomain(
  values: readonly string[],
  domain: string,
): readonly string[] {
  return values.filter(
    (value) => normalizeAgentProfileSearchDomain(value) !== domain,
  );
}

/** Record a visitor decision locally; this does not persist an app Product Profile. */
export function classifyAgentCompetitorProfile(
  profile: AgentProfileDraft,
  domain: string,
  classification: "direct" | "indirect" | "excluded",
): AgentProfileDraft {
  const normalized = normalizeAgentProfileSearchDomain(domain);
  if (normalized === null) {
    throw new TypeError("Competitor domain must be a normalized public hostname.");
  }

  const directCompetitors = withoutDomain(
    profile.directCompetitors,
    normalized,
  );
  const indirectAlternatives = withoutDomain(
    profile.indirectAlternatives,
    normalized,
  );
  const excludedAlternatives = withoutDomain(
    profile.excludedAlternatives,
    normalized,
  );

  return updateAgentProfile(profile, {
    directCompetitors:
      classification === "direct"
        ? [...directCompetitors, normalized]
        : directCompetitors,
    indirectAlternatives:
      classification === "indirect"
        ? [...indirectAlternatives, normalized]
        : indirectAlternatives,
    excludedAlternatives:
      classification === "excluded"
        ? [...excludedAlternatives, normalized]
        : excludedAlternatives,
  });
}
