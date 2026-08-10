import { describe, expect, it } from "vitest";

import {
  KEYWORD_CLUSTER_JACCARD,
  clusterKeywords,
  keywordClusterIndex,
} from "./cluster.ts";

function idsOf(clusters: readonly { id: string }[]): string[] {
  return clusters.map((cluster) => cluster.id);
}

describe("clusterKeywords", () => {
  it("groups two terms that share their content words, because they compete for one page", () => {
    const clusters = clusterKeywords([
      "email marketing automation",
      "email marketing software",
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.keywords).toEqual([
      "email marketing automation",
      "email marketing software",
    ]);
  });

  it("keeps unrelated terms apart so the reader is never told to cover both with one page", () => {
    const clusters = clusterKeywords([
      "email marketing software",
      "dog grooming prices",
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.keywords)).toEqual([
      ["email marketing software"],
      ["dog grooming prices"],
    ]);
  });

  it("refuses to merge two question-form terms that only share how/to/a", () => {
    // "how to start a newsletter" and "how to grow an email list" have three of
    // five tokens in common if stop words count. Grouping on that would put
    // every question phrasing on the site into one bogus cluster.
    const clusters = clusterKeywords([
      "how to start a newsletter",
      "how to grow an email list",
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.keywords).toEqual(["how to start a newsletter"]);
    expect(clusters[1]?.keywords).toEqual(["how to grow an email list"]);
  });

  it("still merges question-form terms once the surviving content words match", () => {
    // Same stop-word-heavy shape as the pair above, but "start" and
    // "newsletter" carry over — the control that shows the split there came
    // from dropping stop words rather than from distrusting questions.
    const clusters = clusterKeywords([
      "how to start a newsletter",
      "start a newsletter free",
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.keywords).toEqual([
      "how to start a newsletter",
      "start a newsletter free",
    ]);
  });

  it("labels a group with its shortest member, which reads as the head term", () => {
    const clusters = clusterKeywords([
      "keyword research tools guide",
      "keyword research tools",
      "keyword research tools for beginners",
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.label).toBe("keyword research tools");
    expect(clusters[0]?.keywords).toHaveLength(3);
  });

  it("breaks a length tie alphabetically so the label never depends on input order", () => {
    const label = (keywords: readonly string[]): string | undefined =>
      clusterKeywords(keywords)[0]?.label;

    expect(label(["seo audit beta", "seo audit alfa"])).toBe("seo audit alfa");
    expect(label(["seo audit alfa", "seo audit beta"])).toBe("seo audit alfa");
  });

  it("numbers clusters from one in first-seen order so two runs of a site are comparable", () => {
    const input = [
      "email marketing software",
      "dog grooming prices",
      "email marketing automation",
      "how to start a newsletter",
    ];

    const first = clusterKeywords(input);
    const second = clusterKeywords([...input]);

    expect(idsOf(first)).toEqual(["cluster-1", "cluster-2", "cluster-3"]);
    expect(second).toEqual(first);
  });

  it("returns nothing at all when no candidate survived, rather than an empty placeholder group", () => {
    expect(clusterKeywords([])).toEqual([]);
  });

  it("falls back to the raw tokens for a term that is nothing but stop words", () => {
    // Dropping every token would leave an empty set that matches nothing, so a
    // degenerate term must still be grouped on what it literally says.
    const clusters = clusterKeywords(["how to", "the best"]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.keywords).toEqual(["how to"]);
    expect(clusters[0]?.label).toBe("how to");
    expect(clusters[1]?.keywords).toEqual(["the best"]);
  });

  it("collapses a repeated term instead of letting it join two groups", () => {
    // A group's token set grows on every join, so the same term arriving twice
    // can match a different group the second time — and the reverse index then
    // points one of its rows at a group it is not part of.
    const clusters = clusterKeywords([
      "alpha beta",
      "alpha beta gamma",
      "alpha beta gamma delta epsilon zeta",
      "alpha beta",
    ]);

    const appearances = clusters.flatMap((cluster) =>
      cluster.keywords.filter((keyword) => keyword === "alpha beta"),
    );
    expect(appearances).toEqual(["alpha beta"]);
    expect(keywordClusterIndex(clusters).get("alpha beta")).toBe(
      clusters.find((cluster) => cluster.keywords.includes("alpha beta"))?.id,
    );
  });

  it("survives a term with no word characters instead of throwing on an empty token set", () => {
    const clusters = clusterKeywords(["", "email marketing software", "!!!"]);

    expect(clusters).toHaveLength(3);
    expect(clusters[0]?.label).toBe("");
    expect(clusters[0]?.keywords).toEqual([""]);
    expect(clusters[2]?.keywords).toEqual(["!!!"]);
  });

  it("groups exactly at the published overlap threshold, not just above it", () => {
    // Two shared tokens out of four distinct ones is a Jaccard of exactly 0.5.
    // If the comparison were strict, the documented constant would not be the
    // boundary it claims to be.
    expect(KEYWORD_CLUSTER_JACCARD).toBe(0.5);
    expect(
      clusterKeywords(["alpha beta delta", "alpha beta gamma"]),
    ).toHaveLength(1);
    // One shared token out of three is 0.33, just under the line.
    expect(clusterKeywords(["alpha beta", "alpha gamma"])).toHaveLength(2);
  });
});

describe("keywordClusterIndex", () => {
  it("maps every keyword back to the cluster it landed in so a row can carry its group", () => {
    const clusters = clusterKeywords([
      "email marketing software",
      "dog grooming prices",
      "email marketing automation",
    ]);
    const index = keywordClusterIndex(clusters);

    expect(index.get("email marketing software")).toBe("cluster-1");
    expect(index.get("email marketing automation")).toBe("cluster-1");
    expect(index.get("dog grooming prices")).toBe("cluster-2");
    expect(index.size).toBe(3);
  });

  it("reports no group for a keyword that never made it into the shown rows", () => {
    const index = keywordClusterIndex(
      clusterKeywords(["email marketing software"]),
    );

    expect(index.get("dog grooming prices")).toBeUndefined();
  });

  it("yields an empty index for an empty run instead of failing the caller", () => {
    expect(keywordClusterIndex([]).size).toBe(0);
  });
});
