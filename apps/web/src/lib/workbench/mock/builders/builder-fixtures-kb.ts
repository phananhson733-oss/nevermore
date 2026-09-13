/**
 * Test-only literals and checkers for the Task 12 builder tests (knowledge
 * base, visibility, links). Hand-built like `builder-fixtures.ts`: the builders
 * must not depend on what `seedKb` / `mockVisibility` / `mockLinks` happen to
 * produce, so nothing here calls them.
 */
import type { KbEntry, LinkTarget, VisResult } from "../../types.ts";
import type { VisGap } from "../visibility.ts";
import {
  DOC_HOSTILE_VALUES,
  type HostileValue,
  docViolations,
} from "./hostile-fixtures.ts";

/** Two definitions, written and blank slots, blank-looking evidence, and FAQ entries with and without a usable `→`. */
export const FIXTURE_KB_ENTRIES: readonly KbEntry[] = [
  {
    id: "kb-01",
    cat: "definition",
    statement: "Acme 是给小团队用的 SEO 检查工具",
    evidence: "来自站点档案字段",
    source: "",
    from: "manual",
  },
  {
    id: "kb-02",
    cat: "capability",
    statement: "Acme 提供 站点审计",
    evidence: "",
    source: "https://acme.io/features",
    from: "manual",
  },
  {
    id: "kb-03",
    cat: "boundary",
    statement: "",
    evidence: "",
    source: "",
    from: "gap",
  },
  {
    id: "kb-04",
    cat: "pricing",
    statement: "  ",
    evidence: "示例，未核对",
    source: " ",
    from: "gap",
  },
  {
    id: "kb-05",
    cat: "faq",
    statement: "Acme 支持中文站吗 → 支持 → 需要先填市场",
    evidence: "示例，未核对",
    source: "",
    from: "aiDraft",
  },
  {
    id: "kb-06",
    cat: "faq",
    statement: "  → 没有问题的答案",
    evidence: "",
    source: "",
    from: "aiDraft",
  },
  {
    id: "kb-07",
    cat: "faq",
    statement: "没有箭头的问题",
    evidence: "",
    source: "",
    from: "aiDraft",
  },
  {
    id: "kb-08",
    cat: "definition",
    statement: "Acme 是第二条定义",
    evidence: " ",
    source: "",
    from: "manual",
  },
];

export const FIXTURE_VIS_RESULTS: readonly VisResult[] = [
  {
    p: "best seo tools",
    platform: "ChatGPT",
    hit: true,
    rank: 2,
    brands: ["Rival", "Acme"],
    domains: ["g2.com", "reddit.com", "medium.com"],
    real: false,
  },
  {
    p: "best seo tools",
    platform: "Perplexity",
    hit: false,
    rank: null,
    brands: ["Rival", "Other"],
    domains: ["capterra.com", "g2.com", "producthunt.com"],
    real: false,
  },
];

export const FIXTURE_GAPS: readonly VisGap[] = [
  {
    p: "best seo tools",
    missedPlatforms: ["Perplexity", "Gemini"],
    rivals: ["Rival", "Other"],
  },
  { p: "acme vs rival", missedPlatforms: ["Claude"], rivals: [] },
];

/** A repeated type and a channel without a domain. */
export const FIXTURE_TARGETS: readonly LinkTarget[] = [
  {
    type: "dir",
    site: "Product Hunt",
    domain: "producthunt.com",
    dr: 91,
    relevance: "high",
    difficulty: "high",
    action: "提交产品页",
    asset: "产品截图与一句话介绍",
  },
  {
    type: "dir",
    site: "SaaSHub",
    domain: "saashub.com",
    dr: 72,
    relevance: "mid",
    difficulty: "low",
    action: "提交收录申请",
    asset: "产品描述与分类",
  },
  {
    type: "media",
    site: "行业播客",
    domain: "",
    dr: 58,
    relevance: "mid",
    difficulty: "low",
    action: "联系主持人提选题",
    asset: "可分享的使用数据",
  },
];

function patchAt<T>(
  items: readonly T[],
  index: number,
  patch: Partial<T>,
): readonly T[] {
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

export function withEntry(
  entries: readonly KbEntry[],
  index: number,
  patch: Partial<KbEntry>,
): readonly KbEntry[] {
  return patchAt(entries, index, patch);
}

export function withGap(
  gaps: readonly VisGap[],
  index: number,
  patch: Partial<VisGap>,
): readonly VisGap[] {
  return patchAt(gaps, index, patch);
}

export function withTarget(
  targets: readonly LinkTarget[],
  index: number,
  patch: Partial<LinkTarget>,
): readonly LinkTarget[] {
  return patchAt(targets, index, patch);
}

/** Document hostile values plus one that tries to start a list item, a quote and a numbered step on new lines. */
export const KB_DOC_HOSTILE_VALUES: readonly HostileValue[] = [
  ...DOC_HOSTILE_VALUES,
  {
    name: "list, quote and step after newlines",
    value: "x\n- 伪条目\n> 伪引用\n1. 伪步骤",
    markers: [],
  },
];

/** A line-start bullet, ordered-list number or blockquote marker. */
const BLOCK_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)]|>)(?:[ \t]|$)/;

export function blockMarkerLines(doc: string): readonly string[] {
  return doc.split(/\r\n|\r|\n/).filter((line) => BLOCK_MARKER.test(line));
}

/** `docViolations` plus: the hostile document has as many line-start list / quote markers as the baseline. */
export function markdownViolations(
  doc: string,
  baseline: string,
  hostile: HostileValue,
): readonly string[] {
  const got = blockMarkerLines(doc).length;
  const want = blockMarkerLines(baseline).length;
  const markers = got === want ? [] : [`block marker lines ${want} -> ${got}`];
  return [...docViolations(doc, baseline, hostile), ...markers];
}
