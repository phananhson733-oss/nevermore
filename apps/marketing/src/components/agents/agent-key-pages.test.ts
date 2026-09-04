// @input  -- candidate shortlists paired with confirmed and empty Profiles
// @output -- proof the narrowing states its basis and never invents interest
// @pos    -- unit guard for the client-side key-page selection

import { describe, expect, it } from "vitest";

import type { AgentKeyPageCandidate } from "../../lib/agents/audit-contract.ts";
import { selectAgentKeyPages } from "./agent-key-pages.ts";

const ORIGIN = "https://example.com";

function candidate(
  url: string,
  overrides: Partial<AgentKeyPageCandidate> = {},
): AgentKeyPageCandidate {
  return {
    url,
    title: null,
    metaDescription: null,
    depth: 1,
    inboundLinks: 1,
    reason: "navigation",
    ...overrides,
  };
}

function run(
  candidates: readonly AgentKeyPageCandidate[],
  coreFeatures: readonly string[] = [],
  inspectedTargetUrl: string | null = null,
) {
  return selectAgentKeyPages({
    candidates,
    coreFeatures,
    siteOrigin: ORIGIN,
    inspectedTargetUrl,
  });
}

describe("selectAgentKeyPages", () => {
  it("keeps the server's structural order and says so when no feature was confirmed", () => {
    // Ranking by URL shape alone would dress a guess as a confirmation.
    const pages = run([
      candidate(`${ORIGIN}/pricing`),
      candidate(`${ORIGIN}/blog`),
    ]);

    expect(pages.map((page) => page.url)).toEqual([
      `${ORIGIN}/pricing`,
      `${ORIGIN}/blog`,
    ]);
    expect(pages.every((page) => page.basis === "structure")).toBe(true);
    expect(pages.every((page) => page.matchedFeature === null)).toBe(true);
  });

  it("ranks a whole confirmed feature above a page that merely uses its words", () => {
    // The distinguishing case: the first page contains all three words and
    // none of the phrase, the second contains the phrase. Scoring them the
    // same would put the scattered page on top, which is how a glossary entry
    // outranks the product page it defines.
    const pages = run(
      [
        candidate(`${ORIGIN}/tool-for-keyword-and-research`),
        candidate(`${ORIGIN}/keyword-research-tool-guide`),
      ],
      ["keyword research tool"],
    );

    expect(pages[0]?.url).toBe(`${ORIGIN}/keyword-research-tool-guide`);
    expect(pages[0]?.basis).toBe("feature");
    expect(pages[0]?.matchedFeature).toBe("keyword research tool");
  });

  it("reads a feature out of the title and description, not only the path", () => {
    const pages = run(
      [
        candidate(`${ORIGIN}/a`),
        candidate(`${ORIGIN}/b`, {
          title: "Rank tracking for agencies",
          metaDescription: "Daily positions",
        }),
      ],
      ["rank tracking"],
    );

    expect(pages[0]?.url).toBe(`${ORIGIN}/b`);
    expect(pages[0]?.basis).toBe("feature");
  });

  it("splits a camelCase feature the way the matcher would read it", () => {
    const pages = run(
      [candidate(`${ORIGIN}/a`), candidate(`${ORIGIN}/rank-tracking`)],
      ["rankTracking"],
    );

    expect(pages[0]?.url).toBe(`${ORIGIN}/rank-tracking`);
  });

  it("matches a CJK feature without whitespace tokens", () => {
    const pages = run(
      [
        candidate(`${ORIGIN}/a`),
        candidate(`${ORIGIN}/b`, { title: "关键词研究工具" }),
      ],
      ["关键词研究"],
    );

    expect(pages[0]?.url).toBe(`${ORIGIN}/b`);
    expect(pages[0]?.basis).toBe("feature");
  });

  it("pins the home page first and the submitted page second whatever the Profile says", () => {
    const pages = run(
      [
        candidate(`${ORIGIN}/keyword-tool`),
        candidate(`${ORIGIN}/`),
        candidate(`${ORIGIN}/contact`),
      ],
      ["keyword tool"],
      `${ORIGIN}/contact`,
    );

    expect(pages.map((page) => page.url)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/contact`,
      `${ORIGIN}/keyword-tool`,
    ]);
    expect(pages.map((page) => page.basis)).toEqual([
      "homepage",
      "target",
      "feature",
    ]);
  });

  it("lists the home page once when it is also the submitted page", () => {
    const pages = run(
      [candidate(`${ORIGIN}/`), candidate(`${ORIGIN}/about`)],
      [],
      `${ORIGIN}/`,
    );

    expect(pages.map((page) => page.url)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/about`,
    ]);
    expect(pages[0]?.basis).toBe("homepage");
  });

  it("holds a stable order when two pages score the same", () => {
    const pages = run(
      [
        candidate(`${ORIGIN}/tool-a`),
        candidate(`${ORIGIN}/tool-b`),
        candidate(`${ORIGIN}/tool-c`),
      ],
      ["tool"],
    );

    expect(pages.map((page) => page.url)).toEqual([
      `${ORIGIN}/tool-a`,
      `${ORIGIN}/tool-b`,
      `${ORIGIN}/tool-c`,
    ]);
  });

  it("keeps every server-selected candidate beyond the old twelve-page cap", () => {
    const pages = run(
      Array.from({ length: 30 }, (_, index) =>
        candidate(`${ORIGIN}/p${String(index).padStart(2, "0")}`),
      ),
    );

    expect(pages).toHaveLength(30);
  });

  it("preserves the server reason while applying Profile ordering and basis", () => {
    const pages = run(
      [
        candidate(`${ORIGIN}/plain`, {
          reason: { kind: "cluster", prefix: "/tools/" },
        }),
        candidate(`${ORIGIN}/keyword-tool`, {
          reason: { kind: "content", inboundLinks: 1 },
        }),
      ],
      ["keyword tool"],
    );

    expect(pages[0]).toMatchObject({
      url: `${ORIGIN}/keyword-tool`,
      basis: "feature",
      reason: { kind: "content", inboundLinks: 1 },
    });
    expect(pages[1]?.reason).toEqual({ kind: "cluster", prefix: "/tools/" });
  });

  it("returns nothing when the run published no shortlist", () => {
    expect(run([], ["anything"])).toEqual([]);
  });

  it("does not claim a feature basis for a page that matched none", () => {
    const pages = run(
      [candidate(`${ORIGIN}/keyword-tool`), candidate(`${ORIGIN}/legal`)],
      ["keyword tool"],
    );

    expect(pages[1]?.basis).toBe("structure");
    expect(pages[1]?.matchedFeature).toBeNull();
  });

  it("ignores blank entries in a confirmed feature list", () => {
    const pages = run(
      [candidate(`${ORIGIN}/a`), candidate(`${ORIGIN}/b`)],
      ["   ", ""],
    );

    expect(pages.every((page) => page.basis === "structure")).toBe(true);
  });
});
