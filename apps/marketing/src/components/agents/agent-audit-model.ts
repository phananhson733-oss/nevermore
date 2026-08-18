// @input  -- v2 catalog evaluator, neutral Agent evidence, and confirmed local Profile context
// @output -- localized two-scope Diagnosis model plus original evaluated checks
// @pos    -- pure adapter between browser-safe audit policy and Stage 02/03 UI

import {
  AGENT_AUDIT_DEFAULT_GROUPS,
  AGENT_AUDIT_HEADING_PRESETS,
  evaluateAgentAuditScope,
  type AgentAuditEngineState as ContractEngineState,
  type AgentAuditEvaluatedCheck,
  type AgentAuditResultState,
  type AgentAuditTruthState as ContractTruthState,
} from "@sf/public-tools/agent-audit";

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import type {
  AgentAuditScope as ProfileAuditScope,
  AgentProfileDevice,
  AgentProfilePageType,
  AgentProfileReviewState,
} from "./agent-profile";
import type { AgentKind } from "./agent-types";

export type AgentAuditScope = "site" | "page";
export type { AgentAuditResultState };
export type AgentAuditEngineState =
  | "ready"
  | "needs_integration"
  | "needs_supplement"
  | "not_integrated"
  | "access_required";
export type AgentAuditTruthState =
  | "observed"
  | "not_observed"
  | "documented"
  | "inferred"
  | "partial"
  | "source_gated"
  | "unavailable"
  | "illustrative";

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

export interface AgentAuditCheckView {
  readonly id: string;
  readonly title: string;
  readonly result: AgentAuditResultState;
  readonly engine: AgentAuditEngineState;
  readonly truth: AgentAuditTruthState;
  readonly measurement: string | number | null;
  readonly threshold: string;
  readonly thresholdAuthority: string;
  readonly scoreWeight: number;
  readonly scored: boolean;
  readonly blocking: boolean;
  readonly impact: string;
  readonly howToFix: string;
  readonly dataSource: string;
  readonly scoreContribution: number | null;
  readonly boundary: string;
}

export interface AgentAuditPolicyOverride {
  readonly threshold?: string;
  readonly weight?: number;
}

export type AgentAuditPolicyOverrides = Readonly<
  Record<string, AgentAuditPolicyOverride>
>;

export interface AgentAuditGroupView {
  readonly id: string;
  readonly title: string;
  readonly total: number;
  readonly evaluated: number;
  readonly checks: readonly AgentAuditCheckView[];
}

export interface AgentAuditScopeView {
  readonly total: number;
  readonly evaluated: number;
  readonly excluded: number;
  readonly blockers: number;
  readonly health: number | null;
  readonly healthDimmed: boolean;
  readonly enginesReady: number;
  readonly inventoryReady: number;
  readonly groups: readonly AgentAuditGroupView[];
}

