import type { QaContext } from "./context.ts";
import {
  extractAttributions,
  findUnsupportedClaims,
  resolveAny,
  resolveAttribution,
  type Attribution,
} from "./claims.ts";
import { jaccard, recall, shingles } from "./ngram.ts";
import { fail, pass, unevaluable, type QaRuleResult } from "./rule-types.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";
import {
  extractMarkdownLinks,
  extractUrls,
  isHeadingLine,
  normalizeHeading,
  paragraphBlocks,
  stripInlineCode,
  tokenize,
  truncateExcerpt,
  type DraftLine,
} from "./text.ts";

/**
 * Red lines, ported from the pinned Flow tooling's **B2B profile**.
 *
 * The profile choice is the most important decision in this file. The oracle
 * profile's RL8 forbids scientific framing outright ("research shows",
 * "evidence-based"); applied to B2B SaaS content that fails every honest
 * technical draft. The B2B profile inverts it: research MAY be cited and MUST be
 * attributed to something checkable. That inversion is the anti-fabrication
 * guard, so it is what is ported.
 *
 * Ported: RL4, RL5, RL7, RL8 (inverted), RL10, RL11, RL12 (inverted), RL13.
 * Not ported, with the cost stated rather than hidden:
 *
 * - **RL1** (clinical claims) — no medical domain; the B2B profile no-ops it.
 * - **RL2** (competitor smear) — needs approved competitor NAMES, and the frozen
 *   manifest carries competitor identifiers only. Reading names live would make
 *   the verdict depend on a mutable row, so replaying a frozen run after an
 *   operator renamed a competitor would produce different claims for the same
 *   inputs.
 * - **RL3** (SERP plagiarism) — SignalFrame holds no SERP snippet corpus, so
 *   Slice 2 has NO plagiarism detection at all.
 * - **RL6** (psychological-safety disclaimer) — oracle-domain only.
 * - **RL9** (atom-label leak) — the draft is minted by the markdown envelope,
 *   which has no atom-block scaffold to leak.
 */

export interface RedLineCheck {
  readonly id: string;
  readonly title: string;
}

/** The ported red-line vocabulary, in evaluation order. */
export const RED_LINE_CHECKS: readonly RedLineCheck[] = [
  { id: "rl4_keyword_anchor", title: "Section openers anchor on the keyword" },
  { id: "rl5_keyword_stuffing", title: "Keyword density stays under the cap" },
  { id: "rl7_banned_tokens", title: "No banned brand/author token" },
  {
    id: "rl8_unsupported_claim",
    title: "Research assertions resolve to a source",
  },
  { id: "rl10_chat_residue", title: "No conversational residue" },
  { id: "rl11_weak_verb", title: "No weak definitional verbs" },
  { id: "rl12_citation_integrity", title: "Citations resolve to a source" },
  { id: "rl12b_unresolved_link", title: "Links resolve to a source" },
  { id: "rl13_banned_jargon", title: "No AI-slop vocabulary" },
];

const CHAT_RESIDUE: readonly RegExp[] = [
  /\bas you (?:said|mentioned|noted)\b/i,
  /\byou (?:mentioned|asked|requested)\b/i,
  /\byour (?:logic|question|prompt|instructions)\b/i,
  /\bas an ai\b/i,
  /\bhere is the (?:draft|revised version) you (?:asked|requested)\b/i,
];

const WEAK_VERBS: readonly RegExp[] = [/\bis about\b/i, /\brelates to\b/i];

/**
 * RL13 banned jargon, re-derived for B2B SaaS.
 *
 * REMOVED from the ported HARD list, deliberately: `architecture`, `mechanism`,
 * `engine`, `module`, `robust`, `systemic`, `high-bandwidth`, `antenna`,
 * `rebooting`. Those are ordinary vocabulary in B2B software writing —
 * SignalFrame's own documentation uses several of them — and the original list
 * inherited them from a style guide where they read as pseudo-technical affect
 * in an astrology context. Keeping them would fail correct technical prose. This
 * note exists so the omission is not mistaken for an incomplete port and
 * "restored" later.
 *
 * What remains is AI-slop vocabulary no human B2B editor writes on purpose, and
 * even that is ADVISORY: a style preference must not gate a factual review.
 */
