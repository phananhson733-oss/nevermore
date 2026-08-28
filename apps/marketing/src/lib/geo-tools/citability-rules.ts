// @input  -- one fetched page, its robots.txt and llms.txt outcomes, and an optional target question
// @output -- fourteen checks, six of them counted toward the readable conclusion, five toward the extractable one
// @pos    -- the whole judgement of the page-citability tool; no network, no model, no locale strings

import { parseRobots, matchRobotsRule } from "@sf/sources/crawl-robots";

import {
  citabilityCheck,
  summarizeCitability,
  CITABILITY_LEAD_ANSWER_CHARS,
  CITABILITY_LIST_LINK_DENSITY_MAX,
  CITABILITY_MIN_LIST_ITEMS,
  CITABILITY_RETRIEVAL_BOTS,
  CITABILITY_SCRIPT_DOMINANCE,
  CITABILITY_TEXT_FLOOR_CHARS,
  CITABILITY_TRAINING_BOTS,
  type CitabilityCheck,
  type CitabilityContext,
  type CitabilityInput,
  type CitabilityReport,
} from "./citability-contract.ts";
import {
  buildCitabilityContext,
  containsTerm,
  LINK_MARKER,
  splitSentences,
} from "./citability-text.ts";

/**
 * Conclusion markers, matched as whole words.
 *
 * `head.includes("is")` is satisfied by "this", "history" and "basis"; a rule
 * that claims a page states a conclusion has to mean something more than
 * "contains the letters i and s".
 */
const LATIN_CONCLUSION_MARKERS = [
  "is",
  "are",
  "was",
  "should",
  "best",
  "choose",
  "pick",
  "recommend",
  "recommended",
  "use",
  "prefer",
  "avoid",
  "yes",
  "no",
];

const CJK_CONCLUSION_MARKERS = [
  "建议",
  "适合",
  "应该",
  "选择",
  "推荐",
  "答案",
  "结论",
  "可以",
  "不要",
];

/**
 * Quantified conditions, split by script.
 *
 * `\b` is an ASCII word boundary, so a pattern written as `\b(至少|不超过)`
 * never matches a Chinese sentence that starts with the phrase. A four-digit
 * range is excluded because "2020-2026" is a date, and counting it as a
 * qualified condition is how a page passes this rule by having a copyright
 * line.
 */
const YEAR_RANGE = /(?:19|20)\d{2}\s*[-–—~至]\s*(?:19|20)\d{2}/;
const LATIN_QUANTIFIERS = [
  /\b\d+\s*[-–—~]\s*\d+\b/,
  /\b(?:under|over|above|below|at least|up to|fewer than|more than)\s+\$?\d/i,
  /\b\d+\s*(?:people|users|seats|members|employees|hours|days)\b/i,
];
const CJK_QUANTIFIERS = [
  /(?:至少|最多|不超过|少于|多于|超过|以上|以下)\s*\d/,
  /\d+\s*(?:人|名|位|天|小时|个月|年)(?:以内|以上|以下|团队|规模)?/,
];

/** Words that make a number's source explicit when no link is nearby. */
const SOURCE_MARKERS = [
  "来源",
  "数据来源",
  "引自",
  "据",
  "参见",
  "source:",
  "sources:",
  "according to",
  "via ",
  "cited",
];

function robotsPath(url: string): string {
  const parsed = new URL(url);
  // robots.txt matching is defined over the path *and* query: a rule written
  // as `Disallow: /*?` is about parameterised URLs and cannot be evaluated
  // against a bare pathname.
  return `${parsed.pathname}${parsed.search}`;
}

