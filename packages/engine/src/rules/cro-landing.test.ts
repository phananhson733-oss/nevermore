import { describe, expect, it } from "vitest";
import { METRIC_GA4_LANDING, type Ga4LandingProjection } from "@sf/sources";
import { DiagnosticContext, type CoverageInput, type ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { testObservationLineage } from "../test-observation-lineage.ts";
import { croLandingRule } from "./cro-landing.ts";

const CAPTURED_AT = "2026-07-17T00:00:00.000Z";

function landing(sessions: number, keyEvents: number | null): Ga4LandingProjection {
  return {
    sessions,
    engagedSessions: null,
    engagementRate: null,
    keyEvents,
    keyEventUnavailableReason: keyEvents === null ? "unmapped" : null,
  };
}

function ga4Obs(
  subjectUrl: string,
  projection: Ga4LandingProjection,
  sitePageUrl: string | null = subjectUrl,
): ObservationView {
  return {
    ...testObservationLineage(`ga4:${subjectUrl}`, { sitePageUrl }),
    metricKey: METRIC_GA4_LANDING,
    subjectType: "url",
    subjectRef: subjectUrl,
    provider: "ga4",
    availability: "available",
    valueJson: projection,
    observedAt: CAPTURED_AT,
  };
}

function buildCtx(options: {
  readonly observations: readonly ObservationView[];
  readonly coverage?: Partial<CoverageInput>;
}): DiagnosticContext {
  const coverage: CoverageInput = {
    crawl: options.coverage?.crawl ?? "unavailable",
    gsc: options.coverage?.gsc ?? "unavailable",
    ga4: options.coverage?.ga4 ?? "available",
    csv: options.coverage?.csv ?? "unavailable",
  };
  return DiagnosticContext.build({
    icp: parseIcp({ productName: "Widget", siteLanguageCodes: ["en"] }),
    deliveryLocale: "en",
    observations: options.observations,
    coverage,
    capturedAt: { ga4: CAPTURED_AT },
  });
}

describe("croLandingRule (CRO-LANDING-003)", () => {
  it("emits a candidate for a page far below the aggregate site baseline", () => {
    const ctx = buildCtx({
      observations: [
        ga4Obs("https://x.com/good1", landing(1000, 100)), // rate 0.10
        ga4Obs("https://x.com/good2", landing(1000, 100)), // rate 0.10
        ga4Obs("https://x.com/pricing", landing(1000, 40)), // rate 0.04 — commercial, triggers
        ga4Obs("https://x.com/small", landing(300, 0)), // <500 sessions — never triggers
        ga4Obs("https://x.com/nomap", landing(2000, null)), // unmapped — skipped, excluded from baseline
      ],
    });
    // baseline = (100+100+40+0) / (1000+1000+1000+300) = 240/3300 ≈ 0.0727; threshold ≈ 0.0509.

    const result = croLandingRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    if (!candidate) throw new Error("missing candidate");
    expect(candidate.subjectRefs).toEqual(["https://x.com/pricing"]);
    expect(candidate.severity).toBe("high"); // /pricing is commercial
    expect(candidate.metrics.pageRate).toBe(40 / 1000);
    expect(candidate.metrics.baseline).toBeCloseTo(240 / 3300, 12);
    expect(candidate.metrics.sessions).toBe(1000);
    expect(candidate.metrics.keyEvents).toBe(40);
    expect(candidate.titleArgs).toEqual({
      pageRate: "4.00%",
      baseline: "7.27%",
    });
    const evidence = candidate.evidence[0];
    if (!evidence) throw new Error("missing evidence");
    expect(evidence.sourceProvider).toBe("ga4");
    expect(evidence.grade).toBe("A");
    expect(evidence.origin).toBe("first_party");
    expect(evidence.observedAt).toBe(CAPTURED_AT);
    expect(evidence.limitation.length).toBeGreaterThan(0);
  });

  it("passes when no eligible page falls below 70% of the baseline", () => {
    const ctx = buildCtx({
      observations: [
        ga4Obs("https://x.com/good1", landing(1000, 100)), // 0.10
        ga4Obs("https://x.com/good2", landing(1000, 90)), // 0.09
        ga4Obs("https://x.com/small", landing(300, 0)), // <500 sessions, excluded from triggering
      ],
    });
    // baseline = 190/2300 ≈ 0.0826; threshold ≈ 0.0578. All eligible pages are above it.

    const result = croLandingRule.evaluate(ctx);
    expect(result.status).toBe("pass");
    if (result.status !== "pass") throw new Error("expected pass");
    expect(result.metrics.baseline).toBeCloseTo(190 / 2300, 12);
  });

  it("emits explicit unresolved membership when the triggering GA4 observation has no SitePage", () => {
    const pricing = "https://x.com/pricing";
    const result = croLandingRule.evaluate(
      buildCtx({
        observations: [
          ga4Obs("https://x.com/good", landing(1_000, 100)),
          ga4Obs(pricing, landing(1_000, 20), null),
        ],
      }),
    );

    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.target).toMatchObject({
      relation: "direct_url",
      targetKind: "url",
      targetRef: pricing,
      members: [
        {
          resolutionState: "unresolved",
          basisKind: "unresolved_observation",
          memberRef: pricing,
        },
      ],
    });
  });

  it("retains duplicate GA4 rows but makes mixed healthy/triggering lineage inconclusive", () => {
    const duplicateUrl = "https://x.com/pricing";
    const healthyBase = ga4Obs(duplicateUrl, landing(1_000, 100));
    const triggeringBase = ga4Obs(duplicateUrl, landing(1_000, 10));
    const ctx = buildCtx({
      observations: [
        {
          ...healthyBase,
          observationId: "00000000-0000-4000-8000-000000000001",
        },
        {
          ...triggeringBase,
          observationId: "00000000-0000-4000-8000-000000000099",
        },
      ],
    });

    expect(ctx.ga4ObservationGroups.get(duplicateUrl)).toHaveLength(2);
    expect(ctx.ga4.has(duplicateUrl)).toBe(false);
    expect(croLandingRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "missing_observation_lineage",
    });
  });

  it("does not let an unrelated ambiguous unmapped subject suppress a unique trigger", () => {
    const duplicateUrl = "https://x.com/unmapped-duplicate";
    const firstDuplicate = ga4Obs(duplicateUrl, landing(1_000, null));
    const secondDuplicate = ga4Obs(duplicateUrl, landing(1_000, null));
    const ctx = buildCtx({
      observations: [
        {
          ...firstDuplicate,
          observationId: "00000000-0000-4000-8000-000000000001",
        },
        {
          ...secondDuplicate,
          observationId: "00000000-0000-4000-8000-000000000002",
        },
        ga4Obs("https://x.com/good", landing(1_000, 100)),
        ga4Obs("https://x.com/pricing", landing(1_000, 20)),
      ],
    });

    const result = croLandingRule.evaluate(ctx);
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.subjectRefs).toEqual([
      "https://x.com/pricing",
    ]);
  });

  it("fails closed when an ambiguous subject has usable baseline metrics", () => {
    const duplicateUrl = "https://x.com/healthy-duplicate";
    const firstDuplicate = ga4Obs(duplicateUrl, landing(1_000, 100));
    const secondDuplicate = ga4Obs(duplicateUrl, landing(1_000, 100));
    const ctx = buildCtx({
      observations: [
        {
          ...firstDuplicate,
          observationId: "00000000-0000-4000-8000-000000000001",
        },
        {
          ...secondDuplicate,
          observationId: "00000000-0000-4000-8000-000000000002",
        },
        ga4Obs("https://x.com/good", landing(1_000, 100)),
        ga4Obs("https://x.com/pricing", landing(1_000, 20)),
      ],
    });

    expect(croLandingRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "missing_observation_lineage",
    });
  });

  it("is inconclusive when every page has an unmapped key-event count", () => {
    const ctx = buildCtx({
      observations: [
        ga4Obs("https://x.com/a", landing(1000, null)),
        ga4Obs("https://x.com/b", landing(2000, null)),
      ],
    });

    const result = croLandingRule.evaluate(ctx);
    expect(result.status).toBe("inconclusive");
    if (result.status !== "inconclusive") throw new Error("expected inconclusive");
    expect(result.reason).toBe("ga4_baseline_unavailable");
  });

  it("is inconclusive (not 'low conversion') when the baseline is zero", () => {
    const ctx = buildCtx({
      observations: [
        ga4Obs("https://x.com/a", landing(1000, 0)),
        ga4Obs("https://x.com/b", landing(2000, 0)),
      ],
    });

    const result = croLandingRule.evaluate(ctx);
    expect(result.status).toBe("inconclusive");
    if (result.status !== "inconclusive") throw new Error("expected inconclusive");
    expect(result.reason).toBe("ga4_baseline_unavailable");
  });

  it("skips missing_dataset when ga4 is unavailable", () => {
    const ctx = buildCtx({
      observations: [],
      coverage: { ga4: "unavailable" },
    });

    const result = croLandingRule.evaluate(ctx);
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toBe("missing_dataset");
  });

  it("does not emit available evidence from a partial GA4 snapshot", () => {
    const ctx = buildCtx({
      observations: [
        ga4Obs("https://x.com/good", landing(1000, 100)),
        ga4Obs("https://x.com/pricing", landing(1000, 20)),
      ],
      coverage: { ga4: "partial" },
    });

    expect(croLandingRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });
});
