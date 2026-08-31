// @input  -- one fetched page, its robots.txt and llms.txt outcomes, and an optional target question
// @output -- fourteen checks, five counted toward readability, five toward extraction, four advisory
// @pos    -- the whole judgement of the page-citability tool; no network, no model, no locale strings

import { parseRobots, matchRobotsRule } from "@sf/sources/crawl-robots";

import {
  citabilityCheck,
  summarizeCitability,
  CITABILITY_LEAD_ANSWER_CHARS,
  CITABILITY_LIST_LINK_DENSITY_MAX,
  CITABILITY_MIN_LIST_ITEMS,
  CITABILITY_RETRIEVAL_BOTS,
  CITABILITY_TRAINING_BOTS,
  type CitabilityCheck,
  type CitabilityContext,
  type CitabilityInput,
  type CitabilityReport,
} from "./citability-contract.ts";
import {
  bodyMarkup,
  buildCitabilityContext,
  containsTerm,
  contentMarkup,
  uncommentedMarkup,
  LINK_MARKER,
  questionCoverage,
  QUESTION_COVERAGE_FLOOR,
  splitSentences,
} from "./citability-text.ts";
import { citabilityRenderCheck } from "./citability-render-rule.ts";
import { measureCitabilityRender } from "./citability-render.ts";
import { groupCitabilityCauses } from "./citability-causes.ts";

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
/**
 * Shapes that carry digits without stating a condition.
 *
 * Stripped before the scan, because a range pattern on its own is satisfied by
 * a publication date, a phone number and an opening-hours line - so every
 * article with a dateline passed a check about qualified conditions.
 */
const NON_QUALIFYING_NUMBERS = [
  /(?:19|20)\d{2}\s*[-–—~至]\s*(?:19|20)\d{2}/g,
  /\d{4}-\d{2}-\d{2}/g,
  /\d{1,2}[:：]\d{2}(?:\s*[-–—~]\s*\d{1,2}[:：]\d{2})?/g,
  /\b\d{3,4}[-\s]\d{3,4}[-\s]\d{3,4}\b/g,
  /(?:19|20)\d{2}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?/g,
];
const LATIN_QUANTIFIERS = [
  /\b\d+\s*[-–—~]\s*\d+\s*(?:people|users|seats|members|employees|hours|days|%)\b/i,
  /\b(?:under|over|above|below|at least|up to|fewer than|more than)\s+\$?\d/i,
  /\b\d+\s*(?:people|users|seats|members|employees)\b/i,
];
const CJK_QUANTIFIERS = [
  /(?:至少|最多|不超过|少于|多于|超过)\s*\d/,
  /\d+\s*(?:人|名|位)(?:以内|以上|以下|团队|规模)?/,
  /\d+\s*(?:天|小时|个月)(?:以内|以上|以下)/,
];

/**
 * Phrases that name a source when no link is nearby.
 *
 * Whole phrases, not fragments. A bare 据 appears inside 数据, 根据, 证据 and
 * 占据, so it matched almost every Chinese page; `cited` is a substring of
 * `excited` and `solicited`. Both turned a counted check into one that passes
 * on sight.
 */
const CJK_SOURCE_MARKERS = [
  "来源",
  "数据来源",
  "引自",
  "根据",
  "据报道",
  "据统计",
  "参见",
  "出处",
];
const LATIN_SOURCE_MARKERS = [
  "source",
  "sources",
  "according",
  "reported",
  "per",
  "cited",
  "citation",
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
    { key: weight === "advisory" ? "robots.advisoryDisallowed" : "robots.disallowed", values: { bot, pattern: decision.pattern ?? "" } },
  );
}

/**
 * A conclusion of the form "the page does not have X" needs the whole page.
 *
 * With a truncated body the honest answer is that we could not read it, so
 * every negative check degrades rather than reporting an absence it cannot
 * know about.
 */
function truncated(
  input: CitabilityInput,
  ruleId: string,
  section: "readable" | "extractable",
  kind: "deterministic" | "heuristic",
): CitabilityCheck | null {
  return input.bodyComplete
    ? null
    : citabilityCheck(ruleId, section, kind, "counted", "fetchError", {
        key: "truncated",
        values: { chars: input.rawHtml.length },
      });
}

