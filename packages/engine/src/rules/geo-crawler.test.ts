import { describe, expect, it } from "vitest";
import type { CrawlRobotsProjection } from "@sf/sources";
import { METRIC_CRAWL_ROBOTS } from "@sf/sources";
import { DiagnosticContext } from "../context.ts";
import type { CoverageInput, ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import type { FindingCandidate, RuleResult } from "../rule.ts";
import { geoCrawlerRule } from "./geo-crawler.ts";

const OBSERVED_AT = "2026-07-01T00:00:00.000Z";

type Groups = CrawlRobotsProjection["groups"];

function robots(groups: Groups, fetched = true): CrawlRobotsProjection {
  return { fetched, groups, sitemaps: [] };
}

interface BuildOpts {
  readonly robots?: CrawlRobotsProjection;
  readonly crawl?: CoverageInput["crawl"];
}

function buildContext(opts: BuildOpts): DiagnosticContext {
  const observations: ObservationView[] = [];
  if (opts.robots) {
    observations.push({
      metricKey: METRIC_CRAWL_ROBOTS,
      subjectType: "site",
      subjectRef: "https://example.com",
      provider: "crawl",
      availability: "available",
      valueJson: opts.robots,
      observedAt: OBSERVED_AT,
    });
  }
  const coverage: CoverageInput = {
    crawl: opts.crawl ?? "available",
    gsc: "unavailable",
    ga4: "unavailable",
    csv: "unavailable",
  };
  return DiagnosticContext.build({
    icp: parseIcp({ siteLanguageCodes: ["en"], priorityUrls: [] }),
    deliveryLocale: "en",
    observations,
    coverage,
    capturedAt: { crawl: OBSERVED_AT },
  });
}

function candidates(result: RuleResult): readonly FindingCandidate[] {
  if (result.status !== "candidate") {
    throw new Error(`expected candidate, got ${result.status}`);
  }
  return result.candidates;
}

describe("GEO-CRAWLER-002", () => {
  it("flags every AI bot when the wildcard group disallows the whole site", () => {
    const ctx = buildContext({
      robots: robots([{ userAgent: "*", disallow: ["/"], allow: [] }]),
    });

    const cs = candidates(geoCrawlerRule.evaluate(ctx));
    expect(cs).toHaveLength(4);
    expect(cs.every((c) => c.severity === "high")).toBe(true);
    expect(cs.every((c) => c.metrics.scope === "site")).toBe(true);
    expect(cs.map((c) => c.subjectRefs[0])).toEqual([
      "user_agent:OAI-SearchBot",
      "user_agent:ChatGPT-User",
      "user_agent:PerplexityBot",
      "user_agent:ClaudeBot",
    ]);
    const evidence = cs[0]!.evidence[0]!;
    expect(evidence.method).toBe("observed");
    expect(evidence.grade).toBe("B");
    expect(evidence.origin).toBe("direct_public");
    expect(evidence.observedAt).toBe(OBSERVED_AT);
  });

  it("flags a commercial-path disallow as high with commercial_path scope", () => {
    const ctx = buildContext({
      robots: robots([{ userAgent: "*", disallow: ["/pricing/"], allow: [] }]),
    });

    const cs = candidates(geoCrawlerRule.evaluate(ctx));
    expect(cs).toHaveLength(4);
    expect(cs[0]!.severity).toBe("high");
    expect(cs[0]!.metrics.scope).toBe("commercial_path");
    expect(cs[0]!.metrics.userAgent).toBe("OAI-SearchBot");
  });

  it("prefers the bot-specific group over the wildcard (case-insensitive match)", () => {
    const ctx = buildContext({
      robots: robots([
        { userAgent: "*", disallow: ["/admin"], allow: [] },
        { userAgent: "claudebot", disallow: ["/"], allow: [] },
      ]),
    });

    const cs = candidates(geoCrawlerRule.evaluate(ctx));
    expect(cs).toHaveLength(1);
    expect(cs[0]!.subjectRefs).toEqual(["user_agent:ClaudeBot"]);
    expect(cs[0]!.metrics.scope).toBe("site");
  });

  it("does not flag a bot whose own group is permissive even if the wildcard blocks", () => {
    const ctx = buildContext({
      robots: robots([
        { userAgent: "*", disallow: ["/"], allow: [] },
        { userAgent: "ClaudeBot", disallow: [], allow: [] },
      ]),
    });

    const cs = candidates(geoCrawlerRule.evaluate(ctx));
    expect(cs).toHaveLength(3);
    expect(cs.map((c) => c.subjectRefs[0])).not.toContain("user_agent:ClaudeBot");
  });

  it("passes when no AI bot is blocked", () => {
    const ctx = buildContext({
      robots: robots([{ userAgent: "*", disallow: ["/admin", "/blog"], allow: [] }]),
    });
    expect(geoCrawlerRule.evaluate(ctx)).toEqual({
      status: "pass",
      metrics: { robotsFetched: 1, blockedBotCount: 0 },
    });
  });

  it("passes when robots.txt was not fetched", () => {
    const ctx = buildContext({ robots: robots([], false) });
    expect(geoCrawlerRule.evaluate(ctx)).toEqual({
      status: "pass",
      metrics: { robotsFetched: 0 },
    });
  });

  it("passes when there is no robots observation", () => {
    const ctx = buildContext({});
    expect(geoCrawlerRule.evaluate(ctx)).toEqual({
      status: "pass",
      metrics: { robotsFetched: 0 },
    });
  });

  it("skips as missing_dataset when crawl is unavailable", () => {
    const ctx = buildContext({ crawl: "unavailable" });
    expect(geoCrawlerRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });
});
