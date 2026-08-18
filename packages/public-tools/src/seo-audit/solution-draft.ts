// @input  -- one selected check's observed values and the visitor's confirmed context
// @output -- the prompt for a preview draft, and a validated reading of the reply
// @pos    -- pure; owns no credential, makes no request, applies nothing
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** What a draft can be asked for. Deliberately small: each shape is a contract. */
export type SolutionDraftKind = "search-presentation" | "heading-structure";

export const SOLUTION_DRAFT_KINDS: readonly SolutionDraftKind[] = [
  "search-presentation",
  "heading-structure",
];

/** Nothing here is invented by the caller: every field is a measured value. */
export interface SolutionDraftInput {
  readonly kind: SolutionDraftKind;
  readonly url: string;
  /** Statically extracted, as the crawl read it. Null when the page had none. */
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly headings: readonly string[];
  /** The visitor's confirmed target query, or null when they confirmed none. */
  readonly targetQuery: string | null;
  /** Confirmed page type, used only to shape the outline. */
  readonly pageType: string | null;
  /** Opening body text, so the draft can only promise what the page delivers. */
  readonly openingText: string | null;
}

export interface SearchPresentationDraft {
  readonly kind: "search-presentation";
  readonly title: string;
  readonly metaDescription: string;
  readonly openingLine: string;
}

export interface HeadingStructureDraft {
  readonly kind: "heading-structure";
  readonly h1: string;
  readonly h2: readonly string[];
}

export type SolutionDraft = SearchPresentationDraft | HeadingStructureDraft;

/** Caps that bound one prompt, not editorial advice about length. */
const MAX_QUOTED = 400;
const MAX_HEADINGS = 12;
const MAX_H2 = 8;
/** A reply longer than this is not a draft; it is the model ignoring the shape. */
const MAX_FIELD = 320;

function quote(value: string | null, fallback: string): string {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return fallback;
  return trimmed.length > MAX_QUOTED
    ? `${trimmed.slice(0, MAX_QUOTED)}…`
    : trimmed;
}

/**
 * The rules every draft is written under.
 *
 * Two of them are the product's, not the model's: a draft may not promise
 * anything the page does not already deliver, and it may not claim a fact the
 * extract does not contain. A page that ranks for a promise it does not keep
 * loses the click twice — once when the reader bounces, and again when the
 * result stops being shown.
 */
const SHARED_RULES = [
  "You are drafting a preview for a site owner to review. Nothing you write is applied automatically.",
  "Use only what the page already says. Do not invent features, numbers, prices, locations, awards, or claims.",
  "If the page does not support a promise, do not make it. A weaker true line beats a stronger false one.",
  "Write in the language the page is written in.",
  "Reply with one JSON object and nothing else. No markdown fence, no commentary.",
].join("\n");

export function buildSolutionDraftPrompt(input: SolutionDraftInput): string {
  const facts = [
    `page url: ${input.url}`,
    `current title: ${quote(input.title, "(none on the page)")}`,
    `current meta description: ${quote(input.metaDescription, "(none on the page)")}`,
    `confirmed target query: ${quote(input.targetQuery, "(the owner confirmed none)")}`,
    `confirmed page type: ${quote(input.pageType, "(unconfirmed)")}`,
    `opening body text: ${quote(input.openingText, "(not captured)")}`,
    `headings, in page order: ${
      input.headings.length === 0
        ? "(none captured)"
        : input.headings
            .slice(0, MAX_HEADINGS)
            .map((heading) => quote(heading, "(empty)"))
            .join(" | ")
    }`,
  ].join("\n");

  const task =
    input.kind === "search-presentation"
      ? [
          "Task: rewrite how this page presents itself in search results.",
          'Reply shape: {"title": string, "metaDescription": string, "openingLine": string}',
          "title: name what this page helps the reader do. Put the page's own subject first and the brand, if any, last.",
          "metaDescription: give the reader a reason to choose this result — what they can do after opening it.",
          "openingLine: the first sentence of the page, delivering what the description just promised.",
          "A title or description that would fit any sibling page on this site has not been rewritten.",
        ].join("\n")
      : [
          "Task: propose the document outline this page should have.",
          'Reply shape: {"h1": string, "h2": string[]}',
          "h1: the one decision or question this page answers.",
          `h2: between 3 and ${MAX_H2} major steps of that decision, in the order a reader meets them.`,
          "Reuse the page's existing headings where they already work; only change what is unclear or missing.",
        ].join("\n");

  return `${SHARED_RULES}\n\n${task}\n\nMeasured facts about the page:\n${facts}`;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FIELD) return null;
  return trimmed;
}

/**
 * Reads a reply, or refuses it.
 *
 * Null for anything that is not the exact shape asked for, including a reply
 * that is merely close. A half-parsed draft would be shown beside measured
 * evidence with the same weight, and a field the model omitted would render as
 * an empty box the reader reads as "we found nothing to say".
 */
export function readSolutionDraft(
  kind: SolutionDraftKind,
  text: string,
): SolutionDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const value = parsed as Record<string, unknown>;

  if (kind === "search-presentation") {
    const title = readString(value.title);
    const metaDescription = readString(value.metaDescription);
    const openingLine = readString(value.openingLine);
    if (title === null || metaDescription === null || openingLine === null) {
      return null;
    }
    return { kind, title, metaDescription, openingLine };
  }

  const h1 = readString(value.h1);
  if (h1 === null || !Array.isArray(value.h2)) return null;
  const h2 = value.h2
    .map(readString)
    .filter((entry): entry is string => entry !== null);
  // A shorter list than the model was asked for is a reply that lost fields,
  // not a shorter outline: refuse it rather than present it as the answer.
  if (h2.length < 3 || h2.length > MAX_H2) return null;
  return { kind, h1, h2 };
}
