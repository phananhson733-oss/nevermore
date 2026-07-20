import { describe, expect, it } from "vitest";
import { METRIC_GSC_PAGE } from "@sf/sources";
import type { GscPageProjection } from "@sf/sources";
import { DiagnosticContext } from "../context.ts";
import type { CoverageInput, ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { searchDecayRule } from "./search-decay.ts";

const OBSERVED_AT = "2026-07-18T00:00:00Z";
const PAGE_URL = "https://x.com/p";

function gscPage(currentClicks: number, previousClicks: number): GscPageProjection {
  return {
    current28d: { clicks: currentClicks, impressions: 5000, position: 4 },
    previous28d: { clicks: previousClicks, impressions: 5000, position: 4 },
    topQueries: [],
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

describe("searchDecayRule (SEARCH-DECAY-002)", () => {
  it("flags a decaying priority page as high", () => {
    // previous 200 -> current 100 = -0.5 (>= 20% drop), previous >= 100.
    const ctx = buildCtx({
      observations: [observation(PAGE_URL, gscPage(100, 200))],
      priorityUrls: [PAGE_URL],
    });

    const result = searchDecayRule.evaluate(ctx);

    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!;
    expect(candidate.severity).toBe("high");
    expect(candidate.subjectRefs).toEqual([PAGE_URL]);
    expect(candidate.metrics).toEqual({
      currentClicks: 100,
      previousClicks: 200,
      delta: -0.5,
    });

    const evidence = candidate.evidence[0]!;
    expect(evidence.sourceProvider).toBe("gsc");
    expect(evidence.grade).toBe("A");
    expect(evidence.method).toBe("observed");
    expect(evidence.support).toBe("supports");
    expect(evidence.observedAt).toBe(OBSERVED_AT);
    expect(evidence.subjectRefs).toEqual([PAGE_URL]);
    expect(evidence.claim).toContain("from 200");
    expect(evidence.claim).toContain("to 100");
  });

  it("marks a non-priority decaying page medium", () => {
    const ctx = buildCtx({
      observations: [observation(PAGE_URL, gscPage(100, 200))],
    });

    const result = searchDecayRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]!.severity).toBe("medium");
  });

  it("passes when the drop is small or the prior base is too thin", () => {
    const shallow = gscPage(190, 200); // delta -0.05, above threshold
    const thinBase = gscPage(0, 50); // previous < 100 clicks, excluded
    const growth = gscPage(300, 200); // positive delta

    const ctx = buildCtx({
      observations: [
        observation("https://x.com/shallow", shallow),
        observation("https://x.com/thin", thinBase),
        observation("https://x.com/growth", growth),
      ],
    });

    const result = searchDecayRule.evaluate(ctx);
    expect(result.status).toBe("pass");
    if (result.status !== "pass") throw new Error("expected pass");
    expect(result.metrics).toEqual({ pagesEvaluated: 3, triggered: 0 });
  });

  it("is skipped when the GSC dataset is unavailable", () => {
    const ctx = buildCtx({
      observations: [observation(PAGE_URL, gscPage(100, 200))],
      gscAvailability: "unavailable",
    });

    const result = searchDecayRule.evaluate(ctx);
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toBe("missing_dataset");
  });

  it("does not emit available evidence from a partial GSC snapshot", () => {
    const ctx = buildCtx({
      observations: [observation(PAGE_URL, gscPage(100, 200))],
      gscAvailability: "partial",
    });

    expect(searchDecayRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });
});
