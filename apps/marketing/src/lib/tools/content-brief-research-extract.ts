// @input -- already fetched HTML, the run's research language and its keywords
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
import {
  relevanceScore,
  relevanceTerms,
  type RelevanceTerm,
} from "@sf/public-tools/content-brief/terms";
import { load, type CheerioAPI } from "cheerio";

type HtmlNode = ReturnType<CheerioAPI>[number];
interface NodeVisit {
  readonly node: HtmlNode;
  readonly exiting: boolean;
}

const NON_PROSE = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "svg",
  "canvas",
  "object",
  "embed",
  "audio",
  "video",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "[hidden]",
  "[inert]",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
].join(",");
const BLOCKS = new Set([
  "address",
  "article",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);
const HEADING = /^h[1-6]$/u;
/** Exact template labels only: ordinary articles about these topics remain prose. */
const TEMPLATE_HEADING =
  /^(?:related articles|related posts|相关文章|subscribe to (?:our |the )?newsletter|订阅\s*(?:newsletter|电子报|邮件通讯))[:：]?$/iu;
const HIDDEN_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/iu;

/**
 * Why a candidate ceiling above the retained ceiling.
 *
 * The contract keeps at most `RESEARCH_SEGMENTS_PER_PAGE` excerpts per page.
 * Collecting only that many in document order means a page whose first
 * paragraphs are a newsletter box and a photo credit contributes nothing but
 * its chrome, no matter how good its body is. So every block is collected
 * first, chrome is dropped, and the survivors compete for the retained slots.
 * The cap bounds a hostile page without bounding an ordinary one.
 */
const CANDIDATE_MAX = 400;
/** Below this, a paragraph is a label or a fragment rather than an explanation. */
const SHORT_SEGMENT_CHARS = 30;
const SUBSTANTIAL_SEGMENT_CHARS = 60;
const RICH_SEGMENT_CHARS = 160;
/**
 * Navigation-shaped phrases are only chrome when the whole block is short.
 *
 * "Go to Settings and disable public access before deploying the database" is
 * seventy characters of instruction that opens with a navigation label, so the
 * bound has to sit well below it. Real navigation is a handful of words.
 */
const NAVIGATION_TEXT_MAX = 40;
/** A credit or byline label plus its payload; longer than this is prose. */
const CHROME_LABEL_MAX = 60;

/**
 * Zero-width and soft-hyphen code points, written escaped so this file stays
 * greppable.
 *
 * The two joiners are deliberately absent. Deleting the zero-width joiner
 * splits an emoji sequence into the separate glyphs it was built from, and
 * deleting the zero-width non-joiner rewrites Persian and Indic words, which
 * use it to stop letters from joining: "می‌روم" would be retained as "میروم",
 * a different string from the one the page showed. Retained text is never
 * edited, so both are kept in the prose and only treated as nothing when a
 * block contains nothing else.
 */
const INVISIBLE = /[\u200B\u2060\uFEFF\u00AD]/gu;
const JOINER = /[\u200C\u200D]/gu;
/**
 * Punctuation and separators alone carry nothing, so a block made only of
 * them is chrome. Symbols are not included: an emoji is content a reader can
 * see, and this filter must never decide that a block is empty because its
 * script is unfamiliar.
 */
const UNINFORMATIVE_ONLY = /^[\p{P}\p{Z}\s]*$/u;

/**
 * Chrome patterns that match a whole cleaned block and nothing less.
 *
 * A prefix is not evidence of chrome. "Subscribe" alone is a button, but
 * "Subscribe to a service only after comparing its cancellation policy" is a
 * sentence about subscribing, and a pattern anchored only at the start
 * deletes the second along with the first. Every entry here is anchored at
 * both ends; labels that legitimately carry a short payload live in
 * CHROME_LABELLED below, where a length bound stands in for the missing end
 * anchor. Anything not proven to be chrome stays a candidate and is ranked.
 */
const CHROME: readonly RegExp[] = [
  /^primary image$/u,
  /^(?:advertisement|advertising|sponsored)$/u,
  /^(?:广告|廣告|赞助|贊助|推广|推廣)$/u,
  /^(?:read more|learn more|continue reading|see also|related articles?|related posts?)$/u,
  /^(?:阅读更多|閱讀更多|展开全文|展開全文|更多内容|更多內容|相关阅读|相關閱讀)$/u,
  /^(?:关注我们|關注我們|分享这篇文章|分享這篇文章)$/u,
  /^(?:订阅|訂閱|立即订阅|立即訂閱)(?:我们的|我們的)?(?:newsletter|电子报|電子報|周报|週報|通讯|通訊|邮件列表|郵件列表)?$/u,
];
/**
 * A label plus a short payload: "Image Credit: NASA", "Written By: <name>".
 * Only applied when the whole block is short, because past that length the
 * same opening words are how an article starts a sentence about the topic.
 */
const CHROME_LABELLED: readonly RegExp[] = [
  /^sign\s?up\b/u,
  /^subscribe\b/u,
  /^follow us\b/u,
  /^share (?:this|on|it)\b/u,
  /^(?:image|photo) credit/u,
  /^written by[:：]/u,
  /getty images$/u,
  /^(?:图片来源|圖片來源|图片版权|圖片版權)/u,
];
/** Navigation and account chrome; applied only to very short blocks. */
const NAVIGATION_CHROME: readonly RegExp[] = [
  /^(?:skip|jump) to\b/u,
  /^(?:跳至|跳到|跳過|跳过)/u,
  /^(?:sign in|log ?in|register|create an account|my account)$/u,
  /^(?:登录|登入|注册|註冊|我的账号|我的帳號)$/u,
  /^(?:return to|back to|go to)\b/u,
  /^(?:返回|回到)/u,
  /^(?:body|home|menu|search|next|previous|share|print)$/u,
  /^(?:首页|首頁|目录|目錄|搜索|搜尋|列印|打印)$/u,
];
/** A block that is only a date is a byline, not an explanation. */
const DATE_ONLY: readonly RegExp[] = [
  /^\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?$/u,
  /^\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{2,4}$/u,
  /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}$/iu,
  /^\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december),?\s+\d{4}$/iu,
];

