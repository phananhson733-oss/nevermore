import { describe, expect, it } from "vitest";

import {
  observeGeoFirstPartyProof,
  readGeoBylineSignals,
} from "./kb-first-party-proof.ts";

const page = (head: string, body = "") =>
  `<html><head>${head}</head><body>${body}</body></html>`;

const jsonLd = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

const observe = (html: string) =>
  observeGeoFirstPartyProof({ url: "https://example.com/guide", sourceRef: "own_page-abc123", html });

const signals = (html: string) => observe(html).map((row) => row.signal);

describe("what a page credits", () => {
  it("records a structured author, reviewer and publication date separately", () => {
    const html = page(jsonLd({
      "@type": "Article",
      author: { "@type": "Person", name: "Jane Doe" },
      reviewedBy: { "@type": "Person", name: "Sam Reviewer" },
      datePublished: "2026-08-01",
    }));
    expect(signals(html)).toEqual(["structured_author", "structured_reviewed_by", "structured_date_published"]);
    const [author] = observe(html);
    expect(author?.summary).toBe("Credits author: Jane Doe.");
    expect(author?.id).toBe("evidence:first-party:structured_author:own_page-abc123");
  });

  it("reads a date from article:published_time when structured data has none", () => {
    expect(signals(page(`<meta property="article:published_time" content="2026-08-02T00:00:00Z">`)))
      .toEqual(["structured_date_published"]);
  });

  it("records a byline the page marks up, by rel and by class", () => {
    expect(signals(page("", `<a rel="author" href="/team/jane">Jane Doe</a>`))).toEqual(["visible_byline"]);
    expect(signals(page("", `<div class="entry-author">By Jane Doe</div>`))).toEqual(["visible_byline"]);
    // `authorization` is not a byline; the separator rule is what keeps it out.
    expect(signals(page("", `<div class="authorization">By Jane Doe</div>`))).toEqual([]);
  });

  it("rejects an overlong block rather than truncating it into a byline", () => {
    const prose = "word ".repeat(80);
    expect(signals(page("", `<div class="author">${prose}</div>`))).toEqual([]);
  });

  it("does not take og:site_name as a publisher identity", () => {
    // Every page has one, so accepting it would make "this page names a
    // publisher" true everywhere and the independence test meaningless.
    const found = readGeoBylineSignals(page(`<meta property="og:site_name" content="Example Review Site">`));
    expect(found.publishers).toEqual([]);
    expect(readGeoBylineSignals(page(`<meta name="publisher" content="Example Review Site">`)).publishers)
      .toEqual(["Example Review Site"]);
  });

  it("ignores a URL sitting in an author slot", () => {
    expect(readGeoBylineSignals(page(`<meta name="author" content="https://example.com/team/jane">`)).authors).toEqual([]);
  });

  it("finds nothing in malformed structured data or an unmarked page", () => {
    expect(signals(page(`<script type="application/ld+json">{ not json }</script>`))).toEqual([]);
    expect(signals(page("<title>Pricing</title>", "<p>Plans start at $9.</p>"))).toEqual([]);
  });
});

const table = `<table><tr><th>Sign</th><th>Share</th></tr><tr><td>Aries</td><td>8%</td></tr></table>`;

describe("first-party data candidates", () => {
  it("records a candidate when a research heading sits over a data table", () => {
    const [row] = observe(page("<title>Survey methodology</title>", table));
    expect(row?.signal).toBe("first_party_data_candidate");
    expect(row?.summary).toContain("Survey methodology");
    // The observation says what it did not check, in the row itself.
    expect(row?.summary).toContain("Whether the data is original was not checked.");
  });

  it("needs both halves: a heading without a table, or a table without a heading, is not a candidate", () => {
    expect(signals(page("<title>Our 2026 survey</title>", "<p>Prose only.</p>"))).toEqual([]);
    expect(signals(page("<title>Pricing</title>", table))).toEqual([]);
  });

  it("accepts a chart in place of a table", () => {
    expect(signals(page("<title>Benchmark study</title>", `<canvas id="c"></canvas>`)))
      .toEqual(["first_party_data_candidate"]);
  });

  it("does not count a layout table", () => {
    const layout = `<table role="presentation"><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>`;
    expect(signals(page("<title>Research notes</title>", layout))).toEqual([]);
  });

  it("reads Chinese research headings", () => {
    expect(signals(page("<title>2026 用户调查方法论</title>", table))).toEqual(["first_party_data_candidate"]);
  });
});
