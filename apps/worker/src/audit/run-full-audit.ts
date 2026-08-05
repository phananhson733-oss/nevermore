import {
  AuditRunsRepository,
  type AuditModuleResultInsert,
  type AuditRunRow,
  type Executor,
  type ProjectScope,
} from "@sf/db";
import {
  AuditModuleId,
  type AuditModuleId as AuditModuleIdType,
} from "@sf/contracts";
import type { DatasetAvailability, DiagnosticDomain, RuleId } from "@sf/engine";

/**
 * Growth Audit module materialization (Slice 1). A Growth Audit reuses the exact
 * diagnostic pipeline; this module projects that single run's coverage and
 * evidence-bearing findings into the eight customer-facing audit modules.
 *
 * Empty modules are never scored zero: their honest state is `no_data` with a
 * limitation that explains why coverage is unavailable (spec §1.3, audit
 * contract `AuditModuleSummary`). A module only reports observed coverage when it
 * has evidence to show, so every `available`/`partial` summary satisfies the
 * contract's "observed coverage must reference Evidence" invariant.
 */

export type AuditCoverageState = AuditModuleResultInsert["coverageState"];

/** Canonical rule → audit module map (implementation plan §"Rule/module table"). */
const RULE_MODULE: Readonly<Record<RuleId, AuditModuleIdType>> = {
  "TECH-HTTP-001": "technical_search",
  "TECH-CANONICAL-002": "technical_search",
  "TECH-INDEXABILITY-006": "technical_search",
  "SEARCH-CTR-004": "technical_search",
  "SEARCH-DECAY-002": "content_intent",
  "CONTENT-COVERAGE-001": "content_intent",
  "CONTENT-GAP-011": "content_intent",
  "CRO-LANDING-003": "content_intent",
  "TECH-LINKGRAPH-005": "links_architecture",
  "CRO-PATH-001": "links_architecture",
  "GEO-ENTITY-001": "ai_geo",
  "GEO-CRAWLER-002": "ai_geo",
};

/**
 * The diagnostic domains that feed each audit module. Modules with no domain
 * never receive diagnostic coverage in Slice 1 and therefore stay `no_data`.
 */
const MODULE_DOMAINS: Readonly<
  Record<AuditModuleIdType, readonly DiagnosticDomain[]>
> = {
  performance: [],
  accessibility: [],
  best_practices_security: [],
  technical_search: ["technical_seo", "search_performance"],
  content_intent: [
    "search_performance",
    "content_intent",
    "conversion_journey",
  ],
  ai_geo: ["geo_ai"],
  links_architecture: ["technical_seo", "conversion_journey"],
  compliance_measurement: [],
};

const EMPTY_MODULE_LIMITATION =
  "This module is outside the current growth audit's data scope.";
const NO_FINDINGS_LIMITATION =
  "No audit signals were observed for this module in this run.";
const PARTIAL_COVERAGE_LIMITATION =
  "Some datasets for this module were unavailable; coverage is partial.";

/** Minimal projection of the diagnostic pipeline this materializer reads. */
export interface AuditModuleProjectionInput {
  readonly findings: readonly {
    readonly ruleId: RuleId;
    readonly evidence: readonly {
      readonly sourceProvider: string;
      readonly observedAt: string;
    }[];
  }[];
  readonly coverage: {
    readonly domains: Readonly<Record<DiagnosticDomain, DatasetAvailability>>;
  };
}

interface ModuleAccumulator {
  evidenceCount: number;
  findingCount: number;
  readonly sourceProviders: Set<string>;
  latestObservedAtMs: number | null;
  latestObservedAt: string | null;
}

function emptyAccumulator(): ModuleAccumulator {
  return {
    evidenceCount: 0,
    findingCount: 0,
    sourceProviders: new Set<string>(),
    latestObservedAtMs: null,
    latestObservedAt: null,
  };
}

