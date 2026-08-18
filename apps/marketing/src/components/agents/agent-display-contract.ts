// @input  -- shape-validated Agent audit data from the server contract
// @output -- exact current message-vocabulary compatibility decision
// @pos    -- fail-closed seam before dynamic record/evidence translations render

import { allAgentAuditRecords } from "../../lib/agents/audit-contract";
import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import {
  SEARCH_PERFORMANCE_LIMITATION_CODES,
  SEO_AUDIT_EVIDENCE_LABELS,
  SEO_AUDIT_LIMITATION_CODES,
  SEO_AUDIT_RECORD_IDS,
} from "@sf/public-tools/seo-audit/record-ledger";
import {
  SEARCH_PERFORMANCE_EVIDENCE_LABELS,
  SEARCH_PERFORMANCE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/search-performance";
import {
  KEYWORD_EVIDENCE_EVIDENCE_LABELS,
  KEYWORD_EVIDENCE_LIMITATION_CODES,
  KEYWORD_EVIDENCE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/keyword-evidence/records";
import {
  PAGE_PERFORMANCE_EVIDENCE_LABELS,
  PAGE_PERFORMANCE_LIMITATION_CODES,
  PAGE_PERFORMANCE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/page-performance";
import {
  SERP_SHAPE_EVIDENCE_LABELS,
  SERP_SHAPE_LIMITATION_CODES,
  SERP_SHAPE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/serp-shape";

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
const NEUTRAL_AGENT_RECORD_IDS: ReadonlySet<string> = new Set([
  ...SEO_AUDIT_RECORD_IDS,
  // Derived per visitor rather than crawled, and rendered by the same seam.
  ...SEARCH_PERFORMANCE_RECORD_IDS,
  ...KEYWORD_EVIDENCE_RECORD_IDS,
  ...PAGE_PERFORMANCE_RECORD_IDS,
  ...SERP_SHAPE_RECORD_IDS,
]);

export const AGENT_RECORD_IDS: Readonly<Record<AgentKind, ReadonlySet<string>>> = {
  seo: NEUTRAL_AGENT_RECORD_IDS,
  tech: NEUTRAL_AGENT_RECORD_IDS,
};

/**
 * Derived too, and for the same reason the other two are.
 *
 * This was a hand-written transcription of the crawl ledger sitting beside two
 * derived lists. Three detectors landed with two new labels between them and it
 * silently did not grow, which fails the panel closed on a record the producer
 * is entitled to emit — the same shape of bug, in the one place still typing it
 * out by hand.
 */
export const AGENT_EVIDENCE_LABELS: ReadonlySet<string> = new Set([
  ...SEO_AUDIT_EVIDENCE_LABELS,
  ...SEARCH_PERFORMANCE_EVIDENCE_LABELS,
  ...KEYWORD_EVIDENCE_EVIDENCE_LABELS,
  ...PAGE_PERFORMANCE_EVIDENCE_LABELS,
  ...SERP_SHAPE_EVIDENCE_LABELS,
]);

/**
 * Derived, because a hand-kept copy is what took the panel dark.
 *
 * This seam refuses a record whose limitation code it cannot name, and it
 * refuses silently: the results view simply does not render. One record
 * publishes its code unconditionally, so a single missing entry blanked every
 * audit while every unit test stayed green.
 */
export const AGENT_LIMITATION_CODES: ReadonlySet<string> = new Set([
  ...SEO_AUDIT_LIMITATION_CODES,
  ...SEARCH_PERFORMANCE_LIMITATION_CODES,
  ...KEYWORD_EVIDENCE_LIMITATION_CODES,
  ...PAGE_PERFORMANCE_LIMITATION_CODES,
  ...SERP_SHAPE_LIMITATION_CODES,
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
  // Side regions render through the same seam, so they have to pass the same
  // check. Walking only `records` left the search region entirely unvalidated —
  // a vocabulary gap there would have reached a visitor rather than failing
  // closed, which is the opposite failure and the harder one to notice.
  return allAgentAuditRecords(data).every(
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
