import { createPublicToolResult } from "../contract.ts";
import { buildSeoAuditChecks } from "./checks.ts";
import type {
  SeoAuditCheck,
  SeoAuditModule,
  SeoAuditModuleId,
  SeoAuditPayload,
  SeoAuditProbe,
  SeoAuditReport,
  SeoAuditSeverity,
} from "./types.ts";

const MODULE_IDS: readonly SeoAuditModuleId[] = [
  "crawlability",
  "technical",
  "on_page",
  "content",
  "structured_data",
];

const SEVERITY_ORDER: Record<SeoAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface ScoreSummary {
  readonly score: number | null;
  readonly measuredWeight: number;
  readonly totalWeight: number;
  readonly coveragePercent: number;
}

function calculateScore(checks: readonly SeoAuditCheck[]): ScoreSummary {
  const measured = checks.filter((check) => check.status !== "unverified");
  const possible = measured.reduce((sum, check) => sum + check.weight, 0);
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = measured.reduce((sum, check) => {
    if (check.status === "pass") return sum + check.weight;
    if (check.status === "warning") return sum + check.weight * 0.5;
    return sum;
  }, 0);
  return {
    score: possible === 0 ? null : Math.round((earned / possible) * 100),
    measuredWeight: possible,
    totalWeight,
    coveragePercent:
      totalWeight === 0 ? 0 : Math.round((possible / totalWeight) * 100),
  };
}

function buildModule(
  id: SeoAuditModuleId,
  checks: readonly SeoAuditCheck[],
): SeoAuditModule {
  const moduleChecks = checks.filter((check) => check.module === id);
  const score = calculateScore(moduleChecks);
  return {
    id,
    ...score,
    measuredChecks: moduleChecks.filter(
      (check) => check.status !== "unverified",
    ).length,
    totalChecks: moduleChecks.length,
    checks: moduleChecks,
  };
}

export function buildSeoAuditReport(probe: SeoAuditProbe): SeoAuditReport {
  const checks = buildSeoAuditChecks(probe);
  const score = calculateScore(checks);
  return {
    targetUrl: probe.requestedUrl,
    finalUrl: probe.page.finalUrl,
    ...score,
    measuredChecks: checks.filter(
      (check) => check.status !== "unverified",
    ).length,
    totalChecks: checks.length,
    modules: MODULE_IDS.map((id) => buildModule(id, checks)),
    priorities: [...checks]
      .filter((check) => check.status === "fail" || check.status === "warning")
      .sort((left, right) => {
        const severity =
          SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
        return severity === 0 ? right.weight - left.weight : severity;
      })
      .slice(0, 5),
  };
}

export function buildSeoAuditPayload(probe: SeoAuditProbe): SeoAuditPayload {
  return createPublicToolResult(
    {
      tool: "seo_audit",
      schemaVersion: "1.0.0",
      scope: "single_raw_page_and_standard_support_files",
      completedAt: probe.scannedAt,
    },
    buildSeoAuditReport(probe),
  );
}
