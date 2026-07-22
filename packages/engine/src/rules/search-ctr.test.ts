import { describe, expect, it } from "vitest";
import { METRIC_GSC_PAGE } from "@sf/sources";
import type { GscPageProjection, GscTopQuery } from "@sf/sources";
import { DiagnosticContext } from "../context.ts";
import type { CoverageInput, ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { runPipeline } from "../pipeline.ts";
import { testObservationLineage } from "../test-observation-lineage.ts";
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

function observation(
  subjectRef: string,
  valueJson: GscPageProjection,
  sitePageUrl: string | null = subjectRef,
): ObservationView {
  return {
    ...testObservationLineage(`gsc:${subjectRef}`, { sitePageUrl }),
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

  it("uses the exact slash SitePage URL as targetRef while retaining the canonical observation memberRef", () => {
    const exactSitePageUrl = `${PAGE_URL}/`;
    const page = gscPage({ clicks: 20, impressions: 2000, position: 3 });
    const result = searchCtrRule.evaluate(
      buildCtx({
        observations: [observation(PAGE_URL, page, exactSitePageUrl)],
      }),
    );

    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.target).toMatchObject({
      relation: "direct_url",
      targetKind: "url",
      targetRef: exactSitePageUrl,
      members: [
        {
          resolutionState: "resolved",
          basisKind: "observation_site_page",
          observationId: expect.any(String),
          snapshotId: expect.any(String),
          sitePageId: expect.any(String),
          sitePageUrl: exactSitePageUrl,
          pageSnapshotId: null,
          memberRef: PAGE_URL,
        },
      ],
    });
  });

  it("keeps a persisted null SitePage lineage as an explicit unresolved direct member", () => {
    const page = gscPage({ clicks: 20, impressions: 2000, position: 3 });
    const result = searchCtrRule.evaluate(
      buildCtx({ observations: [observation(PAGE_URL, page, null)] }),
    );

    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.target).toEqual({
      version: 1,
      relation: "direct_url",
      targetKind: "url",
      targetRef: PAGE_URL,
      members: [
        {
          resolutionState: "unresolved",
          basisKind: "unresolved_observation",
          observationId: expect.any(String),
          snapshotId: expect.any(String),
          memberRef: PAGE_URL,
          limitation: expect.stringContaining("no unambiguous persisted SitePage"),
        },
      ],
    });
  });

  it("fails closed for a half-populated analytics SitePage lineage", () => {
    const page = gscPage({ clicks: 20, impressions: 2000, position: 3 });
    const observationWithCorruptLineage = observation(PAGE_URL, page);

    expect(
      searchCtrRule.evaluate(
        buildCtx({
          observations: [
            { ...observationWithCorruptLineage, sitePageId: null },
          ],
        }),
      ),
    ).toEqual({
      status: "inconclusive",
      reason: "missing_observation_lineage",
    });
  });

  it("retains duplicate analytics rows for audit but refuses ambiguous rule membership", () => {
    const healthy = gscPage({ clicks: 400, impressions: 2000, position: 3 });
    const triggering = gscPage({ clicks: 20, impressions: 2000, position: 3 });
    const firstBase = observation(PAGE_URL, healthy);
    const first = {
      ...firstBase,
      observationId: "00000000-0000-4000-8000-000000000001",
    };
    const secondBase = observation(PAGE_URL, triggering);
    const second = {
      ...secondBase,
      observationId: "00000000-0000-4000-8000-000000000099",
    };
    const ctx = buildCtx({ observations: [first, second] });

    expect(ctx.gscObservationGroups.get(PAGE_URL)).toHaveLength(2);
    expect(ctx.gsc.has(PAGE_URL)).toBe(false);
    expect(ctx.gscObservationForSubject(PAGE_URL)).toBeNull();
    expect(searchCtrRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "missing_observation_lineage",
    });
  });

  it("emits a unique page-local candidate when an unrelated ambiguous subject is healthy", () => {
    const ambiguousUrl = "https://x.com/healthy-duplicate";
    const healthy = gscPage({ clicks: 400, impressions: 2000, position: 3 });
    const uniqueTrigger = gscPage({ clicks: 20, impressions: 2000, position: 3 });
    const firstAmbiguous = observation(ambiguousUrl, healthy);
    const secondAmbiguous = observation(ambiguousUrl, healthy);
    const ctx = buildCtx({
      observations: [
        {
          ...firstAmbiguous,
          observationId: "00000000-0000-4000-8000-000000000001",
        },
        {
          ...secondAmbiguous,
          observationId: "00000000-0000-4000-8000-000000000002",
        },
        observation(PAGE_URL, uniqueTrigger),
      ],
    });

    const result = searchCtrRule.evaluate(ctx);
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.subjectRefs).toEqual([PAGE_URL]);
  });

  it("fails closed for an ambiguous trigger even when another trigger has unique lineage", () => {
    const ambiguousUrl = "https://x.com/ambiguous-trigger";
    const triggering = gscPage({ clicks: 20, impressions: 2000, position: 3 });
    const firstAmbiguous = observation(ambiguousUrl, triggering);
    const secondAmbiguous = observation(ambiguousUrl, triggering);
    const ctx = buildCtx({
      observations: [
        {
          ...firstAmbiguous,
          observationId: "00000000-0000-4000-8000-000000000001",
        },
        {
          ...secondAmbiguous,
          observationId: "00000000-0000-4000-8000-000000000002",
        },
        observation(PAGE_URL, triggering),
      ],
    });

    expect(searchCtrRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "missing_observation_lineage",
    });
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

  it("marks partial GSC evidence partial and derives medium confidence", async () => {
    const page = gscPage({ clicks: 20, impressions: 2000, position: 3 });
    const ctx = buildCtx({
      observations: [observation(PAGE_URL, page)],
      gscAvailability: "partial",
      priorityUrls: [PAGE_URL],
    });

    const result = searchCtrRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.evidence[0]).toMatchObject({
      availability: "partial",
    });
    expect(result.candidates[0]?.evidence[0]?.limitation).toContain(
      "snapshot is partial",
    );

    const pipeline = await runPipeline({
      projectId: "00000000-0000-4000-8000-000000000001",
      ctx,
      rules: [searchCtrRule],
      deliveryLocale: "en",
    });
    expect(pipeline.findings[0]?.confidence).toBe("medium");
  });

  it("does not report a clean pass from a partial GSC snapshot", () => {
    const page = gscPage({ clicks: 400, impressions: 2000, position: 3 });
    const ctx = buildCtx({
      observations: [observation(PAGE_URL, page)],
      gscAvailability: "partial",
    });

    expect(searchCtrRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "partial_gsc_snapshot",
    });
  });
});
