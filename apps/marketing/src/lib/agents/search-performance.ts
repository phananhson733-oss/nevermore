// @input  -- the audited URL, the pages this crawl collected, and the visitor's grant
// @output -- search-performance evidence for that host, or null when nothing covers it
// @pos    -- server-only composition; the audit degrades to the gated state on any miss
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { keywordCoverageProperty } from "@sf/public-tools";
import {
  buildSearchPerformanceRecords,
  type SearchPerformanceRaw,
} from "@sf/public-tools/seo-audit/search-performance";
import type { SeoAuditReport } from "@sf/public-tools";

import type { GrantResolution } from "../auth/grant-cookie.ts";
import { resolveTrafficDropGrant } from "../tools/traffic-drop-session.ts";
import type { AgentSearchPerformance } from "./audit-contract.ts";
import {
  createSearchPerformanceReader,
  type SearchPerformanceReadInput,
} from "./search-performance-reader.ts";

export interface SearchPerformanceDependencies {
  readonly resolveGrant: () => Promise<GrantResolution>;
  readonly read: (
    input: SearchPerformanceReadInput,
  ) => Promise<SearchPerformanceRaw>;
}

export const DEFAULT_SEARCH_PERFORMANCE_DEPENDENCIES: SearchPerformanceDependencies =
  {
    resolveGrant: resolveTrafficDropGrant,
    read: createSearchPerformanceReader({}),
  };

/**
 * Reads this visitor's Search Console numbers for the audited host.
 *
 * Returns null for every way there is nothing to read: no grant, a grant that
 * covers no property for this host, or a read that failed. All three leave the
 * search checks reporting the authorization they need, which is a state the
 * visitor can act on — unlike a failed audit.
 *
 * Coverage is measured against the pages this crawl collected, not against
 * everything the property knows, because the checks are about the site this run
 * actually looked at.
 */
export async function readAgentSearchPerformance(
  input: {
    readonly targetUrl: string;
    readonly pages: SeoAuditReport["pages"];
  },
  dependencies: SearchPerformanceDependencies = DEFAULT_SEARCH_PERFORMANCE_DEPENDENCIES,
): Promise<AgentSearchPerformance | null> {
  const grant = await dependencies.resolveGrant();
  if (grant.kind !== "grant") return null;

  // Search Console is addressed by property identifier, never by the URL the
  // visitor typed, and the narrowest covering property wins: reading a domain
  // property to answer a question about one subdomain attributes the whole
  // site's numbers to it.
  const property = keywordCoverageProperty(input.targetUrl, grant.properties);
  if (property === null) return null;

  const raw = await dependencies.read({
    property,
    accessToken: grant.accessToken,
  });
  const records = buildSearchPerformanceRecords(raw, input.pages);
  if (records.length === 0) return null;

  return {
    property,
    startDate: raw.startDate,
    endDate: raw.endDate,
    records,
  };
}
