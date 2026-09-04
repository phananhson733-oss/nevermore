// @input  -- v2 catalog evaluator, neutral Agent evidence, and confirmed local Profile context
// @output -- one merged check list across the key pages, plus the run provenance
// @pos    -- pure adapter between browser-safe audit policy and the issue list

import {
  evaluateAgentAuditScope,
  type AgentAuditEvaluatedCheck,
} from "@sf/public-tools/agent-audit";

import {
  aggregateKeyPageEvaluations,
  type AgentKeyPageReach,
} from "./agent-key-page-aggregate.ts";
import { evaluateAgentKeyPages } from "./agent-key-page-evaluation.ts";
import { selectAgentKeyPages, type AgentKeyPage } from "./agent-key-pages.ts";

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
  /** Server-selected candidates after Profile ordering, never synthetic. */
  readonly candidatePages: readonly AgentKeyPage[];
  /** Pages judged individually this run, in the order the report lists them. */
  readonly keyPages: readonly AgentKeyPage[];
  /**
   * Whether any of them came from the run's own shortlist.
   *
   * False when the only judged page is the synthetic stand-in for the
   * submitted URL. `keyPages.length` cannot answer this: it is never zero,
   * because that stand-in is always added.
   */
  readonly keyPagesWereSelected: boolean;
  /** Content candidates displaced by the server's 50-page safety valve. */
  readonly omittedUrls: readonly string[];
  /** Manual additions that were not available as collected 2xx HTML pages. */
  readonly manualUnavailableUrls: readonly string[];
  /** How much of the key page set each page-level check was judged on. */
  readonly keyPageReach: ReadonlyMap<string, AgentKeyPageReach>;
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
  coreFeatures,
}: {
  readonly agent: AgentKind;
  readonly locale: string;
  readonly context: AgentDiagnosisContext;
  readonly data: AgentAuditSuccessData;
  /** Confirmed core features. Empty is a real state: nothing to rank by. */
  readonly coreFeatures: readonly string[];
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
  const candidatePages = selectAgentKeyPages({
    candidates: data.result.keyPages ?? [],
    coreFeatures,
    siteOrigin: data.result.siteOrigin,
    inspectedTargetUrl: data.result.inspectedTargetUrl,
  });
  const evaluated = evaluateAgentKeyPages({
    records: evidence.records,
    availability: evidence.availability,
    keyPages: candidatePages,
    targetUrl: data.result.targetUrl,
    targetInspected: data.result.targetInspected,
    inspectedTargetUrl: data.result.inspectedTargetUrl,
  });
  const aggregate = aggregateKeyPageEvaluations({ site, pages: evaluated });
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
    // The pages actually judged, which is what every denominator counts. The
    // selection alone is one short whenever the submitted page was not
    // collected: it is judged from a synthetic row rather than a candidate, and
    // a header that omitted it would disagree with every row beneath it.
    candidatePages,
    keyPages: evaluated.map((entry) => entry.page),
    keyPagesWereSelected: candidatePages.length > 0,
    omittedUrls: data.result.keyPageSelection?.omittedUrls ?? [],
    manualUnavailableUrls:
      data.result.keyPageSelection?.manualUnavailableUrls ?? [],
    keyPageReach: aggregate.reach,
    evaluatedChecks: aggregate.checks,
  };
}
