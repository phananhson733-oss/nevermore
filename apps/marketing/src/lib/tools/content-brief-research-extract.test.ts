import { describe, expect, it } from "vitest";

import { extractContentBriefResearch, isChromeBlock } from "./content-brief-research-extract.ts";

describe("extractContentBriefResearch", () => {
  it("prefers main and retains prose in document order under the nearest h2 or h3", () => {
    const result = extractContentBriefResearch(
      `
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
      </body>`,
      "en",
    );

    expect(result.segments).toEqual([
      { heading: null, text: "Opening paragraph.", truncated: false },
      {
        heading: { level: "h2", text: "Planning a research brief" },
        text: "Read actual source material.",
        truncated: false,
      },
      {
        heading: { level: "h3", text: "Evidence collection" },
        text: "Keep the source.",
        truncated: false,
      },
      {
        heading: { level: "h3", text: "Evidence collection" },
        text: "Record its limits.",
        truncated: false,
      },
      {
        heading: { level: "h2", text: "Editorial decisions" },
        text: "Make an explicit decision.",
        truncated: false,
      },
    ]);
    expect(result.segments_total).toBe(5);
    expect(result.omitted_segments).toBe(0);
  });

  it.each([
    [
      "<main><nav><p>Main menu</p></nav></main><article><p>Article body.</p></article><p>Body fallback.</p>",
      "Article body.",
    ],
    [
      "<main></main><article><aside><p>Sidebar only</p></aside></article><p>Body fallback.</p>",
      "Body fallback.",
    ],
  ])(
    "falls back from an empty cleaned main or article without treating navigation as prose",
    (html, text) => {
      expect(extractContentBriefResearch(html, "en").segments).toEqual([
        { heading: null, text, truncated: false },
      ]);
    },
  );

  it("removes executable, semantic navigation and hidden content before extraction and length", () => {
    const result = extractContentBriefResearch(
      `
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
      </main>`,
      "en",
    );

    expect(result).toEqual({
      segments: [{ heading: null, text: "Visible body.", truncated: false }],
      segments_total: 1,
      omitted_segments: 0,
      length: { value: 2, unit: "words", tokenizer: "whitespace" },
    });
    expect(globalThis).not.toHaveProperty("__contentBriefScriptExecuted");
  });

  it.each([
    "Related articles",
    "Related posts",
    "相关文章",
    "Subscribe to our newsletter",
    "订阅 newsletter",
  ])(
    "excludes the explicit %s template section but retains independent following content",
    (label) => {
      const result = extractContentBriefResearch(
        `
        <main>
          <h2>Research</h2><p>Actual source body.</p>
          <section><h2>${label}</h2><div><h3>Template card</h3><p>Template prose.</p></div></section>
          <section><h2>Conclusion</h2><p>Actual final body.</p></section>
        </main>`,
        "en",
      );

      expect(result.segments.map((segment) => segment.text)).toEqual([
        "Actual source body.",
        "Actual final body.",
      ]);
      expect(result.length.value).toBe(8);
    },
  );

  it("ends a flat template section at the next same-level heading, not a related-card subheading", () => {
    const result = extractContentBriefResearch(
      `
      <main><h2>Research</h2><p>Source text.</p>
      <h2>Related articles</h2><h3>Card title</h3><p>Card body.</p>
      <h2>Methodology</h2><p>Real method.</p></main>`,
      "en",
    );

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "Source text.",
      "Real method.",
    ]);
    expect(result.segments[1]?.heading).toEqual({
      level: "h2",
      text: "Methodology",
    });
    expect(result.length.value).toBe(6);
  });

  it.each(["Card same-level heading", "Related posts"])(
    "keeps nested %s headings inside the original template scope",
    (cardHeading) => {
      const result = extractContentBriefResearch(
        `
        <main><h2>Research</h2><p>Actual source body.</p>
          <section><h2>Related articles</h2>
            <div><h2>${cardHeading}</h2><p>Card body.</p></div>
            <p>Still template.</p>
            <div><h1>Higher-level card heading</h1><p>Another card.</p></div>
            <p>Also still template.</p>
          </section>
          <section><h2>Conclusion</h2><p>Actual final body.</p></section>
        </main>`,
        "en",
      );

      expect(result.segments.map((segment) => segment.text)).toEqual([
        "Actual source body.",
        "Actual final body.",
      ]);
      expect(result.segments_total).toBe(2);
      expect(result.length.value).toBe(8);
    },
  );

  it("does not remove genuine topics merely containing related-article or newsletter words", () => {
    const result = extractContentBriefResearch(
      `
      <main><h2>Related articles improve navigation</h2><p>Explain the navigation pattern.</p>
      <h2>Newsletter strategy</h2><p>Discuss editorial planning.</p></main>`,
      "en",
    );

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "Explain the navigation pattern.",
      "Discuss editorial planning.",
    ]);
  });

  it.each([
    ["zh-CN", "正文没有标题也应该保留。"],
    ["ja", "見出しのない本文です。"],
    ["ko", "제목 없는 본문입니다."],
    ["th", "เนื้อหาที่ไม่มีหัวข้อ"],
  ])(
    "keeps heading-less prose and language-appropriate length for %s",
    (language, text) => {
      const result = extractContentBriefResearch(
        `<main><p>${text}</p></main>`,
        language,
      );
      expect(result.segments).toEqual([
        { heading: null, text, truncated: false },
      ]);
      expect(result.length).toEqual({
        value: Array.from(text.replace(/\s/gu, "")).length,
        unit: "non_whitespace_characters",
        tokenizer: "unicode_code_points",
      });
    },
  );

  it("retains plain div, span and direct main prose even when no p or li exists", () => {
    const result = extractContentBriefResearch(
      `
      <main>Opening <span>plain prose.</span>
        <div>One independent block.</div><div><span>Another block.</span></div>
      </main>`,
      "en",
    );

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "Opening plain prose.",
      "One independent block.",
      "Another block.",
    ]);
    expect(result.length.value).toBe(8);
  });

  it("retains mixed direct and paragraph prose without double-counting nested lists", () => {
    const result = extractContentBriefResearch(
      `
      <main><h2>Ordered source</h2>Direct introduction.
        <p>Independent paragraph.</p>
        <ul><li><p>First item <strong>text.</strong></p>
          <ul><li>Nested child.</li></ul>Parent continuation.
        </li><li>Last item.</li></ul>
        <div>Unwrapped final block.</div>
      </main>`,
      "en",
    );

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "Direct introduction.",
      "Independent paragraph.",
      "First item text.",
      "Nested child.",
      "Parent continuation.",
      "Last item.",
      "Unwrapped final block.",
    ]);
    expect(result.segments_total).toBe(7);
    expect(result.length.value).toBe(18);
  });

  it("normalizes whitespace and returns Unicode text, including literal angle brackets, not markup", () => {
    const result = extractContentBriefResearch(
      `
      <main><h2> A&nbsp; heading </h2>
      <p>  A\n sub<strong>topic</strong>&nbsp; &amp; Unicode 😀<br> x &lt; y &gt; z. </p></main>`,
      "en",
    );

    expect(result.segments).toEqual([
      {
        heading: { level: "h2", text: "A heading" },
        text: "A subtopic & Unicode 😀 x < y > z.",
        truncated: false,
      },
    ]);
  });

  it.each([
    "",
    "<main><p> \n </p><ul><li>&nbsp;</li></ul></main>",
    "<nav><p>Navigation only.</p></nav>",
  ])(
    "represents observed empty cleaned prose without inventing segments",
    (html) => {
      expect(extractContentBriefResearch(html, "en")).toEqual({
        segments: [],
        segments_total: 0,
        omitted_segments: 0,
        length: { value: 0, unit: "words", tokenizer: "whitespace" },
      });
    },
  );

  it.each([
    ["a".repeat(300), false],
    ["a".repeat(301), true],
    ["😀".repeat(300), false],
    ["😀".repeat(301), true],
  ])(
    "bounds each segment at 300 Unicode code points with honest truncation",
    (text, truncated) => {
      const result = extractContentBriefResearch(
        `<main><p>${text}</p></main>`,
        "zh",
      );
      expect(result.segments[0]?.text).toBe(
        Array.from(text).slice(0, 300).join(""),
      );
      expect(Array.from(result.segments[0]?.text ?? "")).toHaveLength(300);
      expect(result.segments[0]?.truncated).toBe(truncated);
      expect(result.length.value).toBe(Array.from(text).length);
    },
  );

  it("bounds the associated heading at 160 code points without calling the body truncated", () => {
    const result = extractContentBriefResearch(
      `<main><h2>${"😀".repeat(161)}</h2><p>正文</p></main>`,
      "zh",
    );
    expect(result.segments).toEqual([
      {
        heading: { level: "h2", text: "😀".repeat(160) },
        text: "正文",
        truncated: false,
      },
    ]);
    expect(result.length.value).toBe(163);
  });

  it("retains 12 of 13 actual candidates while length includes all cleaned main text and headings", () => {
    const paragraphs = Array.from(
      { length: 13 },
      (_, index) => `<p>Paragraph ${index + 1}.</p>`,
    ).join("");
    const result = extractContentBriefResearch(
      `<main><h2>Observed heading</h2>${paragraphs}<footer>Ignored</footer></main>`,
      "en",
    );

    expect(result.segments).toHaveLength(12);
    expect(result.segments[11]?.text).toBe("Paragraph 12.");
    expect(result.segments_total).toBe(13);
    expect(result.omitted_segments).toBe(1);
    expect(result.length).toEqual({
      value: 28,
      unit: "words",
      tokenizer: "whitespace",
    });
  });

  it("extracts 10000-deep block prose without losing order or honest candidate counts", () => {
    const paragraphs = Array.from(
      { length: 13 },
      (_, index) => `<p>Paragraph ${index + 1}.</p>`,
    ).join("");
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

    expect(result.segments).toEqual([
      {
        heading: { level: "h2", text: "😀".repeat(160) },
        text: "正文",
        truncated: false,
      },
    ]);
    expect(result.segments_total).toBe(1);
    expect(result.length.value).toBe(163);
  });
});

