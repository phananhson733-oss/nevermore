import { describe, expect, it } from "vitest";
import { METRIC_GSC_PAGE } from "@sf/sources";
import type { GscPageProjection, GscTopQuery } from "@sf/sources";
import { DiagnosticContext } from "../context.ts";
import type { CoverageInput, ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { searchCtrRule } from "./search-ctr.ts";

const OBSERVED_AT = "2026-07-18T00:00:00Z";
const PAGE_URL = "https://x.com/p";

function gscPage(
  current: { clicks: number; impressions: number; position: number | null },
  topQueries: readonly GscTopQuery[] = [],
): GscPageProjection {
  return {
    current28d: current,
    previous28d: { clicks: 0, impressions: 0, position: null },
    topQueries,
  };
}

function observation(subjectRef: string, valueJson: GscPageProjection): ObservationView {
  return {
    metricKey: METRIC_GSC_PAGE,
    subjectType: "url",
    subjectRef,
    provider: "gsc",
    availability: "available",
    valueJson,
    observedAt: OBSERVED_AT,
  };
}

function buildCtx(opts: {
  readonly observations: readonly ObservationView[];
  readonly gscAvailability?: CoverageInput["gsc"];
  readonly priorityUrls?: readonly string[];
}): DiagnosticContext {
  return DiagnosticContext.build({
    icp: parseIcp({
      productName: "Acme",
      siteLanguageCodes: ["en"],
      priorityUrls: opts.priorityUrls ?? [],
    }),
    deliveryLocale: "en",
    observations: opts.observations,
    coverage: {
      crawl: "unavailable",
      gsc: opts.gscAvailability ?? "available",
      ga4: "unavailable",
      csv: "unavailable",
    },
    capturedAt: { gsc: OBSERVED_AT },
  });
}

describe("searchCtrRule (SEARCH-CTR-004)", () => {
  it("flags an under-performing page and marks a priority URL high", () => {
    // position 3 -> benchmark 0.10, threshold 0.05; ctr = 20/2000 = 0.01 < 0.05.
    const page = gscPage({ clicks: 20, impressions: 2000, position: 3 }, [
      { query: "b", clicks: 5, impressions: 400, position: 3 },
      { query: "a", clicks: 10, impressions: 900, position: 2 },
      { query: "c", clicks: 2, impressions: 120, position: 6 },
    ]);
    const ctx = buildCtx({
      observations: [observation(PAGE_URL, page)],
      priorityUrls: [PAGE_URL],
    });

    const result = searchCtrRule.evaluate(ctx);

    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!;
    expect(candidate.severity).toBe("high");
    expect(candidate.subjectRefs).toEqual([PAGE_URL]);
    expect(candidate.metrics).toEqual({
      ctr: 0.01,
      position: 3,
      impressions: 2000,
      clicks: 20,
      benchmark: 0.1,
    });

    const evidence = candidate.evidence[0]!;
    expect(evidence.sourceProvider).toBe("gsc");
    expect(evidence.origin).toBe("first_party");
    expect(evidence.method).toBe("observed");
    expect(evidence.grade).toBe("A");
    expect(evidence.support).toBe("supports");
    expect(evidence.observedAt).toBe(OBSERVED_AT);
    expect(evidence.subjectRefs).toEqual([PAGE_URL]);
    // Top queries by impressions, highest first (a=900, b=400, c=120).
    expect(evidence.claim).toContain("a (900 impr), b (400 impr), c (120 impr)");
    expect(evidence.claim).toContain("benchmark 10.00%");
  });

  it("marks a non-priority, non-commercial page medium", () => {
    const page = gscPage({ clicks: 20, impressions: 2000, position: 3 });
    const ctx = buildCtx({ observations: [observation(PAGE_URL, page)] });

    const result = searchCtrRule.evaluate(ctx);

    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]!.severity).toBe("medium");
  });

  it("passes when CTR is healthy or impressions/position are out of scope", () => {
    const healthy = gscPage({ clicks: 400, impressions: 2000, position: 3 }); // ctr 0.20 >= 0.05
    const lowImpressions = gscPage({ clicks: 1, impressions: 500, position: 3 }); // < 1000 impressions
    const deepPosition = gscPage({ clicks: 0, impressions: 3000, position: 15 }); // position > 10
    const noImpressions = gscPage({ clicks: 0, impressions: 0, position: null });

    const ctx = buildCtx({
      observations: [
        observation("https://x.com/healthy", healthy),
        observation("https://x.com/low", lowImpressions),
        observation("https://x.com/deep", deepPosition),
        observation("https://x.com/empty", noImpressions),
      ],
    });

    const result = searchCtrRule.evaluate(ctx);
    expect(result.status).toBe("pass");
    if (result.status !== "pass") throw new Error("expected pass");
    expect(result.metrics).toEqual({ pagesEvaluated: 4, triggered: 0 });
  });

  it("is skipped when the GSC dataset is unavailable", () => {
    const page = gscPage({ clicks: 20, impressions: 2000, position: 3 });
    const ctx = buildCtx({
      observations: [observation(PAGE_URL, page)],
      gscAvailability: "unavailable",
    });

    const result = searchCtrRule.evaluate(ctx);
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toBe("missing_dataset");
  });
});
