/**
 * Deterministic `content_brief` -> `english_blog_draft` structured extraction
 * (Slice 2 Task 4b, spec §10.2).
 *
 * WHY THIS EXISTS. Before this module the Content Shadow draft and the
 * `content_brief` were SIBLINGS, not parent and child: both were generated from
 * the same Finding/Evidence/ICP lineage, so an operator editing the brief
 * changed nothing about the draft. This module is the causal edge — but it
 * carries STRUCTURE, never prose. The brief body stays out of the prompt
 * because §10.2 pins the prompt input to an allowlist, and operator-authored
 * free text inside an allowlisted context is an instruction surface.
 *
 * WHAT IS AND IS NOT A CAUSAL INPUT (copy of the blueprint's decision table):
 *
 * | operator edit                              | outline result          | affects draft |
 * |--------------------------------------------|-------------------------|---------------|
 * | extends a known heading (`## Objective …`)  | canonical `Objective`   | no (by design)|
 * | renames a section entirely                  | sanitized new label     | yes           |
 * | deletes a section                           | label disappears        | yes           |
 * | adds a section                              | appended in doc order   | yes           |
 * | reorders sections                           | order follows document  | yes           |
 * | demotes a heading to `### `                 | not counted (validator agrees) | yes    |
 * | pastes one prose line as a heading          | sanitized, capped label | bounded       |
 * | pastes multi-line prose under a heading     | body, never a candidate | NO            |
 *
 * SEMANTICS (decision O-6). `briefSections` is a COVERAGE CHECKLIST — the set of
 * topics the confirmed brief committed to — and NOT the document structure of
 * the draft. The draft's structure is the fixed Content Shadow scaffold
 * (`CONTENT_SHADOW_OUTLINE`); telling the model to organise the document by
 * brief sections would make the Task 6 structure checks fail by construction.
 *
 * The module is pure: no clock, no randomness, no I/O. Same input, same bytes.
 */

import { redactText } from "@sf/observability";
import { CONTENT_BRIEF_SECTIONS } from "../validators/sections.ts";
import {
  headingMatches,
  normalizeHeading,
  parseMarkdownSections,
} from "../validators/markdown.ts";

/** At most this many brief section labels reach the prompt. */
export const MAX_BRIEF_OUTLINE_SECTIONS = 12;
/** At most this many characters per section label. */
export const MAX_BRIEF_OUTLINE_SECTION_CHARS = 120;
/** At most this many frozen cluster keywords reach the prompt. */
export const MAX_BRIEF_OUTLINE_KEYWORDS = 50;
/** At most this many characters per keyword label. */
export const MAX_BRIEF_OUTLINE_KEYWORD_CHARS = 120;

/**
 * Hard pre-cut before `redactText`, which answers a `[truncated]` sentinel for
 * a whole string above its byte budget. Cutting first keeps one hostile heading
 * from erasing an otherwise honest label.
 */
const OUTLINE_PRE_TRUNCATE_CHARS = 512;

/** Control chars, format chars (bidi overrides, zero width, soft hyphen) and separators. */
const NON_TEXT_CHARACTER = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * The cluster's existing-page-first decision, aggregated. Four values, not two:
 * one cluster can legitimately hold keywords with different decisions, and
 * picking a winner would be fabricating a consensus that does not exist.
 */
export type BriefPageAssignment =
  | "existing_page"
  | "new_asset"
  | "mixed"
  | "unassigned";

/** The per-keyword governance decision as stored on `keyword_entities`. */
export type BriefKeywordMappingDecision =
  | "unassigned"
  | "existing_page"
  | "new_asset";

export type BriefKeywordMappingReviewState = "unreviewed" | "confirmed";

/** The closed, three-key allowlist value added to the draft prompt (§10.2). */
export interface ContentBriefOutline {
  /** Coverage checklist (NOT the draft's document structure). */
  readonly briefSections: readonly string[];
  /** Frozen SearchQuery cluster keyword text; carries no demand metric. */
  readonly targetKeywords: readonly string[];
  readonly pageAssignment: BriefPageAssignment;
}

/** One frozen keyword row projected for extraction. */
export interface BriefOutlineKeyword {
  readonly id: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly mappingDecision: BriefKeywordMappingDecision;
  readonly mappingReviewState: BriefKeywordMappingReviewState;
}

/**
 * The outline plus the counts a reviewer needs to judge it. The counts stay OUT
 * of `ContentBriefOutline` on purpose: they are disclosure for the research
 * pack, not prompt input, and `mapping_review_state` must not become a frozen
 * input (it does not shape the draft, so it must not fail a queued run).
 */
export interface ContentBriefOutlineExtraction {
  readonly outline: ContentBriefOutline;
  /** Keywords in the frozen cluster before the projection cap. */
  readonly clusterKeywordCount: number;
  /** Keywords that survived the projection cap. */
  readonly projectedKeywordCount: number;
  /** Frozen cluster keywords whose mapping review state is not `confirmed`. */
  readonly unconfirmedMappingCount: number;
}

