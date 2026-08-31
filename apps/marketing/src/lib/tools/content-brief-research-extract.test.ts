import { describe, expect, it } from "vitest";

import { extractContentBriefResearch } from "./content-brief-research-extract.ts";

describe("extractContentBriefResearch", () => {
  it("prefers main and retains prose in document order under the nearest h2 or h3", () => {
    const result = extractContentBriefResearch(`
      <body>
        <article><p>Other article.</p></article>
        <main>
          <p>Opening paragraph.</p>
          <h2>Planning a research brief</h2>
          <p>Read actual source material.</p>
          <h3>Evidence collection</h3>
          <ul><li>Keep the source.</li><li>Record its limits.</li></ul>
          <h2>Editorial decisions</h2><p>Make an explicit decision.</p>
        </main>
        <p>Outside the main region.</p>
      </body>`, "en");

    expect(result.segments).toEqual([
      { heading: null, text: "Opening paragraph.", truncated: false },
      { heading: { level: "h2", text: "Planning a research brief" }, text: "Read actual source material.", truncated: false },
      { heading: { level: "h3", text: "Evidence collection" }, text: "Keep the source.", truncated: false },
      { heading: { level: "h3", text: "Evidence collection" }, text: "Record its limits.", truncated: false },
      { heading: { level: "h2", text: "Editorial decisions" }, text: "Make an explicit decision.", truncated: false },
    ]);
    expect(result.segments_total).toBe(5);
    expect(result.omitted_segments).toBe(0);
  });

  it.each([
    ["<main><nav><p>Main menu</p></nav></main><article><p>Article body.</p></article><p>Body fallback.</p>", "Article body."],
    ["<main></main><article><aside><p>Sidebar only</p></aside></article><p>Body fallback.</p>", "Body fallback."],
  ])("falls back from an empty cleaned main or article without treating navigation as prose", (html, text) => {
    expect(extractContentBriefResearch(html, "en").segments).toEqual([
      { heading: null, text, truncated: false },
    ]);
  });

  it("removes executable, semantic navigation and hidden content before extraction and length", () => {
    const result = extractContentBriefResearch(`
      <main>
        <script>globalThis.__contentBriefScriptExecuted = true</script>
        <style>.body { color: red; }</style><noscript>Alternative content</noscript>
        <template><p>Template data</p></template><iframe>Frame text</iframe>
        <svg><text>Graphic text</text></svg><canvas>Canvas text</canvas>
        <header><h2>Header title</h2><p>Header words</p></header>
        <nav><p>Navigation</p></nav><footer><p>Footer</p></footer>
        <aside><p>Sidebar</p></aside><form><p>Form instructions</p></form>
        <div role="navigation"><p>Role navigation</p></div>
        <p hidden>Hidden paragraph</p><div aria-hidden=" TRUE "><p>Hidden tree</p></div>
        <p style="display: none">Invisible paragraph</p>
        <p style="visibility: hidden">Invisible words</p>
        <p aria-hidden="false">Visible body.</p>
        <img src="https://example.test/image" onerror="alert('never executed')">
      </main>`, "en");

    expect(result).toEqual({
      segments: [{ heading: null, text: "Visible body.", truncated: false }],
      segments_total: 1,
      omitted_segments: 0,
      length: { value: 2, unit: "words", tokenizer: "whitespace" },
    });
    expect(globalThis).not.toHaveProperty("__contentBriefScriptExecuted");
  });

  it.each(["Related articles", "Related posts", "相关文章", "Subscribe to our newsletter", "订阅 newsletter"])(
    "excludes the explicit %s template section but retains independent following content",
    (label) => {
      const result = extractContentBriefResearch(`
        <main>
          <h2>Research</h2><p>Actual source body.</p>
          <section><h2>${label}</h2><div><h3>Template card</h3><p>Template prose.</p></div></section>
          <section><h2>Conclusion</h2><p>Actual final body.</p></section>
        </main>`, "en");

      expect(result.segments.map((segment) => segment.text)).toEqual([
        "Actual source body.", "Actual final body.",
      ]);
      expect(result.length.value).toBe(8);
    },
  );

  it("ends a flat template section at the next same-level heading, not a related-card subheading", () => {
    const result = extractContentBriefResearch(`
      <main><h2>Research</h2><p>Source text.</p>
      <h2>Related articles</h2><h3>Card title</h3><p>Card body.</p>
      <h2>Methodology</h2><p>Real method.</p></main>`, "en");

    expect(result.segments.map((segment) => segment.text)).toEqual(["Source text.", "Real method."]);
    expect(result.segments[1]?.heading).toEqual({ level: "h2", text: "Methodology" });
    expect(result.length.value).toBe(6);
  });

  it.each(["Card same-level heading", "Related posts"])(
    "keeps nested %s headings inside the original template scope",
    (cardHeading) => {
      const result = extractContentBriefResearch(`
        <main><h2>Research</h2><p>Actual source body.</p>
          <section><h2>Related articles</h2>
            <div><h2>${cardHeading}</h2><p>Card body.</p></div>
            <p>Still template.</p>
            <div><h1>Higher-level card heading</h1><p>Another card.</p></div>
            <p>Also still template.</p>
          </section>
          <section><h2>Conclusion</h2><p>Actual final body.</p></section>
        </main>`, "en");

      expect(result.segments.map((segment) => segment.text)).toEqual([
        "Actual source body.", "Actual final body.",
      ]);
      expect(result.segments_total).toBe(2);
      expect(result.length.value).toBe(8);
    },
  );

  it("does not remove genuine topics merely containing related-article or newsletter words", () => {
    const result = extractContentBriefResearch(`
      <main><h2>Related articles improve navigation</h2><p>Explain the navigation pattern.</p>
      <h2>Newsletter strategy</h2><p>Discuss editorial planning.</p></main>`, "en");

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "Explain the navigation pattern.", "Discuss editorial planning.",
    ]);
  });

  it.each([
    ["zh-CN", "正文没有标题也应该保留。"],
    ["ja", "見出しのない本文です。"],
    ["ko", "제목 없는 본문입니다."],
    ["th", "เนื้อหาที่ไม่มีหัวข้อ"],
  ])("keeps heading-less prose and language-appropriate length for %s", (language, text) => {
    const result = extractContentBriefResearch(`<main><p>${text}</p></main>`, language);
    expect(result.segments).toEqual([{ heading: null, text, truncated: false }]);
    expect(result.length).toEqual({
      value: Array.from(text.replace(/\s/gu, "")).length,
      unit: "non_whitespace_characters",
      tokenizer: "unicode_code_points",
    });
  });

  it("retains plain div, span and direct main prose even when no p or li exists", () => {
    const result = extractContentBriefResearch(`
      <main>Opening <span>plain prose.</span>
        <div>One independent block.</div><div><span>Another block.</span></div>
      </main>`, "en");

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "Opening plain prose.", "One independent block.", "Another block.",
    ]);
    expect(result.length.value).toBe(8);
  });

  it("retains mixed direct and paragraph prose without double-counting nested lists", () => {
    const result = extractContentBriefResearch(`
      <main><h2>Ordered source</h2>Direct introduction.
        <p>Independent paragraph.</p>
        <ul><li><p>First item <strong>text.</strong></p>
          <ul><li>Nested child.</li></ul>Parent continuation.
        </li><li>Last item.</li></ul>
        <div>Unwrapped final block.</div>
      </main>`, "en");

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "Direct introduction.", "Independent paragraph.", "First item text.",
      "Nested child.", "Parent continuation.", "Last item.", "Unwrapped final block.",
    ]);
    expect(result.segments_total).toBe(7);
    expect(result.length.value).toBe(18);
  });

  it("normalizes whitespace and returns Unicode text, including literal angle brackets, not markup", () => {
    const result = extractContentBriefResearch(`
      <main><h2> A&nbsp; heading </h2>
      <p>  A\n sub<strong>topic</strong>&nbsp; &amp; Unicode 😀<br> x &lt; y &gt; z. </p></main>`, "en");

    expect(result.segments).toEqual([{
      heading: { level: "h2", text: "A heading" },
      text: "A subtopic & Unicode 😀 x < y > z.",
      truncated: false,
    }]);
  });

  it.each(["", "<main><p> \n </p><ul><li>&nbsp;</li></ul></main>", "<nav><p>Navigation only.</p></nav>"])(
    "represents observed empty cleaned prose without inventing segments", (html) => {
      expect(extractContentBriefResearch(html, "en")).toEqual({
        segments: [], segments_total: 0, omitted_segments: 0,
        length: { value: 0, unit: "words", tokenizer: "whitespace" },
      });
    },
  );

  it.each([
    ["a".repeat(300), false],
    ["a".repeat(301), true],
    ["😀".repeat(300), false],
    ["😀".repeat(301), true],
  ])("bounds each segment at 300 Unicode code points with honest truncation", (text, truncated) => {
    const result = extractContentBriefResearch(`<main><p>${text}</p></main>`, "zh");
    expect(result.segments[0]?.text).toBe(Array.from(text).slice(0, 300).join(""));
    expect(Array.from(result.segments[0]?.text ?? "")).toHaveLength(300);
    expect(result.segments[0]?.truncated).toBe(truncated);
    expect(result.length.value).toBe(Array.from(text).length);
  });

  it("bounds the associated heading at 160 code points without calling the body truncated", () => {
    const result = extractContentBriefResearch(`<main><h2>${"😀".repeat(161)}</h2><p>正文</p></main>`, "zh");
    expect(result.segments).toEqual([{
      heading: { level: "h2", text: "😀".repeat(160) }, text: "正文", truncated: false,
    }]);
    expect(result.length.value).toBe(163);
  });

  it("retains 12 of 13 actual candidates while length includes all cleaned main text and headings", () => {
    const paragraphs = Array.from({ length: 13 }, (_, index) => `<p>Paragraph ${index + 1}.</p>`).join("");
    const result = extractContentBriefResearch(`<main><h2>Observed heading</h2>${paragraphs}<footer>Ignored</footer></main>`, "en");

    expect(result.segments).toHaveLength(12);
    expect(result.segments[11]?.text).toBe("Paragraph 12.");
    expect(result.segments_total).toBe(13);
    expect(result.omitted_segments).toBe(1);
    expect(result.length).toEqual({ value: 28, unit: "words", tokenizer: "whitespace" });
  });

  it("extracts 10000-deep block prose without losing order or honest candidate counts", () => {
    const paragraphs = Array.from({ length: 13 }, (_, index) => `<p>Paragraph ${index + 1}.</p>`).join("");
    const html = `<main><h2>Observed heading</h2>${"<div>".repeat(10_000)}${paragraphs}${"</div>".repeat(10_000)}</main>`;

    const result = extractContentBriefResearch(html, "en");

    expect(result.segments).toHaveLength(12);
    expect(result.segments[0]?.text).toBe("Paragraph 1.");
    expect(result.segments[11]?.text).toBe("Paragraph 12.");
    expect(result.segments_total).toBe(13);
    expect(result.omitted_segments).toBe(1);
    expect(result.length.value).toBe(28);
  });

  it("reads and bounds a 10000-deep inline heading without recursive text extraction", () => {
    const html = `<main><h2>${"<span>".repeat(10_000)}${"😀".repeat(161)}${"</span>".repeat(10_000)}</h2><p>正文</p></main>`;

    const result = extractContentBriefResearch(html, "zh");

    expect(result.segments).toEqual([{
      heading: { level: "h2", text: "😀".repeat(160) }, text: "正文", truncated: false,
    }]);
    expect(result.segments_total).toBe(1);
    expect(result.length.value).toBe(163);
  });
});
