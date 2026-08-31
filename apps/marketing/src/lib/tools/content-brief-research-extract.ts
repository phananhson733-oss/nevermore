// @input -- already fetched HTML and the run's research language
// @output -- bounded source prose and descriptive observed main-text length
// @pos -- local-only Content Brief v2 extraction; no network, model or HTML rendering

import {
  measureResearchLength,
  RESEARCH_HEADING_MAX_CHARS,
  RESEARCH_SEGMENT_MAX_CHARS,
  RESEARCH_SEGMENTS_PER_PAGE,
  type ExtractedPageResearch,
  type ResearchHeading,
  type ResearchSegment,
} from "@sf/public-tools/content-brief/v2-contract";
import { load, type CheerioAPI } from "cheerio";

type HtmlNode = ReturnType<CheerioAPI>[number];
interface NodeVisit {
  readonly node: HtmlNode;
  readonly exiting: boolean;
}

const NON_PROSE = [
  "script", "style", "noscript", "template", "iframe", "svg", "canvas",
  "object", "embed", "audio", "video", "nav", "header", "footer", "aside", "form",
  "[hidden]", "[inert]", '[role="navigation"]', '[role="banner"]',
  '[role="contentinfo"]', '[role="complementary"]',
].join(",");
const BLOCKS = new Set([
  "address", "article", "blockquote", "dd", "div", "dl", "dt", "figcaption",
  "figure", "hr", "li", "main", "ol", "p", "pre", "section", "table", "tbody",
  "td", "th", "thead", "tr", "ul",
]);
const HEADING = /^h[1-6]$/u;
/** Exact template labels only: ordinary articles about these topics remain prose. */
const TEMPLATE_HEADING = /^(?:related articles|related posts|相关文章|subscribe to (?:our |the )?newsletter|订阅\s*(?:newsletter|电子报|邮件通讯))[:：]?$/iu;
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/iu;

function normalizeText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Cheerio's text() recursively descends; source headings can be deeply nested. */
function headingText(heading: HtmlNode): string {
  const text: string[] = [];
  const stack = [heading];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.type === "text") text.push(node.data);
    else if ("children" in node) {
      for (const child of [...node.children].reverse()) stack.push(child);
    }
  }
  return normalizeText(text.join(""));
}

/** Remove only the marked section, ending at its parent or the next peer heading. */
function removeTemplateSections($: CheerioAPI): void {
  let excluded: { readonly level: number; readonly scope: HtmlNode | null } | null = null;
  const stack: NodeVisit[] = $.root().toArray().map((node) => ({ node, exiting: false }));
  while (stack.length > 0) {
    const visit = stack.pop();
    if (visit === undefined) break;
    const { node, exiting } = visit;
    if (exiting) {
      if (excluded?.scope === node) excluded = null;
      continue;
    }
    if (node.type === "tag" && HEADING.test(node.name)) {
      const level = Number(node.name[1]);
      if (excluded !== null && node.parent === excluded.scope && level <= excluded.level) excluded = null;
      if (excluded === null && TEMPLATE_HEADING.test(headingText(node))) {
        excluded = { level, scope: node.parent };
      }
      if (excluded !== null) $(node).remove();
      continue;
    }
    if (node.type === "text" && excluded !== null) {
      $(node).remove();
    } else if ("children" in node) {
      stack.push({ node, exiting: true });
      for (const child of [...node.children].reverse()) stack.push({ node: child, exiting: false });
    }
  }
}

function observeRegion(region: HtmlNode, language: string): ExtractedPageResearch {
  const segments: ResearchSegment[] = [];
  const mainText: string[] = [];
  let paragraph: string[] = [];
  let heading: ResearchHeading | null = null;
  let total = 0;

  function finishParagraph(): void {
    const text = normalizeText(paragraph.join(""));
    paragraph = [];
    if (text === "") return;
    total += 1;
    if (segments.length >= RESEARCH_SEGMENTS_PER_PAGE) return;
    const characters = Array.from(text);
    segments.push({
      heading,
      text: characters.slice(0, RESEARCH_SEGMENT_MAX_CHARS).join(""),
      truncated: characters.length > RESEARCH_SEGMENT_MAX_CHARS,
    });
  }

  const stack: NodeVisit[] = [{ node: region, exiting: false }];
  while (stack.length > 0) {
    const visit = stack.pop();
    if (visit === undefined) break;
    const { node, exiting } = visit;
    if (exiting) {
      finishParagraph();
      mainText.push(" ");
      continue;
    }
    if (node.type === "text") {
      paragraph.push(node.data);
      mainText.push(node.data);
      continue;
    }
    if (node.type !== "tag") continue;
    if (HEADING.test(node.name)) {
      finishParagraph();
      const text = headingText(node);
      mainText.push(" ", text, " ");
      if (node.name === "h2" || node.name === "h3") {
        heading = text === "" ? null : {
          level: node.name,
          text: Array.from(text).slice(0, RESEARCH_HEADING_MAX_CHARS).join(""),
        };
      }
      continue;
    }
    const block = BLOCKS.has(node.name);
    if (block) {
      finishParagraph();
      mainText.push(" ");
      stack.push({ node, exiting: true });
    }
    for (const child of [...node.children].reverse()) stack.push({ node: child, exiting: false });
  }

  finishParagraph();
  return {
    segments,
    segments_total: total,
    omitted_segments: total - segments.length,
    // All cleaned main text, including headings and omitted/unbounded prose.
    // This describes observed input only; HTTP body_complete belongs to the caller.
    length: measureResearchLength(normalizeText(mainText.join("")), language),
  };
}

/**
 * Local HTML parsing only; never executes scripts or fetches referenced resources.
 * Returned strings are text, not HTML: literal < and > in visible source text are
 * preserved and must remain text/untrusted data in every downstream consumer.
 */
export function extractContentBriefResearch(html: string, language: string): ExtractedPageResearch {
  const $ = load(html);
  $(NON_PROSE).remove();
  $("[aria-hidden]").filter((_, node) => $(node).attr("aria-hidden")?.trim().toLowerCase() === "true").remove();
  $("[style]").filter((_, node) => HIDDEN_STYLE.test($(node).attr("style") ?? "")).remove();
  $("br").replaceWith(" ");
  removeTemplateSections($);

  for (const selector of ["main", "article", "body"]) {
    for (const region of $(selector).toArray()) {
      const research = observeRegion(region, language);
      if (research.segments_total > 0 || selector === "body") return research;
    }
  }
  return { segments: [], segments_total: 0, omitted_segments: 0, length: measureResearchLength("", language) };
}
