// @input  -- per-image transferred byte counts, complete and cut short
// @output -- proof 5.2 decides on real bytes and never on a lab guess
// @pos    -- coverage for the check that could not be answered by Lighthouse

import { describe, expect, it } from "vitest";

import {
  buildImageWeightRecords,
  IMAGE_TRANSFER_BUDGET_BYTES,
  type ImageWeightRaw,
} from "../seo-audit/page-performance.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const TARGET = "https://acme.test/page";

function check(images: readonly ImageWeightRaw[] | null) {
  return evaluateAgentAuditScope("page", {
    availability: "available",
    records: buildImageWeightRecords(images),
    targetUrl: TARGET,
    targetInspected: true,
    inspectedTargetUrl: TARGET,
  }).checks.find((entry) => entry.check.id === "5.2");
}

const image = (
  name: string,
  bytes: number,
  complete = true,
): ImageWeightRaw => ({
  url: `https://acme.test/${name}`,
  transferredBytes: bytes,
  complete,
});

describe("5.2 — per-image transfer weight", () => {
  it("passes a page whose images are all under the budget", () => {
    expect(
      check([image("a.webp", 40_000), image("b.webp", 120_000)])?.result,
    ).toBe("pass");
  });

  it("fires on an image over the budget", () => {
    expect(check([image("hero.png", 900_000)])?.result).toBe("tip");
  });

  it("treats a read that filled the cap as over budget", () => {
    // The fetch stops at the budget, so `transferredBytes` is a floor. A file
    // that reached it has already failed "below 200KB", whatever its total —
    // and reading the floor as the total would pass it.
    expect(
      check([image("huge.png", IMAGE_TRANSFER_BUDGET_BYTES, false)])?.result,
    ).toBe("tip");
  });

  it("fires exactly at the budget, because the rule says below", () => {
    expect(
      check([image("edge.png", IMAGE_TRANSFER_BUDGET_BYTES)])?.result,
    ).toBe("tip");
  });

  it("passes one byte under it", () => {
    expect(
      check([image("edge.png", IMAGE_TRANSFER_BUDGET_BYTES - 1)])?.result,
    ).toBe("pass");
  });

  it("does not judge a run that weighed nothing", () => {
    // Every fetch failing means we learned nothing about this page's images.
    // "No image is over budget" would be a claim about files never received.
    expect(check(null)?.result).toBe("excluded");
    expect(check([])?.result).toBe("excluded");
  });

  it("counts what it weighed, not what the page declared", () => {
    const record = buildImageWeightRecords([
      image("a.webp", 10),
      image("b.png", 900_000),
    ])[0];

    expect(record?.tested).toBe(2);
    expect(record?.affected).toBe(1);
  });
});
