// @input  -- records built from measurements that did not finish
// @output -- proof an unfinished measurement never renders as a clean pass
// @pos    -- the cross-check for the defect class a pre-merge review found in
//            three separate detectors at once (A1, 5.2, 9.3)

import { describe, expect, it } from "vitest";
import { buildIndexCoverageRecords } from "../seo-audit/index-coverage.ts";
import { buildImageWeightRecords } from "../seo-audit/page-performance.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const T = "https://acme.test/p";
const site = (records: readonly unknown[], id: string) =>
  evaluateAgentAuditScope("site", {
    availability: "available",
    records: records as never,
  }).checks.find((e) => e.check.id === id);
const page = (records: readonly unknown[], id: string) =>
  evaluateAgentAuditScope("page", {
    availability: "available",
    records: records as never,
    targetUrl: T,
    targetInspected: true,
    inspectedTargetUrl: T,
  }).checks.find((e) => e.check.id === id);

describe("partial measurements never render as a pass", () => {
  it("A1: one answered URL out of five hundred is not 100% coverage", () => {
    // The producer refuses the whole census when anything went unanswered, so
    // this asserts the seam below it: a single PASS row cannot reach A1.
    expect(
      site(buildIndexCoverageRecords(null, "provider_unavailable"), "A1")
        ?.result,
    ).toBe("excluded");
  });

  it("5.2: a truncated image sample with nothing over budget is not a pass", () => {
    const small = [
      { url: `${T}/a.webp`, transferredBytes: 10, complete: true },
    ];
    expect(
      page(buildImageWeightRecords(small, undefined, false), "5.2")?.result,
    ).toBe("excluded");
    // Same sample, complete: now it may pass.
    expect(
      page(buildImageWeightRecords(small, undefined, true), "5.2")?.result,
    ).toBe("pass");
  });

  it("5.2: a truncated sample that already found an oversized image still fails", () => {
    // A positive finding is decisive from a subset.
    const withHeavy = [
      { url: `${T}/a.webp`, transferredBytes: 10, complete: true },
      { url: `${T}/b.png`, transferredBytes: 900_000, complete: true },
    ];
    expect(
      page(buildImageWeightRecords(withHeavy, undefined, false), "5.2")?.result,
    ).toBe("tip");
  });
});