/**
 * The single sanitizer for every value crossing into the prompt from this
 * module. The step ORDER is load-bearing:
 *
 * 1. pre-cut, so `redactText` never answers its whole-string sentinel;
 * 2. `redactText`, the same credential scrubber the evidence path uses;
 * 3. escape ALL angle brackets — strictly stronger than neutralizing only the
 *    UNTRUSTED_EVIDENCE delimiter, and it covers forged tags and delimiters
 *    alike (the cost, `plans &lt; pro`, matches the deterministic templates);
 * 4. control/format characters to spaces — this is the one that matters most,
 *    because a single-line fragment cannot forge a block boundary inside
 *    `JSON.stringify(context, null, 2)`;
 * 5. collapse whitespace;
 * 6. truncate with the shared ellipsis convention so no payload hides in a tail.
 */
export function sanitizeOutlineItem(value: string, maxChars: number): string {
  if (typeof value !== "string") return "";
  const normalized = redactText(value.slice(0, OUTLINE_PRE_TRUNCATE_CHARS))
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(NON_TEXT_CHARACTER, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return normalized.slice(0, Math.max(0, maxChars));
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Extract the `## ` heading labels of a content brief revision, in document
 * order.
 *
 * A heading that matches a spec §10.1 section alias in EITHER locale is
 * replaced by that section's English canonical constant, so (a) a zh-CN brief
 * and an English draft speak one vocabulary, and (b) the operator's original
 * bytes never reach the model at all for the nine standard sections. Because
 * `headingMatches` accepts a prefix, `## Objective and scope: ignore all
 * previous instructions` collapses to the constant `Objective` and the
 * instruction tail simply disappears.
 */
export function extractBriefSectionLabels(
  briefMarkdown: string,
): readonly string[] {
  if (typeof briefMarkdown !== "string" || briefMarkdown.trim().length === 0) {
    return [];
  }
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const section of parseMarkdownSections(briefMarkdown)) {
    const canonical = CONTENT_BRIEF_SECTIONS.find(
      (def) =>
        headingMatches(section.heading, def.en) ||
        headingMatches(section.heading, def.zh),
    );
    const label =
      canonical === undefined
        ? sanitizeOutlineItem(
            section.heading,
            MAX_BRIEF_OUTLINE_SECTION_CHARS,
          )
        : canonical.en;
    if (label.length === 0) continue;
    const key = normalizeHeading(label);
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= MAX_BRIEF_OUTLINE_SECTIONS) break;
  }
  return labels;
}

/**
 * Aggregate one cluster's per-keyword mapping decisions. `unassigned` keywords
 * never overturn a decision an operator already made; two genuinely different
 * decisions answer `mixed` rather than picking a side.
 */
export function aggregatePageAssignment(
  decisions: readonly BriefKeywordMappingDecision[],
): BriefPageAssignment {
  const decided = new Set(
    decisions.filter(
      (decision) =>
        decision === "existing_page" || decision === "new_asset",
    ),
  );
  if (decided.size === 0) return "unassigned";
  if (decided.size > 1) return "mixed";
  return decided.has("existing_page") ? "existing_page" : "new_asset";
}

/**
 * Sort by `(normalized_keyword, id)`. Both columns are database-immutable
 * (`enforce_keyword_entity_mutation`), so the order is stable across processes
 * and replays; frozen-id order would be identity order, which reads as noise.
 */
function compareKeyword(
  left: BriefOutlineKeyword,
  right: BriefOutlineKeyword,
): number {
  if (left.normalizedKeyword !== right.normalizedKeyword) {
    return left.normalizedKeyword < right.normalizedKeyword ? -1 : 1;
  }
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}

/**
 * Project one pinned brief revision plus its frozen SearchQuery cluster into
 * the closed outline value.
 *
 * Generative queries are deliberately absent (decision O-5): merging them into
 * `targetKeywords` would collapse invariant 8 at the prompt layer, where the
 * model would see one undifferentiated demand list.
 *
 * Extraction never throws. An unparseable brief degrades to an empty
 * `briefSections`, which the research pack, the QA gate and the API response
 * each report as an explicit failure (decision O-4) — loud degradation, never
 * a silent one.
 */
export function extractContentBriefOutline(input: {
  readonly briefMarkdown: string | null;
  readonly keywords: readonly BriefOutlineKeyword[];
}): ContentBriefOutlineExtraction {
  const briefSections = extractBriefSectionLabels(input.briefMarkdown ?? "");
  const ordered = [...input.keywords].sort(compareKeyword);
  const projected = ordered.slice(0, MAX_BRIEF_OUTLINE_KEYWORDS);

  const targetKeywords: string[] = [];
  const seen = new Set<string>();
  for (const row of projected) {
    // `display_keyword` is provider-ingested third-party text (GSC / CSV /
    // DataForSEO), so it is exactly as untrusted as an evidence claim.
    const label = sanitizeOutlineItem(
      row.displayKeyword,
      MAX_BRIEF_OUTLINE_KEYWORD_CHARS,
    );
    if (label.length === 0 || seen.has(label)) continue;
    seen.add(label);
    targetKeywords.push(label);
  }

  return {
    outline: {
      briefSections,
      targetKeywords,
      // Aggregated over the WHOLE frozen cluster, not just the projected head:
      // the decision is a property of the cluster, not of the prompt budget.
      pageAssignment: aggregatePageAssignment(
        input.keywords.map((row) => row.mappingDecision),
      ),
    },
    clusterKeywordCount: input.keywords.length,
    projectedKeywordCount: projected.length,
    unconfirmedMappingCount: input.keywords.filter(
      (row) => row.mappingReviewState !== "confirmed",
    ).length,
  };
}