/** True when the whole block is site chrome rather than page content. */
export function isChromeBlock(text: string): boolean {
  const value = text.replace(INVISIBLE, "").trim();
  if (value === "" || UNINFORMATIVE_ONLY.test(value.replace(JOINER, ""))) return true;
  const folded = value.normalize("NFKC").toLowerCase();
  if (CHROME.some((pattern) => pattern.test(folded))) return true;
  if (DATE_ONLY.some((pattern) => pattern.test(folded))) return true;
  const length = [...folded].length;
  if (length <= CHROME_LABEL_MAX && CHROME_LABELLED.some((pattern) => pattern.test(folded))) return true;
  return (
    length <= NAVIGATION_TEXT_MAX &&
    NAVIGATION_CHROME.some((pattern) => pattern.test(folded))
  );
}

interface Candidate {
  readonly segment: ResearchSegment;
  readonly order: number;
  readonly length: number;
}

function normalizeText(text: string): string {
  return text.replace(INVISIBLE, "").replace(/\s+/gu, " ").trim();
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
  let excluded: {
    readonly level: number;
    readonly scope: HtmlNode | null;
  } | null = null;
  const stack: NodeVisit[] = $.root()
    .toArray()
    .map((node) => ({ node, exiting: false }));
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
      if (
        excluded !== null &&
        node.parent === excluded.scope &&
        level <= excluded.level
      )
        excluded = null;
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
      for (const child of [...node.children].reverse())
        stack.push({ node: child, exiting: false });
    }
  }
}

/**
 * Rank one candidate. Keyword relevance dominates; length and an associated
 * heading break ties, because a long explanation under a heading is more
 * useful to a writer than a one-line aside. Position is never a bonus: that
 * is what produced chrome-only evidence in the first place.
 */
function rank(candidate: Candidate, terms: readonly RelevanceTerm[]): number {
  const { segment, length } = candidate;
  const relevance = relevanceScore(
    segment.text,
    segment.heading?.text ?? null,
    terms,
  );
  const size =
    length >= RICH_SEGMENT_CHARS
      ? 2
      : length >= SUBSTANTIAL_SEGMENT_CHARS
        ? 1
        : length < SHORT_SEGMENT_CHARS
          ? -2
          : 0;
  return relevance * 4 + size + (segment.heading === null ? 0 : 0.5);
}

