/**
 * Knowledge-base artifacts (plan Task 12; jsx:776-845). Bodies are unstamped
 * (R5). `kbMarkdown` and `llmsTxt` are documents, not prompts: every user or AI
 * value is folded onto one line with its tag-shaped `<` encoded (`inlineText`);
 * a value that starts a line's content (right
 * after `- ` or `> `) also goes through `docText`, so it cannot open a heading,
 * fence, quote, list, rule, HTML block, link definition or task box there (R6).
 * `llmsTxt` names no page it has not seen: the home page plus a placeholder
 * (R10). `kbJsonLd` is JSON, so `JSON.stringify` does the escaping.
 */
import { KB_CATEGORIES } from "../../enums.ts";
import type { KbCategory, KbEntry, Profile } from "../../types.ts";
import { KB_SECTION_TITLE_ZH } from "../labels-zh.ts";
import { domainOf, oneLine } from "../text.ts";
import { docText, headingText, inlineText, joinParts } from "./compose.ts";

export interface KbInput {
  readonly profile: Profile;
  readonly entries: readonly KbEntry[];
}

const BRAND_PLACEHOLDER = "[品牌]";
const FAQ_SEPARATOR = "→";

function brandText(brand: string): string {
  return inlineText(brand) || BRAND_PLACEHOLDER;
}

function isWritten(entry: KbEntry): boolean {
  return oneLine(entry.statement) !== "";
}

/** Entries of one category that have a statement, in their original order. */
function writtenOf(
  entries: readonly KbEntry[],
  cat: KbCategory,
): readonly KbEntry[] {
  return entries.filter((entry) => entry.cat === cat && isWritten(entry));
}

function kbLine(entry: KbEntry): string {
  const evidence = inlineText(entry.evidence);
  const source = inlineText(entry.source);
  return [
    `- ${docText(entry.statement)}`,
    evidence === "" ? "｜[待补证据]" : `｜证据：${evidence}`,
    source === "" ? "" : `｜来源：${source}`,
  ].join("");
}

function kbSection(entries: readonly KbEntry[], cat: KbCategory): string {
  const title = KB_SECTION_TITLE_ZH[cat];
  const written = writtenOf(entries, cat);
  const lines =
    written.length === 0 ? [`- [缺口：补一句 ${title}]`] : written.map(kbLine);
  return [`## ${title}`, ...lines].join("\n");
}

const MAINTENANCE_RULES = [
  "## 维护规则",
  "- 每条事实必须能在站内某个 URL 上找到原句",
  "- 带数字的事实标注核对日期",
  "- 每季度复核一次，过期的先删再补",
].join("\n");

export function kbMarkdown({ profile, entries }: KbInput): string {
  const written = entries.filter(isWritten).length;
  return joinParts([
    `# ${brandText(profile.brand)} 事实知识库`,
    [
      "> 每条都是可被模型整段摘走的句子。改完同步到 /llms.txt、About、定价页与 FAQ。",
      `> 站点：${inlineText(profile.url)}｜市场：${inlineText(profile.market)}｜条目 ${entries.length} 条，已写 ${written} 条`,
    ].join("\n"),
    ...KB_CATEGORIES.map((cat) => kbSection(entries, cat)),
    MAINTENANCE_RULES,
  ]);
}

/** A `## title` llms.txt section listing the written statements of `cat`, or `fallback` when there are none. */
function llmsSection(
  title: string,
  entries: readonly KbEntry[],
  cat: KbCategory,
  fallback: string,
): string {
  const lines = writtenOf(entries, cat).map(
    (entry) => `- ${docText(entry.statement)}`,
  );
  return [`## ${title}`, ...(lines.length === 0 ? [fallback] : lines)].join(
    "\n",
  );
}

export function llmsTxt({ profile, entries }: KbInput): string {
  const domain = inlineText(domainOf(profile.url));
  const summary = docText(profile.positioning);
  const url = docText(profile.url);
  const brand = docText(profile.brand) || BRAND_PLACEHOLDER;
  return joinParts([
    // The host ends the heading line: a `#` run closing it must stay text.
    `# ${headingText(domainOf(profile.url)) || "[站点域名]"}`,
    summary === "" ? null : `> ${summary}`,
    llmsSection("About", entries, "definition", `- ${brand} 是[补定义]`),
    llmsSection("Capabilities", entries, "capability", "- [补功能]"),
    llmsSection("Not a fit for", entries, "boundary", "- [补边界]"),
    llmsSection("Pricing", entries, "pricing", "- [补定价事实]"),
    llmsSection("Compared to alternatives", entries, "comparison", "- [补对比事实]"),
    [
      "## Key pages",
      domain === "" ? "- [补站点首页 URL]" : `- https://${domain}/`,
      "- [补关键页 URL：定价 / 文档 / 对比]",
    ].join("\n"),
    ["## Contact", url === "" ? "- [补站点 URL]" : `- ${url}`].join("\n"),
  ]);
}

interface FaqPair {
  readonly question: string;
  readonly answer: string;
}

/** Splits at the first arrow only, so an answer may contain more arrows; a blank question is no FAQ. */
function faqPair(statement: string): FaqPair | null {
  const at = statement.indexOf(FAQ_SEPARATOR);
  if (at < 0) return null;
  const question = statement.slice(0, at).trim();
  const answer = statement.slice(at + FAQ_SEPARATOR.length).trim();
  return question === "" ? null : { question, answer };
}

/**
 * One JSON-LD object with an `@graph`. The prototype returned a bare array,
 * which the json provenance stamp rejects (R5: json bodies must be objects).
 */
export function kbJsonLd({ profile, entries }: KbInput): string {
  const definition = entries.find(
    (entry) => entry.cat === "definition" && isWritten(entry),
  );
  const organization = {
    "@type": "Organization",
    name: profile.brand,
    url: profile.url,
    description: definition?.statement.trim() ?? profile.positioning,
    sameAs: [],
  };
  const questions = entries
    .filter((entry) => entry.cat === "faq")
    .map((entry) => faqPair(entry.statement))
    .filter((pair): pair is FaqPair => pair !== null)
    .map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    }));
  const graph =
    questions.length === 0
      ? [organization]
      : [organization, { "@type": "FAQPage", mainEntity: questions }];
  return JSON.stringify(
    { "@context": "https://schema.org", "@graph": graph },
    null,
    2,
  );
}
