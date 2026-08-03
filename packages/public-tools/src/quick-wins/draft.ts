// @input  -- one query, its subject page, and the named same-band page that earns more
// @output -- the prompt for a wording candidate, and a validator the model cannot talk past
// @pos    -- v3.1 §2.5: a draft is a wording pattern from your own site, never advice
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** Roughly where Google truncates a title in the results page. */
export const MAX_DRAFT_TITLE_CHARS = 60;
/** Roughly where it truncates a description. */
export const MAX_DRAFT_META_CHARS = 155;

export interface DraftPageContext {
  readonly page: string;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly ctr: number;
}

export interface DraftInput {
  readonly query: string;
  readonly bucketId: string;
  readonly subject: DraftPageContext;
  /** Named on purpose. A draft whose source cannot be inspected is a template. */
  readonly comparable: DraftPageContext;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Build the prompt.
 *
 * It asks for one thing: rewrite the subject's title and description in the
 * wording pattern of a page on the SAME SITE that earns more at the SAME
 * position. It explicitly forbids explaining the gap, because the tool does
 * not know the cause — Search Console cannot see whether an AI Overview
 * answered the query — and a model asked to explain will produce a confident
 * one anyway.
 */
export function buildDraftPrompt(input: DraftInput): string {
  return [
    "You are rewriting one page's title and meta description for a website owner.",
    "",
    `Search query: ${input.query}`,
    `Both pages below rank in position band ${input.bucketId} on the same site.`,
    "",
    "PAGE TO REWRITE",
    `URL: ${input.subject.page}`,
    `Current title: ${input.subject.title ?? "(none)"}`,
    `Current description: ${input.subject.metaDescription ?? "(none)"}`,
    `Click-through rate: ${pct(input.subject.ctr)}`,
    "",
    "PAGE ON THE SAME SITE THAT EARNS MORE AT THE SAME POSITION",
    `URL: ${input.comparable.page}`,
    `Title: ${input.comparable.title ?? "(none)"}`,
    `Description: ${input.comparable.metaDescription ?? "(none)"}`,
    `Click-through rate: ${pct(input.comparable.ctr)}`,
    "",
    "Your task: rewrite the first page's title and description following the",
    "wording pattern of the second — how it frames what the reader gets, how",
    "specific it is, what it leads with. Keep the first page's actual subject.",
    "",
    "Do not explain why the first page earns fewer clicks. Nobody knows: the",
    "difference may have nothing to do with wording. You are copying a pattern",
    "that works elsewhere on this site, not diagnosing a problem.",
    "",
    "Do not claim the rewrite will improve anything.",
    "",
    `Title: at most ${MAX_DRAFT_TITLE_CHARS} characters.`,
    `Description: at most ${MAX_DRAFT_META_CHARS} characters.`,
    "",
    'Reply with JSON only: {"title": "...", "metaDescription": "..."}',
  ].join("\n");
}

export type DraftValidation =
  | {
      readonly ok: true;
      readonly title: string;
      readonly metaDescription: string;
    }
  | {
      readonly ok: false;
      readonly reason: "unparseable" | "empty" | "too_long" | "promises_outcome";
    };

/**
 * Phrases that turn a wording candidate into a performance claim.
 *
 * Enforced in code rather than trusted to the prompt. A model that ignores an
 * instruction produces text nobody reviewed; a model that trips this check
 * produces nothing. The tool's own limitations section says it cannot know
 * whether a rewrite does anything, and a draft that says otherwise makes the
 * page contradict itself.
 */
const OUTCOME_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bwill\s+(increase|improve|boost|raise|double|lift)\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bboost\s+your\b/i,
  /\brank\s+(higher|better|#?1|first)\b/i,
  /\bproven\s+to\b/i,
  /\bmore\s+clicks\s+guaranteed\b/i,
  /保证|必定|一定(会)?(提升|增加|提高)/,
  /提升排名|提高排名|排名提升/,
];

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/```$/, "")
    .trim();
}

/**
 * Validate a model's reply.
 *
 * Every failure is terminal for that row — the surface shows no draft and says
 * why. There is no repair pass and no fallback template: a draft nobody can
 * trace to a named page on the visitor's own site is the generic advice this
 * feature exists to not be.
 */
export function validateDraft(raw: string): DraftValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "unparseable" };
  }

  const body = parsed as Record<string, unknown>;
  const title = body["title"];
  const metaDescription = body["metaDescription"];
  if (typeof title !== "string" || typeof metaDescription !== "string") {
    return { ok: false, reason: "unparseable" };
  }

  const trimmedTitle = title.trim();
  const trimmedMeta = metaDescription.trim();
  if (trimmedTitle === "" || trimmedMeta === "") {
    return { ok: false, reason: "empty" };
  }

  for (const pattern of OUTCOME_CLAIM_PATTERNS) {
    if (pattern.test(trimmedTitle) || pattern.test(trimmedMeta)) {
      return { ok: false, reason: "promises_outcome" };
    }
  }

  if (
    trimmedTitle.length > MAX_DRAFT_TITLE_CHARS ||
    trimmedMeta.length > MAX_DRAFT_META_CHARS
  ) {
    return { ok: false, reason: "too_long" };
  }

  return { ok: true, title: trimmedTitle, metaDescription: trimmedMeta };
}