function accumulateFinding(
  accumulator: ModuleAccumulator,
  finding: AuditModuleProjectionInput["findings"][number],
): void {
  accumulator.findingCount += 1;
  for (const evidence of finding.evidence) {
    accumulator.evidenceCount += 1;
    accumulator.sourceProviders.add(evidence.sourceProvider);
    const observedMs = Date.parse(evidence.observedAt);
    if (
      Number.isFinite(observedMs) &&
      (accumulator.latestObservedAtMs === null ||
        observedMs > accumulator.latestObservedAtMs)
    ) {
      accumulator.latestObservedAtMs = observedMs;
      accumulator.latestObservedAt = new Date(observedMs).toISOString();
    }
  }
}

function observedCoverageState(
  moduleId: AuditModuleIdType,
  domains: Readonly<Record<DiagnosticDomain, DatasetAvailability>>,
): "available" | "partial" {
  const contributing = MODULE_DOMAINS[moduleId];
  const allAvailable = contributing.every(
    (domain) => domains[domain] === "available",
  );
  return allAvailable ? "available" : "partial";
}

function moduleSummary(
  moduleId: AuditModuleIdType,
  accumulator: ModuleAccumulator,
  domains: Readonly<Record<DiagnosticDomain, DatasetAvailability>>,
): AuditModuleResultInsert {
  const hasEvidence =
    accumulator.evidenceCount > 0 && accumulator.latestObservedAt !== null;
  if (!hasEvidence) {
    const limitation =
      MODULE_DOMAINS[moduleId].length === 0
        ? EMPTY_MODULE_LIMITATION
        : NO_FINDINGS_LIMITATION;
    return {
      moduleId,
      coverageState: "no_data",
      summary: {
        moduleId,
        coverageState: "no_data",
        evidenceCount: 0,
        findingCount: 0,
        sourceProviders: [],
        latestObservedAt: null,
        limitations: [limitation],
      },
    };
  }
  const coverageState = observedCoverageState(moduleId, domains);
  const limitations =
    coverageState === "partial" ? [PARTIAL_COVERAGE_LIMITATION] : [];
  return {
    moduleId,
    coverageState,
    summary: {
      moduleId,
      coverageState,
      evidenceCount: accumulator.evidenceCount,
      findingCount: accumulator.findingCount,
      sourceProviders: [...accumulator.sourceProviders].sort(),
      latestObservedAt: accumulator.latestObservedAt,
      limitations,
    },
  };
}

/**
 * Project one diagnostic run into the eight audit module summaries. Always
 * returns every module in the canonical taxonomy order; empty modules are
 * `no_data`, never a zero score.
 */
export function projectAuditModuleResults(
  input: AuditModuleProjectionInput,
): readonly AuditModuleResultInsert[] {
  const byModule = new Map<AuditModuleIdType, ModuleAccumulator>();
  for (const moduleId of AuditModuleId.options) {
    byModule.set(moduleId, emptyAccumulator());
  }
  for (const finding of input.findings) {
    const moduleId = RULE_MODULE[finding.ruleId];
    const accumulator = byModule.get(moduleId);
    if (accumulator) accumulateFinding(accumulator, finding);
  }
  return AuditModuleId.options.map((moduleId) =>
    moduleSummary(moduleId, byModule.get(moduleId)!, input.coverage.domains),
  );
}

/**
 * Worker completion write: materialize the eight audit modules inside the same
 * transaction that terminalizes the diagnostic run. Only invoked when the run
 * carries an `audit_runs` projection; a pure diagnostic run skips this entirely.
 */
export async function materializeAuditModules(
  tx: Executor,
  auditRun: AuditRunRow,
  pipeline: AuditModuleProjectionInput,
  scope: ProjectScope,
): Promise<void> {
  const results = projectAuditModuleResults(pipeline);
  await new AuditRunsRepository(tx).insertModuleResults(
    {
      auditRunId: auditRun.id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    },
    results,
  );
}