function botCheck(
  input: CitabilityInput,
  bot: string,
  weight: "counted" | "advisory",
): CitabilityCheck {
  const ruleId = `robots.${bot.toLowerCase()}`;
  const section = "readable" as const;
  const kind = "deterministic" as const;

  if (input.robots.status === "absent") {
    // RFC 9309 2.3.1.3: an unavailable-by-404 robots.txt grants full access.
    // Reporting that as a failed check is the "cannot read it" and "it is not
    // there" collapse this tool exists to avoid.
    return citabilityCheck(ruleId, section, kind, weight, "pass", {
      key: "robots.absent",
      values: { bot, status: input.robots.httpStatus },
    });
  }
  if (input.robots.status === "unreachable") {
    return citabilityCheck(ruleId, section, kind, weight, "fetchError", {
      key: "robots.unreachable",
      values: { bot, status: input.robots.httpStatus ?? 0 },
    });
  }

  const path = robotsPath(input.finalUrl);
  const { groups } = parseRobots(
    input.robots.text,
    new URL(input.finalUrl).origin,
    true,
  );
  const decision = matchRobotsRule(groups, bot, path);
  if (decision.allowed) {
    return citabilityCheck(ruleId, section, kind, weight, "pass", {
      key: decision.pattern ? "robots.allowedByRule" : "robots.allowedNoRule",
      values: { bot, path, pattern: decision.pattern ?? "" },
    });
  }
  return citabilityCheck(
    ruleId,
    section,
    kind,
    weight,
    "fail",
    {
      key: "robots.disallowed",
      values: { bot, path, pattern: decision.pattern ?? "" },
    },
    { key: "robots.disallowed", values: { bot, pattern: decision.pattern ?? "" } },
  );
}

function ssrCheck(context: CitabilityContext): CitabilityCheck {
  const chars = context.textChars;
  if (chars >= CITABILITY_TEXT_FLOOR_CHARS) {
    return citabilityCheck(
      "ssr",
      "readable",
      "deterministic",
      "counted",
      "pass",
      { key: "ssr.sufficient", values: { chars, floor: CITABILITY_TEXT_FLOOR_CHARS } },
    );
  }
  const scriptDominant =
    context.scriptBytes > Math.max(1, chars) * CITABILITY_SCRIPT_DOMINANCE;
  // Both branches fail, and they fail for different reasons with different
  // fixes. Neither one infers a served/rendered ratio: this tool does not
  // execute JavaScript, so it has no rendered side to compare against and
  // will not manufacture a ratio of 1 for a page it could not read.
  return scriptDominant
    ? citabilityCheck(
        "ssr",
        "readable",
        "deterministic",
        "counted",
        "fail",
        {
          key: "ssr.clientRendered",
          values: {
            chars,
            floor: CITABILITY_TEXT_FLOOR_CHARS,
            scriptKb: Math.round(context.scriptBytes / 1024),
          },
        },
        { key: "ssr.clientRendered" },
      )
    : citabilityCheck(
        "ssr",
        "readable",
        "deterministic",
        "counted",
        "fail",
        {
          key: "ssr.thin",
          values: { chars, floor: CITABILITY_TEXT_FLOOR_CHARS },
        },
        { key: "ssr.thin" },
      );
}

/** Every `<link>` element, parsed without depending on attribute order. */
function canonicalHref(html: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = /\srel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1] ?? "";
    if (
      !rel
        .split(/\s+/)
        .some((token) => token.trim().toLowerCase() === "canonical")
    ) {
      continue;
    }
    const href = /\shref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (href !== undefined) return href;
    const bare = /\shref\s*=\s*([^\s"'>]+)/i.exec(tag)?.[1];
    if (bare !== undefined) return bare;
    return "";
  }
  return null;
}

function canonicalCheck(input: CitabilityInput): CitabilityCheck {
  const id = "canonical";
  const href = canonicalHref(input.rawHtml);
  if (href === null) {
    return citabilityCheck(
      id,
      "readable",
      "deterministic",
      "counted",
      "fail",
      { key: "canonical.missing" },
      { key: "canonical.missing" },
    );
  }
  let resolved: URL;
  try {
    resolved = new URL(href, input.finalUrl);
  } catch {
    return citabilityCheck(
      id,
      "readable",
      "deterministic",
      "counted",
      "fail",
      { key: "canonical.unparsable", values: { value: href.slice(0, 120) } },
      { key: "canonical.unparsable" },
    );
  }
  const self = new URL(input.finalUrl);
  const same =
    resolved.origin === self.origin &&
    resolved.pathname === self.pathname &&
    resolved.search === self.search;
  return same
    ? citabilityCheck(id, "readable", "deterministic", "counted", "pass", {
        key: "canonical.self",
      })
    : citabilityCheck(
        id,
        "readable",
        "deterministic",
        "counted",
        "fail",
        { key: "canonical.other", values: { href: resolved.href } },
        // Narrower than it looks: this tool never fetches the canonical target,
        // so it does not claim the target is reachable or free of redirects.
        // It says only that an answer built from this page is being pointed
        // somewhere else.
        { key: "canonical.other", values: { href: resolved.href } },
      );
}

