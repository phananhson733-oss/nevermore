import { describe, expect, it } from "vitest";
import {
  GEO_RUN_COLLECT_COMPETITOR_LIMIT,
  GEO_RUN_KNOWLEDGE_MODEL_SEED,
  geoRunCollectSeeds,
  geoRunUpdateSeeds,
  planGeoRunCollection,
} from "./kb-run-collect.ts";

const OWN = "https://example.com/";

function competitor(overrides: Partial<{ domain: string; brandName: string; confirmed: boolean }> = {}) {
  return { domain: "rival.com", brandName: "Rival", confirmed: true, ...overrides };
}

describe("planning what one update observes", () => {
  it("observes the site's own page exactly as the draft names it", () => {
    const targets = planGeoRunCollection({ targetUrl: "https://www.example.com/", competitors: [] });
    // Not the apex: a site that serves only on www answers nothing at the
    // bare domain, and the draft's own target URL is the one that was confirmed.
    expect(targets.map((target) => target.url)).toEqual(["https://www.example.com/"]);
    expect(targets[0]?.kind).toBe("own_page");
    expect(targets[0]?.scope).toBe("own");
  });

  it("keeps the path the draft's target names", () => {
    const targets = planGeoRunCollection({ targetUrl: "https://example.com/product/", competitors: [] });
    expect(targets.map((target) => target.url)).toEqual(["https://example.com/product/"]);
  });

  it("names each target with the key its ledger row will carry", () => {
    const targets = planGeoRunCollection({ targetUrl: OWN, competitors: [competitor()] });
    expect(targets.map((target) => target.key)).toEqual([
      "fetch:own:https://example.com/",
      "fetch:competitor:https://rival.com/",
    ]);
  });

  it("derives the same keys from the same draft every time", () => {
    const input = { targetUrl: OWN, competitors: [competitor(), competitor({ domain: "other.com" })] };
    expect(geoRunCollectSeeds(planGeoRunCollection(input)))
      .toEqual(geoRunCollectSeeds(planGeoRunCollection(input)));
  });

  it("observes only competitors somebody confirmed", () => {
    const targets = planGeoRunCollection({
      targetUrl: OWN,
      competitors: [competitor({ domain: "unconfirmed.com", confirmed: false }), competitor()],
    });
    expect(targets.map((target) => target.url)).toEqual([OWN, "https://rival.com/"]);
  });

  it("spends one operation per crawl-gate target, not per URL", () => {
    // The gate budgets by apex host, so `www.example.com` and `example.com`
    // draw on one allowance. Two operations would spend it twice for one page.
    const targets = planGeoRunCollection({
      targetUrl: "https://www.example.com/",
      competitors: [competitor({ domain: "example.com" }), competitor()],
    });
    expect(targets.map((target) => target.url)).toEqual([
      "https://www.example.com/",
      "https://rival.com/",
    ]);
    expect(new Set(targets.map((target) => target.gateKey)).size).toBe(targets.length);
  });

  it("keeps a competitor listed twice to one operation", () => {
    const targets = planGeoRunCollection({
      targetUrl: OWN,
      competitors: [competitor(), competitor({ brandName: "Rival Inc" })],
    });
    expect(targets.map((target) => target.url)).toEqual([OWN, "https://rival.com/"]);
  });

  it("drops a competitor that is known by name only", () => {
    const targets = planGeoRunCollection({
      targetUrl: OWN,
      competitors: [competitor({ domain: "" }), competitor()],
    });
    expect(targets.map((target) => target.url)).toEqual([OWN, "https://rival.com/"]);
  });

  it("drops a competitor whose domain is not a public host", () => {
    const targets = planGeoRunCollection({
      targetUrl: OWN,
      competitors: [competitor({ domain: "localhost" }), competitor({ domain: "10.0.0.1" }), competitor()],
    });
    expect(targets.map((target) => target.url)).toEqual([OWN, "https://rival.com/"]);
  });

  it("stops at the competitor ceiling rather than crawling an unbounded list", () => {
    const many = Array.from({ length: GEO_RUN_COLLECT_COMPETITOR_LIMIT + 3 }, (_value, index) =>
      competitor({ domain: `rival${index}.com` }));
    const targets = planGeoRunCollection({ targetUrl: OWN, competitors: many });
    expect(targets).toHaveLength(GEO_RUN_COLLECT_COMPETITOR_LIMIT + 1);
  });

  it("plans nothing at all when the draft names no usable site", () => {
    expect(planGeoRunCollection({ targetUrl: "not a url", competitors: [competitor()] })).toEqual([]);
  });

  it("seeds every planned target as a fetch operation", () => {
    const targets = planGeoRunCollection({ targetUrl: OWN, competitors: [competitor()] });
    expect(geoRunCollectSeeds(targets)).toEqual([
      { key: "fetch:own:https://example.com/", kind: "fetch" },
      { key: "fetch:competitor:https://rival.com/", kind: "fetch" },
    ]);
  });

  it("puts the knowledge step after every page, never before one", () => {
    const seeds = geoRunUpdateSeeds(
      planGeoRunCollection({ targetUrl: OWN, competitors: [competitor()] }),
    );
    expect(seeds).toEqual([
      { key: "fetch:own:https://example.com/", kind: "fetch" },
      { key: "fetch:competitor:https://rival.com/", kind: "fetch" },
      { key: "model:knowledge", kind: "model" },
    ]);
    // The position IS the phase boundary: `seq` is written from this array's
    // order and `planGeoRun` acts on the first actionable row, so a knowledge
    // step anywhere but last would be bought before its pages were read.
    expect(seeds.findIndex((seed) => seed.kind === "model")).toBe(seeds.length - 1);
    expect(seeds.filter((seed) => seed.kind === "model")).toHaveLength(1);
  });

  it("plans no knowledge step at all when there is nothing to observe", () => {
    // A lone model step would buy a synthesis about a site nothing was allowed
    // to read, and then let the run report the knowledge base as updated.
    expect(geoRunUpdateSeeds(planGeoRunCollection({ targetUrl: "not a url", competitors: [competitor()] })))
      .toEqual([]);
    expect(geoRunUpdateSeeds([])).toEqual([]);
  });

  it("names the knowledge step by its step, so a resumed run finds its own row", () => {
    // The ledger constrains `starts_with(operation_key, kind || ':')`, and the
    // key must not move when the collection plan does: a shifted key is a
    // second authorisation to spend for work already paid for.
    expect(GEO_RUN_KNOWLEDGE_MODEL_SEED).toEqual({ key: "model:knowledge", kind: "model" });
    const alone = geoRunUpdateSeeds(planGeoRunCollection({ targetUrl: OWN, competitors: [] }));
    const crowded = geoRunUpdateSeeds(
      planGeoRunCollection({ targetUrl: OWN, competitors: [competitor(), competitor({ domain: "other.com" })] }),
    );
    expect(alone).toHaveLength(2);
    expect(crowded).toHaveLength(4);
    expect(alone.at(-1)?.key).toBe("model:knowledge");
    expect(crowded.at(-1)?.key).toBe("model:knowledge");
    // No fetch key may collide with it, or resuming would answer one operation
    // with another operation's stored result.
    expect(crowded.slice(0, -1).some((seed) => seed.key === "model:knowledge")).toBe(false);
  });
});
