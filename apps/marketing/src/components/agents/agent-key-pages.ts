// @input  -- the run's neutral candidate shortlist and one confirmed Profile
// @output -- the pages this visitor's product actually cares about, in order
// @pos    -- pure client projection; reads no network and stores nothing

import {
  containsGeoAlias,
  normalizeAliasForMatch,
  GEO_MIN_ALIAS_TOKEN_LENGTH,
} from "../../lib/agents/geo-alias-match.ts";
import type { AgentKeyPageCandidate } from "../../lib/agents/audit-contract.ts";

/**
 * How many pages the report judges individually.
 *
 * Half the shortlist the server publishes. The list is read top to bottom by
 * a person, and a finding that names twelve pages is still a finding someone
 * can act on; one that names twenty-four is a spreadsheet.
 */
export const AGENT_KEY_PAGE_LIMIT = 12;

/**
 * Why a page is on the list.
 *
 * Carried but not yet shown. The surface states how many key pages a check
 * reached, not which ones or why — so this is the input a per-page breakdown
 * would need, and nothing reads it today. Said plainly rather than described
 * as "stated per row", which promised a row that does not exist.
 */
export type AgentKeyPageBasis = "homepage" | "target" | "feature" | "structure";

export interface AgentKeyPage extends AgentKeyPageCandidate {
  readonly basis: AgentKeyPageBasis;
  /** The matched core feature. Null unless the basis is a feature. Not shown yet, like the basis. */
  readonly matchedFeature: string | null;
}

/**
 * Score one candidate against the confirmed core features.
 *
 * The same rule the GEO site index ranks by: a whole feature found in the page
 * text is worth far more than the words it is made of, so "pricing calculator"
 * beats a page that merely says "pricing". The input text differs on purpose --
 * GEO reads anchor text it collected while crawling, and a finished audit
 * payload has the page's own title and description instead.
 */
function featureScore(
  candidate: AgentKeyPageCandidate,
  features: readonly string[],
): { readonly score: number; readonly matched: string | null } {
  let path: string;
  try {
    path = decodeURIComponent(new URL(candidate.url).pathname);
  } catch {
    path = candidate.url;
  }
  const text = normalizeAliasForMatch(
    `${path.replaceAll(/[-_/]/gu, " ")} ${candidate.title ?? ""} ${
      candidate.metaDescription ?? ""
    }`,
  );

  let score = 0;
  let matched: string | null = null;
  for (const feature of features) {
    const normalized = normalizeAliasForMatch(
      feature.replaceAll(/([a-z])([A-Z])/gu, "$1 $2"),
    );
    if (normalized === "") continue;
    if (containsGeoAlias(text, [normalized])) {
      score += 1000;
      matched ??= feature;
      continue;
    }
    const terms = normalized
      .split(/\s+/u)
      .filter(
        (term) =>
          term.length >= GEO_MIN_ALIAS_TOKEN_LENGTH &&
          containsGeoAlias(text, [term]),
      );
    if (terms.length > 0) {
      score += terms.length;
      matched ??= feature;
    }
  }
  return { score, matched };
}

export interface SelectAgentKeyPagesInput {
  readonly candidates: readonly AgentKeyPageCandidate[];
  /** Confirmed core features. Empty is a real state, not a missing input. */
  readonly coreFeatures: readonly string[];
  readonly siteOrigin: string;
  readonly inspectedTargetUrl: string | null;
}

/**
 * Narrow the run's shortlist to the pages this product is actually about.
 *
 * With no confirmed core features there is nothing to rank by, so the list
 * keeps the server's structural order and every row says so. Inventing an
 * interest from the URL alone would dress a guess as a confirmation.
 */
export function selectAgentKeyPages({
  candidates,
  coreFeatures,
  siteOrigin,
  inspectedTargetUrl,
}: SelectAgentKeyPagesInput): readonly AgentKeyPage[] {
  const features = coreFeatures
    .map((feature) => feature.trim())
    .filter((feature) => feature !== "");
  const homeUrls = new Set([`${siteOrigin}/`, siteOrigin]);
  const basisOf = (candidate: AgentKeyPageCandidate): AgentKeyPageBasis | null =>
    homeUrls.has(candidate.url)
      ? "homepage"
      : candidate.url === inspectedTargetUrl
        ? "target"
        : null;

  const scored = candidates.map((candidate, index) => {
    const pinned = basisOf(candidate);
    const { score, matched } =
      pinned === null && features.length > 0
        ? featureScore(candidate, features)
        : { score: 0, matched: null };
    return { candidate, index, pinned, score, matched };
  });

  const ranked = scored.toSorted((left, right) => {
    // The home page and the submitted page are on the list whatever the
    // Profile says: one is where a reader starts and the other is what they
    // asked about.
    const pinRank = (entry: (typeof scored)[number]): number =>
      entry.pinned === "homepage" ? 0 : entry.pinned === "target" ? 1 : 2;
    return (
      pinRank(left) - pinRank(right) ||
      right.score - left.score ||
      // The server already ordered the rest by how the site links them.
      left.index - right.index
    );
  });

  return ranked.slice(0, AGENT_KEY_PAGE_LIMIT).map((entry) => ({
    ...entry.candidate,
    basis:
      entry.pinned ??
      (features.length > 0 && entry.score > 0 ? "feature" : "structure"),
    matchedFeature: entry.pinned === null ? entry.matched : null,
  }));
}