describe("chrome filtering and relevance selection", () => {
  /**
   * Reproduces what production actually retained for almanac.com on
   * 2026-09-07: the page's first blocks are a newsletter box, image credits
   * and a byline, and the body that answers the keyword sits after them.
   * Before chrome filtering, all eight retained excerpts were the chrome.
   */
  const ALMANAC = `<main>
    <h3>For daily wit &amp; wisdom, get the Almanac newsletter.</h3>
    <p>Sign up for the Almanac newsletter.</p>
    <p>Primary Image</p>
    <p>Image Credit:</p>
    <p>Parts of this image sourced from NASA</p>
    <p>Written By: Celeste Longacre Gardener &amp; Astrologer</p>
    <p>July 30, 2026</p>
    <p>Share this article</p>
    <p>Body</p>
    <h2>What is Mercury retrograde?</h2>
    <p>Mercury retrograde is an apparent backward motion of the planet Mercury across the sky, caused by the relative orbital speeds of Earth and Mercury rather than any real reversal.</p>
    <p>During a Mercury retrograde period, astrologers traditionally advise care with contracts, travel plans and electronics, because the planet governs communication.</p>
    <h2>Mercury retrograde 2026 dates</h2>
    <p>The second Mercury retrograde of 2026 runs from June 29 through July 23, followed by a shadow period of roughly two weeks on each side.</p>
  </main>`;

  it("drops newsletter, credit, byline, date and label chrome from the candidate pool", () => {
    const result = extractContentBriefResearch(ALMANAC, "en", [
      "mercury retrograde meaning",
    ]);
    const texts = result.segments.map((segment) => segment.text);

    expect(texts).not.toContain("Sign up for the Almanac newsletter.");
    expect(texts).not.toContain("Primary Image");
    expect(texts).not.toContain("Image Credit:");
    expect(texts).not.toContain(
      "Written By: Celeste Longacre Gardener & Astrologer",
    );
    expect(texts).not.toContain("July 30, 2026");
    expect(texts).not.toContain("Share this article");
    expect(texts).not.toContain("Body");
  });

  it("retains the body that answers the keyword and counts only real candidates", () => {
    const result = extractContentBriefResearch(ALMANAC, "en", [
      "mercury retrograde meaning",
    ]);
    const texts = result.segments.map((segment) => segment.text);

    expect(texts).toContain(
      "Mercury retrograde is an apparent backward motion of the planet Mercury across the sky, caused by the relative orbital speeds of Earth and Mercury rather than any real reversal.",
    );
    expect(
      texts.some((text) =>
        text.startsWith("The second Mercury retrograde of 2026 runs"),
      ),
    ).toBe(true);
    // Four real blocks survive: one uncredited caption plus three body paragraphs.
    expect(result.segments_total).toBe(4);
    expect(result.omitted_segments).toBe(0);
  });

  it("still measures every cleaned block, including the chrome it refuses to cite", () => {
    const result = extractContentBriefResearch(ALMANAC, "en", [
      "mercury retrograde meaning",
    ]);

    // `length` describes what was observed on the page, not what was retained,
    // so removing chrome from the citation pool must not shrink it.
    expect(result.length.unit).toBe("words");
    expect(result.length.value).toBeGreaterThan(90);
  });

  it("removes recognised navigation labels and ranks the rest below real prose", () => {
    // Reproduces the shape of the baike.baidu.com page production retained on
    // 2026-09-07, where all twelve excerpts were site navigation. Recognised
    // labels are dropped outright; a site-prefixed label such as 百度首页 is not
    // pattern-matched, because that rule would also delete ordinary prose —
    // it loses to real paragraphs on relevance instead.
    const body = Array.from(
      { length: 12 },
      (_, index) =>
        `<p>水星逆行第 ${index + 1} 段说明：这是一种视觉现象，来自地球与水星公转速度的差异，并不是水星真的开始倒退运行。</p>`,
    ).join("");
    const result = extractContentBriefResearch(
      `<main><p>跳至主要內容</p><p>百度首页</p><p>登录</p><p>注册</p>${body}</main>`,
      "zh",
      ["水逆是什么意思"],
    );
    const texts = result.segments.map((segment) => segment.text);

    expect(texts).not.toContain("跳至主要內容");
    expect(texts).not.toContain("登录");
    expect(texts).not.toContain("注册");
    expect(texts).not.toContain("百度首页");
    expect(result.segments).toHaveLength(12);
    expect(texts.every((text) => text.startsWith("水星逆行第"))).toBe(true);
    // 百度首页 stays an honest candidate; it is outranked, not erased.
    expect(result.segments_total).toBe(13);
  });

  it("does not mistake prose that merely mentions a chrome word for chrome", () => {
    const result = extractContentBriefResearch(
      `<main>
      <p>Subscribers to an astrology newsletter often ask whether the shadow period counts, and the answer depends on which ephemeris the writer used.</p>
      <p>Share this article</p>
      <p>Go to the settings page, open the birth-time field, and record the Rodden rating you actually have before trusting any house cusp.</p>
    </main>`,
      "en",
      ["shadow period"],
    );
    const texts = result.segments.map((segment) => segment.text);

    expect(
      texts.some((text) =>
        text.startsWith("Subscribers to an astrology newsletter"),
      ),
    ).toBe(true);
    // Long instructional prose starting with a navigation verb stays evidence.
    expect(
      texts.some((text) => text.startsWith("Go to the settings page")),
    ).toBe(true);
    expect(texts).not.toContain("Share this article");
  });

  it("selects the keyword-relevant blocks when more candidates exist than slots", () => {
    const filler = Array.from(
      { length: 14 },
      (_, index) =>
        `<p>Unrelated background paragraph number ${index + 1} about gardening almanacs and seasonal planting charts for the year.</p>`,
    ).join("");
    const html = `<main>${filler}<h2>Mercury retrograde meaning</h2><p>Mercury retrograde meaning is best explained as an apparent reversal seen from Earth, not a real change in the orbit of Mercury itself.</p></main>`;

    const result = extractContentBriefResearch(html, "en", [
      "mercury retrograde meaning",
    ]);

    expect(result.segments_total).toBe(15);
    expect(result.segments).toHaveLength(12);
    // The one relevant block is last in the document; document-order retention
    // would have dropped it entirely.
    expect(result.segments[0]?.text).toContain(
      "Mercury retrograde meaning is best explained",
    );
  });

  it("keeps document order when nothing has to be dropped", () => {
    const result = extractContentBriefResearch(
      `<main>
      <p>First observed paragraph about the topic under discussion here.</p>
      <p>Second observed paragraph continuing the same explanation for readers.</p>
    </main>`,
      "en",
      ["topic"],
    );

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "First observed paragraph about the topic under discussion here.",
      "Second observed paragraph continuing the same explanation for readers.",
    ]);
  });

  it("ranks by relevance without keywords falling back to shuffling", () => {
    const paragraphs = Array.from(
      { length: 13 },
      (_, index) => `<p>Paragraph ${index + 1}.</p>`,
    ).join("");
    const result = extractContentBriefResearch(
      `<main><h2>Observed heading</h2>${paragraphs}</main>`,
      "en",
      [],
    );

    expect(result.segments[0]?.text).toBe("Paragraph 1.");
    expect(result.segments[11]?.text).toBe("Paragraph 12.");
  });

  it("keeps an emoji joiner sequence whole and still drops a block of joiners alone", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(isChromeBlock(`${family} ${"a".repeat(80)}`)).toBe(false);
    expect(isChromeBlock("\u200D\u200D \u200B")).toBe(true);
    // Surviving the chrome filter is not the same as surviving intact. Retained
    // text is never edited, so the joiners have to reach the segment: strip them
    // and the reader is shown three separate people where the page showed one
    // family. Only the extractor can pin that; isChromeBlock returns a verdict,
    // not the text it judged.
    const prose = `${family} Households compare every plan on this list before they switch providers.`;
    const result = extractContentBriefResearch(`<main><h2>Observed heading</h2><p>${prose}</p></main>`, "en", []);
    expect(result.segments[0]?.text).toBe(prose);
  });

  it("keeps a sentence that merely opens with a chrome label", () => {
    for (const prose of [
      "Subscribe to a service only after comparing its cancellation policy and total annual cost.",
      "\u8ba2\u9605\u6a21\u5f0f\u7684\u6838\u5fc3\u662f\u6301\u7eed\u63d0\u4f9b\u4ef7\u503c\uff0c\u800c\u4e0d\u662f\u4ec5\u4ec5\u6309\u6708\u6536\u8d39\u3002",
      "Go to Settings and disable public access before deploying the database.",
      "Share this workload across three regions so a single outage cannot take the queue down.",
    ]) {
      expect(isChromeBlock(prose), prose).toBe(false);
    }
  });

  it("still drops the label itself, with or without its short payload", () => {
    for (const chrome of [
      "Sign up for the Almanac newsletter.",
      "Image Credit:",
      "Written By: Celeste Longacre Gardener & Astrologer",
      "Share this article",
      "\u5e7f\u544a",
      "\u8ba2\u9605",
      "\u8ba2\u9605\u6211\u4eec\u7684\u5468\u62a5",
      "Back to top",
    ]) {
      expect(isChromeBlock(chrome), chrome).toBe(true);
    }
  });

  it("counts every observed paragraph, including those past the collection ceiling", () => {
    const filler = Array.from({ length: 420 }, (_, index) =>
      `<p>Unrelated paragraph number ${index} about municipal budgeting and procurement schedules.</p>`).join("");
    const result = extractContentBriefResearch(`<main>${filler}</main>`, "en", ["taurine"]);
    expect(result.segments_total).toBe(420);
    expect(result.omitted_segments).toBe(420 - result.segments.length);
  });

  it("does not rewrite a Persian word by deleting its zero-width non-joiner", () => {
    const word = "\u0645\u06cc\u200c\u0631\u0648\u0645";
    const result = extractContentBriefResearch(
      `<main><p>${word} ${"\u0627".repeat(80)}</p></main>`, "fa", []);
    expect(result.segments[0]?.text.startsWith(word)).toBe(true);
  });

  it("does not let an unrelated word containing the keyword crowd out the only relevant excerpt", () => {
    const decoy = Array.from({ length: 12 }, (_, index) =>
      `<p>Education policy ${index} determines school funding, teacher training, classroom resources and assessment schedules across every district in the region.</p>`).join("");
    const relevant = "<p>A cat needs taurine to avoid heart and retinal disease.</p>";
    const result = extractContentBriefResearch(`<main>${decoy}${relevant}</main>`, "en", ["cat"]);
    expect(result.segments.some((segment) => segment.text.includes("A cat needs taurine"))).toBe(true);
  });
});
