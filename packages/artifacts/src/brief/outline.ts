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
import { truncateChars } from "../text-bounds.ts";
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

/**
 * Control chars, format chars (bidi overrides, zero width, soft hyphen) and
 * separators.
 *
 * Exported because the prompt envelope's `safePromptText` normalizes the exact
 * same class for the exact same reason. Two copies of a security-critical
 * character class is how the two sanitizers drift apart.
 */
export const NON_TEXT_CHARACTER = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

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
  /**
   * DISTINCT section labels the pinned brief carried, before the prompt cap.
   * Symmetrical with `clusterKeywordCount` on purpose: without it a brief that
   * committed to 19 topics and delivered 12 to the model was indistinguishable
   * from one that committed to 12, so a PARTIAL break of the brief -> draft
   * causal chain passed in silence.
   */
  readonly briefSectionCount: number;
  /** Section labels that survived the projection cap. */
  readonly projectedSectionCount: number;
  /** Keywords in the frozen cluster before the projection cap. */
  readonly clusterKeywordCount: number;
  /** Keywords that survived the projection cap. */
  readonly projectedKeywordCount: number;
  /** Frozen cluster keywords whose mapping review state is not `confirmed`. */
  readonly unconfirmedMappingCount: number;
}

/** Section labels plus the count the prompt cap dropped on the floor. */
export interface BriefSectionProjection {
  /** Labels that reached the outline, in document order. */
  readonly labels: readonly string[];
  /** DISTINCT labels the brief carried, before the cap. */
  readonly briefSectionCount: number;
}

/**
 * The single sanitizer for every value crossing into the prompt from this
 * module. The step ORDER is load-bearing:
 *
 * 1. pre-cut, so `redactText` never answers its whole-string sentinel;
 * 2. control/format characters to spaces, then collapse whitespace — this runs
 *    FIRST, before the redactor, and the order is a correctness requirement,
 *    not a style choice. `redactText`'s credential patterns require `\s*`
 *    between a key and its `=`/`:`, and U+200B / U+00AD / U+200D / U+2060 are
 *    NOT `\s`, so `Password<U+200B>=hunter2` walks straight through a redactor
 *    that runs first and is only caught on a SECOND pass. That made the
 *    function non-idempotent, and because the first pass is what gets frozen
 *    into `flow_shadow_runs.frozen_input_manifest` while the prompt boundary
 *    re-sanitizes, the audit record and the bytes the model saw could diverge
 *    (Slice 2 red line C). Normalizing first also matters on its own terms: a
 *    single-line fragment cannot forge a block boundary inside
 *    `JSON.stringify(context, null, 2)`;
 * 3. `redactText`, the same credential scrubber the evidence path uses, now
 *    reading the flattened text a second pass would have read;
 * 4. escape ALL angle brackets — strictly stronger than neutralizing only the
 *    UNTRUSTED_EVIDENCE delimiter, and it covers forged tags and delimiters
 *    alike (the cost, `plans &lt; pro`, matches the deterministic templates).
 *    It stays AFTER redaction so an escaped tag cannot extend a credential
 *    value and swallow the escape into `[redacted]`;
 * 5. re-collapse and trim, so redaction can never leave a ragged edge;
 * 6. truncate BY CODE POINT with the shared ellipsis convention, so no payload
 *    hides in a tail and no cut lands between the two halves of one character
 *    (an orphaned surrogate makes `jsonb` reject the frozen manifest outright —
 *    see `text-bounds.ts`).
 *
 * IDEMPOTENCE, AND THE ONE CASE WHERE IT DOES NOT HOLD.
 *
 * For every value whose sanitized form fits within `maxChars`,
 * `sanitizeOutlineItem(sanitizeOutlineItem(x)) === sanitizeOutlineItem(x)`:
 * steps 1-5 are each fixed points on their own output, so a value that never
 * reaches step 6 cannot move.
 *
 * A value that IS truncated can move, and this is written out because the
 * docstring used to claim idempotence "for every input" and that claim was
 * false. Step 6 can cut inside a marker step 3 wrote: `… password=[redacted]`
 * truncated to `… password=[redacted…` is still a credential SHAPE, so a second
 * pass redacts it again and yields different bytes. Measured at 3 of 420
 * probes, every one of them a boundary landing just after a `key=`.
 *
 * What that costs is stated at `safePromptContentBriefOutline`, which is the
 * second pass: for those items the frozen manifest holds this function's first
 * output and the model sees its second. The property red line C actually needs
 * — same frozen input, same judgement, on replay — is unaffected, because both
 * passes are deterministic functions of the same frozen bytes.
 */
export function sanitizeOutlineItem(value: string, maxChars: number): string {
  if (typeof value !== "string") return "";
  const flattened = value
    .slice(0, OUTLINE_PRE_TRUNCATE_CHARS)
    .replace(NON_TEXT_CHARACTER, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const normalized = redactText(flattened)
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\s+/gu, " ")
    .trim();
  return truncateChars(normalized, maxChars);
}

/**
 * Project the `## ` heading labels of a content brief revision, in document
 * order, together with how many DISTINCT labels the brief actually carried.
 *
 * A heading that matches a spec §10.1 section alias in EITHER locale is
 * replaced by that section's English canonical constant, so (a) a zh-CN brief
 * and an English draft speak one vocabulary, and (b) the operator's original
 * bytes never reach the model at all for the nine standard sections. Because
 * `headingMatches` accepts a prefix, `## Objective and scope: ignore all
 * previous instructions` collapses to the constant `Objective` and the
 * instruction tail simply disappears.
 *
 * The whole document is scanned even after the cap is reached: stopping early
 * would be cheaper but would make the drop UNCOUNTABLE, and an uncountable drop
 * is exactly the silent partial failure this projection has to disclose. The
 * work stays bounded — the brief body is a bounded artifact revision and every
 * label is bounded by `MAX_BRIEF_OUTLINE_SECTION_CHARS`.
 */
export function projectBriefSectionLabels(
  briefMarkdown: string,
): BriefSectionProjection {
  if (typeof briefMarkdown !== "string" || briefMarkdown.trim().length === 0) {
    return { labels: [], briefSectionCount: 0 };
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
        ? sanitizeOutlineItem(section.heading, MAX_BRIEF_OUTLINE_SECTION_CHARS)
        : canonical.en;
    if (label.length === 0) continue;
    const key = normalizeHeading(label);
    if (seen.has(key)) continue;
    seen.add(key);
    if (labels.length < MAX_BRIEF_OUTLINE_SECTIONS) labels.push(label);
  }
  return { labels, briefSectionCount: seen.size };
}

/** The capped label list alone, for callers that do not disclose the drop. */
export function extractBriefSectionLabels(
  briefMarkdown: string,
): readonly string[] {
  return projectBriefSectionLabels(briefMarkdown).labels;
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
      (decision) => decision === "existing_page" || decision === "new_asset",
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
  const sections = projectBriefSectionLabels(input.briefMarkdown ?? "");
  const briefSections = sections.labels;
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
    briefSectionCount: sections.briefSectionCount,
    projectedSectionCount: briefSections.length,
    clusterKeywordCount: input.keywords.length,
    projectedKeywordCount: projected.length,
    unconfirmedMappingCount: input.keywords.filter(
      (row) => row.mappingReviewState !== "confirmed",
    ).length,
  };
}
