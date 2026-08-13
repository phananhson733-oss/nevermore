// @input  -- shape-validated Agent audit data from the server contract
// @output -- exact current message-vocabulary compatibility decision
// @pos    -- fail-closed seam before dynamic record/evidence translations render

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import type { AgentKind } from "./agent-types";

export const AGENT_RECORD_IDS: Readonly<Record<AgentKind, ReadonlySet<string>>> = {
  seo: new Set([
    "title_missing",
    "title_duplicate",
    "meta_description_missing",
    "meta_description_duplicate",
    "h1_missing",
    "multiple_h1",
    "json_ld_parse_error",
  ]),
  tech: new Set([
    "robots_resource",
    "sitemap_resource",
    "non_2xx_final_status",
    "redirect_chain",
    "http_url",
    "noindex_directive",
    "canonical_missing",
    "canonical_differs",
    "sitemap_page_without_observed_inlink",
    "internal_target_http_error",
  ]),
};

export const AGENT_EVIDENCE_LABELS: ReadonlySet<string> = new Set([
  "fetched",
  "groups_observed",
  "sitemap_references",
  "urls_observed",
  "initial_status",
  "final_status",
  "redirect_hops",
  "final_url",
  "final_protocol",
  "robots_directive",
  "canonical_target",
  "page_subject",
  "title",
  "matching_pages",
  "meta_description",
  "h1_count",
  "sitemap_member",
  "observed_inbound_links",
  "observed_source_pages",
  "malformed_blocks",
  "types_observed",
]);

export const AGENT_LIMITATION_CODES: ReadonlySet<string> = new Set([
  "resource_not_observed_does_not_prove_absence",
  "static_response_directives_only",
  "normalised_text_match_within_inspected_pages",
  "bounded_static_html_crawl_inlinks_only",
  "uncollected_link_targets_not_classified",
  "static_html_json_ld_only",
]);

/**
 * The server owns domain validation and category projection. The browser owns
 * one additional requirement: every dynamic message key must exist in the
 * currently deployed catalog. A new upstream ledger entry therefore fails
 * closed until its UI copy ships, instead of rendering a translation error.
 */
export function supportsAgentDisplayVocabulary(
  data: AgentAuditSuccessData,
  expectedAgent: AgentKind,
): boolean {
  if (data.run.agent !== expectedAgent) return false;
  const supportedIds = AGENT_RECORD_IDS[expectedAgent];
  return data.result.records.every(
    (record) =>
      supportedIds.has(record.id) &&
      (record.limitation === null ||
        AGENT_LIMITATION_CODES.has(record.limitation)) &&
      record.observations.every((observation) =>
        observation.values.every((entry) =>
          AGENT_EVIDENCE_LABELS.has(entry.label),
        ),
      ),
  );
}