const HARD_JARGON: readonly RegExp[] = [
  /\bdelve\b/i,
  /\bunlock(?:s|ing|ed)?\b/i,
  /\bnavigate the landscape\b/i,
  /\brecursive\b/i,
];

const SOFT_JARGON: readonly RegExp[] = [
  /\bleverag(?:e|es|ed|ing)\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bgame[- ]chang(?:er|ing)\b/i,
  /\bin today's (?:fast-paced|digital) \w+\b/i,
];

/**
 * When does a markdown link on a line count as a CITATION rather than as
 * navigation?
 *
 * Only when the sentence ATTRIBUTES something to it. The previous cue was the
 * bare presence of any of source / report / research / study / survey /
 * benchmark / reference anywhere on the line, which are among the most common
 * nouns in B2B SaaS prose — so
 *
 *   "Read our onboarding analytics report at [the product report page](…)"
 *
 * was registered as a citation, failed to resolve against a pack that carries
 * no URLs at all, and was `blocked` with a detail calling the customer's own
 * link a fabricated source. That is a false statement about an honest draft,
 * and a gate that makes false statements is a gate operators learn to ignore.
 *
 * The frames below are the ones where a link really is being offered as
 * evidence for a claim. A link with no such frame is still checked by RL12b,
 * which reports it as unverified rather than as invented.
 */
const ATTRIBUTIVE_CITATION_CUE =
  /\b(?:according to|as (?:reported|found|shown|noted|documented) (?:by|in)|cited (?:by|in)|citations?|sources?\s*:|references?\s*:|see\s+(?:also\s+)?(?:the\s+)?(?:study|report|survey|research|analysis|benchmark|whitepaper|paper)\b|per\s+(?:a|an|the)\s|(?:study|studies|report|reports|survey|surveys|research|analysis|analyses|benchmark|whitepaper|poll)\s+(?:by|from)\b)/i;

interface Finding {
  readonly line: number;
  readonly excerpt: string;
}

function excerptList(findings: readonly Finding[]): string {
  const shown = findings.slice(0, QA_THRESHOLDS.maxReportedFindings);
  const rendered = shown
    .map(
      (finding) =>
        `line ${finding.line}: "${truncateExcerpt(finding.excerpt, QA_THRESHOLDS.maxExcerptChars)}"`,
    )
    .join("; ");
  const rest = findings.length - shown.length;
  return rest > 0 ? `${rendered}; and ${rest} more` : rendered;
}

// ---------------------------------------------------------------------------
// RL4 — keyword anchoring
// ---------------------------------------------------------------------------

/**
 * Reference lists are not in `context.body` at all any more (they are their own
 * half of the draft partition), so only the non-reference exemptions are listed
 * here.
 */
const RL4_SKIP_SECTIONS: ReadonlySet<string> = new Set([
  "faq",
  "frequently asked questions",
  "call to action",
  "take action",
  "next step",
  "next steps",
]);

/**
 * Hyphen normalization is the B2B profile's addition: `white-label` and `white
 * label` are one keyword to a reader, and treating them as different terms
 * reported drift on correctly anchored sections.
 */
function normalizeHyphens(text: string): string {
  return text.replace(/(\w)-(\w)/g, "$1 $2");
}

interface DraftSection {
  readonly title: string;
  readonly lines: readonly DraftLine[];
}