export interface AgentAuditViewModel {
  readonly agent: AgentKind;
  readonly locale: string;
  readonly context: AgentDiagnosisContext;
  readonly defaults: {
    readonly siteGroupId: string;
    readonly pageGroupId: string;
  };
  readonly scopes: Readonly<Record<AgentAuditScope, AgentAuditScopeView>>;
  readonly headingPreset: (typeof AGENT_AUDIT_HEADING_PRESETS)[string];
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

function localized(value: { readonly en: string; readonly zh: string }, locale: string) {
  return value[locale === "zh" ? "zh" : "en"];
}

function engineState(value: ContractEngineState): AgentAuditEngineState {
  return value.replaceAll("-", "_") as AgentAuditEngineState;
}

function truthState(value: ContractTruthState): AgentAuditTruthState {
  return value.replaceAll("-", "_") as AgentAuditTruthState;
}

function checkView(
  evaluated: AgentAuditEvaluatedCheck,
  locale: string,
  headingPreset: AgentAuditViewModel["headingPreset"],
): AgentAuditCheckView {
  const presetName =
    locale === "zh"
      ? {
          homepage: "首页",
          product: "产品落地页",
          tool: "工具落地页",
          guide: "长篇指南",
        }[headingPreset.pageType]
      : {
          homepage: "Homepage",
          product: "Product landing",
          tool: "Tool landing",
          guide: "Long-form guide",
        }[headingPreset.pageType];
  // These ranges are house working defaults, not documented limits. Say so on
  // the card, so nobody reads a heading count as a published rule.
  const headingThreshold =
    evaluated.check.id === "3.4"
      ? locale === "zh"
        ? `${presetName}内部启发区间：H2 ${headingPreset.h2.min}–${headingPreset.h2.max}；无官方标准，数量本身绝不阻断`
        : `${presetName} internal heuristic range: H2 ${headingPreset.h2.min}–${headingPreset.h2.max}; no documented standard, and count alone never blocks`
      : evaluated.check.id === "3.5"
        ? locale === "zh"
          ? `${presetName}内部启发区间：H3 ${headingPreset.h3.min}–${headingPreset.h3.max}；无官方标准，数量本身绝不阻断`
          : `${presetName} internal heuristic range: H3 ${headingPreset.h3.min}–${headingPreset.h3.max}; no documented standard, and count alone never blocks`
        : evaluated.check.id === "3.6"
          ? locale === "zh"
            ? `${presetName}子章节实质：至少 ${headingPreset.substanceWords} 词；内部启发式，无官方标准`
            : `${presetName} subsection substance: at least ${headingPreset.substanceWords} words; internal heuristic, no documented standard`
          : null;
  return {
    id: evaluated.check.id,
    title: localized(evaluated.check.title, locale),
    result: evaluated.result,
    engine: engineState(evaluated.engine),
    truth: truthState(evaluated.truth),
    measurement: evaluated.measurement
      ? localized(evaluated.measurement, locale)
      : null,
    threshold:
      headingThreshold ?? localized(evaluated.check.threshold, locale),
    thresholdAuthority: evaluated.check.thresholdAuthority,
    scoreWeight: evaluated.check.scoreWeight,
    scored: evaluated.check.scored,
    blocking: evaluated.check.blocking,
    impact: localized(evaluated.check.impact, locale),
    howToFix: localized(evaluated.check.howToFix, locale),
    dataSource: localized(evaluated.check.dataSource, locale),
    scoreContribution: evaluated.scoreContribution,
    boundary: localized(evaluated.check.boundary, locale),
  };
}

function scopeView(
  evaluation: ReturnType<typeof evaluateAgentAuditScope>,
  locale: string,
  headingPreset: AgentAuditViewModel["headingPreset"],
): AgentAuditScopeView {
  return {
    total: evaluation.checks.length,
    evaluated: evaluation.evaluated,
    excluded: evaluation.excluded,
    blockers: evaluation.blockers,
    health: evaluation.health,
    healthDimmed: evaluation.blockers > 0,
    enginesReady: evaluation.enginesReady,
    inventoryReady: evaluation.checks.filter(
      (check) => check.check.inventoryReady,
    ).length,
    groups: evaluation.groups.map((evaluatedGroup) => ({
      id: evaluatedGroup.group.id,
      title: localized(evaluatedGroup.group.title, locale),
      total: evaluatedGroup.checks.length,
      evaluated: evaluatedGroup.checks.filter(
        (check) => check.result !== "excluded",
      ).length,
      checks: evaluatedGroup.checks.map((check) =>
        checkView(check, locale, headingPreset),
      ),
    })),
  };
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
    records: [
      ...data.result.records,
      ...(data.result.searchPerformance?.records ?? []),
    ],
    targetUrl: data.result.targetUrl,
    targetInspected: data.result.targetInspected,
    inspectedTargetUrl: data.result.inspectedTargetUrl,
  } as const;
  const site = evaluateAgentAuditScope("site", evidence);
  const page = evaluateAgentAuditScope("page", evidence);
  const region = data.result.searchPerformance;
  const defaults = AGENT_AUDIT_DEFAULT_GROUPS[agent];
  const headingPreset =
    AGENT_AUDIT_HEADING_PRESETS[context.pageType] ??
    AGENT_AUDIT_HEADING_PRESETS.homepage!;

  return {
    agent,
    locale,
    context,
    defaults: {
      siteGroupId: defaults.site,
      pageGroupId: defaults.page,
    },
    scopes: {
      site: scopeView(site, locale, headingPreset),
      page: scopeView(page, locale, headingPreset),
    },
    headingPreset,
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
