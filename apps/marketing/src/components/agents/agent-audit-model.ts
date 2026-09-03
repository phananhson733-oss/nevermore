// @input  -- v2 catalog evaluator, neutral Agent evidence, and confirmed local Profile context
// @output -- one evaluated check list plus the run provenance the surface states
// @pos    -- pure adapter between browser-safe audit policy and the issue list

import {
  evaluateAgentAuditScope,
  type AgentAuditEvaluatedCheck,
} from "@sf/public-tools/agent-audit";

import { allAgentAuditRecords } from "../../lib/agents/audit-contract";
import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import type {
  AgentAuditScope as ProfileAuditScope,
  AgentProfileDevice,
  AgentProfilePageType,
  AgentProfileReviewState,
} from "./agent-profile";
import type { AgentKind } from "./agent-types";

export interface AgentDiagnosisContext {
  readonly reviewState: AgentProfileReviewState;
  readonly productName: string;
  readonly primaryIcp: string;
  readonly country: string;
  readonly locale: string;
  readonly device: AgentProfileDevice;
  readonly pageType: AgentProfilePageType;
  readonly targetQuery: string;
  readonly auditScope: ProfileAuditScope;
}

export interface AgentAuditViewModel {
  readonly agent: AgentKind;
  readonly locale: string;
  readonly context: AgentDiagnosisContext;
  readonly provenance: {
    readonly availability: AgentAuditSuccessData["result"]["coverage"]["availability"];
    readonly sourceTool: "seo_audit";
    readonly schemaVersion: string;
    readonly persistence: "none";
    readonly completedAt: string;
  };
  readonly evaluatedChecks: readonly AgentAuditEvaluatedCheck[];
  /**
   * Which Search Console property answered this run, or null.
   *
   * Null is the state worth surfacing: six checks report "authorized source
   * required" and, before this existed, the panel gave a visitor who had
   * already signed in with Google no way to tell that this tool never asked
   * for their Search Console data at all.
   */
  readonly searchSource:
    | {
        readonly state: "connected";
        readonly property: string;
        readonly startDate: string;
        readonly endDate: string;
      }
    /** Nothing covers this host; authorizing is what changes it. */
    | { readonly state: "absent" }
    /** Reachable and did not answer; waiting is what changes it. */
    | { readonly state: "unavailable" };
}






export function buildAgentAuditViewModel({
  agent,
  locale,
  context,
  data,
}: {
  readonly agent: AgentKind;
  readonly locale: string;
  readonly context: AgentDiagnosisContext;
  readonly data: AgentAuditSuccessData;
}): AgentAuditViewModel {
  const evidence = {
    availability: data.result.coverage.availability,
    // The search records travel beside the crawl ledger rather than inside it,
    // because the crawl payload is cached by host and these belong to one
    // visitor's verified property. The evaluator wants one list, so they are
    // joined here, at read time, and never on the way to a cache.
    records: allAgentAuditRecords(data),
    targetUrl: data.result.targetUrl,
    targetInspected: data.result.targetInspected,
    inspectedTargetUrl: data.result.inspectedTargetUrl,
  } as const;
  const site = evaluateAgentAuditScope("site", evidence);
  const page = evaluateAgentAuditScope("page", evidence);
  const region = data.result.searchPerformance;

  return {
    agent,
    locale,
    context,
    provenance: {
      availability: data.result.coverage.availability,
      sourceTool: data.run.source.tool,
      schemaVersion: data.run.source.schemaVersion,
      persistence: data.run.persistence,
      completedAt: data.run.source.completedAt,
    },
    searchSource:
      region !== undefined
        ? {
            state: "connected",
            property: region.property,
            startDate: region.startDate,
            endDate: region.endDate,
          }
        : data.result.searchPerformanceUnavailable === true
          ? { state: "unavailable" }
          : { state: "absent" },
    evaluatedChecks: [...site.checks, ...page.checks],
  };
}
