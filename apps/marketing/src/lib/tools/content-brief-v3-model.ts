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

/** Shape conversion only: invalid items are rejected, never removed, filled or repaired. */
export function validateSectionQuestionsBrief(input: unknown, context: BriefV2Context): ReturnType<typeof validateModelBriefV2> {
  if (!isRecord(input) || !Object.hasOwn(input, "research")) return invalid("research");
  const { research, ...writing } = input;
  if (!isRecord(research) || !exactKeys(research, ["sections"])) return invalid("research");
  if (!Array.isArray(research.sections) || research.sections.length > RESEARCH_OUTLINE_MAX) return invalid("research.sections");
  const sections: readonly unknown[] = research.sections;
  const questions: unknown[] = [];
  const outline: unknown[] = [];
  for (const [index, section] of sections.entries()) {
    const path = `research.sections[${index}]`;
    if (!isRecord(section) || !exactKeys(section, ["h2", "h3", "questions"])) return invalid(path);
    if (!Array.isArray(section.questions) || section.questions.length < 1 || section.questions.length > RESEARCH_QUESTION_MAX) return invalid(`${path}.questions`);
    const nestedQuestions: readonly unknown[] = section.questions;
    const answers: unknown[] = [];
    for (const [questionIndex, question] of nestedQuestions.entries()) {
      if (!isRecord(question) || !exactKeys(question, ["anchor", "q", "sources"])) return invalid(`${path}.questions[${questionIndex}]`);
      questions.push(question);
      answers.push(question.anchor);
    }
    outline.push({ h2: section.h2, h3: section.h3, answers });
  }
  // Preserve every remaining field, including unknown top-level keys, for the
  // original validator. It owns total counts, IDs, source roles and page plans.
  return validateModelBriefV2({ ...writing, research: { questions, outline } }, context);
}
