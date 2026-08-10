import { describe, expect, it } from "vitest";
import {
  contextPageHeadings,
  contextPageProse,
  contextProfilePage,
  CONTEXT_PROFILE_MAX_TEXT_CHARS,
} from "./context-page.ts";

describe("contextPageHeadings", () => {
  it("keeps h1, h2 and h3 apart in document order", () => {
    expect(
      contextPageHeadings(
        "<h2>Second A</h2><h1>First</h1><h3>Third</h3><h2>Second B</h2>",
      ),
    ).toEqual({
      h1: ["First"],
      h2: ["Second A", "Second B"],
      h3: ["Third"],
    });
  });

  it("ignores headings below h3", () => {
    expect(contextPageHeadings("<h4>Deep</h4><h6>Deeper</h6>")).toEqual({
      h1: [],
      h2: [],
      h3: [],
    });
  });

  it("drops a heading that renders to nothing", () => {
    expect(contextPageHeadings('<h1><img src="logo.svg"></h1>').h1).toEqual([]);
  });

  it("strips nested markup without gluing words together", () => {
    expect(contextPageHeadings("<h1>Ship<b>fast</b></h1>").h1).toEqual([
      "Ship fast",
    ]);
  });

  it("tolerates attributes on the heading tag", () => {
    expect(contextPageHeadings('<h1 class="x" data-y="1">Title</h1>').h1).toEqual(
      ["Title"],
    );
  });
});

describe("entity decoding", () => {
  it.each([
    ["decimal", "<h1>&#8212;</h1>", "—"],
    ["hexadecimal", "<h1>&#x2713;</h1>", "✓"],
    ["named", "<h1>a &amp; b</h1>", "a & b"],
    ["german lowercase", "<h1>&uuml;ber</h1>", "über"],
    ["german uppercase", "<h1>&Uuml;ber</h1>", "Über"],
    ["eszett", "<h1>gro&szlig;</h1>", "groß"],
  ])("decodes a %s entity", (_label, html, expected) => {
    expect(contextPageHeadings(html).h1).toEqual([expected]);
  });

  it("leaves an unrecognised entity verbatim rather than dropping text", () => {
    expect(contextPageHeadings("<h1>a &weird; b</h1>").h1).toEqual([
      "a &weird; b",
    ]);
  });

  it("replaces a lone surrogate code point instead of emitting it", () => {
    // A surrogate half would make the projection unstorable as jsonb.
    expect(contextPageHeadings("<h1>a&#xD800;b</h1>").h1).toEqual(["a b"]);
  });

  it("replaces an out-of-range code point", () => {
    expect(contextPageHeadings("<h1>a&#1114112;b</h1>").h1).toEqual(["a b"]);
  });
});

describe("contextPageProse", () => {
  it("reads the body element when there is one", () => {
    expect(
      contextPageProse(
        "<html><head><title>Ignored</title></head><body><p>Kept.</p></body></html>",
      ),
    ).toEqual({ text: "Kept.", truncated: false });
  });

  it("reads a bare fragment that has no body element", () => {
    expect(contextPageProse("<h1>Bare</h1><p>Prose.</p>").text).toBe(
      "Bare Prose.",
    );
  });

  it.each(["script", "style", "noscript", "template", "svg", "iframe"])(
    "keeps %s contents out of the prose",
    (element) => {
      const html =
        `<body><${element}>hidden</${element}><p>Real copy.</p></body>`;
      expect(contextPageProse(html).text).toBe("Real copy.");
    },
  );

  it("reports null, not an empty string, for a page with no prose", () => {
    expect(contextPageProse("<html><body></body></html>")).toEqual({
      text: null,
      truncated: false,
    });
  });

  it("marks the bound it applied itself", () => {
    const long = "x".repeat(CONTEXT_PROFILE_MAX_TEXT_CHARS + 1);
    const bounded = contextPageProse(`<body><p>${long}</p></body>`);

    expect(bounded.truncated).toBe(true);
    expect(bounded.text).toHaveLength(CONTEXT_PROFILE_MAX_TEXT_CHARS);
  });

  it("does not mark text that fits exactly", () => {
    const exact = "x".repeat(CONTEXT_PROFILE_MAX_TEXT_CHARS);
    expect(contextPageProse(`<body><p>${exact}</p></body>`).truncated).toBe(
      false,
    );
  });

  it("bounds by code point, so an emoji cannot be cut in half", () => {
    const emoji = "😀".repeat(CONTEXT_PROFILE_MAX_TEXT_CHARS);
    const bounded = contextPageProse(`<body><p>${emoji}</p></body>`);

    expect([...(bounded.text ?? "")]).toHaveLength(
      CONTEXT_PROFILE_MAX_TEXT_CHARS,
    );
    expect(bounded.text).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});

describe("contextProfilePage", () => {
  it("projects the whole page and carries the score through", () => {
    const html =
      "<html><head><title>Pricing</title>" +
      '<meta name="description" content="What it costs"></head>' +
      "<body><h1>Plans</h1><p>Three tiers.</p></body></html>";

    expect(contextProfilePage("https://acme.test/pricing", html, 9)).toEqual({
      url: "https://acme.test/pricing",
      path: "/pricing",
      score: 9,
      title: "Pricing",
      metaDescription: "What it costs",
      headings: { h1: ["Plans"], h2: [], h3: [] },
      text: "Plans Three tiers.",
      textTruncated: false,
    });
  });

  it("reports null for metadata the document does not declare", () => {
    const projected = contextProfilePage(
      "https://acme.test/x",
      "<html><body><p>Copy.</p></body></html>",
      0,
    );

    expect(projected.title).toBeNull();
    expect(projected.metaDescription).toBeNull();
  });

  it("falls back to a root path when the URL cannot be parsed", () => {
    expect(contextProfilePage("not a url", "<body><p>a</p></body>", 0).path).toBe(
      "/",
    );
  });
});