function llmsTxtCheck(input: CitabilityInput): CitabilityCheck {
  const id = "llmsTxt";
  if (input.llmsTxt.status === "ok") {
    // "Present, and this many bytes." Not "valid": this tool does not parse
    // the file, and a 200 that returns an HTML error page would otherwise be
    // reported as a working llms.txt.
    return citabilityCheck(id, "readable", "deterministic", "advisory", "pass", {
      key: "llms.present",
      values: { bytes: input.llmsTxt.bytes },
    });
  }
  if (input.llmsTxt.status === "absent") {
    return citabilityCheck(
      id,
      "readable",
      "deterministic",
      "advisory",
      "fail",
      { key: "llms.absent", values: { status: input.llmsTxt.httpStatus } },
      { key: "llms.absent" },
    );
  }
  return citabilityCheck(id, "readable", "deterministic", "advisory", "fetchError", {
    key: "llms.unreachable",
    values: { status: input.llmsTxt.httpStatus ?? 0 },
  });
}

function leadAnswerCheck(
  input: CitabilityInput,
  context: CitabilityContext,
): CitabilityCheck {
  const id = "leadAnswer";
  if (!input.targetQuestion || context.questionTerms.length === 0) {
    // Nothing was asked, so there is nothing to be right or wrong about. This
    // is not a fetch failure and it does not belong in the denominator.
    return citabilityCheck(
      id,
      "extractable",
      "heuristic",
      "counted",
      "notApplicable",
      { key: "leadAnswer.notAsked" },
    );
  }
  const head = context.text.slice(0, CITABILITY_LEAD_ANSWER_CHARS);
  const matchedTerms = context.questionTerms.filter((term) =>
    containsTerm(head, term),
  );
  const hasMarker =
    LATIN_CONCLUSION_MARKERS.some((marker) => containsTerm(head, marker)) ||
    CJK_CONCLUSION_MARKERS.some((marker) => head.includes(marker));

  if (matchedTerms.length > 0 && hasMarker) {
    return citabilityCheck(
      id,
      "extractable",
      "heuristic",
      "counted",
      "pass",
      {
        key: "leadAnswer.ok",
        values: {
          window: CITABILITY_LEAD_ANSWER_CHARS,
          matched: matchedTerms.join(", "),
        },
      },
    );
  }
  const key =
    matchedTerms.length === 0 && !hasMarker
      ? "leadAnswer.neither"
      : matchedTerms.length === 0
        ? "leadAnswer.noTerms"
        : "leadAnswer.noMarker";
  return citabilityCheck(
    id,
    "extractable",
    "heuristic",
    "counted",
    "fail",
    {
      key,
      values: {
        window: CITABILITY_LEAD_ANSWER_CHARS,
        terms: context.questionTerms.join(", "),
      },
    },
    { key: "leadAnswer" },
  );
}

/** A table with at least one real cell, not a layout wrapper or an empty shell. */
function countRealTables(html: string): number {
  let count = 0;
  for (const match of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const block = match[0];
    if (!/<t[dh]\b/i.test(block)) continue;
    const text = block.replace(/<[^>]+>/g, " ").trim();
    if (text.length === 0) continue;
    count += 1;
  }
  return count;
}

function countContentLists(html: string): number {
  let count = 0;
  for (const match of html.matchAll(/<(ul|ol)\b[\s\S]*?<\/\1>/gi)) {
    const block = match[0];
    const items = [...block.matchAll(/<li\b[\s\S]*?<\/li>/gi)];
    const withText = items.filter(
      (item) => item[0].replace(/<[^>]+>/g, " ").trim().length > 0,
    );
    if (withText.length < CITABILITY_MIN_LIST_ITEMS) continue;
    const linked = withText.filter((item) => /<a\b/i.test(item[0])).length;
    if (linked / withText.length >= CITABILITY_LIST_LINK_DENSITY_MAX) continue;
    count += 1;
  }
  return count;
}

