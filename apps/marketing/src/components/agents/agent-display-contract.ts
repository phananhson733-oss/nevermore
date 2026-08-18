// @input  -- shape-validated Agent audit data from the server contract
// @output -- exact current message-vocabulary compatibility decision
// @pos    -- fail-closed seam before dynamic record/evidence translations render

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import type { AgentKind } from "./agent-types";

const NEUTRAL_AGENT_RECORD_IDS = new Set([
  "robots_resource",
  "sitemap_resource",
  "non_2xx_final_status",
  "redirect_chain",
  "http_url",
  "noindex_directive",
  "canonical_missing",
  "canonical_differs",
  "title_missing",
  "title_duplicate",
  "meta_description_missing",
  "meta_description_duplicate",
  "h1_missing",
  "multiple_h1",
  "json_ld_parse_error",
  "sitemap_page_without_observed_inlink",
  "internal_target_http_error",
  "page_outbound_broken_link",
  "page_not_in_sitemap",
  "title_length_outside_range",
  "meta_description_length_outside_range",
  "page_without_outbound_internal_link",
  "click_depth_beyond_reviewed_limit",
  "json_ld_missing",
]);

export const AGENT_RECORD_IDS: Readonly<Record<AgentKind, ReadonlySet<string>>> = {
  seo: NEUTRAL_AGENT_RECORD_IDS,
  tech: NEUTRAL_AGENT_RECORD_IDS,
};

/**
 * Every evidence label the audit can emit, and nothing else.
 *
 * `supportsAgentDisplayVocabulary` fails closed on an unknown label, so this set
 * falling behind `model.ts` is not a cosmetic gap — the Agent answers
 * `audit_response_invalid` for any site that produces the missing label. It has
 * happened: renaming `title_characters` to `title_display_width` upstream broke
 * every site whose title sits outside the reviewed range, which is most of them.
 * A test drives the real model over real HTML and checks its output against this
 * set, so the two cannot drift again.
 *
 * Old spellings are removed rather than kept alongside: the schema version bump
 * that ships with a rename already makes older cached payloads unreadable, so a
 * retained entry would only be a name nothing can produce.
 */
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
  "broken_link_targets",
  "title_display_width",
  "description_display_width",
  "reviewed_range",
  "observed_outbound_internal_links",
  "observed_click_depth",
  "reviewed_limit",
  "json_ld_blocks",
]);

export const AGENT_LIMITATION_CODES: ReadonlySet<string> = new Set([
  "resource_not_observed_does_not_prove_absence",
  "static_response_directives_only",
  "normalised_text_match_within_inspected_pages",
  "bounded_static_html_crawl_inlinks_only",
  "uncollected_link_targets_not_classified",
  "static_html_json_ld_only",
  "no_sitemap_collected_membership_not_testable",
  "display_width_approximation_rendered_pixel_width_not_measured",
  "bounded_static_html_crawl_outlinks_only",
  "depth_from_bounded_crawl_entry_point_only",
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
