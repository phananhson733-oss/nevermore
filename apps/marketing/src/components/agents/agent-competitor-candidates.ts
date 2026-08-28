// @input  -- bounded DataForSEO profile-search evidence and local profile review actions
// @output -- deterministic competitor suggestions and one-group-only profile classification
// @pos    -- browser-safe adapter; provider evidence remains distinct from user confirmation

import {
  normalizeAgentProfileSearchDomain,
  type AgentProfileSearchData,
  type AgentProfileSearchOverlapRow,
  type AgentProfileSearchSeedSerpCompetitorRow,
  type AgentProfileSearchSerpRow,
} from "../../lib/agents/profile-search-contract";
import {
  updateAgentProfile,
  type AgentProfileDraft,
} from "./agent-profile";

export type AgentCompetitorClassification =
  | "direct"
  | "indirect"
  | "excluded";

export interface AgentCompetitorClassifications {
  readonly direct: readonly string[];
  readonly indirect: readonly string[];
  readonly excluded: readonly string[];
}

export interface AgentCompetitorClassificationResolution {
  readonly classification: AgentCompetitorClassification;
  readonly source: "manual" | "system";
}

export interface AgentCompetitorDisplayEntry
  extends AgentCompetitorClassificationResolution {
  readonly domain: string;
  readonly suggestion: AgentCompetitorSuggestion | null;
}

export interface AgentCompetitorDisplayFrame {
  readonly direct: readonly AgentCompetitorDisplayEntry[];
  readonly indirect: readonly AgentCompetitorDisplayEntry[];
  readonly excluded: readonly AgentCompetitorDisplayEntry[];
}

export interface AgentCompetitorSuggestion {
  readonly domain: string;
  readonly reviewBucket:
    | "higher_overlap"
    | "adjacent_overlap"
    | "unclassified";
  readonly discoveryConfidence: "low" | "medium" | null;
  readonly suggestedClassification: "direct" | "indirect";
  readonly evidenceKind:
    | "organic_search_overlap"
    | "profile_seed_serp_competitor"
    | "target_query_serp";
  readonly observedAt: string;
  readonly metrics: {
    readonly intersections: number | null;
    readonly averagePosition: number | null;
    readonly medianPosition: number | null;
    readonly summedPosition: number | null;
    readonly organicEstimatedTrafficVolume: number | null;
    readonly rank: number | null;
    readonly rating: number | null;
    readonly keywordsCount: number | null;
    readonly visibility: number | null;
    readonly relevantSerpItems: number | null;
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
      suggestedClassification:
        reviewBucket === "higher_overlap" ? "direct" : "indirect",
      evidenceKind: row.kind,
      observedAt: data.observedAt,
      metrics: {
        intersections: row.intersections,
        averagePosition: row.averagePosition,
        medianPosition: null,
        summedPosition: row.summedPosition,
        organicEstimatedTrafficVolume:
          row.organicEstimatedTrafficVolume,
        rank: null,
        rating: null,
        keywordsCount: null,
        visibility: null,
        relevantSerpItems: null,
      },
    };
  });
}

function compareSeedSerpRows(
  left: AgentProfileSearchSeedSerpCompetitorRow,
  right: AgentProfileSearchSeedSerpCompetitorRow,
): number {
  return (
    right.rating - left.rating ||
    right.keywordsCount - left.keywordsCount ||
    left.domain.localeCompare(right.domain)
  );
}

function deriveSeedSerpSuggestions(
  data: Extract<
    AgentProfileSearchData,
    { method: "serp_competitors"; availability: "available" | "no_data" }
  >,
  targetHost: string,
): readonly AgentCompetitorSuggestion[] {
  const byDomain = new Map<
    string,
    AgentProfileSearchSeedSerpCompetitorRow
  >();
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
    if (
      previous === undefined ||
      compareSeedSerpRows(normalized, previous) < 0
    ) {
      byDomain.set(domain, normalized);
    }
  }

  return [...byDomain.values()]
    .sort(compareSeedSerpRows)
    .slice(0, MAX_SUGGESTIONS)
    .map((row) => ({
      domain: row.domain,
      reviewBucket: "unclassified" as const,
      discoveryConfidence: "low" as const,
      suggestedClassification: "indirect" as const,
      evidenceKind: row.kind,
      observedAt: data.observedAt,
      metrics: {
        intersections: null,
        averagePosition: row.averagePosition,
        medianPosition: row.medianPosition,
        summedPosition: null,
        organicEstimatedTrafficVolume:
          row.organicEstimatedTrafficVolume,
        rank: null,
        rating: row.rating,
        keywordsCount: row.keywordsCount,
        visibility: row.visibility,
        relevantSerpItems: row.relevantSerpItems,
      },
    }));
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
      discoveryConfidence: "low" as const,
      suggestedClassification: "indirect" as const,
      evidenceKind: row.kind,
      observedAt: data.observedAt,
      metrics: {
        intersections: null,
        averagePosition: null,
        medianPosition: null,
        summedPosition: null,
        organicEstimatedTrafficVolume: null,
        rank: row.rank,
        rating: null,
        keywordsCount: null,
        visibility: null,
        relevantSerpItems: null,
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
  if (data.method === "competitors_domain") {
    return deriveOverlapSuggestions(data, normalizedTarget);
  }
  if (data.method === "serp_competitors") {
    return deriveSeedSerpSuggestions(data, normalizedTarget);
  }
  return deriveSerpSuggestions(data, normalizedTarget);
}

