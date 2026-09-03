// @input  -- one run's joined ledger plus the key pages this visitor's Profile chose
// @output -- one page-level evaluation per key page, each judged on what it may use
// @pos    -- pure orchestration; the only place that decides which pages get judged

import {
  evaluateAgentAuditScope,
  type AgentAuditEvaluation,
} from "@sf/public-tools/agent-audit";
import type { SeoAuditRecord } from "@sf/public-tools";

import { recordsForKeyPage } from "./agent-key-page-records.ts";
import type { AgentKeyPage } from "./agent-key-pages.ts";

export interface AgentKeyPageEvaluation {
  readonly page: AgentKeyPage;
  readonly evaluation: AgentAuditEvaluation;
}

export interface EvaluateKeyPagesInput {
  readonly records: readonly SeoAuditRecord[];
  readonly availability: "available" | "partial" | "unavailable";
  readonly keyPages: readonly AgentKeyPage[];
  readonly targetUrl: string;
  readonly targetInspected: boolean;
  readonly inspectedTargetUrl: string | null;
}

/**
 * The submitted page, when the shortlist does not already contain it.
 *
 * A page only becomes a candidate if the crawl collected it as 2xx HTML, so a
 * target that redirected away, errored, or was never reached has no row of its
 * own. It still has to be judged: several regions -- the confirmed query, CrUX,
 * the SERP sample -- were derived for that URL and paid for, and dropping the
 * one entry that can read them would throw the run's most expensive evidence
 * away over a page shape.
 */
function syntheticTarget(targetUrl: string): AgentKeyPage {
  return {
    url: targetUrl,
    title: null,
    metaDescription: null,
    depth: 0,
    inboundLinks: 0,
    basis: "target",
    matchedFeature: null,
  };
}

/**
 * Judge each key page on the records that can honestly speak about it.
 *
 * The submitted page is judged exactly as it is today: every record, its own
 * `targetTested` flags intact. Every other key page is judged on a filtered
 * ledger -- see `recordsForKeyPage` for why carrying the target's flags would
 * report other pages as passing checks nobody ran on them.
 */
export function evaluateAgentKeyPages({
  records,
  availability,
  keyPages,
  targetUrl,
  targetInspected,
  inspectedTargetUrl,
}: EvaluateKeyPagesInput): readonly AgentKeyPageEvaluation[] {
  const pages = keyPages.some((page) => page.url === inspectedTargetUrl)
    ? keyPages
    : [syntheticTarget(targetUrl), ...keyPages];

  return pages.map((page) => {
    const isSubmittedTarget =
      page.url === inspectedTargetUrl || page.url === targetUrl;
    return {
      page,
      evaluation: evaluateAgentAuditScope("page", {
        records: recordsForKeyPage({ records, isSubmittedTarget }),
        availability,
        targetUrl: page.url,
        // The uninspected target keeps the run's own answer: records about
        // that population are returned unprojected, so the regions derived for
        // it still decide, while nothing claims the crawl read the page.
        targetInspected: isSubmittedTarget ? targetInspected : true,
        inspectedTargetUrl: isSubmittedTarget ? inspectedTargetUrl : page.url,
      }),
    };
  });
}
