// @input  -- one completed-or-unavailable SERP plus request-scoped domain enrichments
// @output -- three provenance-bearing signals and unassessed AI Overview evidence
// @pos    -- pure Marketing projection between provider seams and the public-tools report
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { domainToASCII } from "node:url";

import {
  normalizeRdapDomain,
  normalizeTrafficDomain,
  type DomainRegistrationEvidence,
} from "@sf/sources";
import type {
  KeywordOpportunityAiOverviewObservation,
  KeywordOpportunitySignals,
  KeywordOpportunitySiteRankTier,
} from "@sf/public-tools";
import type { KeywordSerpSampleResult } from "./keyword-opportunity-handler.ts";

export interface KeywordSignalEvidenceInput {
  readonly sample: KeywordSerpSampleResult;
  readonly observedAt: string;
  readonly siteDomainRank: number | null;
  /** Null means the enrichment stage did not return a usable map. */
  readonly domainTraffic: ReadonlyMap<string, number | null> | null;
  /** Null means the enrichment stage did not return a usable map. */
  readonly domainRegistrations: ReadonlyMap<
    string,
    DomainRegistrationEvidence
  > | null;
  readonly marketCode: string;
  readonly languageCode: string;
}

export interface KeywordSignalEvidence {
  readonly signals: KeywordOpportunitySignals;
  readonly aiOverview: KeywordOpportunityAiOverviewObservation;
}

function unavailableSignal(reason: string) {
  return { state: "unavailable" as const, observation: null, reason };
}

/** Provisional v1 young-domain boundary; exported so each run reports it. */
export const KEYWORD_YOUNG_DOMAIN_MONTHS = 24;

/** Requesting-site rank band used by the provisional traffic policy. */
export function keywordSiteRankTier(
  rank: number | null,
): KeywordOpportunitySiteRankTier | null {
  if (!Number.isInteger(rank) || rank === null || rank < 1 || rank > 1_000) {
    return null;
  }
  if (rank <= 200) return "rank_1_200";
  if (rank <= 500) return "rank_201_500";
  return "rank_501_1000";
}

/** Traffic threshold selected solely from the requesting site's provider rank. */
export function keywordSiteTrafficThreshold(rank: number | null): number | null {
  switch (keywordSiteRankTier(rank)) {
    case "rank_1_200":
      return 5_000;
    case "rank_201_500":
      return 50_000;
    case "rank_501_1000":
      return 100_000;
    case null:
      return null;
  }
}

function parseInstant(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function subtractCalendarMonths(value: Date, months: number): Date {
  const result = new Date(value.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const finalDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, finalDay));
  return result;
}