function structureCheck(input: CitabilityInput): CitabilityCheck {
  const tables = countRealTables(input.rawHtml);
  const lists = countContentLists(input.rawHtml);
  const found = tables + lists > 0;
  return found
    ? citabilityCheck(
        "extractableStructure",
        "extractable",
        "deterministic",
        "counted",
        "pass",
        { key: "structure.ok", values: { tables, lists } },
      )
    : citabilityCheck(
        "extractableStructure",
        "extractable",
        "deterministic",
        "counted",
        "fail",
        { key: "structure.none", values: { minItems: CITABILITY_MIN_LIST_ITEMS } },
        { key: "structure.none", values: { minItems: CITABILITY_MIN_LIST_ITEMS } },
      );
}

function qualifiersCheck(context: CitabilityContext): CitabilityCheck {
  const withoutYears = context.text.replace(new RegExp(YEAR_RANGE, "g"), " ");
  const hit =
    LATIN_QUANTIFIERS.some((pattern) => pattern.test(withoutYears)) ||
    CJK_QUANTIFIERS.some((pattern) => pattern.test(withoutYears));
  return hit
    ? citabilityCheck(
        "qualifiers",
        "extractable",
        "heuristic",
        "counted",
        "pass",
        { key: "qualifiers.ok" },
      )
    : citabilityCheck(
        "qualifiers",
        "extractable",
        "heuristic",
        "counted",
        "fail",
        { key: "qualifiers.none" },
        { key: "qualifiers.none" },
      );
}

function isNumericClaim(sentence: string): boolean {
  if (!/\d/.test(sentence)) return false;
  // A bare number, a date or a lone year is not a claim that needs a source.
  const stripped = sentence.replace(/\s+/g, "");
  if (/^\d+$/.test(stripped)) return false;
  const withoutDates = sentence
    .replace(/(?:19|20)\d{2}\s*[-–—~至]\s*(?:19|20)\d{2}/g, " ")
    .replace(/(?:19|20)\d{2}\s*年?/g, " ")
    .replace(/\d{1,2}[:：]\d{2}/g, " ");
  return /\d/.test(withoutDates);
}

function isSourced(sentence: string): boolean {
  if (sentence.includes(LINK_MARKER)) return true;
  const lower = sentence.toLowerCase();
  return SOURCE_MARKERS.some((marker) => lower.includes(marker));
}

function citedDataCheck(context: CitabilityContext): CitabilityCheck {
  const id = "citedData";
  const sentences = splitSentences(context.textWithLinkMarkers);
  const numeric = sentences.filter(isNumericClaim);
  if (numeric.length === 0) {
    // No numbers means nothing to attribute. Passing this would credit a page
    // for a discipline it never had to exercise.
    return citabilityCheck(
      id,
      "extractable",
      "deterministic",
      "counted",
      "notApplicable",
      { key: "citedData.noNumbers" },
    );
  }
  const unsourced = numeric.filter((sentence) => !isSourced(sentence));
  if (unsourced.length === 0) {
    return citabilityCheck(
      id,
      "extractable",
      "deterministic",
      "counted",
      "pass",
      { key: "citedData.allSourced", values: { total: numeric.length } },
    );
  }
  return citabilityCheck(
    id,
    "extractable",
    "deterministic",
    "counted",
    "fail",
    {
      key: "citedData.unsourced",
      values: {
        unsourced: unsourced.length,
        total: numeric.length,
        sample: unsourced[0]!.slice(0, 80),
      },
    },
    { key: "citedData.unsourced" },
  );
}

