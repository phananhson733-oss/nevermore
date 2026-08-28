// @input  -- one parsed website profile, its exact submitted URL, and explicit competitor choices
// @output -- existing profile-search requests and immutable user-owned relationship updates
// @pos    -- browser-safe adapter; provider observations never enter the durable website profile

import {
  classifyCompetitorRelationships,
  type AgentCompetitorClassification,
} from "../../components/agents/agent-competitor-candidates.ts";
import {
  deriveProfileSearchSeeds,
  productProfileSearchSeedsIdentity,
} from "../../components/agents/agent-profile-search-seeds.ts";
import { normalizeAgentProfileSearchDomain } from "../agents/profile-search-contract.ts";
import {
  parseMarketingWebsiteProfile,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileFieldProvenance,
} from "./contracts.ts";

export interface WebsiteCompetitorSearchRequest {
  readonly url: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly targetQuery: "";
  readonly productProfileSearchSeeds: readonly string[];
}

function hasCanonicalLanguageIdentity(languageTag: string): boolean {
  try {
    return Intl.getCanonicalLocales(languageTag)[0] === languageTag;
  } catch {
    return false;
  }
}

export function websiteCompetitorSearchRequest(
  profile: MarketingWebsiteProfileV1,
  submittedUrl: string,
): WebsiteCompetitorSearchRequest | null {
  let parsed: MarketingWebsiteProfileV1;
  try {
    parsed = parseMarketingWebsiteProfile(profile);
  } catch {
    return null;
  }

  if (
    !/^[A-Z]{2}$/u.test(parsed.country) ||
    !hasCanonicalLanguageIdentity(parsed.locale)
  ) {
    return null;
  }

  return {
    url: submittedUrl,
    marketCode: parsed.country,
    languageTag: parsed.locale,
    targetQuery: "",
    productProfileSearchSeeds: deriveProfileSearchSeeds(parsed),
  };
}

export function websiteCompetitorSearchIdentity(
  request: WebsiteCompetitorSearchRequest,
): string {
  return JSON.stringify([
    request.url,
    request.marketCode,
    request.languageTag,
    request.targetQuery,
    productProfileSearchSeedsIdentity(request.productProfileSearchSeeds),
  ]);
}

type RelationshipPath =
  | "/directCompetitors"
  | "/indirectAlternatives"
  | "/excludedAlternatives";

function listsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function userEditProvenance(
  path: RelationshipPath,
): WebsiteProfileFieldProvenance {
  return {
    path,
    derivation: "declared",
    confidence: "high",
    source: "user_edit",
    limitation: null,
    observedAt: null,
    evidenceUrls: [],
  };
}

function replaceRelationshipProvenance(
  fieldProvenance: readonly WebsiteProfileFieldProvenance[],
  path: RelationshipPath,
): readonly WebsiteProfileFieldProvenance[] {
  let replaced = false;
  const next = fieldProvenance.map((entry) => {
    if (entry.path !== path) return entry;
    replaced = true;
    return userEditProvenance(path);
  });
  return replaced ? next : [...next, userEditProvenance(path)];
}

export function classifyWebsiteCompetitor(
  profile: MarketingWebsiteProfileV1,
  domain: string,
  classification: AgentCompetitorClassification,
): MarketingWebsiteProfileV1 {
  const parsed = parseMarketingWebsiteProfile(profile);
  return parseMarketingWebsiteProfile(
    classifyWebsiteCompetitorDraft(parsed, domain, classification),
  );
}

export function classifyWebsiteCompetitorDraft(
  profile: MarketingWebsiteProfileV1,
  domain: string,
  classification: AgentCompetitorClassification,
): MarketingWebsiteProfileV1 {
  const relationships = {
    direct: profile.directCompetitors,
    indirect: profile.indirectAlternatives,
    excluded: profile.excludedAlternatives,
  };
  const normalizedDomain = normalizeAgentProfileSearchDomain(domain);
  if (normalizedDomain !== null) {
    const selectedMatches = relationships[classification].filter(
      (value) =>
        normalizeAgentProfileSearchDomain(value) === normalizedDomain,
    );
    const hasOtherMatch = (
      ["direct", "indirect", "excluded"] as const
    ).some(
      (bucket) =>
        bucket !== classification &&
        relationships[bucket].some(
          (value) =>
            normalizeAgentProfileSearchDomain(value) === normalizedDomain,
        ),
    );
    if (
      selectedMatches.length === 1 &&
      selectedMatches[0] === normalizedDomain &&
      !hasOtherMatch
    ) {
      return { ...profile };
    }
  }

  const classified = classifyCompetitorRelationships(
    relationships,
    domain,
    classification,
  );

  let fieldProvenance = profile.fieldProvenance;
  if (!listsEqual(profile.directCompetitors, classified.direct)) {
    fieldProvenance = replaceRelationshipProvenance(
      fieldProvenance,
      "/directCompetitors",
    );
  }
  if (!listsEqual(profile.indirectAlternatives, classified.indirect)) {
    fieldProvenance = replaceRelationshipProvenance(
      fieldProvenance,
      "/indirectAlternatives",
    );
  }
  if (!listsEqual(profile.excludedAlternatives, classified.excluded)) {
    fieldProvenance = replaceRelationshipProvenance(
      fieldProvenance,
      "/excludedAlternatives",
    );
  }

  return {
    ...profile,
    directCompetitors: classified.direct,
    indirectAlternatives: classified.indirect,
    excludedAlternatives: classified.excluded,
    fieldProvenance,
  };
}