function sectionsOf(context: QaContext): readonly DraftSection[] {
  const sections: DraftSection[] = [];
  let title = "";
  let lines: DraftLine[] = [];
  for (const entry of context.body) {
    if (isHeadingLine(entry.text)) {
      if (lines.length > 0) sections.push({ title, lines });
      title = entry.text.replace(/^#{1,6}\s+/, "").trim();
      lines = [];
      continue;
    }
    lines.push(entry);
  }
  if (lines.length > 0) sections.push({ title, lines });
  return sections;
}

export function checkRl4(context: QaContext): QaRuleResult {
  if (!context.english) {
    return unevaluable(
      "rl4_keyword_anchor",
      "rl4_locale_unsupported",
      "Keyword anchoring needs word segmentation: locale not supported by deterministic segmentation.",
    );
  }
  if (context.targetKeywordTokens.length === 0) {
    return unevaluable(
      "rl4_keyword_anchor",
      "rl4_no_target_keyword",
      "The frozen cluster carried no target keyword, so section anchoring could not be judged.",
    );
  }
  const keywordTokens = tokenize(normalizeHyphens(context.targetKeyword));
  const keywordSet = new Set(keywordTokens);
  const keywordShingles = shingles(keywordTokens, QA_THRESHOLDS.rl4ShingleN);

  const drifted: Finding[] = [];
  for (const section of sectionsOf(context)) {
    if (RL4_SKIP_SECTIONS.has(normalizeHeading(section.title))) continue;
    const opener = paragraphBlocks(section.lines).find(
      (block) => block.kind === "prose",
    );
    if (!opener) continue;
    const tokens = tokenize(normalizeHyphens(opener.text));
    const tokenSet = new Set(tokens);
    const anchored =
      jaccard(tokenSet, keywordSet) >= QA_THRESHOLDS.rl4JaccardFloor ||
      jaccard(shingles(tokens, QA_THRESHOLDS.rl4ShingleN), keywordShingles) >=
        QA_THRESHOLDS.rl4ShingleFloor ||
      recall(keywordTokens, tokenSet) >= QA_THRESHOLDS.rl4TargetRecallFloor;
    if (!anchored) {
      drifted.push({
        line: opener.line,
        excerpt: section.title.length > 0 ? section.title : opener.text,
      });
    }
  }

  return drifted.length >= QA_THRESHOLDS.rl4DriftedSectionsFail
    ? fail(
        "rl4_keyword_anchor",
        "rl4_sections_drifted",
        `${drifted.length} section opener(s) do not anchor on "${context.targetKeyword}": ${excerptList(drifted)}.`,
      )
    : pass(
        "rl4_keyword_anchor",
        "rl4_anchored",
        `Section openers anchor on "${context.targetKeyword}" (${drifted.length} drifted; the tolerance is ${QA_THRESHOLDS.rl4DriftedSectionsFail}).`,
      );
}

// ---------------------------------------------------------------------------
// RL5 — keyword stuffing
// ---------------------------------------------------------------------------

export function checkRl5(context: QaContext): QaRuleResult {
  if (!context.english) {
    return unevaluable(
      "rl5_keyword_stuffing",
      "rl5_locale_unsupported",
      "Keyword density needs word segmentation: locale not supported by deterministic segmentation.",
    );
  }
  if (context.targetKeywordTokens.length === 0) {
    return unevaluable(
      "rl5_keyword_stuffing",
      "rl5_no_target_keyword",
      "The frozen cluster carried no target keyword, so keyword density could not be judged.",
    );
  }
  // Deliberately NOT hyphen-normalized, unlike RL4: folding `white-label` into
  // `white label` here would inflate the count and report stuffing the draft
  // does not contain. The asymmetry is intentional and is preserved from the
  // profile this was ported from.
  const keywordTokens = context.targetKeywordTokens;
  const draftTokens = context.draftTokens;
  let count = 0;
  for (let i = 0; i + keywordTokens.length <= draftTokens.length; i += 1) {
    let matched = true;
    for (let j = 0; j < keywordTokens.length; j += 1) {
      if (draftTokens[i + j] !== keywordTokens[j]) {
        matched = false;
        break;
      }
    }
    if (matched) count += 1;
  }
  const ceiling =
    keywordTokens.length === 1
      ? QA_THRESHOLDS.rl5SingleWordDensityCeil
      : QA_THRESHOLDS.rl5MultiWordDensityCeil;
  const densityCap = Math.floor(
    (ceiling * draftTokens.length) / keywordTokens.length,
  );
  const allowed = Math.max(QA_THRESHOLDS.rl5FlatMaxCount, densityCap);
  return count > allowed
    ? fail(
        "rl5_keyword_stuffing",
        "rl5_over_density",
        `"${context.targetKeyword}" appears ${count} times across ${draftTokens.length} words; the ceiling at this length is ${allowed}.`,
      )
    : pass(
        "rl5_keyword_stuffing",
        "rl5_within_density",
        `"${context.targetKeyword}" appears ${count} times (ceiling ${allowed}).`,
      );
}

// ---------------------------------------------------------------------------
// RL7 — banned author tokens
// ---------------------------------------------------------------------------

/**
 * Ported as a function over an EMPTY token list. SignalFrame has no author
 * persona in Slice 2, so nothing is banned; the scan is kept so a Slice 3 brand
 * vocabulary drops in without re-deriving it.
 */
export const BANNED_AUTHOR_TOKENS: readonly string[] = [];

export function checkRl7(context: QaContext): QaRuleResult {
  if (BANNED_AUTHOR_TOKENS.length === 0) {
    return pass(
      "rl7_banned_tokens",
      "rl7_no_banned_tokens",
      "No brand or author token list is configured in Slice 2, so nothing is banned.",
    );
  }
  const hits: Finding[] = [];
  for (const entry of context.body) {
    for (const token of BANNED_AUTHOR_TOKENS) {
      const pattern = new RegExp(`\\b${token.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (pattern.test(entry.text))
        hits.push({ line: entry.line, excerpt: token });
    }
  }
  return hits.length > 0
    ? fail(
        "rl7_banned_tokens",
        "rl7_banned_token_present",
        `Advisory (never gates): banned token(s) present — ${excerptList(hits)}.`,
      )
    : pass(
        "rl7_banned_tokens",
        "rl7_clean",
        "No configured banned author token appears in the scanned body.",
      );
}

// ---------------------------------------------------------------------------
// RL8 — unsupported claim (blocking)
// ---------------------------------------------------------------------------

export function checkRl8(context: QaContext): QaRuleResult {
  if (!context.english) {
    return unevaluable(
      "rl8_unsupported_claim",
      "rl8_locale_unsupported",
      `Unsupported-claim detection is an English-language heuristic and this draft is "${context.input.pack.outputLocale}": locale not supported by deterministic segmentation, so no factual judgement was made. Review the assertions by hand.`,
    );
  }
  const hits = findUnsupportedClaims(context.index, context.body);
  const unresolved = hits.filter((hit) => hit.resolution.source === null);
  if (unresolved.length === 0) {
    return pass(
      "rl8_unsupported_claim",
      "rl8_all_claims_resolved",
      hits.length === 0
        ? "No sentence in the scanned body matched an external-research assertion pattern. That is a statement about what this deterministic scan found, not a guarantee that the draft asserts nothing: the patterns catch research nouns, `according to` frames and named-entity claims carrying a statistic, and a claim phrased outside those shapes would not be seen here."
        : `All ${hits.length} external-research assertion(s) resolve to a source the frozen research pack carries.`,
    );
  }
  return fail(
    "rl8_unsupported_claim",
    "rl8_claim_unresolved",
    `${unresolved.length} external-research assertion(s) resolve to no source in the frozen research pack (authority D): ${excerptList(unresolved)}. ${unverifiableNote(context)}`,
  );
}

// ---------------------------------------------------------------------------
// RL10 / RL11 / RL13 — residue, weak verbs, jargon
// ---------------------------------------------------------------------------

function scanPatterns(
  lines: readonly DraftLine[],
  patterns: readonly RegExp[],
  skipHeadings: boolean,
): readonly Finding[] {
  const hits: Finding[] = [];
  for (const entry of lines) {
    if (skipHeadings && isHeadingLine(entry.text)) continue;
    const text = stripInlineCode(entry.text);
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) hits.push({ line: entry.line, excerpt: match[0] });
    }
  }
  return hits;
}

export function checkRl10(context: QaContext): QaRuleResult {
  if (!context.english) {
    return unevaluable(
      "rl10_chat_residue",
      "rl10_locale_unsupported",
      "Chat-residue detection is an English word list: locale not supported by deterministic segmentation.",
    );
  }
  const hits = scanPatterns(context.body, CHAT_RESIDUE, false);
  return hits.length > 0
    ? fail(
        "rl10_chat_residue",
        "rl10_residue_present",
        `The draft reads as a chat transcript in ${hits.length} place(s): ${excerptList(hits)}.`,
      )
    : pass(
        "rl10_chat_residue",
        "rl10_clean",
        "No line of the scanned body matched the chat-residue patterns.",
      );
}

export function checkRl11(context: QaContext): QaRuleResult {
  if (!context.english) {
    return unevaluable(
      "rl11_weak_verb",
      "rl11_locale_unsupported",
      "Weak-verb detection is an English word list: locale not supported by deterministic segmentation.",
    );
  }
  const hits = scanPatterns(context.body, WEAK_VERBS, true);
  return hits.length > 0
    ? fail(
        "rl11_weak_verb",
        "rl11_weak_verb_present",
        `Advisory (never gates): ${hits.length} weak definitional verb(s) — ${excerptList(hits)}.`,
      )
    : pass(
        "rl11_weak_verb",
        "rl11_clean",
        "No line of the scanned body matched the weak-definitional-verb patterns.",
      );
}

export function checkRl13(context: QaContext): QaRuleResult {
  if (!context.english) {
    return unevaluable(
      "rl13_banned_jargon",
      "rl13_locale_unsupported",
      "The jargon list is English: locale not supported by deterministic segmentation.",
    );
  }
  const hard = scanPatterns(context.body, HARD_JARGON, true);
  const soft = scanPatterns(context.body, SOFT_JARGON, true);
  const hits = [...hard, ...soft].sort((a, b) => a.line - b.line);
  return hits.length > 0
    ? fail(
        "rl13_banned_jargon",
        "rl13_jargon_present",
        `Advisory (never gates): ${hard.length} hard and ${soft.length} soft AI-slop term(s) — ${excerptList(hits)}.`,
      )
    : pass(
        "rl13_banned_jargon",
        "rl13_clean",
        "No line of the scanned body matched the AI-slop vocabulary list.",
      );
}

// ---------------------------------------------------------------------------
// RL12 — citation integrity (blocking); RL12b — unresolved links (review)
// ---------------------------------------------------------------------------

interface CitationMarker extends Finding {
  readonly attributions: readonly Attribution[];
}

const HALLUCINATED_CITATION_SHAPES: readonly RegExp[] = [
  /\bet al\.?/i,
  /\b[A-Z][A-Za-z&.'-]+\s+(?:University|Institute|Laboratory|Labs?)\s+(?:study|research|report|survey)\b/,
  /\b[A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,4}\s*\((?:19|20)\d{2}\)/,
];

function citationMarkers(
  lines: readonly DraftLine[],
): readonly CitationMarker[] {
  const markers: CitationMarker[] = [];
  for (const entry of lines) {
    const text = stripInlineCode(entry.text);
    if (text.trim().length === 0) continue;
    const attributions = extractAttributions(text);
    const links = extractMarkdownLinks(text);

    // A bare URL in prose IS a citation: nothing else drops a raw address into
    // a sentence. A markdown link is navigation unless its line says otherwise.
    for (const url of extractUrls(text)) {
      if (links.some((link) => link.target.includes(url))) continue;
      markers.push({
        line: entry.line,
        excerpt: url,
        attributions: [{ kind: "url", value: url }],
      });
    }
    if (ATTRIBUTIVE_CITATION_CUE.test(text)) {
      for (const link of links) {
        markers.push({
          line: entry.line,
          excerpt: link.target,
          attributions: [{ kind: "url", value: link.target }],
        });
      }
    }
    for (const pattern of HALLUCINATED_CITATION_SHAPES) {
      const match = pattern.exec(text);
      if (!match) continue;
      markers.push({
        line: entry.line,
        excerpt: match[0],
        attributions:
          attributions.length > 0
            ? attributions
            : [{ kind: "name", value: match[0] }],
      });
    }
  }
  return markers;
}

export function checkRl12(context: QaContext): QaRuleResult {
  const markers = citationMarkers(context.body);
  const unresolved = markers.filter(
    (marker) => resolveAny(context.index, marker.attributions).source === null,
  );
  return unresolved.length > 0
    ? fail(
        "rl12_citation_integrity",
        "rl12_citation_unresolved",
        `${unresolved.length} citation-shaped reference(s) resolve to no source in the frozen research pack (authority D): ${excerptList(unresolved)}. ${unverifiableNote(context)}`,
      )
    : pass(
        "rl12_citation_integrity",
        "rl12_citations_resolve",
        markers.length === 0
          ? "No citation-shaped reference matched this rule's patterns in the scanned body (bare URLs, links a sentence attributes a claim to, and hallucinated-citation shapes). That is what was scanned, not a guarantee that the draft cites nothing."
          : `All ${markers.length} citation-shaped reference(s) resolve to the frozen research pack.`,
      );
}

/**
 * What an unresolved reference actually means, stated without overclaiming.
 *
 * With an empty pack the gate knows one thing: it cannot confirm the reference
 * from SignalFrame's own records. It does NOT know the reference is invented,
 * and saying so would be the gate lying about its own evidence. Once the pack
 * carries citable sources the stronger sentence becomes true, so both are here
 * and the pack decides which one is printed.
 */
function unverifiableNote(context: QaContext): string {
  return context.index.citableCount === 0
    ? "This run retrieved no external research, so the frozen pack holds NOTHING external to resolve against: the correct reading is that these references cannot be verified here, not that they were invented. Every one of them needs a human to confirm it before this draft goes anywhere."
    : "The pack is assembled only from confirmed SignalFrame records, so an attribution that does not resolve names a source we do not hold.";
}

export function checkRl12b(context: QaContext): QaRuleResult {
  const hits: Finding[] = [];
  for (const entry of context.body) {
    const text = stripInlineCode(entry.text);
    // A link a sentence attributes a claim to is RL12's business; reporting it
    // twice would make one defect look like two.
    if (ATTRIBUTIVE_CITATION_CUE.test(text)) continue;
    for (const link of extractMarkdownLinks(text)) {
      const resolution = resolveAttribution(context.index, {
        kind: "url",
        value: link.target,
      });
      if (resolution.source === null) {
        hits.push({ line: entry.line, excerpt: link.target });
      }
    }
  }
  return hits.length > 0
    ? fail(
        "rl12b_unresolved_link",
        "rl12b_link_unresolved",
        `${hits.length} link(s) point outside the customer's own web identity and could not be checked against the frozen research pack: ${excerptList(hits)}. The pack carries this project's frozen site origin (and its ICP conversion target when the profile has one), so a link to the customer's own site or a subdomain of it resolves here; these do not. This run retrieved nothing external, so the correct reading is that these destinations cannot be verified from our records — NOT that they are wrong or invented. A reviewer confirms them by hand.`,
      )
    : pass(
        "rl12b_unresolved_link",
        "rl12b_links_resolve",
        "Every body link resolves to the frozen research pack — the customer's own site origin and conversion target are part of it — or the body carries none.",
      );
}

export function evaluateRedLineRules(
  context: QaContext,
): readonly QaRuleResult[] {
  return [
    checkRl4(context),
    checkRl5(context),
    checkRl7(context),
    checkRl8(context),
    checkRl10(context),
    checkRl11(context),
    checkRl12(context),
    checkRl12b(context),
    checkRl13(context),
  ];
}
