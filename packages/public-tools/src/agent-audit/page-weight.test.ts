// @input  -- the lab half of a PageSpeed response, present, absent and malformed
// @output -- proof 8.5 decides on transferred bytes and refuses without them
// @pos    -- coverage for the check that was marked unmeasurable for wanting a
//            number the product had already paid for and discarded

import { describe, expect, it } from "vitest";

import {
  buildPageWeightRecords,
  PAGE_WEIGHT_BUDGET_BYTES,
  type PageWeightRaw,
} from "../seo-audit/page-performance.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const TARGET = "https://acme.test/page";

function check(weight: PageWeightRaw | null) {
  return evaluateAgentAuditScope("page", {
    availability: "available",
    records: buildPageWeightRecords(weight),
    targetUrl: TARGET,
    targetInspected: true,
    inspectedTargetUrl: TARGET,
  }).checks.find((entry) => entry.check.id === "8.5");
}

const weighing = (bytes: number): PageWeightRaw => ({
  url: TARGET,
  totalTransferBytes: bytes,
});

describe("8.5 — total page weight", () => {
  it("passes a page under the published 2 MB budget", () => {
    expect(check(weighing(900_000))?.result).toBe("pass");
  });

  it("fires on a page over it", () => {
    expect(check(weighing(5_000_000))?.result).toBe("warning");
  });

  it("passes exactly at the budget", () => {
    // The published rule is "below 2MB", and the boundary is where a rule with
    // no aggregate entry would have failed every page including a 40 KB one.
    expect(check(weighing(PAGE_WEIGHT_BUDGET_BYTES))?.result).toBe("pass");
  });

  it("does not judge a run that weighed nothing", () => {
    // Never a zero: a page reported as weighing nothing passes outright, which
    // is "unavailable is not 0" broken in the direction that hides the finding.
    expect(check(null)?.result).toBe("excluded");
  });

  it("names the bytes it judged", () => {
    const record = buildPageWeightRecords(weighing(1_234_567))[0];
    expect(
      record?.observations[0]?.values.find(
        (entry) => entry.label === "total_transfer_bytes",
      )?.value,
    ).toBe(1_234_567);
  });
});
