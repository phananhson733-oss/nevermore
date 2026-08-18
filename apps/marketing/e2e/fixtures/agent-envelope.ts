// @input  -- nothing; the shape the Agent API promises its own UI
// @output -- one success envelope the client guard actually accepts
// @pos    -- shared by the Playwright route mock and the test that checks it
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  AGENT_AUDIT_RECORD_CATEGORIES,
  AGENT_AUDIT_SOURCE_SCHEMA_VERSION,
} from "../../src/lib/agents/audit-contract";

export type AgentKind = "seo" | "tech";

/**
 * The ledger the app actually requires, read from the contract.
 *
 * This used to be a copy: seventeen ids against the contract's twenty-four, and
 * a schema version two releases behind. The client guard rejects both, so these
 * tests were asserting that the app accepts an envelope it refuses — and
 * nothing said so, because Playwright is not in `pnpm test`. Deriving the
 * fixture from the contract means the mock cannot fall behind it again.
 */
const RECORD_CATEGORIES = AGENT_AUDIT_RECORD_CATEGORIES;

export function agentEnvelope(agent: AgentKind) {
  const observedId =
    agent === "seo" ? "title_missing" : "non_2xx_final_status";
  return {
    data: {
      run: {
        agent,
        mode: "authenticated_agent",
        persistence: "none",
        source: {
          tool: "seo_audit",
          schemaVersion: AGENT_AUDIT_SOURCE_SCHEMA_VERSION,
          completedAt: "2026-08-12T10:00:00.000Z",
          cache: { status: "miss", capturedAt: null },
        },
      },
      result: {
        targetUrl: "https://astrologywiki.com/",
        siteOrigin: "https://astrologywiki.com",
        scannedAt: "2026-08-12T10:00:00.000Z",
        targetInspected: false,
        inspectedTargetUrl: null,
        targetPageExtract: null,
        coverage: {
          availability: "partial",
          pagesInspected: 3,
          linksObserved: 7,
          sitemapUrlsObserved: 5,
          urlsSkipped: 1,
          urlsBlocked: 0,
          urlsDisallowed: 0,
          urlsErrored: 1,
          stopReason: "max_urls",
        },
        siteResources: {
          robotsFetched: true,
          robotsGroupsObserved: 1,
          sitemapReferencesObserved: 1,
          sitemapFetched: true,
        },
        records: Object.entries(RECORD_CATEGORIES).map(([id, category]) => {
          const observed = id === observedId;
          const siteResource =
            id === "robots_resource" || id === "sitemap_resource";
          return {
            id,
            category,
            state: observed ? "observed" : "not_observed",
            population: siteResource ? "site_resource" : "every_collected_page",
            targetTested: null,
            unit: siteResource
              ? "site_resource"
              : id === "internal_target_http_error"
                ? "link_targets"
                : "pages",
            tested: siteResource ? 1 : 3,
            affected: observed ? 1 : 0,
            observations: observed
              ? [
                  {
                    url:
                      agent === "seo"
                        ? "https://astrologywiki.com/about"
                        : "https://astrologywiki.com/old",
                    values:
                      agent === "seo"
                        ? [{ label: "title", value: null }]
                        : [
                            { label: "initial_status", value: 404 },
                            { label: "final_status", value: 404 },
                          ],
                  },
                ]
              : [],
            limitation: null,
          };
        }),
      },
    },
  } as const;
}

