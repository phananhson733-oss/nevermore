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
      readonly reason:
        | "unparseable"
        | "empty"
        | "too_long"
        | "promises_outcome";
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
 * Every balanced top-level `{...}` span in the text, in the order they appear.
 *
 * Models asked for JSON often deliver it with a sentence in front, a sentence
 * behind, or a fence that does not start at character zero. On the live tool
 * that arrived as `unparseable` — the format was called unusable while the
 * draft the prompt asked for sat inside the reply.
 *
 * This finds the object rather than repairing it. Brace counting is
 * string-aware so a `{` inside a title does not open a span and a `}` inside
 * one does not close it; a span that never closes (the shape a cut-off reply
 * takes) is simply never produced, so truncation stays a failure.
 */
function jsonObjectSpans(text: string): readonly string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return spans;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The object a draft should be read out of, or null when the reply has none.
 *
 * The whole reply is tried first, so a well-behaved model costs nothing extra.
 * When several objects are present the one carrying both draft fields wins —
 * a model that narrated in JSON before answering should not have its preamble
 * validated as the draft. Failing that, the first object is returned so the
 * caller can still say precisely what was wrong with it.
 */
function findDraftObject(text: string): Record<string, unknown> | null {
  const objects: Record<string, unknown>[] = [];

  for (const candidate of [text, ...jsonObjectSpans(text)]) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (isPlainObject(value)) objects.push(value);
    } catch {
      // Not this span. A reply with no parseable object at all is terminal,
      // and the caller reports it as such.
    }
  }

  return (
    objects.find((o) => "title" in o && "metaDescription" in o) ??
    objects[0] ??
    null
  );
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
  const body = findDraftObject(stripCodeFence(raw));
  if (body === null) return { ok: false, reason: "unparseable" };

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
