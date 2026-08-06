import { describe, expect, it } from "vitest";
import { renderStudioMarkdown } from "./_markdown-preview.ts";

describe("Studio Markdown preview", () => {
  it("renders headings, emphasis, and lists as semantic HTML", () => {
    const html = renderStudioMarkdown(
      "## Affected scope\n\nUse **verified evidence** and *review* it.\n\n- First\n- Second",
    );

    expect(html).toContain("<h2>Affected scope</h2>");
    expect(html).toContain("<strong>verified evidence</strong>");
    expect(html).toContain("<em>review</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<li>Second</li>");
  });

  it("drops raw executable HTML, images, event handlers, and unsafe links", () => {
    const html = renderStudioMarkdown(`
<script>alert("script")</script>

<style>body { display: none }</style>

<div onclick="alert('event')">raw HTML block</div>

<img src="https://tracker.example/pixel.png" onerror="alert('image')">

![remote image](https://tracker.example/markdown.png)

<a href="https://example.com" onclick="alert('event')">raw link</a>

[unsafe link](javascript:alert('link'))
`);

    expect(html).not.toMatch(/<script|<style|<img|onerror|onclick|javascript:/i);
    expect(html).not.toContain("tracker.example");
    expect(html).not.toContain("raw HTML block");
  });

  it("keeps safe HTTPS links", () => {
    const html = renderStudioMarkdown(
      '[Documentation](https://example.com/guide "Studio guide")',
    );

    expect(html).toContain(
      '<a href="https://example.com/guide" title="Studio guide">Documentation</a>',
    );
  });

  it("limits headings to the supported h1-h4 document hierarchy", () => {
    const html = renderStudioMarkdown(
      "#### Supported heading\n\n##### Unsupported heading five\n\n###### Unsupported heading six\n\nFirst  \nSecond",
    );

    expect(html).toContain("<h4>Supported heading</h4>");
    expect(html).not.toMatch(/<h[56](?:\s|>)/i);
    expect(html).not.toContain("<br");
    expect(html).toContain("Unsupported heading five");
    expect(html).toContain("Unsupported heading six");
  });

  it("wraps safe Markdown tables in the controlled horizontal scroll boundary", () => {
    const html = renderStudioMarkdown(`
| Page | Priority |
| --- | ---: |
| /pricing | 1 |
`);

    expect(html).toContain(
      '<div data-studio-markdown-table-scroll="true"><table>',
    );
    expect(html).toContain("</table></div>");
    expect(html).toContain("<th>Page</th>");
    expect(html).toContain("<td>/pricing</td>");
  });

  it("does not let model-authored HTML forge the table scroll boundary", () => {
    const html = renderStudioMarkdown(`
<div data-studio-markdown-table-scroll="true">forged boundary</div>

| Safe | Table |
| --- | --- |
| yes | yes |
`);

    expect(html).not.toContain("forged boundary");
    expect(
      html.match(/data-studio-markdown-table-scroll="true"/g),
    ).toHaveLength(1);
  });
});
