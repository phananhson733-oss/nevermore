// @input  -- shape-validated Agent audit data from the server contract
// @output -- exact current message-vocabulary compatibility decision
// @pos    -- fail-closed seam before dynamic record/evidence translations render

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import { SEO_AUDIT_RECORD_IDS } from "@sf/public-tools/seo-audit/record-ledger";

import type { AgentKind } from "./agent-types";

/**
 * Derived from the producer's ledger, not a fifth hand-written copy of it.
 *
 * This seam fails closed on a record it does not recognise, which is correct
 * and is what caught five new detectors reaching the UI with no message
 * vocabulary — the results panel simply stopped rendering. What it must not
 * also do is re-state which records exist, because then adding a detector means
 * finding every list that names them. The vocabulary itself is guarded by
 * agent-display-contract.test.ts, which fails if any ledger record has no title
 * and description in both locales.
 */
const NEUTRAL_AGENT_RECORD_IDS: ReadonlySet<string> = new Set(
  SEO_AUDIT_RECORD_IDS,
);

export const AGENT_RECORD_IDS: Readonly<Record<AgentKind, ReadonlySet<string>>> = {
  seo: NEUTRAL_AGENT_RECORD_IDS,
  tech: NEUTRAL_AGENT_RECORD_IDS,
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
  "broken_link_targets",
  "title_characters",
  "description_characters",
  "reviewed_range",
  "observed_outbound_internal_links",
  "observed_click_depth",
  "reviewed_limit",
  "json_ld_blocks",
  "average_response_ms",
  "slowest_response_ms",
  "pages_timed",
  "average_click_depth",
  "deepest_click_depth",
  "pages_measured",
]);

export const AGENT_LIMITATION_CODES: ReadonlySet<string> = new Set([
  "resource_not_observed_does_not_prove_absence",
  "static_response_directives_only",
  "normalised_text_match_within_inspected_pages",
  "bounded_static_html_crawl_inlinks_only",
  "uncollected_link_targets_not_classified",
  "static_html_json_ld_only",
  "no_sitemap_collected_membership_not_testable",
  "character_count_only_rendered_pixel_width_not_measured",
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