interface JsonLdWalk {
  readonly faqNodes: readonly Record<string, unknown>[];
  readonly brokenBlocks: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeIncludes(node: Record<string, unknown>, type: string): boolean {
  const declared = node["@type"];
  if (typeof declared === "string") return declared === type;
  if (Array.isArray(declared)) {
    return declared.some((entry) => entry === type);
  }
  return false;
}

/** Walk arrays and `@graph`, and let one broken block not hide a valid one. */
function walkJsonLd(html: string): JsonLdWalk {
  const faqNodes: Record<string, unknown>[] = [];
  let brokenBlocks = 0;
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1] ?? "");
    } catch {
      brokenBlocks += 1;
      continue;
    }
    const queue: unknown[] = [parsed];
    while (queue.length > 0) {
      const node = queue.pop();
      if (Array.isArray(node)) {
        queue.push(...node);
        continue;
      }
      if (!isRecord(node)) continue;
      if (typeIncludes(node, "FAQPage")) faqNodes.push(node);
      const graph = node["@graph"];
      if (Array.isArray(graph)) queue.push(...graph);
    }
  }
  return { faqNodes, brokenBlocks };
}

function faqCheck(input: CitabilityInput): CitabilityCheck {
  const id = "faqSchema";
  const { faqNodes, brokenBlocks } = walkJsonLd(input.rawHtml);
  if (faqNodes.length === 0) {
    // A page with no FAQ markup is not a broken page. Scoring the absence
    // would push every explainer toward markup it may have no use for.
    return citabilityCheck(
      id,
      "extractable",
      "deterministic",
      "counted",
      "notApplicable",
      {
        key: brokenBlocks > 0 ? "faq.noneWithBroken" : "faq.none",
        values: { broken: brokenBlocks },
      },
    );
  }
  const questions = faqNodes.flatMap((node) => {
    const mainEntity = node["mainEntity"];
    return Array.isArray(mainEntity) ? mainEntity : [];
  });
  if (questions.length === 0) {
    return citabilityCheck(
      id,
      "extractable",
      "deterministic",
      "counted",
      "fail",
      { key: "faq.emptyMainEntity" },
      { key: "faq.emptyMainEntity" },
    );
  }
  const incomplete = questions.filter((entry) => {
    if (!isRecord(entry)) return true;
    const name = entry["name"];
    const answer = entry["acceptedAnswer"];
    const answerText = isRecord(answer) ? answer["text"] : undefined;
    return (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      typeof answerText !== "string" ||
      answerText.trim().length === 0
    );
  });
  return incomplete.length === 0
    ? citabilityCheck(
        id,
        "extractable",
        "deterministic",
        "counted",
        "pass",
        { key: "faq.valid", values: { count: questions.length } },
      )
    : citabilityCheck(
        id,
        "extractable",
        "deterministic",
        "counted",
        "fail",
        {
          key: "faq.incomplete",
          values: { incomplete: incomplete.length, total: questions.length },
        },
        { key: "faq.incomplete" },
      );
}

/** Limits this tool states up front, rendered with every report. */
export const CITABILITY_LIMITS = [
  "noJavaScript",
  "onePage",
  "noRanking",
  "advisoryRows",
] as const;

export function runCitabilityChecks(
  input: CitabilityInput,
): readonly CitabilityCheck[] {
  const context = buildCitabilityContext(input.rawHtml, input.targetQuestion);
  return [
    ...CITABILITY_RETRIEVAL_BOTS.map((bot) => botCheck(input, bot, "counted")),
    ssrCheck(context),
    canonicalCheck(input),
    ...CITABILITY_TRAINING_BOTS.map((bot) => botCheck(input, bot, "advisory")),
    llmsTxtCheck(input),
    leadAnswerCheck(input, context),
    structureCheck(input),
    qualifiersCheck(context),
    citedDataCheck(context),
    faqCheck(input),
  ];
}

export function buildCitabilityReport(
  input: CitabilityInput,
  fetchedAt: string,
): CitabilityReport {
  const context = buildCitabilityContext(input.rawHtml, input.targetQuestion);
  const checks = runCitabilityChecks(input);
  return {
    url: input.url,
    finalUrl: input.finalUrl,
    targetQuestion: input.targetQuestion,
    questionTerms: context.questionTerms,
    fetchedAt,
    textChars: context.textChars,
    checks,
    summary: summarizeCitability(checks),
    limits: [...CITABILITY_LIMITS],
  };
}
