import type { QaContext } from "./context.ts";
import {
  findUnsupportedClaims,
  locatedAttributions,
  resolveAssertionSupport,
  resolveLinkProvenance,
  type Attribution,
} from "./claims.ts";
import { jaccard, recall, shingles } from "./ngram.ts";
import { fail, pass, unevaluable, type QaRuleResult } from "./rule-types.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";
import { citationEntry, parentheticalCitations } from "./names.ts";
import {
  factualClaimDescription,
  findBroadExternalFactualClaims,
} from "./factual-claims.ts";
import {
  evidenceSourceDescription,
  findEvidenceTextMatchForSource,
} from "./evidence.ts";
import {
  checkBrandVoice,
  checkClaimRestrictions,
} from "./policy-rules.ts";
import {
  flattenLine,
  isHeadingLine,
  normalizeHeading,
  paragraphBlocks,
  stripInlineCode,
  sentenceSpanAt,
  spansOverlap,
  tokenize,
  truncateExcerpt,
  type DraftLine,
  type FlatLine,
  type FlatLink,
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
 * - **RL3** (SERP-wide plagiarism) — the frozen pack has no SERP snippet
 *   corpus. The separate source-overlap rule does bounded exact-shingle and
 *   near-duplicate comparison against captured first-party/external pages, but
 *   it is not a whole-web or SERP plagiarism search.
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
  { id: "rl14_brand_voice", title: "Content follows frozen brand policy" },
  {
    id: "rl15_claim_restrictions",
    title: "Content follows frozen claim restrictions",
  },
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
 * product and engineering documentation routinely uses several of them — and
 * the original list inherited them from a style guide where they read as
 * pseudo-technical affect in an astrology context. Keeping them would fail
 * correct technical prose. This note exists so the omission is not mistaken for
 * an incomplete port and "restored" later.
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
  /\b(?:according to|as (?:reported|found|shown|noted|documented) (?:by|in)|cited (?:by|in)|citations?|sources?\s*:|references?\s*:|see\s+(?:also\s+)?(?:the\s+)?(?:study|report|survey|research|analysis|benchmark|whitepaper|paper)\b|per\s+(?:a|an|the)\s|(?:study|studies|report|reports|survey|surveys|research|analysis|analyses|benchmark|whitepaper|poll)\s+(?:by|from)\b)/gi;

/**
 * The links a sentence really does offer as evidence.
 *
 * The cue used to be tested against the WHOLE LINE, and every link on that line
 * became a citation. So "According to a 2024 Forrester study, 73% … [Book a
 * demo](our-site)" made the call to action the citation for a study it has
 * nothing to do with — and once the customer's own site was in the pack, that
 * link RESOLVED and released the block. A link is a citation here only when it
 * FOLLOWS the cue inside the cue's own sentence, which is where a reader would
 * read it as the thing being attributed to.
 */
function attributedLinks(flat: FlatLine): readonly FlatLink[] {
  const cues = [...flat.text.matchAll(ATTRIBUTIVE_CITATION_CUE)];
  if (cues.length === 0) return [];
  return flat.links.filter((link) =>
    cues.some((cue) => {
      if (cue.index === undefined) return false;
      if (cue.index + cue[0].length > link.start) return false;
      return spansOverlap(link, sentenceSpanAt(flat.text, cue.index));
    }),
  );
}

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

/** Legacy author-token denylist; frozen brand policy is evaluated by RL14. */
export const BANNED_AUTHOR_TOKENS: readonly string[] = [];

export function checkRl7(context: QaContext): QaRuleResult {
  if (BANNED_AUTHOR_TOKENS.length === 0) {
    return pass(
      "rl7_banned_tokens",
      "rl7_no_banned_tokens",
      "No legacy author-token denylist is configured for this check. Frozen prohibited terms and brand constraints are evaluated separately by the brand-voice rule.",
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
  const broad = findBroadExternalFactualClaims(context);
  // The broad scanner deliberately overlaps the older attribution/research
  // scanner so quantified attributed prose cannot escape. Collapse only the
  // broad reading whose text contains the already-located research assertion;
  // otherwise one supported sentence is counted again as an unsupported
  // generic percentage claim.
  const broadClaims = broad.claims.filter((claim) => {
    const statement = claim.excerpt.toLowerCase().replace(/\s+/g, " ").trim();
    return !hits.some((hit) => {
      if (hit.line !== claim.line) return false;
      const excerpt = hit.excerpt.toLowerCase().replace(/\s+/g, " ").trim();
      const complete = hit.statement
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      return (
        (excerpt.length > 0 && statement.includes(excerpt)) ||
        (complete.length > 0 &&
          (statement.includes(complete) || complete.includes(statement)))
      );
    });
  });
  // `support === null`, never "nothing resolved". A link to the customer's own
  // site resolves — it is just not EVIDENCE, and this rule asks for evidence.
  const unresolved = hits.filter((hit) => hit.resolution.support === null);
  const uncertainResearch = hits.filter((hit) => {
    const support = hit.resolution.support;
    if (support === null || support.source.kind !== "external_page") return false;
    const alignment = findEvidenceTextMatchForSource(
      support.source,
      hit.statement,
    );
    return alignment.match === null || alignment.bounded;
  });
  const unsupportedBroad = broadClaims.filter(
    (claim) => claim.status === "unsupported",
  );
  const uncertainBroad = broadClaims.filter(
    (claim) => claim.status === "uncertain",
  );

  if (unresolved.length > 0 || unsupportedBroad.length > 0) {
    const researchDetail =
      unresolved.length === 0 ? "" : excerptList(unresolved);
    const broadDetail = unsupportedBroad
      .slice(0, QA_THRESHOLDS.maxReportedFindings)
      .map(factualClaimDescription)
      .join("; ");
    const joined = [researchDetail, broadDetail].filter(Boolean).join("; ");
    return fail(
      "rl8_unsupported_claim",
      "rl8_claim_unresolved",
      `${unresolved.length + unsupportedBroad.length} external factual assertion(s) have no supporting external page in the frozen research pack (authority D): ${joined}. First-party page content and site identity cannot support an external factual claim. ${unverifiableNote(context)}`,
    );
  }

  if (
    uncertainResearch.length > 0 ||
    uncertainBroad.length > 0 ||
    broad.truncated
  ) {
    const sources = uncertainResearch
      .map((hit) => hit.resolution.support?.source)
      .filter((source) => source !== undefined)
      .map(evidenceSourceDescription);
    const uncertainDetail = [
      ...uncertainResearch.map(
        (hit) =>
          `line ${hit.line}: "${truncateExcerpt(hit.statement, QA_THRESHOLDS.maxExcerptChars)}"`,
      ),
      ...uncertainBroad
        .slice(0, QA_THRESHOLDS.maxReportedFindings)
        .map(factualClaimDescription),
    ]
      .slice(0, QA_THRESHOLDS.maxReportedFindings)
      .join("; ");
    return unevaluable(
      "rl8_unsupported_claim",
      "rl8_claim_support_uncertain",
      `${uncertainResearch.length + uncertainBroad.length} external factual assertion(s) name or resemble frozen evidence but could not be aligned reliably enough for a machine judgement: ${uncertainDetail || "the candidate bound was reached"}.${sources.length > 0 ? ` Resolved source(s): ${[...new Set(sources)].join("; ")}.` : ""} This deterministic lexical gate is not a full semantic fact-check; a reviewer must confirm that each source really entails the statement.`,
    );
  }

  return pass(
    "rl8_unsupported_claim",
    "rl8_all_claims_resolved",
    hits.length === 0 && broadClaims.length === 0
      ? "No scanned sentence matched the supported external-fact shapes: attributed/research statements (including those without numbers), quantified or time-comparison claims, guarantees, or superlatives. This bounded English heuristic is not a full semantic fact-check and does not claim the draft contains no other proposition."
      : `All ${hits.length + broadClaims.length} scanned external factual assertion(s) align with frozen external page evidence. First-party evidence was excluded. This is deterministic lexical evidence alignment, not a full semantic fact-check.`,
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

/**
 * What a marker is being offered AS decides what may satisfy it.
 *
 * - `locator` — a bare address in prose. It claims "this page exists at this
 *   URL", nothing more, so the customer's own site answers it completely.
 * - `evidence` — a bibliographic reference, a footnote, or a link a sentence
 *   attributes a claim to. It claims "a source stands behind this", and the
 *   customer's own web identity is never that source.
 */
type MarkerRole = "locator" | "evidence";

/**
 * How sure this rule is that the marker is a reference AT ALL.
 *
 * Recognition and resolution are separate questions. The frozen pack may carry
 * external page captures, so a recognised marker is resolved against eligible
 * evidence rather than being accepted by shape alone. Confidence still decides
 * whether an unresolved shape is a factual failure or a review-required
 * ambiguity.
 *
 * - `high` — the thing is unmistakably offered as a source: an address, a
 *   footnote, an `et al.`, a name beside a year, a link a sentence attributes a
 *   claim to. Reporting it as unsupported is a statement we can defend.
 * - `low` — it READS like a reference (an outside-looking name phrase where an
 *   entry belongs) but carries no second signal. It could be a product name or
 *   a section title. `blocked` here would be the gate asserting more than it
 *   knows, so the honest output is "we could not judge this — a human must",
 *   which is `unevaluable` and forces `needs_review`.
 */
type MarkerConfidence = "high" | "low";

interface CitationMarker extends Finding {
  readonly role: MarkerRole;
  readonly confidence: MarkerConfidence;
  readonly attributions: readonly Attribution[];
}

/**
 * A bibliographic entry left in the BODY — the backstop for every reference
 * heading this gate does not recognise.
 *
 * The partition is deliberately conservative: an unrecognised heading keeps its
 * section in the body so honest prose is never reported as an unresolvable
 * reference. That bias is only safe if the body is genuinely scanned, and it was
 * not: no rule could see a bibliography entry, so `## Related links`,
 * `## Sources:` and a setext `Sources` all returned `passed` with SC9b
 * persisting the claim that the draft listed no reference at all. This shape is
 * what makes the bias safe — a miss in heading recognition now costs a
 * differently-worded block, never a silent pass.
 *
 * It is anchored at an ENTRY position (line start, list marker, or the field
 * separator inside a multi-part entry) and requires a capitalized name phrase
 * immediately before a comma and a year. "We shipped this in 2024." has no
 * comma before the year; "Onboarding analytics, 2024 edition" has no
 * capitalized phrase before it.
 */
const REFERENCE_ENTRY_SHAPE =
  /(?:^|[-*+]\s+|\d+[.)]\s+|,\s+|;\s*|\|\s*|[—–]\s*)((?:[A-Z][A-Za-z0-9&.'’-]+)(?:\s+(?:[A-Z][A-Za-z0-9&.'’-]*|and|of|for|the|de|van|der|&)){0,7}),\s*\(?(?:19|20)\d{2}\)?/;

/** A trailing `— Name, 2024` / `— Name (2024)` endnote is an attribution. */
const ENDNOTE_ATTRIBUTION =
  /[—–]\s*[A-Z][A-Za-z0-9&.'’-]+(?:\s+[A-Z][A-Za-z0-9&.'’-]*){0,7},?\s*\(?(?:19|20)\d{2}\)?\s*$/;

const HALLUCINATED_CITATION_SHAPES: readonly RegExp[] = [
  /\bet al\.?/i,
  /\b[A-Z][A-Za-z&.'-]+\s+(?:University|Institute|Laboratory|Labs?)\s+(?:study|research|report|survey)\b/,
  /\b[A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,4}\s*\((?:19|20)\d{2}\)/,
  REFERENCE_ENTRY_SHAPE,
  ENDNOTE_ATTRIBUTION,
];

/** A footnote REFERENCE (`[^1]`) and a footnote DEFINITION (`[^1]: …`). */
const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\]/g;
const FOOTNOTE_DEFINITION = /^\s{0,3}\[\^([^\]\s]+)\]:\s*(.*)$/;

/** Every footnote definition in the body, by its id. */
function footnoteDefinitions(
  lines: readonly DraftLine[],
): ReadonlyMap<string, string> {
  const definitions = new Map<string, string>();
  for (const entry of lines) {
    const match = FOOTNOTE_DEFINITION.exec(entry.text);
    const id = match?.[1];
    if (id !== undefined && !definitions.has(id)) {
      definitions.set(id, match?.[2] ?? "");
    }
  }
  return definitions;
}

/** The attributions located to one shape's own sentence. */
function sentenceAttributions(
  flat: FlatLine,
  offset: number,
): readonly Attribution[] {
  const sentence = sentenceSpanAt(flat.text, offset);
  return locatedAttributions(flat)
    .filter((attribution) => spansOverlap(attribution, sentence))
    .map(({ kind, value }) => ({ kind, value }));
}

/**
 * A position where a draft LISTS something rather than says something.
 *
 * A bibliography entry sits in one of these; a sentence does not. This is what
 * keeps the name predicate below off running prose — `RevOps leads evaluating
 * onboarding tooling own this work.` is a claim about the world, and no reading
 * of it is a reference entry.
 *
 * A one-line prose block counts because the plain-paragraph bibliography is
 * real: `Forrester Digital Experience Report, 2024` on its own line, with no
 * list marker, is the exact shape that used to pass while the hyphenated
 * version was blocked. A block joined from several lines is a paragraph.
 */
function isEntryPosition(block: {
  readonly kind: "prose" | "list" | "table" | "quote";
  readonly lines: number;
}): boolean {
  return block.kind !== "prose" || block.lines === 1;
}

/**
 * The bibliography backstop, asked the other way round.
 *
 * It used to ask "does this line match a bibliographic FORM?" and carried a list
 * of them. Every rework showed the same result: the identical fabricated entry
 * escaped by dropping the year, reordering it, changing the punctuation, or
 * moving into a table cell — each one token away from a form that was caught.
 * The list cannot be finished, because the model is not drawing from it.
 *
 * So this asks: at an entry position, is there a capitalized name phrase that
 * dominates the entry? That question survives all of those mutations, and its
 * answer carries a confidence (see `MarkerConfidence`) rather than pretending
 * that "looks like a name" and "is offered as a source" are the same claim.
 */
function entryCitationMarkers(
  lines: readonly DraftLine[],
): readonly CitationMarker[] {
  const markers: CitationMarker[] = [];
  for (const block of paragraphBlocks(lines)) {
    if (!isEntryPosition(block)) continue;
    const flat = flattenLine(block.text);
    const shape = citationEntry(flat.text);
    if (shape === null) continue;
    const located = locatedAttributions(flat).map(({ kind, value }) => ({
      kind,
      value,
    }));
    markers.push({
      line: block.line,
      excerpt: block.text,
      role: "evidence",
      confidence: shape.corroborated ? "high" : "low",
      attributions: [...located, { kind: "name", value: shape.name }],
    });
  }
  return markers;
}

function citationMarkers(
  lines: readonly DraftLine[],
): readonly CitationMarker[] {
  const markers: CitationMarker[] = [];
  const definitions = footnoteDefinitions(lines);
  for (const entry of lines) {
    const flat = flattenLine(entry.text);
    const text = flat.text;
    if (text.trim().length === 0) continue;
    const isDefinition = FOOTNOTE_DEFINITION.test(entry.text);

    // A bare URL in prose IS a citation: nothing else drops a raw address into
    // a sentence. It is a LOCATOR though — it asserts where a page is, not that
    // a source stands behind a claim — so the customer's own address answers it.
    for (const url of flat.urls) {
      markers.push({
        line: entry.line,
        excerpt: url.value,
        role: "locator",
        confidence: "high",
        attributions: [{ kind: "url", value: url.value }],
      });
    }
    // A markdown link is navigation unless the sentence attributes to it.
    for (const link of attributedLinks(flat)) {
      markers.push({
        line: entry.line,
        excerpt: link.target,
        role: "evidence",
        confidence: "high",
        attributions: [{ kind: "url", value: link.target }],
      });
    }
    for (const pattern of HALLUCINATED_CITATION_SHAPES) {
      const match = pattern.exec(text);
      if (!match || match.index === undefined) continue;
      const located = sentenceAttributions(flat, match.index);
      markers.push({
        line: entry.line,
        excerpt: match[0],
        role: "evidence",
        confidence: "high",
        attributions:
          located.length > 0 ? located : [{ kind: "name", value: match[0] }],
      });
    }
    // `(Forrester, 2024)` — an inline academic citation. The bracket is the
    // citation slot, so what a reader reads inside it is what is checked.
    for (const parenthetical of parentheticalCitations(text)) {
      const located = sentenceAttributions(flat, parenthetical.index);
      markers.push({
        line: entry.line,
        excerpt: parenthetical.excerpt,
        role: "evidence",
        confidence: "high",
        attributions: [...located, { kind: "name", value: parenthetical.name }],
      });
    }
    // A footnote marker cites its definition. With no definition it cites
    // nothing at all, which is exactly what the gate has to say about it.
    if (!isDefinition) {
      for (const match of text.matchAll(FOOTNOTE_REFERENCE)) {
        const id = match[1] ?? "";
        const definition = definitions.get(id) ?? "";
        markers.push({
          line: entry.line,
          excerpt: match[0],
          role: "evidence",
          confidence: "high",
          attributions:
            definition.trim().length > 0
              ? [
                  ...locatedAttributions(flattenLine(definition)).map(
                    ({ kind, value }) => ({ kind, value }),
                  ),
                  { kind: "name", value: definition },
                ]
              : [{ kind: "name", value: match[0] }],
        });
      }
    }
  }
  // The entry predicate and the shape patterns overlap on purpose — the shapes
  // catch a single name beside a year, the predicate catches a multi-word name
  // with no year. A line both of them see is ONE defect, so the later, weaker
  // recognition yields.
  const claimed = new Set(markers.map((marker) => marker.line));
  return [
    ...markers,
    ...entryCitationMarkers(lines).filter(
      (marker) => !claimed.has(marker.line),
    ),
  ].sort((left, right) => left.line - right.line);
}

function markerResolves(context: QaContext, marker: CitationMarker): boolean {
  if (marker.role === "evidence") {
    return resolveAssertionSupport(context.index, marker.attributions) !== null;
  }
  return marker.attributions.some(
    (attribution) =>
      resolveLinkProvenance(context.index, attribution) !== "unresolved",
  );
}

export function checkRl12(context: QaContext): QaRuleResult {
  const markers = citationMarkers(context.body);
  const unresolved = markers.filter(
    (marker) => !markerResolves(context, marker),
  );
  const confident = unresolved.filter((marker) => marker.confidence === "high");
  const tentative = unresolved.filter((marker) => marker.confidence === "low");
  if (confident.length > 0) {
    return fail(
      "rl12_citation_integrity",
      "rl12_citation_unresolved",
      `${confident.length} citation-shaped reference(s) resolve to no source in the frozen research pack (authority D): ${excerptList(confident)}. ${unverifiableNote(context)}${tentative.length > 0 ? ` A further ${tentative.length} entry(ies) read as an outside name but carry no year, quotation or address, so this rule does not judge them; they are described under the same claim and also need a human.` : ""}`,
    );
  }
  if (tentative.length > 0) {
    // Deliberately NOT a failure. These carry an outside-looking name at an
    // entry position and nothing else — no year, no quoted title, no address.
    // That is enough to say "this looks like a reference we cannot confirm" and
    // not enough to say "this is unsupported", and the difference between those
    // two sentences is the difference between a gate reviewers trust and one
    // they learn to click through. `unevaluable` forces `needs_review` without
    // asserting the stronger claim.
    return unevaluable(
      "rl12_citation_integrity",
      "rl12_citation_unjudged",
      `${tentative.length} entry-shaped line(s) name something that reads as an outside source but carry no year, quotation or address to confirm it by: ${excerptList(tentative)}. This rule reports what it could not judge rather than guessing: the name may be a product, a feature or a section title, so calling these unsupported would assert more than the frozen inputs can show. A reviewer decides. ${unverifiableNote(context)}`,
    );
  }
  return pass(
    "rl12_citation_integrity",
    "rl12_citations_resolve",
    markers.length === 0
      ? "No citation-shaped reference matched this rule in the scanned body. What it scans is: bare URLs, links a sentence attributes a claim to, footnote markers, `et al.`/`Name (2024)`/`Name, 2024` shapes, `(Author, Year)` brackets, and lines at a list/table/quote/one-line-entry position whose capitalized name phrase outweighs the rest of the line. That is what was scanned, not a guarantee that the draft cites nothing."
      : `All ${markers.length} citation-shaped reference(s) resolve to the frozen research pack.`,
  );
}

/**
 * What an unresolved reference actually means, stated without overclaiming.
 *
 * The gate knows whether the frozen index exposes citable external identities;
 * it never knows that an unresolved reference was invented. The detail reports
 * actual external-page/body counts rather than assuming retrieval did not run.
 */
function unverifiableNote(context: QaContext): string {
  const externalPages = context.input.pack.sources.filter(
    (source) => source.kind === "external_page",
  );
  const capturedBodies = externalPages.filter(
    (source) => source.contentText !== null,
  ).length;
  return context.index.citableCount === 0
    ? `The frozen source index exposes no citable external identity for this reference. The pack contains ${externalPages.length} external-page row(s), ${capturedBodies} with captured body text. These references cannot be verified here; the correct reading is that they are unverifiable here, not that they were invented. A human must confirm them.`
    : `The frozen source index exposes ${context.index.citableCount} citable external source(s), but this attribution did not resolve to any of them. These references are unsupported by this pack and cannot be verified here; that is not proof they do not exist, so a human must confirm them.`;
}

export function checkRl12b(context: QaContext): QaRuleResult {
  const hits: Finding[] = [];
  const identityOnly: Finding[] = [];
  for (const entry of context.body) {
    const flat = flattenLine(entry.text);
    // A link a sentence attributes a claim to is RL12's business; reporting it
    // twice would make one defect look like two. Only THAT link is skipped now,
    // not every link sharing a line with a cue — a call to action next to an
    // attributed citation is still this rule's subject.
    const claimed = new Set(attributedLinks(flat).map((link) => link.target));
    for (const link of flat.links) {
      if (claimed.has(link.target)) continue;
      const provenance = resolveLinkProvenance(context.index, {
        kind: "url",
        value: link.target,
      });
      if (provenance === "unresolved") {
        hits.push({ line: entry.line, excerpt: link.target });
      } else if (provenance === "first_party_identity") {
        identityOnly.push({ line: entry.line, excerpt: link.target });
      }
    }
  }
  return hits.length > 0
    ? fail(
        "rl12b_unresolved_link",
        "rl12b_link_unresolved",
        `${hits.length} link(s) could not be checked against an exact frozen page or the customer's frozen web identity: ${excerptList(hits)}. The correct reading is that these destinations cannot be verified from our records — NOT that they are wrong or invented. A reviewer confirms them by hand.${identityOnly.length > 0 ? ` A further ${identityOnly.length} first-party link(s) resolve only as customer-owned identity; that proves ownership, not page contents.` : ""}`,
      )
    : identityOnly.length > 0
      ? pass(
          "rl12b_unresolved_link",
          "rl12b_first_party_identity_only",
          `${identityOnly.length} first-party link(s) resolve to the frozen customer site/conversion identity: ${excerptList(identityOnly)}. This proves the destination is customer-owned; it does NOT verify that a page exists at the precise path or that its content supports any statement. Exact captured first-party pages carry a separate evidence role.`,
        )
    : pass(
        "rl12b_unresolved_link",
        "rl12b_links_resolve",
        "Every body link resolves to an exact frozen first-party/external page, or the body carries none.",
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
    checkBrandVoice(context),
    checkClaimRestrictions(context),
  ];
}
