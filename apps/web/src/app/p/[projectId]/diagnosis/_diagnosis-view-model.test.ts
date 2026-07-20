import { describe, expect, it } from "vitest";
import type {
  DiagnosticDomain,
  Finding,
  Severity,
} from "@/lib/api/hooks-diagnosis";
import {
  filterCanonicalFindings,
  resolveCoveragePresentationState,
  type FindingFilters,
} from "./_diagnosis-view-model.ts";

function finding(
  id: string,
  domain: DiagnosticDomain,
  severity: Severity,
): Finding {
  return {
    id,
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
    domain,
    titleKey: "finding.tech.http_status",
    titleArgs: {},
    summary: `Finding ${id}`,
    summaryLocale: "en",
    severity,
    confidence: "high",
    reviewState: "unreviewed",
    reviewRevision: 1,
    active: true,
    regressed: false,
    subjectRefs: [],
    evidence: [],
    firstSeenAt: "2026-07-18T12:00:00.000Z",
    lastSeenAt: "2026-07-18T12:00:00.000Z",
    resolvedAt: null,
  };
}

const FINDINGS: readonly Finding[] = [
  finding("technical-high", "technical_seo", "high"),
  finding("content-low", "content_intent", "low"),
  finding("technical-low", "technical_seo", "low"),
];

function filters(
  domain: FindingFilters["domain"] = "all",
  severity: FindingFilters["severity"] = "all",
): FindingFilters {
  return { domain, severity };
}

describe("filterCanonicalFindings", () => {
  it("returns every already-loaded canonical finding when both filters are all", () => {
    expect(filterCanonicalFindings(FINDINGS, filters())).toEqual(FINDINGS);
  });

  it("filters by domain without issuing or inventing another result set", () => {
    expect(
      filterCanonicalFindings(FINDINGS, filters("technical_seo")),
    ).toEqual([FINDINGS[0], FINDINGS[2]]);
  });

  it("filters by persisted severity", () => {
    expect(filterCanonicalFindings(FINDINGS, filters("all", "low"))).toEqual([
      FINDINGS[1],
      FINDINGS[2],
    ]);
  });

  it("combines domain and severity filters with AND semantics", () => {
    expect(
      filterCanonicalFindings(
        FINDINGS,
        filters("technical_seo", "low"),
      ),
    ).toEqual([FINDINGS[2]]);
    expect(
      filterCanonicalFindings(
        FINDINGS,
        filters("geo_ai", "critical"),
      ),
    ).toEqual([]);
  });

  it("does not mutate the TanStack-owned findings array", () => {
    const before = [...FINDINGS];
    filterCanonicalFindings(FINDINGS, filters("content_intent", "low"));
    expect(FINDINGS).toEqual(before);
  });
});

describe("resolveCoveragePresentationState", () => {
  const evaluatedCoverage = {
    overall: "partial" as const,
    domains: { technical_seo: "missing" as const },
    limitations: [],
  };

  it("does not collapse an absent first-run assessment into evaluated missing coverage", () => {
    expect(resolveCoveragePresentationState(null, false)).toBe("not-run");
  });

  it("reports absent coverage from an existing run as unavailable", () => {
    expect(resolveCoveragePresentationState(null, true)).toBe("unavailable");
  });

  it("keeps an evaluated assessment available even when a domain is explicitly missing", () => {
    expect(resolveCoveragePresentationState(evaluatedCoverage, true)).toBe(
      "available",
    );
  });
});
