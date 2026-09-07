// @input -- untrusted v3 section-question model output and one exact frozen context
// @output -- existing public Brief generation or a strict rejection; no guessed or repaired fields
// @pos -- private v3 model protocol only; historical flat v2 and public contracts are unchanged
import type { BriefV2Context } from "@sf/public-tools/content-brief/v2-generation-contract";
import { RESEARCH_OUTLINE_MAX, RESEARCH_QUESTION_MAX } from "@sf/public-tools/content-brief/v2-contract";
import { validateModelBriefV2 } from "@sf/public-tools/content-brief/v2-generation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function invalid(path: string) {
  return { ok: false, code: "invalid_request", path } as const;
}

interface Flattened {
  readonly writing: Record<string, unknown>;
  readonly questions: readonly unknown[];
  readonly outline: readonly unknown[];
  /**
   * Where each moved string came from: the flat path the original validator
   * will name, mapped to the path that addresses the same string in the
   * model's own reply. Only strings that moved are listed.
   */
  readonly wirePaths: ReadonlyMap<string, string>;
}

/**
 * One traversal, two readers.
 *
 * The validator needs the flat shape; a caller that wants to act on a rejected
 * string needs to find it again in the reply the model actually sent. Deriving
 * both from the same walk is the point: a second walk written to mirror this
 * one would drift the first time the section shape changes, and the drift
 * would be silent, because a wrong translation looks exactly like a path that
 * cannot be repaired.
 */
function flattenSections(input: unknown): Flattened | { readonly invalidPath: string } {
  if (!isRecord(input) || !Object.hasOwn(input, "research")) return { invalidPath: "research" };
  const { research, ...writing } = input;
  if (!isRecord(research) || !exactKeys(research, ["sections"])) return { invalidPath: "research" };
  if (!Array.isArray(research.sections) || research.sections.length > RESEARCH_OUTLINE_MAX) return { invalidPath: "research.sections" };
  const sections: readonly unknown[] = research.sections;
  const questions: unknown[] = [];
  const outline: unknown[] = [];
  const wirePaths = new Map<string, string>();
  for (const [index, section] of sections.entries()) {
    const path = `research.sections[${index}]`;
    if (!isRecord(section) || !exactKeys(section, ["h2", "h3", "questions"])) return { invalidPath: path };
    if (!Array.isArray(section.questions) || section.questions.length < 1 || section.questions.length > RESEARCH_QUESTION_MAX) return { invalidPath: `${path}.questions` };
    const nestedQuestions: readonly unknown[] = section.questions;
    const answers: unknown[] = [];
    for (const [questionIndex, question] of nestedQuestions.entries()) {
      if (!isRecord(question) || !exactKeys(question, ["anchor", "q", "sources"])) return { invalidPath: `${path}.questions[${questionIndex}]` };
      for (const field of ["anchor", "q", "sources"] as const) {
        wirePaths.set(`research.questions[${questions.length}].${field}`, `${path}.questions[${questionIndex}].${field}`);
      }
      questions.push(question);
      answers.push(question.anchor);
    }
    wirePaths.set(`research.outline[${index}].h2`, `${path}.h2`);
    if (Array.isArray(section.h3)) {
      for (let level = 0; level < section.h3.length; level += 1) {
        wirePaths.set(`research.outline[${index}].h3[${level}]`, `${path}.h3[${level}]`);
      }
    }
    outline.push({ h2: section.h2, h3: section.h3, answers });
  }
  return { writing, questions, outline, wirePaths };
}

/**
 * The reply-shaped path for a rejection the flat validator reported, or null.
 *
 * Null means the caller must use the reported path as it stands: everything
 * outside `research` is passed through untouched, so its path already
 * addresses the reply. Null also covers a reply that is not section-shaped and
 * a flat index with no counterpart (`outline[i].answers`, which is assembled
 * from several questions and is not one string anywhere).
 */
export function briefV3WirePath(flatPath: string, reply: unknown): string | null {
  if (!flatPath.startsWith("research.")) return null;
  const flattened = flattenSections(reply);
  return "invalidPath" in flattened ? null : flattened.wirePaths.get(flatPath) ?? null;
}

/** Shape conversion only: invalid items are rejected, never removed, filled or repaired. */
export function validateSectionQuestionsBrief(input: unknown, context: BriefV2Context): ReturnType<typeof validateModelBriefV2> {
  const flattened = flattenSections(input);
  if ("invalidPath" in flattened) return invalid(flattened.invalidPath);
  // Preserve every remaining field, including unknown top-level keys, for the
  // original validator. It owns total counts, IDs, source roles and page plans.
  return validateModelBriefV2({ ...flattened.writing, research: { questions: flattened.questions, outline: flattened.outline } }, context);
}