function includesNormalizedDomain(
  values: readonly string[],
  domain: string,
): boolean {
  return values.some(
    (value) => normalizeAgentProfileSearchDomain(value) === domain,
  );
}

/** Resolve the effective review choice without persisting a system suggestion. */
export function resolveAgentCompetitorClassification(
  suggestion: AgentCompetitorSuggestion,
  classifications: AgentCompetitorClassifications,
): AgentCompetitorClassificationResolution {
  const domain = normalizeAgentProfileSearchDomain(suggestion.domain);
  if (domain !== null) {
    if (includesNormalizedDomain(classifications.excluded, domain)) {
      return { classification: "excluded", source: "manual" };
    }
    if (includesNormalizedDomain(classifications.direct, domain)) {
      return { classification: "direct", source: "manual" };
    }
    if (includesNormalizedDomain(classifications.indirect, domain)) {
      return { classification: "indirect", source: "manual" };
    }
  }
  return {
    classification: suggestion.suggestedClassification,
    source: "system",
  };
}

function collectManualClassifications(
  classifications: AgentCompetitorClassifications,
): ReadonlyMap<string, AgentCompetitorClassification> {
  const manual = new Map<string, AgentCompetitorClassification>();
  for (const [classification, values] of [
    ["indirect", classifications.indirect],
    ["direct", classifications.direct],
    ["excluded", classifications.excluded],
  ] as const) {
    for (const value of values) {
      const domain = normalizeAgentProfileSearchDomain(value);
      if (domain !== null) manual.set(domain, classification);
    }
  }
  return manual;
}

/** Build the review surface without writing system defaults into profile fields. */
export function deriveAgentCompetitorDisplayFrame(
  suggestions: readonly AgentCompetitorSuggestion[],
  classifications: AgentCompetitorClassifications,
): AgentCompetitorDisplayFrame {
  const frame: Record<
    AgentCompetitorClassification,
    AgentCompetitorDisplayEntry[]
  > = { direct: [], indirect: [], excluded: [] };
  const seen = new Set<string>();

  for (const suggestion of suggestions) {
    const domain = normalizeAgentProfileSearchDomain(suggestion.domain);
    if (domain === null || seen.has(domain)) continue;
    seen.add(domain);
    const resolution = resolveAgentCompetitorClassification(
      suggestion,
      classifications,
    );
    frame[resolution.classification].push({
      domain,
      ...resolution,
      suggestion,
    });
  }

  for (const [domain, classification] of collectManualClassifications(
    classifications,
  )) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    frame[classification].push({
      domain,
      classification,
      source: "manual",
      suggestion: null,
    });
  }

  return frame;
}

function withoutDomain(
  values: readonly string[],
  domain: string,
): readonly string[] {
  return values.filter(
    (value) => normalizeAgentProfileSearchDomain(value) !== domain,
  );
}

/** Move one normalized visitor choice into exactly one relationship group. */
export function classifyCompetitorRelationships(
  classifications: AgentCompetitorClassifications,
  domain: string,
  classification: AgentCompetitorClassification,
): AgentCompetitorClassifications {
  const normalized = normalizeAgentProfileSearchDomain(domain);
  if (normalized === null) {
    throw new TypeError("Competitor domain must be a normalized public hostname.");
  }

  const direct = withoutDomain(classifications.direct, normalized);
  const indirect = withoutDomain(classifications.indirect, normalized);
  const excluded = withoutDomain(classifications.excluded, normalized);

  return {
    direct:
      classification === "direct" ? [...direct, normalized] : direct,
    indirect:
      classification === "indirect" ? [...indirect, normalized] : indirect,
    excluded:
      classification === "excluded" ? [...excluded, normalized] : excluded,
  };
}

/** Record a visitor decision locally; this does not persist an app Product Profile. */
export function classifyAgentCompetitorProfile(
  profile: AgentProfileDraft,
  domain: string,
  classification: AgentCompetitorClassification,
): AgentProfileDraft {
  const classified = classifyCompetitorRelationships(
    {
      direct: profile.directCompetitors,
      indirect: profile.indirectAlternatives,
      excluded: profile.excludedAlternatives,
    },
    domain,
    classification,
  );

  return updateAgentProfile(profile, {
    directCompetitors: classified.direct,
    indirectAlternatives: classified.indirect,
    excludedAlternatives: classified.excluded,
  });
}