/** Highest ranked first; equal ranks keep observed order, so ties never shuffle. */
function selectSegments(
  candidates: readonly Candidate[],
  terms: readonly RelevanceTerm[],
): ResearchSegment[] {
  if (candidates.length <= RESEARCH_SEGMENTS_PER_PAGE)
    return candidates.map((item) => item.segment);
  return [...candidates]
    .map((candidate) => ({ candidate, score: rank(candidate, terms) }))
    .sort((a, b) => b.score - a.score || a.candidate.order - b.candidate.order)
    .slice(0, RESEARCH_SEGMENTS_PER_PAGE)
    .map((item) => item.candidate.segment);
}

function observeRegion(
  region: HtmlNode,
  language: string,
  terms: readonly RelevanceTerm[],
): ExtractedPageResearch {
  const candidates: Candidate[] = [];
  const mainText: string[] = [];
  let paragraph: string[] = [];
  let heading: ResearchHeading | null = null;
  // Counted separately from `candidates`, which stops growing at CANDIDATE_MAX.
  // Reporting the array's length as the number of observations would tell the
  // reader a very long page had exactly 400 paragraphs.
  let observed = 0;

  function finishParagraph(): void {
    const text = normalizeText(paragraph.join(""));
    paragraph = [];
    // Chrome is not an observation the writer could have used, so it is not
    // counted as an omitted candidate either; `length` still measures it.
    if (text === "" || isChromeBlock(text)) return;
    observed += 1;
    if (candidates.length >= CANDIDATE_MAX) return;
    const characters = Array.from(text);
    candidates.push({
      segment: {
        heading,
        text: characters.slice(0, RESEARCH_SEGMENT_MAX_CHARS).join(""),
        truncated: characters.length > RESEARCH_SEGMENT_MAX_CHARS,
      },
      order: candidates.length,
      length: characters.length,
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
        heading =
          text === ""
            ? null
            : {
                level: node.name,
                text: Array.from(text)
                  .slice(0, RESEARCH_HEADING_MAX_CHARS)
                  .join(""),
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
    for (const child of [...node.children].reverse())
      stack.push({ node: child, exiting: false });
  }

  finishParagraph();
  const segments = selectSegments(candidates, terms);
  return {
    segments,
    segments_total: observed,
    omitted_segments: observed - segments.length,
    // All cleaned main text, including headings and omitted/unbounded prose.
    // This describes observed input only; HTTP body_complete belongs to the caller.
    length: measureResearchLength(normalizeText(mainText.join("")), language),
  };
}

/**
 * Local HTML parsing only; never executes scripts or fetches referenced resources.
 * Returned strings are text, not HTML: literal < and > in visible source text are
 * preserved and must remain text/untrusted data in every downstream consumer.
 *
 * `keywords` only ranks which observed excerpts survive the per-page ceiling;
 * it never rewrites, filters by topic, or invents source text.
 */
export function extractContentBriefResearch(
  html: string,
  language: string,
  keywords: readonly string[] = [],
): ExtractedPageResearch {
  const $ = load(html);
  $(NON_PROSE).remove();
  $("[aria-hidden]")
    .filter(
      (_, node) => $(node).attr("aria-hidden")?.trim().toLowerCase() === "true",
    )
    .remove();
  $("[style]")
    .filter((_, node) => HIDDEN_STYLE.test($(node).attr("style") ?? ""))
    .remove();
  $("br").replaceWith(" ");
  removeTemplateSections($);
  const terms = relevanceTerms(keywords);

  for (const selector of ["main", "article", "body"]) {
    for (const region of $(selector).toArray()) {
      const research = observeRegion(region, language, terms);
      if (research.segments_total > 0 || selector === "body") return research;
    }
  }
  return {
    segments: [],
    segments_total: 0,
    omitted_segments: 0,
    length: measureResearchLength("", language),
  };
}
