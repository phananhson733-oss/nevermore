// @input  -- every per-request record producer, driven through its own branches
// @output -- proof none of them emits a shape the Agent wire guard refuses
// @pos    -- the guard that would have caught the clean-site image-budget defect

import { describe, expect, it } from "vitest";
import { buildImageWeightRecords, buildPagePerformanceRecords, buildPageWeightRecords } from "./page-performance.ts";
import { buildSerpShapeRecords } from "./serp-shape.ts";
import { buildKeywordEvidenceRecords, buildPageShapeRecords } from "./keyword-evidence/records.ts";

/** The three shapes the wire guard refuses. */
function violations(records: readonly { id: string; state: string; affected: number; tested: number; observations: readonly unknown[] }[]) {
  return records.flatMap((r) => {
    const bad: string[] = [];
    if (r.affected !== r.observations.length) bad.push("affected != observations");
    if (r.affected > r.tested) bad.push("affected > tested");
    if ((r.state === "observed") !== (r.affected > 0)) bad.push(`${r.state} with affected=${r.affected}`);
    return bad.map((b) => `${r.id}: ${b}`);
  });
}

describe("every per-request producer keeps the invariants the wire guard enforces", () => {
  const images = [
    { url: "https://a.test/a.png", transferredBytes: 1_000, complete: true },
    { url: "https://a.test/b.png", transferredBytes: 900_000, complete: true },
  ];

  it.each([
    ["image weights, all within budget", () => buildImageWeightRecords([images[0]!], undefined, true)],
    ["image weights, one over", () => buildImageWeightRecords(images, undefined, true)],
    ["image weights, incomplete", () => buildImageWeightRecords([images[0]!], undefined, false)],
    ["image weights, none declared", () => buildImageWeightRecords([], undefined, true)],
    ["image weights, unavailable", () => buildImageWeightRecords(null, undefined, true)],
    ["page weight, unavailable", () => buildPageWeightRecords(null)],
    ["crux, unavailable", () => buildPagePerformanceRecords(null)],
    ["serp shape, unavailable", () => buildSerpShapeRecords(null, undefined)],
    ["keyword evidence, no query", () => buildKeywordEvidenceRecords("https://a.test/", null)],
    ["page shape, no page type", () => buildPageShapeRecords("https://a.test/", null, null)],
  ])("%s", (_name, build) => {
    expect(violations(build() as never)).toEqual([]);
  });
});
