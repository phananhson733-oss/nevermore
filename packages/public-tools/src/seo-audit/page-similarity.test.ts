// @input  -- page paragraph sets shaped like the cases 4.5 must separate
// @output -- proof duplicates score high and chrome-sharing pages do not
// @pos    -- the P6 gate the published rule requires, executed

import { describe, expect, it } from "vitest";

import { measurePageSimilarity } from "./page-similarity.ts";

const CHROME = [
  "Home Products Pricing Docs Support Contact",
  "Copyright 2026 Acme Incorporated. All rights reserved.",
  "We use cookies to improve your experience on this site.",
];

const body = (sentence: string, times: number) =>
  Array.from({ length: times }, (_, i) => `${sentence} This is sentence ${i}.`);

function measure(
  pages: readonly {
    url: string;
    paragraphs: string[];
    partOfASequence?: boolean;
  }[],
) {
  const out = measurePageSimilarity(
    pages.map((page) => ({ ...page, partOfASequence: page.partOfASequence ?? false })),
  );
  return (url: string) => out.find((entry) => entry.url === url);
}

describe("page similarity", () => {
  it("KNOWN TRUE POSITIVE: two pages carrying the same body", () => {
    const shared = body("Our returns policy allows thirty days.", 12);
    const find = measure([
      { url: "/a", paragraphs: [...CHROME, ...shared] },
      { url: "/b", paragraphs: [...CHROME, ...shared] },
      { url: "/c", paragraphs: [...CHROME, ...body("Something else entirely.", 12)] },
      { url: "/d", paragraphs: [...CHROME, ...body("A third distinct topic.", 12)] },
      { url: "/e", paragraphs: [...CHROME, ...body("A fourth distinct topic.", 12)] },
    ]);

    expect(find("/a")?.similarity).toBeGreaterThan(0.7);
    expect(find("/a")?.nearest).toBe("/b");
  });

  it("KNOWN FALSE POSITIVE: pages that share only the nav and footer", () => {
    // The commonest shape on the web: heavy chrome, modest article. Comparing
    // raw text reports every page on the site as a near-duplicate of every
    // other, which is the finding this gate exists to prevent.
    const find = measure([
      { url: "/a", paragraphs: [...CHROME, ...body("Alpha topic writeup.", 10)] },
      { url: "/b", paragraphs: [...CHROME, ...body("Beta subject notes.", 10)] },
      { url: "/c", paragraphs: [...CHROME, ...body("Gamma reference guide.", 10)] },
      { url: "/d", paragraphs: [...CHROME, ...body("Delta explainer text.", 10)] },
      { url: "/e", paragraphs: [...CHROME, ...body("Epsilon walkthrough.", 10)] },
    ]);

    expect(find("/a")?.similarity ?? 0).toBeLessThan(0.7);
  });

  it("does not score a page with too little left after chrome is removed", () => {
    const find = measure([
      { url: "/a", paragraphs: [...CHROME, "Thanks."] },
      { url: "/b", paragraphs: [...CHROME, ...body("A real article here.", 10)] },
      { url: "/c", paragraphs: [...CHROME, ...body("Another real one.", 10)] },
      { url: "/d", paragraphs: [...CHROME, ...body("A third real one.", 10)] },
      { url: "/e", paragraphs: [...CHROME, ...body("A fourth real one.", 10)] },
    ]);

    // One sentence is not enough text for a similarity score to mean anything;
    // a single shared phrase would swing it across any threshold.
    expect(find("/a")?.similarity).toBeNull();
  });

  it("does not score a site too small to tell chrome from duplication", () => {
    // Two pages sharing a paragraph is either a footer or the duplication
    // itself. Nothing in the text says which, so neither answer is given.
    const shared = body("The very same words.", 12);
    const find = measure([
      { url: "/a", paragraphs: shared },
      { url: "/b", paragraphs: shared },
    ]);
    expect(find("/a")?.similarity).toBeNull();
  });

  it("KNOWN FALSE POSITIVE: page 2 and page 3 of a paginated archive", () => {
    // The case the launch gate names. An archive's pages share their intro,
    // their filter chrome and their card wording, differing only in which
    // items they list — and the intro is on too few pages to read as site
    // chrome. Every correctly-built archive on the web has this shape.
    const intro = body("Browse every guide we have published.", 8);
    const find = measure([
      { url: "/blog/", paragraphs: [...CHROME, ...intro, ...body("Item one.", 4)], partOfASequence: true },
      { url: "/blog/page/2", paragraphs: [...CHROME, ...intro, ...body("Item two.", 4)], partOfASequence: true },
      { url: "/blog/page/3", paragraphs: [...CHROME, ...intro, ...body("Item three.", 4)], partOfASequence: true },
      { url: "/about", paragraphs: [...CHROME, ...body("Who we are.", 12)] },
      { url: "/pricing", paragraphs: [...CHROME, ...body("What it costs.", 12)] },
    ]);

    expect(find("/blog/page/2")?.similarity).toBeNull();
  });

  it("still scores a page that does not declare itself part of a series", () => {
    // The exemption has to be earned by the markup. Without it, any site
    // could opt out of the check by having similar pages.
    const shared = body("Word for word the same.", 12);
    const find = measure([
      { url: "/a", paragraphs: [...CHROME, ...shared] },
      { url: "/b", paragraphs: [...CHROME, ...shared] },
      { url: "/c", paragraphs: [...CHROME, ...body("Distinct one.", 12)] },
      { url: "/d", paragraphs: [...CHROME, ...body("Distinct two.", 12)] },
      { url: "/e", paragraphs: [...CHROME, ...body("Distinct three.", 12)] },
    ]);

    expect(find("/a")?.similarity).toBeGreaterThan(0.7);
  });

  it("gives the same answer whichever order the pages arrive in", () => {
    const shared = body("Identical content on both.", 12);
    const pages = [
      { url: "/a", paragraphs: [...CHROME, ...shared] },
      { url: "/b", paragraphs: [...CHROME, ...shared] },
      { url: "/c", paragraphs: [...CHROME, ...body("Different.", 12)] },
      { url: "/d", paragraphs: [...CHROME, ...body("Also different.", 12)] },
      { url: "/e", paragraphs: [...CHROME, ...body("Differently again.", 12)] },
    ];
    const withFlag = pages.map((page) => ({ ...page, partOfASequence: false }));
    const forward = measurePageSimilarity(withFlag);
    const reversed = measurePageSimilarity([...withFlag].reverse());

    expect(forward.find((e) => e.url === "/a")?.similarity).toBe(
      reversed.find((e) => e.url === "/a")?.similarity,
    );
  });
});