/** The document's `<base href>`, which relative links resolve against. */
function baseHref(markup: string): string | null {
  const head = markup.slice(0, headEnd(markup));
  for (const match of head.matchAll(/<base\b[^>]*>/gi)) {
    const href = /\shref\s*=\s*["']([^"']*)["']/i.exec(match[0])?.[1];
    if (href !== undefined && href.trim().length > 0) return href.trim();
  }
  return null;
}

function headEnd(markup: string): number {
  const end = markup.toLowerCase().indexOf("</head");
  return end < 0 ? markup.length : end;
}

/**
 * Every `<link>` element in the head, parsed without depending on attribute
 * order and read from markup with comments removed.
 *
 * A canonical left behind in a comment during a template migration otherwise
 * wins over the live one, and the fix text sends the owner to edit a tag the
 * page does not use.
 */
function canonicalHref(markup: string): string | null {
  const html = markup.slice(0, headEnd(markup));
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
    if (href !== undefined) return href.trim();
    const bare = /\shref\s*=\s*([^\s"'>]+)/i.exec(tag)?.[1];
    if (bare !== undefined) return bare.trim();
    // A canonical with no href at all declares nothing; treating it as
    // self-referential gave an empty tag full marks.
    return "";
  }
  return null;
}

function canonicalCheck(input: CitabilityInput): CitabilityCheck {
  const id = "canonical";
  const incomplete = truncated(input, id, "readable", "deterministic");
  if (incomplete !== null) return incomplete;
  const markup = contentMarkup(input.rawHtml);
  const href = canonicalHref(markup);
  if (href === null || href.length === 0) {
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
    const base = baseHref(markup);
    const against = base === null ? input.finalUrl : new URL(base, input.finalUrl).href;
    resolved = new URL(href, against);
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
  if (!input.targetQuestion) {
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
  if (context.questionTerms.length === 0) {
    // A question WAS asked; nothing comparable could be taken out of it.
    // "which is best?" is stop words end to end, and telling that visitor they
    // gave no target question is a sentence their own screen contradicts. Same
    // state and same denominator as above, a different sentence.
    return citabilityCheck(
      id,
      "extractable",
      "heuristic",
      "counted",
      "notApplicable",
      {
        key: "leadAnswer.noComparableTerms",
        values: { question: input.targetQuestion },
      },
    );
  }
  const head = context.text.slice(0, CITABILITY_LEAD_ANSWER_CHARS);
  // Coverage rather than "any term matched": one bigram out of nine is a
  // coincidence, and requiring the whole phrase failed every Chinese page.
  const coverage = questionCoverage(head, context.questionTerms);
  const matchedTerms =
    coverage.ratio >= QUESTION_COVERAGE_FLOOR ? coverage.matched : [];
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
    { key: "leadAnswer", values: { window: CITABILITY_LEAD_ANSWER_CHARS } },
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
  const incomplete = truncated(
    input,
    "extractableStructure",
    "extractable",
    "deterministic",
  );
  if (incomplete !== null) return incomplete;
  // Body markup: a footer's address list and an example table inside a
  // <template> are not the page's own extractable structure.
  const markup = bodyMarkup(input.rawHtml);
  const tables = countRealTables(markup);
  const lists = countContentLists(markup);
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

function qualifiersCheck(
  input: CitabilityInput,
  context: CitabilityContext,
): CitabilityCheck {
  const incomplete = truncated(input, "qualifiers", "extractable", "heuristic");
  if (incomplete !== null) return incomplete;
  const withoutYears = NON_QUALIFYING_NUMBERS.reduce(
    (text, pattern) => text.replace(pattern, " "),
    context.text,
  );
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
  // Dates are not claims that need a source. The boundaries matter: without
  // them "$1999" and "2000 companies" lose their digits to the year pattern
  // and the page is reported as making no numeric claim at all.
  const withoutDates = sentence
    .replace(/(?<![\d$£€¥])(?:19|20)\d{2}\s*[-–—~至]\s*(?:19|20)\d{2}(?![\d])/gu, " ")
    .replace(/\b(?:q[1-4]\s*)?(?<![\d$£€¥])(?:19|20)\d{2}(?![\d])\s*年?/giu, " ")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\d{1,2}[:：]\d{2}/g, " ");
  return /\d/.test(withoutDates);
}

function isSourced(sentence: string): boolean {
  if (sentence.includes(LINK_MARKER)) return true;
  if (CJK_SOURCE_MARKERS.some((marker) => sentence.includes(marker))) return true;
  return LATIN_SOURCE_MARKERS.some((marker) => containsTerm(sentence, marker));
}

function citedDataCheck(
  input: CitabilityInput,
  context: CitabilityContext,
): CitabilityCheck {
  const id = "citedData";
  const incomplete = truncated(input, id, "extractable", "deterministic");
  if (incomplete !== null) return incomplete;
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
const JSON_LD_NODE_CAP = 20_000;

function walkJsonLd(html: string): JsonLdWalk {
  const faqNodes: Record<string, unknown>[] = [];
  let brokenBlocks = 0;
  let visited = 0;
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
      // `queue.push(...node)` spreads the array into arguments, and a JSON-LD
      // array of 124,158 entries - well inside the byte budget - overflowed
      // the stack and took the whole report with it.
      if (visited >= JSON_LD_NODE_CAP) break;
      visited += 1;
      const node = queue.pop();
      if (Array.isArray(node)) {
        for (const entry of node) queue.push(entry);
        continue;
      }
      if (!isRecord(node)) continue;
      if (typeIncludes(node, "FAQPage")) faqNodes.push(node);
      const graph = node["@graph"];
      if (Array.isArray(graph)) {
        for (const entry of graph) queue.push(entry);
      }
    }
  }
  return { faqNodes, brokenBlocks };
}

function faqCheck(input: CitabilityInput): CitabilityCheck {
  const id = "faqSchema";
  const incomplete = truncated(input, id, "extractable", "deterministic");
  if (incomplete !== null) return incomplete;
  const { faqNodes, brokenBlocks } = walkJsonLd(uncommentedMarkup(input.rawHtml));
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
  const malformed = questions.filter((entry) => {
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
  return malformed.length === 0
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
          values: { incomplete: malformed.length, total: questions.length },
        },
        { key: "faq.incomplete" },
      );
}

/** Limits this tool states up front, rendered with every report. */
export const CITABILITY_LIMITS = [
  "boundedRendering",
  "onePage",
  "noRanking",
  "advisoryRows",
  "heuristicRows",
  "truncation",
] as const;

export function runCitabilityChecks(
  input: CitabilityInput,
  /** Passed by `buildCitabilityReport` so 1.5 MB is projected once, not twice. */
  provided?: CitabilityContext,
): readonly CitabilityCheck[] {
  const context =
    provided ?? buildCitabilityContext(input.rawHtml, input.targetQuestion);
  return [
    ...CITABILITY_RETRIEVAL_BOTS.map((bot) => botCheck(input, bot, "counted")),
    citabilityRenderCheck(input),
    canonicalCheck(input),
    ...CITABILITY_TRAINING_BOTS.map((bot) => botCheck(input, bot, "advisory")),
    llmsTxtCheck(input),
    leadAnswerCheck(input, context),
    structureCheck(input),
    qualifiersCheck(input, context),
    citedDataCheck(input, context),
    faqCheck(input),
  ];
}

export function buildCitabilityReport(
  input: CitabilityInput,
  fetchedAt: string,
): CitabilityReport {
  const context = buildCitabilityContext(input.rawHtml, input.targetQuestion);
  const checks = runCitabilityChecks(input, context);
  return {
    render: input.render ?? measureCitabilityRender({ url: input.finalUrl, rawHtml: input.rawHtml, bodyComplete: input.bodyComplete }, null, { reason: "not_configured", now: () => new Date(fetchedAt) }),
    rootCauses: groupCitabilityCauses(checks),
    url: input.url,
    finalUrl: input.finalUrl,
    targetQuestion: input.targetQuestion,
    questionTerms: context.questionTerms,
    fetchedAt,
    textChars: input.render?.raw.textChars ?? context.textChars,
    checks,
    summary: summarizeCitability(checks),
    limits: [...CITABILITY_LIMITS],
  };
}
