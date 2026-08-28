// @input  -- the local fixture wrapper and the package's exact parser
// @output -- a failing test when the brief the UI tests render stops being a legal ContentBrief
// @pos    -- keeps the UI tests honest: a fixture the parser rejects proves nothing about the surface

import { describe, expect, it } from "vitest";
import {
  parseContentBrief,
  parseContentBriefShape,
} from "@sf/public-tools/content-brief/parse-brief";

import {
  validContentBrief,
  withFingerprint,
  withRun,
} from "./content-brief-fixture.ts";

describe("content brief UI fixture", () => {
  it("passes the contract's shape parser", () => {
    const result = parseContentBriefShape(validContentBrief());
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("passes the exact parser once the fingerprint is stamped", async () => {
    const result = await parseContentBrief(await withFingerprint(validContentBrief()));
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it.each([
    { language: "zh" as const },
    { llm: "validation_failed" as const },
    { serp: "unavailable" as const },
    { completeC5: true },
  ])("passes the shape parser with knob %o", (knobs) => {
    const result = parseContentBriefShape(validContentBrief({}, knobs));
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("keeps the crawl invariant attempted === observed + failed + skipped", () => {
    const brief = validContentBrief();
    const { crawl } = brief.run.reads;
    if (crawl.status === "unavailable") throw new Error("fixture crawl is unavailable");
    expect(crawl.attempted).toBe(crawl.observed + crawl.failed + crawl.skipped);
    const ledger = brief.evidence.crawl;
    expect(ledger.observed).toHaveLength(crawl.observed);
    expect(ledger.failed).toHaveLength(crawl.failed);
    expect(ledger.skipped).toHaveLength(crawl.skipped);
    expect(ledger.observed.filter((page) => !page.body_complete)).toHaveLength(crawl.truncated);
  });

  it("shares no provenance object between fields", () => {
    // structuredClone keeps shared references, so a test mutating one
    // provenance would silently change another; the fixture must hand every
    // field its own object.
    const seen = new Map<object, string>();
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== "object" || node === null) return;
      if ("method" in node && ("origin" in node || "derived_from" in node)) {
        expect(seen.get(node), `${path} shares a provenance with ${seen.get(node)}`).toBeUndefined();
        seen.set(node, path);
      }
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
    };
    walk(validContentBrief({}, { connected: true }), "brief");
    expect(seen.size).toBeGreaterThan(5);
  });

  it("merges run overrides one level into reads", () => {
    const brief = withRun(validContentBrief(), {
      mode: "degraded",
      reads: { gsc: { status: "unavailable", reason: "timeout", attempted: 3 } },
    });
    expect(brief.run.mode).toBe("degraded");
    expect(brief.run.reads.gsc).toEqual({ status: "unavailable", reason: "timeout", attempted: 3 });
    expect(brief.run.reads.serp).toEqual(validContentBrief().run.reads.serp);
  });
});