function wholeCalendarMonths(earlier: Date, later: Date): number {
  let months =
    (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 +
    later.getUTCMonth() -
    earlier.getUTCMonth();
  const anniversary = new Date(earlier.getTime());
  const day = anniversary.getUTCDate();
  anniversary.setUTCDate(1);
  anniversary.setUTCMonth(anniversary.getUTCMonth() + months);
  const finalDay = new Date(
    Date.UTC(
      anniversary.getUTCFullYear(),
      anniversary.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  anniversary.setUTCDate(Math.min(day, finalDay));
  if (anniversary.getTime() > later.getTime()) months -= 1;
  return Math.max(0, months);
}

function youngDomainSignal(input: KeywordSignalEvidenceInput) {
  const observedAt = parseInstant(input.observedAt);
  if (observedAt === null) return unavailableSignal("run_observation_invalid");
  if (input.domainRegistrations === null) {
    return unavailableSignal("domain_registration_stage_unavailable");
  }

  const distinctResultDomains = [
    ...new Set(
      input.sample.results.map((entry) => entry.domain.trim().toLowerCase()),
    ),
  ];
  if (distinctResultDomains.length === 0) {
    return unavailableSignal("organic_result_domains_unavailable");
  }
  const normalizedDomains = distinctResultDomains.map(normalizeRdapDomain);
  const domains = [
    ...new Set(
      normalizedDomains.filter((domain): domain is string => domain !== null),
    ),
  ].sort();

  const cutoff = subtractCalendarMonths(observedAt, KEYWORD_YOUNG_DOMAIN_MONTHS);
  const young: Array<{
    readonly domain: string;
    readonly registrationDate: string;
    readonly instant: Date;
  }> = [];
  let allResolved = normalizedDomains.every((domain) => domain !== null);
  for (const domain of domains) {
    const registration = input.domainRegistrations.get(domain);
    const instant =
      registration?.availability === "available" &&
      registration.registeredAt !== null
        ? parseInstant(registration.registeredAt)
        : null;
    if (instant === null || instant.getTime() > observedAt.getTime()) {
      allResolved = false;
      continue;
    }
    if (instant.getTime() >= cutoff.getTime()) {
      young.push({
        domain,
        registrationDate: registration?.registeredAt ?? instant.toISOString(),
        instant,
      });
    }
  }

  young.sort(
    (a, b) =>
      b.instant.getTime() - a.instant.getTime() ||
      a.domain.localeCompare(b.domain),
  );
  const selected = young[0];
  if (selected !== undefined) {
    return {
      state: "observed" as const,
      observation: {
        domain: selected.domain,
        registrationDate: selected.registrationDate,
        observedAt: input.observedAt,
        ageMonths: wholeCalendarMonths(selected.instant, observedAt),
      },
    };
  }

  return allResolved
    ? { state: "not_observed" as const, observation: null }
    : unavailableSignal("domain_registration_evidence_incomplete");
}

function lowTrafficSignal(input: KeywordSignalEvidenceInput) {
  const threshold = keywordSiteTrafficThreshold(input.siteDomainRank);
  if (threshold === null) return unavailableSignal("site_rank_tier_unavailable");
  if (input.domainTraffic === null) {
    return unavailableSignal("domain_traffic_stage_unavailable");
  }

  const normalized = input.sample.results.map((entry) =>
    normalizeTrafficDomain(entry.domain),
  );
  const domains = [
    ...new Set(normalized.filter((domain): domain is string => domain !== null)),
  ].sort();
  if (input.sample.results.length === 0) {
    return unavailableSignal("organic_result_domains_unavailable");
  }

  const known: Array<{ readonly domain: string; readonly organicEtv: number }> =
    [];
  for (const domain of domains) {
    const organicEtv = input.domainTraffic.get(domain);
    if (
      organicEtv !== null &&
      organicEtv !== undefined &&
      Number.isFinite(organicEtv) &&
      organicEtv >= 0
    ) {
      known.push({ domain, organicEtv });
    }
  }
  const low = known
    .filter((entry) => entry.organicEtv < threshold)
    .sort(
      (a, b) =>
        a.organicEtv - b.organicEtv || a.domain.localeCompare(b.domain),
    )[0];
  if (low !== undefined) {
    return {
      state: "observed" as const,
      observation: {
        domain: low.domain,
        organicEtv: low.organicEtv,
        threshold,
        marketCode: input.marketCode,
        languageCode: input.languageCode,
        observedAt: input.observedAt,
      },
    };
  }

  return normalized.every((domain) => domain !== null) &&
    known.length === domains.length
    ? { state: "not_observed" as const, observation: null }
    : unavailableSignal("domain_traffic_evidence_incomplete");
}

function normalizeHostname(value: string): string | null {
  const trimmed = value.trim().replace(/\.$/u, "").toLowerCase();
  if (trimmed === "" || /[\s/@:?#\\]/u.test(trimmed)) return null;
  const ascii = domainToASCII(trimmed);
  return ascii !== "" &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      ascii,
    )
    ? ascii
    : null;
}

function usableHttpUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      normalizeHostname(parsed.hostname) !== null
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

const COMMUNITY_FALLBACK_DOMAINS_V1 = [
  "reddit.com",
  "quora.com",
  "stackexchange.com",
  "stackoverflow.com",
  "medium.com",
  "news.ycombinator.com",
] as const;

function isCommunityFallback(domain: string): boolean {
  return COMMUNITY_FALLBACK_DOMAINS_V1.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}

function communitySignal(input: KeywordSignalEvidenceInput) {
  const providerCandidates = (input.sample.communityItems ?? [])
    .flatMap((item) => {
      const domain =
        item.domain === null ? null : normalizeHostname(item.domain);
      const url = usableHttpUrl(item.url);
      return domain !== null &&
        url !== null &&
        Number.isInteger(item.position) &&
        item.position > 0
        ? [{ domain, url, position: item.position }]
        : [];
    })
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.domain.localeCompare(b.domain) ||
        a.url.localeCompare(b.url),
    );
  const provider = providerCandidates[0];
  if (provider !== undefined) {
    return {
      state: "observed" as const,
      observation: { ...provider, source: "provider_item_type" as const },
    };
  }

  const fallback = input.sample.results
    .flatMap((entry) => {
      const domain = normalizeHostname(entry.domain);
      const url = usableHttpUrl(entry.url);
      return domain !== null &&
        url !== null &&
        isCommunityFallback(domain) &&
        Number.isInteger(entry.position) &&
        entry.position > 0
        ? [{ domain, url, position: entry.position }]
        : [];
    })
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.domain.localeCompare(b.domain) ||
        a.url.localeCompare(b.url),
    )[0];
  if (fallback !== undefined) {
    return {
      state: "observed" as const,
      observation: { ...fallback, source: "domain_fallback" as const },
    };
  }

  return input.sample.communityItems !== null &&
    input.sample.communityItems !== undefined
    ? { state: "not_observed" as const, observation: null }
    : unavailableSignal("community_item_availability_unreported");
}

function aiOverviewEvidence(
  sample: KeywordSerpSampleResult,
): KeywordOpportunityAiOverviewObservation {
  if (sample.status !== "complete") {
    return {
      availability: "unavailable",
      markdown: null,
      loadedAsync: null,
      answerAssessment: "unavailable",
      reason: "serp_unavailable",
      modelId: null,
      promptVersion: null,
    };
  }
  if (sample.aiOverview !== null && sample.aiOverview !== undefined) {
    return {
      availability: "observed",
      markdown: sample.aiOverview.markdown,
      loadedAsync: sample.aiOverview.isAsync,
      answerAssessment: "unavailable",
      reason:
        sample.aiOverview.markdown === null
          ? "content_unavailable"
          : "not_assessed",
      modelId: null,
      promptVersion: null,
    };
  }
  if (sample.pageItemTypes?.includes("ai_overview") === true) {
    return {
      availability: "observed",
      markdown: null,
      loadedAsync: null,
      answerAssessment: "unavailable",
      reason: "content_unavailable",
      modelId: null,
      promptVersion: null,
    };
  }
  if (sample.pageItemTypes !== null && sample.pageItemTypes !== undefined) {
    return {
      availability: "not_observed",
      markdown: null,
      loadedAsync: null,
      answerAssessment: "unavailable",
      reason: null,
      modelId: null,
      promptVersion: null,
    };
  }
  return {
    availability: "unavailable",
    markdown: null,
    loadedAsync: null,
    answerAssessment: "unavailable",
    reason: "item_types_unreported",
    modelId: null,
    promptVersion: null,
  };
}

export function buildKeywordSignalEvidence(
  input: KeywordSignalEvidenceInput,
): KeywordSignalEvidence {
  if (input.sample.status !== "complete") {
    const unavailable = unavailableSignal("serp_evidence_unavailable");
    return {
      signals: {
        youngDomain: unavailable,
        lowOrganicTrafficDomain: unavailable,
        communityResult: unavailable,
      },
      aiOverview: aiOverviewEvidence(input.sample),
    };
  }
  return {
    signals: {
      youngDomain: youngDomainSignal(input),
      lowOrganicTrafficDomain: lowTrafficSignal(input),
      communityResult: communitySignal(input),
    },
    aiOverview: aiOverviewEvidence(input.sample),
  };
}
