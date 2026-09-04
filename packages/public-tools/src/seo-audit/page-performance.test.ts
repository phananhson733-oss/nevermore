// @input  -- CrUX p75 values, and the ways there are none
// @output -- proof 8.1-8.4 decide on their published bands and never on a zero
// @pos    -- unit coverage for the region Batch 5 added

import { describe, expect, it } from "vitest";

import { evaluateAgentAuditScope } from "../agent-audit/evaluate.ts";
import {
  buildPagePerformanceRecords,
  buildPageWeightRecords,
  buildImageWeightRecords,
  PAGE_PERFORMANCE_RECORD_IDS,
  type PagePerformanceRaw,
} from "./page-performance.ts";

const URL = "https://acme.test/p";

function raw(overrides: Partial<PagePerformanceRaw> = {}): PagePerformanceRaw {
  return {
    url: URL,
    sourceLevel: "url",
    lcp: 2_000,
    inp: 150,
    cls: 0.05,
    ttfb: 500,
    formFactor: "mobile",
    ...overrides,
  };
}

function decide(input: PagePerformanceRaw | null, id: string) {
  return evaluateAgentAuditScope("page", {
    availability: "available",
    records: buildPagePerformanceRecords(input),
    targetUrl: URL,
    targetInspected: true,
    inspectedTargetUrl: URL,
  }).checks.find((entry) => entry.check.id === id);
}

describe("page performance records", () => {
  it("emits all four whatever CrUX returned", () => {
    const four = PAGE_PERFORMANCE_RECORD_IDS.filter((id) =>
      id.startsWith("core_web_vital_"),
    );
    for (const input of [null, raw(), raw({ lcp: null, inp: null })]) {
      expect(buildPagePerformanceRecords(input).map((r) => r.id)).toEqual(four);
    }
  });

  it("fills the region's exact id list between its three builders", () => {
    // PAGE_PERFORMANCE_RECORD_IDS is the wire guard's exact list, and the
    // region is refused whole when the records do not match it. The field half
    // and the lab half are built separately, so nothing but this asserts that
    // together they still add up — and a region refused at the seam blanks the
    // panel rather than dropping one check.
    for (const input of [null, raw()]) {
      for (const weight of [
        null,
        { url: "https://acme.test/", totalTransferBytes: 1 },
      ]) {
        expect(
          [
            ...buildPagePerformanceRecords(input),
            ...buildPageWeightRecords(weight),
            ...buildImageWeightRecords(null, undefined, true),
          ].map((record) => record.id),
        ).toEqual(PAGE_PERFORMANCE_RECORD_IDS);
      }
    }
  });

  it("reports a withheld metric as unmeasured, never as zero", () => {
    // Zero is the best possible value for every one of these. A metric CrUX
    // did not publish, read as zero, would report the fastest possible page.
    const record = buildPagePerformanceRecords(raw({ lcp: null })).find(
      (entry) => entry.id === "core_web_vital_lcp",
    );

    expect(record?.state).toBe("unverified");
    expect(record?.observations).toEqual([]);
    expect(decide(raw({ lcp: null }), "8.1")?.result).toBe("excluded");
  });

  it("separates no source from no data for this page", () => {
    expect(buildPagePerformanceRecords(null)[0]?.limitation).toBe(
      "no_field_data_source_was_configured_for_this_run",
    );
    expect(
      buildPagePerformanceRecords(raw({ cls: null })).find(
        (entry) => entry.id === "core_web_vital_cls",
      )?.limitation,
    ).toBe("crux_reported_no_field_data_for_this_metric_on_this_url");
  });

  it("says when the numbers are the whole origin's rather than this page's", () => {
    const record = buildPagePerformanceRecords(
      raw({ sourceLevel: "origin" }),
    )[0];

    // A fast page can inherit a slow site here, so the level is published
    // rather than folded into a single reading.
    expect(record?.limitation).toBe(
      "crux_had_no_url_level_data_so_these_are_the_whole_origin_p75_values",
    );
    expect(
      record?.observations[0]?.values.find(
        (entry) => entry.label === "crux_source_level",
      )?.value,
    ).toBe("origin");
  });

  describe("the published bands, at their boundaries", () => {
    it.each([
      ["8.1", "lcp", 2_500, "pass"],
      ["8.1", "lcp", 2_501, "tip"],
      ["8.1", "lcp", 4_001, "warning"],
      ["8.2", "inp", 200, "pass"],
      ["8.2", "inp", 201, "tip"],
      ["8.2", "inp", 501, "warning"],
      ["8.3", "cls", 0.1, "pass"],
      ["8.3", "cls", 0.11, "tip"],
      ["8.3", "cls", 0.26, "warning"],
      ["8.4", "ttfb", 800, "pass"],
      ["8.4", "ttfb", 801, "tip"],
      ["8.4", "ttfb", 1_801, "warning"],
    ])("%s at %s=%s is %s", (id, metric, value, expected) => {
      expect(decide(raw({ [metric as "lcp"]: value }), id)?.result).toBe(
        expected,
      );
    });
  });

  it("shows a CLS score at a precision that does not move it to the boundary", () => {
    // One decimal renders 0.05 as "0.1", which is the pass boundary itself: a
    // page comfortably inside the good band would display as sitting exactly
    // on the line it must not cross.
    const measurement = decide(raw({ cls: 0.05 }), "8.3")?.measurement;

    expect(measurement?.en).toContain("0.05");
    expect(measurement?.en).not.toContain("0.1 ");
  });

  it("shows a millisecond metric in milliseconds", () => {
    expect(decide(raw({ lcp: 2_000 }), "8.1")?.measurement?.en).toContain(
      "2000 ms",
    );
  });
});

describe("a page whose images are all within budget", () => {
  /**
   * The wire guard refuses a record that says `observed` with nothing affected,
   * because that shape has meant "we found something" everywhere else. This
   * branch — every declared image weighed, none over budget — produced exactly
   * that, so a site with tidy images had its whole audit response rejected and
   * the reader was told the response could not be safely displayed.
   *
   * It is the clean-site branch again: every fixture here had something over
   * budget, or something unweighed, so nothing ever exercised the pass.
   */
  const images = [
    { url: "https://acme.test/a.png", transferredBytes: 1_000, complete: true },
    { url: "https://acme.test/b.png", transferredBytes: 2_000, complete: true },
  ];

  it("reports a measured pass, not an observation of nothing", () => {
    const [record] = buildImageWeightRecords(images, undefined, true);

    expect(record?.state).toBe("not_observed");
    expect(record?.affected).toBe(0);
    expect(record?.observations).toEqual([]);
    // Still a real measurement: every image was weighed.
    expect(record?.tested).toBe(2);
    expect(record?.targetTested).toBe(true);
  });

  it("satisfies the invariant the wire guard enforces", () => {
    for (const record of buildImageWeightRecords(images, undefined, true)) {
      expect(record.affected).toBe(record.observations.length);
      expect(record.affected).toBeLessThanOrEqual(record.tested);
      expect(record.state === "observed" ? record.affected > 0 : record.affected === 0).toBe(true);
    }
  });
});
